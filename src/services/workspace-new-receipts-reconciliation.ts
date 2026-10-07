import type { AuditLog, Base, Data, Table, Workspace } from "../types";

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
] as const;
type OperationalTable = (typeof tables)[number];
type Row = Data[OperationalTable][number];
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const printAction = "Solicitud de impresión de etiqueta";
const creationActions: Partial<Record<OperationalTable, string>> = {
  producers: "Productor creado",
  plots: "Parcela creada",
  field_lots: "Lote creado",
  receptions: "Recepción creada",
  reception_weights: "Pesaje registrado",
  classifications: "Clasificación registrada",
  pallets: "Pallet creado",
  attachments: "Adjunto agregado",
};
const baseKeys = ["id", "organization_id", "status"];
const fields: Record<OperationalTable, string[]> = {
  producers: [
    "name",
    "document",
    "phone",
    "community",
    "address",
    "notes",
    "metadata",
  ],
  farms: ["producer_id", "name", "location"],
  plots: [
    "farm_id",
    "name",
    "location",
    "area_ha",
    "crop",
    "variety",
    "planting_date",
    "harvest_date",
    "notes",
  ],
  field_lots: [
    "plot_id",
    "producer_id",
    "code",
    "crop",
    "variety",
    "harvest_date",
    "notes",
  ],
  receptions: ["lot_id", "date", "responsible", "notes"],
  reception_weights: [
    "reception_id",
    "sequence",
    "kg",
    "operator",
    "notes",
    "correction_reason",
  ],
  classifications: [
    "reception_id",
    "approved_kg",
    "rejected_kg",
    "approved_count",
    "rejected_count",
    "reason",
    "size",
    "quality",
    "notes",
    "region",
    "pest_observation",
    "symptoms",
  ],
  pallets: [
    "code",
    "token",
    "destination",
    "assembled_at",
    "weighed_date",
    "responsible",
    "gross_kg",
    "tare_kg",
    "net_kg",
    "fruit_count",
    "notes",
    "metadata",
  ],
  pallet_items: ["pallet_id", "reception_id", "kg"],
  shipments: [
    "destination",
    "country",
    "customer",
    "carrier",
    "driver",
    "plate",
    "departure",
    "responsible",
    "notes",
  ],
  shipment_pallets: ["shipment_id", "pallet_id"],
  attachments: [
    "entity_type",
    "entity_id",
    "name",
    "mime",
    "size",
    "storage_path",
  ],
};

function fail(detail: string): never {
  throw new Error(
    `${detail} Se conservan los registros locales; solicite una conciliación al gestor.`,
  );
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function canonical(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(canonical);
  const record = object(value);
  return record
    ? Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, canonical(record[key])]),
      )
    : value;
}
function matches(
  table: OperationalTable,
  row: Row,
  snapshot: unknown,
  omitted: string[] = [],
): boolean {
  const other = object(snapshot);
  if (!other) return false;
  const current = row as unknown as Record<string, unknown>;
  return [...baseKeys, ...fields[table]]
    .filter((key) => !omitted.includes(key))
    .every((key) => {
      let a = current[key],
        b = other[key];
      if (
        ["assembled_at", "departure"].includes(key) &&
        typeof a === "string" &&
        typeof b === "string"
      ) {
        a = new Date(a).getTime();
        b = new Date(b).getTime();
      }
      return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
    });
}
function cents(value: number, allowZero = false): number {
  if (
    !Number.isFinite(value) ||
    value < (allowZero ? 0 : 0.01) ||
    value > 999999999999.99 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 0.001
  )
    fail("Hay un peso inválido o con más de dos decimales.");
  return Math.round(value * 100);
}
function sameMoney(a: number, b: number) {
  return cents(a, true) === cents(b, true);
}
function closed(status: string) {
  return ["Cancelado", "Expedido", "Rechazado"].includes(status);
}

/**
 * Rebase only audited additions, never edits, onto a freshly read server snapshot.
 * A caller must archive the original cache atomically before persisting this result,
 * then submit once using remote.revision. The server remains the final authority.
 */
