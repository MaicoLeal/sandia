import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile, Workspace } from "./types";
import { emptyData } from "./domain";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  profile: vi.fn(),
  remote: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
// Exercise the hook's asynchronous loading and identity guards without mounting
// its separate online/auth event subscription or scheduling automatic sync.
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("./services/storage", () => ({
  readWorkspace: mocks.read,
  saveWorkspace: mocks.save,
  removeLegacyDemo: mocks.remove,
}));
vi.mock("./services/supabase", () => ({
  supabase: { auth: { getSession: mocks.session } },
  loadProfile: mocks.profile,
  loadRemote: mocks.remote,
  syncRemote: vi.fn(),
  WorkspaceAccessError: class WorkspaceAccessError extends Error {},
}));
import { useWorkspace } from "./useWorkspace";

const scope = { userId: "operator-a", organizationId: "agronorte" };
const profile: Profile = {
  id: "profile-a",
  organization_id: scope.organizationId,
  user_id: scope.userId,
  name: "Operador",
  role: "administrador",
  status: "Activo",
  created_at: "2026-10-06T12:00:00Z",
  updated_at: "2026-10-06T12:00:00Z",
  created_by: null,
};
const cache: Workspace = {
  data: emptyData(),
  revision: 1,
  pending: false,
  localOnly: false,
  organizationId: scope.organizationId,
  profile,
};
const confirmed: Workspace = { ...cache, revision: 2 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("navigator", { onLine: true });
  mocks.session.mockResolvedValue({
    data: { session: { user: { id: scope.userId } } },
  });
  mocks.profile.mockResolvedValue(profile);
  mocks.remote.mockResolvedValue(confirmed);
  mocks.read.mockResolvedValue(cache);
  mocks.save.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("confirmación de etiqueta e identidad del espacio", () => {
  it("invalida primero el cache y confirma únicamente los datos remotos del operador", async () => {
    await useWorkspace().reload(true, scope);
    expect(mocks.save).toHaveBeenNthCalledWith(1, "cloud:operator-a", {
      ...cache,
      needsRefresh: true,
    });
    expect(mocks.save).toHaveBeenLastCalledWith("cloud:operator-a", confirmed);
  });
  it("rechaza otra sesión antes de leer o alterar su cache", async () => {
    mocks.session.mockResolvedValue({
      data: { session: { user: { id: "operator-b" } } },
    });
    await expect(useWorkspace().reload(true, scope)).rejects.toThrow(
      "Su sesión o acceso cambió",
    );
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rechaza cambio de organización y mantiene el cache pendiente de confirmar", async () => {
    mocks.profile.mockResolvedValue({
      ...profile,
      organization_id: "another-org",
    });
    await expect(useWorkspace().reload(true, scope)).rejects.toThrow(
      "Su sesión o acceso cambió",
    );
    expect(mocks.remote).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenLastCalledWith("cloud:operator-a", {
      ...cache,
      needsRefresh: true,
    });
  });
  it("no guarda una respuesta remota perteneciente a otra cuenta", async () => {
    const other = {
      ...confirmed,
      profile: { ...profile, user_id: "operator-b" },
    };
    mocks.remote.mockResolvedValue(other);
    await expect(useWorkspace().reload(true, scope)).rejects.toThrow(
      "Su sesión o acceso cambió",
    );
    expect(mocks.save).not.toHaveBeenCalledWith("cloud:operator-a", other);
    expect(mocks.save).toHaveBeenLastCalledWith("cloud:operator-a", {
      ...cache,
      needsRefresh: true,
    });
  });
  it("rechaza la confirmación anterior cuando otra recarga la invalida", async () => {
    let resolveRemote!: (value: Workspace) => void;
    mocks.remote.mockImplementationOnce(
      () =>
        new Promise<Workspace>((resolve) => {
          resolveRemote = resolve;
        }),
    );
    const hook = useWorkspace();
    const first = hook.reload(true, scope);
    const rejected = expect(first).rejects.toThrow("Su sesión o acceso cambió");
    await vi.waitFor(() => expect(mocks.remote).toHaveBeenCalledOnce());
    await hook.reload();
    resolveRemote(confirmed);
    await rejected;
  });
  it("conserva needsRefresh si el servidor no puede confirmar los datos", async () => {
    mocks.remote.mockRejectedValue(new Error("Connection interrupted"));
    await expect(useWorkspace().reload(true, scope)).rejects.toThrow(
      "No se pudo confirmar la etiqueta guardada",
    );
    expect(mocks.save).toHaveBeenLastCalledWith("cloud:operator-a", {
      ...cache,
      needsRefresh: true,
    });
  });
  it("protege cambios locales pendientes sin sobrescribirlos", async () => {
    mocks.read.mockResolvedValue({ ...cache, pending: true });
    await expect(useWorkspace().reload(true, scope)).rejects.toThrow(
      "No se pudo confirmar la etiqueta guardada",
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remote).not.toHaveBeenCalled();
  });
});
