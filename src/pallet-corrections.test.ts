import { describe, expect, it } from "vitest";
import { base, receptionTotal } from "./domain";
import {
  assertPalletCorrection,
  palletCorrectionSource,
  parsePalletCorrection,
} from "./pallet-corrections";
import type {
  PalletCorrectionDraft,
  PalletCorrectionValues,
} from "./pallet-corrections";
import { seed } from "./test-fixtures";
import type { Pallet } from "./types";

function fixture() {
  const data = seed();
  const reception = data.receptions[0];
  const org = reception.organization_id;
  data.reception_weights = [{ ...data.reception_weights[0], kg: 1000 }];
  data.classifications = [
    {
      ...base(org),
      reception_id: reception.id,
      approved_kg: 1000,
      rejected_kg: 0,
      approved_count: null,
      rejected_count: null,
      reason: "",
      size: "",
      quality: null,
      notes: "",
    },
  ];
  const pallet: Pallet = {
    ...base(org, "Etiquetado"),
    code: "PAL-ORIGINAL",
    token: crypto.randomUUID(),
    destination: "Uruguay",
    assembled_at: "2026-10-01T12:00:00Z",
    weighed_date: null,
    responsible: "Responsable real",
    gross_kg: null,
    net_kg: 400,
    fruit_count: null,
    notes: "",
  };
  const other = { ...pallet, ...base(org, "En armado"), net_kg: 300 };
  data.pallets = [pallet, other];
  data.pallet_items = [pallet, other].map((item) => ({
    ...base(org),
    pallet_id: item.id,
    reception_id: reception.id,
    kg: item.net_kg,
  }));
  return { data, pallet, other, reception };
}

function draft(
  overrides: Partial<PalletCorrectionDraft> = {},
): PalletCorrectionDraft {
  return {
    netKg: "400",
    grossKg: "",
    fruitCount: "",
    weighedDate: "",
    responsible: "Responsable real",
    notes: "",
    reason: "Corregir un dato digitado",
    ...overrides,
  };
}

