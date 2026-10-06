import { base, now, round } from "./domain";
import type { Data, Reception, Table } from "./types";

export interface ReceptionManagedWeight {
  id: string;
  kg: number;
  operator: string;
  notes: string;
}

export type ReceptionManagementValues =
  | {
      action: "edit";
      date: string;
      responsible: string;
      notes: string;
      weights: ReceptionManagedWeight[];
      classification: {
        id: string;
        rejected_kg: number;
        reason: string;
      } | null;
      reason: string;
    }
  | { action: "cancel"; reason: string; confirmPallets: boolean };

export interface ReceptionManagementDraft {
  date: string;
  responsible: string;
  notes: string;
  weights: { id: string; kg: string; operator: string; notes: string }[];
  rejectedKg: string;
  lossReason: string;
  reason: string;
}

export function receptionManagementImpact(data: Data, reception: Reception) {
  const activeWeights = data.reception_weights
    .filter(
      (weight) =>
        weight.reception_id === reception.id && weight.status !== "Cancelado",
    )
    .sort((a, b) => a.sequence - b.sequence);
  const classifications = data.classifications.filter(
    (classification) =>
      classification.reception_id === reception.id &&
      classification.status !== "Cancelado",
  );
  const sourceItems = data.pallet_items.filter(
    (item) =>
      item.reception_id === reception.id &&
      data.pallets.some(
        (pallet) =>
          pallet.id === item.pallet_id && pallet.status !== "Cancelado",
      ),
  );
  const palletIds = new Set(sourceItems.map((item) => item.pallet_id));
  const pallets = data.pallets.filter((pallet) => palletIds.has(pallet.id));
  const allocatedKg = round(
    sourceItems.reduce((total, item) => total + item.kg, 0),
  );
  const closed =
    pallets.some((pallet) => pallet.status === "Expedido") ||
    data.shipment_pallets.some((link) => palletIds.has(link.pallet_id));
  const mixed = pallets.some((pallet) =>
    data.pallet_items.some(
      (item) =>
        item.pallet_id === pallet.id && item.reception_id !== reception.id,
    ),
  );
  const editBlockedReason =
    reception.status === "Cancelado"
      ? "Esta recepción ya está cancelada. Su historial se conserva."
      : reception.status === "Expedido" || closed
        ? "La recepción tiene pallets expedidos o vinculados a una carga. Revise la expedición antes de corregir o cancelar."
        : classifications.length > 1
          ? "Hay varias clasificaciones activas. Revise la selección antes de corregir esta recepción."
          : "";
  return {
    activeWeights,
    classifications,
    pallets,
    allocatedKg,
    editBlockedReason,
    cancelBlockedReason:
      editBlockedReason ||
      (mixed
        ? "Un pallet reúne esta recepción con otras recepciones. Revise y cancele ese pallet primero para conservar los demás orígenes."
        : ""),
  };
}

