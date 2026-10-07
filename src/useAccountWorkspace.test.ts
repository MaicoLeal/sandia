import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { emptyData } from "./domain";
import type { Profile, Workspace } from "./types";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  profile: vi.fn(),
  remote: vi.fn(),
  sync: vi.fn(),
  rpc: vi.fn(),
  read: vi.fn(),
  replace: vi.fn(),
  remove: vi.fn(),
  archive: vi.fn(),
  saveDraft: vi.fn(),
  readDraftEntries: vi.fn(),
  clearDraft: vi.fn(),
  workspaceState: vi.fn(),
  errorState: vi.fn(),
  backupState: vi.fn(),
}));
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: vi.fn((value: unknown) => [value, vi.fn()]),
}));
vi.mock("./services/storage", () => ({
  readWorkspace: mocks.read,
  replaceWorkspaceIfUnchanged: mocks.replace,
  removeLegacyDemo: mocks.remove,
  archiveWorkspaceAndReplace: mocks.archive,
  saveDraft: mocks.saveDraft,
  readDraftEntries: mocks.readDraftEntries,
  clearDraft: mocks.clearDraft,
}));
vi.mock("./services/supabase", () => ({
  supabase: { auth: { getSession: mocks.session }, rpc: mocks.rpc },
  loadProfile: mocks.profile,
  loadRemote: mocks.remote,
  syncRemote: mocks.sync,
  WorkspaceAccessError: class WorkspaceAccessError extends Error {},
}));
import { useWorkspace } from "./useWorkspace";

