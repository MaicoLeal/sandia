import type { Data } from "./types";
import { base } from "./domain";
const DEMO_ORG = "10000000-0000-4000-8000-000000000001";
export function seed(): Data {
  const org = DEMO_ORG;
  const producer = {
    ...base(org),
    name: "Elias Galeano",
    document: "",
    phone: "",
    community: "Comunidad de demostración",
    address: "Datos ficticios para capacitación",
    notes: "Productor ficticio",
  };
  const farm = {
    ...base(org),
    producer_id: producer.id,
    name: "Finca de demostración",
    location: "Paraguay",
  };
  const plot = {
    ...base(org),
    farm_id: farm.id,
    name: "Parcela 01",
    location: "Paraguay",
    area_ha: 2,
    crop: "Sandía",
    variety: "",
    planting_date: "2026-07-01",
    harvest_date: "2026-10-01",
    notes: "",
  };
  const lot = {
    ...base(org, "En selección"),
    plot_id: plot.id,
    code: "SAN-20261001-DEMO01",
    crop: "Sandía",
    variety: "",
    harvest_date: "2026-10-01",
    notes: "Lote ficticio",
  };
  const reception = {
    ...base(org, "Confirmado"),
    lot_id: lot.id,
    date: "2026-10-01",
    responsible: "Operador de demostración",
    notes: "9 pesajes · total esperado 3.247 kg",
  };
  const weights = [340, 410, 381, 395, 394, 389, 343, 397, 198].map(
    (value, i) => ({
      ...base(org),
      reception_id: reception.id,
      sequence: i + 1,
      kg: value,
      operator: reception.responsible,
      notes: "",
      correction_reason: "",
    }),
  );
  return {
    producers: [producer],
    farms: [farm],
    plots: [plot],
    field_lots: [lot],
    receptions: [reception],
    reception_weights: weights,
    classifications: [],
    pallets: [],
    pallet_items: [],
    shipments: [],
    shipment_pallets: [],
    attachments: [],
    audit_logs: [
      {
        ...base(org),
        entity_type: "receptions",
        entity_id: reception.id,
        action: "Demostración creada",
        actor: "Sistema",
        before: null,
        after: { total_kg: 3247 },
        reason: "Datos ficticios",
      },
    ],
  };
}
