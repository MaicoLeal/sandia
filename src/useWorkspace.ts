import { useCallback, useEffect, useRef, useState } from "react";
import type { Data, Workspace, Profile } from "./types";
import { LOCAL_ORG, LOCAL_KEY, emptyData } from "./domain";
import {
  readWorkspace,
  removeLegacyDemo,
  archiveWorkspaceAndReplace,
  replaceWorkspaceIfUnchanged,
} from "./services/storage";
import {
  loadProfile,
  loadRemote,
  supabase,
  syncRemote,
  WorkspaceAccessError,
} from "./services/supabase";
import { getErrorMessage } from "./services/error-message";
import { assertPrintRecovery } from "./services/workspace-reconciliation";
import { reconcileNewReceipts } from "./services/workspace-new-receipts-reconciliation";

function isRevisionConflict(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const problem = error as { code?: unknown; message?: unknown };
  return (
    problem.code === "P0001" &&
    typeof problem.message === "string" &&
    problem.message.includes(
      "Conflicto de sincronización: otra persona modificó los datos",
    )
  );
}
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [recipientProfile, setRecipientProfile] = useState<Profile | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const lock = useRef(false);
  const epoch = useRef(0);
  const identity = useRef<string | null | undefined>(undefined);
  const load = useCallback(
    async (
      requireRemote = false,
      expectedScope?: { userId: string; organizationId: string },
    ) => {
      const request = ++epoch.current;
      const accessChanged = () =>
        new WorkspaceAccessError(
          "Su sesión o acceso cambió. Abra nuevamente el pallet antes de editar o imprimir la etiqueta.",
        );
      const current = () => {
        const valid = request === epoch.current;
        if (!valid && requireRemote) throw accessChanged();
        return valid;
      };
      setWorkspace(null);
      setRecipientProfile(null);
      setNeedsLogin(false);
      setBusy(false);
      setError("");
      try {
        if (requireRemote && !expectedScope) throw accessChanged();
        await removeLegacyDemo();
        const session = supabase ? await supabase.auth.getSession() : null;
        if (!current()) return;
        if (
          requireRemote &&
          session?.data.session?.user.id !== expectedScope?.userId
        )
          throw accessChanged();
        identity.current = session?.data.session?.user.id ?? null;
        if (session?.data.session) {
          setNeedsLogin(false);
          const key = "cloud:" + session.data.session.user.id;
          let cached = await readWorkspace(key);
          if (!current()) return;
          if (requireRemote) {
            if (cached?.pending)
              throw new Error(
                "Sincronice los registros pendientes antes de actualizar la etiqueta.",
              );
            if (cached) {
              const refreshCache = { ...cached, needsRefresh: true };
              await replaceWorkspaceIfUnchanged(key, cached, refreshCache);
              cached = refreshCache;
              if (!current()) return;
            }
            if (!navigator.onLine)
              throw new Error(
                "Los datos se guardaron en el servidor. Conéctese y sincronice para confirmar la etiqueta antes de imprimir.",
              );
          }
          let currentProfile: Profile | null = null;
          if (navigator.onLine) {
            const profile = await loadProfile();
            if (!current()) return;
            if (
              requireRemote &&
              (profile.user_id !== expectedScope?.userId ||
                profile.organization_id !== expectedScope?.organizationId ||
                profile.role === "destinatario")
            )
              throw accessChanged();
            if (profile.user_id !== session.data.session.user.id) return;
            if (profile.role === "destinatario") {
              setWorkspace(null);
              setRecipientProfile(profile);
              return;
            }
            currentProfile = profile;
            if (cached && cached.organizationId !== profile.organization_id)
              throw new Error(
                "La organización de la cuenta cambió. Contacte al administrador antes de sincronizar los registros pendientes.",
              );
          }
          setRecipientProfile(null);
          if (cached?.profile?.role === "destinatario") {
            setWorkspace(null);
            throw new Error(
              "Conecte a internet para consultar los pallets autorizados.",
            );
          }
          if (cached) {
            if (!current()) return;
            const verifiedCache = currentProfile
              ? { ...cached, profile: currentProfile }
              : cached;
            if (currentProfile) {
              await replaceWorkspaceIfUnchanged(key, cached, verifiedCache);
              if (!current()) return;
            }
            setWorkspace(verifiedCache);
            if (navigator.onLine && !cached.pending) {
              const remote = await loadRemote();
              if (
                requireRemote &&
                (remote.profile?.user_id !== expectedScope?.userId ||
                  remote.profile?.organization_id !==
                    expectedScope?.organizationId ||
                  remote.organizationId !== expectedScope?.organizationId)
              )
                throw accessChanged();
              if (
                !current() ||
                remote.profile?.user_id !== session.data.session.user.id
              )
                return;
              await replaceWorkspaceIfUnchanged(key, verifiedCache, remote);
              if (!current()) return;
              setWorkspace(remote);
            }
            return;
          }
          const remote = await loadRemote();
          if (
            requireRemote &&
            (remote.profile?.user_id !== expectedScope?.userId ||
              remote.profile?.organization_id !==
                expectedScope?.organizationId ||
              remote.organizationId !== expectedScope?.organizationId)
          )
            throw accessChanged();
          if (
            !current() ||
            remote.profile?.user_id !== session.data.session.user.id
          )
            return;
          await replaceWorkspaceIfUnchanged(key, undefined, remote);
          if (!current()) return;
          setWorkspace(remote);
        } else {
          setRecipientProfile(null);
          if (import.meta.env.VITE_REQUIRE_AUTH === "true") {
            setWorkspace(null);
            setNeedsLogin(true);
            return;
          }
          setNeedsLogin(false);
          const cached = await readWorkspace(LOCAL_KEY);
          if (!current()) return;
          const initial = cached ?? {
            data: emptyData(),
            revision: 0,
            pending: false,
            localOnly: true,
            organizationId: LOCAL_ORG,
            profile: null,
          };
          await replaceWorkspaceIfUnchanged(LOCAL_KEY, cached, initial);
          if (!current()) return;
          setWorkspace(initial);
        }
      } catch (e) {
        if (request !== epoch.current) {
          if (requireRemote) throw accessChanged();
          return;
        }
        setWorkspace(null);
        setRecipientProfile(null);
        setError(getErrorMessage(e, "No se pudieron cargar los datos."));
        if (requireRemote) {
          if (e instanceof WorkspaceAccessError) throw e;
          const detail = getErrorMessage(e, "");
          throw new Error(
            "No se pudo confirmar la etiqueta guardada. Conéctese y sincronice antes de imprimir." +
              (detail ? ` ${detail}` : ""),
          );
        }
      }
    },
    [],
  );
  useEffect(() => {
    const invalidate = () => {
      ++epoch.current;
    };
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleReload = () => {
      clearTimeout(reloadTimer);
      const reloadAfterCommit = () => {
        if (lock.current) {
          reloadTimer = setTimeout(reloadAfterCommit, 100);
          return;
        }
        void load();
      };
      reloadTimer = setTimeout(reloadAfterCommit, 0);
    };
    void load();
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      const nextIdentity = session?.user.id ?? null;
      if (
        nextIdentity === identity.current &&
        (event === "TOKEN_REFRESHED" ||
          event === "SIGNED_IN" ||
          event === "INITIAL_SESSION")
      )
        return;
      identity.current = nextIdentity;
      invalidate();
      setWorkspace(null);
      setRecipientProfile(null);
      setBusy(false);
      scheduleReload();
    });
    const on = () => {
        setOnline(true);
        scheduleReload();
      },
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      invalidate();
      clearTimeout(reloadTimer);
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [load]);
  const commit = async (update: (data: Data) => void) => {
    if (!workspace || lock.current)
      throw new Error("Espere a que termine la operación actual.");
    if (workspace.needsRefresh)
      throw new Error(
        "Actualice los datos con Sincronizar antes de continuar.",
      );
    lock.current = true;
    const request = epoch.current;
    setBusy(true);
    try {
      const copy = structuredClone(workspace);
      update(copy.data);
      copy.pending = !copy.localOnly;
      const key = copy.localOnly ? LOCAL_KEY : "cloud:" + copy.profile?.user_id;
      await replaceWorkspaceIfUnchanged(key, workspace, copy);
      if (request === epoch.current) setWorkspace(copy);
    } finally {
      lock.current = false;
      if (request === epoch.current) setBusy(false);
    }
  };
  const sync = useCallback(async () => {
    if (!workspace || lock.current) return;
    lock.current = true;
    const request = epoch.current;
    const current = () => request === epoch.current;
    setBusy(true);
    setError("");
    try {
      if (!online)
        throw new Error(
          "Sin conexión. Los registros siguen guardados en este dispositivo.",
        );
      const profile = await loadProfile();
      if (!current()) return;
      if (
        profile.user_id !== workspace.profile?.user_id ||
        profile.organization_id !== workspace.organizationId
      )
        throw new WorkspaceAccessError(
          "Su acceso cambió. Actualice la sesión.",
        );
      if (profile.role === "destinatario") {
        setWorkspace(null);
        setRecipientProfile(profile);
        return;
      }
      const currentWorkspace: Workspace = { ...workspace, profile };
      let expectedCache: Workspace = currentWorkspace;
      if (workspace.pending) {
        let sendWorkspace: Workspace = currentWorkspace;
        let revision: number;
        try {
          revision = await syncRemote(sendWorkspace);
        } catch (problem) {
          if (!isRevisionConflict(problem)) throw problem;
          const remote = await loadRemote();
          if (!current()) return;
          sendWorkspace = reconcileNewReceipts(currentWorkspace, remote);
          await archiveWorkspaceAndReplace(
            "cloud:" + workspace.profile?.user_id,
            currentWorkspace,
            sendWorkspace,
          );
          if (!current()) return;
          setWorkspace(sendWorkspace);
          // Retry once using the server revision; a concurrent change still
          // rejects the transaction and keeps the archived and pending copies.
          revision = await syncRemote(sendWorkspace);
        }
        const acknowledged = {
          ...sendWorkspace,
          revision,
          pending: false,
          needsRefresh: true,
        };
        await replaceWorkspaceIfUnchanged(
          "cloud:" + workspace.profile?.user_id,
          sendWorkspace,
          acknowledged,
        );
        if (!current()) return;
        setWorkspace(acknowledged);
        expectedCache = acknowledged;
      }
      const remote = await loadRemote();
      if (!current()) return;
      if (
        remote.profile?.user_id !== workspace.profile?.user_id ||
        remote.profile?.organization_id !== workspace.organizationId ||
        remote.organizationId !== workspace.organizationId
      )
        throw new WorkspaceAccessError(
          "Su acceso cambió. Actualice la sesión.",
        );
      await replaceWorkspaceIfUnchanged(
        "cloud:" + remote.profile?.user_id,
        expectedCache,
        remote,
      );
      if (!current()) return;
      setWorkspace(remote);
    } catch (e) {
      if (!current()) return;
      if (e instanceof WorkspaceAccessError) {
        setWorkspace(null);
        setRecipientProfile(null);
      }
      setError(getErrorMessage(e, "Error de sincronización."));
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }, [workspace, online]);
  useEffect(() => {
    if (
      !workspace ||
      workspace.localOnly ||
      !online ||
      (!workspace.pending && !workspace.needsRefresh)
    )
      return;
    const timer = setTimeout(() => void sync(), 1500);
    return () => clearTimeout(timer);
  }, [workspace, online, sync]);
  const useServerData = async (): Promise<boolean> => {
    if (!workspace || workspace.localOnly || lock.current) return false;
    lock.current = true;
    const request = epoch.current;
    const current = () => request === epoch.current;
    setBusy(true);
    setError("");
    try {
      if (!online)
        throw new Error(
          "Conéctese para consultar los datos guardados en el servidor.",
        );
      const remote = await loadRemote();
      if (!current()) return false;
      assertPrintRecovery(workspace, remote);
      await archiveWorkspaceAndReplace(
        "cloud:" + workspace.profile?.user_id,
        workspace,
        remote,
      );
      if (!current()) return false;
      setWorkspace(remote);
      return true;
    } catch (e) {
      if (current())
        setError(
          getErrorMessage(
            e,
            "No se pudieron actualizar los datos. Su copia local se conserva.",
          ),
        );
      return false;
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  return {
    recipientProfile,
    needsLogin,
    workspace,
    error,
    setError,
    busy,
    online,
    commit,
    sync,
    useServerData,
    reload: load,
    role: workspace?.localOnly
      ? ("administrador" as const)
      : (workspace?.profile?.role ?? "auditor"),
  };
}
