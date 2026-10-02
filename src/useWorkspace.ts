import { useCallback, useEffect, useRef, useState } from "react";
import type { Data, Workspace } from "./types";
import { LOCAL_ORG, LOCAL_KEY, emptyData } from "./domain";
import {
  readWorkspace,
  saveWorkspace,
  removeLegacyDemo,
} from "./services/storage";
import { loadRemote, supabase, syncRemote } from "./services/supabase";
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const lock = useRef(false);
  const load = useCallback(async () => {
    try {
      await removeLegacyDemo();
      const session = supabase ? await supabase.auth.getSession() : null;
      if (session?.data.session) {
        const key = "cloud:" + session.data.session.user.id;
        const cached = await readWorkspace(key);
        if (cached) {
          setWorkspace(cached);
          if (navigator.onLine && !cached.pending) {
            const remote = await loadRemote();
            await saveWorkspace(key, remote);
            setWorkspace(remote);
          }
          return;
        }
        const remote = await loadRemote();
        await saveWorkspace(key, remote);
        setWorkspace(remote);
      } else {
        const cached = await readWorkspace(LOCAL_KEY);
        const initial = cached ?? {
          data: emptyData(),
          revision: 0,
          pending: false,
          localOnly: true,
          organizationId: LOCAL_ORG,
          profile: null,
        };
        await saveWorkspace(LOCAL_KEY, initial);
        setWorkspace(initial);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo abrir el almacenamiento local.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
    const subscription = supabase?.auth.onAuthStateChange(() => {
      setTimeout(() => void load(), 0);
    });
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
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
    setBusy(true);
    try {
      const copy = structuredClone(workspace);
      update(copy.data);
      copy.pending = !copy.localOnly;
      const key = copy.localOnly ? LOCAL_KEY : "cloud:" + copy.profile?.user_id;
      await saveWorkspace(key, copy);
      setWorkspace(copy);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const sync = useCallback(async () => {
    if (!workspace || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!online)
        throw new Error(
          "Sin conexión. Los registros siguen guardados en este dispositivo.",
        );
      if (workspace.pending) {
        const revision = await syncRemote(workspace);
        const acknowledged = {
          ...workspace,
          revision,
          pending: false,
          needsRefresh: true,
        };
        await saveWorkspace(
          "cloud:" + workspace.profile?.user_id,
          acknowledged,
        );
        setWorkspace(acknowledged);
      }
      const remote = await loadRemote();
      await saveWorkspace("cloud:" + remote.profile?.user_id, remote);
      setWorkspace(remote);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de sincronización.");
    } finally {
      lock.current = false;
      setBusy(false);
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
    workspace,
    error,
    setError,
    busy,
    online,
    commit,
    sync,
    role: workspace?.localOnly
      ? ("administrador" as const)
      : (workspace?.profile?.role ?? "auditor"),
  };
}
