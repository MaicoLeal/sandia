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
  importerName: string;
  importerAddress: string;
}
const join = (values: (string | null | undefined)[]) =>
  [...new Set(values.map((v) => v?.trim()).filter(Boolean))].join(" / ");
const internalProducerCode = /^AGN-\d+(?:\s*\/\s*AGN-\d+)*$/i;
const producerReferenceCodes = (sources: ReturnType<typeof origin>[]) =>
  join(
    sources.flatMap((source) => {
      const references =
        source.producer?.metadata?.trap_reference_codes?.filter((value) =>
          value.trim(),
        );
      const exportCode = source.producer?.metadata?.export_code?.trim();
      return references?.length
        ? references
        : exportCode && !internalProducerCode.test(exportCode)
          ? [exportCode]
          : [];
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
  if (source.lot?.harvest_date)
    return validIsoDate(source.lot.harvest_date)
      ? source.lot.harvest_date
      : null;
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
    harvest_date: fields?.harvest_date
      ? validIsoDate(fields.harvest_date)
        ? fields.harvest_date
        : null
      : harvestDates.length === 1 && sourceDates.every(Boolean)
        ? harvestDates[0]
        : null,
  };
}
export function palletLabelData(data: Data, pallet: Pallet): PalletLabelData {
  const sources = data.pallet_items
    .filter((item) => item.pallet_id === pallet.id)
    .map((item) => origin(data, item.reception_id));
  const fields = pallet.metadata?.export_label;
  const harvestDates = fields?.harvest_date
    ? [validIsoDate(fields.harvest_date) ? fields.harvest_date : null]
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
    packaged: validIsoDate(fields?.packaged_date)
      ? dateLabel(fields.packaged_date)
      : "No informada",
    afidi: fields?.afidi?.trim() || "No informado",
    lots: join(sources.map((source) => source.lot?.code)) || "No informado",
    reception:
      join(
        sources
          .map((source) => source.reception?.date)
          .filter(validIsoDate)
          .map((date) => dateLabel(date!)),
      ) || "No informada",
    destination: pallet.destination.trim() || "No informado",
    responsible: pallet.responsible.trim() || "No informado",
    senaveProgram: fields?.senave_program === true,
    importerName: fields?.importer_name?.trim() || "",
    importerAddress: fields?.importer_address?.trim() || "",
  };
}
export interface PalletLabelReview {
  pending: string[];
  warnings: string[];
}
export function palletLabelReview(
  data: Data,
  pallet: Pallet,
): PalletLabelReview {
  const label = palletLabelData(data, pallet);
  const fields = pallet.metadata?.export_label;
  const sources = data.pallet_items
    .filter((item) => item.pallet_id === pallet.id)
    .map((item) => origin(data, item.reception_id));
  const missing = (value: string) =>
    !value.trim() ||
    /^(no informad[oa]|pendiente(?: de .*)?)$/i.test(value.trim());
  const pending = new Set<string>();
  const warnings = new Set<string>();
  if (missing(label.code)) pending.add("Código del pallet");
  if (!sources.length || sources.some((source) => !source.producer))
    pending.add("Productor / procedencia");
  if (
    missing(label.producerCode) ||
    internalProducerCode.test(label.producerCode) ||
    (!fields?.producer_code?.trim() &&
      sources.some((source) => !producerReferenceCodes([source])))
  )
    pending.add("Código del productor (SPE/CAN)");
  if (
    missing(label.origin) ||
    (!fields?.origin?.trim() &&
      sources.some(
        (source) => !source.producer?.metadata?.export_origin?.trim(),
      ))
  )
    pending.add("Origen");
  if (!Number.isFinite(label.netKg) || label.netKg <= 0)
    pending.add("Peso neto");
  if (missing(label.harvest)) pending.add("Fecha de cosecha");
  if (missing(label.packaged)) pending.add("Fecha de envasado");
  if (!sources.length || sources.some((source) => !source.lot?.code?.trim()))
    pending.add("Lote");
  if (
    !sources.length ||
    sources.some((source) => !validIsoDate(source.reception?.date))
  )
    pending.add("Fecha de recepción");
  if (missing(label.destination)) pending.add("Destino");
  if (missing(label.responsible)) pending.add("Responsable");
  if (label.destination.trim().toLocaleLowerCase("es") === "uruguay") {
    if (missing(label.afidi)) pending.add("N° de AFIDI");
    if (!label.importerName) pending.add("Importador");
    if (!label.importerAddress) pending.add("Dirección del importador");
  }
  if (internalProducerCode.test(label.producerCode))
    warnings.add(
      "El código AGN es interno. Revise la referencia SPE/CAN del productor para esta etiqueta.",
    );
  if (
    label.senaveProgram &&
    label.destination.trim().toLocaleLowerCase("es") !== "uruguay"
  )
    warnings.add(
      "La declaración SENAVE para Uruguay requiere destino Uruguay confirmado.",
    );
  if (
    (fields?.harvest_date && !validIsoDate(fields.harvest_date)) ||
    (!fields?.harvest_date &&
      sources.some(
        (source) =>
          source.lot?.harvest_date && !validIsoDate(source.lot.harvest_date),
      ))
  )
    warnings.add(
      "La fecha de cosecha registrada no es válida; no se imprime. Corríjala con una fecha confirmada.",
    );
  if (fields?.packaged_date && !validIsoDate(fields.packaged_date))
    warnings.add(
      "La fecha de envasado registrada no es válida; no se imprime. Corríjala con una fecha confirmada.",
    );
  const harvestDates = fields?.harvest_date
    ? [validIsoDate(fields.harvest_date) ? fields.harvest_date : null]
    : harvestDatesForSources(data, pallet, sources);
  const receptions = sources.map((source) => source.reception?.date);
  if (
    harvestDates.some((harvest, index) => {
      const reception = receptions[fields?.harvest_date ? 0 : index];
      return harvest && validIsoDate(reception) && harvest > reception;
    }) ||
    (validIsoDate(fields?.harvest_date) &&
      receptions.some(
        (reception) =>
          validIsoDate(reception) && fields.harvest_date! > reception,
      ))
  )
    warnings.add(
      "La cosecha es posterior a una recepción de este pallet. Revise las fechas confirmadas.",
    );
  if (
    validIsoDate(fields?.packaged_date) &&
    harvestDates.some((harvest) => harvest && fields.packaged_date! < harvest)
  )
    warnings.add(
      "El envasado es anterior a la cosecha. Revise las fechas confirmadas.",
    );
  if (
    !fields?.harvest_date &&
    sources.some(
      (source, index) =>
        !source.lot?.harvest_date &&
        !harvestDates[index] &&
        source.producer?.metadata?.harvest_reference,
    )
  )
    warnings.add(
      "Hay una referencia de cosecha pendiente o incompatible con la recepción; no se usa en la etiqueta.",
    );
  return { pending: [...pending], warnings: [...warnings] };
}
export function palletLabelImporterRows(label: PalletLabelData) {
  const showPending =
    label.senaveProgram &&
    label.destination.trim().toLocaleLowerCase("es") === "uruguay";
  return [
    {
      title: "IMPORTADOR",
      value: label.importerName.trim() || (showPending ? "No informado" : ""),
      name: true,
    },
    {
      title: "DIRECCIÓN",
      value:
        label.importerAddress.trim() || (showPending ? "No informada" : ""),
      name: false,
    },
  ].filter((row) => row.value);
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
    {
      title: "PESO NETO (kg)",
      value:
        Number.isFinite(label.netKg) && label.netKg > 0
          ? kg(label.netKg)
          : "No informado",
    },
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
