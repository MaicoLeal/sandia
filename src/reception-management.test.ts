import { describe, expect, it } from "vitest";
import { available, base, receptionTotal } from "./domain";
import {
  applyReceptionManagement,
  assertReceptionManagement,
  parseReceptionManagement,
  receptionManagementImpact,
} from "./reception-management";
import type {
  ReceptionManagementDraft,
  ReceptionManagementValues,
} from "./reception-management";
import { seed } from "./test-fixtures";
import type { Pallet } from "./types";

function fixture() {
  const data = seed();
  const reception = data.receptions[0];
  const org = reception.organization_id;
  const first = { ...data.reception_weights[0], kg: 400 };
  const second = { ...data.reception_weights[1], kg: 600 };
  data.reception_weights = [first, second];
  data.classifications = [
    {
      ...base(org),
      reception_id: reception.id,
      approved_kg: 900,
      rejected_kg: 100,
      approved_count: null,
      rejected_count: null,
      reason: "Fruta dañada",
      size: "Mediano",
      quality: 4,
      notes: "Dato técnico",
      region: "San Pedro",
      pest_observation: "Sin indicio",
    },
  ];
  const pallet: Pallet = {
    ...base(org, "Etiquetado"),
    code: "PAL-ORIGINAL",
    token: crypto.randomUUID(),
    destination: "Uruguay",
    assembled_at: "2026-10-01T12:00:00Z",
    weighed_date: "2026-10-01",
    responsible: "Piris",
    gross_kg: 442,
    net_kg: 400,
    fruit_count: null,
    notes: "",
  };
  const secondPallet = {
    ...pallet,
    ...base(org, "Listo para carga"),
    token: crypto.randomUUID(),
    code: "PAL-SEGUNDO",
    net_kg: 200,
    gross_kg: 242,
  };
  data.pallets = [pallet, secondPallet];
  data.pallet_items = data.pallets.map((row) => ({
    ...base(org),
    pallet_id: row.id,
    reception_id: reception.id,
    kg: row.net_kg,
  }));
  return { data, reception, first, second, pallet, secondPallet };
}

function draft(overrides: Partial<ReceptionManagementDraft> = {}) {
  const { first, second, reception } = fixture();
  return {
    date: reception.date,
    responsible: reception.responsible,
    notes: reception.notes,
    weights: [first, second].map((row) => ({
      id: row.id,
      kg: String(row.kg),
      operator: row.operator,
      notes: row.notes,
    })),
    rejectedKg: "100",
    lossReason: "Fruta dañada",
    reason: "Peso digitado por error",
    ...overrides,
  };
}

function currentDraft(
  context: ReturnType<typeof fixture>,
  overrides: Partial<ReceptionManagementDraft> = {},
) {
  return draft({
    weights: context.data.reception_weights.map((row) => ({
      id: row.id,
      kg: String(row.kg),
      operator: row.operator,
      notes: row.notes,
    })),
    ...overrides,
  });
}

