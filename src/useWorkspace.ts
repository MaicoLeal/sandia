import { useCallback, useEffect, useRef, useState } from "react";
import type { Data, Workspace, Profile } from "./types";
import { LOCAL_ORG, LOCAL_KEY, emptyData, can, base, now } from "./domain";
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
import {
  queuePalletPrint,
  flushPalletPrints,
} from "./services/pallet-print-audit";

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
  const [localBackup, setLocalBackup] = useState<Workspace | null>(null);
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
          // Account saves use a separate cache. Never replace or resend the
          // previous device workspace: its unsent records remain accessible
          // as a backup, including their files and reception drafts.
          const previousDevice = await readWorkspace(
            "cloud:" + session.data.session.user.id,
          );
          if (!current()) return;
          setLocalBackup(null);
          const key = "account:" + session.data.session.user.id;
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
            if (
              previousDevice?.pending &&
              previousDevice.organizationId === profile.organization_id
            )
              setLocalBackup(previousDevice);
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
              void flushPalletPrints(
                remote.organizationId,
                session.data.session.user.id,
              );
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
          void flushPalletPrints(
            remote.organizationId,
            session.data.session.user.id,
          );
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
  const runCloudAction = async (
    action: (fresh: Workspace) => Promise<Workspace | void>,
  ): Promise<void> => {
    if (!workspace || workspace.localOnly || lock.current)
      throw new Error("Espere a que termine la operación actual.");
    if (!online)
      throw new Error("Conéctese a internet para guardar con su cuenta.");
    const userId = workspace.profile?.user_id;
    const org = workspace.organizationId;
    if (!userId) throw new WorkspaceAccessError("Inicie sesión.");
    lock.current = true;
    const request = epoch.current;
    const assertScope = (fresh: Workspace) => {
      if (
        request !== epoch.current ||
        fresh.organizationId !== org ||
        fresh.profile?.user_id !== userId ||
        fresh.profile.organization_id !== org ||
        fresh.profile.status !== "Activo" ||
        fresh.profile.role === "destinatario"
      )
        throw new WorkspaceAccessError(
          "Su sesión o acceso cambió. Vuelva a entrar.",
        );
    };
    const key = "account:" + userId;
    setBusy(true);
    setError("");
    let saved = false;
    let displayed: Workspace | undefined;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const fresh = await loadRemote();
        assertScope(fresh);
        const cached = await readWorkspace(key);
        if (cached?.pending)
          throw new Error(
            "Hay registros pendientes en el respaldo de esta cuenta. Se conservan; actualice antes de guardar.",
          );
        await replaceWorkspaceIfUnchanged(key, cached, fresh);
        assertScope(fresh);
        const activeProfile = await loadProfile();
        assertScope({ ...fresh, profile: activeProfile });
        setWorkspace(fresh);
        displayed = fresh;
        let acknowledged: Workspace | void;
        try {
          acknowledged = await action(fresh);
        } catch (problem) {
          const code =
            typeof problem === "object" && problem !== null
              ? (problem as { code?: string }).code
              : undefined;
          const message = getErrorMessage(problem, "");
          if (
            code === "P0001" &&
            message.startsWith("Conflicto de sincronización:")
          ) {
            if (attempt === 0) continue; // The rejected transaction made no changes.
            throw new Error(
              "Otra operación terminó al mismo tiempo. Sus valores siguen en el formulario; vuelva a pulsar Guardar.",
            );
          }
          throw problem;
        }
        saved = true;
        assertScope(fresh);
        displayed = acknowledged ?? { ...fresh, needsRefresh: true };
        assertScope(displayed);
        await replaceWorkspaceIfUnchanged(key, fresh, displayed);
        setWorkspace(displayed);
        const confirmed = await loadRemote();
        assertScope(confirmed);
        await replaceWorkspaceIfUnchanged(key, displayed, confirmed);
        setWorkspace(confirmed);
        return;
      }
    } catch (problem) {
      if (problem instanceof WorkspaceAccessError || request !== epoch.current)
        throw problem;
      if (!saved) throw problem;
      // The write was confirmed. A later read/network failure must never
      // invite another submission of the same reception.
      if (displayed)
        setWorkspace({ ...displayed, pending: false, needsRefresh: true });
      setError(
        "Los cambios ya están guardados en su cuenta. Actualice la vista cuando vuelva la conexión.",
      );
    } finally {
      lock.current = false;
      if (request === epoch.current) setBusy(false);
    }
  };
  const commit = async (update: (data: Data) => void) => {
    if (!workspace || lock.current)
      throw new Error("Espere a que termine la operación actual.");
    if (!workspace.localOnly) {
      await runCloudAction(async (fresh) => {
        const copy = structuredClone(fresh);
        update(copy.data);
        const revision = await syncRemote(copy);
        return { ...copy, revision, pending: false, needsRefresh: true };
      });
      return;
    }
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
      const key = copy.localOnly
        ? LOCAL_KEY
        : "account:" + copy.profile?.user_id;
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
            "account:" + workspace.profile?.user_id,
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
          "account:" + workspace.profile?.user_id,
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
        "account:" + remote.profile?.user_id,
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
    if (!workspace || workspace.localOnly || !online) return;
    const refresh = () => {
      if (!lock.current && document.visibilityState === "visible") void sync();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [workspace, online, sync]);
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
        "account:" + workspace.profile?.user_id,
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
  const recordPalletPrint = async (id: string): Promise<void> => {
    if (!workspace) throw new WorkspaceAccessError("Inicie sesión.");
    const role = workspace.localOnly
      ? "administrador"
      : (workspace.profile?.role ?? "auditor");
    if (!can(role, "pallet"))
      throw new WorkspaceAccessError(
        "Su perfil no tiene permiso para imprimir.",
      );
    const pallet = workspace.data.pallets.find(
      (p) => p.id === id && p.organization_id === workspace.organizationId,
    );
    if (!pallet || pallet.status === "Cancelado")
      throw new Error("El pallet no está disponible para imprimir.");
    if (!workspace.localOnly) {
      // Durable audit queue only; printing never waits on Supabase or the
      // organization revision and never sends a full device snapshot.
      await queuePalletPrint(workspace, id).catch(() => undefined);
      return;
    }
    await commit((data) => {
      const current = data.pallets.find((p) => p.id === id)!;
      const before = structuredClone(current);
      if (current.status === "En armado") current.status = "Etiquetado";
      current.updated_at = now();
      data.audit_logs.push({
        ...base(workspace.organizationId),
        entity_type: "pallets",
        entity_id: id,
        action: "Solicitud de impresión de etiqueta",
        actor: "Registro local",
        before,
        after: structuredClone(current),
        reason: "",
      });
    }).catch(() => undefined);
  };
  return {
    recipientProfile,
    needsLogin,
    workspace,
    error,
    setError,
    busy,
    online,
    localBackup,
    commit,
    runCloudAction,
    recordPalletPrint,
    sync,
    useServerData,
    reload: load,
    role: workspace?.localOnly
      ? ("administrador" as const)
      : (workspace?.profile?.role ?? "auditor"),
  };
}
