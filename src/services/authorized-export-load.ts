import type { PalletExportLabel } from "../types";

// Operational instructions confirmed by Agronorte for this day's new pallets.
// Keep the scope explicit: this is not a fallback for historical labels or a
// certificate authorization for other organizations, destinations or dates.
const authorizedLoads = [
  {
    organizationId: "20000000-0000-4000-8000-000000000001",
    creationDate: "2026-10-12",
    destination: "uruguay",
    label: {
      afidi: "1571663",
      importer_name: "RINALIR SOCIEDAD ANÓNIMA",
      importer_address: "BATLLE Y ORDÓÑEZ 534, TACUAREMBÓ, URUGUAY",
      senave_program: true,
    } satisfies PalletExportLabel,
  },
] as const;

export function authorizedExportLoad(
  organizationId: string,
  destination: string,
  creationDate: string,
): PalletExportLabel | undefined {
  const load = authorizedLoads.find(
    (entry) =>
      entry.organizationId === organizationId &&
      entry.creationDate === creationDate &&
      entry.destination === destination.trim().toLocaleLowerCase("es"),
  );
  // Return a copy so form edits cannot change defaults for the next pallet.
  return load ? { ...load.label } : undefined;
}
