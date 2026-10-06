import { describe, expect, it } from "vitest";
import { base, receptionTotal } from "../domain";
import type { Pallet } from "../types";
import { seed } from "../test-fixtures";
import {
  palletReportRows,
  shipmentReportRows,
  producerAllocatedKg,
} from "./operational-report-rows";
import { receptionRows, receptionWeightRows } from "./reports";

function fixture() {
  const data = seed();
  const producerA = data.producers[0];
  const org = producerA.organization_id;
  producerA.community = "Comunidad A";
  data.plots[0].name = "Parcela A";
  data.field_lots[0].code = "LOTE-A";
  const receptionA = data.receptions[0];
  const producerB = {
    ...producerA,
    ...base(org),
    name: "Valentin Caballero",
    community: "Comunidad B",
  };
  const farmB = {
    ...data.farms[0],
    ...base(org),
    producer_id: producerB.id,
  };
  const plotB = {
    ...data.plots[0],
    ...base(org),
    farm_id: farmB.id,
    name: "Parcela B",
  };
  const lotB = {
    ...data.field_lots[0],
    ...base(org),
    plot_id: plotB.id,
    code: "LOTE-B",
  };
  const receptionB = {
    ...receptionA,
    ...base(org, "Confirmado"),
    lot_id: lotB.id,
    date: "2026-10-02",
  };
  data.producers.push(producerB);
  data.farms.push(farmB);
  data.plots.push(plotB);
  data.field_lots.push(lotB);
  data.receptions.push(receptionB);
  const makePallet = (
    code: string,
    net_kg: number,
    gross_kg: number | null,
  ): Pallet => ({
    ...base(org, "Expedido"),
    code,
    token: crypto.randomUUID(),
    destination: "Uruguay",
    assembled_at: "2026-10-02T01:30:00Z",
    weighed_date: null,
    responsible: "Operador de prueba",
    gross_kg,
    net_kg,
    fruit_count: null,
    notes: "",
  });
  const mixed = makePallet("PAL-MIXTO", 1000, null);
  const onlyA = makePallet("PAL-A", 200, 242);
  const onlyB = makePallet("PAL-B", 400, 445);
  data.pallets.push(mixed, onlyA, onlyB);
  const addItem = (pallet: Pallet, receptionId: string, kg: number) => {
    const item = {
      ...base(org),
      pallet_id: pallet.id,
      reception_id: receptionId,
      kg,
    };
    data.pallet_items.push(item);
    return item;
  };
  addItem(mixed, receptionA.id, 300);
  addItem(mixed, receptionB.id, 700);
  addItem(onlyA, receptionA.id, 200);
  addItem(onlyB, receptionB.id, 400);
  const shipment = {
    ...base(org, "Expedido"),
    destination: "Uruguay",
    country: "Uruguay",
    customer: "Cliente de prueba",
    carrier: "Transportadora de prueba",
    driver: "Conductor de prueba",
    plate: "TEST001",
    departure: "2026-10-03",
    responsible: "Operador de prueba",
    notes: "",
  };
  data.shipments.push(shipment);
  data.shipment_pallets = data.pallets.map((pallet) => ({
    ...base(org),
    shipment_id: shipment.id,
    pallet_id: pallet.id,
  }));
  return {
    data,
    producerA,
    producerB,
    receptionA,
    receptionB,
    mixed,
    onlyA,
    onlyB,
    shipment,
    addItem,
  };
}

