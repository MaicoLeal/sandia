import { describe, it, expect } from "vitest";
import {
  assertClassification,
  assertPallet,
  available,
  base,
  can,
  day,
  origin,
  parseKg,
  receptionTotal,
  seed,
  summary,
} from "./domain";
describe("recepción y trazabilidad", () => {
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
