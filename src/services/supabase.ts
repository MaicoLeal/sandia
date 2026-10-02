import { createClient } from "@supabase/supabase-js";
import type { Data, Profile, Workspace } from "../types";
import { getFile } from "./storage";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export async function loadRemote(): Promise<Workspace> {
  if (!supabase) throw new Error("Supabase no configurado.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Inicie sesión.");
  const profileResult = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();
  if (profileResult.error)
    throw new Error(
      "Su usuario necesita un perfil y una organización asignados por el administrador.",
    );
  const profile = profileResult.data as Profile;
  const { data: organization, error } = await supabase
    .from("organizations")
    .select("revision")
    .eq("id", profile.organization_id)
    .single();
  if (error) throw error;
  const tables = [
    "producers",
    "farms",
    "plots",
    "field_lots",
    "receptions",
    "reception_weights",
    "classifications",
    "pallets",
    "pallet_items",
    "shipments",
    "shipment_pallets",
    "attachments",
    "audit_logs",
  ] as const;
  const results = await Promise.all(
    tables.map(async (table) => {
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += 500) {
        const response = await supabase!
          .from(table)
          .select("*")
          .eq("organization_id", profile.organization_id)
          .order("id")
          .range(offset, offset + 499);
        if (response.error) throw response.error;
        rows.push(...response.data);
        if (response.data.length < 500) break;
      }
      return [table, rows] as const;
    }),
  );
  const latest = await supabase
    .from("organizations")
    .select("revision")
    .eq("id", profile.organization_id)
    .single();
  if (latest.error) throw latest.error;
  if (latest.data.revision !== organization.revision)
    throw new Error(
      "Los datos cambiaron durante la consulta. Sincronice nuevamente.",
    );
  return {
    data: Object.fromEntries(results) as unknown as Data,
    revision: organization.revision,
    pending: false,
    localOnly: false,
    organizationId: profile.organization_id,
    profile,
  };
}
export async function syncRemote(workspace: Workspace) {
  if (!supabase || workspace.localOnly)
    throw new Error("Inicie sesión para sincronizar los datos con Supabase.");
  for (const attachment of workspace.data.attachments) {
    const file = await getFile(attachment.id);
    if (file) {
      const { error } = await supabase.storage
        .from("attachments")
        .upload(attachment.storage_path, file, {
          upsert: false,
          contentType: attachment.mime,
        });
      if (error && !error.message.includes("already exists")) throw error;
    }
  }
  const { data, error } = await supabase.rpc("sync_workspace", {
    payload: workspace.data,
    expected_revision: workspace.revision,
  });
  if (error) throw error;
  return Number(data);
}
export async function publicTrace(token: string) {
  if (!supabase)
    throw new Error(
      "Consulta pública disponible cuando Supabase esté configurado.",
    );
  const { data, error } = await supabase.rpc("public_pallet_trace", {
    trace_token: token,
  });
  if (error) throw error;
  return data as {
    code: string;
    product: string;
    net_kg: number;
    destination: string;
    status: string;
  } | null;
}
