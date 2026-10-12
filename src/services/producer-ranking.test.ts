import { describe, expect, it } from "vitest";
import { emptyData, receptionTotal } from "../domain";
import type { Base, Data, Producer } from "../types";
import { producerDeliveryRanking } from "./producer-ranking";

function record(id: string, status = "Activo"): Base {
  return {
    id,
    organization_id: "test-org",
    status,
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
    created_by: null,
  };
}

function addProducer(data: Data, id: string, name: string) {
  const producer: Producer = {
    ...record(id),
    name,
    document: "",
    phone: "",
    community: "",
    address: "",
    notes: "",
  };
  data.producers.push(producer);
  return producer;
}

function addDelivery(
  data: Data,
  id: string,
  producerId: string | null,
  weights: number[],
  date = "2026-10-12",
) {
  const lot = {
    ...record(`${id}-lot`),
    plot_id: null as string | null,
    producer_id: producerId,
    code: `${id}-lot`,
    crop: "Sandía",
    variety: "",
    harvest_date: null,
    notes: "",
  };
  const reception = {
    ...record(id, "Confirmado"),
    lot_id: lot.id,
    date,
    responsible: "Operador de prueba",
    notes: "",
  };
  data.field_lots.push(lot);
  data.receptions.push(reception);
  const createdWeights = weights.map((kg, index) => ({
    ...record(`${id}-weight-${index}`),
    reception_id: id,
    sequence: index + 1,
    kg,
    operator: reception.responsible,
    notes: "",
    correction_reason: "",
  }));
  data.reception_weights.push(...createdWeights);
  return { lot, reception, weights: createdWeights };
}

