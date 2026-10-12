import { describe, expect, it } from "vitest";
import { base, day } from "./domain";
import { seed } from "./test-fixtures";
import type { Pallet } from "./types";
import { authorizedExportLoad } from "./services/authorized-export-load";
import { palletCreationLabelValues } from "./services/pallet-creation-label";
import { palletLabelData } from "./services/pallet-label-data";

const organizationId = "20000000-0000-4000-8000-000000000001";
const today = "2026-10-12";
const approved = {
  afidi: "1571663",
  importer_name: "RINALIR SOCIEDAD ANÓNIMA",
  importer_address: "BATLLE Y ORDÓÑEZ 534, TACUAREMBÓ, URUGUAY",
  senave_program: true,
};

function fixture() {
  const data = seed();
  for (const rows of Object.values(data))
    for (const row of rows) row.organization_id = organizationId;
  data.producers[0].metadata = {
    trap_reference_codes: ["SPE-QA-015-SAN"],
    export_origin: "Depto. de San Pedro – Paraguay",
    harvest_reference: {
      date: "2026-10-03",
      season: 2026,
      status: "Confirmado",
      source: "Entrega anterior QA",
      notes: [],
    },
  };
  data.field_lots[0].harvest_date = null;
  const pallet: Pallet = {
    ...base(organizationId, "Etiquetado"),
    code: "PAL-QA-HISTORICO",
    token: crypto.randomUUID(),
    destination: "Uruguay",
    assembled_at: "2026-10-07T12:00:00Z",
    responsible: "Operador QA",
    gross_kg: 432,
    net_kg: 390,
    tare_kg: 42,
    fruit_count: null,
    notes: "",
    metadata: {
      export_label: {
        ...approved,
        afidi: "1571652",
        harvest_date: "2026-10-03",
        packaged_date: "2026-10-07",
      },
    },
  };
  data.pallets.push(pallet);
  data.pallet_items.push({
    ...base(organizationId),
    pallet_id: pallet.id,
    reception_id: data.receptions[0].id,
    kg: pallet.net_kg,
  });
  const values = (date = today, destination = "Uruguay") =>
    palletCreationLabelValues(data, data.receptions[0].id, destination, date);
  return { data, pallet, values };
}

describe("AFIDI autorizado para los nuevos pallets del 12/10/2026", () => {
  it("completa AFIDI e importador desde el primer pallet sin copiar fechas de la entrega anterior", () => {
    const { data, values } = fixture();
    data.pallets = [];
    data.pallet_items = [];
    const before = structuredClone(data);
    expect(values()).toEqual({
      authorizedLoadDate: today,
      usesTodayLoad: false,
      loadConflict: false,
      value: {
        ...approved,
        producer_code: "SPE-QA-015-SAN",
        origin: "Depto. de San Pedro – Paraguay",
        harvest_date: null,
      },
    });
    expect(values().value.packaged_date).toBeUndefined();
    expect(data).toEqual(before);
  });

  it("la instrucción explícita prevalece sobre AFIDI anteriores incluso si hay cargas contradictorias hoy", () => {
    const { data, pallet, values } = fixture();
    pallet.assembled_at = "2026-10-12T15:00:00Z";
    pallet.metadata!.export_label!.packaged_date = today;
    data.pallets.push({
      ...pallet,
      ...base(organizationId, "En armado"),
      metadata: { export_label: { afidi: "OTRO", packaged_date: today } },
    });
    const before = structuredClone(data);
    expect(values().value).toMatchObject(approved);
    expect(values().loadConflict).toBe(false);
    expect(data).toEqual(before);
    expect(palletLabelData(data, pallet).afidi).toBe("1571652");
  });

  it("persiste los datos de la nueva etiqueta sin alterar los QR, pesos ni etiquetas históricas", () => {
    const { data, pallet, values } = fixture();
    const oldLabel = palletLabelData(data, pallet);
    const before = structuredClone(data);
    const newPallet: Pallet = {
      ...pallet,
      ...base(organizationId, "En armado"),
      code: "PAL-QA-NUEVA-CARGA",
      token: crypto.randomUUID(),
      assembled_at: "2026-10-12T15:00:00Z",
      metadata: {
        export_label: values().value,
        harvest_source: "reception_lot",
      },
    };
    // Labels are snapshots stored in Supabase metadata, not a rendering override.
    const restored: Pallet = JSON.parse(JSON.stringify(newPallet));
    const label = palletLabelData(data, restored);
    expect(label).toMatchObject({
      afidi: "1571663",
      importerName: approved.importer_name,
      importerAddress: approved.importer_address,
    });
    expect(restored.net_kg).toBe(390);
    expect(restored.gross_kg).toBe(432);
    expect(restored.token).toBe(newPallet.token);
    expect(palletLabelData(data, pallet)).toEqual(oldLabel);
    expect(oldLabel.afidi).toBe("1571652");
    expect(data).toEqual(before);
  });

  it.each(["2026-10-11", "2026-10-13", "2026-02-30"])(
    "no extiende la autorización a la fecha %s",
    (date) => {
      const { values } = fixture();
      expect(values(date).authorizedLoadDate).toBeUndefined();
      expect(values(date).value.afidi).toBeUndefined();
    },
  );

  it("aísla organización, destino y recepción activa, y compara el día paraguayo", () => {
    const { data, values } = fixture();
    expect(values(today, " URUGUAY ").value.afidi).toBe("1571663");
    expect(values(today, "Brasil").value.afidi).toBeUndefined();
    expect(values(day(new Date("2026-10-13T02:59:00Z"))).value.afidi).toBe(
      "1571663",
    );
    expect(
      values(day(new Date("2026-10-13T03:00:00Z"))).value.afidi,
    ).toBeUndefined();
    data.receptions[0].organization_id = crypto.randomUUID();
    expect(values().value.afidi).toBeUndefined();
    data.receptions[0].organization_id = organizationId;
    data.receptions[0].status = "Cancelado";
    expect(values().value.afidi).toBeUndefined();
    expect(
      palletCreationLabelValues(data, "missing", "Uruguay", today).value,
    ).toEqual({});
  });

  it("permite editar el formulario sin contaminar los valores del siguiente pallet", () => {
    const first = authorizedExportLoad(organizationId, "Uruguay", today)!;
    first.afidi = "CORREGIDO POR OPERADOR";
    first.importer_name = "OTRO IMPORTADOR";
    expect(authorizedExportLoad(organizationId, "Uruguay", today)).toEqual(
      approved,
    );
  });
});
