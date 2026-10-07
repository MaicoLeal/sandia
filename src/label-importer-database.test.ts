import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const user = "30000000-0000-4000-8000-000000000001";
const id = (number: number) =>
  `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const db = new PGlite();
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261007135124_label_importer_details.sql",
    import.meta.url,
  ),
  "utf8",
);
const template = readFileSync(
  new URL(
    "../supabase/operations/set_current_uruguay_importer.sql",
    import.meta.url,
  ),
  "utf8",
);
const details = {
  name: "IMPORTADOR DE PRUEBA",
  address: "CALLE DE PRUEBA 100, CIUDAD DE PRUEBA, URUGUAY",
  source: "Imagen de prueba",
};
const operation = (payload: unknown = details) =>
  template.replace(
    "$importer_details${}$importer_details$",
    `$importer_details$${JSON.stringify(payload)}$importer_details$`,
  );
type Pallet = {
  id: string;
  code: string;
  token: string;
  status: string;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
  [key: string]: unknown;
};
async function pallets() {
  return (
    await db.query<{ row: Pallet }>(
      "select to_jsonb(p) row from pallets p order by id",
    )
  ).rows.map((row) => row.row);
}
async function revision() {
  return (
    await db.query<{ revision: number }>(
      "select revision from organizations where id=$1",
      [org],
    )
  ).rows[0].revision;
}
async function valid(fields: unknown) {
  return (
    await db.query<{ valid: boolean }>(
      "select agronorte_private.valid_export_label($1::jsonb) valid",
      [JSON.stringify(fields)],
    )
  ).rows[0].valid;
}

beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
    grant usage on schema storage to authenticated;grant select on storage.objects to authenticated;`);
  for (const filename of [
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
  ]) {
    await db.exec(
      readFileSync(
        new URL(`../supabase/migrations/${filename}`, import.meta.url),
        "utf8",
      ),
    );
  }
  await db.query(
    "insert into organizations(id,name,revision) values($1,'Cooperativa Agronorte',7),($2,'Otra organización',3)",
    [org, otherOrg],
  );
  await db.query("insert into auth.users values($1,'admin@test.invalid')", [
    user,
  ]);
  await db.query(
    "insert into profiles(organization_id,user_id,name,role) values($1,$2,'Admin de prueba','administrador')",
    [org, user],
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261007121008_producer_internal_codes.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261007125340_trap_installations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(migration);
  await db.query(
    "insert into producers(id,organization_id,name,metadata) values($1,$2,'Productor de prueba',$3::jsonb)",
    [
      id(90),
      org,
      JSON.stringify({
        export_code: "OFICIAL-DE-PRUEBA",
        harvest_reference: {
          date: "2026-10-01",
          status: "Confirmado",
          season: 2026,
          source: "Fuente de prueba",
          notes: [],
        },
      }),
    ],
  );
  await db.query(
    "insert into trap_installations(organization_id,producer_id,source_key,source_row,source_document,source_form,source_version,trap_code,host) values($1,$2,'TEST',1,'Prueba.pdf','TEST','01','SPE-PRUEBA-001-SAN','SANDIA')",
    [org, id(90)],
  );
}, 30000);
afterAll(async () => await db.close());