function decimalKg(input: string, zeroAllowed = false) {
  const text = input.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text))
    throw new Error(
      "Ingrese kg con hasta dos decimales; puede usar coma o punto.",
    );
  const value = Number(text.replace(",", "."));
  if (
    !Number.isFinite(value) ||
    value > 999999999999.99 ||
    (zeroAllowed ? value < 0 : value <= 0)
  )
    throw new Error(
      zeroAllowed
        ? "Ingrese una pérdida válida, desde cero kg."
        : "Cada pesaje debe ser mayor que cero kg.",
    );
  return round(value);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function assertReceptionManagement(
  data: Data,
  reception: Reception,
  values: ReceptionManagementValues,
) {
  const current = data.receptions.find(
    (candidate) =>
      candidate.id === reception.id &&
      candidate.organization_id === reception.organization_id,
  );
  if (!current)
    throw new Error("La recepción ya no está disponible. Actualice los datos.");
  const impact = receptionManagementImpact(data, current);
  const blocked =
    values.action === "cancel"
      ? impact.cancelBlockedReason
      : impact.editBlockedReason;
  if (blocked) throw new Error(blocked);
  if (!values.reason.trim() || values.reason.trim().length > 1000)
    throw new Error("Indique un motivo, con hasta 1.000 caracteres.");
  if (values.action === "cancel") {
    if (impact.pallets.length && !values.confirmPallets)
      throw new Error(
        "Confirme también la cancelación de los pallets de esta recepción.",
      );
    return;
  }
  if (!validDate(values.date))
    throw new Error("Ingrese una fecha de recepción válida.");
  if (!values.responsible.trim() || values.responsible.trim().length > 200)
    throw new Error("Indique el responsable, con hasta 200 caracteres.");
  if (values.notes.length > 5000)
    throw new Error("Las observaciones deben tener hasta 5.000 caracteres.");
  if (!values.weights.length)
    throw new Error(
      "Conserve al menos un pesaje. Para quitar toda la recepción, use Cancelar recepción.",
    );
  if (values.weights.length > 1000)
    throw new Error("Una recepción puede contener hasta 1.000 pesajes.");
  const ids = new Set<string>();
  for (const weight of values.weights) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        weight.id,
      ) ||
      ids.has(weight.id)
    )
      throw new Error(
        "Los pesajes deben tener identificadores únicos válidos.",
      );
    ids.add(weight.id);
    const stored = data.reception_weights.find((row) => row.id === weight.id);
    if (
      stored &&
      (stored.reception_id !== current.id ||
        stored.organization_id !== current.organization_id ||
        stored.status !== "Activo")
    )
      throw new Error(
        "No se puede reutilizar un pesaje de otra recepción o ya cancelado.",
      );
    if (
      !Number.isFinite(weight.kg) ||
      weight.kg <= 0 ||
      weight.kg > 999999999999.99 ||
      round(weight.kg) !== weight.kg
    )
      throw new Error(
        "Cada pesaje debe tener un peso positivo, con hasta dos decimales.",
      );
    if (
      !weight.operator.trim() ||
      weight.operator.trim().length > 200 ||
      weight.notes.length > 5000
    )
      throw new Error("Revise el operador y las observaciones de los pesajes.");
  }
  const classification = impact.classifications[0];
  if (!classification && impact.allocatedKg > 0)
    throw new Error(
      "El origen de los pallets necesita una clasificación activa. Revise la selección antes de corregir.",
    );
  if ((classification?.id ?? null) !== (values.classification?.id ?? null))
    throw new Error(
      "La clasificación cambió. Actualice y abra nuevamente la recepción.",
    );
  const total = round(
    values.weights.reduce((sum, weight) => sum + weight.kg, 0),
  );
  if (total > 999999999999.99)
    throw new Error("El total recibido supera el límite admitido en kg.");
  const rejected = values.classification?.rejected_kg ?? 0;
  if (
    !Number.isFinite(rejected) ||
    rejected < 0 ||
    rejected > total ||
    round(rejected) !== rejected
  )
    throw new Error("Las pérdidas deben estar entre cero y el total recibido.");
  if (
    values.classification &&
    (values.classification.reason.length > 1000 ||
      (rejected > 0 && !values.classification.reason.trim()))
  )
    throw new Error("Indique el motivo de las pérdidas registradas.");
  if (round(total - rejected) < impact.allocatedKg)
    throw new Error(
      "El peso aprobado quedaría por debajo de lo ya palletizado. Corrija o cancele los pallets correspondientes primero.",
    );
}

export function parseReceptionManagement(
  data: Data,
  reception: Reception,
  draft: ReceptionManagementDraft,
): Extract<ReceptionManagementValues, { action: "edit" }> {
  const classification = receptionManagementImpact(data, reception)
    .classifications[0];
  const values: Extract<ReceptionManagementValues, { action: "edit" }> = {
    action: "edit",
    date: draft.date,
    responsible: draft.responsible.trim(),
    notes: draft.notes.trim(),
    weights: draft.weights.map((weight) => ({
      ...weight,
      kg: decimalKg(weight.kg),
      operator: weight.operator.trim(),
      notes: weight.notes.trim(),
    })),
    classification: classification
      ? {
          id: classification.id,
          rejected_kg: decimalKg(draft.rejectedKg, true),
          reason: draft.lossReason.trim(),
        }
      : null,
    reason: draft.reason.trim(),
  };
  assertReceptionManagement(data, reception, values);
  return values;
}

type ReceptionManagementRecord = (
  data: Data,
  table: Table,
  id: string,
  action: string,
  before: unknown,
  after: unknown,
  reason: string,
) => void;

