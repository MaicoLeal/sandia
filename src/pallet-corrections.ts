import { available, round } from "./domain";
import type { Data, Pallet } from "./types";
import { palletGrossKg } from "./pallet-weight";

export type PalletCorrectionValues =
  | {
      action: "edit";
      netKg: number;
      grossKg: number | null;
      tareKg?: number;
      fruitCount: number | null;
      weighedDate: string | null;
      responsible: string;
      notes: string;
      reason: string;
    }
  | { action: "cancel"; reason: string };

export interface PalletCorrectionDraft {
  netKg: string;
  grossKg: string;
  tareKg?: number;
  fruitCount: string;
  weighedDate: string;
  responsible: string;
  notes: string;
  reason: string;
}

export function palletCorrectionSource(data: Data, pallet: Pallet) {
  const items = data.pallet_items.filter(
    (item) => item.pallet_id === pallet.id,
  );
  const receptionIds = [...new Set(items.map((item) => item.reception_id))];
  if (items.length !== 1)
    return {
      receptionId: null,
      maxNetKg: null,
      blockedReason:
        receptionIds.length > 1
          ? "Este pallet reúne varias recepciones. Puede editar sus otros datos; el peso requiere revisar la distribución de origen."
          : items.length > 1
            ? "Este pallet tiene varias asignaciones de origen. Puede editar sus otros datos; el peso requiere conciliación."
            : "El pallet no tiene una recepción de origen confirmada. Puede editar sus otros datos.",
    };
  const receptionId = receptionIds[0];
  if (items[0].status !== "Activo" || items[0].kg !== pallet.net_kg)
    return {
      receptionId,
      maxNetKg: null,
      blockedReason:
        "La asignación de origen debe estar activa y coincidir con el peso neto actual. Puede editar sus otros datos; el peso requiere conciliación.",
    };
  if (
    !data.receptions.some(
      (reception) =>
        reception.id === receptionId && reception.status !== "Cancelado",
    ) ||
    !data.classifications.some(
      (classification) =>
        classification.reception_id === receptionId &&
        classification.status !== "Cancelado",
    )
  )
    return {
      receptionId,
      maxNetKg: null,
      blockedReason:
        "La recepción de origen debe estar activa y clasificada para corregir el peso.",
    };
  return {
    receptionId,
    maxNetKg: round(
      available(data, receptionId) +
        items.reduce((total, item) => total + item.kg, 0),
    ),
    blockedReason: "",
  };
}

function decimalWeight(input: string, required: boolean): number | null {
  const value = input.trim();
  if (!value && !required) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value))
    throw new Error(
      "Ingrese el peso en kg, con hasta dos decimales. Puede usar coma o punto.",
    );
  const number = Number(value.replace(",", "."));
  if (!Number.isFinite(number) || number <= 0 || number > 999999999999.99)
    throw new Error("Ingrese un peso mayor que cero, en kg.");
  return round(number);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function assertPalletCorrection(
  data: Data,
  pallet: Pallet,
  values: PalletCorrectionValues,
) {
  const current = data.pallets.find(
    (candidate) =>
      candidate.id === pallet.id &&
      candidate.organization_id === pallet.organization_id,
  );
  if (!current)
    throw new Error("El pallet ya no está disponible. Actualice los datos.");
  if (current.status === "Expedido" || current.status === "Cancelado")
    throw new Error(
      "No se puede corregir ni cancelar un pallet expedido o cancelado.",
    );
  if (data.shipment_pallets.some((link) => link.pallet_id === pallet.id))
    throw new Error(
      "El pallet está vinculado a una expedición. Revise la carga antes de corregirlo.",
    );
  if (!values.reason.trim() || values.reason.trim().length > 1000)
    throw new Error(
      "Indique el motivo de la corrección, con hasta 1.000 caracteres.",
    );
  if (values.action === "cancel") return;
  if (
    !Number.isFinite(values.netKg) ||
    values.netKg <= 0 ||
    values.netKg > 999999999999.99 ||
    round(values.netKg) !== values.netKg
  )
    throw new Error("Ingrese un peso neto válido, con hasta dos decimales.");
  if (
    values.grossKg !== null &&
    (!Number.isFinite(values.grossKg) ||
      values.grossKg < values.netKg ||
      values.grossKg > 999999999999.99 ||
      round(values.grossKg) !== values.grossKg)
  )
    throw new Error("El peso bruto debe ser mayor o igual al neto.");
  if (
    values.tareKg !== undefined &&
    (!Number.isFinite(values.tareKg) ||
      values.tareKg < 0 ||
      round(values.tareKg) !== values.tareKg ||
      values.grossKg !== palletGrossKg(values.netKg, values.tareKg))
  )
    throw new Error(
      "El bruto debe ser el neto más la tara, sin descontar la tara del peso de la fruta.",
    );
  if (
    values.fruitCount !== null &&
    (!Number.isSafeInteger(values.fruitCount) ||
      values.fruitCount < 0 ||
      values.fruitCount > 2147483647)
  )
    throw new Error(
      "La cantidad de frutas debe ser un número entero, desde cero.",
    );
  if (values.weighedDate !== null && !validDate(values.weighedDate))
    throw new Error("Ingrese una fecha de pesaje válida.");
  if (!values.responsible.trim() || values.responsible.trim().length > 200)
    throw new Error("Indique el responsable, con hasta 200 caracteres.");
  if (values.notes.length > 5000)
    throw new Error("Las observaciones deben tener hasta 5.000 caracteres.");
  if (values.netKg !== current.net_kg) {
    const source = palletCorrectionSource(data, current);
    if (source.maxNetKg === null) throw new Error(source.blockedReason);
    if (values.netKg > source.maxNetKg)
      throw new Error(
        "El peso supera el saldo aprobado disponible de la recepción.",
      );
  }
}

export function parsePalletCorrection(
  data: Data,
  pallet: Pallet,
  draft: PalletCorrectionDraft,
): Extract<PalletCorrectionValues, { action: "edit" }> {
  const count = draft.fruitCount.trim();
  if (count && !/^\d+$/.test(count))
    throw new Error(
      "La cantidad de frutas debe ser un número entero, desde cero.",
    );
  const values: Extract<PalletCorrectionValues, { action: "edit" }> = {
    action: "edit",
    netKg: decimalWeight(draft.netKg, true)!,
    grossKg: decimalWeight(draft.grossKg, false),
    fruitCount: count ? Number(count) : null,
    weighedDate: draft.weighedDate.trim() || null,
    responsible: draft.responsible.trim(),
    notes: draft.notes.trim(),
    reason: draft.reason.trim(),
  };
  if (draft.tareKg !== undefined) {
    values.tareKg = draft.tareKg;
    values.grossKg = palletGrossKg(values.netKg, draft.tareKg);
  }
  assertPalletCorrection(data, pallet, values);
  return values;
}
