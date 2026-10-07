import type { Table, Workspace } from "../types";

// Explicit recovery for the owner's confirmed opening/printing-only case.
// Never merge, retry a stale write, or change the server revision.
export function assertPrintRecovery(local: Workspace, remote: Workspace) {
  if (
    local.localOnly ||
    remote.localOnly ||
    !local.profile?.user_id ||
    local.profile.user_id !== remote.profile?.user_id ||
    local.organizationId !== remote.organizationId ||
    remote.profile?.organization_id !== local.organizationId ||
    remote.profile?.role === "destinatario" ||
    remote.pending ||
    remote.needsRefresh
  )
    throw new Error(
      "Su sesión o organización cambió. Inicie sesión nuevamente antes de actualizar los datos.",
    );
  for (const table of Object.keys(local.data) as Table[]) {
    if (table === "audit_logs") continue;
    const remoteIds = new Set(remote.data[table].map((row) => row.id));
    if (local.data[table].some((row) => !remoteIds.has(row.id)))
      throw new Error(
        "Hay registros nuevos en este dispositivo. Se conservan: solicite una conciliación antes de actualizar desde el servidor.",
      );
  }
  const remoteAuditIds = new Set(remote.data.audit_logs.map((log) => log.id));
  for (const log of local.data.audit_logs) {
    if (remoteAuditIds.has(log.id)) continue;
    const localPallet = local.data.pallets.find(
      (pallet) => pallet.id === log.entity_id,
    );
    const remotePallet = remote.data.pallets.find(
      (pallet) => pallet.id === log.entity_id,
    );
    if (
      log.action !== "Solicitud de impresión de etiqueta" ||
      log.entity_type !== "pallets" ||
      !localPallet ||
      !remotePallet ||
      localPallet.code !== remotePallet.code ||
      localPallet.token !== remotePallet.token
    )
      throw new Error(
        "Hay cambios locales que requieren revisión. Se conservan: esta actualización solo recupera datos ya guardados para imprimir.",
      );
  }
}