const userId = "30000000-0000-4000-8000-000000000001";
const orgId = "20000000-0000-4000-8000-000000000001";
const palletId = "40000000-0000-4000-8000-000000000001";
const profile: Profile = {
  id: "50000000-0000-4000-8000-000000000001",
  user_id: userId,
  organization_id: orgId,
  name: "Operador de prueba",
  role: "administrador",
  status: "Activo",
  created_at: "2026-10-07T12:00:00Z",
  updated_at: "2026-10-07T12:00:00Z",
  created_by: null,
};
function freshWorkspace(revision = 87): Workspace {
  const data = emptyData();
  data.pallets.push({
    id: palletId,
    organization_id: orgId,
    code: "PAL-TEST-1",
    token: "60000000-0000-4000-8000-000000000001",
    destination: "Uruguay",
    assembled_at: "2026-10-07T12:00:00Z",
    responsible: profile.name,
    gross_kg: 442,
    net_kg: 400,
    tare_kg: 42,
    fruit_count: null,
    notes: "Datos corregidos en servidor",
    status: "En armado",
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    created_by: userId,
    metadata: {
      export_label: { afidi: "AFIDI-TEST", producer_code: "SPE-TEST" },
    },
  });
  return {
    data,
    revision,
    pending: false,
    localOnly: false,
    organizationId: orgId,
    profile,
    features: { label_print_audit: true },
  };
}
const caches = new Map<string, Workspace>();
const drafts = new Map<string, unknown>();
function useLoadedWorkspace(workspace: Workspace) {
  vi.mocked(useState).mockReturnValueOnce([workspace, mocks.workspaceState]);
  vi.mocked(useState).mockReturnValueOnce(["", mocks.errorState]);
  vi.mocked(useState).mockReturnValueOnce([false, vi.fn()]);
  vi.mocked(useState).mockReturnValueOnce([null, vi.fn()]);
  vi.mocked(useState).mockReturnValueOnce([false, vi.fn()]);
  vi.mocked(useState).mockReturnValueOnce([true, vi.fn()]);
  vi.mocked(useState).mockReturnValueOnce([null, mocks.backupState]);
  return useWorkspace();
}
beforeEach(() => {
  vi.resetAllMocks();
  caches.clear();
  drafts.clear();
  vi.stubGlobal("navigator", { onLine: true });
  mocks.session.mockResolvedValue({
    data: { session: { user: { id: userId } } },
  });
  mocks.profile.mockResolvedValue(profile);
  mocks.remote.mockResolvedValue(freshWorkspace());
  mocks.read.mockImplementation(async (key: string) => caches.get(key));
  mocks.replace.mockImplementation(
    async (key: string, before: Workspace | undefined, after: Workspace) => {
      if (JSON.stringify(caches.get(key)) !== JSON.stringify(before))
        throw new Error("El caché cambió en otra pestaña");
      caches.set(key, structuredClone(after));
    },
  );
  mocks.remove.mockResolvedValue(undefined);
  mocks.sync.mockResolvedValue(88);
  mocks.saveDraft.mockImplementation(async (key: string, value: unknown) => {
    drafts.set(key, structuredClone(value));
  });
  mocks.readDraftEntries.mockImplementation(async (prefix: string) =>
    [...drafts.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value })),
  );
  mocks.clearDraft.mockImplementation(async (key: string) => {
    drafts.delete(key);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("account-based reception saves and immediate printing", () => {
  it("saves new data on the fresh server revision and preserves server label corrections", async () => {
    const stale = freshWorkspace(1);
    stale.data.pallets[0].notes = "Versión antigua del dispositivo";
    stale.data.pallets[0].metadata = null;
    const original = structuredClone(stale),
      fresh = freshWorkspace();
    caches.set("account:" + userId, structuredClone(stale));
    let submitted: Workspace | undefined;
    mocks.remote
      .mockResolvedValueOnce(fresh)
      .mockImplementationOnce(async () => ({
        ...submitted!,
        revision: 88,
        pending: false,
        needsRefresh: false,
      }));
    mocks.sync.mockImplementationOnce(async (data: Workspace) => {
      submitted = structuredClone(data);
      return 88;
    });
    await useLoadedWorkspace(stale).commit((data) => {
      data.reception_weights.push({
        id: "70000000-0000-4000-8000-000000000001",
        organization_id: orgId,
        reception_id: "80000000-0000-4000-8000-000000000001",
        sequence: 1,
        kg: 321,
        operator: profile.name,
        notes: "Recepción nueva",
        correction_reason: "",
        status: "Activo",
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        created_by: userId,
      });
    });
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(submitted?.revision).toBe(87);
    expect(submitted?.data.pallets).toEqual(fresh.data.pallets);
    expect(submitted?.data.reception_weights[0].kg).toBe(321);
    expect(stale).toEqual(original);
    expect(caches.get("account:" + userId)).toMatchObject({
      revision: 88,
      pending: false,
    });
    expect(mocks.archive).not.toHaveBeenCalled();
  });
  it("keeps the unsent legacy device backup intact and never submits it on account load", async () => {
    const legacy = freshWorkspace(1);
    legacy.pending = true;
    legacy.data.pallets[0].net_kg = 321;
    legacy.data.pallets[0].notes = "Lanzamiento pendiente del dispositivo";
    const original = structuredClone(legacy);
    caches.set("cloud:" + userId, legacy);
    await useLoadedWorkspace(freshWorkspace()).reload();
    expect(caches.get("cloud:" + userId)).toEqual(original);
    expect(caches.get("account:" + userId)).toEqual(freshWorkspace());
    expect(mocks.backupState).toHaveBeenCalledWith(legacy);
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      "account:" + userId,
      undefined,
      freshWorkspace(),
    );
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });
  it("queues print intent durably and returns before the server RPC resolves", async () => {
    const workspace = freshWorkspace();
    caches.set("account:" + userId, structuredClone(workspace));
    let resolveRequest!: (value: { error: null }) => void;
    const unresolved = new Promise<{ error: null }>((resolve) => {
      resolveRequest = resolve;
    });
    const abortSignal = vi.fn(() => unresolved);
    mocks.rpc.mockReturnValue({ abortSignal });
    await useLoadedWorkspace(workspace).recordPalletPrint(palletId);
    expect(mocks.saveDraft).toHaveBeenCalledOnce();
    expect(drafts.size).toBe(1);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.remote).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(mocks.clearDraft).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("record_pallet_label_print", {
      target_pallet_id: palletId,
      print_id: expect.any(String),
    });
    expect(caches.get("account:" + userId)?.revision).toBe(87);
    resolveRequest({ error: null });
    await vi.waitFor(() => expect(drafts.size).toBe(0));
  });
});
