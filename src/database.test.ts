import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base } from "./domain";
import { seed } from "./test-fixtures";
import type { Data } from "./types";
const user = "30000000-0000-4000-8000-000000000001";
const org = "10000000-0000-4000-8000-000000000001";
const db = new PGlite();
let snapshot: Data;
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security; create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$; grant select on storage.objects to authenticated;`,
  );
  await db.exec("grant usage on schema storage to authenticated");
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202610020001_sandia.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202610020002_producer_corrections.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202610020003_real_intake.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202610020004_reception_date_correction.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202610020005_operational_intake_trace.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202610020006_regional_loss_observations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261005165516_recipient_access_reception_edit.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261005225807_pallet_export_label.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261006131819_pallet_label_details.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261006141341_pallet_corrections.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query(
    `insert into auth.users(id,email) values($1,'admin@test.invalid');`,
    [user],
  );
  await db.query(
    `insert into organizations(id,name) values($1,'Test Agronorte');`,
    [org],
  );
  await db.query(
    `insert into profiles(organization_id,user_id,name,role) values($1,$2,'Admin prueba','administrador');`,
    [org, user],
  );
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [user]);
  snapshot = seed();
  snapshot.field_lots[0].code = "01102026";
  snapshot.field_lots[0].harvest_date = null;
  snapshot.field_lots[0].plot_id = null;
  snapshot.field_lots[0].producer_id = snapshot.producers[0].id;
  for (const table of Object.values(snapshot))
    for (const row of table) {
      row.created_by = user;
    }
}, 30000);
afterAll(async () => await db.close());
async function sync(data: Data, revision: number) {
  return db.query<{ revision: number }>(
    "select public.sync_workspace($1::jsonb,$2) as revision",
    [JSON.stringify(data), revision],
  );
}
async function remote() {
  const d = {} as Data;
  for (const table of Object.keys(snapshot) as (keyof Data)[]) {
    const result = await db.query<{ row_value: unknown }>(
      "select to_jsonb(x) as row_value from public." + table + " x",
    );
    (d[table] as unknown[]) = result.rows.map((row) => row.row_value);
  }
  return d;
}
describe.sequential("migración y reglas de PostgreSQL", () => {
  it("mantiene observaciones regionales opcionales para clientes anteriores", async () => {
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name='classifications' and column_name in ('region','pest_observation','symptoms')",
    );
    expect(columns.rows).toHaveLength(3);
  });
  it("aplica la migración, genera códigos de servidor y registra auditoría", async () => {
    await db.exec("set role authenticated");
    const result = await sync(snapshot, 0);
    expect(result.rows[0].revision).toBe(1);
    const audit = await db.query<{ count: number }>(
      "select count(*)::int as count from audit_logs",
    );
    expect(audit.rows[0].count).toBeGreaterThan(10);
    snapshot = await remote();
  });
  it("exige justificación para corregir una fecha sin cambiar el origen", async () => {
    const bad = structuredClone(snapshot);
    bad.receptions[0].date = "2026-10-02";
    await expect(sync(bad, 1)).rejects.toThrow("justificación");
  });
  it("corrige la fecha con auditoría y conserva el origen", async () => {
    const corrected = structuredClone(snapshot);
    const r = corrected.receptions[0];
    const before = structuredClone(r);
    r.date = "2026-10-02";
    corrected.audit_logs.push({
      ...base(org),
      entity_type: "receptions",
      entity_id: r.id,
      action: "Recepción corregida",
      actor: "Admin prueba",
      before,
      after: r,
      reason: "Fecha confirmada por el responsable",
    });
    await db.exec("begin");
    try {
      await sync(corrected, 1);
      const records = await db.query<{ date: string }>(
        "select date::text as date from receptions where id=$1",
        [r.id],
      );
      expect(records.rows[0].date).toBe("2026-10-02");
      const logs = await db.query<{ reason: string }>(
        "select reason from audit_logs where entity_id=$1 and reason=$2",
        [r.id, "Fecha confirmada por el responsable"],
      );
      expect(logs.rows).toHaveLength(1);
    } finally {
      await db.exec("rollback");
    }
  });
  it("bloquea una revisión obsoleta sin modificar datos", async () => {
    await expect(sync(snapshot, 0)).rejects.toThrow("Conflicto");
  });
  it("rechaza eliminación física y escritura sin perfil autorizado", async () => {
    const bad = structuredClone(snapshot);
    bad.reception_weights = [];
    await expect(sync(bad, 1)).rejects.toThrow("eliminar");
    await db.exec("reset role");
    await db.query("update profiles set role='auditor' where user_id=$1", [
      user,
    ]);
    await db.exec("set role authenticated");
    await expect(sync(snapshot, 1)).rejects.toThrow("permiso");
    await db.exec("reset role");
    await db.query(
      "update profiles set role='administrador' where user_id=$1",
      [user],
    );
    await db.exec("set role authenticated");
  });
  it("corrige peso con justificación y conserva antes/después", async () => {
    const bad = structuredClone(snapshot);
    bad.reception_weights[0].kg = 341;
    await expect(sync(bad, 1)).rejects.toThrow("justificación");
    bad.reception_weights[0].correction_reason = "Lectura verificada";
    const result = await sync(bad, 1);
    expect(result.rows[0].revision).toBe(2);
    snapshot = await remote();
    const audit = await db.query<{
      before: { kg: number };
      after: { kg: number };
    }>(
      `select "before","after" from audit_logs where reason='Lectura verificada'`,
    );
    expect(audit.rows[0].before.kg).toBe(340);
    expect(audit.rows[0].after.kg).toBe(341);
  });
  it("valida clasificación y saldo antes de aceptar pallets", async () => {
    const r = snapshot.receptions[0];
    const next = structuredClone(snapshot);
    next.classifications.push({
      ...base(org),
      reception_id: r.id,
      approved_kg: 3000,
      rejected_kg: 248,
      approved_count: null,
      rejected_count: null,
      reason: "Fruta dañada",
      size: "",
      quality: null,
      notes: "",
      region: "Región de prueba",
      pest_observation: "Observación sin diagnóstico",
      symptoms: "Señales observadas en prueba",
    });
    await db.exec("reset role");
    await db.query("update profiles set role='recepcion' where user_id=$1", [
      user,
    ]);
    await db.exec("set role authenticated");
    const missingReason = structuredClone(next);
    missingReason.classifications[0].reason = "";
    await expect(sync(missingReason, 2)).rejects.toThrow("motivo");
    await sync(next, 2);
    snapshot = await remote();
    expect(snapshot.classifications[0].region).toBe("Región de prueba");
    expect(snapshot.classifications[0].symptoms).toBe(
      "Señales observadas en prueba",
    );
    await db.exec("reset role");
    await db.query(
      "update profiles set role='administrador' where user_id=$1",
      [user],
    );
    await db.exec("set role authenticated");
    const bad = structuredClone(snapshot);
    const p = {
      ...base(org, "En armado"),
      code: "PAL-LOCAL",
      token: crypto.randomUUID(),
      destination: "Uruguay",
      assembled_at: new Date().toISOString(),
      responsible: "Test",
      gross_kg: 3031,
      net_kg: 3001,
      fruit_count: null,
      notes: "",
    };
    bad.pallets.push(p);
    bad.pallet_items.push({
      ...base(org),
      pallet_id: p.id,
      reception_id: r.id,
      kg: 3001,
    });
    await expect(sync(bad, 3)).rejects.toThrow("Saldo");
    bad.pallets[0].net_kg = 3000;
    bad.pallet_items[0].kg = 3000;
    await sync(bad, 3);
    snapshot = await remote();
  });
  it("limita el QR público y evita lectura directa sin sesión", async () => {
    await db.exec("set role anon");
    await expect(db.query("select * from producers")).rejects.toThrow(
      "permission denied",
    );
    const result = await db.query<{ trace: Record<string, unknown> }>(
      "select public.public_pallet_trace($1) as trace",
      [snapshot.pallets[0].token],
    );
    expect(Object.keys(result.rows[0].trace).sort()).toEqual([
      "code",
      "destination",
      "net_kg",
      "product",
      "status",
    ]);
    await expect(
      db.query("select public.private_pallet_trace($1)", [
        snapshot.pallets[0].token,
      ]),
    ).rejects.toThrow("permission denied");
    await db.exec("set role authenticated");
    const privateResult = await db.query<{
      trace: {
        origins: { lot_code: string; producer: string; allocated_kg: number }[];
      };
    }>("select public.private_pallet_trace($1) as trace", [
      snapshot.pallets[0].token,
    ]);
    expect(privateResult.rows[0].trace.origins[0].lot_code).toBe("01102026");
    expect(privateResult.rows[0].trace.origins[0].producer).toBe(
      "Elias Galeano",
    );
    expect(privateResult.rows[0].trace.origins[0].allocated_kg).toBe(3000);
    expect(JSON.stringify(privateResult.rows[0].trace)).not.toContain("phone");
    expect(JSON.stringify(privateResult.rows[0].trace)).not.toContain(
      "document",
    );
  });
  it("aísla otra organización por RLS", async () => {
    await db.exec("reset role");
    await db.exec(
      "insert into organizations(id,name) values('40000000-0000-4000-8000-000000000001','Otra cooperativa')",
    );
    await db.exec(
      "insert into producers(id,organization_id,name) values(gen_random_uuid(),'40000000-0000-4000-8000-000000000001','Privado')",
    );
    await db.exec("set role authenticated");
    const result = await db.query<{ name: string }>(
      "select name from producers",
    );
    expect(result.rows.map((r) => r.name)).toEqual(["Elias Galeano"]);
  });
  it("exige pallets listos sincronizados y evita duplicar expedición", async () => {
    const bad = structuredClone(snapshot);
    const p = bad.pallets[0];
    const s = {
      ...base(org, "Expedido"),
      destination: "Uruguay",
      country: "Uruguay",
      customer: "",
      carrier: "",
      driver: "Chofer ficticio",
      plate: "TEST",
      departure: "2026-10-02",
      responsible: "Admin",
      notes: "",
    };
    bad.shipments.push(s);
    bad.shipment_pallets.push({
      ...base(org),
      shipment_id: s.id,
      pallet_id: p.id,
    });
    p.status = "Expedido";
    await expect(sync(bad, 4)).rejects.toThrow("Sincronice");
    const ready = structuredClone(snapshot);
    ready.pallets[0].status = "Listo para carga";
    await sync(ready, 4);
    snapshot = await remote();
    const shipped = structuredClone(snapshot);
    shipped.pallets[0].status = "Expedido";
    shipped.shipments.push(s);
    shipped.shipment_pallets.push(bad.shipment_pallets[0]);
    await sync(shipped, 5);
    snapshot = await remote();
    expect(snapshot.pallets[0].status).toBe("Expedido");
    const duplicate = structuredClone(snapshot);
    duplicate.shipment_pallets.push({
      ...base(org),
      shipment_id: s.id,
      pallet_id: p.id,
    });
    await expect(sync(duplicate, 6)).rejects.toThrow();
  });
  it("cancela sin borrar los pesos y audita el motivo", async () => {
    const next = structuredClone(snapshot);
    const r = {
      ...base(org, "Confirmado"),
      lot_id: next.field_lots[0].id,
      date: "2026-10-02",
      responsible: "Admin",
      notes: "",
    };
    next.receptions.push(r);
    next.reception_weights.push({
      ...base(org),
      reception_id: r.id,
      sequence: 1,
      kg: 100,
      operator: "Admin",
      notes: "",
      correction_reason: "",
    });
    await sync(next, 6);
    snapshot = await remote();
    const cancelled = structuredClone(snapshot);
    const receipt = cancelled.receptions.find((x) => x.id === r.id)!;
    receipt.status = "Cancelado";
    receipt.notes = "Registro duplicado verificado";
    await sync(cancelled, 7);
    snapshot = await remote();
    expect(
      snapshot.reception_weights.filter((w) => w.reception_id === r.id),
    ).toHaveLength(1);
    expect(
      snapshot.audit_logs.some(
        (a) => a.reason === "Registro duplicado verificado",
      ),
    ).toBe(true);
  });
  it("preserva la justificación de correcciones del productor en el servidor", async () => {
    const corrected = structuredClone(snapshot);
    const p = corrected.producers[0];
    p.phone = "000-DEMO";
    await expect(sync(corrected, 8)).rejects.toThrow("justificación");
    corrected.audit_logs.push({
      ...base(org),
      entity_type: "producers",
      entity_id: p.id,
      action: "Productor corregido",
      actor: "Admin",
      before: snapshot.producers[0],
      after: p,
      reason: "Contacto verificado en prueba",
    });
    await sync(corrected, 8);
    snapshot = await remote();
    expect(
      snapshot.audit_logs.some(
        (a) => a.reason === "Contacto verificado en prueba",
      ),
    ).toBe(true);
  });
  it("corrige datos generales de una recepción palletizada con auditoría y sin cambiar pesos", async () => {
    const corrected = structuredClone(snapshot);
    const r = corrected.receptions[0];
    const before = structuredClone(r);
    r.date = "2026-10-03";
    r.responsible = "Responsable confirmado";
    r.notes = "Observación verificada posteriormente";
    await expect(sync(corrected, 9)).rejects.toThrow("justificación");
    corrected.audit_logs.push({
      ...base(org),
      entity_type: "receptions",
      entity_id: r.id,
      action: "Recepción corregida",
      actor: "Nombre aportado por cliente",
      before,
      after: structuredClone(r),
      reason: "Datos confirmados con el responsable de recepción",
    });
    await db.exec("begin");
    try {
      await sync(corrected, 9);
      const result = await db.query<{
        date: string;
        responsible: string;
        notes: string;
        lot_id: string;
      }>(
        "select date::text,responsible,notes,lot_id from receptions where id=$1",
        [r.id],
      );
      expect(result.rows[0]).toEqual({
        date: r.date,
        responsible: r.responsible,
        notes: r.notes,
        lot_id: before.lot_id,
      });
      const weights = await db.query<{ total: number }>(
        "select sum(kg)::float as total from reception_weights where reception_id=$1 and status='Activo'",
        [r.id],
      );
      expect(weights.rows[0].total).toBe(3248);
      const logs = await db.query<{
        actor: string;
        created_by: string;
        before: { notes: string };
        after: { notes: string };
      }>(
        `select actor,created_by,"before","after" from audit_logs where entity_id=$1 and reason=$2`,
        [r.id, "Datos confirmados con el responsable de recepción"],
      );
      expect(logs.rows).toHaveLength(1);
      expect(logs.rows[0].actor).toBe("Admin prueba");
      expect(logs.rows[0].created_by).toBe(user);
      expect(logs.rows[0].before.notes).toBe(before.notes);
      expect(logs.rows[0].after.notes).toBe(r.notes);
    } finally {
      await db.exec("rollback");
    }
    const fakeAudit = structuredClone(corrected);
    fakeAudit.audit_logs[fakeAudit.audit_logs.length - 1].before = {
      ...before,
      responsible: "Inventado",
    };
    await expect(sync(fakeAudit, 9)).rejects.toThrow("justificación");
    const changedOrigin = structuredClone(corrected);
    changedOrigin.receptions[0].lot_id = crypto.randomUUID();
    await expect(sync(changedOrigin, 9)).rejects.toThrow(
      "conservando el origen",
    );
  });
  it("sincroniza dos correcciones consecutivas offline preservando ambas justificaciones", async () => {
    const corrected = structuredClone(snapshot);
    const initial = structuredClone(corrected.receptions[0]);
    corrected.receptions[0].responsible = "Responsable B";
    const intermediate = structuredClone(corrected.receptions[0]);
    corrected.audit_logs.push({
      ...base(org),
      entity_type: "receptions",
      entity_id: initial.id,
      action: "Recepción corregida",
      actor: "Cliente",
      before: initial,
      after: intermediate,
      reason: "Primera verificación",
    });
    corrected.receptions[0].notes = "Observación C";
    corrected.audit_logs.push({
      ...base(org),
      entity_type: "receptions",
      entity_id: initial.id,
      action: "Recepción corregida",
      actor: "Cliente",
      before: intermediate,
      after: structuredClone(corrected.receptions[0]),
      reason: "Segunda verificación",
    });
    await db.exec("begin");
    try {
      await sync(corrected, 9);
      const logs = await db.query<{
        before: { responsible: string; notes: string };
        after: { responsible: string; notes: string };
        reason: string;
      }>(
        `select "before","after",reason from audit_logs where entity_id=$1 and reason=$2`,
        [initial.id, "Primera verificación · Segunda verificación"],
      );
      expect(logs.rows).toHaveLength(1);
      expect(logs.rows[0].before.responsible).toBe(initial.responsible);
      expect(logs.rows[0].before.notes).toBe(initial.notes);
      expect(logs.rows[0].after.responsible).toBe("Responsable B");
      expect(logs.rows[0].after.notes).toBe("Observación C");
    } finally {
      await db.exec("rollback");
    }
    const brokenChain = structuredClone(corrected);
    brokenChain.audit_logs[brokenChain.audit_logs.length - 1].before = {
      ...intermediate,
      responsible: "No coincide",
    };
    await expect(sync(brokenChain, 9)).rejects.toThrow("secuencia válida");
  });
  it("sincroniza código y origen del productor con justificación y no inventa datos en registros anteriores", async () => {
    expect(snapshot.producers[0].metadata).toBeNull();
    expect(snapshot.pallets[0].metadata).toBeNull();
    const corrected = structuredClone(snapshot);
    const before = structuredClone(corrected.producers[0]);
    corrected.producers[0].metadata = {
      export_code: "COD-VALIDADO",
      export_origin: "Origen confirmado de prueba",
    };
    await expect(sync(corrected, 9)).rejects.toThrow("justificación");
    corrected.audit_logs.push({
      ...base(org),
      entity_type: "producers",
      entity_id: before.id,
      action: "Productor corregido",
      actor: "Cliente",
      before,
      after: corrected.producers[0],
      reason: "Registro de exportación confirmado",
    });
    await db.exec("begin");
    try {
      await sync(corrected, 9);
      const rows = await db.query<{ metadata: unknown }>(
        "select metadata from producers where id=$1",
        [before.id],
      );
      expect(rows.rows[0].metadata).toEqual(corrected.producers[0].metadata);
      const logs = await db.query(
        "select id from audit_logs where entity_id=$1 and reason=$2",
        [before.id, "Registro de exportación confirmado"],
      );
      expect(logs.rows).toHaveLength(1);
    } finally {
      await db.exec("rollback");
    }
  });
});

const recipient = "50000000-0000-4000-8000-000000000001";
const secondRecipient = "50000000-0000-4000-8000-000000000002";
const otherAdmin = "50000000-0000-4000-8000-000000000003";
const foreignRecipient = "50000000-0000-4000-8000-000000000004";
const unknownUser = "50000000-0000-4000-8000-000000000005";
const otherOrg = "40000000-0000-4000-8000-000000000001";
const unassignedPallet = "60000000-0000-4000-8000-000000000001";
const foreignPallet = "60000000-0000-4000-8000-000000000002";
async function actingAs(id: string | null, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id ?? "",
  ]);
  await db.exec("set role " + role);
}
async function assignRecipient(
  id: string,
  email: string,
  palletIds: string[],
  name = "Destinatario Uruguay",
) {
  return db.query(
    "select public.set_recipient_pallet_access($1,$2,$3,$4::uuid[])",
    [id, email, name, palletIds],
  );
}
describe.sequential("acceso limitado del destinatario", () => {
  it("mantiene las funciones privilegiadas privadas y anuncia capacidades sin datos internos", async () => {
    const functions = await db.query<{
      schema: string;
      name: string;
      definer: boolean;
      config: string[];
    }>(
      "select n.nspname as schema,p.proname as name,p.prosecdef as definer,p.proconfig as config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','agronorte_private') and p.proname in ('recipient_pallets','list_recipient_accounts','set_recipient_pallet_access')",
    );
    expect(functions.rows).toHaveLength(6);
    for (const f of functions.rows) {
      expect(f.definer).toBe(f.schema === "agronorte_private");
      expect(f.config).toContain('search_path=""');
    }
    const features = await db.query<{
      value: { reception_edit: boolean; recipient_access: boolean };
    }>("select public.sandia_features() as value");
    expect(features.rows[0].value).toEqual({
      reception_edit: true,
      recipient_access: true,
      label_export_data: true,
      label_destination_edit: true,
      pallet_corrections: true,
    });
  });
  it("solo el administrador concede pallets y valida UUID, correo y organización", async () => {
    await db.exec("reset role");
    for (const [id, email] of [
      [recipient, "uruguay@test.invalid"],
      [secondRecipient, "otro@test.invalid"],
      [otherAdmin, "admin-otra@test.invalid"],
      [foreignRecipient, "externo-otra@test.invalid"],
      [unknownUser, "sin-perfil@test.invalid"],
    ]) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        id,
        email,
      ]);
    }
    await db.query(
      "insert into profiles(organization_id,user_id,name,role) values($1,$2,'Admin otra','administrador'),($1,$3,'Destinatario otra','destinatario')",
      [otherOrg, otherAdmin, foreignRecipient],
    );
    await db.query(
      "insert into pallets(id,organization_id,code,token,destination,assembled_at,responsible,gross_kg,net_kg,notes) values($1,$2,'NO-ASIGNADO',gen_random_uuid(),'Uruguay',now(),'INTERNO',1,1,'NOTAS INTERNAS'),($3,$4,'OTRA-ORG',gen_random_uuid(),'Uruguay',now(),'INTERNO OTRA ORG',1,1,'PRIVADO')",
      [unassignedPallet, org, foreignPallet, otherOrg],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('attachments',$1)",
      [org + "/foto-privada.jpg"],
    );
    await actingAs(user);
    await expect(
      assignRecipient(recipient, "equivocado@test.invalid", [
        snapshot.pallets[0].id,
      ]),
    ).rejects.toThrow("correo");
    await expect(
      assignRecipient(crypto.randomUUID(), "nueva@test.invalid", []),
    ).rejects.toThrow("cuenta registrada");
    await expect(
      assignRecipient(user, "admin@test.invalid", []),
    ).rejects.toThrow("perfil interno");
    await expect(
      assignRecipient(foreignRecipient, "externo-otra@test.invalid", []),
    ).rejects.toThrow("otra organización");
    await expect(
      assignRecipient(recipient, "uruguay@test.invalid", [foreignPallet]),
    ).rejects.toThrow("su organización");
    await assignRecipient(recipient, "URUGUAY@test.invalid", [
      snapshot.pallets[0].id,
      snapshot.pallets[0].id,
    ]);
    await assignRecipient(
      secondRecipient,
      "otro@test.invalid",
      [unassignedPallet],
      "Otro destinatario",
    );
    const list = await db.query<{
      accounts: {
        user_id: string;
        email: string;
        name: string;
        pallet_ids: string[];
      }[];
    }>("select public.list_recipient_accounts() as accounts");
    expect(list.rows[0].accounts).toHaveLength(2);
    expect(
      list.rows[0].accounts.find((a) => a.user_id === recipient)?.pallet_ids,
    ).toEqual([snapshot.pallets[0].id]);
    await actingAs(unknownUser);
    await expect(
      assignRecipient(recipient, "uruguay@test.invalid", []),
    ).rejects.toThrow("Solo el administrador");
    await expect(
      db.query("select public.list_recipient_accounts()"),
    ).rejects.toThrow("Solo el administrador");
  });
  it("el destinatario consulta únicamente datos permitidos de sus pallets", async () => {
    await actingAs(recipient);
    const result = await db.query<{ pallets: Record<string, unknown>[] }>(
      "select public.recipient_pallets() as pallets",
    );
    expect(result.rows[0].pallets).toHaveLength(1);
    expect(Object.keys(result.rows[0].pallets[0]).sort()).toEqual([
      "assembled_at",
      "code",
      "destination",
      "gross_kg",
      "lot_codes",
      "net_kg",
      "product",
      "reception_dates",
      "shipments",
      "status",
      "token",
      "weighed_date",
    ]);
    expect(result.rows[0].pallets[0].lot_codes).toEqual(["01102026"]);
    expect(result.rows[0].pallets[0].reception_dates).toEqual(["2026-10-01"]);
    expect(result.rows[0].pallets[0].shipments).toEqual([
      { destination: "Uruguay", country: "Uruguay", departure: "2026-10-02" },
    ]);
    expect(JSON.stringify(result.rows[0].pallets)).not.toContain("Elias");
    expect(JSON.stringify(result.rows[0].pallets)).not.toContain("Chofer");
    expect(JSON.stringify(result.rows[0].pallets)).not.toContain("NOTAS");
    await actingAs(secondRecipient);
    const second = await db.query<{ pallets: { code: string }[] }>(
      "select public.recipient_pallets() as pallets",
    );
    expect(second.rows[0].pallets.map((p) => p.code)).toEqual(["NO-ASIGNADO"]);
  });
  it("bloquea lectura interna, Storage, RPC privada y toda escritura del destinatario", async () => {
    await actingAs(recipient);
    const context = await db.query<{ organization: null; role: string }>(
      "select public.my_org() as organization,public.my_role() as role",
    );
    expect(context.rows[0]).toEqual({
      organization: null,
      role: "destinatario",
    });
    for (const table of [
      "organizations",
      "producers",
      "farms",
      "plots",
      "field_lots",
      "receptions",
      "reception_weights",
      "classifications",
      "pallets",
      "pallet_items",
      "shipments",
      "shipment_pallets",
      "attachments",
      "audit_logs",
    ]) {
      const result = await db.query("select * from public." + table);
      expect(result.rows, table).toHaveLength(0);
    }
    const profiles = await db.query<{ user_id: string }>(
      "select user_id from profiles",
    );
    expect(profiles.rows).toEqual([{ user_id: recipient }]);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
    await expect(
      db.query("select * from recipient_pallet_access"),
    ).rejects.toThrow("permission denied");
    const privateTrace = await db.query<{ trace: null }>(
      "select public.private_pallet_trace($1) as trace",
      [snapshot.pallets[0].token],
    );
    expect(privateTrace.rows[0].trace).toBeNull();
    await expect(sync(snapshot, 9)).rejects.toThrow("sin permiso");
    await expect(
      db.query("update producers set name='Alterado'"),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query("update profiles set role='administrador'"),
    ).rejects.toThrow("permission denied");
    await expect(
      assignRecipient(secondRecipient, "otro@test.invalid", []),
    ).rejects.toThrow("Solo el administrador");
    await expect(
      db.query("select public.list_recipient_accounts()"),
    ).rejects.toThrow("Solo el administrador");
  });
  it("aísla administradores de otra organización y permite revocar acceso con historial real", async () => {
    await actingAs(otherAdmin);
    await expect(
      assignRecipient(recipient, "uruguay@test.invalid", []),
    ).rejects.toThrow("otra organización");
    await expect(
      assignRecipient(foreignRecipient, "externo-otra@test.invalid", [
        snapshot.pallets[0].id,
      ]),
    ).rejects.toThrow("su organización");
    await assignRecipient(foreignRecipient, "externo-otra@test.invalid", [
      foreignPallet,
    ]);
    await actingAs(foreignRecipient);
    const foreignResult = await db.query<{ pallets: { code: string }[] }>(
      "select public.recipient_pallets() as pallets",
    );
    expect(foreignResult.rows[0].pallets.map((p) => p.code)).toEqual([
      "OTRA-ORG",
    ]);
    await actingAs(user);
    await assignRecipient(recipient, "uruguay@test.invalid", []);
    const logs = await db.query<{
      created_by: string;
      actor: string;
      before: { pallet_ids: string[] };
      after: { pallet_ids: string[] };
    }>(
      `select created_by,actor,"before","after" from audit_logs where action='Acceso de destinatario actualizado' and "before"->'pallet_ids' @> $1::jsonb`,
      [JSON.stringify([snapshot.pallets[0].id])],
    );
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0].created_by).toBe(user);
    expect(logs.rows[0].actor).toBe("Admin prueba");
    expect(logs.rows[0].before.pallet_ids).toEqual([snapshot.pallets[0].id]);
    expect(logs.rows[0].after.pallet_ids).toEqual([]);
    await actingAs(recipient);
    expect(
      (
        await db.query<{ pallets: unknown[] }>(
          "select public.recipient_pallets() as pallets",
        )
      ).rows[0].pallets,
    ).toEqual([]);
    await actingAs(user);
    await assignRecipient(recipient, "uruguay@test.invalid", [
      snapshot.pallets[0].id,
    ]);
    await db.exec("reset role");
    const grants = await db.query<{ count: number }>(
      "select count(*)::int as count from recipient_pallet_access where user_id=$1",
      [recipient],
    );
    expect(grants.rows[0].count).toBe(1);
  });
  it("deniega cuentas inactivas, sin perfil y llamadas anónimas", async () => {
    await db.exec("reset role");
    await db.query("update profiles set status='Inactivo' where user_id=$1", [
      recipient,
    ]);
    await actingAs(recipient);
    await expect(db.query("select public.recipient_pallets()")).rejects.toThrow(
      "sin acceso",
    );
    await actingAs(unknownUser);
    await expect(db.query("select public.recipient_pallets()")).rejects.toThrow(
      "sin acceso",
    );
    await actingAs(null, "anon");
    for (const query of [
      "select public.recipient_pallets()",
      "select public.list_recipient_accounts()",
      `select public.set_recipient_pallet_access('${recipient}','uruguay@test.invalid','Uruguay',array[]::uuid[])`,
    ]) {
      await expect(db.query(query)).rejects.toThrow("permission denied");
    }
    await actingAs(null);
    await expect(db.query("select public.recipient_pallets()")).rejects.toThrow(
      "Inicie sesión",
    );
    await actingAs(user);
    const internal = await db.query<{ name: string }>(
      "select name from producers",
    );
    expect(internal.rows[0].name).toBe("Elias Galeano");
  });
});

describe.sequential("datos de etiquetas de exportación", () => {
  it("bloquea la declaración SENAVE de Uruguay con destino distinto también al crear por sincronización", async () => {
    await actingAs(user);
    const currentRevision = (
      await db.query<{ revision: number }>(
        "select revision::int from organizations where id=$1",
        [org],
      )
    ).rows[0].revision;
    const incoming = await remote();
    incoming.pallets.push({
      ...base(org, "En armado", user),
      code: "TEST-EXPORT",
      token: crypto.randomUUID(),
      destination: "Argentina",
      assembled_at: new Date().toISOString(),
      responsible: "Packing confirmado",
      net_kg: 1,
      gross_kg: 1,
      fruit_count: null,
      notes: "",
      metadata: { export_label: { senave_program: true } },
    });
    await expect(sync(incoming, currentRevision)).rejects.toThrow(
      "pallets_export_metadata_check",
    );
    await db.exec("begin");
    try {
      await db.exec("reset role");
      await db.query(
        "update pallets set destination='Pendiente de confirmar' where id=$1",
        [unassignedPallet],
      );
      await db.exec("set role authenticated");
      await expect(
        db.query(
          "select public.update_pallet_export_label($1,$2::jsonb,'Confirmado',$3)",
          [
            unassignedPallet,
            JSON.stringify({ senave_program: true }),
            currentRevision,
          ],
        ),
      ).rejects.toThrow("destino Uruguay confirmado");
    } finally {
      await db.exec("rollback");
    }
  });
  it("actualiza solo metadata, con revisión, identidad real y auditoría", async () => {
    await actingAs(user);
    await db.exec("begin");
    try {
      const before = await db.query<{
        pallet: Record<string, unknown>;
        revision: number;
      }>(
        "select to_jsonb(p) as pallet,o.revision::int as revision from pallets p join organizations o on o.id=p.organization_id where p.id=$1",
        [unassignedPallet],
      );
      const fields = {
        afidi: "AFIDI-CONFIRMADO",
        packaged_date: "2026-10-02",
        harvest_date: "2026-10-01",
        producer_code: "COD-CONFIRMADO",
        origin: "Origen confirmado",
        senave_program: true,
      };
      await db.query(
        "select public.update_pallet_export_label($1,$2::jsonb,$3,$4)",
        [
          unassignedPallet,
          JSON.stringify(fields),
          "Documento confirmado para etiqueta",
          before.rows[0].revision,
        ],
      );
      const after = await db.query<{
        pallet: Record<string, unknown>;
        revision: number;
      }>(
        "select to_jsonb(p) as pallet,o.revision::int as revision from pallets p join organizations o on o.id=p.organization_id where p.id=$1",
        [unassignedPallet],
      );
      expect(after.rows[0].pallet.metadata).toEqual({ export_label: fields });
      expect(after.rows[0].revision).toBe(before.rows[0].revision + 1);
      const unchanged = (value: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(value).filter(
            ([key]) => !["metadata", "updated_at"].includes(key),
          ),
        );
      expect(unchanged(after.rows[0].pallet)).toEqual(
        unchanged(before.rows[0].pallet),
      );
      const logs = await db.query<{
        actor: string;
        created_by: string;
        before: { metadata: unknown };
        after: { metadata: unknown };
      }>(
        `select actor,created_by,"before","after" from audit_logs where entity_id=$1 and reason=$2`,
        [unassignedPallet, "Documento confirmado para etiqueta"],
      );
      expect(logs.rows).toHaveLength(1);
      expect(logs.rows[0].actor).toBe("Admin prueba");
      expect(logs.rows[0].created_by).toBe(user);
      expect(logs.rows[0].before.metadata).toBeNull();
      expect(logs.rows[0].after.metadata).toEqual({ export_label: fields });
    } finally {
      await db.exec("rollback");
    }
  });
  it("rechaza revisión vieja, datos inválidos, falta de justificación y pallets cerrados", async () => {
    await actingAs(user);
    const revision = (
      await db.query<{ revision: number }>(
        "select revision::int from organizations where id=$1",
        [org],
      )
    ).rows[0].revision;
    const update = (
      id: string,
      fields: unknown,
      reason: string,
      expected = revision,
    ) =>
      db.query("select public.update_pallet_export_label($1,$2::jsonb,$3,$4)", [
        id,
        JSON.stringify(fields),
        reason,
        expected,
      ]);
    await expect(
      update(unassignedPallet, { afidi: "123" }, "Confirmado", revision - 1),
    ).rejects.toThrow("Conflicto");
    await expect(update(unassignedPallet, {}, "")).rejects.toThrow(
      "justificación",
    );
    for (const value of [
      { packaged_date: "2026-02-30" },
      { net_kg: 888 },
      { senave_program: "true" },
      { origin: null },
    ])
      await expect(
        update(unassignedPallet, value, "Confirmado"),
      ).rejects.toThrow("inválidos");
    await expect(
      update(snapshot.pallets[0].id, {}, "Confirmado"),
    ).rejects.toThrow("cerrado");
    await expect(update(foreignPallet, {}, "Confirmado")).rejects.toThrow(
      "su organización",
    );
  });
  it("mantiene funciones privilegiadas privadas y niega destinatario, recepción y llamadas anónimas", async () => {
    await actingAs(user);
    const defs = await db.query<{ schema: string; definer: boolean }>(
      "select n.nspname as schema,p.prosecdef as definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='update_pallet_export_label'",
    );
    expect(defs.rows).toHaveLength(2);
    for (const definition of defs.rows)
      expect(definition.definer).toBe(
        definition.schema === "agronorte_private",
      );
    const call = () =>
      db.query(
        "select public.update_pallet_export_label($1,'{}'::jsonb,'Confirmado',9)",
        [unassignedPallet],
      );
    await actingAs(recipient);
    await expect(call()).rejects.toThrow("no puede editar");
    await db.exec("reset role");
    await db.query("update profiles set role='recepcion' where user_id=$1", [
      user,
    ]);
    await actingAs(user);
    await expect(call()).rejects.toThrow("no puede editar");
    await db.exec("reset role");
    await db.query(
      "update profiles set role='administrador' where user_id=$1",
      [user],
    );
    await actingAs(null, "anon");
    await expect(call()).rejects.toThrow("permission denied");
    await actingAs(null);
    await expect(call()).rejects.toThrow("Inicie sesión");
    await actingAs(user);
  });
});

describe.sequential("edición de etiqueta antes de imprimir", () => {
  const currentRevision = async () =>
    (
      await db.query<{ revision: number }>(
        "select revision::int from organizations where id=$1",
        [org],
      )
    ).rows[0].revision;
  const updateDetails = (
    id: string,
    fields: unknown,
    destination: string | null,
    reason: string,
    revision: number | null,
  ) =>
    db.query(
      "select public.update_pallet_label_details($1,$2::jsonb,$3,$4,$5)",
      [id, JSON.stringify(fields), destination, reason, revision],
    );

  it("confirma destino y datos juntos sin cambiar peso, origen, códigos ni QR, con una auditoría real", async () => {
    await actingAs(user);
    await db.exec("begin");
    try {
      await db.exec("reset role");
      await db.query(
        "update pallets set destination='Pendiente de confirmar' where id=$1",
        [unassignedPallet],
      );
      await db.exec("set role authenticated");
      const before = await remote();
      const revision = await currentRevision();
      const fields = {
        afidi: "AFIDI-DOCUMENTADO",
        producer_code: "COD-DOCUMENTADO",
        origin: "Depto. de San Pedro – Paraguay",
        harvest_date: "2026-10-01",
        packaged_date: "2026-10-02",
        senave_program: true,
      };
      const reason = "Datos confirmados para impresión";
      await updateDetails(
        unassignedPallet,
        fields,
        " Uruguay ",
        reason,
        revision,
      );
      const after = await remote();
      const oldPallet = before.pallets.find((p) => p.id === unassignedPallet)!;
      const newPallet = after.pallets.find((p) => p.id === unassignedPallet)!;
      expect(newPallet).toEqual({
        ...oldPallet,
        destination: "Uruguay",
        metadata: { export_label: fields },
        updated_at: newPallet.updated_at,
      });
      for (const table of Object.keys(before) as (keyof Data)[]) {
        if (table !== "pallets" && table !== "audit_logs")
          expect(after[table]).toEqual(before[table]);
      }
      const logs = after.audit_logs.filter((l) => l.reason === reason);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        actor: "Admin prueba",
        created_by: user,
        before: oldPallet,
        after: newPallet,
      });
      expect(await currentRevision()).toBe(revision + 1);

      // Retry after a successful save does not duplicate history or revision.
      await updateDetails(unassignedPallet, fields, null, reason, revision + 1);
      expect(await currentRevision()).toBe(revision + 1);
      expect((await remote()).audit_logs).toEqual(after.audit_logs);
    } finally {
      await db.exec("rollback");
    }
  });

  it("rechaza sobreescrituras de otra organización, datos inválidos y revisión vieja sin modificar registros", async () => {
    await actingAs(user);
    const before = await remote();
    const revision = await currentRevision();
    await expect(
      updateDetails(
        unassignedPallet,
        {},
        "Uruguay",
        "Confirmado",
        revision - 1,
      ),
    ).rejects.toThrow("Conflicto");
    await expect(
      updateDetails(unassignedPallet, {}, "Uruguay", "Confirmado", null),
    ).rejects.toThrow("Conflicto");
    await expect(
      updateDetails(foreignPallet, {}, "Uruguay", "Confirmado", revision),
    ).rejects.toThrow("su organización");
    await expect(
      updateDetails(unassignedPallet, {}, "Uruguay", " ", revision),
    ).rejects.toThrow("justificación");
    for (const destination of [" ", "x".repeat(201)])
      await expect(
        updateDetails(
          unassignedPallet,
          {},
          destination,
          "Confirmado",
          revision,
        ),
      ).rejects.toThrow("Destino requiere");
    for (const fields of [
      { net_kg: 999 },
      { token: crypto.randomUUID() },
      { destination: "Uruguay" },
      { harvest_date: "2026-02-30" },
      { senave_program: "true" },
    ])
      await expect(
        updateDetails(unassignedPallet, fields, null, "Confirmado", revision),
      ).rejects.toThrow("inválidos");
    await expect(
      updateDetails(
        unassignedPallet,
        { senave_program: true },
        "Argentina",
        "Confirmado",
        revision,
      ),
    ).rejects.toThrow("destino Uruguay confirmado");
    expect(await currentRevision()).toBe(revision);
    expect(await remote()).toEqual(before);
  });

  it("no permite corregir etiquetas de pallets expedidos, cancelados o vinculados a una expedición", async () => {
    await actingAs(user);
    const revision = await currentRevision();
    await expect(
      updateDetails(snapshot.pallets[0].id, {}, null, "Confirmado", revision),
    ).rejects.toThrow("cerrado");
    for (const scenario of ["Cancelado", "Expedición"]) {
      await db.exec("begin");
      try {
        await db.exec("reset role");
        if (scenario === "Cancelado")
          await db.query("update pallets set status='Cancelado' where id=$1", [
            unassignedPallet,
          ]);
        else {
          const shipment = crypto.randomUUID();
          await db.query(
            "insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible) values($1,$2,'Uruguay','Uruguay','Chofer','ABC123','2026-10-06','Packing')",
            [shipment, org],
          );
          await db.query(
            "insert into shipment_pallets(id,organization_id,shipment_id,pallet_id) values($1,$2,$3,$4)",
            [crypto.randomUUID(), org, shipment, unassignedPallet],
          );
        }
        await db.exec("set role authenticated");
        await expect(
          updateDetails(
            unassignedPallet,
            {},
            "Argentina",
            "Confirmado",
            revision,
          ),
        ).rejects.toThrow("cerrado");
      } finally {
        await db.exec("rollback");
      }
    }
  });

  it("reserva la edición a administración, gestión y packing sin conceder escritura directa ni acceso anónimo", async () => {
    await actingAs(user);
    const revision = await currentRevision();
    const definitions = await db.query<{
      schema: string;
      definer: boolean;
      config: string[];
    }>(
      "select n.nspname as schema,p.prosecdef as definer,p.proconfig as config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='update_pallet_label_details'",
    );
    expect(definitions.rows).toHaveLength(2);
    for (const f of definitions.rows) {
      expect(f.definer).toBe(f.schema === "agronorte_private");
      expect(f.config).toContain('search_path=""');
    }
    for (const role of ["administrador", "gestor", "packing"]) {
      await db.exec("begin");
      try {
        await db.exec("reset role");
        await db.query("update profiles set role=$1 where user_id=$2", [
          role,
          user,
        ]);
        await db.exec("set role authenticated");
        await updateDetails(
          unassignedPallet,
          { afidi: "VALIDADO" },
          null,
          "Confirmado",
          revision,
        );
      } finally {
        await db.exec("rollback");
      }
    }
    try {
      for (const role of ["recepcion", "pesaje", "auditor", "destinatario"]) {
        await db.exec("reset role");
        await db.query("update profiles set role=$1 where user_id=$2", [
          role,
          user,
        ]);
        await db.exec("set role authenticated");
        await expect(
          updateDetails(unassignedPallet, {}, null, "Confirmado", revision),
        ).rejects.toThrow("no puede editar");
      }
    } finally {
      await db.exec("reset role");
      await db.query(
        "update profiles set role='administrador' where user_id=$1",
        [user],
      );
      await actingAs(user);
    }
    await expect(
      db.query("update pallets set destination='Argentina' where id=$1", [
        unassignedPallet,
      ]),
    ).rejects.toThrow("permission denied");
    await actingAs(recipient);
    await expect(
      updateDetails(unassignedPallet, {}, null, "Confirmado", revision),
    ).rejects.toThrow("no puede editar");
    await actingAs(unknownUser);
    await expect(
      updateDetails(unassignedPallet, {}, null, "Confirmado", revision),
    ).rejects.toThrow("no puede editar");
    await actingAs(null, "anon");
    await expect(
      updateDetails(unassignedPallet, {}, null, "Confirmado", revision),
    ).rejects.toThrow("permission denied");
    await actingAs(null);
    await expect(
      updateDetails(unassignedPallet, {}, null, "Confirmado", revision),
    ).rejects.toThrow("Inicie sesión");
    await actingAs(user);
  });

  it("mantiene compatibilidad con la RPC anterior y no publica campos de exportación privados en el QR", async () => {
    await actingAs(user);
    await db.exec("begin");
    try {
      const revision = await currentRevision();
      const palletBefore = (await remote()).pallets.find(
        (p) => p.id === unassignedPallet,
      )!;
      await db.query(
        "select public.update_pallet_export_label($1,$2::jsonb,$3,$4)",
        [
          unassignedPallet,
          JSON.stringify({ afidi: "DOCUMENTO-PRIVADO" }),
          "Cliente anterior",
          revision,
        ],
      );
      const palletAfter = (await remote()).pallets.find(
        (p) => p.id === unassignedPallet,
      )!;
      expect(palletAfter.destination).toBe(palletBefore.destination);
      await db.exec("set role anon");
      const trace = await db.query<{ value: Record<string, unknown> }>(
        "select public.public_pallet_trace($1) as value",
        [palletBefore.token],
      );
      expect(JSON.stringify(trace.rows[0].value)).not.toContain(
        "DOCUMENTO-PRIVADO",
      );
      expect(trace.rows[0].value).not.toHaveProperty("metadata");
      expect(trace.rows[0].value).not.toHaveProperty("producer_code");
    } finally {
      await db.exec("rollback");
    }
    await actingAs(user);
  });

  it("rechaza sincronización vieja después de la corrección para no restaurar el destino anterior", async () => {
    await actingAs(user);
    const before = await remote();
    const revision = await currentRevision();
    await db.exec("begin");
    try {
      await updateDetails(
        unassignedPallet,
        { afidi: "VALIDADO" },
        "Argentina",
        "Destino confirmado",
        revision,
      );
      await expect(sync(before, revision)).rejects.toThrow("Conflicto");
    } finally {
      await db.exec("rollback");
    }
  });
});

describe.sequential("corrección y cancelación auditada de pallets", () => {
  const revision = async () =>
    (
      await db.query<{ n: number }>(
        "select revision::int as n from organizations where id=$1",
        [org],
      )
    ).rows[0].n;
  const correct = (
    id: string,
    fields: unknown,
    reason: string,
    rev: number | null,
  ) =>
    db.query("select public.correct_pallet($1,$2::jsonb,$3,$4)", [
      id,
      JSON.stringify(fields),
      reason,
      rev,
    ]);
  const cancel = (id: string, reason: string, rev: number | null) =>
    db.query("select public.cancel_pallet($1,$2,$3)", [id, reason, rev]);
  const fields = {
    net_kg: 400,
    gross_kg: null,
    fruit_count: null,
    weighed_date: "2026-10-05",
    responsible: "Packing confirmado",
    notes: "Observación anterior",
  };
  async function fixture() {
    await actingAs(user);
    await db.exec("begin; reset role");
    const receptionId = crypto.randomUUID();
    const id = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    await db.query(
      "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,'2026-10-05','Recepción confirmada')",
      [receptionId, org, snapshot.field_lots[0].id],
    );
    await db.query(
      "insert into reception_weights(id,organization_id,reception_id,sequence,kg,operator) values($1,$2,$3,1,1000,'Operador')",
      [crypto.randomUUID(), org, receptionId],
    );
    await db.query(
      "insert into classifications(id,organization_id,reception_id,approved_kg,rejected_kg,quality) values($1,$2,$3,1000,0,null)",
      [crypto.randomUUID(), org, receptionId],
    );
    await db.query(
      "insert into pallets(id,organization_id,code,token,destination,assembled_at,weighed_date,responsible,gross_kg,net_kg,notes,status,metadata,created_by) values($1,$2,$3,gen_random_uuid(),'Uruguay',now(),'2026-10-05',$4,null,400,$5,'Listo para carga',$6::jsonb,$7),($8,$2,$9,gen_random_uuid(),'Uruguay',now(),'2026-10-05',$4,null,300,'','En armado',null,$7)",
      [
        id,
        org,
        "CORRECCION-" + id,
        fields.responsible,
        fields.notes,
        JSON.stringify({ export_label: { afidi: "DOCUMENTO-CONFIRMADO" } }),
        user,
        secondId,
        "SALDO-" + secondId,
      ],
    );
    await db.query(
      "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg,created_by) values($1,$2,$3,$4,400,$5),($6,$2,$7,$4,300,$5)",
      [itemId, org, id, receptionId, user, crypto.randomUUID(), secondId],
    );
    await db.exec("set role authenticated");
    return { id, secondId, itemId, receptionId, rev: await revision() };
  }
  async function unchangedRejected(
    operation: () => Promise<unknown>,
    message: string,
  ) {
    await db.exec("savepoint invalid_action");
    await expect(operation()).rejects.toThrow(message);
    await db.exec(
      "rollback to savepoint invalid_action; release savepoint invalid_action",
    );
  }

  it("corrige peso y asignación juntos, reabre etiquetado y audita usuario/motivo sin editar productor ni recepción", async () => {
    const f = await fixture();
    try {
      const before = await remote();
      const original = before.pallets.find((p) => p.id === f.id)!;
      await correct(
        f.id,
        {
          ...fields,
          net_kg: 500,
          gross_kg: 520,
          fruit_count: 42,
          weighed_date: "2026-10-06",
        },
        "Peso confirmado en balanza",
        f.rev,
      );
      const after = await remote();
      const changed = after.pallets.find((p) => p.id === f.id)!;
      expect(changed).toMatchObject({
        net_kg: 500,
        gross_kg: 520,
        fruit_count: 42,
        weighed_date: "2026-10-06",
        status: "En armado",
        code: original.code,
        token: original.token,
        metadata: original.metadata,
        assembled_at: original.assembled_at,
        created_at: original.created_at,
        created_by: original.created_by,
        destination: original.destination,
      });
      expect(after.pallet_items.find((i) => i.id === f.itemId)).toMatchObject({
        kg: 500,
        pallet_id: f.id,
        reception_id: f.receptionId,
      });
      for (const table of [
        "producers",
        "receptions",
        "reception_weights",
        "classifications",
        "field_lots",
      ] as const)
        expect(after[table]).toEqual(before[table]);
      const logs = after.audit_logs.filter(
        (l) => l.reason === "Peso confirmado en balanza",
      );
      expect(logs).toHaveLength(2);
      expect(
        logs.every((l) => l.created_by === user && l.actor === "Admin prueba"),
      ).toBe(true);
      expect(
        logs.find((l) => l.entity_type === "pallets")?.before,
      ).toMatchObject({ net_kg: 400, status: "Listo para carga" });
      expect(
        logs.find((l) => l.entity_type === "pallets")?.after,
      ).toMatchObject({ net_kg: 500, status: "En armado" });
      expect(await revision()).toBe(f.rev + 1);
      await correct(
        f.id,
        {
          ...fields,
          net_kg: 500,
          gross_kg: 520,
          fruit_count: 42,
          weighed_date: "2026-10-06",
        },
        "Mismo valor confirmado",
        f.rev + 1,
      );
      expect(await revision()).toBe(f.rev + 1);
      expect((await remote()).audit_logs).toHaveLength(after.audit_logs.length);
    } finally {
      await db.exec("rollback");
    }
  });

  it("conserva estado al corregir solo observaciones, sin nuevas asignaciones", async () => {
    const f = await fixture();
    try {
      const before = (await remote()).pallet_items;
      await correct(
        f.id,
        { ...fields, notes: "Observación corregida" },
        "Observación confirmada",
        f.rev,
      );
      expect((await remote()).pallets.find((p) => p.id === f.id)).toMatchObject(
        { notes: "Observación corregida", status: "Listo para carga" },
      );
      expect((await remote()).pallet_items).toEqual(before);
    } finally {
      await db.exec("rollback");
    }
  });

  it("valida saldo, pesos, cantidades, fechas, campos autorizados y justificación antes de escribir", async () => {
    const f = await fixture();
    try {
      const before = await remote();
      for (const [bad, message] of [
        [{ ...fields, net_kg: 800 }, "Saldo insuficiente"],
        [{ ...fields, net_kg: 0 }, "Peso inválido"],
        [{ ...fields, net_kg: 400.001 }, "Peso inválido"],
        [{ ...fields, gross_kg: 399 }, "Peso inválido"],
        [{ ...fields, fruit_count: 1.5 }, "entero"],
        [{ ...fields, fruit_count: -1 }, "entero"],
        [{ ...fields, weighed_date: "2026-13-01" }, "date/time"],
        [{ ...fields, weighed_date: "05/10/2026" }, "Fecha de pesaje"],
        [{ ...fields, responsible: " " }, "responsable"],
        [{ ...fields, net_kg: "400" }, "Tipos"],
        [{ ...fields, token: crypto.randomUUID() }, "Datos"],
        [{ net_kg: 400 }, "Datos"],
      ] as [unknown, string][])
        await unchangedRejected(
          () => correct(f.id, bad, "Verificado", f.rev),
          message,
        );
      await unchangedRejected(
        () => correct(f.id, fields, " ", f.rev),
        "justificación",
      );
      await unchangedRejected(() => cancel(f.id, " ", f.rev), "justificación");
      expect(await remote()).toEqual(before);
      expect(await revision()).toBe(f.rev);
    } finally {
      await db.exec("rollback");
    }
  });

  it("rechaza redistribuir un pallet mixto y preserva sus orígenes; permite corregir campos sin alterar kg", async () => {
    const f = await fixture();
    try {
      await db.exec("reset role");
      const otherReception = crypto.randomUUID();
      await db.query(
        "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,'2026-10-05','Origen adicional')",
        [otherReception, org, snapshot.field_lots[0].id],
      );
      await db.query("update pallet_items set kg=200 where id=$1", [f.itemId]);
      await db.query(
        "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,200)",
        [crypto.randomUUID(), org, f.id, otherReception],
      );
      await db.exec("set role authenticated");
      const before = (await remote()).pallet_items;
      await unchangedRejected(
        () => correct(f.id, { ...fields, net_kg: 450 }, "Corregido", f.rev),
        "varios orígenes",
      );
      await correct(
        f.id,
        { ...fields, fruit_count: 40 },
        "Conteo confirmado",
        f.rev,
      );
      expect((await remote()).pallet_items).toEqual(before);
    } finally {
      await db.exec("rollback");
    }
  });

  it("cancela sin borrar identidad/origen, libera saldo, oculta QR y destinatario y no duplica auditoría", async () => {
    const f = await fixture();
    try {
      await assignRecipient(recipient, "uruguay@test.invalid", [f.id]);
      const before = await remote();
      const original = before.pallets.find((p) => p.id === f.id)!;
      await cancel(f.id, "Pallet duplicado confirmado", f.rev);
      const after = await remote();
      expect(after.pallets.find((p) => p.id === f.id)).toMatchObject({
        ...original,
        status: "Cancelado",
      });
      expect(after.pallet_items).toEqual(before.pallet_items);
      const allocated = await db.query<{ kg: number }>(
        "select sum(i.kg)::float as kg from pallet_items i join pallets p on p.id=i.pallet_id where i.reception_id=$1 and p.status<>'Cancelado'",
        [f.receptionId],
      );
      expect(allocated.rows[0].kg).toBe(300);
      const log = after.audit_logs.filter(
        (l) =>
          l.entity_id === f.id && l.reason === "Pallet duplicado confirmado",
      );
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        created_by: user,
        actor: "Admin prueba",
        before: { status: "Listo para carga" },
        after: { status: "Cancelado" },
      });
      await cancel(f.id, "Ya cancelado", f.rev + 1);
      expect(await revision()).toBe(f.rev + 1);
      expect((await remote()).audit_logs).toHaveLength(after.audit_logs.length);
      await actingAs(recipient);
      const received = await db.query<{ value: unknown[] }>(
        "select public.recipient_pallets() as value",
      );
      expect(received.rows[0].value).toEqual([]);
      await actingAs(null, "anon");
      expect(
        (
          await db.query<{ value: unknown }>(
            "select public.public_pallet_trace($1) as value",
            [original.token],
          )
        ).rows[0].value,
      ).toBeNull();
    } finally {
      await db.exec("rollback");
      await actingAs(user);
    }
  });

  it("bloquea expedidos, cancelados, cualquier vínculo con expedición, otra organización y revisión obsoleta", async () => {
    const f = await fixture();
    try {
      await unchangedRejected(
        () => correct(foreignPallet, fields, "Verificado", f.rev),
        "organización",
      );
      await unchangedRejected(
        () => cancel(foreignPallet, "Verificado", f.rev),
        "organización",
      );
      await unchangedRejected(
        () => correct(f.id, fields, "Verificado", f.rev - 1),
        "Conflicto",
      );
      await unchangedRejected(
        () => cancel(f.id, "Verificado", null),
        "Conflicto",
      );
      for (const status of ["Expedido", "Cancelado"]) {
        await db.exec("reset role");
        await db.query("update pallets set status=$1 where id=$2", [
          status,
          f.id,
        ]);
        await db.exec("set role authenticated");
        await unchangedRejected(
          () => correct(f.id, fields, "Verificado", f.rev),
          "cerrado",
        );
        if (status === "Expedido")
          await unchangedRejected(
            () => cancel(f.id, "Verificado", f.rev),
            "cerrado",
          );
      }
      await db.exec("reset role");
      await db.query("update pallets set status='En armado' where id=$1", [
        f.id,
      ]);
      const shipment = crypto.randomUUID();
      await db.query(
        "insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible) values($1,$2,'Uruguay','Uruguay','Chofer','ABC123','2026-10-06','Packing')",
        [shipment, org],
      );
      await db.query(
        "insert into shipment_pallets(id,organization_id,shipment_id,pallet_id,status) values($1,$2,$3,$4,'Cancelado')",
        [crypto.randomUUID(), org, shipment, f.id],
      );
      await db.exec("set role authenticated");
      await unchangedRejected(
        () => correct(f.id, fields, "Verificado", f.rev),
        "expedición",
      );
      await unchangedRejected(
        () => cancel(f.id, "Verificado", f.rev),
        "expedición",
      );
    } finally {
      await db.exec("rollback");
    }
  });

  it("reserva ambas RPC a administrador/gestor, sin permisos directos, anónimos o perfiles inactivos", async () => {
    const f = await fixture();
    try {
      const definitions = await db.query<{
        schema: string;
        name: string;
        definer: boolean;
        config: string[];
      }>(
        "select n.nspname as schema,p.proname as name,p.prosecdef as definer,p.proconfig as config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('correct_pallet','cancel_pallet')",
      );
      expect(definitions.rows).toHaveLength(4);
      for (const entry of definitions.rows) {
        expect(entry.definer).toBe(entry.schema === "agronorte_private");
        expect(entry.config).toContain('search_path=""');
      }
      for (const role of [
        "packing",
        "recepcion",
        "pesaje",
        "auditor",
        "destinatario",
      ]) {
        await db.exec("reset role");
        await db.query("update profiles set role=$1 where user_id=$2", [
          role,
          user,
        ]);
        await db.exec("set role authenticated");
        await unchangedRejected(
          () => correct(f.id, fields, "Verificado", f.rev),
          "Solo administrador",
        );
        await unchangedRejected(
          () => cancel(f.id, "Verificado", f.rev),
          "Solo administrador",
        );
      }
      await db.exec("reset role");
      await db.query("update profiles set role='gestor' where user_id=$1", [
        user,
      ]);
      await db.exec("set role authenticated");
      await correct(
        f.id,
        { ...fields, notes: "Validado por gestor" },
        "Gestor confirmó",
        f.rev,
      );
      await cancel(f.id, "Gestor confirmó duplicación", f.rev + 1);
      await unchangedRejected(
        () => db.query("update pallets set net_kg=1 where id=$1", [f.id]),
        "permission denied",
      );
      await actingAs(null, "anon");
      await unchangedRejected(
        () => cancel(f.id, "Verificado", f.rev + 2),
        "permission denied",
      );
      await actingAs(null);
      await unchangedRejected(
        () => correct(f.id, fields, "Verificado", f.rev + 2),
        "Inicie sesión",
      );
      await actingAs(unknownUser);
      await unchangedRejected(
        () => cancel(f.id, "Verificado", f.rev + 2),
        "Solo administrador",
      );
      await actingAs(user);
      await db.exec("reset role");
      await db.query("update profiles set status='Inactivo' where user_id=$1", [
        user,
      ]);
      await db.exec("set role authenticated");
      await unchangedRejected(
        () => cancel(f.id, "Verificado", f.rev + 2),
        "Solo administrador",
      );
    } finally {
      await db.exec("rollback");
      await actingAs(user);
    }
  });

  it("impide cancelación sin motivo por sincronización antigua, creación cerrada y restauración desde caché", async () => {
    const f = await fixture();
    try {
      const before = await remote();
      const oldPayload = structuredClone(before);
      oldPayload.pallets.find((p) => p.id === f.id)!.status = "Cancelado";
      for (const role of ["administrador", "packing"]) {
        await db.exec("reset role");
        await db.query("update profiles set role=$1 where user_id=$2", [
          role,
          user,
        ]);
        await db.exec("set role authenticated");
        await unchangedRejected(
          () => sync(oldPayload, f.rev),
          "cancelación supervisada",
        );
      }
      await db.exec("reset role");
      await db.query(
        "update profiles set role='administrador' where user_id=$1",
        [user],
      );
      await db.exec("set role authenticated");
      for (const status of ["Cancelado", "Expedido"]) {
        const next = structuredClone(before);
        const id = crypto.randomUUID();
        next.pallets.push({
          ...next.pallets.find((p) => p.id === f.id)!,
          id,
          code: "CREACION-" + id,
          token: crypto.randomUUID(),
          status,
        });
        await unchangedRejected(() => sync(next, f.rev), "iniciar activo");
      }
      await correct(
        f.id,
        { ...fields, net_kg: 450 },
        "Balanza confirmada",
        f.rev,
      );
      await unchangedRejected(() => sync(before, f.rev), "Conflicto");
      await unchangedRejected(
        () => sync(before, f.rev + 1),
        "reversión supervisada",
      );
      const corrected = await remote();
      await cancel(f.id, "Duplicado", f.rev + 1);
      await unchangedRejected(() => sync(corrected, f.rev + 1), "Conflicto");
      await unchangedRejected(
        () => sync(corrected, f.rev + 2),
        "Pallet cerrado",
      );
      await unchangedRejected(
        () =>
          db.query("select public.sync_workspace($1::jsonb,null)", [
            JSON.stringify(corrected),
          ]),
        "Conflicto",
      );
      const noRevision = await db.query<{ value: Record<string, boolean> }>(
        "select public.sandia_features() as value",
      );
      expect(noRevision.rows[0].value).toHaveProperty(
        "pallet_corrections",
        true,
      );
    } finally {
      await db.exec("rollback");
    }
  });
});

describe.sequential(
  "gestión completa de recepciones y tara de embalaje",
  () => {
    const migration = readFileSync(
      new URL(
        "../supabase/migrations/20261006163006_reception_management_pallet_tare.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const revision = async () =>
      (
        await db.query<{ n: number }>(
          "select revision::int as n from organizations where id=$1",
          [org],
        )
      ).rows[0].n;
    beforeAll(async () => {
      await actingAs(user);
      await db.exec("reset role");
      const before = await remote();
      await db.exec(migration);
      const after = await remote();
      for (const pallet of before.pallets) {
        const next = after.pallets.find((p) => p.id === pallet.id)!;
        expect(next).toMatchObject({
          id: pallet.id,
          code: pallet.code,
          token: pallet.token,
          net_kg: pallet.net_kg,
          status: pallet.status,
        });
        expect(next.gross_kg).toBe(pallet.gross_kg ?? pallet.net_kg + 42);
        expect(next.tare_kg).toBe(
          pallet.gross_kg === null ? 42 : pallet.gross_kg - pallet.net_kg,
        );
      }
      await actingAs(user);
    });
    async function fixture(classified = true) {
      await actingAs(user);
      await db.exec("begin;reset role");
      const receptionId = crypto.randomUUID(),
        weight1 = crypto.randomUUID(),
        weight2 = crypto.randomUUID(),
        classificationId = crypto.randomUUID(),
        palletId = crypto.randomUUID();
      await db.query(
        "insert into receptions(id,organization_id,lot_id,date,responsible,notes) values($1,$2,$3,'2026-10-05','Piris','Recepción conservada')",
        [receptionId, org, snapshot.field_lots[0].id],
      );
      await db.query(
        "insert into reception_weights(id,organization_id,reception_id,sequence,kg,operator,notes) values($1,$2,$3,1,600,'Piris','Pesaje original'),($4,$2,$3,2,400,'Piris','')",
        [weight1, org, receptionId, weight2],
      );
      if (classified) {
        await db.query(
          "insert into classifications(id,organization_id,reception_id,approved_kg,rejected_kg,reason,quality,region,pest_observation,notes) values($1,$2,$3,900,100,'Fruta dañada',4,'San Pedro','Observación conservada','Selección original')",
          [classificationId, org, receptionId],
        );
        await db.query(
          "insert into pallets(id,organization_id,code,token,destination,assembled_at,responsible,gross_kg,net_kg,tare_kg,status,created_by) values($1,$2,$3,gen_random_uuid(),'Uruguay',now(),'Piris',442,400,42,'Etiquetado',$4)",
          [palletId, org, "TARA-" + palletId, user],
        );
        await db.query(
          "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg,created_by) values($1,$2,$3,$4,400,$5)",
          [crypto.randomUUID(), org, palletId, receptionId, user],
        );
      }
      await db.exec("set role authenticated");
      return {
        receptionId,
        weight1,
        weight2,
        classificationId,
        palletId,
        rev: await revision(),
        fields: {
          date: "2026-10-05",
          responsible: "Piris",
          notes: "Recepción conservada",
          weights: [
            {
              id: weight1,
              kg: 600,
              operator: "Piris",
              notes: "Pesaje original",
            },
            { id: weight2, kg: 400, operator: "Piris", notes: "" },
          ],
          classification: classified
            ? { id: classificationId, rejected_kg: 100, reason: "Fruta dañada" }
            : null,
        },
      };
    }
    const correct = (
      id: string,
      fields: unknown,
      reason: string,
      rev: number | null,
    ) =>
      db.query("select public.correct_reception($1,$2::jsonb,$3,$4)", [
        id,
        JSON.stringify(fields),
        reason,
        rev,
      ]);
    const cancel = (
      id: string,
      reason: string,
      rev: number | null,
      confirmed: boolean,
    ) =>
      db.query("select public.cancel_reception($1,$2,$3,$4)", [
        id,
        reason,
        rev,
        confirmed,
      ]);
    async function reject(operation: () => Promise<unknown>, message: string) {
      await db.exec("savepoint invalid_management");
      await expect(operation()).rejects.toThrow(message);
      await db.exec(
        "rollback to savepoint invalid_management;release savepoint invalid_management",
      );
    }
    it("mantiene todas las funciones y la reaplicación no duplica auditoría ni revisión", async () => {
      await actingAs(user);
      await db.exec("reset role");
      const before = await remote(),
        rev = await revision();
      await db.exec(migration);
      const after = await remote();
      expect(after).toEqual(before);
      expect(await revision()).toBe(rev);
      await actingAs(user);
      const features = await db.query<{ value: Record<string, boolean> }>(
        "select public.sandia_features() as value",
      );
      expect(features.rows[0].value).toMatchObject({
        reception_edit: true,
        recipient_access: true,
        label_export_data: true,
        label_destination_edit: true,
        pallet_corrections: true,
        reception_management: true,
        pallet_tare: true,
      });
    });
    it("corrige una recepción clasificada, añade pesaje y elimina otro sin perder origen, calidad ni versiones", async () => {
      const f = await fixture();
      try {
        const before = await remote(),
          newWeight = crypto.randomUUID();
        const fields = {
          ...f.fields,
          date: "2026-10-06",
          weights: [
            { ...f.fields.weights[0], kg: 650 },
            {
              id: newWeight,
              kg: 250,
              operator: "Piris",
              notes: "Lectura faltante",
            },
          ],
        };
        await correct(
          f.receptionId,
          fields,
          "Corregir recepción digitada",
          f.rev,
        );
        const after = await remote();
        expect(await revision()).toBe(f.rev + 1);
        expect(
          after.receptions.find((r) => r.id === f.receptionId),
        ).toMatchObject({
          date: "2026-10-06",
          lot_id: before.receptions.find((r) => r.id === f.receptionId)!.lot_id,
        });
        expect(
          after.reception_weights.find((w) => w.id === f.weight2),
        ).toMatchObject({ kg: 400, status: "Cancelado", sequence: 2 });
        expect(
          after.reception_weights.find((w) => w.id === newWeight),
        ).toMatchObject({
          kg: 250,
          status: "Activo",
          sequence: 3,
          created_by: user,
        });
        expect(
          after.classifications.find((c) => c.id === f.classificationId),
        ).toMatchObject({
          approved_kg: 800,
          rejected_kg: 100,
          quality: 4,
          reason: "Fruta dañada",
          region: "San Pedro",
          pest_observation: "Observación conservada",
          notes: "Selección original",
        });
        expect(after.pallets.find((p) => p.id === f.palletId)).toMatchObject({
          net_kg: 400,
          gross_kg: 442,
          tare_kg: 42,
          status: "En armado",
          code: before.pallets.find((p) => p.id === f.palletId)!.code,
          token: before.pallets.find((p) => p.id === f.palletId)!.token,
        });
        expect(after.producers).toEqual(before.producers);
        expect(after.pallet_items).toEqual(before.pallet_items);
        const logs = after.audit_logs.filter(
          (l) => l.reason === "Corregir recepción digitada",
        );
        expect(logs.length).toBeGreaterThanOrEqual(5);
        expect(
          logs.every(
            (l) => l.actor === "Admin prueba" && l.created_by === user,
          ),
        ).toBe(true);
        expect(logs.find((l) => l.entity_id === f.weight1)).toMatchObject({
          before: { kg: 600 },
          after: { kg: 650 },
        });
        await correct(
          f.receptionId,
          fields,
          "Sin modificación adicional",
          f.rev + 1,
        );
        expect(await revision()).toBe(f.rev + 1);
        expect((await remote()).audit_logs).toEqual(after.audit_logs);
      } finally {
        await db.exec("rollback");
      }
    });
    it("confirma pérdidas y evita reducir el aprobado por debajo de pallets activos", async () => {
      const f = await fixture();
      try {
        await reject(
          () =>
            correct(
              f.receptionId,
              {
                ...f.fields,
                classification: {
                  ...f.fields.classification!,
                  rejected_kg: 700,
                },
              },
              "Revisión de pérdida",
              f.rev,
            ),
          "pallets activos",
        );
        expect(await revision()).toBe(f.rev);
        await correct(
          f.receptionId,
          {
            ...f.fields,
            classification: {
              ...f.fields.classification!,
              rejected_kg: 200,
              reason: "Rachadura confirmada",
            },
          },
          "Pérdida revisada",
          f.rev,
        );
        const c = (await remote()).classifications.find(
          (c) => c.id === f.classificationId,
        )!;
        expect(c).toMatchObject({
          approved_kg: 800,
          rejected_kg: 200,
          reason: "Rachadura confirmada",
          quality: 4,
        });
      } finally {
        await db.exec("rollback");
      }
    });
    it("edita recepción sin clasificación conservando secuencia y exigiendo al menos un peso", async () => {
      const f = await fixture(false);
      try {
        await reject(
          () =>
            correct(
              f.receptionId,
              { ...f.fields, weights: [] },
              "Faltante",
              f.rev,
            ),
          "1 y 1000",
        );
        await correct(
          f.receptionId,
          { ...f.fields, weights: [{ ...f.fields.weights[0], kg: 390 }] },
          "Lectura real",
          f.rev,
        );
        const after = await remote();
        expect(
          after.reception_weights.find((w) => w.id === f.weight1),
        ).toMatchObject({ kg: 390, sequence: 1, status: "Activo" });
        expect(
          after.reception_weights.find((w) => w.id === f.weight2),
        ).toMatchObject({ status: "Cancelado" });
        expect(
          after.classifications.some((c) => c.reception_id === f.receptionId),
        ).toBe(false);
      } finally {
        await db.exec("rollback");
      }
    });
    it("rechaza payload mal formado, pérdidas no confirmadas, ids duplicados, otros orígenes y reactivación", async () => {
      const f = await fixture();
      try {
        const bads: [unknown, string][] = [
          [{ ...f.fields, classification: null }, "Confirme las pérdidas"],
          [
            {
              ...f.fields,
              classification: {
                ...f.fields.classification!,
                id: crypto.randomUUID(),
              },
            },
            "no corresponde",
          ],
          [
            {
              ...f.fields,
              classification: {
                ...f.fields.classification!,
                rejected_kg: 1001,
              },
            },
            "superar",
          ],
          [
            {
              ...f.fields,
              classification: { ...f.fields.classification!, reason: "" },
            },
            "motivo",
          ],
          [
            {
              ...f.fields,
              weights: [f.fields.weights[0], f.fields.weights[0]],
            },
            "duplicado",
          ],
          [
            { ...f.fields, weights: [{ ...f.fields.weights[0], kg: -1 }] },
            "Peso inválido",
          ],
          [
            { ...f.fields, weights: [{ ...f.fields.weights[0], kg: 1.123 }] },
            "Peso inválido",
          ],
          [{ ...f.fields, organization_id: otherOrg }, "Datos de recepción"],
          [
            {
              ...f.fields,
              weights: [{ ...f.fields.weights[0], status: "Activo" }],
            },
            "Datos de pesaje",
          ],
        ];
        for (const [fields, message] of bads)
          await reject(
            () => correct(f.receptionId, fields, "Revisar datos", f.rev),
            message,
          );
        await db.exec("reset role");
        const otherId = crypto.randomUUID(),
          otherWeight = crypto.randomUUID();
        await db.query(
          "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,'2026-10-06','Otro')",
          [otherId, org, snapshot.field_lots[0].id],
        );
        await db.query(
          "insert into reception_weights(id,organization_id,reception_id,sequence,kg,operator) values($1,$2,$3,1,390,'Otro')",
          [otherWeight, org, otherId],
        );
        await db.exec("set role authenticated");
        await reject(
          () =>
            correct(
              f.receptionId,
              {
                ...f.fields,
                weights: [
                  { ...f.fields.weights[0], id: otherWeight },
                  f.fields.weights[1],
                ],
              },
              "ID equivocado",
              f.rev,
            ),
          "otra recepción",
        );
      } finally {
        await db.exec("rollback");
      }
    });
    it("exige confirmación y elimina la recepción con sus pallets conservando códigos, pesos y auditoría", async () => {
      const f = await fixture();
      try {
        await reject(
          () => cancel(f.receptionId, "Recepción duplicada", f.rev, false),
          "Confirme",
        );
        const before = await remote();
        await cancel(f.receptionId, "Recepción duplicada", f.rev, true);
        const after = await remote();
        expect(await revision()).toBe(f.rev + 1);
        expect(
          after.receptions.find((r) => r.id === f.receptionId),
        ).toMatchObject({ status: "Cancelado", notes: "Recepción conservada" });
        expect(
          after.reception_weights
            .filter((w) => w.reception_id === f.receptionId)
            .every((w) => w.status === "Cancelado"),
        ).toBe(true);
        expect(
          after.classifications.find((c) => c.id === f.classificationId),
        ).toMatchObject({
          status: "Cancelado",
          approved_kg: 900,
          rejected_kg: 100,
        });
        expect(after.pallets.find((p) => p.id === f.palletId)).toMatchObject({
          ...before.pallets.find((p) => p.id === f.palletId)!,
          status: "Cancelado",
          updated_at: expect.any(String),
        });
        expect(after.pallet_items).toEqual(before.pallet_items);
        expect(after.producers).toEqual(before.producers);
        expect(after.field_lots).toEqual(before.field_lots);
        const logs = after.audit_logs.filter(
          (l) => l.reason === "Recepción duplicada",
        );
        expect(logs).toHaveLength(5);
        expect(
          logs.every(
            (l) => l.created_by === user && l.actor === "Admin prueba",
          ),
        ).toBe(true);
        const token = after.pallets.find((p) => p.id === f.palletId)!.token;
        expect(
          (
            await db.query<{ value: unknown }>(
              "select public.public_pallet_trace($1) as value",
              [token],
            )
          ).rows[0].value,
        ).toBeNull();
        await cancel(f.receptionId, "Ya eliminado", f.rev + 1, true);
        expect(await revision()).toBe(f.rev + 1);
        await reject(
          () => correct(f.receptionId, f.fields, "Reactivar", f.rev + 1),
          "cancelada",
        );
      } finally {
        await db.exec("rollback");
      }
    });
    it("elimina recepción sin pallets sin solicitar confirmación e impide restaurarla desde cache", async () => {
      const f = await fixture(false);
      try {
        const old = await remote();
        await cancel(f.receptionId, "Duplicado sin pallets", f.rev, false);
        await reject(() => sync(old, f.rev), "Conflicto");
        await reject(() => sync(old, f.rev + 1), "Recepción cerrada");
        const after = await remote();
        const resurrected = structuredClone(after);
        resurrected.reception_weights.find((w) => w.id === f.weight1)!.status =
          "Activo";
        await reject(() => sync(resurrected, f.rev + 1), "Pesaje cancelado");
      } finally {
        await db.exec("rollback");
      }
    });
    it("bloquea edición y eliminación si hay expedición, incluso cuando el vínculo esté cancelado", async () => {
      const f = await fixture();
      try {
        await db.exec("reset role");
        const shipment = crypto.randomUUID();
        await db.query(
          "insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible) values($1,$2,'Uruguay','Uruguay','Chofer','ABC123','2026-10-06','Piris')",
          [shipment, org],
        );
        await db.query(
          "insert into shipment_pallets(id,organization_id,shipment_id,pallet_id,status) values($1,$2,$3,$4,'Cancelado')",
          [crypto.randomUUID(), org, shipment, f.palletId],
        );
        await db.exec("set role authenticated");
        await reject(
          () => correct(f.receptionId, f.fields, "Corregir", f.rev),
          "expedición",
        );
        await reject(
          () => cancel(f.receptionId, "Eliminar", f.rev, true),
          "expedición",
        );
      } finally {
        await db.exec("rollback");
      }
    });
    it("impide cancelar pallets mixtos y preserva recepciones de otros productores", async () => {
      const f = await fixture();
      try {
        await db.exec("reset role");
        const otherId = crypto.randomUUID();
        await db.query(
          "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,'2026-10-06','Otro productor')",
          [otherId, org, snapshot.field_lots[0].id],
        );
        await db.query(
          "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,50)",
          [crypto.randomUUID(), org, f.palletId, otherId],
        );
        await db.exec("set role authenticated");
        await reject(
          () => cancel(f.receptionId, "Duplicado", f.rev, true),
          "varias recepciones",
        );
        expect(await revision()).toBe(f.rev);
      } finally {
        await db.exec("rollback");
      }
    });
    it("protege roles, identidad real, organización, revisión y motivos", async () => {
      const f = await fixture();
      try {
        await reject(
          () => correct(f.receptionId, f.fields, "", f.rev),
          "justificación",
        );
        await reject(
          () => cancel(f.receptionId, " ", f.rev, true),
          "justificación",
        );
        await reject(
          () => correct(f.receptionId, f.fields, "Corrección", null),
          "Conflicto",
        );
        await reject(
          () => cancel(f.receptionId, "Duplicado", f.rev + 1, true),
          "Conflicto",
        );
        await reject(
          () => correct(crypto.randomUUID(), f.fields, "Corrección", f.rev),
          "organización",
        );
        for (const role of [
          "recepcion",
          "pesaje",
          "packing",
          "auditor",
          "destinatario",
        ]) {
          await db.exec("reset role");
          await db.query("update profiles set role=$1 where user_id=$2", [
            role,
            user,
          ]);
          await db.exec("set role authenticated");
          await reject(
            () => correct(f.receptionId, f.fields, "Intento", f.rev),
            "Solo administrador",
          );
          await reject(
            () => cancel(f.receptionId, "Intento", f.rev, true),
            "Solo administrador",
          );
        }
        await db.exec("reset role");
        await db.query("update profiles set role='gestor' where user_id=$1", [
          user,
        ]);
        await db.exec("set role authenticated");
        await correct(
          f.receptionId,
          { ...f.fields, notes: "Revisado por gestor" },
          "Justificación real",
          f.rev,
        );
        expect(await revision()).toBe(f.rev + 1);
        await actingAs(null, "anon");
        await reject(
          () => correct(f.receptionId, f.fields, "Intento", f.rev + 1),
          "permission denied",
        );
        await actingAs(null);
        await reject(
          () => cancel(f.receptionId, "Intento", f.rev + 1, true),
          "Inicie sesión",
        );
        await actingAs(user);
        await db.exec("reset role");
        await db.query(
          "update profiles set organization_id=$1,role='administrador' where user_id=$2",
          [otherOrg, user],
        );
        await db.exec("set role authenticated");
        const revOther = (
          await db.query<{ n: number }>(
            "select revision::int as n from organizations where id=$1",
            [otherOrg],
          )
        ).rows[0].n;
        await reject(
          () => correct(f.receptionId, f.fields, "Intento", revOther),
          "organización",
        );
      } finally {
        await db.exec("rollback");
      }
    });
    it("crea pallets con peso neto informado y calcula bruto sin restar 42 kg", async () => {
      const f = await fixture();
      try {
        await db.exec("reset role");
        await db.query(
          "update pallets p set status='Cancelado' where organization_id=$1 and not exists(select 1 from pallet_items i where i.pallet_id=p.id)",
          [org],
        );
        await db.exec("set role authenticated");
        const payload = await remote();
        const newPallet = {
          ...base(org, "En armado"),
          code: "PROVISIONAL",
          token: crypto.randomUUID(),
          destination: "Uruguay",
          assembled_at: new Date().toISOString(),
          weighed_date: "2026-10-06",
          responsible: "Piris",
          gross_kg: null,
          net_kg: 390,
          fruit_count: null,
          notes: "",
          tare_kg: 42,
        };
        payload.pallets.push(newPallet);
        payload.pallet_items.push({
          ...base(org),
          pallet_id: newPallet.id,
          reception_id: f.receptionId,
          kg: 390,
        });
        await sync(payload, f.rev);
        const after = await remote();
        expect(after.pallets.find((p) => p.id === newPallet.id)).toMatchObject({
          net_kg: 390,
          gross_kg: 432,
          tare_kg: 42,
        });
        expect(
          after.pallet_items.find((i) => i.pallet_id === newPallet.id),
        ).toHaveProperty("kg", 390);
        const previousClient = await remote();
        for (const p of previousClient.pallets) delete p.tare_kg;
        await sync(previousClient, f.rev + 1);
        expect(
          (await remote()).pallets.find((p) => p.id === newPallet.id),
        ).toMatchObject({ net_kg: 390, gross_kg: 432, tare_kg: 42 });
      } finally {
        await db.exec("rollback");
      }
    });
    it("corrige neto y tara confirmada juntos con auditoría sin cambiar QR ni origen", async () => {
      const f = await fixture();
      try {
        const before = await remote();
        await db.query("select public.correct_pallet($1,$2::jsonb,$3,$4)", [
          f.palletId,
          JSON.stringify({
            net_kg: 390,
            gross_kg: 432,
            tare_kg: 42,
            fruit_count: null,
            weighed_date: "2026-10-06",
            responsible: "Piris",
            notes: "Peso revisado",
          }),
          "Confirmar peso neto",
          f.rev,
        ]);
        const after = await remote();
        expect(after.pallets.find((p) => p.id === f.palletId)).toMatchObject({
          net_kg: 390,
          gross_kg: 432,
          tare_kg: 42,
          status: "En armado",
          token: before.pallets.find((p) => p.id === f.palletId)!.token,
        });
        expect(
          after.pallet_items.find((i) => i.pallet_id === f.palletId),
        ).toHaveProperty("kg", 390);
        await reject(
          () =>
            db.query("select public.correct_pallet($1,$2::jsonb,$3,$4)", [
              f.palletId,
              JSON.stringify({
                net_kg: 390,
                gross_kg: 390,
                tare_kg: 42,
                fruit_count: null,
                weighed_date: null,
                responsible: "Piris",
                notes: "",
              }),
              "Bruto incorrecto",
              f.rev + 1,
            ]),
          "neto más 42",
        );
      } finally {
        await db.exec("rollback");
      }
    });
    it("reabre etiquetas modificadas y también protege RPC antigua contra pallets vinculados", async () => {
      const f = await fixture();
      try {
        await db.query(
          "select public.update_pallet_export_label($1,$2::jsonb,$3,$4)",
          [
            f.palletId,
            JSON.stringify({ origin: "San Pedro confirmado" }),
            "Editar etiqueta",
            f.rev,
          ],
        );
        expect(
          (await remote()).pallets.find((p) => p.id === f.palletId),
        ).toHaveProperty("status", "En armado");
        await db.exec("reset role");
        await db.query(
          "update pallets set status='Listo para carga' where id=$1",
          [f.palletId],
        );
        await db.exec("set role authenticated");
        await db.query(
          "select public.update_pallet_label_details($1,$2::jsonb,$3,$4,$5)",
          [
            f.palletId,
            JSON.stringify({ origin: "San Pedro - Paraguay" }),
            "Uruguay",
            "Etiqueta nueva",
            f.rev + 1,
          ],
        );
        expect(
          (await remote()).pallets.find((p) => p.id === f.palletId),
        ).toHaveProperty("status", "En armado");
        await db.exec("reset role");
        const shipment = crypto.randomUUID();
        await db.query(
          "insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible) values($1,$2,'Uruguay','Uruguay','Chofer','ABC','2026-10-06','Piris')",
          [shipment, org],
        );
        await db.query(
          "insert into shipment_pallets(id,organization_id,shipment_id,pallet_id) values($1,$2,$3,$4)",
          [crypto.randomUUID(), org, shipment, f.palletId],
        );
        await db.exec("set role authenticated");
        await reject(
          () =>
            db.query(
              "select public.update_pallet_export_label($1,$2::jsonb,$3,$4)",
              [f.palletId, "{}", "No editar expedido", f.rev + 2],
            ),
          "expedición",
        );
      } finally {
        await db.exec("rollback");
      }
    });
    it("mantiene RLS, revoca escritura directa y deja únicamente wrappers invoker con rutas fijas", async () => {
      await actingAs(user);
      const tables = await db.query<{
        relname: string;
        relrowsecurity: boolean;
      }>(
        "select relname,relrowsecurity from pg_class where relname in ('receptions','reception_weights','classifications','pallets') and relnamespace='public'::regnamespace",
      );
      expect(tables.rows).toHaveLength(4);
      expect(tables.rows.every((t) => t.relrowsecurity)).toBe(true);
      const functions = await db.query<{
        schema: string;
        name: string;
        definer: boolean;
        config: string[];
      }>(
        "select n.nspname as schema,p.proname as name,p.prosecdef as definer,p.proconfig as config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('correct_reception','cancel_reception')",
      );
      expect(functions.rows).toHaveLength(4);
      for (const fn of functions.rows) {
        expect(fn.definer).toBe(fn.schema === "agronorte_private");
        expect(fn.config).toContain('search_path=""');
      }
      const privileges = await db.query<{
        anon_correct: boolean;
        anon_cancel: boolean;
        direct_update: boolean;
        direct_delete: boolean;
        private_anon: boolean;
      }>(
        "select has_function_privilege('anon','public.correct_reception(uuid,jsonb,text,bigint)','EXECUTE') as anon_correct,has_function_privilege('anon','public.cancel_reception(uuid,text,bigint,boolean)','EXECUTE') as anon_cancel,has_table_privilege('authenticated','public.reception_weights','UPDATE') as direct_update,has_table_privilege('authenticated','public.receptions','DELETE') as direct_delete,has_function_privilege('anon','agronorte_private.cancel_reception(uuid,text,bigint,boolean)','EXECUTE') as private_anon",
      );
      expect(
        Object.values(privileges.rows[0]).every((value) => value === false),
      ).toBe(true);
    });
    it("conserva tara histórica con cliente antiguo y bloquea cambios de pesos clasificados por sincronización", async () => {
      const f = await fixture();
      try {
        await db.exec("reset role");
        await db.query(
          "update pallets set gross_kg=420,tare_kg=20 where id=$1",
          [f.palletId],
        );
        await db.exec("set role authenticated");
        await db.query("select public.correct_pallet($1,$2::jsonb,$3,$4)", [
          f.palletId,
          JSON.stringify({
            net_kg: 390,
            gross_kg: null,
            fruit_count: null,
            weighed_date: null,
            responsible: "Piris",
            notes: "",
          }),
          "Conservar bruto histórico",
          f.rev,
        ]);
        expect(
          (await remote()).pallets.find((p) => p.id === f.palletId),
        ).toMatchObject({ net_kg: 390, gross_kg: 410, tare_kg: 20 });
        const forged = await remote();
        forged.reception_weights.find((w) => w.id === f.weight1)!.kg = 601;
        forged.reception_weights.find(
          (w) => w.id === f.weight1,
        )!.correction_reason = "Evitar flujo auditado";
        await reject(() => sync(forged, f.rev + 1), "ya clasificada");
      } finally {
        await db.exec("rollback");
      }
    });
  },
);