beforeEach(async () => {
  await db.exec(
    "rollback;reset role;delete from shipment_pallets;delete from shipments;delete from pallets;delete from audit_logs",
  );
  await db.query(
    "update organizations set revision=7,name='Cooperativa Agronorte' where id=$1",
    [org],
  );
  await db.query("update profiles set role='administrador' where user_id=$1", [
    user,
  ]);
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  const common = {
    afidi: "AFIDI-DE-PRUEBA",
    producer_code: "SPE-PRUEBA-001-SAN",
    origin: "Origen confirmado",
    harvest_date: "2026-10-01",
    packaged_date: "2026-10-02",
    senave_program: true,
  };
  for (const [number, status, destination, organization, createdAt, fields] of [
    [1, "En armado", "Uruguay", org, "2026-10-01T12:00:00Z", null],
    [2, "Etiquetado", " URUGUAY ", org, "2026-10-01T12:00:00Z", common],
    [3, "Listo para carga", "Uruguay", org, "2026-10-07T13:51:04Z", {}],
    [
      4,
      "En armado",
      "Uruguay",
      org,
      "2026-10-01T12:00:00Z",
      { importer_name: "", importer_address: "" },
    ],
    [
      5,
      "Etiquetado",
      "Uruguay",
      org,
      "2026-10-01T12:00:00Z",
      { importer_name: "OTRO IMPORTADOR", importer_address: "" },
    ],
    [
      6,
      "Etiquetado",
      "Uruguay",
      org,
      "2026-10-01T12:00:00Z",
      { importer_name: details.name },
    ],
    [
      7,
      "Listo para carga",
      "Uruguay",
      org,
      "2026-10-01T12:00:00Z",
      { importer_address: details.address },
    ],
    [
      8,
      "Etiquetado",
      "Uruguay",
      org,
      "2026-10-01T12:00:00Z",
      {
        importer_name: details.name,
        importer_address: "Dirección personalizada",
      },
    ],
    [
      9,
      "Etiquetado",
      "Uruguay",
      org,
      "2026-10-01T12:00:00Z",
      { importer_name: "", importer_address: "Dirección personalizada" },
    ],
    [
      10,
      "Listo para carga",
      "Uruguay",
      org,
      "2026-10-01T12:00:00Z",
      { importer_name: details.name, importer_address: details.address },
    ],
    [11, "Etiquetado", "Uruguay", org, "2026-10-07T13:51:04.001Z", {}],
    [12, "Etiquetado", "Argentina", org, "2026-10-01T12:00:00Z", {}],
    [
      13,
      "Etiquetado",
      "Pendiente de confirmar",
      org,
      "2026-10-01T12:00:00Z",
      {},
    ],
    [14, "Etiquetado", "Uruguay", otherOrg, "2026-10-01T12:00:00Z", {}],
    [15, "Expedido", "Uruguay", org, "2026-10-01T12:00:00Z", {}],
    [16, "Cancelado", "Uruguay", org, "2026-10-01T12:00:00Z", {}],
    [17, "En armado", "Uruguay", org, "2026-10-01T12:00:00Z", {}],
  ] as const) {
    await db.query(
      "insert into pallets(id,organization_id,code,destination,assembled_at,responsible,gross_kg,net_kg,tare_kg,status,created_at,created_by,metadata) values($1,$2,$3,$4,'2026-10-01T12:00:00Z','Responsable',142,100,42,$5,$6,$7,$8::jsonb)",
      [
        id(number),
        organization,
        `PAL-PRUEBA-${number}`,
        destination,
        status,
        createdAt,
        user,
        fields === null
          ? null
          : JSON.stringify({ source_note: "Preservar", export_label: fields }),
      ],
    );
  }
  await db.query(
    "insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible,status) values($1,$2,'Uruguay','Uruguay','Conductor','ABC123','2026-10-01','Responsable','Cancelado')",
    [id(50), org],
  );
  await db.query(
    "insert into shipment_pallets(id,organization_id,shipment_id,pallet_id,status) values($1,$2,$3,$4,'Cancelado')",
    [id(51), org, id(50), id(17)],
  );
  await db.exec("delete from audit_logs");
});

