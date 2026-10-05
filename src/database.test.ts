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
