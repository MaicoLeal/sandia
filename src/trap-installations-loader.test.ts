import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyData } from "./domain";
import type { Profile, TrapInstallation, Workspace } from "./types";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  getFile: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./services/storage", () => ({ getFile: mocks.getFile }));

const organizationId = "test-organization";
const userId = "test-private-operator";
const initialProfile: Profile = {
  id: "test-profile",
  organization_id: organizationId,
  user_id: userId,
  name: "Operador de prueba",
  role: "administrador",
  status: "Activo",
  created_at: "2026-10-07T12:00:00Z",
  updated_at: "2026-10-07T12:00:00Z",
  created_by: null,
};

function installation(index: number): TrapInstallation {
  return {
    id: `test-trap-${String(index).padStart(4, "0")}`,
    organization_id: organizationId,
    status: "Registrado",
    created_at: "2026-10-07T12:00:00Z",
    updated_at: "2026-10-07T12:00:00Z",
    created_by: null,
    producer_id: null,
    source_key: `test-source:${index}`,
    source_row: index,
    source_document: "Documento privado de prueba",
    source_form: "TEST-FORM",
    source_version: "01",
    source_producer_name: "Nombre privado de prueba",
    trap_code: `TEST-REFERENCE-${index}`,
    department: "Departamento de prueba",
    district: "Distrito de prueba",
    community: "Comunidad de prueba",
    installed_on: "2026-08-12",
    trap_type: "MP",
    latitude_raw: "private-latitude",
    longitude_raw: "private-longitude",
    installation_place: "CC",
    host: "SANDIA",
    area_ha: 0.5,
    crop_stage: "F",
    responsible: "Responsable de prueba",
    review_notes: [],
  };
}

type Query = {
  table: string;
  columns?: string;
  filters: [string, unknown][];
  order?: string;
  range?: [number, number];
};
type Capabilities = { data: Record<string, boolean> | null; error: unknown };

let service: typeof import("./services/supabase");
let profile: Profile;
let capabilities: Capabilities;
let revisions: number[];
let rows: Record<string, unknown[]>;
let pageError: { table: string; offset: number; error: object } | undefined;
let queries: Query[];
let events: string[];

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://test.invalid");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-public-key");
  profile = { ...initialProfile };
  capabilities = { data: { trap_installations: true }, error: null };
  revisions = [7, 7];
  rows = {};
  pageError = undefined;
  queries = [];
  events = [];
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "sandia_features") return capabilities;
    if (name === "sync_workspace") return { data: 8, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  mocks.from.mockImplementation((table: string) => {
    const query: Query = { table, filters: [] };
    const builder = {
      select(columns: string) {
        query.columns = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        query.filters.push([column, value]);
        return builder;
      },
      order(column: string) {
        query.order = column;
        return builder;
      },
      async single() {
        queries.push(query);
        if (table === "profiles") return { data: profile, error: null };
        if (table === "organizations") {
          const revision = revisions.shift();
          events.push(`revision:${revision}`);
          return { data: { revision }, error: null };
        }
        throw new Error(`Unexpected single query: ${table}`);
      },
      async range(from: number, to: number) {
        query.range = [from, to];
        queries.push(query);
        events.push(`rows:${table}:${from}`);
        if (pageError?.table === table && pageError.offset === from)
          return { data: null, error: pageError.error };
        return { data: (rows[table] ?? []).slice(from, to + 1), error: null };
      },
    };
    return builder;
  });
  mocks.createClient.mockReturnValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  });
  service = await import("./services/supabase");
});

afterEach(() => vi.unstubAllEnvs());