describe("ranking de entregas por productor", () => {
  it("suma las recepciones repetidas y ordena por kg entregados", () => {
    const data = emptyData();
    const elias = addProducer(data, "elias", "Elias Galeano");
    const matia = addProducer(data, "matia", "Matia Alarcon");
    addDelivery(data, "elias-1", elias.id, [390, 410]);
    addDelivery(data, "matia-1", matia.id, [567]);
    addDelivery(data, "elias-2", elias.id, [200]);

    expect(producerDeliveryRanking(data)).toEqual({
      totalKg: 1567,
      unassignedKg: 0,
      rows: [
        {
          producer: elias,
          receivedKg: 1000,
          deliveries: 2,
          sharePercent: 63.82,
          rank: 1,
        },
        {
          producer: matia,
          receivedKg: 567,
          deliveries: 1,
          sharePercent: 36.18,
          rank: 2,
        },
      ],
    });
  });

  it("omite recepciones y pesajes cancelados, y entregas sin peso positivo", () => {
    const data = emptyData();
    addProducer(data, "a", "Productor A");
    const active = addDelivery(data, "active", "a", [100, 1000]);
    active.weights[1].status = "Cancelado";
    addDelivery(data, "cancelled", "a", [5000]).reception.status = "Cancelado";
    addDelivery(data, "empty", "a", []);
    addDelivery(data, "zero", "a", [0]);
    addDelivery(data, "removed", "a", [250]).weights[0].status = "Cancelado";

    const ranking = producerDeliveryRanking(data);
    expect(ranking.totalKg).toBe(100);
    expect(ranking.rows[0]).toMatchObject({ receivedKg: 100, deliveries: 1 });
  });

  it("refleja el peso corregido sin volver a sumar la versión guardada en auditoría", () => {
    const data = emptyData();
    addProducer(data, "a", "Productor A");
    const { weights } = addDelivery(data, "receipt", "a", [500]);
    const weight = weights[0];
    data.audit_logs.push({
      ...record("audit"),
      entity_type: "reception_weights",
      entity_id: weight.id,
      action: "Corregir pesaje",
      actor: "Gestor",
      before: { kg: 500 },
      after: { kg: 350 },
      reason: "Error de digitación",
    });
    weight.kg = 350;
    weight.correction_reason = "Error de digitación";

    expect(producerDeliveryRanking(data).rows[0].receivedKg).toBe(350);
    expect(producerDeliveryRanking(data).totalKg).toBe(
      receptionTotal(data, "receipt"),
    );
  });

  it("no descuenta pérdidas ni tara, ni duplica kg por pallets o sus asignaciones", () => {
    const data = emptyData();
    addProducer(data, "a", "Productor A");
    addDelivery(data, "receipt", "a", [500]);
    data.classifications.push({
      ...record("classification"),
      reception_id: "receipt",
      approved_kg: 450,
      rejected_kg: 50,
      approved_count: null,
      rejected_count: null,
      reason: "Fruta dañada",
      size: "",
      quality: null,
      notes: "",
    });
    data.pallets.push({
      ...record("pallet"),
      code: "PAL-TEST",
      token: "test-token",
      destination: "Uruguay",
      assembled_at: "2026-10-12T12:00:00Z",
      responsible: "Operador de prueba",
      gross_kg: 492,
      tare_kg: 42,
      net_kg: 450,
      fruit_count: null,
      notes: "",
    });
    data.pallet_items.push({
      ...record("pallet-item"),
      pallet_id: "pallet",
      reception_id: "receipt",
      kg: 450,
    });

    expect(producerDeliveryRanking(data).rows[0]).toMatchObject({
      receivedKg: 500,
      deliveries: 1,
    });
  });

  it("mantiene productores homónimos separados y desempata por id", () => {
    const data = emptyData();
    addProducer(data, "producer-b", "Juan Romero");
    addProducer(data, "producer-a", "Juan Romero");
    addDelivery(data, "b", "producer-b", [100]);
    addDelivery(data, "a", "producer-a", [100]);

    const rows = producerDeliveryRanking(data).rows;
    expect(rows.map((row) => row.producer.id)).toEqual([
      "producer-a",
      "producer-b",
    ]);
    expect(rows.map((row) => row.rank)).toEqual([1, 1]);
  });

  it("comparte posición en empates y salta la siguiente, con orden alfabético español", () => {
    const data = emptyData();
    addProducer(data, "z", "Zulema");
    addProducer(data, "a", "Álvaro");
    addProducer(data, "b", "Beatriz");
    addDelivery(data, "z-receipt", "z", [100.004]);
    addDelivery(data, "a-receipt", "a", [100]);
    addDelivery(data, "b-receipt", "b", [50]);

    const rows = producerDeliveryRanking(data).rows;
    expect(
      rows.map((row) => [row.producer.name, row.receivedKg, row.rank]),
    ).toEqual([
      ["Álvaro", 100, 1],
      ["Zulema", 100, 1],
      ["Beatriz", 50, 3],
    ]);
  });

  it("redondea por recepción como el dominio y evita residuos en sumas decimales", () => {
    const data = emptyData();
    addProducer(data, "a", "Productor A");
    addDelivery(data, "first", "a", [0.1, 0.2]);
    addDelivery(data, "second", "a", [100.12, 200.34]);
    const expected =
      receptionTotal(data, "first") + receptionTotal(data, "second");

    expect(producerDeliveryRanking(data)).toMatchObject({
      totalKg: 300.76,
      rows: [{ receivedKg: 300.76, sharePercent: 100, deliveries: 2 }],
    });
    expect(producerDeliveryRanking(data).totalKg).toBe(expected);
  });

  it("filtra por fecha de recepción con límites inclusivos y extremos opcionales", () => {
    const data = emptyData();
    addProducer(data, "a", "Productor A");
    addDelivery(data, "before", "a", [100], "2026-10-10");
    addDelivery(data, "start", "a", [200], "2026-10-11");
    addDelivery(data, "end", "a", [300], "2026-10-12");
    addDelivery(data, "after", "a", [400], "2026-10-13");

    expect(
      producerDeliveryRanking(data, "2026-10-11", "2026-10-12"),
    ).toMatchObject({
      totalKg: 500,
      rows: [{ deliveries: 2 }],
    });
    expect(producerDeliveryRanking(data, "2026-10-12").totalKg).toBe(700);
    expect(producerDeliveryRanking(data, "", "2026-10-11").totalKg).toBe(300);
    expect(
      producerDeliveryRanking(data, "2026-10-13", "2026-10-10").rows,
    ).toEqual([]);
  });

  it("mantiene entregas históricas de productores inactivos y omite los que nunca entregaron", () => {
    const data = emptyData();
    addProducer(data, "a", "Productor inactivo").status = "Inactivo";
    addProducer(data, "b", "Sin entregas");
    addDelivery(data, "receipt", "a", [100]);

    expect(
      producerDeliveryRanking(data).rows.map((row) => row.producer.id),
    ).toEqual(["a"]);
  });

  it("respeta el productor de la finca y usa el del lote cuando no hay parcela", () => {
    const data = emptyData();
    addProducer(data, "farm-producer", "Productor de finca");
    addProducer(data, "lot-producer", "Productor directo");
    data.farms.push({
      ...record("farm"),
      producer_id: "farm-producer",
      name: "Finca de prueba",
      location: "",
    });
    data.plots.push({
      ...record("plot"),
      farm_id: "farm",
      name: "Parcela de prueba",
      location: "",
      area_ha: null,
      crop: "Sandía",
      variety: "",
      planting_date: null,
      harvest_date: null,
      notes: "",
    });
    addDelivery(data, "with-plot", "lot-producer", [200]).lot.plot_id = "plot";
    addDelivery(data, "without-plot", "lot-producer", [100]);

    expect(
      producerDeliveryRanking(data).rows.map((row) => [
        row.producer.id,
        row.receivedKg,
      ]),
    ).toEqual([
      ["farm-producer", 200],
      ["lot-producer", 100],
    ]);
  });

  it("separa kg sin productor identificado y los incluye en el total y porcentajes", () => {
    const data = emptyData();
    addProducer(data, "a", "Productor A");
    addDelivery(data, "known", "a", [100]);
    addDelivery(data, "unknown", "not-found", [50]);
    addDelivery(data, "no-producer", null, [25]);
    addDelivery(data, "missing-lot", null, [25]).reception.lot_id = "missing";

    expect(producerDeliveryRanking(data)).toMatchObject({
      totalKg: 200,
      unassignedKg: 100,
      rows: [{ receivedKg: 100, deliveries: 1, sharePercent: 50, rank: 1 }],
    });
    expect(producerDeliveryRanking(data).rows).toHaveLength(1);
  });

  it("devuelve el estado vacío sin alterar los registros recibidos", () => {
    const data = emptyData();
    expect(producerDeliveryRanking(data)).toEqual({
      rows: [],
      totalKg: 0,
      unassignedKg: 0,
    });
    addProducer(data, "a", "Productor A");
    addDelivery(data, "receipt", "a", [100]);
    const original = structuredClone(data);
    producerDeliveryRanking(data);
    expect(data).toEqual(original);
  });
});
