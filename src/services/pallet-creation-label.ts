import type { Data, PalletExportLabel } from "../types";
import { day } from "../domain";
import { receptionPalletLabelValues } from "./pallet-label-data";

type LoadFields = Required<
  Pick<
    PalletExportLabel,
    "afidi" | "importer_name" | "importer_address" | "senave_program" | "packaged_date"
  >
>;
const loadKeys = [
  "afidi",
  "importer_name",
  "importer_address",
  "senave_program",
  "packaged_date",
] as const;
const isUruguay = (destination: string) =>
  destination.trim().toLocaleLowerCase("es") === "uruguay";
const calendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

export interface PalletCreationLabelValues {
  value: PalletExportLabel;
  usesTodayLoad: boolean;
  loadConflict: boolean;
}

/** Reuse only one confirmed, open Uruguay load assembled and packaged today. */
export function palletCreationLabelValues(
  data: Data,
  receptionId: string,
  destination: string,
  today: string,
): PalletCreationLabelValues {
  const value = receptionPalletLabelValues(data, receptionId);
  const empty = { value, usesTodayLoad: false, loadConflict: false };
  const reception = data.receptions.find((row) => row.id === receptionId);
  if (
    !reception ||
    reception.status === "Cancelado" ||
    !isUruguay(destination) ||
    !calendarDate(today)
  )
    return empty;

  const candidates = data.pallets.filter((pallet) => {
    const assembled = new Date(pallet.assembled_at);
    return (
      pallet.organization_id === reception.organization_id &&
      isUruguay(pallet.destination) &&
      ["En armado", "Etiquetado", "Listo para carga"].includes(pallet.status) &&
      !data.shipment_pallets.some((link) => link.pallet_id === pallet.id) &&
      !Number.isNaN(assembled.valueOf()) &&
      day(assembled) === today &&
      pallet.metadata?.export_label?.packaged_date === today
    );
  });
  const normalized = candidates.map((pallet) => {
    const fields = pallet.metadata?.export_label;
    return {
      afidi: fields?.afidi?.trim() || "",
      importer_name: fields?.importer_name?.trim() || "",
      importer_address: fields?.importer_address?.trim() || "",
      senave_program: fields?.senave_program === true,
      packaged_date: fields?.packaged_date ?? null,
    } satisfies LoadFields;
  });
  const complete = normalized.filter(
    (fields) =>
      fields.afidi &&
      fields.afidi.length <= 100 &&
      fields.importer_name &&
      fields.importer_name.length <= 200 &&
      fields.importer_address &&
      fields.importer_address.length <= 400 &&
      fields.senave_program,
  );
  const tuples = new Map(complete.map((fields) => [JSON.stringify(fields), fields]));
  if (!tuples.size) return empty;
  if (tuples.size !== 1) return { ...empty, loadConflict: true };
  const load = [...tuples.values()][0];
  // Partial records with known contradictory data are also ambiguous.
  const conflicting = normalized.some((fields) =>
    loadKeys.some((key) => {
      const known = fields[key];
      return typeof known === "string" && known.length > 0 && known !== load[key];
    }),
  );
  if (conflicting) return { ...empty, loadConflict: true };
  return { value: { ...value, ...load }, usesTodayLoad: true, loadConflict: false };
}
