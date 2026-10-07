import { createClient } from "@supabase/supabase-js";
import type {
  Data,
  Profile,
  Workspace,
  PalletTrace,
  RecipientPallet,
  RecipientAccount,
  PalletExportLabel,
  TrapInstallation,
} from "../types";
import { getFile } from "./storage";
import type { PalletCorrectionValues } from "../pallet-corrections";
import type { ReceptionManagementValues } from "../reception-management";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export class WorkspaceAccessError extends Error {}
export async function loadProfile(): Promise<Profile> {
  if (!supabase) throw new Error("Supabase no configurado.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new WorkspaceAccessError("Inicie sesión.");
  const profileResult = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();
  if (profileResult.error) {
    if (profileResult.error.code === "PGRST116")
      throw new WorkspaceAccessError(
        "Su usuario necesita un perfil y una organización asignados por el administrador.",
      );
    throw new Error(
      "No se pudo verificar su acceso. Intente nuevamente con conexión.",
    );
  }
  const profile = profileResult.data as Profile;
  if (profile.status !== "Activo")
    throw new WorkspaceAccessError(
      "Su acceso está inactivo. Consulte al administrador.",
    );
  return profile;
}
export async function loadRemote(attempt = 0): Promise<Workspace> {
  const profile = await loadProfile();
  if (profile.role === "destinatario")
    throw new WorkspaceAccessError(
      "Acceso de consulta de pallets. Abra el portal de destinatario.",
    );
  if (!supabase) throw new Error("Supabase no configurado.");
  const capabilities = await supabase.rpc("sandia_features");
  const { data: organization, error } = await supabase
    .from("organizations")
    .select("revision")
    .eq("id", profile.organization_id)
    .single();
  if (error) throw error;
  if (
    !Number.isSafeInteger(organization?.revision) ||
    organization.revision < 0
  )
    throw new Error(
      "No se pudo confirmar la versión de los datos de su cuenta.",
    );
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
  const readRows = async (table: string) => {
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
    return rows;
  };
  // These source records are read-only and never part of sync_workspace's
  // client write payload. Fetch only after the server advertises the migration.
  const [results, trapInstallations] = await Promise.all([
    Promise.all(
      tables.map(async (table) => [table, await readRows(table)] as const),
    ),
    !capabilities.error && capabilities.data?.trap_installations
      ? readRows("trap_installations")
      : Promise.resolve([]),
  ]);
  const latest = await supabase
    .from("organizations")
    .select("revision")
    .eq("id", profile.organization_id)
    .single();
  if (latest.error) throw latest.error;
  if (!Number.isSafeInteger(latest.data?.revision) || latest.data.revision < 0)
    throw new Error(
      "No se pudo confirmar la versión de los datos de su cuenta.",
    );
  if (latest.data.revision !== organization.revision) {
    if (attempt < 2) return loadRemote(attempt + 1);
    throw new Error(
      "Se están guardando nuevos datos. Actualice la vista en unos segundos.",
    );
  }
  return {
    features: capabilities.error ? {} : capabilities.data,
    data: Object.fromEntries(results) as unknown as Data,
    trapInstallations: trapInstallations as TrapInstallation[],
    revision: organization.revision,
    pending: false,
    localOnly: false,
    organizationId: profile.organization_id,
    profile,
  };
}
export async function loadRecipientPallets(): Promise<RecipientPallet[]> {
  if (!supabase) throw new Error("Supabase no configurado.");
  const { data, error } = await supabase.rpc("recipient_pallets");
  if (error) throw new Error(error.message);
  return (data ?? []) as RecipientPallet[];
}
export async function listRecipientAccounts(): Promise<RecipientAccount[]> {
  if (!supabase) throw new Error("Supabase no configurado.");
  const { data, error } = await supabase.rpc("list_recipient_accounts");
  if (error)
    throw new Error(
      error.code === "PGRST202"
        ? "Aplique la actualización SQL de destinatarios en Supabase para activar este acceso."
        : error.message,
    );
  return (data ?? []) as RecipientAccount[];
}
export async function setRecipientAccess(
  userId: string,
  email: string,
  name: string,
  palletIds: string[],
) {
  if (!supabase) throw new Error("Supabase no configurado.");
  const { error } = await supabase.rpc("set_recipient_pallet_access", {
    target_user_id: userId,
    target_email: email.trim().toLowerCase(),
    target_name: name.trim(),
    pallet_ids: palletIds,
  });
  if (error) throw new Error(error.message);
}
export async function updatePalletExportLabel(
  palletId: string,
  fields: PalletExportLabel,
  reason: string,
  revision: number,
) {
  if (!supabase) throw new Error("Supabase no configurado.");
  const { error } = await supabase.rpc("update_pallet_export_label", {
    target_pallet_id: palletId,
    export_fields: fields,
    correction_reason: reason.trim(),
    expected_revision: revision,
  });
  if (error)
    throw Object.assign(
      new Error(
        error.code === "PGRST202"
          ? "Aplique la actualización SQL de etiquetas de exportación en Supabase."
          : error.message,
      ),
      { code: error.code },
    );
}
export async function updatePalletLabelDetails(
  palletId: string,
  fields: PalletExportLabel,
  destination: string | null,
  reason: string,
  revision: number,
) {
  if (!supabase) throw new Error("Supabase no configurado.");
  const { error } = await supabase.rpc("update_pallet_label_details", {
    target_pallet_id: palletId,
    export_fields: fields,
    pallet_destination: destination?.trim() ?? null,
    correction_reason: reason.trim(),
    expected_revision: revision,
  });
  if (error)
    throw Object.assign(
      new Error(
        error.code === "PGRST202"
          ? "Aplique la actualización SQL de edición de etiquetas en Supabase y sincronice nuevamente."
          : error.message,
      ),
      { code: error.code },
    );
}
export async function revisePallet(
  palletId: string,
  values: PalletCorrectionValues,
  revision: number,
) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const common = {
    target_pallet_id: palletId,
    correction_reason: values.reason.trim(),
    expected_revision: revision,
  };
  const { error } =
    values.action === "cancel"
      ? await supabase.rpc("cancel_pallet", common)
      : await supabase.rpc("correct_pallet", {
          ...common,
          corrected_fields: {
            net_kg: values.netKg,
            gross_kg: values.grossKg,
            fruit_count: values.fruitCount,
            weighed_date: values.weighedDate,
            responsible: values.responsible.trim(),
            notes: values.notes,
            ...(values.tareKg !== undefined ? { tare_kg: values.tareKg } : {}),
          },
        });
  if (error)
    throw new Error(
      ["PGRST202", "42883"].includes(error.code)
        ? "El administrador debe activar la actualización de correcciones de pallets en Supabase y sincronizar nuevamente."
        : error.message,
    );
}
export async function reviseReception(
  receptionId: string,
  values: ReceptionManagementValues,
  revision: number,
) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const common = {
    target_reception_id: receptionId,
    correction_reason: values.reason.trim(),
    expected_revision: revision,
  };
  const { error } =
    values.action === "cancel"
      ? await supabase.rpc("cancel_reception", {
          ...common,
          cancel_linked_pallets: values.confirmPallets,
        })
      : await supabase.rpc("correct_reception", {
          ...common,
          corrected_fields: {
            date: values.date,
            responsible: values.responsible.trim(),
            notes: values.notes,
            weights: values.weights,
            classification: values.classification,
          },
        });
  if (error)
    throw Object.assign(
      new Error(
        ["PGRST202", "42883"].includes(error.code)
          ? "El administrador debe activar la actualización de gestión de recepciones en Supabase y sincronizar nuevamente."
          : error.message,
      ),
      { code: error.code },
    );
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
  const profile = await loadProfile();
  if (
    profile.user_id !== workspace.profile?.user_id ||
    profile.organization_id !== workspace.organizationId ||
    profile.role === "destinatario"
  )
    throw new WorkspaceAccessError(
      "Su sesión o acceso cambió. Los registros locales se conservan; vuelva a entrar antes de sincronizar.",
    );
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
  const session = await supabase.auth.getSession();
  if (session.data.session) {
    const privateResult = await supabase.rpc("private_pallet_trace", {
      trace_token: token,
    });
    if (privateResult.error) throw privateResult.error;
    if (privateResult.data) return privateResult.data as PalletTrace;
  }
  const { data, error } = await supabase.rpc("public_pallet_trace", {
    trace_token: token,
  });
  if (error) throw error;
  return data ? ({ ...data, origins: [] } as PalletTrace) : null;
}