/** Local transactions follow the same logical cancellation and balance rules as the RPC. */
export function applyReceptionManagement(
  data: Data,
  receptionId: string,
  values: ReceptionManagementValues,
  record: ReceptionManagementRecord,
  user: string | null = null,
) {
  const reception = data.receptions.find((row) => row.id === receptionId);
  if (!reception) throw new Error("La recepción ya no está disponible.");
  assertReceptionManagement(data, reception, values);
  const impact = receptionManagementImpact(data, reception);
  const timestamp = now();
  const receptionBefore = structuredClone(reception);
  if (values.action === "cancel") {
    for (const [table, rows] of [
      ["reception_weights", impact.activeWeights],
      ["classifications", impact.classifications],
      ["pallets", impact.pallets],
    ] as const) {
      for (const row of rows) {
        const before = structuredClone(row);
        row.status = "Cancelado";
        row.updated_at = timestamp;
        if (table === "reception_weights" && "correction_reason" in row)
          row.correction_reason = values.reason;
        record(
          data,
          table,
          row.id,
          "Cancelado con la recepción",
          before,
          structuredClone(row),
          values.reason,
        );
      }
    }
    reception.status = "Cancelado";
  } else {
    const selectedIds = new Set(values.weights.map((weight) => weight.id));
    let sequence = Math.max(
      0,
      ...data.reception_weights
        .filter((weight) => weight.reception_id === receptionId)
        .map((weight) => weight.sequence),
    );
    for (const weight of impact.activeWeights) {
      const next = values.weights.find((row) => row.id === weight.id);
      if (
        next &&
        weight.kg === next.kg &&
        weight.operator === next.operator &&
        weight.notes === next.notes
      )
        continue;
      const before = structuredClone(weight);
      if (selectedIds.has(weight.id) && next) {
        weight.kg = next.kg;
        weight.operator = next.operator;
        weight.notes = next.notes;
      } else weight.status = "Cancelado";
      weight.correction_reason = values.reason;
      weight.updated_at = timestamp;
      record(
        data,
        "reception_weights",
        weight.id,
        next ? "Pesaje corregido" : "Pesaje cancelado",
        before,
        structuredClone(weight),
        values.reason,
      );
    }
    for (const next of values.weights) {
      if (impact.activeWeights.some((weight) => weight.id === next.id))
        continue;
      const weight = {
        ...base(reception.organization_id, "Activo", user),
        ...next,
        reception_id: receptionId,
        sequence: ++sequence,
        correction_reason: values.reason,
      };
      data.reception_weights.push(weight);
      record(
        data,
        "reception_weights",
        weight.id,
        "Pesaje agregado en corrección",
        null,
        structuredClone(weight),
        values.reason,
      );
    }
    if (values.classification) {
      const classification = impact.classifications[0];
      const before = structuredClone(classification);
      const received = round(
        values.weights.reduce((sum, weight) => sum + weight.kg, 0),
      );
      classification.approved_kg = round(
        received - values.classification.rejected_kg,
      );
      classification.rejected_kg = values.classification.rejected_kg;
      classification.reason = values.classification.reason;
      if (JSON.stringify(before) !== JSON.stringify(classification)) {
        classification.updated_at = timestamp;
        record(
          data,
          "classifications",
          classification.id,
          "Selección corregida con la recepción",
          before,
          structuredClone(classification),
          values.reason,
        );
      }
    }
    if (reception.date !== values.date) {
      for (const pallet of impact.pallets.filter(
        (pallet) =>
          pallet.status === "Etiquetado" ||
          pallet.status === "Listo para carga",
      )) {
        const before = structuredClone(pallet);
        pallet.status = "En armado";
        pallet.updated_at = timestamp;
        record(
          data,
          "pallets",
          pallet.id,
          "Etiqueta pendiente de revisión por cambio de fecha",
          before,
          structuredClone(pallet),
          values.reason,
        );
      }
    }
    reception.date = values.date;
    reception.responsible = values.responsible;
    reception.notes = values.notes;
  }
  if (JSON.stringify(receptionBefore) !== JSON.stringify(reception)) {
    reception.updated_at = timestamp;
    record(
      data,
      "receptions",
      reception.id,
      values.action === "cancel"
        ? "Recepción cancelada"
        : "Recepción corregida",
      receptionBefore,
      structuredClone(reception),
      values.reason,
    );
  }
}
