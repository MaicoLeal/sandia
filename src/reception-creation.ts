import { base, code, intakeSelection, round, summary } from "./domain";
import type {
  Attachment,
  AuditLog,
  Data,
  FieldLot,
  Reception,
  Table,
} from "./types";

export interface ReceptionCreationValues {
  producerId: string;
  plotId: string;
  lotId: string;
  lotCode: string;
  date: string;
  harvest: string;
  responsible: string;
  notes: string;
  weights: number[];
  classifyNow: boolean;
  rejectedKg: string;
  rejectionReason: string;
  region: string;
  pestObservation: string;
  symptoms: string;
  photos: { id: string; name: string; mime: string; size: number }[];
}

export interface ReceptionCreationContext {
  organizationId: string;
  userId: string | null;
  actor: string;
}

const openLotStatuses = new Set([
  "En recepción",
  "En selección",
  "En pesaje",
  "Palletizado",
  "Listo para exportación",
  "Parcialmente rechazado",
]);
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

/** An existing lot is an explicit continuation, never a fallback for a missing ID. */
export function validateReceptionOrigin(
  data: Data,
  values: ReceptionCreationValues,
  organizationId: string,
) {
  const producer = data.producers.find(
    (row) =>
      row.id === values.producerId && row.organization_id === organizationId,
  );
  if (!producer || producer.status !== "Activo")
    throw new Error("Seleccione un productor activo.");
  const plot = values.plotId
    ? data.plots.find(
        (row) =>
          row.id === values.plotId && row.organization_id === organizationId,
      )
    : undefined;
  if (values.plotId && (!plot || plot.status !== "Activo"))
    throw new Error("Seleccione una parcela activa válida.");
  const farm = plot
    ? data.farms.find((row) => row.id === plot.farm_id)
    : undefined;
  if (
    plot &&
    (!farm ||
      farm.organization_id !== organizationId ||
      farm.producer_id !== producer.id ||
      farm.status !== "Activo")
  )
    throw new Error("La parcela pertenece a otro productor o no está activa.");

  const lot = values.lotId
    ? data.field_lots.find(
        (row) =>
          row.id === values.lotId && row.organization_id === organizationId,
      )
    : undefined;
  if (values.lotId && !lot)
    throw new Error(
      "El lote seleccionado ya no está disponible. Seleccione otro o cree uno nuevo.",
    );
  if (lot) {
    if (!openLotStatuses.has(lot.status))
      throw new Error(
        "El lote está cerrado. Cree un nuevo lote para esta entrega.",
      );
    if (
      (lot.plot_id ?? "") !== values.plotId ||
      (lot.producer_id && lot.producer_id !== producer.id) ||
      (!lot.producer_id && !farm)
    )
      throw new Error("El lote pertenece a otro origen.");
    if (values.harvest !== (lot.harvest_date ?? ""))
      throw new Error(
        "La cosecha del lote existente se conserva. Para otra cosecha, cree un nuevo lote.",
      );
  }

  if (!validDate(values.date))
    throw new Error("Ingrese una fecha de recepción válida.");
  if (values.harvest && !validDate(values.harvest))
    throw new Error("Ingrese una fecha de cosecha válida.");
  if (values.harvest && values.harvest > values.date)
    throw new Error("La cosecha no puede ser posterior a la recepción.");
  if (!lot && values.lotCode.trim().length > 80)
    throw new Error("El código del lote debe tener hasta 80 caracteres.");
  if (
    !lot &&
    values.lotCode.trim() &&
    data.field_lots.some(
      (row) =>
        row.organization_id === organizationId &&
        row.code === values.lotCode.trim(),
    )
  )
    throw new Error(
      "Ya existe un lote con este código. Use otro para la nueva entrega.",
    );
  return { producer, plot, lot };
}

