import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const user = "30000000-0000-4000-8000-000000000001";
const id = (group: number, number: number) =>
  `${group}0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const db = new PGlite();
const operation = readFileSync(
  new URL(
    "../supabase/operations/20261007_current_uruguay_packaged_date.sql",
    import.meta.url,
  ),
  "utf8",
);
type Row = {
  id: string;
  metadata: Record<string, unknown> | null;
  [key: string]: unknown;
};
async function rows(table: string) {
  return (
    await db.query<{ row: Row }>(
      `select to_jsonb(x) row from public.${table} x order by id`,
    )
  ).rows.map((r) => r.row);
}
async function revision() {
  return (
    await db.query<{ revision: number }>(
      "select revision from organizations where id=$1",
      [org],
    )
  ).rows[0].revision;
}
async function logCount() {
  return (
    await db.query<{ count: number }>(
      "select count(*)::int count from audit_logs",
    )
  ).rows[0].count;
}
async function rejectWithoutChanges(sql: string, message: string) {
  const before = await rows("pallets");
  await expect(db.exec(sql)).rejects.toThrow(message);
  await db.exec("rollback;reset role");
  expect(await rows("pallets")).toEqual(before);
  expect(await revision()).toBe(7);
  expect(await logCount()).toBe(0);
}

beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
    grant usage on schema storage to authenticated;grant select on storage.objects to authenticated;`);
  for (const name of [
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
  ])
    await db.exec(
      readFileSync(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  await db.query(
    "insert into organizations(id,name,revision) values($1,'Cooperativa Agronorte',7),($2,'Otra cooperativa',3)",
    [org, otherOrg],
  );
  await db.query("insert into auth.users values($1,'admin@test.invalid')", [
    user,
  ]);
  await db.query(
    "insert into profiles(organization_id,user_id,name,role) values($1,$2,'Administrador de prueba','administrador')",
    [org, user],
  );
  for (const name of [
    "20261007121008_producer_internal_codes.sql",
    "20261007125340_trap_installations.sql",
    "20261007135124_label_importer_details.sql",
  ])
    await db.exec(
      readFileSync(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  await db.query(
    "insert into producers(id,organization_id,name,metadata) values($1,$2,'Productor de prueba',$3::jsonb),($4,$5,'Otro productor',null)",
    [
      id(4, 90),
      org,
      JSON.stringify({
        export_code: "OFICIAL-PRUEBA",
        export_origin: "Origen confirmado",
        harvest_reference: {
          date: "2026-10-01",
          status: "Confirmado",
          season: 2026,
          source: "Fuente de prueba",
          notes: [],
        },
      }),
      id(4, 91),
      otherOrg,
    ],
  );
  await db.query(
    "insert into trap_installations(organization_id,producer_id,source_key,source_row,source_document,source_form,source_version,trap_code,host) values($1,$2,'TEST',1,'Prueba.pdf','TEST','01','SPE-PRUEBA-001-SAN','SANDIA')",
    [org, id(4, 90)],
  );
}, 30000);
afterAll(async () => await db.close());

beforeEach(async () => {
  await db.exec(
    "rollback;reset role;delete from shipment_pallets;delete from shipments;delete from pallet_items;delete from pallets;delete from classifications;delete from reception_weights;delete from receptions;delete from field_lots;delete from audit_logs",
  );
  await db.query(
    "update organizations set revision=7,name='Cooperativa Agronorte' where id=$1",
    [org],
  );
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  const details = {
    afidi: "AFIDI-PRUEBA",
    producer_code: "SPE-PRUEBA-001-SAN",
    origin: "Origen confirmado",
    harvest_date: "2026-10-01",
    senave_program: true,
    importer_name: "CLIENTE DE PRUEBA",
    importer_address: "Dirección confirmada",
  };
  const fixtures = [
    [1, "En armado", "Uruguay", org, "2026-10-01T12:00:00Z", null],
    [
      2,
      "Etiquetado",
      " URUGUAY ",
      org,
      "2026-10-01T12:00:00Z",
      { custom: "Preservar", export_label: details },
    ],
    [3, "Listo para carga", "Uruguay", org, "2026-10-07T14:37:55Z", {}],
    [
      4,
      "Etiquetado",
      "Uruguay",
      org,
      "2026-10-01T12:00:00Z",
      { export_label: { ...details, packaged_date: "2026-10-06" } },
    ],
    [
      5,
      "Etiquetado",
      "Uruguay",
      org,
      "2026-10-01T12:00:00Z",
      { export_label: { packaged_date: null } },
    ],
    [6, "Etiquetado", "Uruguay", org, "2026-10-07T14:37:55.001Z", null],
    [7, "Etiquetado", "Argentina", org, "2026-10-01T12:00:00Z", null],
    [
      8,
      "Etiquetado",
      "Pendiente de confirmar",
      org,
      "2026-10-01T12:00:00Z",
      null,
    ],
    [9, "Etiquetado", "Uruguay", otherOrg, "2026-10-01T12:00:00Z", null],
    [10, "Expedido", "Uruguay", org, "2026-10-01T12:00:00Z", null],
    [11, "Cancelado", "Uruguay", org, "2026-10-01T12:00:00Z", null],
    [12, "En armado", "Uruguay", org, "2026-10-01T12:00:00Z", null],
    [13, "En armado", "Uruguay", org, "2026-10-01T12:00:00Z", null],
    [14, "Etiquetado", "Uruguay", org, "2026-10-01T12:00:00Z", {}],
    [
      15,
      "Listo para carga",
      "Uruguay",
      org,
      "2026-10-01T12:00:00Z",
      { export_label: { packaged_date: "2026-10-07" } },
    ],
  ] as const;
  for (const [
    number,
    status,
    destination,
    organization,
    createdAt,
    metadata,
  ] of fixtures) {
    await db.query(
      "insert into field_lots(id,organization_id,producer_id,code,harvest_date) values($1,$2,$3,$4,$5)",
      [
        id(6, number),
        organization,
        organization === org ? id(4, 90) : id(4, 91),
        `LOT-PRUEBA-${number}`,
        number === 4 || number === 10 ? "2026-10-09" : "2026-10-01",
      ],
    );
    await db.query(
      "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,$4,'Responsable')",
      [
        id(7, number),
        organization,
        id(6, number),
        number === 6 ? "2026-10-10" : "2026-10-07",
      ],
    );
    await db.query(
      "insert into reception_weights(id,organization_id,reception_id,sequence,kg,operator) values($1,$2,$3,1,100,'Operador')",
      [id(8, number), organization, id(7, number)],
    );
    await db.query(
      "insert into classifications(id,organization_id,reception_id,approved_kg,rejected_kg,quality) values($1,$2,$3,100,0,5)",
      [id(9, number), organization, id(7, number)],
    );
    await db.query(
      "insert into pallets(id,organization_id,code,destination,assembled_at,responsible,gross_kg,net_kg,tare_kg,status,created_at,created_by,metadata) values($1,$2,$3,$4,'2026-10-07T12:00:00Z','Responsable',142,100,42,$5,$6,$7,$8::jsonb)",
      [
        id(1, number),
        organization,
        `PAL-PRUEBA-${number}`,
        destination,
        status,
        createdAt,
        user,
        metadata === null ? null : JSON.stringify(metadata),
      ],
    );
    await db.query(
      "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,100)",
      [id(2, number), organization, id(1, number), id(7, number)],
    );
  }
  for (const [number, status] of [
    [12, "Expedido"],
    [13, "Cancelado"],
  ] as const) {
    await db.query(
      "insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible,status) values($1,$2,'Uruguay','Uruguay','Conductor','ABC123','2026-10-07','Responsable',$3)",
      [id(3, number), org, status],
    );
    await db.query(
      "insert into shipment_pallets(id,organization_id,shipment_id,pallet_id,status) values($1,$2,$3,$4,$5)",
      [
        id(3, number + 20),
        org,
        id(3, number),
        id(1, number),
        status === "Cancelado" ? "Cancelado" : "Activo",
      ],
    );
  }
  await db.exec("delete from audit_logs");
});

describe.sequential("fecha de envasado actual autorizada para Uruguay", () => {
  it("completa solo fechas pendientes dentro del corte y conserva otros destinos, organizaciones, fechas y expediciones", async () => {
    const before = await rows("pallets");
    const changed = [1, 2, 3, 5, 14].map((n) => id(1, n));
    const preservedTables = [
      "producers",
      "trap_installations",
      "field_lots",
      "receptions",
      "reception_weights",
      "classifications",
      "pallet_items",
      "shipments",
      "shipment_pallets",
    ];
    const otherRows = await Promise.all(preservedTables.map(rows));
    await db.exec(operation);
    const after = await rows("pallets");
    for (const row of after) {
      const old = before.find((p) => p.id === row.id)!;
      if (!changed.includes(row.id)) {
        expect(row).toEqual(old);
        continue;
      }
      expect(row.status).toBe("En armado");
      const oldFields = (old.metadata?.export_label ?? {}) as Record<
        string,
        unknown
      >;
      expect(row.metadata).toEqual({
        ...(old.metadata ?? {}),
        export_label: { ...oldFields, packaged_date: "2026-10-07" },
      });
      const preserved = (value: Row) =>
        Object.fromEntries(
          Object.entries(value).filter(
            ([key]) => !["metadata", "status", "updated_at"].includes(key),
          ),
        );
      expect(preserved(row)).toEqual(preserved(old));
    }
    expect(await Promise.all(preservedTables.map(rows))).toEqual(otherRows);
    expect(await revision()).toBe(8);
    const logs = (
      await db.query<{
        entity_id: string;
        actor: string;
        reason: string;
        created_by: null;
        before: Row;
        after: Row;
      }>(
        'select entity_id,actor,reason,created_by,"before","after" from audit_logs order by entity_id',
      )
    ).rows;
    expect(logs.map((r) => r.entity_id)).toEqual(changed.sort());
    for (const log of logs) {
      expect(log.actor).toBe("Administrador del servidor");
      expect(log.created_by).toBeNull();
      expect(log.reason).toContain("07/10/2026 (America/Asuncion)");
      expect(log.reason).toContain("solo campos pendientes");
      expect(log.before).toEqual(before.find((r) => r.id === log.entity_id));
      expect(log.after).toEqual(after.find((r) => r.id === log.entity_id));
    }
  });

  it("es idempotente y no aplica una fecha predeterminada a pallets creados después de la autorización", async () => {
    await db.exec(operation);
    const first = await rows("pallets");
    await db.exec(operation);
    expect(await rows("pallets")).toEqual(first);
    expect(await revision()).toBe(8);
    expect(await logCount()).toBe(5);
    await db.query(
      "insert into pallets(id,organization_id,code,destination,assembled_at,responsible,gross_kg,net_kg,status,created_at) values($1,$2,'PAL-NUEVO','Uruguay','2026-10-08T12:00:00Z','Responsable',142,100,'En armado','2026-10-08T12:00:00Z')",
      [id(1, 16), org],
    );
    await db.exec(operation);
    expect(
      (await rows("pallets")).find((r) => r.id === id(1, 16))?.metadata,
    ).toBeNull();
    expect(await revision()).toBe(8);
  });

  it("interrumpe todo el lote antes de cambios cuando la cosecha del label/lote o recepción supera la fecha de envasado", async () => {
    for (const damage of [
      `update pallets set metadata='{"export_label":{"harvest_date":"2026-10-08"}}' where id='${id(1, 14)}'`,
      `update field_lots set harvest_date='2026-10-08' where id='${id(6, 14)}'`,
      `update receptions set date='2026-10-08' where id='${id(7, 14)}'`,
    ]) {
      await db.exec("begin");
      await db.exec(damage);
      await db.exec("delete from audit_logs;commit");
      await rejectWithoutChanges(operation, "PAL-PRUEBA-14");
      await db.query("update pallets set metadata=null where id=$1", [
        id(1, 14),
      ]);
      await db.query(
        "update field_lots set harvest_date='2026-10-01' where id=$1",
        [id(6, 14)],
      );
      await db.query("update receptions set date='2026-10-07' where id=$1", [
        id(7, 14),
      ]);
      await db.exec("delete from audit_logs");
    }
  });

  it("bloquea proyecto/base, capacidad y trigger de auditoría incorrectos sin sustituir el control de acceso", async () => {
    for (const [damage, message] of [
      [
        "alter table organizations rename to other_organizations",
        "base Sandía",
      ],
      [
        `update organizations set name='Otra empresa' where id='${org}'`,
        "Agronorte autorizada",
      ],
      [
        "alter function agronorte_private.valid_export_label(jsonb) rename to unavailable_validator",
        "actualización",
      ],
      [
        "create or replace function public.sandia_features() returns jsonb language sql stable security invoker set search_path='' as $$select '{}'::jsonb$$",
        "actualización",
      ],
      ["alter table pallets disable trigger audit_change", "auditoría"],
      [
        "drop trigger audit_change on pallets;create function public.fake_audit() returns trigger language plpgsql as $$begin return new;end$$;create trigger audit_change after insert or update on pallets for each row execute function public.fake_audit()",
        "public.audit_record",
      ],
    ]) {
      const before = await rows("pallets");
      await db.exec("begin");
      await db.exec(damage);
      await expect(db.exec(operation)).rejects.toThrow(message);
      await db.exec("rollback");
      expect(await rows("pallets")).toEqual(before);
      expect(await revision()).toBe(7);
      expect(await logCount()).toBe(0);
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    for (const role of ["anon", "authenticated"]) {
      const before = await rows("pallets");
      await db.exec(`set role ${role}`);
      await expect(db.exec(operation)).rejects.toThrow("permission denied");
      await db.exec("rollback;reset role");
      expect(await rows("pallets")).toEqual(before);
      expect(await revision()).toBe(7);
      expect(await logCount()).toBe(0);
    }
    const privileges = (
      await db.query(
        "select has_table_privilege('authenticated','pallets','UPDATE') direct_update,has_function_privilege('authenticated','agronorte_private.valid_export_label(jsonb)','EXECUTE') private_validator,has_function_privilege('anon','public.update_pallet_label_details(uuid,jsonb,text,text,bigint)','EXECUTE') anon_rpc",
      )
    ).rows[0];
    expect(privileges).toEqual({
      direct_update: false,
      private_validator: false,
      anon_rpc: false,
    });
  });

  it("trata blancos legados como pendientes y revierte metadatos inválidos sin perder AFIDI, importador o código", async () => {
    await db.exec(
      "begin;alter table pallets drop constraint pallets_export_metadata_check",
    );
    await db.query("update pallets set metadata=$1::jsonb where id=$2", [
      JSON.stringify({
        export_label: {
          packaged_date: "   ",
          afidi: "AFIDI-PRUEBA",
          importer_name: "CLIENTE",
          producer_code: "SPE-PRUEBA-001-SAN",
        },
      }),
      id(1, 5),
    ]);
    await db.query("update pallets set metadata=$1::jsonb where id=$2", [
      JSON.stringify({ export_label: "INVÁLIDO" }),
      id(1, 14),
    ]);
    await db.exec("delete from audit_logs;commit");
    await rejectWithoutChanges(operation, "etiqueta inválidos");
    await db.query("update pallets set metadata=$1::jsonb where id=$2", [
      JSON.stringify({ export_label: null }),
      id(1, 14),
    ]);
    await db.exec("delete from audit_logs");
    await db.exec(operation);
    expect(
      (await rows("pallets")).find((r) => r.id === id(1, 5))?.metadata
        ?.export_label,
    ).toEqual({
      packaged_date: "2026-10-07",
      afidi: "AFIDI-PRUEBA",
      importer_name: "CLIENTE",
      producer_code: "SPE-PRUEBA-001-SAN",
    });
    await db.exec(
      "alter table pallets add constraint pallets_export_metadata_check check(metadata is null or (jsonb_typeof(metadata)='object' and length(metadata::text)<=4096 and agronorte_private.valid_export_label(metadata->'export_label') and (metadata#>'{export_label,senave_program}' is distinct from 'true'::jsonb or lower(trim(destination))='uruguay')))",
    );
  });

  it("registra al usuario real de la sesión SQL cuando existe, sin atribuir el cambio a otro responsable", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec(operation);
    const logs = (
      await db.query<{ actor: string; created_by: string }>(
        "select actor,created_by from audit_logs",
      )
    ).rows;
    expect(logs).toHaveLength(5);
    expect(
      logs.every(
        (r) => r.actor === "Administrador de prueba" && r.created_by === user,
      ),
    ).toBe(true);
  });
});
