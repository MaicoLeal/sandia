import { describe, expect, it } from "vitest";
import { emptyData, receptionTotal } from "../domain";
import type { AuditLog, Base, Data, Table, Workspace } from "../types";
import { reconcileNewReceipts } from "./workspace-new-receipts-reconciliation";

const org = "20000000-0000-4000-8000-000000000001";
const user = "10000000-0000-4000-8000-000000000001";
let sequence = 0;
const id = () =>
  `30000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
function base(status = "Activo"): Base {
  return {
    id: id(),
    organization_id: org,
    created_by: user,
    status,
    created_at: "2026-10-07T10:00:00Z",
    updated_at: "2026-10-07T10:00:00Z",
  };
}
function audit(
  table: Table,
  row: Base,
  action: string,
  before: unknown,
  after: unknown,
): AuditLog {
  return {
    ...base(),
    entity_type: table,
    entity_id: row.id,
    action,
    actor: "Operador",
    before: structuredClone(before),
    after: structuredClone(after),
    reason: "",
  };
}
function fixture() {
  const workspace: Workspace = {
    data: emptyData(),
    pending: false,
    localOnly: false,
    organizationId: org,
    revision: 80,
    profile: {
      ...base(),
      user_id: user,
      name: "Operador",
      role: "administrador",
    },
    features: { pallet_tare: true, label_export_data: true },
    trapInstallations: [],
  };
  const producer = {
    ...base(),
    name: "Productor ya guardado",
    document: "",
    phone: "",
    community: "San Pedro",
    address: "",
    notes: "",
    metadata: { internal_code: "AGN-001" },
  };
  const lot = {
    ...base("Palletizado"),
    plot_id: null,
    producer_id: producer.id,
    code: "LOT-BASE",
    crop: "Sandía",
    variety: "",
    harvest_date: null,
    notes: "",
  };
  workspace.data.producers.push(producer);
  workspace.data.field_lots.push(lot);
  const receipt = {
    ...base("Confirmado"),
    lot_id: lot.id,
    date: "2026-10-01",
    responsible: "Operador",
    notes: "",
  };
  const weight = {
    ...base(),
    reception_id: receipt.id,
    sequence: 1,
    kg: 1000,
    operator: "Operador",
    notes: "",
    correction_reason: "",
  };
  const classification = {
    ...base(),
    reception_id: receipt.id,
    approved_kg: 1000,
    rejected_kg: 0,
    approved_count: null,
    rejected_count: null,
    reason: "",
    size: "",
    quality: null,
    notes: "",
  };
  const pallet = {
    ...base("En armado"),
    code: "PAL-BASE",
    token: id(),
    destination: "Pendiente de confirmar",
    assembled_at: "2026-10-01T12:00:00Z",
    weighed_date: null,
    responsible: "Operador",
    gross_kg: 1042,
    tare_kg: 42,
    net_kg: 1000,
    fruit_count: null,
    notes: "",
    metadata: { export_label: {} },
  };
  workspace.data.receptions.push(receipt);
  workspace.data.reception_weights.push(weight);
  workspace.data.classifications.push(classification);
  workspace.data.pallets.push(pallet);
  workspace.data.pallet_items.push({
    ...base(),
    pallet_id: pallet.id,
    reception_id: receipt.id,
    kg: 1000,
  });
  const local = structuredClone(workspace),
    remote = structuredClone(workspace);
  local.pending = true;
  remote.revision = 87;
  const beforeProducer = structuredClone(remote.data.producers[0]);
  remote.data.producers[0].metadata = {
    ...beforeProducer.metadata,
    export_code: "SPE-GUA-999-SAN",
    export_origin: "San Pedro – Paraguay",
  };
  remote.data.audit_logs.push(
    audit(
      "producers",
      remote.data.producers[0],
      "Actualización · producers",
      beforeProducer,
      remote.data.producers[0],
    ),
  );
  const beforePallet = structuredClone(remote.data.pallets[0]);
  remote.data.pallets[0].destination = "Uruguay";
  remote.data.pallets[0].metadata = {
    export_label: {
      afidi: "1571652",
      producer_code: "SPE-GUA-999-SAN",
      packaged_date: "2026-10-07",
      importer_name: "IMPORTADOR REAL",
      importer_address: "DOMICILIO REAL",
    },
  };
  remote.data.audit_logs.push(
    audit(
      "pallets",
      remote.data.pallets[0],
      "Actualización · pallets",
      beforePallet,
      remote.data.pallets[0],
    ),
  );
  return { local, remote };
}
function addReceipt(
  local: Workspace,
  weights = [800, 1200],
  options: {
    oldLot?: boolean;
    classify?: boolean;
    pallet?: boolean;
    photo?: boolean;
  } = {},
) {
  const lot = options.oldLot
    ? local.data.field_lots[0]
    : {
        ...base("En recepción"),
        plot_id: null,
        producer_id: local.data.producers[0].id,
        code: `LOT-${id()}`,
        crop: "Sandía",
        variety: "",
        harvest_date: "2026-10-07",
        notes: "",
      };
  if (!options.oldLot) {
    local.data.field_lots.push(lot);
    local.data.audit_logs.push(
      audit("field_lots", lot, "Lote creado", null, lot),
    );
  }
  const receipt = {
    ...base("Confirmado"),
    lot_id: lot.id,
    date: "2026-10-07",
    responsible: "Operador",
    notes: "Nueva entrega real",
  };
  local.data.receptions.push(receipt);
  for (const [index, kg] of weights.entries())
    local.data.reception_weights.push({
      ...base(),
      reception_id: receipt.id,
      sequence: index + 1,
      kg,
      operator: "Operador",
      notes: "",
      correction_reason: "",
    });
  if (options.classify) {
    const classification = {
      ...base(),
      reception_id: receipt.id,
      approved_kg: weights.reduce((a, b) => a + b, 0) - 50,
      rejected_kg: 50,
      approved_count: null,
      rejected_count: null,
      reason: "Fruta dañada",
      size: "",
      quality: null,
      notes: "",
      region: "San Pedro",
      pest_observation: "",
      symptoms: "",
    };
    local.data.classifications.push(classification);
    local.data.audit_logs.push(
      audit(
        "classifications",
        classification,
        "Clasificación registrada",
        null,
        classification,
      ),
    );
    lot.status = "Parcialmente rechazado";
    if (options.pallet) {
      const net = classification.approved_kg;
      const pallet = {
        ...base("En armado"),
        code: `PAL-${id()}`,
        token: id(),
        destination: "Uruguay",
        assembled_at: "2026-10-07T10:00:00Z",
        weighed_date: "2026-10-07",
        responsible: "Operador",
        gross_kg: net + 42,
        tare_kg: 42,
        net_kg: net,
        fruit_count: null,
        notes: "",
      };
      local.data.pallets.push(pallet);
      local.data.pallet_items.push({
        ...base(),
        pallet_id: pallet.id,
        reception_id: receipt.id,
        kg: net,
      });
      local.data.audit_logs.push(
        audit("pallets", pallet, "Pallet creado", null, pallet),
      );
      lot.status = "Palletizado";
    }
  }
  if (options.photo) {
    const photoId = id();
    const photo = {
      ...base(),
      id: photoId,
      entity_type: "receptions" as const,
      entity_id: receipt.id,
      name: "carga.jpg",
      mime: "image/jpeg",
      size: 2048,
      storage_path: `${org}/${photoId}/carga.jpg`,
    };
    local.data.attachments.push(photo);
    local.data.audit_logs.push(
      audit("attachments", photo, "Adjunto agregado", null, {
        name: photo.name,
      }),
    );
  }
  local.data.audit_logs.push(
    audit("receptions", receipt, "Recepción creada", null, {
      ...receipt,
      total_kg: weights.reduce((a, b) => a + b, 0),
    }),
  );
  return receipt;
}
const total = (data: Data) =>
  data.receptions.reduce(
    (sum, receipt) => sum + receptionTotal(data, receipt.id),
    0,
  );

describe("recuperación limitada de recibimientos nuevos auditados", () => {
  it("conserva una corrección remota de kilos y tara mientras agrega otra entrega, sin restaurar los valores antiguos", () => {
    const { local, remote } = fixture();
    local.data.pallets[0].gross_kg = 4000;
    local.data.pallets[0].tare_kg = 3000;
    const before = structuredClone(local.data.pallets[0]);
    for (const table of ["reception_weights", "classifications"] as const) {
      const old = structuredClone(remote.data[table][0]);
      if (table === "reception_weights")
        remote.data.reception_weights[0].kg = 1019;
      else remote.data.classifications[0].approved_kg = 1019;
      remote.data.audit_logs.push(
        audit(
          table,
          remote.data[table][0],
          `Actualización · ${table}`,
          old,
          remote.data[table][0],
        ),
      );
    }
    remote.data.pallets[0].net_kg = 1019;
    remote.data.pallets[0].gross_kg = 1061;
    remote.data.pallet_items[0].kg = 1019;
    remote.data.audit_logs.push(
      audit(
        "pallets",
        remote.data.pallets[0],
        "Actualización · pallets",
        before,
        remote.data.pallets[0],
      ),
    );
    const oldItem = structuredClone(local.data.pallet_items[0]);
    remote.data.audit_logs.push(
      audit(
        "pallet_items",
        remote.data.pallet_items[0],
        "Actualización · pallet_items",
        oldItem,
        remote.data.pallet_items[0],
      ),
    );
    addReceipt(local, [300, 200]);
    const result = reconcileNewReceipts(local, remote);
    expect(total(result.data)).toBe(1519);
    expect(result.data.reception_weights[0]).toEqual(
      remote.data.reception_weights[0],
    );
    expect(result.data.classifications[0]).toEqual(
      remote.data.classifications[0],
    );
    expect(result.data.pallets[0]).toEqual(remote.data.pallets[0]);
    expect(result.data.pallets[0].tare_kg).toBe(42);
    expect(result.data.pallet_items[0]).toEqual(remote.data.pallet_items[0]);
  });
  it("suma entregas nuevas sin sobrescribir etiquetas, origen, pesos, QR o revisiones del servidor", () => {
    const { local, remote } = fixture();
    addReceipt(local, [800, 1200], {
      classify: true,
      pallet: true,
      photo: true,
    });
    addReceipt(local, [175, 225]);
    const savedLocal = structuredClone(local),
      savedRemote = structuredClone(remote);
    const merged = reconcileNewReceipts(local, remote);
    expect(merged.revision).toBe(87);
    expect(merged.pending).toBe(true);
    expect(merged.needsRefresh).toBe(false);
    expect(total(merged.data)).toBe(3400);
    for (const table of Object.keys(remote.data) as Table[])
      for (const row of remote.data[table])
        expect(merged.data[table].find((value) => value.id === row.id)).toEqual(
          row,
        );
    expect(merged.data.pallets[0]).toEqual(remote.data.pallets[0]);
    expect(merged.data.attachments).toHaveLength(1);
    expect(local).toEqual(savedLocal);
    expect(remote).toEqual(savedRemote);
  });
  it("preserva el estado remoto del lote compartido, aunque recibir o clasificar lo haya cambiado localmente", () => {
    const { local, remote } = fixture();
    addReceipt(local, [400, 600], { oldLot: true, classify: true });
    expect(local.data.field_lots[0].status).toBe("Parcialmente rechazado");
    expect(reconcileNewReceipts(local, remote).data.field_lots[0]).toEqual(
      remote.data.field_lots[0],
    );
  });
  it("acepta el productor, propiedad y parcela nuevos vinculados a una recepción con prueba de creación", () => {
    const { local, remote } = fixture();
    const producer = {
      ...base(),
      name: "Otro productor",
      document: "",
      phone: "",
      community: "",
      address: "",
      notes: "",
    };
    const farm = {
      ...base(),
      producer_id: producer.id,
      name: "Propiedad nueva",
      location: "",
    };
    const plot = {
      ...base(),
      farm_id: farm.id,
      name: "Parcela 1",
      location: "",
      area_ha: null,
      crop: "Sandía",
      variety: "",
      planting_date: null,
      harvest_date: null,
      notes: "",
    };
    local.data.producers.push(producer);
    local.data.farms.push(farm);
    local.data.plots.push(plot);
    local.data.audit_logs.push(
      audit("producers", producer, "Productor creado", null, producer),
      audit("plots", plot, "Parcela creada", null, plot),
    );
    const receipt = addReceipt(local);
    const lot = local.data.field_lots.find(
      (value) => value.id === receipt.lot_id,
    )!;
    lot.producer_id = producer.id;
    lot.plot_id = plot.id;
    local.data.audit_logs.find((log) => log.entity_id === lot.id)!.after =
      structuredClone(lot);
    const merged = reconcileNewReceipts(local, remote);
    expect(merged.data.producers).toHaveLength(2);
    expect(merged.data.farms[0]).toEqual(farm);
    expect(merged.data.plots[0]).toEqual(plot);
    expect(merged.data.field_lots.at(-1)?.producer_id).toBe(producer.id);
  });
  it("valida impresiones después de la creación y conserva el estado remoto sin reenviar una etiqueta vieja", () => {
    const { local, remote } = fixture();
    addReceipt(local, [1200], { classify: true, pallet: true });
    const newlyCreated = local.data.pallets.at(-1)!;
    const before = structuredClone(newlyCreated);
    newlyCreated.status = "Etiquetado";
    local.data.audit_logs.push(
      audit(
        "pallets",
        newlyCreated,
        "Solicitud de impresión de etiqueta",
        before,
        newlyCreated,
      ),
    );
    const saved = local.data.pallets[0],
      savedBefore = structuredClone(saved);
    saved.status = "Etiquetado";
    local.data.audit_logs.push(
      audit(
        "pallets",
        saved,
        "Solicitud de impresión de etiqueta",
        savedBefore,
        saved,
      ),
    );
    const merged = reconcileNewReceipts(local, remote);
    expect(merged.data.pallets[0]).toEqual(remote.data.pallets[0]);
    expect(merged.data.pallets.at(-1)?.status).toBe("Etiquetado");
    expect(
      merged.data.audit_logs.filter(
        (log) => log.action === "Solicitud de impresión de etiqueta",
      ),
    ).toHaveLength(2);
    remote.data.pallets[0].token = id();
    expect(() => reconcileNewReceipts(local, remote)).toThrow(
      "cambiado o cerrado",
    );
  });
  it.each(["Cancelado", "Expedido"])(
    "no recupera una impresión pendiente si el pallet remoto está %s",
    (status) => {
      const { local, remote } = fixture();
      addReceipt(local);
      const pallet = local.data.pallets[0];
      local.data.audit_logs.push(
        audit(
          "pallets",
          pallet,
          "Solicitud de impresión de etiqueta",
          pallet,
          pallet,
        ),
      );
      remote.data.pallets[0].status = status;
      expect(() => reconcileNewReceipts(local, remote)).toThrow(
        "cambiado o cerrado",
      );
    },
  );
  it("rechaza una corrección local o peso antiguo divergente en lugar de elegir automáticamente un total", () => {
    const { local, remote } = fixture();
    addReceipt(local);
    local.data.reception_weights[0].kg = 900;
    const original = structuredClone(local);
    expect(() => reconcileNewReceipts(local, remote)).toThrow(
      "base comprobable",
    );
    expect(local).toEqual(original);
    const producer = local.data.producers[0];
    local.data.audit_logs.push(
      audit("producers", producer, "Productor corregido", producer, producer),
    );
    expect(() => reconcileNewReceipts(local, remote)).toThrow("correcciones");
  });
  it("bloquea pesos incompletos, pérdidas incongruentes y asignaciones superiores al saldo", () => {
    const first = fixture();
    addReceipt(first.local, [800, 1200], { classify: true, pallet: true });
    first.local.data.reception_weights.at(-1)!.kg = 1000;
    expect(() => reconcileNewReceipts(first.local, first.remote)).toThrow(
      "suma de los pesajes",
    );
    const second = fixture();
    addReceipt(second.local, [800, 1200], { classify: true });
    const c = second.local.data.classifications[0 + 1];
    c.approved_kg = 1900;
    second.local.data.audit_logs.find((log) => log.entity_id === c.id)!.after =
      structuredClone(c);
    expect(() => reconcileNewReceipts(second.local, second.remote)).toThrow(
      "pérdidas o la clasificación",
    );
    const third = fixture();
    addReceipt(third.local, [800, 1200], { classify: true, pallet: true });
    const p = third.local.data.pallets.at(-1)!;
    p.net_kg = 2000;
    p.gross_kg = 2042;
    third.local.data.pallet_items.at(-1)!.kg = 2000;
    third.local.data.audit_logs.find((log) => log.entity_id === p.id)!.after =
      structuredClone(p);
    expect(() => reconcileNewReceipts(third.local, third.remote)).toThrow(
      "supera el aprobado",
    );
  });
  it("bloquea duplicados, código repetido, falta de prueba y cruces de organización o sesión", () => {
    const duplicate = fixture();
    addReceipt(duplicate.local);
    duplicate.local.data.reception_weights.push(
      structuredClone(duplicate.local.data.reception_weights.at(-1)!),
    );
    expect(() =>
      reconcileNewReceipts(duplicate.local, duplicate.remote),
    ).toThrow("identificadores repetidos");
    const code = fixture();
    addReceipt(code.local);
    const lot = code.local.data.field_lots.at(-1)!;
    lot.code = "LOT-BASE";
    code.local.data.audit_logs.find((log) => log.entity_id === lot.id)!.after =
      structuredClone(lot);
    expect(() => reconcileNewReceipts(code.local, code.remote)).toThrow(
      "código de un lote",
    );
    const proof = fixture();
    addReceipt(proof.local);
    proof.local.data.audit_logs = proof.local.data.audit_logs.filter(
      (log) => log.action !== "Recepción creada",
    );
    expect(() => reconcileNewReceipts(proof.local, proof.remote)).toThrow(
      "Falta el historial",
    );
    const scope = fixture();
    addReceipt(scope.local);
    scope.local.data.receptions.at(-1)!.organization_id = id();
    expect(() => reconcileNewReceipts(scope.local, scope.remote)).toThrow(
      "otra organización",
    );
    scope.remote.profile!.user_id = id();
    expect(() => reconcileNewReceipts(scope.local, scope.remote)).toThrow(
      "sesión",
    );
  });
  it("rechaza anexar pesos a una recepción antigua y conserva recepciones que solo existen en el servidor", () => {
    const { local, remote } = fixture();
    const extra = {
      ...base(),
      reception_id: local.data.receptions[0].id,
      sequence: 2,
      kg: 100,
      operator: "Operador",
      notes: "",
      correction_reason: "",
    };
    local.data.reception_weights.push(extra);
    local.data.audit_logs.push(
      audit("reception_weights", extra, "Pesaje registrado", null, extra),
    );
    expect(() => reconcileNewReceipts(local, remote)).toThrow(
      "recepción anterior",
    );
    local.data.reception_weights.pop();
    local.data.audit_logs.pop();
    addReceipt(local, [200, 300]);
    const other = structuredClone(remote);
    other.pending = true;
    addReceipt(other, [350, 150]);
    remote.data = other.data;
    expect(total(reconcileNewReceipts(local, remote).data)).toBe(2000);
  });
  it("recupera una entrega totalmente rechazada con sus pérdidas, pero no reabre un lote cerrado del servidor", () => {
    const { local, remote } = fixture();
    const receipt = addReceipt(local, [200, 300], { classify: true });
    const classification = local.data.classifications.at(-1)!;
    classification.approved_kg = 0;
    classification.rejected_kg = 500;
    local.data.audit_logs.find(
      (log) => log.entity_id === classification.id,
    )!.after = structuredClone(classification);
    local.data.field_lots.at(-1)!.status = "Rechazado";
    const merged = reconcileNewReceipts(local, remote);
    expect(receptionTotal(merged.data, receipt.id)).toBe(500);
    expect(merged.data.classifications.at(-1)?.rejected_kg).toBe(500);
    expect(merged.data.pallets).toEqual(remote.data.pallets);
    const closed = fixture();
    addReceipt(closed.local, [500], { oldLot: true });
    closed.remote.data.field_lots[0].status = "Rechazado";
    expect(() => reconcileNewReceipts(closed.local, closed.remote)).toThrow(
      "origen ausente o cerrado",
    );
  });
  it("comprueba pesajes posteriores de la misma recepción nueva mediante sus logs individuales", () => {
    const { local, remote } = fixture();
    const receipt = addReceipt(local, [500]);
    const weight = {
      ...base(),
      reception_id: receipt.id,
      sequence: 2,
      kg: 250,
      operator: "Operador",
      notes: "",
      correction_reason: "",
    };
    local.data.reception_weights.push(weight);
    local.data.audit_logs.push(
      audit("reception_weights", weight, "Pesaje registrado", null, weight),
    );
    expect(
      receptionTotal(reconcileNewReceipts(local, remote).data, receipt.id),
    ).toBe(750);
    local.data.audit_logs.pop();
    expect(() => reconcileNewReceipts(local, remote)).toThrow(
      "suma de los pesajes",
    );
  });
  it("no toma un intento de impresión como prueba autoritativa de una diferencia operacional", () => {
    const { local, remote } = fixture();
    addReceipt(local);
    remote.data.audit_logs = remote.data.audit_logs.filter(
      (log) => log.entity_type !== "pallets",
    );
    const before = local.data.pallets[0];
    remote.data.audit_logs.push(
      audit(
        "pallets",
        remote.data.pallets[0],
        "Solicitud de impresión de etiqueta",
        before,
        remote.data.pallets[0],
      ),
    );
    expect(() => reconcileNewReceipts(local, remote)).toThrow(
      "base comprobable",
    );
  });
  it("rechaza un productor inactivo, un vínculo de expedición y una pérdida sin motivo", () => {
    const inactive = fixture();
    addReceipt(inactive.local);
    inactive.remote.data.producers[0].status = "Inactivo";
    expect(() => reconcileNewReceipts(inactive.local, inactive.remote)).toThrow(
      "origen ausente o cerrado",
    );
    const shipped = fixture();
    addReceipt(shipped.local);
    const pallet = shipped.local.data.pallets[0];
    shipped.local.data.audit_logs.push(
      audit(
        "pallets",
        pallet,
        "Solicitud de impresión de etiqueta",
        pallet,
        pallet,
      ),
    );
    shipped.remote.data.shipment_pallets.push({
      ...base(),
      shipment_id: id(),
      pallet_id: pallet.id,
    });
    expect(() => reconcileNewReceipts(shipped.local, shipped.remote)).toThrow(
      "cambiado o cerrado",
    );
    const loss = fixture();
    addReceipt(loss.local, [200, 300], { classify: true });
    const c = loss.local.data.classifications.at(-1)!;
    c.reason = "";
    loss.local.data.audit_logs.find((log) => log.entity_id === c.id)!.after =
      structuredClone(c);
    expect(() => reconcileNewReceipts(loss.local, loss.remote)).toThrow(
      "pérdidas o la clasificación",
    );
  });
});
