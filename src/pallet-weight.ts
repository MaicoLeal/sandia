import { round } from "./domain";
import type { Pallet } from "./types";

export const DEFAULT_PALLET_TARE_KG = 42;

export function palletGrossKg(netKg: number, tareKg = DEFAULT_PALLET_TARE_KG) {
  return round(netKg + tareKg);
}

/** Entered kg are fruit net weight. Preserve an existing measured gross. */
export function palletWeightDetails(pallet: Pallet) {
  const tareKg =
    pallet.gross_kg !== null
      ? round(pallet.gross_kg - pallet.net_kg)
      : (pallet.tare_kg ?? DEFAULT_PALLET_TARE_KG);
  return {
    netKg: pallet.net_kg,
    tareKg,
    grossKg: pallet.gross_kg ?? palletGrossKg(pallet.net_kg, tareKg),
    grossCalculated: pallet.gross_kg === null,
  };
}
