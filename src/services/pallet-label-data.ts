import type { Data, Pallet, PalletExportLabel } from "../types";
import { dateLabel, kg, origin } from "../domain";

export const SENAVE_DECLARATION =
  "FRUTA DE EXPORTACIÓN A URUGUAY - SENAVE - PROGRAMA DE CERTIFICACIÓN DE FRUTAS PROVENIENTES DEL SISTEMA INTEGRADO DE MEDIDAS DE MITIGACIÓN DE RIESGO PARA";
export interface PalletLabelData {
  code: string;
  producer: string;
  producerInternalCode: string;
  producerCode: string;
  origin: string;
  netKg: number;
  harvest: string;
  packaged: string;
  afidi: string;
  lots: string;
  reception: string;
  destination: string;
  responsible: string;
  senaveProgram: boolean;
}
const join = (values: (string | null | undefined)[]) =>
  [...new Set(values.map((v) => v?.trim()).filter(Boolean))].join(" / ");
const producerReferenceCodes = (sources: ReturnType<typeof origin>[]) =>
  join(
    sources.flatMap((source) => {
      const references =
        source.producer?.metadata?.trap_reference_codes?.filter((value) =>
          value.trim(),
        );
      return references?.length
        ? references
        : [source.producer?.metadata?.export_code];
    }),
  );
const validIsoDate = (value: string | null | undefined): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};
const sourceHarvestDate = (
  source: ReturnType<typeof origin>,
  allowProducerReference: boolean,
) => {
  if (source.lot?.harvest_date) return source.lot.harvest_date;
  if (!allowProducerReference) return null;
  const reference = source.producer?.metadata?.harvest_reference;
  const receptionDate = source.reception?.date;
  if (
    reference?.status !== "Confirmado" ||
    !validIsoDate(reference.date) ||
    !validIsoDate(receptionDate) ||
    reference.season !== Number(receptionDate.slice(0, 4)) ||
    reference.date > receptionDate
  )
    return null;
  return reference.date;
};
const harvestDatesForSources = (
  data: Data,
  pallet: Pallet,
  sources: ReturnType<typeof origin>[],
) => {
  const allowProducerReference =
    !["Expedido", "Cancelado"].includes(pallet.status) &&
    !data.shipment_pallets.some((link) => link.pallet_id === pallet.id);
  return sources.map((source) =>
    sourceHarvestDate(source, allowProducerReference),
  );
};
export function palletLabelEditValues(
  data: Data,
  pallet: Pallet,
): PalletExportLabel {
  const sources = data.pallet_items
    .filter((item) => item.pallet_id === pallet.id)
    .map((item) => origin(data, item.reception_id));
  const fields = pallet.metadata?.export_label;
  const sourceDates = harvestDatesForSources(data, pallet, sources);
  const harvestDates = [...new Set(sourceDates.filter(Boolean))];
  return {
    ...fields,
    producer_code:
      fields?.producer_code?.trim() || producerReferenceCodes(sources),
    origin:
      fields?.origin?.trim() ||
      join(sources.map((source) => source.producer?.metadata?.export_origin)),
    harvest_date:
      fields?.harvest_date ||
      (harvestDates.length === 1 && sourceDates.every(Boolean)
        ? harvestDates[0]
        : null),
  };
}
export function palletLabelData(data: Data, pallet: Pallet): PalletLabelData {
  const sources = data.pallet_items
    .filter((item) => item.pallet_id === pallet.id)
    .map((item) => origin(data, item.reception_id));
  const fields = pallet.metadata?.export_label;
  const harvestDates = fields?.harvest_date
    ? [fields.harvest_date]
    : harvestDatesForSources(data, pallet, sources);
  return {
    code: pallet.code,
    producer:
      join(sources.map((source) => source.producer?.name)) || "No informado",
    producerInternalCode:
      join(sources.map((source) => source.producer?.metadata?.internal_code)) ||
      "No asignado",
    producerCode:
      fields?.producer_code?.trim() ||
      producerReferenceCodes(sources) ||
      "No informado",
    origin:
      fields?.origin?.trim() ||
      join(sources.map((source) => source.producer?.metadata?.export_origin)) ||
      "No informado",
    netKg: pallet.net_kg,
    harvest:
      harvestDates.length > 0 && harvestDates.every(Boolean)
        ? join(harvestDates.map((date) => dateLabel(date!)))
        : "No informada",
    packaged: fields?.packaged_date
      ? dateLabel(fields.packaged_date)
      : "No informada",
    afidi: fields?.afidi?.trim() || "No informado",
    lots: join(sources.map((source) => source.lot?.code)) || "No informado",
    reception:
      join(
        sources
          .map((source) => source.reception?.date)
          .filter(Boolean)
          .map((date) => dateLabel(date!)),
      ) || "No informada",
    destination: pallet.destination,
    responsible: pallet.responsible,
    senaveProgram: fields?.senave_program === true,
  };
}
export function palletLabelProducerIdentity(label: PalletLabelData) {
  const internalCode = label.producerInternalCode.trim();
  return [
    `Productor: ${label.producer}`,
    ...(internalCode && internalCode !== "No asignado"
      ? [`Código interno Agronorte: ${internalCode}`]
      : []),
    `Responsable: ${label.responsible}`,
  ].join("   |   ");
}
export function palletLabelRows(label: PalletLabelData) {
  return [
    {
      title: "NOMBRE DE LA ESPECIE",
      value: "Citrullus lanatus (sandía)",
      scientific: true,
    },
    { title: "ORIGEN", value: label.origin },
    { title: "CÓDIGO DEL PRODUCTOR", value: label.producerCode },
    { title: "PESO NETO (kg)", value: kg(label.netKg) },
    { title: "FECHA DE COSECHA", value: label.harvest },
    { title: "FECHA DE ENVASADO", value: label.packaged },
    { title: "N° DE AFIDI", value: label.afidi },
  ];
}
export function palletLabelDeclaration(label: PalletLabelData) {
  return label.senaveProgram
    ? SENAVE_DECLARATION
    : `IDENTIFICACIÓN DE PALLET DE SANDÍA - DESTINO: ${label.destination.toLocaleUpperCase("es")}`;
}
