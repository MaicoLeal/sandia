import { describe, expect, it } from "vitest";
import { base } from "./domain";
import { seed } from "./test-fixtures";
import type { Data, Pallet, PalletExportLabel } from "./types";
import { palletCreationLabelValues } from "./services/pallet-creation-label";
import { palletLabelData } from "./services/pallet-label-data";

const today = "2026-10-07";
const load: PalletExportLabel = {
  afidi: "1571652",
  importer_name: "IMPORTADOR QA",
  importer_address: "DIRECCIÓN CONFIRMADA QA, URUGUAY",
  senave_program: true,
  packaged_date: today,
  producer_code: "SPE-OTRO-001-SAN",
  origin: "ORIGEN DE OTRO PRODUCTOR",
  harvest_date: "2026-09-25",
};
function addPallet(data: Data, fields = load): Pallet {
  const pallet: Pallet = {
    ...base(data.receptions[0].organization_id, "En armado"),
    code: "PAL-QA-CARGA",
    token: crypto.randomUUID(),
    assembled_at: "2026-10-07T18:00:00Z",
    destination: "Uruguay",
    net_kg: 108,
    gross_kg: 150,
    tare_kg: 42,
    fruit_count: null,
    responsible: "Responsable QA",
    notes: "",
    metadata: { export_label: structuredClone(fields) },
  };
  data.pallets.push(pallet);
  return pallet;
}
function fixture() {
  const data = seed();
  data.producers[0].name = "Productor QA seleccionado";
  data.producers[0].metadata = {
    internal_code: "AGN-0099",
    trap_reference_codes: ["CAN-QA-099-SAN"],
    export_origin: "Depto. de Canindeyú – Paraguay",
  };
  data.field_lots[0].harvest_date = "2026-09-29";
  const pallet = addPallet(data);
  const values = (date = today, destination = "Uruguay") =>
    palletCreationLabelValues(data, data.receptions[0].id, destination, date);
  return { data, pallet, values };
}

