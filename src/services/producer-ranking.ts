import { round } from "../domain";
import type { Data, Producer } from "../types";

export interface ProducerRankingRow {
  producer: Producer;
  receivedKg: number;
  deliveries: number;
  sharePercent: number;
  rank: number;
}

export interface ProducerRanking {
  rows: ProducerRankingRow[];
  totalKg: number;
  unassignedKg: number;
}

/** Delivered kg come from current reception weights, before losses or palletization. */
export function producerDeliveryRanking(
  data: Data,
  from = "",
  to = "",
): ProducerRanking {
  const producers = new Map(data.producers.map((value) => [value.id, value]));
  const farms = new Map(data.farms.map((value) => [value.id, value]));
  const plots = new Map(data.plots.map((value) => [value.id, value]));
  const lots = new Map(data.field_lots.map((value) => [value.id, value]));
  const receptionKg = new Map<string, number>();

  for (const weight of data.reception_weights) {
    if (weight.status === "Cancelado") continue;
    receptionKg.set(
      weight.reception_id,
      (receptionKg.get(weight.reception_id) ?? 0) + weight.kg,
    );
  }

  const grouped = new Map<string, ProducerRankingRow>();
  let totalKg = 0;
  let unassignedKg = 0;

  for (const reception of data.receptions) {
    if (
      reception.status === "Cancelado" ||
      (from && reception.date < from) ||
      (to && reception.date > to)
    )
      continue;

    // Round once per reception, matching receptionTotal in the domain module.
    const receivedKg = round(receptionKg.get(reception.id) ?? 0);
    if (!Number.isFinite(receivedKg) || receivedKg <= 0) continue;

    totalKg = round(totalKg + receivedKg);
    const lot = lots.get(reception.lot_id);
    const plot = lot?.plot_id ? plots.get(lot.plot_id) : undefined;
    const farm = plot ? farms.get(plot.farm_id) : undefined;
    const producerId = farm?.producer_id ?? lot?.producer_id;
    const producer = producerId ? producers.get(producerId) : undefined;

    if (!producer) {
      unassignedKg = round(unassignedKg + receivedKg);
      continue;
    }

    const row = grouped.get(producer.id) ?? {
      producer,
      receivedKg: 0,
      deliveries: 0,
      sharePercent: 0,
      rank: 0,
    };
    row.receivedKg = round(row.receivedKg + receivedKg);
    row.deliveries++;
    grouped.set(producer.id, row);
  }

  const rows = [...grouped.values()].sort(
    (a, b) =>
      b.receivedKg - a.receivedKg ||
      a.producer.name.localeCompare(b.producer.name, "es") ||
      a.producer.id.localeCompare(b.producer.id, "es"),
  );
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    row.rank =
      index > 0 && row.receivedKg === rows[index - 1].receivedKg
        ? rows[index - 1].rank
        : index + 1;
    row.sharePercent = round((row.receivedKg / totalKg) * 100);
  }

  return { rows, totalKg, unassignedKg };
}
