import type { Data, Pallet } from "../types";
import { dateLabel, kg, origin } from "../domain";

export const SENAVE_DECLARATION =
  "FRUTA DE EXPORTACIÓN A URUGUAY - SENAVE - PROGRAMA DE CERTIFICACIÓN DE FRUTAS PROVENIENTES DEL SISTEMA INTEGRADO DE MEDIDAS DE MITIGACIÓN DE RIESGO PARA";
export interface PalletLabelData {
  code: string;
  producer: string;
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
export function palletLabelData(data: Data, pallet: Pallet): PalletLabelData {
  const sources = data.pallet_items
    .filter((item) => item.pallet_id === pallet.id)
    .map((item) => origin(data, item.reception_id));
  const fields = pallet.metadata?.export_label;
  const harvestDates = fields?.harvest_date
    ? [fields.harvest_date]
    : sources.map((source) => source.lot?.harvest_date);
  return {
    code: pallet.code,
    producer:
      join(sources.map((source) => source.producer?.name)) || "No informado",
    producerCode:
      fields?.producer_code?.trim() ||
      join(sources.map((source) => source.producer?.metadata?.export_code)) ||
      "No informado",
    origin:
      fields?.origin?.trim() ||
      join(sources.map((source) => source.producer?.metadata?.export_origin)) ||
      "No informado",
    netKg: pallet.net_kg,
    harvest:
      join(harvestDates.filter(Boolean).map((date) => dateLabel(date!))) ||
      "No informada",
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
    { title: "N.º DE AFIDI", value: label.afidi },
  ];
}
export function palletLabelDeclaration(label: PalletLabelData) {
  return label.senaveProgram
    ? SENAVE_DECLARATION
    : `IDENTIFICACIÓN DE PALLET DE SANDÍA - DESTINO: ${label.destination.toLocaleUpperCase("es")}`;
}