describe("datos confirmados para crear pallets", () => {
  it("reutiliza solo la carga única del día y los datos del productor seleccionado sin mutar registros", () => {
    const { data, values } = fixture();
    const before = structuredClone(data);
    expect(values()).toEqual({
      usesTodayLoad: true,
      loadConflict: false,
      value: {
        afidi: "1571652",
        importer_name: "IMPORTADOR QA",
        importer_address: "DIRECCIÓN CONFIRMADA QA, URUGUAY",
        senave_program: true,
        packaged_date: today,
        producer_code: "CAN-QA-099-SAN",
        origin: "Depto. de Canindeyú – Paraguay",
        harvest_date: "2026-09-29",
      },
    });
    expect(data).toEqual(before);
  });

  it("deduplica pallets de la misma carga y acepta espacios exteriores sin cambiar códigos ni QR", () => {
    const { data, pallet, values } = fixture();
    const other = addPallet(data, {
      ...load,
      afidi: " 1571652 ",
      importer_name: " IMPORTADOR QA ",
    });
    other.destination = " uruguay ";
    other.status = "Listo para carga";
    const tokens = data.pallets.map((row) => row.token);
    expect(values().usesTodayLoad).toBe(true);
    expect(values().value.afidi).toBe("1571652");
    expect(data.pallets.map((row) => row.token)).toEqual(tokens);
    expect(pallet.net_kg).toBe(108);
    expect(pallet.gross_kg).toBe(150);
  });

  it.each([
    ["AFIDI", { afidi: "OTRO-AFIDI" }],
    ["importador", { importer_name: "OTRO IMPORTADOR QA" }],
    ["dirección", { importer_address: "OTRA DIRECCIÓN QA" }],
  ])("no elige entre dos cargas completas con %s distinto", (_, difference) => {
    const { data, values } = fixture();
    addPallet(data, { ...load, ...difference });
    expect(values()).toMatchObject({ usesTodayLoad: false, loadConflict: true });
    expect(values().value.afidi).toBeUndefined();
    expect(values().value.importer_name).toBeUndefined();
    expect(values().value.producer_code).toBe("CAN-QA-099-SAN");
  });

  it("no inventa la carga con datos parciales y no oculta AFIDI contradictorio de otro registro parcial", () => {
    const { data, pallet, values } = fixture();
    pallet.metadata = { export_label: { afidi: "1571652", packaged_date: today } };
    expect(values().usesTodayLoad).toBe(false);
    expect(values().value.packaged_date).toBeUndefined();
    addPallet(data);
    expect(values().usesTodayLoad).toBe(true);
    pallet.metadata.export_label!.afidi = "OTRO-AFIDI";
    expect(values()).toMatchObject({ usesTodayLoad: false, loadConflict: true });
  });

  it.each(["Cancelado", "Expedido", "Estado desconocido"])(
    "no reutiliza un pallet %s",
    (status) => {
      const { pallet, values } = fixture();
      pallet.status = status;
      expect(values().usesTodayLoad).toBe(false);
    },
  );

  it("no reutiliza pallets vinculados a expedición aunque su estado permanezca abierto", () => {
    const { data, pallet, values } = fixture();
    data.shipment_pallets.push({
      ...base(pallet.organization_id),
      shipment_id: crypto.randomUUID(),
      pallet_id: pallet.id,
    });
    expect(values().usesTodayLoad).toBe(false);
  });

  it("aísla organización y destino, conserva fechas confirmadas y no reutiliza mañana", () => {
    const { pallet, values } = fixture();
    expect(values("2026-10-08").usesTodayLoad).toBe(false);
    expect(values(today, "Brasil").usesTodayLoad).toBe(false);
    pallet.destination = "Brasil";
    expect(values().usesTodayLoad).toBe(false);
    pallet.destination = "Uruguay";
    pallet.organization_id = crypto.randomUUID();
    expect(values().usesTodayLoad).toBe(false);
    expect(values().value.harvest_date).toBe("2026-09-29");
  });

  it("compara la fecha de montaje en Paraguay, exige envasado del día y rechaza fechas inválidas", () => {
    const { pallet, values } = fixture();
    pallet.assembled_at = "2026-10-08T01:00:00Z";
    expect(values().usesTodayLoad).toBe(true); // Todavía es 07/10 en Paraguay.
    pallet.assembled_at = "2026-10-07T01:00:00Z";
    expect(values().usesTodayLoad).toBe(false); // Es 06/10 en Paraguay.
    pallet.assembled_at = "2026-10-07T18:00:00Z";
    pallet.metadata!.export_label!.packaged_date = "2026-10-06";
    expect(values().usesTodayLoad).toBe(false);
    pallet.metadata!.export_label!.packaged_date = today;
    pallet.assembled_at = "fecha desconocida";
    expect(values().usesTodayLoad).toBe(false);
    expect(values("2026-02-30").usesTodayLoad).toBe(false);
  });

  it.each([
    { importer_name: "" },
    { importer_address: "" },
    { afidi: "" },
    { senave_program: false },
    { importer_name: "N".repeat(201) },
    { importer_address: "D".repeat(401) },
    { afidi: "A".repeat(101) },
  ])("exige un tuple completo y válido dentro de los límites", (difference) => {
    const { pallet, values } = fixture();
    pallet.metadata = { export_label: { ...load, ...difference } };
    expect(values().usesTodayLoad).toBe(false);
  });

  it("mantiene referencias pendientes de cosecha vacías y nunca usa fecha de otro productor", () => {
    const { data, values } = fixture();
    data.field_lots[0].harvest_date = null;
    data.producers[0].metadata!.harvest_reference = {
      date: "2026-10-29",
      season: 2026,
      status: "Pendiente de confirmar",
      source: "Fuente QA",
      notes: [],
    };
    expect(values().value.harvest_date).toBeNull();
    expect(values().value.producer_code).toBe("CAN-QA-099-SAN");
    expect(values().value.origin).toBe("Depto. de Canindeyú – Paraguay");
  });

  it("no introduce fallback de carga en etiquetas existentes sin metadata y no cruza procedencias entre organizaciones", () => {
    const { data, values } = fixture();
    const blank = addPallet(data, {});
    data.pallet_items.push({
      ...base(blank.organization_id),
      pallet_id: blank.id,
      reception_id: data.receptions[0].id,
      kg: blank.net_kg,
    });
    expect(values().usesTodayLoad).toBe(true);
    expect(palletLabelData(data, blank).afidi).toBe("No informado");
    expect(palletLabelData(data, blank).importerName).toBe("");
    data.producers[0].organization_id = crypto.randomUUID();
    expect(values().value.producer_code).toBeUndefined();
    expect(values().value.origin).toBeUndefined();
    expect(values().value.harvest_date).toBeUndefined();
    data.receptions[0].status = "Cancelado";
    expect(values().usesTodayLoad).toBe(false);
    expect(palletCreationLabelValues(data, "missing", "Uruguay", today).value).toEqual({});
  });
});
