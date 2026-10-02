import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base, seed } from "./domain";
import type { Data } from "./types";
const user = "30000000-0000-4000-8000-000000000001";
const org = "10000000-0000-4000-8000-000000000001";
const db = new PGlite();
let snapshot: Data;
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security; create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`,
  );
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
  await db.query(`insert into auth.users values($1);`, [user]);
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
    const result = await db.query("select * from public." + table);
    (d[table] as unknown[]) = result.rows;
  }
  return d;
}
describe.sequential("migración y reglas de PostgreSQL", () => {
  it("aplica la migración, genera códigos de servidor y registra auditoría", async () => {
    await db.exec("set role authenticated");
    const result = await sync(snapshot, 0);
    expect(result.rows[0].revision).toBe(1);
    const audit = await db.query<{ count: number }>(
      "select count(*)::int as count from audit_logs",
    );
    expect(audit.rows[0].count).toBeGreaterThan(10);
    snapshot = await remote();
    expect(snapshot.field_lots[0].code).toMatch(/^SAN-/);
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
      quality: 4,
      notes: "",
    });
    await sync(next, 2);
    snapshot = await remote();
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
    await db.exec("set role authenticated");
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
});