describe("informes operativos por origen y estado", () => {
  it("reúne todas las procedencias del pallet mixto en una sola fila sin duplicar el neto", () => {
    const { data } = fixture();
    const rows = palletReportRows(data, "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      Pallet: "PAL-MIXTO",
      Productores: "Elias Galeano / Valentin Caballero",
      Lotes: "LOTE-A / LOTE-B",
      Parcelas: "Parcela A / Parcela B",
      Comunidades: "Comunidad A / Comunidad B",
      Recepciones: "01/10/2026 / 02/10/2026",
      Productor_filtrado: "Todos",
      Kg_del_productor: "",
      Peso_neto_pallet: 1000,
      Tara_kg: 42,
      Bruto_kg: 1042,
    });
    expect(
      rows.reduce((total, row) => total + Number(row.Peso_neto_pallet), 0),
    ).toBe(1600);
  });

  it("separa los kg atribuidos al productor del peso completo del pallet mixto", () => {
    const { data, producerA, producerB } = fixture();
    const rowsA = palletReportRows(data, producerA.id);
    expect(rowsA.map((row) => row.Pallet)).toEqual(["PAL-MIXTO", "PAL-A"]);
    expect(rowsA[0]).toMatchObject({
      Kg_del_productor: 300,
      Peso_neto_pallet: 1000,
      Productor_filtrado: producerA.name,
      Productores: "Elias Galeano / Valentin Caballero",
    });
    expect(
      rowsA.reduce((total, row) => total + Number(row.Kg_del_productor), 0),
    ).toBe(500);
    expect(palletReportRows(data, producerB.id)[0].Kg_del_productor).toBe(700);
    expect(palletReportRows(data, "productor-inexistente")).toEqual([]);
  });

  it("suma más de una recepción del mismo productor sin repetir nombres ni códigos", () => {
    const { data, receptionA, mixed, producerA, addItem } = fixture();
    const extraReception = {
      ...receptionA,
      ...base(receptionA.organization_id, "Confirmado"),
      date: "2026-10-03",
    };
    data.receptions.push(extraReception);
    addItem(mixed, extraReception.id, 50.25);
    const mixedRow = palletReportRows(data, producerA.id)[0];
    expect(mixedRow.Kg_del_productor).toBe(350.25);
    expect(mixedRow.Productores).toBe("Elias Galeano / Valentin Caballero");
    expect(mixedRow.Lotes).toBe("LOTE-A / LOTE-B");
    expect(
      palletReportRows(data, producerA.id, "2026-10-01", "2026-10-01")[0]
        .Kg_del_productor,
    ).toBe(300);
  });

  it("conserva el bruto medido y usa el día de armado del Paraguay", () => {
    const { data } = fixture();
    const rows = palletReportRows(data, "");
    expect(rows[0].Fecha_armado).toBe("01/10/2026");
    expect(rows[2]).toMatchObject({
      Peso_neto_pallet: 400,
      Bruto_kg: 445,
      Tara_kg: 45,
      Fecha_pesaje: "Sin informar",
    });
  });

  it("filtra pallets de la carga y no incorpora los de otro productor en la misma expedición", () => {
    const { data, producerA } = fixture();
    const rows = shipmentReportRows(
      data,
      producerA.id,
      "2026-10-03",
      "2026-10-03",
    );
    expect(rows.map((row) => row.Pallet)).toEqual(["PAL-MIXTO", "PAL-A"]);
    expect(rows[0]).toMatchObject({
      Salida: "03/10/2026",
      País: "Uruguay",
      Chapa: "TEST001",
      Kg_del_productor: 300,
      Peso_neto_pallet: 1000,
    });
    expect(shipmentReportRows(data, "", "", "")).toHaveLength(3);
    expect(shipmentReportRows(data, "", "2026-10-04", "")).toHaveLength(0);
    expect(shipmentReportRows(data, "", "", "2026-10-02")).toHaveLength(0);
  });

  it("filtra el período por recepciones del productor elegido, sin usar la fecha de otro origen", () => {
    const { data, producerA, producerB } = fixture();
    expect(
      palletReportRows(data, producerA.id, "2026-10-02", "2026-10-02"),
    ).toEqual([]);
    expect(
      palletReportRows(data, producerB.id, "2026-10-02", "2026-10-02").map(
        (row) => row.Pallet,
      ),
    ).toEqual(["PAL-MIXTO", "PAL-B"]);
    expect(palletReportRows(data, "", "2026-10-03", "2026-10-03")).toEqual([]);
    expect(
      palletReportRows(data, "", "2026-10-01", "2026-10-01").map(
        (row) => row.Pallet,
      ),
    ).toEqual(["PAL-MIXTO", "PAL-A"]);
  });

  it("mantiene las procedencias canceladas al consultar el historial del pallet retirado", () => {
    const { data, producerA, receptionA, mixed, onlyA } = fixture();
    receptionA.status = "Cancelado";
    onlyA.status = "Cancelado";
    mixed.status = "Cancelado";
    expect(palletReportRows(data, producerA.id)).toEqual([]);
    const history = palletReportRows(
      data,
      producerA.id,
      "2026-10-01",
      "2026-10-01",
      true,
    );
    expect(history.map((row) => row.Pallet)).toEqual(["PAL-MIXTO", "PAL-A"]);
    expect(history[0]).toMatchObject({
      Productores: "Elias Galeano / Valentin Caballero",
      Lotes: "LOTE-A / LOTE-B",
      Estado: "Cancelado",
      Kg_del_productor: 300,
    });
    expect(producerAllocatedKg(data, mixed, producerA.id)).toBe(0);
  });

  it("calcula el saldo de cada productor con sus alocaciones y no con todo el pallet mixto", () => {
    const { data, producerA, producerB, mixed, onlyA } = fixture();
    expect(producerAllocatedKg(data, mixed, producerA.id)).toBe(300);
    expect(producerAllocatedKg(data, mixed, producerB.id)).toBe(700);
    expect(producerAllocatedKg(data, onlyA, producerB.id)).toBe(0);
    expect(
      data.pallets.reduce(
        (total, pallet) =>
          total + producerAllocatedKg(data, pallet, producerA.id),
        0,
      ),
    ).toBe(500);
  });

  it("excluye pallets, vínculos y expediciones cancelados de los informes activos", () => {
    const { data, onlyA, onlyB, shipment } = fixture();
    onlyA.status = "Cancelado";
    data.shipment_pallets.find((link) => link.pallet_id === onlyB.id)!.status =
      "Cancelado";
    expect(palletReportRows(data, "").map((row) => row.Pallet)).toEqual([
      "PAL-MIXTO",
      "PAL-B",
    ]);
    expect(
      shipmentReportRows(data, "", "", "").map((row) => row.Pallet),
    ).toEqual(["PAL-MIXTO"]);
    shipment.status = "Cancelado";
    expect(shipmentReportRows(data, "", "", "")).toEqual([]);
  });

  it("no atribuye al productor asignaciones canceladas ni recepciones canceladas", () => {
    const { data, receptionA, producerA, mixed, onlyA } = fixture();
    data.pallet_items.find((item) => item.pallet_id === onlyA.id)!.status =
      "Cancelado";
    expect(
      palletReportRows(data, producerA.id).map((row) => row.Pallet),
    ).toEqual([mixed.code]);
    receptionA.status = "Cancelado";
    expect(palletReportRows(data, producerA.id)).toEqual([]);
    expect(palletReportRows(data, "")[0].Productores).toBe(
      "Valentin Caballero",
    );
  });

  it("resume pesajes retirados como historial y no como kg activos", () => {
    const data = seed();
    const reception = data.receptions[0];
    const removed = data.reception_weights[0];
    removed.status = "Cancelado";
    removed.correction_reason = "Pesaje duplicado";
    const rows = receptionWeightRows(data, reception.id);
    expect(rows[0]).toMatchObject({
      Pesaje: 1,
      Kg_registrados: 340,
      Kg_activos: 0,
      Estado: "Cancelado · historial",
      Motivo: "Pesaje duplicado",
    });
    expect(rows.reduce((total, row) => total + row.Kg_activos, 0)).toBe(
      receptionTotal(data, reception.id),
    );
    expect(receptionRows(data)[0]).toMatchObject({
      Kg: 2907,
      Pesajes_activos: 8,
      Kg_cancelados_historial: 340,
      Estado: "Confirmado",
    });
    reception.status = "Cancelado";
    expect(receptionRows(data)[0]).toMatchObject({
      Kg: 0,
      Pesajes_activos: 0,
      Kg_cancelados_historial: 3247,
      Estado: "Cancelado",
    });
    expect(
      receptionWeightRows(data, reception.id).every(
        (row) => row.Kg_activos === 0 && row.Estado.includes("Cancelado"),
      ),
    ).toBe(true);
  });
});
