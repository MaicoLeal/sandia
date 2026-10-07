import { describe, expect, it } from "vitest";
import { emptyData } from "../domain";
import type { Workspace } from "../types";
import { assertPrintRecovery } from "./workspace-reconciliation";

function fixture(): Workspace {
  return {
    data: emptyData(),
    revision: 8,
    pending: true,
    localOnly: false,
    organizationId: "org",
    profile: {
      id: "profile",
      user_id: "user",
      name: "Operador",
      role: "administrador",
      organization_id: "org",
      status: "Activo",
      created_at: "2026-10-07",
      updated_at: "2026-10-07",
      created_by: null,
    },
  };
}
describe("recuperación explícita para impresión de datos guardados", () => {
  it("permite renovar campos establecidos y conserva datos de origen para archivar", () => {
    const local = fixture();
    local.data.pallets.push({
      id: "p",
      organization_id: "org",
      code: "PAL-1",
      token: "token",
      status: "Etiquetado",
      net_kg: 390,
      gross_kg: 432,
      tare_kg: 42,
      destination: "Pendiente",
      assembled_at: "2026-10-01",
      responsible: "Operador",
      fruit_count: null,
      notes: "",
      created_at: "2026-10-01",
      updated_at: "2026-10-07",
      created_by: null,
    });
    local.data.audit_logs.push({
      id: "print",
      organization_id: "org",
      entity_type: "pallets",
      entity_id: "p",
      action: "Solicitud de impresión de etiqueta",
      actor: "Operador",
      before: null,
      after: null,
      reason: "",
      status: "Activo",
      created_at: "2026-10-07",
      updated_at: "2026-10-07",
      created_by: null,
    });
    const before = structuredClone(local);
    const remote = structuredClone(local);
    remote.pending = false;
    remote.revision = 87;
    remote.data.audit_logs = [];
    remote.data.pallets[0].destination = "Uruguay";
    remote.data.pallets[0].metadata = {
      export_label: { afidi: "1571652", producer_code: "SPE-GUA-002-SAN" },
    };
    expect(() => assertPrintRecovery(local, remote)).not.toThrow();
    expect(local).toEqual(before);
    remote.data.pallets[0].token = "otro";
    expect(() => assertPrintRecovery(local, remote)).toThrow("cambios locales");
  });
  it("rechaza acciones nuevas de corrección y cualquier registro operacional sin guardar", () => {
    const local = fixture(),
      remote = { ...fixture(), pending: false };
    local.data.audit_logs.push({
      id: "edit",
      organization_id: "org",
      entity_type: "producers",
      entity_id: "p",
      action: "Productor corregido",
      actor: "Operador",
      before: null,
      after: null,
      reason: "Corrección",
      status: "Activo",
      created_at: "2026-10-07",
      updated_at: "2026-10-07",
      created_by: null,
    });
    expect(() => assertPrintRecovery(local, remote)).toThrow("cambios locales");
    local.data.audit_logs = [];
    local.data.receptions.push({
      id: "new",
      organization_id: "org",
      lot_id: "lot",
      date: "2026-10-07",
      responsible: "Operador",
      notes: "",
      status: "Confirmado",
      created_at: "2026-10-07",
      updated_at: "2026-10-07",
      created_by: null,
    });
    expect(() => assertPrintRecovery(local, remote)).toThrow(
      "registros nuevos",
    );
  });
});
