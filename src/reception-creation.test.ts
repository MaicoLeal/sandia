import { describe, expect, it } from "vitest";
import { available, base, origin, receptionTotal } from "./domain";
import { createReception, validateReceptionOrigin } from "./reception-creation";
import type { ReceptionCreationValues } from "./reception-creation";
import { seed } from "./test-fixtures";

function fixture() {
  const data = seed();
  const organizationId = data.producers[0].organization_id;
  const context = {
    organizationId,
    userId: crypto.randomUUID(),
    actor: "Operador QA",
  };
  const input: ReceptionCreationValues = {
    producerId: data.producers[0].id,
    plotId: "",
    lotId: "",
    lotCode: "",
    date: "2026-10-12",
    harvest: "2026-10-11",
    responsible: "Operador QA",
    notes: "Entrega nueva",
    weights: [390, 410],
    classifyNow: true,
    rejectedKg: "5",
    rejectionReason: "Fruta dañada",
    region: "San Pedro",
    pestObservation: "Observación de esta carga",
    symptoms: "Revisar fruta",
    photos: [],
  };
  const first = data.receptions[0];
  data.classifications.push({
    ...base(organizationId),
    reception_id: first.id,
    approved_kg: receptionTotal(data, first.id),
    rejected_kg: 0,
    approved_count: null,
    rejected_count: null,
    reason: "",
    size: "",
    quality: null,
    notes: "",
  });
  const pallet = {
    ...base(organizationId, "Etiquetado"),
    code: "PAL-ANTERIOR-QA",
    token: crypto.randomUUID(),
    destination: "Uruguay",
    assembled_at: "2026-10-07T18:00:00Z",
    responsible: "Operador anterior",
    net_kg: 390,
    gross_kg: 432,
    tare_kg: 42,
    fruit_count: null,
    notes: "Anterior",
    metadata: {
      export_label: { afidi: "AFIDI-ANTERIOR", packaged_date: "2026-10-07" },
    },
  };
  data.pallets.push(pallet);
  data.pallet_items.push({
    ...base(organizationId),
    reception_id: first.id,
    pallet_id: pallet.id,
    kg: 390,
  });
  data.field_lots[0].status = "Palletizado";
  return { data, input, context };
}

