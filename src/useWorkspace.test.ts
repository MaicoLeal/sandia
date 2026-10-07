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
  reconcile: vi.fn(),
  replace: vi.fn(),
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
  replaceWorkspaceIfUnchanged: mocks.replace,
}));
vi.mock("./services/supabase", () => ({
  supabase: { auth: { getSession: mocks.session } },
  loadProfile: mocks.profile,
  loadRemote: mocks.remote,
  syncRemote: mocks.sync,
  WorkspaceAccessError: class WorkspaceAccessError extends Error {},
}));
vi.mock("./services/workspace-new-receipts-reconciliation", () => ({
  reconcileNewReceipts: mocks.reconcile,
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
  mocks.replace.mockResolvedValue(undefined);
});

describe("sincronización sin descartar registros locales", () => {
  it("no sobrescribe registros de otra pestaña al crear un lanzamiento local", async () => {
    const local = pendingWorkspace();
    const before = structuredClone(local);
    mocks.replace.mockRejectedValueOnce(
      new Error("Otra pestaña tiene registros nuevos"),
    );
    const hook = useLoadedWorkspace(local);
    await expect(
      hook.commit((data) => {
        data.reception_weights[0].kg = 999;
      }),
    ).rejects.toThrow("Otra pestaña tiene registros nuevos");
    expect(local).toEqual(before);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.workspaceState).not.toHaveBeenCalled();
  });

  it("reconcilia recepciones nuevas tras conflicto de revisión, archiva antes de reenviar y confirma el servidor", async () => {
    const pending = pendingWorkspace();
    const rebased = { ...pending, revision: confirmed.revision };
    const acknowledged = {
      ...rebased,
      revision: 3,
      pending: false,
      needsRefresh: true,
    };
    const final = { ...acknowledged, needsRefresh: false };
    mocks.sync.mockRejectedValueOnce({
      code: "P0001",
      message:
        "Conflicto de sincronización: otra persona modificó los datos. Conserve sus registros locales y solicite una conciliación al gestor.",
    });
    mocks.sync.mockResolvedValueOnce(3);
    mocks.remote.mockResolvedValueOnce(confirmed).mockResolvedValueOnce(final);
    mocks.reconcile.mockReturnValueOnce(rebased);

    await useLoadedWorkspace(pending).sync();

    expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith(pending, confirmed);
    expect(mocks.sync).toHaveBeenNthCalledWith(1, pending);
    expect(mocks.sync).toHaveBeenNthCalledWith(2, rebased);
    expect(mocks.archive).toHaveBeenNthCalledWith(
      1,
      "cloud:operator-a",
      pending,
      rebased,
    );
    expect(mocks.archive).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenNthCalledWith(
      1,
      "cloud:operator-a",
      rebased,
      acknowledged,
    );
    expect(mocks.archive.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sync.mock.invocationCallOrder[1],
    );
    expect(mocks.replace).toHaveBeenNthCalledWith(
      2,
      "cloud:operator-a",
      acknowledged,
      final,
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.workspaceState).toHaveBeenLastCalledWith(final);
    expect(pending.pending).toBe(true);
    expect(pending.revision).toBe(1);
    expect(final.data.reception_weights[0].kg).toBe(321);
  });

  it("no reenvía si la conciliación detecta correcciones locales o el respaldo detecta otra pestaña", async () => {
    const pending = pendingWorkspace();
    const conflict = {
      code: "P0001",
      message: "Conflicto de sincronización: otra persona modificó los datos.",
    };
    mocks.sync.mockRejectedValue(conflict);
    mocks.reconcile.mockImplementationOnce(() => {
      throw new Error("Hay una corrección local que requiere revisión.");
    });
    await useLoadedWorkspace(pending).sync();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.workspaceState).not.toHaveBeenCalled();

    mocks.sync.mockClear();
    mocks.reconcile.mockReturnValueOnce({ ...pending, revision: 2 });
    mocks.archive.mockRejectedValueOnce(
      new Error("Otra pestaña cambió los datos"),
    );
    await useLoadedWorkspace(pending).sync();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.workspaceState).not.toHaveBeenCalled();
    expect(pending.pending).toBe(true);
    expect(mocks.errorState).toHaveBeenLastCalledWith(
      "Otra pestaña cambió los datos",
    );
  });

  it("limita la conciliación a un reenvío y conserva la copia pendiente si vuelve a cambiar la revisión", async () => {
    const pending = pendingWorkspace();
    const rebased = { ...pending, revision: 2 };
    const conflict = {
      code: "P0001",
      message: "Conflicto de sincronización: otra persona modificó los datos.",
    };
    mocks.sync.mockRejectedValue(conflict);
    mocks.reconcile.mockReturnValueOnce(rebased);
    await useLoadedWorkspace(pending).sync();
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(mocks.remote).toHaveBeenCalledOnce();
    expect(mocks.archive).toHaveBeenCalledOnce();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.workspaceState).toHaveBeenCalledExactlyOnceWith(rebased);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(rebased.pending).toBe(true);
    expect(rebased.data.reception_weights[0].kg).toBe(321);
  });

  it("no trata otros errores P0001 como conflictos de revisión", async () => {
    mocks.sync.mockRejectedValue({
      code: "P0001",
      message: "Saldo insuficiente para palletizar",
    });
    await useLoadedWorkspace(pendingWorkspace()).sync();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.remote).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("conserva cambios de otra pestaña tanto al confirmar un envío como al actualizar una lectura", async () => {
    const pending = pendingWorkspace();
    const message = "Los registros locales cambiaron en otra pestaña";
    mocks.replace.mockRejectedValue(new Error(message));
    await useLoadedWorkspace(pending).sync();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.remote).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.workspaceState).not.toHaveBeenCalled();
    expect(pending.pending).toBe(true);

    mocks.sync.mockClear();
    await useLoadedWorkspace(confirmed).sync();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.workspaceState).not.toHaveBeenCalled();
    expect(mocks.errorState).toHaveBeenLastCalledWith(message);
  });

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
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      "cloud:operator-a",
      pending,
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
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      "cloud:operator-a",
      refresh,
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

    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      "cloud:operator-a",
      cache,
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
    const refreshing = {
      ...cache,
      needsRefresh: true,
    };
    expect(mocks.replace).toHaveBeenNthCalledWith(
      1,
      "cloud:operator-a",
      cache,
      refreshing,
    );
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "cloud:operator-a",
      refreshing,
      confirmed,
    );
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
    expect(mocks.replace).toHaveBeenLastCalledWith("cloud:operator-a", cache, {
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
    const refreshing = { ...cache, needsRefresh: true };
    expect(mocks.replace).not.toHaveBeenCalledWith(
      "cloud:operator-a",
      refreshing,
      other,
    );
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "cloud:operator-a",
      refreshing,
      {
        ...cache,
        needsRefresh: true,
      },
    );
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
    const refreshing = { ...cache, needsRefresh: true };
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "cloud:operator-a",
      refreshing,
      {
        ...cache,
        needsRefresh: true,
      },
    );
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
    const refreshing = { ...cache, needsRefresh: true };
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "cloud:operator-a",
      refreshing,
      {
        ...cache,
        needsRefresh: true,
      },
    );
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