export function reconcileNewReceipts(
  local: Workspace,
  remote: Workspace,
): Workspace {
  const user = local.profile?.user_id,
    org = local.organizationId;
  if (
    !local.pending ||
    local.localOnly ||
    remote.localOnly ||
    local.needsRefresh ||
    remote.pending ||
    remote.needsRefresh ||
    !user ||
    user !== remote.profile?.user_id ||
    org !== remote.organizationId ||
    local.profile?.organization_id !== org ||
    remote.profile?.organization_id !== org ||
    remote.profile?.status !== "Activo" ||
    !["administrador", "gestor", "recepcion", "pesaje", "packing"].includes(
      remote.profile.role,
    ) ||
    !Number.isSafeInteger(remote.revision) ||
    remote.revision < local.revision
  )
    fail(
      "La sesión, organización o revisión no permite recuperar estos recibimientos.",
    );

  const newRows = {} as Record<OperationalTable, Row[]>;
  const remoteIds = {} as Record<OperationalTable, Set<string>>;
  for (const table of [...tables, "audit_logs"] as Table[]) {
    for (const workspace of [local, remote]) {
      const rows = workspace.data[table];
      if (
        !Array.isArray(rows) ||
        rows.some((row) => !uuid.test(row.id) || row.organization_id !== org) ||
        new Set(rows.map((row) => row.id)).size !== rows.length
      )
        fail("Hay identificadores repetidos o registros de otra organización.");
    }
    if (table === "audit_logs") continue;
    remoteIds[table] = new Set(remote.data[table].map((row) => row.id));
    newRows[table] = local.data[table].filter(
      (row) => !remoteIds[table].has(row.id),
    );
  }
  if (newRows.shipments.length || newRows.shipment_pallets.length)
    fail("Hay expediciones nuevas que requieren revisión separada.");
  const remoteAuditIds = new Set(remote.data.audit_logs.map((log) => log.id));
  const pendingLogs = local.data.audit_logs.filter(
    (log) => !remoteAuditIds.has(log.id),
  );
  const creation = new Map<string, AuditLog>();
  const printIds = new Set<string>();
  for (const log of pendingLogs) {
    if (log.created_by !== user || !uuid.test(log.entity_id))
      fail("Una acción pendiente no pertenece a la sesión actual.");
    if (log.action === printAction && log.entity_type === "pallets") {
      const a = local.data.pallets.find((p) => p.id === log.entity_id);
      const b =
        remote.data.pallets.find((p) => p.id === log.entity_id) ??
        newRows.pallets.find((p) => p.id === log.entity_id);
      if (
        !a ||
        !b ||
        !("code" in b) ||
        !("token" in b) ||
        a.code !== b.code ||
        a.token !== b.token ||
        ["Cancelado", "Expedido"].includes(b.status) ||
        remote.data.shipment_pallets.some((link) => link.pallet_id === b.id)
      )
        fail(
          "Una impresión pendiente corresponde a un pallet cambiado o cerrado.",
        );
      printIds.add(log.entity_id);
    }
  }
  for (const log of pendingLogs) {
    if (log.action === printAction && log.entity_type === "pallets") continue;
    const table = log.entity_type as OperationalTable;
    if (
      !tables.includes(table) ||
      creationActions[table] !== log.action ||
      log.before !== null
    )
      fail(
        "Hay correcciones o acciones locales que requieren revisión separada.",
      );
    const row = local.data[table].find((value) => value.id === log.entity_id);
    const after = object(log.after);
    if (
      !row ||
      !after ||
      (table !== "attachments" &&
        !matches(
          table,
          row,
          after,
          table === "field_lots"
            ? ["status"]
            : table === "pallets" && printIds.has(row.id)
              ? ["status"]
              : [],
        )) ||
      (table === "attachments" &&
        after.name !== (row as Data["attachments"][number]).name)
    )
      fail("No se pudo comprobar un registro con su historial de creación.");
    const key = `${table}:${row.id}`;
    if (creation.has(key))
      fail("Hay más de una creación para el mismo registro.");
    creation.set(key, log);
  }
  const proof = (table: OperationalTable, id: string) => {
    const log = creation.get(`${table}:${id}`);
    if (!log) fail("Falta el historial de creación de un registro nuevo.");
    return log;
  };
  for (const table of tables) {
    const permittedRoles = [
      "producers",
      "farms",
      "plots",
      "receptions",
    ].includes(table)
      ? ["administrador", "gestor", "recepcion"]
      : table === "reception_weights"
        ? ["administrador", "gestor", "recepcion", "pesaje"]
        : table === "classifications"
          ? ["administrador", "gestor", "packing", "recepcion"]
          : ["pallets", "pallet_items"].includes(table)
            ? ["administrador", "gestor", "packing"]
            : ["administrador", "gestor", "recepcion", "pesaje", "packing"];
    if (newRows[table].length && !permittedRoles.includes(remote.profile!.role))
      fail("Su perfil actual no puede guardar algunos registros pendientes.");
    for (const row of newRows[table]) {
      if (
        row.created_by !== user ||
        (closed(row.status) &&
          !(table === "field_lots" && row.status === "Rechazado"))
      )
        fail("Un registro nuevo está cerrado o pertenece a otro usuario.");
      if (!["farms", "reception_weights", "pallet_items"].includes(table))
        proof(table, row.id);
    }
  }

  const result = structuredClone(remote);
  for (const table of tables)
    (result.data[table] as Base[]).push(...structuredClone(newRows[table]));
  const data = result.data;
  const newIds = (table: OperationalTable) =>
    new Set(newRows[table].map((row) => row.id));
  const newReceipts = newIds("receptions"),
    newPallets = newIds("pallets");
  const parent = <T extends Row>(rows: T[], id: string): T => {
    const found = rows.find((row) => row.id === id);
    if (
      !found ||
      found.status === "Inactivo" ||
      (closed(found.status) &&
        !(found.status === "Rechazado" && newIds("field_lots").has(id)))
    )
      fail("Un registro nuevo tiene un origen ausente o cerrado.");
    return found;
  };
  for (const farm of newRows.farms as Data["farms"]) {
    parent(data.producers, farm.producer_id);
    if (
      !(newRows.plots as Data["plots"]).some(
        (plot) => plot.farm_id === farm.id && creation.has(`plots:${plot.id}`),
      )
    )
      fail("Una propiedad nueva no tiene parcela con historial de creación.");
  }
  for (const plot of newRows.plots as Data["plots"])
    parent(data.farms, plot.farm_id);
  for (const lot of newRows.field_lots as Data["field_lots"]) {
    const farm = lot.plot_id
      ? parent(data.farms, parent(data.plots, lot.plot_id).farm_id)
      : null;
    const producer = parent(
      data.producers,
      lot.producer_id ?? farm?.producer_id ?? "",
    );
    if (farm && farm.producer_id !== producer.id)
      fail("La parcela y el productor del lote no coinciden.");
    if (
      !lot.code.trim() ||
      lot.code.length > 80 ||
      data.field_lots.some(
        (other) => other.id !== lot.id && other.code.trim() === lot.code.trim(),
      )
    )
      fail("El código de un lote nuevo ya existe o es inválido.");
  }
  for (const reception of newRows.receptions as Data["receptions"]) {
    const lot = parent(data.field_lots, reception.lot_id);
    const farm = lot.plot_id
      ? parent(data.farms, parent(data.plots, lot.plot_id).farm_id)
      : null;
    parent(data.producers, farm?.producer_id ?? lot.producer_id ?? "");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(reception.date) ||
      !reception.responsible.trim()
    )
      fail("Una recepción nueva no tiene fecha o responsable válidos.");
    const weights = data.reception_weights.filter(
      (w) => w.reception_id === reception.id,
    );
    if (
      !weights.length ||
      new Set(weights.map((w) => w.sequence)).size !== weights.length ||
      weights.some(
        (w) =>
          !Number.isInteger(w.sequence) ||
          w.sequence < 1 ||
          !w.operator.trim() ||
          w.status !== "Activo" ||
          w.correction_reason.trim(),
      )
    )
      fail("Los pesajes nuevos no tienen una secuencia e historial válidos.");
    const initialTotal = weights
      .filter((w) => !creation.has(`reception_weights:${w.id}`))
      .reduce((sum, w) => sum + cents(w.kg), 0);
    const receiptLog = object(proof("receptions", reception.id).after)!;
    if (
      typeof receiptLog.total_kg !== "number" ||
      cents(receiptLog.total_kg) !== initialTotal
    )
      fail("La suma de los pesajes no coincide con la recepción original.");
    for (const weight of weights)
      if (creation.has(`reception_weights:${weight.id}`)) cents(weight.kg);
  }
  for (const weight of newRows.reception_weights as Data["reception_weights"]) {
    if (!newReceipts.has(weight.reception_id))
      fail(
        "Hay pesajes añadidos a una recepción anterior; requieren revisión.",
      );
    parent(data.receptions, weight.reception_id);
  }
  for (const classification of newRows.classifications as Data["classifications"]) {
    if (!newReceipts.has(classification.reception_id))
      fail("Una clasificación nueva modifica una recepción anterior.");
    const receipt = parent(data.receptions, classification.reception_id);
    const total = data.reception_weights
      .filter((w) => w.reception_id === receipt.id)
      .reduce((sum, w) => sum + cents(w.kg), 0);
    if (
      cents(classification.approved_kg, true) +
        cents(classification.rejected_kg, true) !==
        total ||
      (classification.rejected_kg > 0 && !classification.reason.trim()) ||
      data.classifications.some(
        (other) =>
          other.id !== classification.id &&
          other.reception_id === receipt.id &&
          other.status !== "Cancelado",
      )
    )
      fail(
        "Las pérdidas o la clasificación no coinciden con los pesajes nuevos.",
      );
  }
  for (const lot of newRows.field_lots as Data["field_lots"]) {
    if (lot.status !== "Rechazado") continue;
    const receipts = data.receptions.filter((r) => r.lot_id === lot.id);
    if (
      !receipts.length ||
      receipts.some(
        (r) =>
          !newReceipts.has(r.id) ||
          !data.classifications.some(
            (c) =>
              c.reception_id === r.id &&
              c.status !== "Cancelado" &&
              c.approved_kg === 0,
          ),
      )
    )
      fail("Un lote nuevo rechazado no tiene pérdidas completas comprobadas.");
  }
  for (const item of newRows.pallet_items as Data["pallet_items"]) {
    if (!newPallets.has(item.pallet_id) || !newReceipts.has(item.reception_id))
      fail(
        "Un pallet nuevo utiliza datos anteriores o vínculos sin historial.",
      );
    parent(data.pallets, item.pallet_id);
    parent(data.receptions, item.reception_id);
    cents(item.kg);
    if (
      data.pallet_items.some(
        (other) =>
          other.id !== item.id &&
          other.pallet_id === item.pallet_id &&
          other.reception_id === item.reception_id,
      )
    )
      fail("Un pallet tiene un origen repetido.");
  }
  for (const pallet of newRows.pallets as Data["pallets"]) {
    const items = data.pallet_items.filter(
      (item) => item.pallet_id === pallet.id,
    );
    if (
      !items.length ||
      !uuid.test(pallet.token) ||
      !Number.isFinite(new Date(pallet.assembled_at).getTime()) ||
      !pallet.destination.trim() ||
      !pallet.responsible.trim() ||
      cents(pallet.net_kg) !==
        items.reduce((sum, item) => sum + cents(item.kg), 0) ||
      data.pallets.some(
        (other) =>
          other.id !== pallet.id &&
          (other.code === pallet.code || other.token === pallet.token),
      ) ||
      (pallet.tare_kg !== undefined && pallet.tare_kg !== 42) ||
      (pallet.gross_kg !== null &&
        !sameMoney(pallet.gross_kg, pallet.net_kg + 42))
    )
      fail("El peso, tara, código o QR de un pallet nuevo no es coherente.");
  }
  for (const receiptId of newReceipts) {
    const approved =
      data.classifications.find(
        (c) => c.reception_id === receiptId && c.status !== "Cancelado",
      )?.approved_kg ?? 0;
    const allocated = data.pallet_items
      .filter(
        (item) =>
          item.reception_id === receiptId &&
          data.pallets.find((p) => p.id === item.pallet_id)?.status !==
            "Cancelado",
      )
      .reduce((sum, item) => sum + cents(item.kg), 0);
    if (allocated > cents(approved, true))
      fail("El peso palletizado supera el aprobado de la recepción.");
  }
  for (const attachment of newRows.attachments as Data["attachments"]) {
    if (
      attachment.entity_type !== "receptions" ||
      !newReceipts.has(attachment.entity_id) ||
      !attachment.storage_path.startsWith(`${org}/${attachment.id}/`) ||
      !attachment.name.trim() ||
      !Number.isSafeInteger(attachment.size) ||
      attachment.size <= 0 ||
      attachment.size > 10485760 ||
      attachment.storage_path
        .split("/")
        .some((segment) => [".", ".."].includes(segment))
    )
      fail("Un adjunto nuevo no tiene una recepción o ruta válida.");
  }

  // Without a saved base, only an authoritative server audit can prove that an
  // existing local row is an old snapshot rather than an unrecorded local edit.
  const relatedLots = new Set(
    (newRows.receptions as Data["receptions"]).map((r) => r.lot_id),
  );
  for (const table of tables) {
    for (const row of local.data[table]) {
      const current = remote.data[table].find((value) => value.id === row.id);
      if (!current) continue;
      const omitted =
        table === "field_lots" && relatedLots.has(row.id)
          ? ["status"]
          : table === "pallets" && printIds.has(row.id)
            ? ["status"]
            : [];
      if (matches(table, row, current, omitted)) continue;
      if (
        !remote.data.audit_logs.some(
          (log) =>
            log.entity_type === table &&
            log.entity_id === row.id &&
            ["Creación · " + table, "Actualización · " + table].includes(
              log.action,
            ) &&
            (matches(table, row, log.before, omitted) ||
              matches(table, row, log.after, omitted)),
        )
      )
        fail(
          "Hay diferencias en datos existentes sin una base comprobable en el historial del servidor.",
        );
    }
  }
  // Creation intents document the appended rows; operational audit records will
  // be generated by the RPC's real triggers. Printing is retained only as intent.
  data.audit_logs.push(...structuredClone(pendingLogs));
  result.pending = true;
  result.needsRefresh = false;
  return result;
}