describe("carga de instalaciones de trampas y compatibilidad del servidor", () => {
  it.each<Capabilities>([
    { data: { trap_installations: false }, error: null },
    { data: {}, error: null },
    { data: null, error: { code: "PGRST202", message: "Feature RPC missing" } },
  ])(
    "no consulta la tabla antes de anunciarse la capacidad (%j)",
    async (flags) => {
      capabilities = flags;
      const workspace = await service.loadRemote();
      expect(mocks.from).not.toHaveBeenCalledWith("trap_installations");
      expect(workspace.trapInstallations).toEqual([]);
      expect(workspace.data).toEqual(emptyData());
      expect(workspace.revision).toBe(7);
    },
  );

  it("carga todas las páginas del mismo tenant dentro de la ventana de revisión", async () => {
    const installations = Array.from({ length: 1001 }, (_, i) =>
      installation(i + 1),
    );
    rows.trap_installations = installations;
    const workspace = await service.loadRemote();
    expect(workspace.trapInstallations).toEqual(installations);
    expect(workspace.data).not.toHaveProperty("trap_installations");
    expect(workspace.features?.trap_installations).toBe(true);
    expect(workspace.organizationId).toBe(organizationId);
    const pages = queries.filter(
      (query) => query.table === "trap_installations",
    );
    expect(pages.map((query) => query.range)).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
    for (const page of pages) {
      expect(page.filters).toEqual([["organization_id", organizationId]]);
      expect(page.order).toBe("id");
    }
    expect(events[0]).toBe("revision:7");
    expect(events.at(-1)).toBe("revision:7");
    const trapEvents = events.filter((event) => event.startsWith("rows:trap_"));
    expect(trapEvents).toEqual([
      "rows:trap_installations:0",
      "rows:trap_installations:500",
      "rows:trap_installations:1000",
    ]);
    expect(queries.filter((query) => query.table === "organizations")).toEqual([
      {
        table: "organizations",
        columns: "revision",
        filters: [["id", organizationId]],
      },
      {
        table: "organizations",
        columns: "revision",
        filters: [["id", organizationId]],
      },
    ]);
  });

  it("rechaza una página inaccesible sin devolver un espacio parcialmente cargado", async () => {
    rows.trap_installations = Array.from({ length: 501 }, (_, i) =>
      installation(i + 1),
    );
    const denied = {
      code: "42501",
      message: "Permission denied for test rows",
    };
    pageError = { table: "trap_installations", offset: 500, error: denied };
    await expect(service.loadRemote()).rejects.toEqual(denied);
    expect(events).toContain("rows:trap_installations:500");
    expect(events.filter((event) => event.startsWith("revision:"))).toEqual([
      "revision:7",
    ]);
  });

  it("rechaza datos que cambiaron mientras se consultaban las instalaciones", async () => {
    revisions = [7, 8];
    rows.trap_installations = [installation(1)];
    await expect(service.loadRemote()).rejects.toThrow(
      "Los datos cambiaron durante la consulta",
    );
    expect(events[0]).toBe("revision:7");
    expect(events.at(-1)).toBe("revision:8");
    expect(events).toContain("rows:trap_installations:0");
  });

  it("bloquea destinatarios antes de consultar productores o instalaciones privadas", async () => {
    profile.role = "destinatario";
    await expect(service.loadRemote()).rejects.toBeInstanceOf(
      service.WorkspaceAccessError,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from.mock.calls).toEqual([["profiles"]]);
  });
});

describe("separación de documentos readonly durante la sincronización", () => {
  it("envía solo Data y su revisión, sin instalaciones, documentos o coordenadas", async () => {
    const workspace: Workspace = {
      data: emptyData(),
      trapInstallations: [installation(1)],
      features: { trap_installations: true },
      revision: 7,
      pending: true,
      localOnly: false,
      organizationId,
      profile,
    };
    await expect(service.syncRemote(workspace)).resolves.toBe(8);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("sync_workspace", {
      payload: workspace.data,
      expected_revision: 7,
    });
    const [, args] = mocks.rpc.mock.calls[0];
    expect(args.payload).toBe(workspace.data);
    const request = JSON.stringify(args);
    expect(request).not.toContain("trapInstallations");
    expect(request).not.toContain("trap_installations");
    expect(request).not.toContain("Documento privado de prueba");
    expect(request).not.toContain("private-latitude");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getFile).not.toHaveBeenCalled();
  });
});
