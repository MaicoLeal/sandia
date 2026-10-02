import type { Base, Data, Role, Pallet } from "./types";
export const lossReasons = [
  "Fruta dañada",
  "Tamaño fuera del estándar",
  "Maduración inadecuada",
  "Problema visual",
  "Rajadura",
  "Podredumbre",
  "Posible daño de plaga",
  "Otro",
];

export const LOCAL_ORG = "20000000-0000-4000-8000-000000000001";
export const LOCAL_KEY = "local:agronorte";
export const now = () => new Date().toISOString();
export const day = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
export const kg = (value: number) =>
  new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 }).format(value);
export const dateLabel = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split("-").reverse().join("/")
    : new Intl.DateTimeFormat("es-PY", {
        timeZone: "America/Asuncion",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value));
export const round = (value: number) => Math.round(value * 100) / 100;
export function parseKg(value: string) {
  const n = Number(value.trim().replace(",", "."));
  if (!value.trim() || !Number.isFinite(n) || n <= 0 || n > 999999999999.99)
    throw new Error("Ingrese un peso mayor que cero, en kg.");
  const result = round(n);
  if (result <= 0) throw new Error("El peso mínimo es 0,01 kg.");
  return result;
}
export function summary(weights: number[]) {
  return {
    total: round(weights.reduce((a, b) => a + b, 0)),
    count: weights.length,
    average: weights.length
      ? round(weights.reduce((a, b) => a + b, 0) / weights.length)
      : 0,
    min: weights.length ? Math.min(...weights) : 0,
    max: weights.length ? Math.max(...weights) : 0,
  };
}
export function base(
  org: string,
  status = "Activo",
  user: string | null = null,
): Base {
  const at = now();
  return {
    id: crypto.randomUUID(),
    organization_id: org,
    created_at: at,
    updated_at: at,
    created_by: user,
    status,
  };
}
export function code(prefix: string) {
  return `${prefix}-${day().replaceAll("-", "")}-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}
export function origin(data: Data, receptionId: string) {
  const reception = data.receptions.find((x) => x.id === receptionId);
  const lot = data.field_lots.find((x) => x.id === reception?.lot_id);
  const plot = data.plots.find((x) => x.id === lot?.plot_id);
  const farm = data.farms.find((x) => x.id === plot?.farm_id);
  const producer = data.producers.find(
    (x) => x.id === (farm?.producer_id ?? lot?.producer_id),
  );
  return { reception, lot, plot, farm, producer };
}
export function receptionTotal(data: Data, id: string) {
  if (data.receptions.find((r) => r.id === id)?.status === "Cancelado")
    return 0;
  return summary(
    data.reception_weights
      .filter((x) => x.reception_id === id && x.status !== "Cancelado")
      .map((x) => x.kg),
  ).total;
}
export function groupPalletsByProducer(data: Data, pallets = data.pallets) {
  const groups = new Map<
    string,
    {
      key: string;
      name: string;
      producerIds: string[];
      pallets: Pallet[];
      netKg: number;
    }
  >();
  for (const pallet of pallets) {
    const producers = new Map(
      data.pallet_items
        .filter((item) => item.pallet_id === pallet.id)
        .map((item) => origin(data, item.reception_id).producer)
        .filter((producer) => producer !== undefined)
        .map((producer) => [producer.id, producer]),
    );
    const ids = [...producers.keys()].sort();
    const key = ids.join("/") || "unknown";
    if (!groups.has(key))
      groups.set(key, {
        key,
        name:
          [...producers.values()]
            .map((p) => p.name)
            .sort((a, b) => a.localeCompare(b, "es"))
            .join(" / ") || "Productor pendiente de identificar",
        producerIds: ids,
        pallets: [],
        netKg: 0,
      });
    const group = groups.get(key)!;
    group.pallets.push(pallet);
    if (pallet.status !== "Cancelado")
      group.netKg = round(group.netKg + pallet.net_kg);
  }
  return [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((group) => ({
      ...group,
      pallets: group.pallets.sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) ||
          a.code.localeCompare(b.code),
      ),
    }));
}
export function available(data: Data, id: string) {
  const selected = data.classifications.find(
    (x) => x.reception_id === id && x.status !== "Cancelado",
  );
  return round(
    (selected?.approved_kg ?? 0) -
      data.pallet_items
        .filter(
          (x) =>
            x.reception_id === id &&
            data.pallets.find((p) => p.id === x.pallet_id)?.status !==
              "Cancelado",
        )
        .reduce((a, b) => a + b.kg, 0),
  );
}
export function assertClassification(
  data: Data,
  id: string,
  approved: number,
  rejected: number,
) {
  if (!data.receptions.some((r) => r.id === id && r.status !== "Cancelado"))
    throw new Error("Seleccione una recepción activa.");
  if (
    approved < 0 ||
    rejected < 0 ||
    round(approved + rejected) !== receptionTotal(data, id)
  )
    throw new Error(
      "Aprobado + rechazado debe coincidir con el peso recibido.",
    );
  const allocated = data.pallet_items
    .filter(
      (x) =>
        x.reception_id === id &&
        data.pallets.find((p) => p.id === x.pallet_id)?.status !== "Cancelado",
    )
    .reduce((a, b) => a + b.kg, 0);
  if (approved < allocated)
    throw new Error("El peso aprobado no puede ser menor al ya palletizado.");
}
export function regionalLosses(
  data: Data,
  from = "",
  to = "",
  producerId = "",
) {
  const groups = new Map<
    string,
    {
      region: string;
      received: number;
      assessed: number;
      rejected: number;
      receptions: number;
      classified: number;
      producers: Set<string>;
      observations: number;
    }
  >();
  for (const reception of data.receptions) {
    if (
      reception.status === "Cancelado" ||
      (from && reception.date < from) ||
      (to && reception.date > to)
    )
      continue;
    const source = origin(data, reception.id);
    if (producerId && source.producer?.id !== producerId) continue;
    const classification = data.classifications.find(
      (c) => c.reception_id === reception.id && c.status !== "Cancelado",
    );
    const region =
      classification?.region?.trim() ||
      source.plot?.location?.trim() ||
      source.producer?.community?.trim() ||
      "Región sin informar";
    const key = region
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es")
      .replace(/\s+/g, " ");
    const group = groups.get(key) ?? {
      region,
      received: 0,
      assessed: 0,
      rejected: 0,
      receptions: 0,
      classified: 0,
      producers: new Set<string>(),
      observations: 0,
    };
    const total = receptionTotal(data, reception.id);
    group.received = round(group.received + total);
    group.receptions++;
    if (source.producer) group.producers.add(source.producer.id);
    if (classification) {
      group.assessed = round(group.assessed + total);
      group.rejected = round(group.rejected + classification.rejected_kg);
      group.classified++;
      if (
        classification.pest_observation?.trim() ||
        classification.symptoms?.trim()
      )
        group.observations++;
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      producers: group.producers.size,
      rate:
        group.assessed > 0
          ? round((group.rejected / group.assessed) * 100)
          : null,
    }))
    .sort(
      (a, b) =>
        (b.rate ?? -1) - (a.rate ?? -1) ||
        a.region.localeCompare(b.region, "es"),
    );
}
export function assertPallet(
  data: Data,
  id: string,
  net: number,
  gross: number | null,
) {
  if (net <= 0 || (gross !== null && gross < net))
    throw new Error("El peso bruto debe ser mayor o igual al neto.");
  if (net > available(data, id))
    throw new Error("El peso supera el saldo aprobado disponible.");
}
export function can(
  role: Role,
  operation:
    | "catalog"
    | "receive"
    | "weigh"
    | "classify"
    | "pallet"
    | "ship"
    | "correct",
) {
  const all = role === "administrador" || role === "gestor";
  return (
    all ||
    {
      catalog: role === "recepcion",
      receive: role === "recepcion",
      weigh: role === "pesaje" || role === "recepcion",
      classify: role === "packing" || role === "recepcion",
      pallet: role === "packing",
      ship: role === "packing",
      correct: false,
    }[operation]
  );
}
export function emptyData(): Data {
  return {
    producers: [],
    farms: [],
    plots: [],
    field_lots: [],
    receptions: [],
    reception_weights: [],
    classifications: [],
    pallets: [],
    pallet_items: [],
    shipments: [],
    shipment_pallets: [],
    attachments: [],
    audit_logs: [],
  };
}

export function intakeSelection(
  total: number,
  rejectedInput: string,
  reason: string,
) {
  const rejected = rejectedInput.trim()
    ? Number(rejectedInput.trim().replace(",", "."))
    : 0;
  if (!Number.isFinite(rejected) || rejected < 0 || round(rejected) > total)
    throw new Error("Las pérdidas deben estar entre cero y el peso recibido.");
  if (round(rejected) > 0 && !reason.trim())
    throw new Error("Seleccione el motivo de las pérdidas.");
  return {
    approved: round(total - round(rejected)),
    rejected: round(rejected),
  };
}