describe("nuevas entregas del mismo productor", () => {
  it("crea dos entregas independientes, conserva productor y no cambia ningún registro anterior", () => {
    const { data, input, context } = fixture();
    const before = structuredClone(data);
    const first = createReception(data, input, context);
    const second = createReception(
      data,
      { ...input, weights: [210, 300], rejectedKg: "0" },
      context,
    );
    expect(first.id).not.toBe(second.id);
    expect(first.lot_id).not.toBe(second.lot_id);
    expect(origin(data, first.id).lot?.code).not.toBe(
      origin(data, second.id).lot?.code,
    );
    expect(origin(data, first.id).producer?.id).toBe(input.producerId);
    expect(origin(data, second.id).producer?.id).toBe(input.producerId);
    expect(receptionTotal(data, first.id)).toBe(800);
    expect(receptionTotal(data, second.id)).toBe(510);
    expect(available(data, first.id)).toBe(795);
    expect(available(data, second.id)).toBe(510);
    expect(receptionTotal(data, before.receptions[0].id)).toBe(3247);
    for (const table of Object.keys(before) as (keyof typeof before)[])
      expect(data[table].slice(0, before[table].length), table).toEqual(
        before[table],
      );
    expect(data.producers).toHaveLength(1);
    expect(data.pallets).toEqual(before.pallets);
    expect(data.pallet_items).toEqual(before.pallet_items);
  });

  it("continúa un lote abierto explícito sin reiniciar su estado, cosecha ni saldos anteriores", () => {
    const { data, input, context } = fixture();
    const lot = data.field_lots[0];
    const before = structuredClone(lot);
    const oldBalance = available(data, data.receptions[0].id);
    const continuation = {
      ...input,
      plotId: lot.plot_id!,
      lotId: lot.id,
      harvest: lot.harvest_date!,
    };
    const second = createReception(data, continuation, context);
    const third = createReception(
      data,
      { ...continuation, weights: [100], rejectedKg: "0" },
      context,
    );
    expect(data.field_lots).toHaveLength(1);
    expect(lot).toEqual(before);
    expect(second.lot_id).toBe(lot.id);
    expect(third.lot_id).toBe(lot.id);
    expect(available(data, data.receptions[0].id)).toBe(oldBalance);
    expect(available(data, second.id)).toBe(795);
    expect(available(data, third.id)).toBe(100);
    expect(
      data.reception_weights
        .filter((row) => row.reception_id === third.id)
        .map((row) => row.sequence),
    ).toEqual([1]);
  });

  it("mantiene cosecha desconocida sin copiar la referencia histórica del productor", () => {
    const { data, input, context } = fixture();
    data.producers[0].metadata = {
      harvest_reference: {
        date: "2026-10-02",
        season: 2026,
        status: "Confirmado",
        source: "Anterior",
        notes: [],
      },
    };
    const reception = createReception(
      data,
      { ...input, harvest: "", classifyNow: false },
      context,
    );
    expect(origin(data, reception.id).lot?.harvest_date).toBeNull();
    expect(origin(data, reception.id).lot?.status).toBe("En recepción");
    expect(
      data.classifications.filter((row) => row.reception_id === reception.id),
    ).toEqual([]);
    expect(available(data, reception.id)).toBe(0);
  });

  it("conserva pérdidas, síntomas, fotos y auditoría vinculados solo a la nueva recepción", () => {
    const { data, input, context } = fixture();
    const photo = {
      id: crypto.randomUUID(),
      name: "Carga nueva.jpg",
      mime: "image/jpeg",
      size: 100,
    };
    const reception = createReception(
      data,
      { ...input, photos: [photo] },
      context,
    );
    expect(
      data.classifications.find((row) => row.reception_id === reception.id),
    ).toMatchObject({
      rejected_kg: 5,
      approved_kg: 795,
      region: input.region,
      pest_observation: input.pestObservation,
      symptoms: input.symptoms,
    });
    expect(data.attachments[0]).toMatchObject({
      ...photo,
      entity_type: "receptions",
      entity_id: reception.id,
      storage_path: `${context.organizationId}/${photo.id}/Carga_nueva.jpg`,
    });
    expect(
      data.audit_logs.find((row) => row.entity_id === reception.id),
    ).toMatchObject({
      action: "Recepción creada",
      created_by: context.userId,
      actor: context.actor,
      after: { total_kg: 800 },
    });
    const lot = origin(data, reception.id).lot!;
    const log = data.audit_logs.find((row) => row.entity_id === lot.id)!;
    lot.status = "Palletizado";
    expect(log.after).toMatchObject({ status: "Parcialmente rechazado" });
  });

  it.each(["Expedido", "Rechazado", "Cancelado", "Desconocido"])(
    "rechaza continuación de lote %s",
    (status) => {
      const { data, input, context } = fixture();
      data.field_lots[0].status = status;
      const before = structuredClone(data);
      expect(() =>
        createReception(
          data,
          {
            ...input,
            lotId: data.field_lots[0].id,
            plotId: data.plots[0].id,
            harvest: data.field_lots[0].harvest_date!,
          },
          context,
        ),
      ).toThrow("cerrado");
      expect(data).toEqual(before);
    },
  );

  it("no convierte un identificador de lote inexistente en una nueva recepción silenciosa", () => {
    const { data, input, context } = fixture();
    const before = structuredClone(data);
    expect(() =>
      createReception(data, { ...input, lotId: crypto.randomUUID() }, context),
    ).toThrow("ya no está disponible");
    expect(data).toEqual(before);
  });

  it("no permite cruzar productor, parcela, lote ni organización", () => {
    const { data, input, context } = fixture();
    const second = {
      ...data.producers[0],
      ...base(context.organizationId),
      name: "Otro productor",
    };
    data.producers.push(second);
    expect(() =>
      validateReceptionOrigin(
        data,
        { ...input, producerId: second.id, plotId: data.plots[0].id },
        context.organizationId,
      ),
    ).toThrow("otro productor");
    const lot = {
      ...data.field_lots[0],
      ...base(context.organizationId, "En recepción"),
      producer_id: second.id,
      plot_id: null,
    };
    data.field_lots.push(lot);
    expect(() =>
      validateReceptionOrigin(
        data,
        { ...input, lotId: lot.id },
        context.organizationId,
      ),
    ).toThrow("otro origen");
    lot.organization_id = crypto.randomUUID();
    expect(() =>
      validateReceptionOrigin(
        data,
        { ...input, lotId: lot.id },
        context.organizationId,
      ),
    ).toThrow("ya no está disponible");
    data.farms[0].organization_id = crypto.randomUUID();
    expect(() =>
      validateReceptionOrigin(
        data,
        { ...input, plotId: data.plots[0].id },
        context.organizationId,
      ),
    ).toThrow("otro productor");
  });

  it("rechaza cambiar la cosecha de un lote existente y código duplicado en otro lote nuevo", () => {
    const { data, input, context } = fixture();
    const before = structuredClone(data);
    expect(() =>
      createReception(
        data,
        { ...input, lotId: data.field_lots[0].id, plotId: data.plots[0].id },
        context,
      ),
    ).toThrow("se conserva");
    expect(() =>
      createReception(
        data,
        { ...input, lotCode: data.field_lots[0].code },
        context,
      ),
    ).toThrow("Ya existe");
    expect(data).toEqual(before);
  });

  it.each([
    { date: "2026-02-30" },
    { harvest: "2026-02-30" },
    { harvest: "2026-10-13" },
    { date: "12/10/2026" },
    { weights: [] },
    { weights: [-1] },
    { weights: [NaN] },
    { weights: [0.001] },
    { rejectedKg: "801" },
    { responsible: " " },
  ])("rechaza entrada inválida sin mutar datos: %j", (difference) => {
    const { data, input, context } = fixture();
    const before = structuredClone(data);
    expect(() =>
      createReception(data, { ...input, ...difference }, context),
    ).toThrow();
    expect(data).toEqual(before);
  });

  it("no vuelve a adjuntar una foto anterior en otra entrega", () => {
    const { data, input, context } = fixture();
    const photo = {
      id: crypto.randomUUID(),
      name: "Carga.jpg",
      mime: "image/jpeg",
      size: 100,
    };
    createReception(data, { ...input, photos: [photo] }, context);
    const before = structuredClone(data);
    expect(() =>
      createReception(data, { ...input, photos: [photo] }, context),
    ).toThrow("adjuntos");
    expect(data).toEqual(before);
  });
});
