import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { Profile, Workspace } from "./types";
import { emptyData } from "./domain";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  profile: vi.fn(),
  remote: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  sync: vi.fn(),
  workspaceState: vi.fn(),
  errorState: vi.fn(),
  archive: vi.fn(),
}));
// Exercise the hook's asynchronous loading and identity guards without mounting
// its separate online/auth event subscription or scheduling automatic sync.
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: vi.fn((value: unknown) => [value, vi.fn()]),
}));
vi.mock("./services/storage", () => ({
  readWorkspace: mocks.read,
  saveWorkspace: mocks.save,
  removeLegacyDemo: mocks.remove,
  archiveWorkspaceAndReplace: mocks.archive,
}));
vi.mock("./services/supabase", () => ({
  supabase: { auth: { getSession: mocks.session } },
  loadProfile: mocks.profile,
  loadRemote: mocks.remote,
  syncRemote: mocks.sync,
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

function useLoadedWorkspace(workspace: Workspace) {
  vi.mocked(useState).mockReturnValueOnce([workspace, mocks.workspaceState]);
  vi.mocked(useState).mockReturnValueOnce(["", mocks.errorState]);
  return useWorkspace();
}

function pendingWorkspace(): Workspace {
  const workspace = structuredClone(cache);
  workspace.pending = true;
  workspace.data.reception_weights.push({
    id: "local-weight",
    organization_id: scope.organizationId,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    created_by: profile.user_id,
    status: "Activo",
    reception_id: "local-reception",
    sequence: 1,
    kg: 321,
    operator: profile.name,
    notes: "Registro pendiente en este dispositivo",
    correction_reason: "",
  });
  return workspace;
}

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
  mocks.sync.mockResolvedValue(2);
  mocks.archive.mockResolvedValue("recovery:test");
});

describe("sincronización sin descartar registros locales", () => {
  it("recupera datos guardados para imprimir después de archivar, sin reenviar el payload antiguo", async () => {
    const local = { ...cache, pending: true };
    expect(await useLoadedWorkspace(local).useServerData()).toBe(true);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.archive).toHaveBeenCalledExactlyOnceWith(
      "cloud:operator-a",
      local,
      confirmed,
    );
    expect(mocks.workspaceState).toHaveBeenCalledExactlyOnceWith(confirmed);
    expect(mocks.archive.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.workspaceState.mock.invocationCallOrder[0],
    );
  });
  it("bloquea recuperación si hay un pesaje nuevo y mantiene la copia local", async () => {
    const local = pendingWorkspace();
    const before = structuredClone(local);
    expect(await useLoadedWorkspace(local).useServerData()).toBe(false);
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.workspaceState).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(local).toEqual(before);
    expect(mocks.errorState).toHaveBeenLastCalledWith(
      expect.stringContaining("Hay registros nuevos"),
    );
  });
  it("conserva cache si falla lectura remota, respaldo o guard de otra pestaña", async () => {
    const local = { ...cache, pending: true };
    mocks.remote.mockRejectedValueOnce(new Error("Sin conexión"));
    expect(await useLoadedWorkspace(local).useServerData()).toBe(false);
    expect(mocks.archive).not.toHaveBeenCalled();
    mocks.archive.mockRejectedValueOnce(
      new Error("Los registros locales cambiaron en otra pestaña"),
    );
    expect(await useLoadedWorkspace(local).useServerData()).toBe(false);
    expect(mocks.workspaceState).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("rechaza datos de otra cuenta antes de archivar o sustituir", async () => {
    mocks.remote.mockResolvedValue({
      ...confirmed,
      profile: { ...profile, user_id: "otra-cuenta" },
    });
    expect(
      await useLoadedWorkspace({ ...cache, pending: true }).useServerData(),
    ).toBe(false);
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.workspaceState).not.toHaveBeenCalled();
  });
  it("expone un error RPC plano y conserva la revisión y los registros pendientes", async () => {
    const pending = pendingWorkspace();
    const before = structuredClone(pending);
    mocks.sync.mockRejectedValue({
      code: "P0001",
      message: "Conflicto de sincronización: actualice los datos.",
      details: "registro privado",
    });

    await useLoadedWorkspace(pending).sync();

    expect(mocks.sync).toHaveBeenCalledWith(pending);
    expect(mocks.remote).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.workspaceState).not.toHaveBeenCalled();
    expect(pending).toEqual(before);
    expect(mocks.errorState).toHaveBeenLastCalledWith(
      "Conflicto de sincronización: actualice los datos. (código: P0001)",
    );
  });

  it("conserva el envío confirmado y needsRefresh si falla la lectura posterior", async () => {
    const pending = pendingWorkspace();
    const acknowledged = {
      ...pending,
      revision: 2,
      pending: false,
      needsRefresh: true,
    };
    mocks.remote.mockRejectedValue({
      code: "42501",
      message: "permission denied for table trap_installations",
      hint: "información interna",
    });

    await useLoadedWorkspace(pending).sync();

    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
      "cloud:operator-a",
      acknowledged,
    );
    expect(mocks.workspaceState).toHaveBeenCalledExactlyOnceWith(acknowledged);
    expect(acknowledged.data.reception_weights[0].kg).toBe(321);
    expect(mocks.errorState).toHaveBeenLastCalledWith(
      "permission denied for table trap_installations (código: 42501)",
    );
  });

  it("reintenta solamente la lectura de un envío confirmado sin reenviar el payload", async () => {
    const refresh = {
      ...pendingWorkspace(),
      revision: 2,
      pending: false,
      needsRefresh: true,
    };
    mocks.remote.mockRejectedValue({ message: "Failed to fetch", code: "" });

    await useLoadedWorkspace(refresh).sync();

    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.workspaceState).not.toHaveBeenCalled();
    expect(refresh.needsRefresh).toBe(true);
    expect(refresh.data.reception_weights[0].kg).toBe(321);
    expect(mocks.errorState).toHaveBeenLastCalledWith("Failed to fetch");
  });

  it("confirma una lectura exitosa y conserva las protecciones del cache", async () => {
    const refresh = { ...cache, needsRefresh: true };
    await useLoadedWorkspace(refresh).sync();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
      "cloud:operator-a",
      confirmed,
    );
    expect(mocks.workspaceState).toHaveBeenCalledExactlyOnceWith(confirmed);
  });

  it("expone un error plano de carga sin reemplazar el cache por datos vacíos", async () => {
    const hook = useLoadedWorkspace(cache);
    mocks.remote.mockRejectedValue({
      code: "PGRST202",
      message: "Could not find the function public.sandia_features",
      details: "dato privado",
    });

    await hook.reload();

    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
      "cloud:operator-a",
      cache,
    );
    expect(mocks.errorState).toHaveBeenLastCalledWith(
      "Could not find the function public.sandia_features (código: PGRST202)",
    );
    expect(cache.data).toEqual(emptyData());
  });

  it("conserva el mensaje alternativo si el error de sincronización es desconocido", async () => {
    mocks.remote.mockRejectedValue(null);
    await useLoadedWorkspace(cache).sync();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.errorState).toHaveBeenLastCalledWith(
      "Error de sincronización.",
    );
  });
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
      "No se pudo confirmar la etiqueta guardada. Conéctese y sincronice antes de imprimir. Connection interrupted",
    );
    expect(mocks.save).toHaveBeenLastCalledWith("cloud:operator-a", {
      ...cache,
      needsRefresh: true,
    });
  });
  it("conserva el error plano y su código al impedir la impresión sin confirmación remota", async () => {
    mocks.remote.mockRejectedValue({
      code: "42501",
      message: "permission denied for table pallets",
      details: "registro privado",
    });
    await expect(useWorkspace().reload(true, scope)).rejects.toThrow(
      "No se pudo confirmar la etiqueta guardada. Conéctese y sincronice antes de imprimir. permission denied for table pallets (código: 42501)",
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