describe("autonomía de recepción con historial", () => {
  it("no escribe auditoría ni fechas nuevas cuando no se cambió ningún dato", () => {
    const context = fixture();
    const before = structuredClone(context.data);
    const values = parseReceptionManagement(
      context.data,
      context.reception,
      currentDraft(context),
    );
    const logs: unknown[][] = [];
    applyReceptionManagement(
      context.data,
      context.reception.id,
      values,
      (...args) => logs.push(args.slice(1)),
    );
    expect(context.data).toEqual(before);
    expect(logs).toEqual([]);
  });
  it("corrige peso neto con coma sin volver a descontar los 42 kg del embalaje", () => {
    const context = fixture();
    const weights = currentDraft(context).weights;
    weights[0].kg = "390,25";
    const values = parseReceptionManagement(
      context.data,
      context.reception,
      currentDraft(context, { weights }),
    );
    expect(values.weights[0].kg).toBe(390.25);
    expect(values.classification).toMatchObject({
      rejected_kg: 100,
      reason: "Fruta dañada",
    });
    expect(receptionTotal(context.data, context.reception.id)).toBe(1000);
  });

  it("sustituye un pesaje duplicado sin borrar identificadores ni versiones anteriores", () => {
    const context = fixture();
    const { data, reception, first, second } = context;
    const newId = crypto.randomUUID();
    const values = parseReceptionManagement(
      data,
      reception,
      currentDraft(context, {
        weights: [
          {
            id: first.id,
            kg: "700",
            operator: first.operator,
            notes: first.notes,
          },
          {
            id: newId,
            kg: "100",
            operator: "Piris",
            notes: "Faltante confirmado",
          },
        ],
        rejectedKg: "100",
      }),
    );
    const logs: unknown[][] = [];
    const sourcesBefore = structuredClone(data.pallet_items);
    const labelBefore = structuredClone(data.pallets);
    applyReceptionManagement(
      data,
      reception.id,
      values,
      (...args) => logs.push(args.slice(1)),
      "usuario-real",
    );
    expect(data.reception_weights).toHaveLength(3);
    expect(
      data.reception_weights.find((row) => row.id === second.id),
    ).toMatchObject({
      kg: 600,
      status: "Cancelado",
      sequence: 2,
      correction_reason: values.reason,
    });
    expect(
      data.reception_weights.find((row) => row.id === first.id),
    ).toMatchObject({ kg: 700, status: "Activo", sequence: 1 });
    expect(
      data.reception_weights.find((row) => row.id === newId),
    ).toMatchObject({ kg: 100, sequence: 3, created_by: "usuario-real" });
    expect(receptionTotal(data, reception.id)).toBe(800);
    expect(data.classifications[0]).toMatchObject({
      approved_kg: 700,
      rejected_kg: 100,
      quality: 4,
      notes: "Dato técnico",
      region: "San Pedro",
      pest_observation: "Sin indicio",
    });
    expect(available(data, reception.id)).toBe(100);
    expect(data.pallet_items).toEqual(sourcesBefore);
    expect(data.pallets).toEqual(labelBefore);
    expect(logs).toContainEqual(
      expect.arrayContaining([
        "reception_weights",
        second.id,
        "Pesaje cancelado",
        expect.objectContaining({ kg: 600, status: "Activo" }),
        expect.objectContaining({ kg: 600, status: "Cancelado" }),
        values.reason,
      ]),
    );
  });

  it("bloquea el nuevo aprobado debajo de los kg ya asignados a pallets", () => {
    const context = fixture();
    expect(
      receptionManagementImpact(context.data, context.reception).allocatedKg,
    ).toBe(600);
    expect(() =>
      parseReceptionManagement(
        context.data,
        context.reception,
        currentDraft(context, {
          weights: [{ ...currentDraft(context).weights[0], kg: "699,99" }],
        }),
      ),
    ).toThrow(/ya palletizado/);
    expect(
      parseReceptionManagement(
        context.data,
        context.reception,
        currentDraft(context, {
          weights: [{ ...currentDraft(context).weights[0], kg: "700" }],
        }),
      ).weights[0].kg,
    ).toBe(700);
  });

  it("cancela toda la recepción y sus pallets con confirmación, conservando sus trazas", () => {
    const { data, reception } = fixture();
    const beforeItems = structuredClone(data.pallet_items);
    const beforeCodes = data.pallets.map((row) => [
      row.id,
      row.code,
      row.token,
      row.net_kg,
      row.gross_kg,
    ]);
    const values: ReceptionManagementValues = {
      action: "cancel",
      reason: "Recepción duplicada",
      confirmPallets: false,
    };
    expect(() => assertReceptionManagement(data, reception, values)).toThrow(
      /Confirme también/,
    );
    values.confirmPallets = true;
    const logs: unknown[][] = [];
    applyReceptionManagement(data, reception.id, values, (...args) =>
      logs.push(args.slice(1)),
    );
    expect(reception.status).toBe("Cancelado");
    expect(
      data.reception_weights.every((row) => row.status === "Cancelado"),
    ).toBe(true);
    expect(data.classifications[0].status).toBe("Cancelado");
    expect(data.pallets.every((row) => row.status === "Cancelado")).toBe(true);
    expect(data.pallet_items).toEqual(beforeItems);
    expect(
      data.pallets.map((row) => [
        row.id,
        row.code,
        row.token,
        row.net_kg,
        row.gross_kg,
      ]),
    ).toEqual(beforeCodes);
    expect(receptionTotal(data, reception.id)).toBe(0);
    expect(available(data, reception.id)).toBe(0);
    expect(logs.filter((entry) => entry[0] === "pallets")).toHaveLength(2);
  });

  it("impide cancelar pallets compartidos y corregir recepciones vinculadas a cargas", () => {
    const { data, reception, pallet } = fixture();
    const other = { ...reception, ...base(reception.organization_id) };
    data.receptions.push(other);
    data.pallet_items.push({
      ...data.pallet_items[0],
      ...base(reception.organization_id),
      reception_id: other.id,
      kg: 50,
    });
    expect(() =>
      assertReceptionManagement(data, reception, {
        action: "cancel",
        reason: "Duplicado",
        confirmPallets: true,
      }),
    ).toThrow(/otras recepciones/);
    expect(receptionManagementImpact(data, reception).editBlockedReason).toBe(
      "",
    );
    data.shipment_pallets.push({
      ...base(reception.organization_id),
      pallet_id: pallet.id,
      shipment_id: crypto.randomUUID(),
    });
    expect(() =>
      assertReceptionManagement(data, reception, {
        action: "cancel",
        reason: "Duplicado",
        confirmPallets: true,
      }),
    ).toThrow(/carga/);
    expect(() =>
      parseReceptionManagement(
        data,
        reception,
        currentDraft({ data, reception } as ReturnType<typeof fixture>),
      ),
    ).toThrow(/carga/);
  });

  it("vuelve a preparar etiquetas solo cuando cambia la fecha de recepción", () => {
    const context = fixture();
    const before = context.data.pallets.map((row) => [
      row.code,
      row.token,
      row.net_kg,
    ]);
    const values = parseReceptionManagement(
      context.data,
      context.reception,
      currentDraft(context, { date: "2026-10-02" }),
    );
    const logs: unknown[][] = [];
    applyReceptionManagement(
      context.data,
      context.reception.id,
      values,
      (...args) => logs.push(args.slice(1)),
    );
    expect(context.data.pallets.map((row) => row.status)).toEqual([
      "En armado",
      "En armado",
    ]);
    expect(
      context.data.pallets.map((row) => [row.code, row.token, row.net_kg]),
    ).toEqual(before);
    expect(logs.filter((entry) => entry[0] === "pallets")).toHaveLength(2);
  });

  it("rechaza pesos vacíos, valores no válidos, pérdidas y fechas imposibles", () => {
    const context = fixture();
    for (const overrides of [
      { weights: [] },
      { weights: [{ ...currentDraft(context).weights[0], kg: "0" }] },
      { weights: [{ ...currentDraft(context).weights[0], kg: "1e3" }] },
      { weights: [{ ...currentDraft(context).weights[0], kg: "700.001" }] },
      { weights: [{ ...currentDraft(context).weights[0], id: "invalid" }] },
      { date: "2026-02-29" },
      { responsible: " " },
      { reason: " " },
      { rejectedKg: "1001" },
      { rejectedKg: "100", lossReason: "" },
    ])
      expect(() =>
        parseReceptionManagement(
          context.data,
          context.reception,
          currentDraft(context, overrides),
        ),
      ).toThrow();
  });

  it("no reutiliza un pesaje cancelado o un identificador de otra recepción", () => {
    const context = fixture();
    const cancelled = {
      ...context.first,
      ...base(context.reception.organization_id, "Cancelado"),
      sequence: 3,
    };
    context.data.reception_weights.push(cancelled);
    expect(() =>
      parseReceptionManagement(
        context.data,
        context.reception,
        currentDraft(context, {
          weights: [
            { id: cancelled.id, kg: "1000", operator: "Piris", notes: "" },
          ],
        }),
      ),
    ).toThrow(/reutilizar/);
    const other = {
      ...context.first,
      ...base(context.reception.organization_id),
      reception_id: crypto.randomUUID(),
    };
    context.data.reception_weights.push(other);
    expect(() =>
      parseReceptionManagement(
        context.data,
        context.reception,
        currentDraft(context, {
          weights: [{ id: other.id, kg: "1000", operator: "Piris", notes: "" }],
        }),
      ),
    ).toThrow(/reutilizar/);
  });

  it("permite corregir una recepción sin selección sin fabricar clasificación ni pérdidas", () => {
    const context = fixture();
    context.data.classifications = [];
    context.data.pallets = [];
    context.data.pallet_items = [];
    const values = parseReceptionManagement(
      context.data,
      context.reception,
      currentDraft(context, {
        weights: [{ ...currentDraft(context).weights[0], kg: "390" }],
      }),
    );
    expect(values.classification).toBeNull();
    applyReceptionManagement(
      context.data,
      context.reception.id,
      values,
      () => {},
    );
    expect(context.data.classifications).toEqual([]);
    expect(receptionTotal(context.data, context.reception.id)).toBe(390);
  });
});