/** Adds a separate delivery to the caller's draft; existing deliveries stay intact. */
export function createReception(
  data: Data,
  values: ReceptionCreationValues,
  context: ReceptionCreationContext,
): Reception {
  const { organizationId: org, userId: user, actor } = context;
  const source = validateReceptionOrigin(data, values, org);
  const responsible = values.responsible.trim();
  if (!responsible || responsible.length > 200)
    throw new Error("Indique el responsable, con hasta 200 caracteres.");
  if (values.notes.length > 5000)
    throw new Error("Las observaciones deben tener hasta 5.000 caracteres.");
  if (!values.weights.length || values.weights.length > 1000)
    throw new Error("Agregue entre 1 y 1.000 pesajes para esta entrega.");
  if (
    values.weights.some(
      (weight) =>
        !Number.isFinite(weight) ||
        weight <= 0 ||
        weight > 999999999999.99 ||
        round(weight) !== weight,
    )
  )
    throw new Error(
      "Cada pesaje debe ser positivo, en kg y con hasta dos decimales.",
    );
  const total = summary(values.weights).total;
  if (total > 999999999999.99)
    throw new Error("El total recibido supera el límite admitido en kg.");
  const selection = values.classifyNow
    ? intakeSelection(total, values.rejectedKg, values.rejectionReason)
    : null;
  const photoIds = new Set<string>();
  for (const photo of values.photos ?? []) {
    if (
      !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
        photo.id,
      ) ||
      photoIds.has(photo.id) ||
      data.attachments.some((row) => row.id === photo.id) ||
      !photo.name.trim() ||
      !photo.mime.trim() ||
      !Number.isSafeInteger(photo.size) ||
      photo.size <= 0 ||
      photo.size > 10 * 1024 * 1024
    )
      throw new Error(
        "Revise las fotos de esta recepción; no reutilice adjuntos de otra entrega.",
      );
    photoIds.add(photo.id);
  }

  const logs: AuditLog[] = [];
  const record = (table: Table, id: string, action: string, after: unknown) => {
    logs.push({
      ...base(org, "Activo", user),
      entity_type: table,
      entity_id: id,
      action,
      actor,
      before: null,
      after: structuredClone(after),
      reason: "",
    });
  };
  const lot: FieldLot = source.lot ?? {
    ...base(org, "En recepción", user),
    plot_id: source.plot?.id ?? null,
    producer_id: source.producer.id,
    code: values.lotCode.trim() || code("SAN"),
    crop: "Sandía",
    variety: source.plot?.variety ?? "",
    harvest_date: values.harvest || null,
    notes: "",
  };
  const reception: Reception = {
    ...base(org, "Confirmado", user),
    lot_id: lot.id,
    date: values.date,
    responsible,
    notes: values.notes,
  };
  const weights = values.weights.map((weight, i) => ({
    ...base(org, "Activo", user),
    reception_id: reception.id,
    sequence: i + 1,
    kg: weight,
    operator: responsible,
    notes: "",
    correction_reason: "",
  }));
  const classification = selection
    ? {
        ...base(org, "Activo", user),
        reception_id: reception.id,
        approved_kg: selection.approved,
        rejected_kg: selection.rejected,
        approved_count: null,
        rejected_count: null,
        reason: selection.rejected > 0 ? values.rejectionReason : "",
        size: "",
        quality: null,
        notes: "Selección registrada al recibir la carga.",
        region:
          values.region ||
          source.producer.community ||
          source.plot?.location ||
          "",
        pest_observation: values.pestObservation,
        symptoms: values.symptoms,
      }
    : null;
  const attachments: Attachment[] = (values.photos ?? []).map((photo) => ({
    ...base(org, "Activo", user),
    id: photo.id,
    entity_type: "receptions",
    entity_id: reception.id,
    name: photo.name,
    mime: photo.mime,
    size: photo.size,
    storage_path: `${org}/${photo.id}/${photo.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
  }));
  if (!source.lot) {
    if (selection)
      lot.status =
        selection.approved === 0
          ? "Rechazado"
          : selection.rejected > 0
            ? "Parcialmente rechazado"
            : "En pesaje";
    record("field_lots", lot.id, "Lote creado", lot);
  }
  if (classification)
    record(
      "classifications",
      classification.id,
      "Clasificación registrada",
      classification,
    );
  for (const attachment of attachments)
    record("attachments", attachment.id, "Adjunto agregado", {
      name: attachment.name,
    });
  record("receptions", reception.id, "Recepción creada", {
    ...reception,
    total_kg: total,
  });

  // Validation/build complete before the supplied draft is changed.
  if (!source.lot) data.field_lots.push(lot);
  data.receptions.push(reception);
  data.reception_weights.push(...weights);
  if (classification) data.classifications.push(classification);
  data.attachments.push(...attachments);
  data.audit_logs.push(...logs);
  return reception;
}
