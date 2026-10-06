import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const operation = readFileSync(
  new URL(
    "../supabase/operations/20261006_afidi_1571652_uruguay.sql",
    import.meta.url,
  ),
  "utf8",
);
const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const creator = "30000000-0000-4000-8000-000000000001";
const db = new PGlite();
const palletId = (number: number) =>
  `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

type PalletSnapshot = {
  id: string;
  code: string;
  token: string;
  destination: string;
  net_kg: string;
  gross_kg: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
};

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
    grant usage on schema storage to authenticated;
    grant select on storage.objects to authenticated;
  `);
  for (const migration of [
    "202610020001_sandia.sql",
    "202610020002_producer_corrections.sql",
    "202610020003_real_intake.sql",
    "202610020004_reception_date_correction.sql",
    "202610020005_operational_intake_trace.sql",
    "202610020006_regional_loss_observations.sql",
    "20261005165516_recipient_access_reception_edit.sql",
    "20261005225807_pallet_export_label.sql",
  ]) {
    await db.exec(
      readFileSync(
        new URL(`../supabase/migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  }
  await db.query(
    "insert into auth.users(id,email) values($1,'creator@test.invalid')",
    [creator],
  );
  await db.query(
    "insert into organizations(id,name,revision) values($1,'Cooperativa Agronorte',7),($2,'Otra cooperativa',3)",
    [org, otherOrg],
  );
  await db.query(
    "insert into profiles(organization_id,user_id,name,role) values($1,$2,'Operador original','administrador')",
    [org, creator],
  );
}, 30000);

afterAll(async () => await db.close());

async function pallets() {
  const result = await db.query<{ value: PalletSnapshot }>(
    "select to_jsonb(p) as value from public.pallets p order by id",
  );
  return result.rows.map((row) => row.value);
}

async function revision() {
  const result = await db.query<{ revision: number }>(
    "select revision from organizations where id=$1",
    [org],
  );
  return result.rows[0].revision;
}

async function insertPallet(
  number: number,
  overrides: {
    status?: string;
    destination?: string;
    organization?: string;
    createdAt?: string;
    metadata?: Record<string, unknown> | null;
  } = {},
) {
  await db.query(
    `insert into pallets(id,organization_id,code,destination,assembled_at,responsible,gross_kg,net_kg,status,created_at,updated_at,created_by,metadata)
     values($1,$2,$3,$4,'2026-10-01T15:00:00Z','Responsable original',432,390,$5,$6,'2026-10-01T15:00:00Z',$7,$8::jsonb)`,
    [
      palletId(number),
      overrides.organization ?? org,
      `PAL-ORIGINAL-${number}`,
      overrides.destination ?? "Uruguay",
      overrides.status ?? "En armado",
      overrides.createdAt ?? "2026-10-01T15:00:00Z",
      creator,
      overrides.metadata == null ? null : JSON.stringify(overrides.metadata),
    ],
  );
}

beforeEach(async () => {
  await db.exec("rollback");
  await db.exec(
    "delete from shipment_pallets; delete from shipments; delete from pallets; delete from audit_logs;",
  );
  await db.query(
    "update organizations set name='Cooperativa Agronorte',revision=7 where id=$1",
    [org],
  );
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await insertPallet(1);
  await insertPallet(2, {
    status: "Etiquetado",
    destination: " URUGUAY ",
    metadata: {
      packing_note: "Preservar este dato",
      export_label: {
        afidi: "Anterior",
        producer_code: "COD-PRODUCTOR",
        origin: "Depto. de San Pedro – Paraguay",
        harvest_date: "2026-09-29",
        packaged_date: "2026-10-01",
        senave_program: true,
      },
    },
  });
  await insertPallet(3, {
    status: "Listo para carga",
    createdAt: "2026-10-06T17:19:13Z",
    metadata: { export_label: { afidi: "" } },
  });
  await insertPallet(4, {
    status: "Listo para carga",
    metadata: { export_label: { afidi: "1571652" } },
  });
  await insertPallet(5, { createdAt: "2026-10-06T17:19:13.001Z" });
  await insertPallet(6, { destination: "Argentina" });
  await insertPallet(7, { destination: "Pendiente de confirmar" });
  await insertPallet(8, { organization: otherOrg });
  await insertPallet(9, { status: "Expedido" });
  await insertPallet(10, { status: "Cancelado" });
  await insertPallet(11);
  await db.query(
    `insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible,status)
    values('50000000-0000-4000-8000-000000000001',$1,'Uruguay','Uruguay','Conductor','ABC123','2026-10-06','Responsable','Cancelado')`,
    [org],
  );
  await db.query(
    `insert into shipment_pallets(id,organization_id,shipment_id,pallet_id,status)
    values('60000000-0000-4000-8000-000000000001',$1,'50000000-0000-4000-8000-000000000001',$2,'Cancelado')`,
    [org, palletId(11)],
  );
  // Keep creation logs outside the assertions about this corrective operation.
  await db.exec("delete from audit_logs");
});

describe.sequential("AFIDI 1571652 para pallets actuales de Uruguay", () => {
  it("actualiza las tres etapas autorizadas y conserva pesos, QR, autor y otros campos de etiqueta", async () => {
    const before = await pallets();
    await db.exec(operation);
    const after = await pallets();
    for (let index = 0; index < 3; index++) {
      expect(after[index].metadata?.export_label).toMatchObject({
        afidi: "1571652",
      });
      expect(after[index].status).toBe("En armado");
      expect(after[index]).toMatchObject({
        id: before[index].id,
        code: before[index].code,
        token: before[index].token,
        net_kg: before[index].net_kg,
        gross_kg: before[index].gross_kg,
        created_by: before[index].created_by,
        created_at: before[index].created_at,
        destination: before[index].destination,
      });
    }
    expect(after[1].metadata).toEqual({
      ...before[1].metadata,
      export_label: {
        ...(before[1].metadata?.export_label as Record<string, unknown>),
        afidi: "1571652",
      },
    });
    expect(after.slice(3)).toEqual(before.slice(3));
    expect(await revision()).toBe(8);
    expect(
      (
        await db.query<{ revision: number }>(
          "select revision from organizations where id=$1",
          [otherOrg],
        )
      ).rows[0].revision,
    ).toBe(3);
  });

  it("registra antes/después y motivo con el actor real del SQL Editor, sin atribuirlo a Piris", async () => {
    await db.exec(operation);
    const logs = await db.query<{
      actor: string;
      created_by: string | null;
      reason: string;
      before: PalletSnapshot;
      after: PalletSnapshot;
    }>(
      `select actor,created_by,reason,"before","after" from audit_logs order by entity_id`,
    );
    expect(logs.rows).toHaveLength(3);
    for (const log of logs.rows) {
      expect(log.actor).toBe("Administrador del servidor");
      expect(log.created_by).toBeNull();
      expect(log.reason).toContain(
        "AFIDI 1571652 confirmado por el propietario",
      );
      expect(log.before.metadata?.export_label).not.toMatchObject({
        afidi: "1571652",
      });
      expect(log.after.metadata?.export_label).toMatchObject({
        afidi: "1571652",
      });
      expect(log.after.created_by).toBe(creator);
    }
  });

  it("es idempotente y no convierte el AFIDI actual en un valor predeterminado para pallets posteriores", async () => {
    await db.exec(operation);
    const first = await pallets();
    await db.exec(operation);
    expect(await pallets()).toEqual(first);
    expect(await revision()).toBe(8);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from audit_logs",
        )
      ).rows[0].count,
    ).toBe(3);
    await insertPallet(12, { createdAt: "2026-10-07T12:00:00Z" });
    await db.exec(operation);
    const future = (await pallets()).find(
      (pallet) => pallet.id === palletId(12),
    );
    expect(future?.metadata).toBeNull();
    expect(await revision()).toBe(8);
  });

  it("conserva el actor autenticado real cuando SQL Editor tiene una sesión identificada", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      creator,
    ]);
    await db.exec(operation);
    const audit = await db.query<{ actor: string; created_by: string }>(
      "select actor,created_by from audit_logs",
    );
    expect(audit.rows).toHaveLength(3);
    expect(
      audit.rows.every(
        (log) =>
          log.actor === "Operador original" && log.created_by === creator,
      ),
    ).toBe(true);
  });

  it("rechaza una organización incorrecta, falta del soporte de etiquetas o auditoría desactivada", async () => {
    for (const [damage, message] of [
      [
        "alter table pallets rename to unrelated_pallets",
        "no existe en este proyecto",
      ],
      [
        "update organizations set name='Otra empresa' where id='" + org + "'",
        "no es la organización",
      ],
      [
        "drop function public.update_pallet_export_label(uuid,jsonb,text,bigint)",
        "actualización de etiquetas",
      ],
      [
        "alter table pallets drop column metadata",
        "actualización de etiquetas",
      ],
      [
        "alter table pallets disable trigger audit_change",
        "auditoría de pallets",
      ],
    ]) {
      const before = await pallets();
      await db.exec("begin");
      await db.exec(damage);
      await expect(db.exec(operation)).rejects.toThrow(message);
      await db.exec("rollback");
      expect(await pallets()).toEqual(before);
      expect(await revision()).toBe(7);
      expect(
        (
          await db.query<{ count: number }>(
            "select count(*)::int as count from audit_logs",
          )
        ).rows[0].count,
      ).toBe(0);
    }
  });

  it("revierte toda la operación si un pallet posterior de la misma carga tiene metadatos inválidos", async () => {
    for (const malformed of ["[]", '{"export_label":"incorrecto"}']) {
      await db.exec("begin");
      await db.exec(
        "alter table pallets drop constraint pallets_export_metadata_check",
      );
      await db.query("update pallets set metadata=$1::jsonb where id=$2", [
        malformed,
        palletId(3),
      ]);
      await db.exec("delete from audit_logs");
      const before = await pallets();
      await db.exec("commit");
      await expect(db.exec(operation)).rejects.toThrow("inválidos en pallet");
      await db.exec("rollback");
      expect(await pallets()).toEqual(before);
      expect(await revision()).toBe(7);
      expect(
        (
          await db.query<{ count: number }>(
            "select count(*)::int as count from audit_logs",
          )
        ).rows[0].count,
      ).toBe(0);
      await db.query("update pallets set metadata=null where id=$1", [
        palletId(3),
      ]);
      await db.exec("delete from audit_logs");
      await db.exec(`alter table pallets add constraint pallets_export_metadata_check check (
        metadata is null or (
          jsonb_typeof(metadata)='object' and length(metadata::text)<=4096
          and agronorte_private.valid_export_label(metadata->'export_label')
          and (metadata#>'{export_label,senave_program}' is distinct from 'true'::jsonb or lower(trim(destination))='uruguay')
        )
      )`);
    }
  });
});
