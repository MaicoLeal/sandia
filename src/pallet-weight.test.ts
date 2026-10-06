import { describe, expect, it } from "vitest";
import { base } from "./domain";
import type { Pallet } from "./types";
import { palletGrossKg, palletWeightDetails } from "./pallet-weight";

const pallet: Pallet = {
  ...base("org", "En armado"),
  code: "PAL",
  token: "token",
  destination: "Uruguay",
  assembled_at: "2026-10-06T12:00:00Z",
  responsible: "Piris",
  net_kg: 390,
  gross_kg: null,
  fruit_count: null,
  notes: "",
};
describe("tara confirmada de 42 kg", () => {
  it("mantiene el neto recibido y suma una tara por embalaje", () => {
    expect(palletGrossKg(390)).toBe(432);
    expect(palletGrossKg(390.25)).toBe(432.25);
    const net = [390, 410, 381, 395, 394, 389, 393, 397, 148];
    expect(net.reduce((s, n) => s + n, 0)).toBe(3297);
    expect(net.reduce((s, n) => s + palletGrossKg(n), 0)).toBe(3675);
    expect(palletWeightDetails(pallet)).toEqual({
      netKg: 390,
      grossKg: 432,
      tareKg: 42,
      grossCalculated: true,
    });
  });
  it("conserva un bruto conocido hasta una corrección explícita y auditada", () => {
    expect(
      palletWeightDetails({ ...pallet, gross_kg: 400, tare_kg: 42 }),
    ).toEqual({ netKg: 390, grossKg: 400, tareKg: 10, grossCalculated: false });
    expect(pallet.net_kg).toBe(390);
  });
});
