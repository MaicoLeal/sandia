import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const user = "30000000-0000-4000-8000-000000000001";
const id = (number: number) =>
  `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const db = new PGlite();
const template = readFileSync(
  new URL(
    "../supabase/operations/20261007_correct_current_label_sources.sql",
    import.meta.url,
  ),
  "utf8",
);
const target = id(1);
const tareProducer = id(2);
const trap = id(10);
const nets = [320, 345.5, 310.5];
const payload = {
  target_producer_id: target,
  allowed_producer_names: [
    "Productor de referencia",
    "Productór de referencia",
  ],
  trap_source_key: "FUENTE-TEST",
  trap_source_row: 20,
  trap_code: "SPE-TEST-017-SAN",
  tare_producer_id: tareProducer,
  tare_pallets: nets.map((net, index) => ({
    id: id(100 + index),
    expected_net_kg: net,
  })),
  expected_revision: 7,
};
function operation(overrides: Record<string, unknown> = {}) {
  return template.replace(
    "payload constant jsonb='{}'::jsonb; -- PRIVATE_CORRECTION_PAYLOAD",
    `payload constant jsonb=$payload$${JSON.stringify({ ...payload, ...overrides })}$payload$::jsonb; -- PRIVATE_CORRECTION_PAYLOAD`,
  );
}
async function state() {
  const tables = [
    "organizations",
    "producers",
    "trap_installations",
    "pallets",
    "pallet_items",
    "receptions",
    "field_lots",
    "reception_weights",
    "audit_logs",
  ];
  const result: Record<string, unknown> = {};
  for (const table of tables)
    result[table] = (
      await db.query(
        `select to_jsonb(x) as row from public.${table} x order by id`,
      )
    ).rows;
  return result;
}
async function rejectUnchanged(sql: string, text: string) {
  const before = await state();
  await expect(db.exec(sql)).rejects.toThrow(text);
  await db.exec("rollback;reset role");
  expect(await state()).toEqual(before);
}

beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
    grant usage on schema storage to authenticated;grant select on storage.objects to authenticated;`);
  const migrations = [
    "202610020001_sandia.sql",
    "202610020002_producer_corrections.sql",
    "202610020003_real_intake.sql",
    "202610020004_reception_date_correction.sql",
    "202610020005_operational_intake_trace.sql",
    "202610020006_regional_loss_observations.sql",
    "20261005165516_recipient_access_reception_edit.sql",
    "20261005225807_pallet_export_label.sql",
    "20261006131819_pallet_label_details.sql",
    "20261006141341_pallet_corrections.sql",
    "20261006163006_reception_management_pallet_tare.sql",
    "20261007121008_producer_internal_codes.sql",
    "20261007125340_trap_installations.sql",
    "20261007135124_label_importer_details.sql",
  ];
  for (const name of migrations.slice(0, 11))
    await db.exec(
      readFileSync(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  await db.query(
    "insert into organizations(id,name,revision) values($1,'Cooperativa Agronorte',7),($2,'Otra cooperativa',2)",
    [org, otherOrg],
  );
  await db.query("insert into auth.users values($1,'admin@test.invalid')", [
    user,
  ]);
  await db.query(
    "insert into profiles(organization_id,user_id,name,role) values($1,$2,'Administrador de prueba','administrador')",
    [org, user],
  );
  for (const name of migrations.slice(11))
    await db.exec(
      readFileSync(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
}, 30000);
afterAll(async () => await db.close());

beforeEach(async () => {
  await db.exec(
    "rollback;reset role;truncate producers,pallets,shipments cascade;truncate audit_logs;",
  );
  await db.query(
    "update organizations set revision=7,name='Cooperativa Agronorte' where id=$1",
    [org],
  );
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  for (const [producer, name, organization] of [
    [target, "Productór de referencia", org],
    [tareProducer, "Productor de pesajes", org],
    [id(3), "Otro productor", org],
    [id(4), "Otra organización", otherOrg],
  ])
    await db.query(
      "insert into producers(id,organization_id,name,metadata) values($1,$2,$3,$4::jsonb)",
      [
        producer,
        organization,
        name,
        JSON.stringify({
          export_code: "OFICIAL-CUSTOM",
          export_origin: "Origen confirmado",
          extra: "Conservar",
          harvest_reference: {
            date: "2026-10-05",
            status: "Confirmado",
            season: 2026,
            source: "Prueba",
          },
        }),
      ],
    );
  await db.query(
    "insert into trap_installations(id,organization_id,source_key,source_row,source_document,source_form,source_version,source_producer_name,trap_code,host,created_at) values($1,$2,'FUENTE-TEST',20,'Prueba.pdf','TEST','01','PRODUCTOR DE REFERENCIA','SPE-TEST-017-SAN','SANDIA','2026-10-07T12:00:00Z'),($3,$2,'FUENTE-TEST',9,'Prueba.pdf','TEST','01',null,'SPE-TEST-MEL','MELON','2026-10-07T12:00:00Z')",
    [trap, org, id(11)],
  );
  for (const [n, producer] of [
    [20, target],
    [21, tareProducer],
    [22, id(3)],
    [23, id(4)],
  ] as const) {
    const organization = producer === id(4) ? otherOrg : org;
    await db.query(
      "insert into field_lots(id,organization_id,producer_id,code,harvest_date) values($1,$2,$3,$4,'2026-10-05')",
      [id(n), organization, producer, `LOT-TEST-${n}`],
    );
    await db.query(
      "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,'2026-10-06','Responsable de prueba')",
      [id(n + 20), organization, id(n)],
    );
    await db.query(
      "insert into reception_weights(id,organization_id,reception_id,sequence,kg,operator) values($1,$2,$3,1,2000,'Operador de prueba')",
      [id(n + 40), organization, id(n + 20)],
    );
  }
  for (const n of [100, 101, 102, 103, 104, 105]) {
    const net = n < 103 ? nets[n - 100] : 400;
    const organization = n === 105 ? otherOrg : org;
    await db.query(
      "insert into pallets(id,organization_id,code,destination,assembled_at,responsible,net_kg,gross_kg,tare_kg,status,created_at,metadata) values($1,$2,$3,'Uruguay','2026-10-07','Responsable de prueba',$4,$5,$6,$7,'2026-10-07T12:00:00Z',$8::jsonb)",
      [
        id(n),
        organization,
        `PAL-TEST-${n}`,
        net,
        n < 103 ? 2000 : net + 42,
        n < 103 ? 2000 - net : 42,
        n === 103 ? "Etiquetado" : "En armado",
        JSON.stringify({
          extra: "Conservar",
          export_label: {
            afidi: "AFIDI-CUSTOM",
            harvest_date: "2026-10-05",
            packaged_date: "2026-10-07",
            importer_name: "Cliente de prueba",
            importer_address: "Dirección confirmada",
            senave_program: true,
          },
        }),
      ],
    );
    await db.query(
      "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,$5)",
      [
        id(n + 100),
        organization,
        id(n),
        id(n < 103 ? 41 : n === 103 ? 40 : n === 105 ? 43 : 42),
        net,
      ],
    );
  }
  await db.exec("truncate audit_logs");
  await db.query("update organizations set revision=7 where id=$1", [org]);
});

describe("point correction of producer source and verified pallet packaging", () => {
  it("binds only the verified source and restores 42 kg tare while preserving all net/QR/intake data", async () => {
    const before = await state();
    await db.exec(operation());
    const after = await state();
    for (const table of [
      "pallet_items",
      "receptions",
      "field_lots",
      "reception_weights",
    ])
      expect(after[table]).toEqual(before[table]);
    const pallets = (
      await db.query<{
        id: string;
        net_kg: number;
        gross_kg: number;
        tare_kg: number;
        status: string;
        token: string;
        code: string;
        metadata: Record<string, unknown>;
      }>("select * from pallets order by id")
    ).rows;
    for (const [index, p] of pallets.entries()) {
      if (index < 3) {
        expect(Number(p.net_kg)).toBe(nets[index]);
        expect(Number(p.tare_kg)).toBe(42);
        expect(Number(p.gross_kg)).toBe(nets[index] + 42);
      }
      if (index === 3) expect(p.status).toBe("En armado");
      const old = (before.pallets as { row: typeof p }[])[index].row;
      expect(p.token).toBe(old.token);
      expect(p.code).toBe(old.code);
      expect(p.metadata).toEqual(old.metadata);
    }
    const producer = (
      await db.query<{ metadata: Record<string, unknown> }>(
        "select metadata from producers where id=$1",
        [target],
      )
    ).rows[0];
    expect(producer.metadata).toMatchObject({
      trap_reference_codes: ["SPE-TEST-017-SAN"],
      export_code: "OFICIAL-CUSTOM",
      export_origin: "Origen confirmado",
      extra: "Conservar",
    });
    expect(producer.metadata.internal_code).toBe("AGN-0001");
    expect(
      (
        await db.query<{ producer_id: string | null }>(
          "select producer_id from trap_installations where id=$1",
          [trap],
        )
      ).rows[0].producer_id,
    ).toBe(target);
    expect(
      (
        await db.query<{ producer_id: string | null }>(
          "select producer_id from trap_installations where id=$1",
          [id(11)],
        )
      ).rows[0].producer_id,
    ).toBeNull();
    expect(
      (
        await db.query<{ revision: number }>(
          "select revision from organizations where id=$1",
          [org],
        )
      ).rows[0].revision,
    ).toBe(8);
    const logs = (
      await db.query<{
        actor: string;
        reason: string;
        created_by: string | null;
      }>("select actor,reason,created_by from audit_logs")
    ).rows;
    expect(logs).toHaveLength(6);
    expect(
      logs.every(
        (l) =>
          l.actor === "Administrador del servidor" &&
          l.created_by === null &&
          l.reason.includes("42 kg"),
      ),
    ).toBe(true);
    const stable = await state();
    await db.exec(operation());
    expect(await state()).toEqual(stable);
  });

  it("records the real authenticated session actor, never an assumed person", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec(operation());
    const logs = (
      await db.query<{ actor: string; created_by: string }>(
        "select actor,created_by from audit_logs",
      )
    ).rows;
    expect(
      logs.every(
        (l) => l.actor === "Administrador de prueba" && l.created_by === user,
      ),
    ).toBe(true);
  });

  it("aborts atomically on source bound to another producer, wrong identity, missing source, and stale revision", async () => {
    await db.query("update trap_installations set producer_id=$1 where id=$2", [
      id(3),
      trap,
    ]);
    await rejectUnchanged(
      operation({ expected_revision: null }),
      "otro productor",
    );
    await db.query(
      "update trap_installations set producer_id=null where id=$1",
      [trap],
    );
    await rejectUnchanged(
      operation({ expected_revision: null, trap_code: "SPE-OTHER" }),
      "fila/código",
    );
    await rejectUnchanged(
      operation({ expected_revision: null, trap_source_row: 99 }),
      "fila/código",
    );
    await rejectUnchanged(
      operation({ expected_revision: 999 }),
      "Conflicto de sincronización",
    );
  });

  it("rejects canceled/shipped, shipment-linked, post-cutoff, changed net, and wrong-origin tare targets", async () => {
    for (const status of ["Cancelado", "Expedido"]) {
      await db.query("update pallets set status=$1 where id=$2", [
        status,
        id(100),
      ]);
      await rejectUnchanged(operation(), "Un pallet cambió");
      await db.query("update pallets set status='En armado' where id=$1", [
        id(100),
      ]);
    }
    await db.query(
      "update pallets set created_at='2026-10-07T18:13:46Z' where id=$1",
      [id(100)],
    );
    await rejectUnchanged(operation(), "Un pallet cambió");
    await db.query(
      "update pallets set created_at='2026-10-07T12:00:00Z' where id=$1",
      [id(100)],
    );
    await rejectUnchanged(
      operation({
        tare_pallets: [
          { id: id(100), expected_net_kg: 999 },
          ...payload.tare_pallets.slice(1),
        ],
      }),
      "Un pallet cambió",
    );
    await rejectUnchanged(
      operation({ tare_producer_id: id(3) }),
      "Un pallet cambió",
    );
    await db.query(
      "insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible) values($1,$2,'Uruguay','Uruguay','Conductor de prueba','TEST','2026-10-07','Responsable de prueba')",
      [id(300), org],
    );
    await db.query(
      "insert into shipment_pallets(id,organization_id,shipment_id,pallet_id) values($1,$2,$3,$4)",
      [id(301), org, id(300), id(100)],
    );
    await rejectUnchanged(operation(), "Un pallet cambió");
  });

  it("keeps closed, linked and other-organization labels untouched when deriving the real producer code", async () => {
    await db.query("update pallets set status='Expedido' where id=$1", [
      id(103),
    ]);
    const before = (
      await db.query(
        "select to_jsonb(p) row from pallets p where id=any($1::uuid[]) order by id",
        [[id(103), id(104), id(105)]],
      )
    ).rows;
    await db.exec(operation());
    expect(
      (
        await db.query(
          "select to_jsonb(p) row from pallets p where id=any($1::uuid[]) order by id",
          [[id(103), id(104), id(105)]],
        )
      ).rows,
    ).toEqual(before);
  });

  it("requires active real audit/derive/refresh triggers and rejects a BEFORE replacement", async () => {
    for (const table of ["pallets", "producers", "trap_installations"]) {
      await db.exec(`alter table ${table} disable trigger audit_change`);
      await rejectUnchanged(operation(), "auditoría");
      await db.exec(`alter table ${table} enable trigger audit_change`);
    }
    await db.exec(
      "alter table trap_installations disable trigger refresh_references",
    );
    await rejectUnchanged(operation(), "auditoría");
    await db.exec(
      "alter table trap_installations enable trigger refresh_references;drop trigger refresh_references on trap_installations;create trigger refresh_references before insert or update on trap_installations for each row execute function agronorte_private.refresh_trap_producer_references()",
    );
    await rejectUnchanged(operation(), "auditoría");
    await db.exec(
      "drop trigger refresh_references on trap_installations;create trigger refresh_references after insert or update on trap_installations for each row execute function agronorte_private.refresh_trap_producer_references()",
    );
  });

  it("refuses implicit rearming of a future label and unauthorized organization/user access", async () => {
    await db.query(
      "update pallets set created_at='2026-10-07T18:13:46Z' where id=$1",
      [id(103)],
    );
    await rejectUnchanged(operation(), "posteriores al corte");
    await db.query(
      "update pallets set created_at='2026-10-07T12:00:00Z' where id=$1",
      [id(103)],
    );
    await db.query("update organizations set name='Otra empresa' where id=$1", [
      org,
    ]);
    await rejectUnchanged(operation(), "Cooperativa Agronorte");
    await db.query(
      "update organizations set name='Cooperativa Agronorte' where id=$1",
      [org],
    );
    const before = await state();
    await db.exec("set role authenticated");
    await expect(db.exec(operation())).rejects.toThrow();
    await db.exec("rollback;reset role");
    expect(await state()).toEqual(before);
  });

  it("rolls back every audited update if a trigger attempts changing net/QR or source relations", async () => {
    await db.exec(`create function public.test_bad_label_trigger() returns trigger language plpgsql as $$begin new.token=gen_random_uuid();return new;end$$;
      create trigger test_bad_label before update on pallets for each row execute function public.test_bad_label_trigger()`);
    await rejectUnchanged(operation(), "fuera de alcance");
    await db.exec(
      "drop trigger test_bad_label on pallets;drop function public.test_bad_label_trigger()",
    );
  });
});
