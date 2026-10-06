import type { Data, Pallet } from "../types";
import { dateLabel, day, origin, round } from "../domain";
import { palletWeightDetails } from "../pallet-weight";

export type OperationalReportRow = Record<string, string | number>;

function joined(values: (string | undefined | null)[]) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))]
    .sort((a, b) => a!.localeCompare(b!, "es"))
    .join(" / ");
}

function palletSources(data: Data, pallet: Pallet, includeHistory = false) {
  return data.pallet_items
    .filter(
      (item) =>
        item.pallet_id === pallet.id &&
        item.organization_id === pallet.organization_id &&
        (includeHistory || item.status === "Activo"),
    )
    .map((item) => ({ item, source: origin(data, item.reception_id) }))
    .filter(
      ({ source }) =>
        source.reception &&
        (includeHistory || source.reception.status !== "Cancelado") &&
        source.reception.organization_id === pallet.organization_id,
    );
}

function palletRow(
  data: Data,
  pallet: Pallet,
  producerId: string,
  start = "",
  end = "",
  includeCancelled = false,
): OperationalReportRow | null {
  if (pallet.status === "Cancelado" && !includeCancelled) return null;
  const sources = palletSources(
    data,
    pallet,
    includeCancelled && pallet.status === "Cancelado",
  );
  const inPeriod = (date: string | undefined) =>
    !!date && (!start || date >= start) && (!end || date <= end);
  const selected = sources.filter(
    ({ source }) =>
      source.producer?.id === producerId && inPeriod(source.reception?.date),
  );
  if (producerId && selected.length === 0) return null;
  if (
    !producerId &&
    (start || end) &&
    !sources.some(({ source }) => inPeriod(source.reception?.date))
  )
    return null;
  const weights = palletWeightDetails(pallet);
  return {
    Pallet: pallet.code,
    Productores:
      joined(sources.map(({ source }) => source.producer?.name)) ||
      "Sin informar",
    Lotes:
      joined(sources.map(({ source }) => source.lot?.code)) || "Sin informar",
    Parcelas:
      joined(sources.map(({ source }) => source.plot?.name)) || "Sin informar",
    Comunidades:
      joined(sources.map(({ source }) => source.producer?.community)) ||
      "Sin informar",
    Recepciones:
      joined(
        sources.map(({ source }) =>
          source.reception ? dateLabel(source.reception.date) : undefined,
        ),
      ) || "Sin informar",
    Productor_filtrado: producerId
      ? joined(selected.map(({ source }) => source.producer?.name))
      : "Todos",
    Kg_del_productor: producerId
      ? round(selected.reduce((total, { item }) => total + item.kg, 0))
      : "",
    Peso_neto_pallet: weights.netKg,
    Tara_kg: weights.tareKg,
    Bruto_kg: weights.grossKg,
    Destino: pallet.destination,
    Fecha_armado: dateLabel(day(new Date(pallet.assembled_at))),
    Fecha_pesaje: pallet.weighed_date
      ? dateLabel(pallet.weighed_date)
      : "Sin informar",
    Responsable: pallet.responsible,
    Estado: pallet.status,
  };
}

/** One row per active pallet; the selected producer's allocated kg are separate. */
export function palletReportRows(
  data: Data,
  producerId: string,
  start = "",
  end = "",
  includeCancelled = false,
): OperationalReportRow[] {
  return data.pallets.flatMap((pallet) => {
    const row = palletRow(
      data,
      pallet,
      producerId,
      start,
      end,
      includeCancelled,
    );
    return row ? [row] : [];
  });
}

/** A producer owns only the kg assigned to their receptions, even in mixed pallets. */
export function producerAllocatedKg(
  data: Data,
  pallet: Pallet,
  producerId: string,
) {
  if (pallet.status === "Cancelado") return 0;
  return round(
    palletSources(data, pallet)
      .filter(({ source }) => source.producer?.id === producerId)
      .reduce((total, { item }) => total + item.kg, 0),
  );
}

/** Filter individual pallets, not the whole shipment, when selecting a producer. */
export function shipmentReportRows(
  data: Data,
  producerId: string,
  start: string,
  end: string,
): OperationalReportRow[] {
  const pallets = new Map(data.pallets.map((pallet) => [pallet.id, pallet]));
  return data.shipments
    .filter(
      (shipment) =>
        shipment.status !== "Cancelado" &&
        (!start || shipment.departure >= start) &&
        (!end || shipment.departure <= end),
    )
    .flatMap((shipment) =>
      data.shipment_pallets
        .filter(
          (link) =>
            link.shipment_id === shipment.id &&
            link.organization_id === shipment.organization_id &&
            link.status === "Activo",
        )
        .flatMap((link) => {
          const pallet = pallets.get(link.pallet_id);
          if (!pallet || pallet.organization_id !== shipment.organization_id)
            return [];
          const row = palletRow(data, pallet, producerId);
          if (!row) return [];
          return [
            {
              Salida: dateLabel(shipment.departure),
              Destino_carga: shipment.destination,
              País: shipment.country,
              Cliente: shipment.customer,
              Transportadora: shipment.carrier,
              Conductor: shipment.driver,
              Chapa: shipment.plate,
              Estado_carga: shipment.status,
              ...row,
            },
          ];
        }),
    );
}
