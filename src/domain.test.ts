import { seed } from "./test-fixtures";
import type { Data, Pallet } from "./types";
import { describe, it, expect } from "vitest";
import {
  intakeSelection,
  regionalLosses,
  groupPalletsByProducer,
  assertClassification,
  assertPallet,
  available,
  base,
  can,
  day,
  origin,
  parseKg,
  receptionTotal,
  emptyData,
  summary,
} from "./domain";
describe("recepción y trazabilidad", () => {
  it("calcula pérdidas regionales sobre entregas seleccionadas y excluye canceladas", () => {
    const d = seed();
    const r = d.receptions[0];
    const total = receptionTotal(d, r.id);
    d.classifications = [
      {
        ...base(r.organization_id),
        reception_id: r.id,
        approved_kg: total - 100,
        rejected_kg: 100,
        approved_count: null,
        rejected_count: null,
        reason: "Daño",
        size: "",
        quality: null,
        notes: "",
        region: "Caaguazú",
        pest_observation: "Por revisar",
      },
    ];
    const pending = { ...r, ...base(r.organization_id), date: "2026-10-02" };
    d.receptions.push(pending);
    d.reception_weights.push({
      ...d.reception_weights[0],
      ...base(r.organization_id),
      reception_id: pending.id,
      kg: 1000,
    });
    const second = { ...pending, ...base(r.organization_id) };
    d.receptions.push(second);
    d.reception_weights.push({
      ...d.reception_weights[0],
      ...base(r.organization_id),
      reception_id: second.id,
      kg: 200,
    });
    d.classifications.push({
      ...d.classifications[0],
      ...base(r.organization_id),
      reception_id: second.id,
      approved_kg: 100,
      rejected_kg: 100,
      region: "caaguazu",
      pest_observation: "",
    });
    const grouped = regionalLosses(d);
    const assessed = grouped.find((g) => g.region === "Caaguazú")!;
    expect(assessed.assessed).toBe(total + 200);
    expect(assessed.rejected).toBe(200);
    expect(assessed.rate).toBe(Math.round((200 / (total + 200)) * 10000) / 100);
    expect(assessed.classified).toBe(2);
    expect(assessed.observations).toBe(1);
    expect(grouped.find((g) => g.classified === 0)?.rate).toBeNull();
    second.status = "Cancelado";
    expect(
      regionalLosses(d).find((g) => g.region === "Caaguazú")?.rejected,
    ).toBe(100);
    expect(regionalLosses(d, "2026-11-01")).toHaveLength(0);
    expect(regionalLosses(d, "", "", "other-producer")).toHaveLength(0);
  });
  it("agrupa pallets por todas sus procedencias sin duplicar peso", () => {
    const d: Data = seed();
    const org = d.producers[0].organization_id;
    const second = { ...d.producers[0], ...base(org), name: "Otro productor" };
    d.producers.push(second);
    const lot = {
      ...d.field_lots[0],
      ...base(org),
      plot_id: null,
      producer_id: second.id,
      code: "OTRO",
    };
    d.field_lots.push(lot);
    const reception = { ...d.receptions[0], ...base(org), lot_id: lot.id };
    d.receptions.push(reception);
    const pallet = (code: string, net_kg: number): Pallet => ({
      ...base(org, "En armado"),
      code,
      token: crypto.randomUUID(),
      destination: "Pendiente",
      assembled_at: "2026-10-02",
      responsible: "Operador",
      gross_kg: null,
      net_kg,
      fruit_count: null,
      notes: "",
    });
    const first = pallet("P1", 100),
      other = pallet("P2", 200),
      mixed = pallet("P3", 300);
    d.pallets.push(first, other, mixed);
    for (const [p, r, weight] of [
      [first, d.receptions[0], 100],
      [other, reception, 200],
      [mixed, d.receptions[0], 150],
      [mixed, reception, 150],
    ] as const)
      d.pallet_items.push({
        ...base(org),
        pallet_id: p.id,
        reception_id: r.id,
        kg: weight,
      });
    const groups = groupPalletsByProducer(d);
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.producerIds.length === 2)?.netKg).toBe(300);
    expect(groups.reduce((s, g) => s + g.netKg, 0)).toBe(600);
    expect(
      groups
        .flatMap((g) => g.pallets)
        .map((p) => p.id)
        .sort(),
    ).toEqual(d.pallets.map((p) => p.id).sort());
    other.status = "Cancelado";
    expect(
      groupPalletsByProducer(d).find((g) => g.key === second.id)?.netKg,
    ).toBe(0);
  });
  it("abre el sistema sin registros de demostración", () => {
    expect(Object.values(emptyData()).every((rows) => rows.length === 0)).toBe(
      true,
    );
  });
  it("confirma los nueve pesos solicitados", () => {
    const d = seed();
    const s = summary(d.reception_weights.map((w) => w.kg));
    expect(s).toEqual({
      total: 3247,
      count: 9,
      average: 360.78,
      min: 198,
      max: 410,
    });
    expect(receptionTotal(d, d.receptions[0].id)).toBe(3247);
    expect(origin(d, d.receptions[0].id).producer?.name).toBe("Elias Galeano");
  });
  it("registra pérdidas sin exceder el recibido y exige motivo", () => {
    expect(intakeSelection(3297, "0", "")).toEqual({
      approved: 3297,
      rejected: 0,
    });
    expect(intakeSelection(100, "12,5", "Fruta dañada")).toEqual({
      approved: 87.5,
      rejected: 12.5,
    });
    expect(() => intakeSelection(100, "101", "Otro")).toThrow();
    expect(() => intakeSelection(100, "12", "")).toThrow("motivo");
    expect(() => intakeSelection(100, "-1", "Otro")).toThrow();
  });
  it("acepta coma decimal y evita entradas ambiguas", () => {
    expect(parseKg("340,25")).toBe(340.25);
    for (const input of ["", " ", "-1", "0", "Infinity", "1.000,20"])
      expect(() => parseKg(input)).toThrow();
  });
  it("mantiene saldo aprobado y evita doble alocación", () => {
    const d = seed();
    const r = d.receptions[0];
    d.classifications.push({
      ...base(r.organization_id),
      reception_id: r.id,
      approved_kg: 3000,
      rejected_kg: 247,
      approved_count: null,
      rejected_count: null,
      reason: "Fruta dañada",
      size: "",
      quality: 4,
      notes: "",
    });
    assertClassification(d, r.id, 3000, 247);
    assertPallet(d, r.id, 1000, 1030);
    const p = {
      ...base(r.organization_id, "En armado"),
      code: "P1",
      token: crypto.randomUUID(),
      destination: "Uruguay",
      assembled_at: new Date().toISOString(),
      responsible: "Demo",
      gross_kg: 1030,
      net_kg: 1000,
      fruit_count: null,
      notes: "",
    };
    d.pallets.push(p);
    d.pallet_items.push({
      ...base(r.organization_id),
      pallet_id: p.id,
      reception_id: r.id,
      kg: 1000,
    });
    expect(available(d, r.id)).toBe(2000);
    expect(() => assertPallet(d, r.id, 2001, 2030)).toThrow();
    expect(() => assertPallet(d, r.id, 1000, 999)).toThrow();
    expect(() => assertClassification(d, r.id, 999, 2248)).toThrow();
  });
  it("usa el día paraguayo al cruzar medianoche UTC", () => {
    expect(day(new Date("2026-10-02T01:00:00Z"))).toBe("2026-10-01");
  });
  it("limita las correcciones al gestor y administrador", () => {
    expect(can("pesaje", "weigh")).toBe(true);
    expect(can("pesaje", "correct")).toBe(false);
    expect(can("auditor", "receive")).toBe(false);
    expect(can("gestor", "correct")).toBe(true);
  });
  it("excluye recepciones canceladas sin perder el historial de pesajes", () => {
    const data = seed();
    const r = data.receptions[0];
    r.status = "Cancelado";
    expect(receptionTotal(data, r.id)).toBe(0);
    expect(data.reception_weights).toHaveLength(9);
    expect(() => assertClassification(data, r.id, 0, 0)).toThrow("activa");
  });
});