describe.sequential("importador opcional de etiquetas Uruguay", () => {
  it("valida campos opcionales con límites 200/400 y conserva fechas/AFIDI/SENAVE y límites anteriores", async () => {
    expect(
      await valid({
        importer_name: "a".repeat(200),
        importer_address: "b".repeat(400),
      }),
    ).toBe(true);
    for (const value of [
      { importer_name: "a".repeat(201) },
      { importer_address: "b".repeat(401) },
      { importer_name: null },
      { importer_address: 12 },
      { unknown_field: "x" },
      { afidi: "a".repeat(101) },
      { origin: "a".repeat(201) },
      { harvest_date: "2026-02-30" },
      { senave_program: "true" },
    ])
      expect(await valid(value)).toBe(false);
    expect(await valid({})).toBe(true);
    expect(
      await valid({
        importer_name: "",
        importer_address: "",
        harvest_date: null,
      }),
    ).toBe(true);
    await db.exec("set role authenticated");
    const flags = (
      await db.query<{ flags: Record<string, boolean> }>(
        "select sandia_features() flags",
      )
    ).rows[0].flags;
    await db.exec("reset role");
    expect(Object.keys(flags)).toHaveLength(9);
    expect(Object.values(flags).every(Boolean)).toBe(true);
    expect(flags.label_importer_details).toBe(true);
    expect(flags.trap_installations).toBe(true);
  });

  it("aplica solo pallets actuales sin importador propio y no mezcla pares personalizados o parciales", async () => {
    const before = await pallets();
    const producerBefore = (
      await db.query("select to_jsonb(p) row from producers p")
    ).rows;
    await db.exec(operation());
    const after = await pallets();
    const changed = [1, 2, 3, 4, 6, 7];
    for (const pallet of after) {
      const old = before.find((p) => p.id === pallet.id)!;
      if (!changed.some((number) => id(number) === pallet.id)) {
        expect(pallet).toEqual(old);
        continue;
      }
      expect(pallet.status).toBe("En armado");
      expect(pallet.metadata?.export_label).toMatchObject({
        importer_name: details.name,
        importer_address: details.address,
      });
      expect(pallet).toMatchObject({
        code: old.code,
        token: old.token,
        net_kg: old.net_kg,
        gross_kg: old.gross_kg,
        tare_kg: old.tare_kg,
        created_at: old.created_at,
        created_by: old.created_by,
        destination: old.destination,
      });
    }
    const fields = after.find((p) => p.id === id(2))?.metadata?.export_label;
    expect(fields).toMatchObject(
      before.find((p) => p.id === id(2))!.metadata!.export_label as Record<
        string,
        unknown
      >,
    );
    expect(
      (await db.query("select to_jsonb(p) row from producers p")).rows,
    ).toEqual(producerBefore);
    expect(await revision()).toBe(8);
    const logs = (
      await db.query<{
        actor: string;
        created_by: null;
        reason: string;
        before: unknown;
        after: unknown;
      }>('select actor,created_by,reason,"before","after" from audit_logs')
    ).rows;
    expect(logs).toHaveLength(6);
    expect(
      logs.every(
        (log) =>
          log.actor === "Administrador del servidor" &&
          log.created_by === null &&
          log.reason.includes(details.source) &&
          log.before !== null &&
          log.after !== null,
      ),
    ).toBe(true);
  });

  it("mantiene importador omitido en las dos RPCs antiguas y permite corrección o eliminación explícita con justificación", async () => {
    await db.exec(operation());
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec("set role authenticated");
    await db.query(
      "select update_pallet_export_label($1,$2::jsonb,'Dato verificado',8)",
      [id(2), JSON.stringify({ afidi: "AFIDI-CORREGIDO" })],
    );
    await db.exec("reset role");
    let stored = (await pallets()).find((p) => p.id === id(2))!;
    expect(stored.metadata?.export_label).toEqual({
      afidi: "AFIDI-CORREGIDO",
      importer_name: details.name,
      importer_address: details.address,
    });
    await db.exec("set role authenticated");
    await db.query(
      "select update_pallet_label_details($1,$2::jsonb,null,'Datos confirmados',9)",
      [
        id(2),
        JSON.stringify({ afidi: "AFIDI-CORREGIDO", origin: "Origen revisado" }),
      ],
    );
    await db.exec("reset role");
    stored = (await pallets()).find((p) => p.id === id(2))!;
    expect(stored.metadata?.export_label).toMatchObject({
      importer_name: details.name,
      importer_address: details.address,
      origin: "Origen revisado",
    });
    await db.exec("set role authenticated");
    await db.query(
      "select update_pallet_label_details($1,$2::jsonb,null,'Cliente corregido',10)",
      [
        id(2),
        JSON.stringify({
          importer_name: "CLIENTE CORREGIDO",
          importer_address: "OTRA DIRECCIÓN",
        }),
      ],
    );
    await db.query(
      "select update_pallet_export_label($1,$2::jsonb,'Retirar datos anteriores',11)",
      [id(2), JSON.stringify({ importer_name: "", importer_address: "" })],
    );
    await db.exec("reset role");
    stored = (await pallets()).find((p) => p.id === id(2))!;
    expect(stored.metadata?.export_label).toEqual({
      importer_name: "",
      importer_address: "",
    });
    expect(await revision()).toBe(12);
  });

  it("mantiene permisos y revisión de las RPCs y no permite a auditor/anon alterar importador", async () => {
    const permissions = (
      await db.query(`select has_function_privilege('authenticated','agronorte_private.valid_export_label(jsonb)','EXECUTE') validator,
      has_function_privilege('authenticated','agronorte_private.preserve_label_importer(jsonb,jsonb)','EXECUTE') helper,
      has_function_privilege('authenticated','public.update_pallet_label_details(uuid,jsonb,text,text,bigint)','EXECUTE') rpc,
      has_function_privilege('anon','public.update_pallet_label_details(uuid,jsonb,text,text,bigint)','EXECUTE') anon,
      has_table_privilege('authenticated','pallets','UPDATE') direct,
      (select prosecdef from pg_proc where oid='agronorte_private.valid_export_label(jsonb)'::regprocedure) validator_definer,
      (select prosecdef from pg_proc where oid='agronorte_private.preserve_label_importer(jsonb,jsonb)'::regprocedure) helper_definer`)
    ).rows[0];
    expect(permissions).toEqual({
      validator: false,
      helper: false,
      rpc: true,
      anon: false,
      direct: false,
      validator_definer: false,
      helper_definer: false,
    });
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec("set role authenticated");
    await expect(
      db.query("select update_pallet_export_label($1,$2::jsonb,'Cambio',6)", [
        id(2),
        JSON.stringify({ importer_name: "Nombre" }),
      ]),
    ).rejects.toThrow("Conflicto");
    await expect(
      db.query("select update_pallet_export_label($1,$2::jsonb,'',7)", [
        id(2),
        JSON.stringify({ importer_name: "Nombre" }),
      ]),
    ).rejects.toThrow("justificación");
    await expect(
      db.query("select update_pallet_export_label($1,$2::jsonb,'Cambio',7)", [
        id(17),
        JSON.stringify({ importer_name: "Nombre" }),
      ]),
    ).rejects.toThrow("vinculado");
    await db.exec("reset role");
    await db.query("update profiles set role='auditor' where user_id=$1", [
      user,
    ]);
    await db.exec("set role authenticated");
    await expect(
      db.query("select update_pallet_export_label($1,$2::jsonb,'Cambio',7)", [
        id(2),
        JSON.stringify({ importer_name: "Nombre" }),
      ]),
    ).rejects.toThrow("perfil");
    await db.exec("reset role");
    expect(await revision()).toBe(7);
  });

  it("es idempotente y no crea importador predeterminado en pallets nuevos", async () => {
    await db.exec(operation());
    const first = await pallets();
    await db.exec(migration);
    await db.exec(operation());
    expect(await pallets()).toEqual(first);
    expect(await revision()).toBe(8);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from audit_logs",
        )
      ).rows[0].count,
    ).toBe(6);
    await db.query(
      "insert into pallets(id,organization_id,code,destination,assembled_at,responsible,gross_kg,net_kg,status,created_at) values($1,$2,'PAL-FUTURO','Uruguay','2026-10-08T12:00:00Z','Responsable',142,100,'En armado','2026-10-08T12:00:00Z')",
      [id(18), org],
    );
    await db.exec(operation());
    expect((await pallets()).find((p) => p.id === id(18))?.metadata).toBeNull();
    expect(await revision()).toBe(8);
  });

  it("bloquea fuente inválida, organización/auditoría incorrectas y revierte todas las modificaciones ante metadatos inválidos", async () => {
    const before = await pallets();
    await expect(
      db.exec(operation({ ...details, address: "x".repeat(401) })),
    ).rejects.toThrow("límites");
    await db.exec("rollback");
    expect(await pallets()).toEqual(before);
    for (const [damage, message] of [
      [
        "update organizations set name='Otra empresa' where id='" + org + "'",
        "Agronorte autorizada",
      ],
      ["alter table pallets disable trigger audit_change", "auditoría"],
    ]) {
      await db.exec("begin");
      await db.exec(damage);
      await expect(db.exec(operation())).rejects.toThrow(message);
      await db.exec("rollback");
      expect(await pallets()).toEqual(before);
      expect(await revision()).toBe(7);
    }
    await db.exec(
      "begin;alter table pallets drop constraint pallets_export_metadata_check",
    );
    await db.query("update pallets set metadata=$1::jsonb where id=$2", [
      JSON.stringify({ export_label: "INVÁLIDO" }),
      id(3),
    ]);
    await db.exec("delete from audit_logs;commit");
    const damaged = await pallets();
    await expect(db.exec(operation())).rejects.toThrow("etiqueta inválidos");
    await db.exec("rollback");
    expect(await pallets()).toEqual(damaged);
    expect(await revision()).toBe(7);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from audit_logs",
        )
      ).rows[0].count,
    ).toBe(0);
    await db.query("update pallets set metadata=null where id=$1", [id(3)]);
    await db.exec(
      `alter table pallets add constraint pallets_export_metadata_check check(metadata is null or (jsonb_typeof(metadata)='object' and length(metadata::text)<=4096 and agronorte_private.valid_export_label(metadata->'export_label') and (metadata#>'{export_label,senave_program}' is distinct from 'true'::jsonb or lower(trim(destination))='uruguay')))`,
    );
  });
});
