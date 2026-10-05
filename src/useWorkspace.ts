import { useCallback, useEffect, useRef, useState } from "react";
import type { Data, Workspace, Profile } from "./types";
import { LOCAL_ORG, LOCAL_KEY, emptyData } from "./domain";
import {
  readWorkspace,
  saveWorkspace,
  removeLegacyDemo,
} from "./services/storage";
import {
  loadProfile,
  loadRemote,
  supabase,
  syncRemote,
  WorkspaceAccessError,
} from "./services/supabase";
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
  const load = useCallback(async () => {
    const request = ++epoch.current;
    const current = () => request === epoch.current;
    setWorkspace(null);
    setRecipientProfile(null);
    setNeedsLogin(false);
    setBusy(false);
    setError("");
    try {
      await removeLegacyDemo();
      const session = supabase ? await supabase.auth.getSession() : null;
      if (!current()) return;
      identity.current = session?.data.session?.user.id ?? null;
      if (session?.data.session) {
        setNeedsLogin(false);
        const key = "cloud:" + session.data.session.user.id;
        const cached = await readWorkspace(key);
        if (!current()) return;
        let currentProfile: Profile | null = null;
        if (navigator.onLine) {
          const profile = await loadProfile();
          if (!current()) return;
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
            await saveWorkspace(key, verifiedCache);
            if (!current()) return;
          }
          setWorkspace(verifiedCache);
          if (navigator.onLine && !cached.pending) {
            const remote = await loadRemote();
            if (
              !current() ||
              remote.profile?.user_id !== session.data.session.user.id
            )
              return;
            await saveWorkspace(key, remote);
            if (!current()) return;
            setWorkspace(remote);
          }
          return;
        }
        const remote = await loadRemote();
        if (
          !current() ||
          remote.profile?.user_id !== session.data.session.user.id
        )
          return;
        await saveWorkspace(key, remote);
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
        await saveWorkspace(LOCAL_KEY, initial);
        if (!current()) return;
        setWorkspace(initial);
      }
    } catch (e) {
      if (!current()) return;
      setWorkspace(null);
      setRecipientProfile(null);
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo abrir el almacenamiento local.",
      );
    }
  }, []);
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
      await saveWorkspace(key, copy);
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
      const currentWorkspace = { ...workspace, profile };
      if (workspace.pending) {
        const revision = await syncRemote(currentWorkspace);
        const acknowledged = {
          ...currentWorkspace,
          revision,
          pending: false,
          needsRefresh: true,
        };
        await saveWorkspace(
          "cloud:" + workspace.profile?.user_id,
          acknowledged,
        );
        if (!current()) return;
        setWorkspace(acknowledged);
      }
      const remote = await loadRemote();
      if (!current() || remote.profile?.user_id !== workspace.profile?.user_id)
        return;
      await saveWorkspace("cloud:" + remote.profile?.user_id, remote);
      if (!current()) return;
      setWorkspace(remote);
    } catch (e) {
      if (!current()) return;
      if (e instanceof WorkspaceAccessError) {
        setWorkspace(null);
        setRecipientProfile(null);
      }
      setError(e instanceof Error ? e.message : "Error de sincronización.");
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
    reload: load,
    role: workspace?.localOnly
      ? ("administrador" as const)
      : (workspace?.profile?.role ?? "auditor"),
  };
}