describe("corrección de pallets", () => {
  it("corrige con tara 42 sumada al neto sin descontarla del peso de sandía", () => {
    const { data, pallet } = fixture();
    const values = parsePalletCorrection(
      data,
      pallet,
      draft({ netKg: "390,25", tareKg: 42 }),
    );
    expect(values).toMatchObject({
      netKg: 390.25,
      tareKg: 42,
      grossKg: 432.25,
    });
    expect(() =>
      assertPalletCorrection(data, pallet, { ...values, grossKg: 390.25 }),
    ).toThrow(/neto más la tara/);
    expect(pallet.net_kg).toBe(400);
  });
  it("admite coma decimal y conserva datos opcionales desconocidos", () => {
    const { data, pallet } = fixture();
    const values = parsePalletCorrection(
      data,
      pallet,
      draft({
        netKg: "390,25",
        grossKg: "400.25",
        reason: "  Peso digitado  ",
      }),
    );
    expect(values).toMatchObject({
      netKg: 390.25,
      grossKg: 400.25,
      fruitCount: null,
      weighedDate: null,
      reason: "Peso digitado",
    });
    expect(pallet.net_kg).toBe(400);
  });

  it("limita el nuevo neto al saldo real incluyendo la asignación actual", () => {
    const { data, pallet, other, reception } = fixture();
    expect(palletCorrectionSource(data, pallet)).toMatchObject({
      receptionId: reception.id,
      maxNetKg: 700,
    });
    expect(
      parsePalletCorrection(data, pallet, draft({ netKg: "700" })).netKg,
    ).toBe(700);
    expect(() =>
      parsePalletCorrection(data, pallet, draft({ netKg: "700.01" })),
    ).toThrow(/saldo aprobado/);
    other.status = "Cancelado";
    expect(palletCorrectionSource(data, pallet).maxNetKg).toBe(1000);
  });

  it("exige conciliación para asignaciones divergentes, duplicadas o inactivas", () => {
    const { data, pallet } = fixture();
    const assertWeightBlocked = () => {
      expect(palletCorrectionSource(data, pallet).maxNetKg).toBeNull();
      expect(() =>
        parsePalletCorrection(data, pallet, draft({ netKg: "390" })),
      ).toThrow(/conciliación/);
      expect(
        parsePalletCorrection(data, pallet, draft({ notes: "Dato confirmado" }))
          .notes,
      ).toBe("Dato confirmado");
    };
    data.pallet_items[0].kg = 350;
    assertWeightBlocked();
    data.pallet_items[0].kg = pallet.net_kg;
    data.pallet_items[0].status = "Cancelado";
    assertWeightBlocked();
    data.pallet_items[0].status = "Activo";
    data.pallet_items.push({
      ...data.pallet_items[0],
      ...base(pallet.organization_id),
      status: "Cancelado",
    });
    assertWeightBlocked();
  });

  it("permite otros datos de origen múltiple pero exige distribución para cambiar neto", () => {
    const { data, pallet, reception } = fixture();
    const second = { ...reception, ...base(reception.organization_id) };
    data.receptions.push(second);
    data.pallet_items.push({
      ...data.pallet_items[0],
      ...base(reception.organization_id),
      reception_id: second.id,
      kg: 100,
    });
    expect(palletCorrectionSource(data, pallet).maxNetKg).toBeNull();
    expect(
      parsePalletCorrection(data, pallet, draft({ notes: "Dato confirmado" }))
        .notes,
    ).toBe("Dato confirmado");
    expect(() =>
      parsePalletCorrection(data, pallet, draft({ netKg: "390" })),
    ).toThrow(/varias recepciones/);
  });

  it("no cambia el neto sin clasificación activa ni origen válido", () => {
    const { data, pallet, reception } = fixture();
    data.classifications[0].status = "Cancelado";
    expect(() =>
      parsePalletCorrection(data, pallet, draft({ netKg: "399" })),
    ).toThrow(/activa y clasificada/);
    expect(parsePalletCorrection(data, pallet, draft()).netKg).toBe(400);
    reception.status = "Cancelado";
    expect(palletCorrectionSource(data, pallet).maxNetKg).toBeNull();
    data.pallet_items = [];
    expect(palletCorrectionSource(data, pallet).blockedReason).toMatch(
      /origen confirmada/,
    );
  });

  it("valida tara, números, cantidades enteras y fechas reales sin redondear errores", () => {
    const { data, pallet } = fixture();
    for (const values of [
      draft({ netKg: "0" }),
      draft({ netKg: "390.255" }),
      draft({ netKg: "1e2" }),
      draft({ netKg: "-5" }),
      draft({ grossKg: "390" }),
      draft({ fruitCount: "2,5" }),
      draft({ fruitCount: "2147483648" }),
      draft({ weighedDate: "2026-02-29" }),
      draft({ weighedDate: "01/10/2026" }),
      draft({ responsible: " " }),
      draft({ reason: " " }),
      draft({ notes: "x".repeat(5001) }),
    ])
      expect(() => parsePalletCorrection(data, pallet, values)).toThrow();
    expect(
      parsePalletCorrection(
        data,
        pallet,
        draft({ fruitCount: "0", weighedDate: "2024-02-29" }),
      ),
    ).toMatchObject({ fruitCount: 0, weighedDate: "2024-02-29" });
    const values = parsePalletCorrection(data, pallet, draft());
    expect(() =>
      assertPalletCorrection(data, pallet, { ...values, netKg: Number.NaN }),
    ).toThrow(/neto válido/);
  });

  it("cancela con motivo sin borrar registros ni cambiar el total recibido", () => {
    const { data, pallet, reception } = fixture();
    const before = structuredClone(data);
    const values: PalletCorrectionValues = {
      action: "cancel",
      reason: "Pallet duplicado",
    };
    assertPalletCorrection(data, pallet, values);
    expect(data).toEqual(before);
    expect(receptionTotal(data, reception.id)).toBe(1000);
    expect(() =>
      assertPalletCorrection(data, pallet, { action: "cancel", reason: "" }),
    ).toThrow(/motivo/);
  });

  it("protege registros expedidos, cancelados, vinculados a carga y ajenos", () => {
    const { data, pallet } = fixture();
    const cancel: PalletCorrectionValues = {
      action: "cancel",
      reason: "Error confirmado",
    };
    pallet.status = "Expedido";
    expect(() => assertPalletCorrection(data, pallet, cancel)).toThrow(
      /expedido o cancelado/,
    );
    pallet.status = "Cancelado";
    expect(() => assertPalletCorrection(data, pallet, cancel)).toThrow(
      /expedido o cancelado/,
    );
    pallet.status = "En armado";
    data.shipment_pallets.push({
      ...base(pallet.organization_id),
      pallet_id: pallet.id,
      shipment_id: crypto.randomUUID(),
    });
    expect(() => assertPalletCorrection(data, pallet, cancel)).toThrow(
      /vinculado a una expedición/,
    );
    data.shipment_pallets = [];
    expect(() =>
      assertPalletCorrection(
        data,
        { ...pallet, organization_id: "otro" },
        cancel,
      ),
    ).toThrow(/ya no está disponible/);
  });
});
