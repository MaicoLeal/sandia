import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const user = "30000000-0000-4000-8000-000000000001";
const otherUser = "30000000-0000-4000-8000-000000000002";
const id = (group: number, number: number) =>
  `${group}0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const db = new PGlite();
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261007201002_pallet_label_print_audit.sql",
    import.meta.url,
  ),
  "utf8",
);
type RecordRow = Record<string, unknown>;
type PrintResult = {
  pallet_id: string;
  print_id: string;
  status: string;
  revision: number;
  recorded: boolean;
};
async function tableRows(table: string) {
  return (
    await db.query<{ row: RecordRow }>(
      `select to_jsonb(x) row from public.${table} x order by id`,
    )
  ).rows.map((r) => r.row);
}
async function currentRevision() {
  return (
    await db.query<{ revision: number }>(
      "select revision from public.organizations where id=$1",
      [org],
    )
  ).rows[0].revision;
}
async function print(
  pallet: string | null = id(4, 1),
  printId: string | null = id(8, 1),
  actor = user,
) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    actor,
  ]);
  await db.exec("set role authenticated");
  try {
    return (
      await db.query<{ value: PrintResult }>(
        "select public.record_pallet_label_print($1::uuid,$2::uuid) value",
        [pallet, printId],
      )
    ).rows[0].value;
  } finally {
    await db.exec("reset role");
  }
}
async function assertNoChanges(run: () => Promise<unknown>, message: string) {
  const pallets = await tableRows("pallets"),
    logs = await tableRows("audit_logs"),
    revision = await currentRevision();
  await expect(run()).rejects.toThrow(message);
  expect(await tableRows("pallets")).toEqual(pallets);
  expect(await tableRows("audit_logs")).toEqual(logs);
  expect(await currentRevision()).toBe(revision);
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
  await db.query(
    "insert into auth.users values($1,'admin@test.invalid'),($2,'other@test.invalid')",
    [user, otherUser],
  );
  await db.query(
    "insert into profiles(organization_id,user_id,name,role) values($1,$2,'Operador de prueba','administrador'),($1,$3,'Otro operador','gestor')",
    [org, user, otherUser],
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
  await db.exec(migration);
  await db.query(
    "insert into producers(id,organization_id,name) values($1,$2,'Productor de prueba')",
    [id(5, 1), org],
  );
}, 30000);
afterAll(async () => await db.close());
beforeEach(async () => {
  await db.exec(
    "reset role;alter table pallets enable trigger audit_change;alter table audit_logs drop constraint if exists reject_print_test;delete from pallet_items;delete from pallets;delete from classifications;delete from reception_weights;delete from receptions;delete from field_lots;delete from audit_logs",
  );
  await db.query(
    "update profiles set role='administrador',status='Activo' where user_id=$1",
    [user],
  );
  await db.query("update organizations set revision=7 where id=$1", [org]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("select set_config('agronorte.correction_reason','',false)");
  await db.query(
    "insert into field_lots(id,organization_id,producer_id,code,harvest_date) values($1,$2,$3,'LOTE-TEST','2026-10-01')",
    [id(6, 1), org, id(5, 1)],
  );
  await db.query(
    "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,'2026-10-01','Operador de prueba')",
    [id(7, 1), org, id(6, 1)],
  );
  await db.query(
    "insert into reception_weights(id,organization_id,reception_id,sequence,kg,operator) values($1,$2,$3,1,400,'Operador de prueba')",
    [id(9, 1), org, id(7, 1)],
  );
  for (const [number, status, organization] of [
    [1, "En armado", org],
    [2, "Listo para carga", org],
    [3, "Expedido", org],
    [4, "Cancelado", org],
    [5, "En armado", otherOrg],
  ] as const) {
    await db.query(
      `insert into pallets(id,organization_id,code,token,destination,assembled_at,responsible,net_kg,gross_kg,tare_kg,status,metadata,created_by)
      values($1,$2,$3,$4,'Uruguay','2026-10-07T12:00:00Z','Operador de prueba',400,442,42,$5,$6::jsonb,$7)`,
      [
        id(4, number),
        organization,
        `PAL-TEST-${number}`,
        id(1, number),
        status,
        JSON.stringify({
          custom: "Preservar",
          export_label: {
            afidi: "AFIDI-TEST",
            packaged_date: "2026-10-07",
            harvest_date: "2026-10-01",
            producer_code: "SPE-TEST",
            origin: "Origen de prueba",
            senave_program: true,
            importer_name: "Cliente de prueba",
            importer_address: "Dirección de prueba",
          },
        }),
        user,
      ],
    );
  }
  await db.query(
    "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,400)",
    [id(2, 1), org, id(4, 1), id(7, 1)],
  );
  await db.exec("delete from audit_logs");
});

describe("direct pallet label print audit", () => {
  it("audits the authenticated actor, changes only assembly status and is idempotent", async () => {
    const before = await tableRows("pallets"),
      weights = await tableRows("reception_weights"),
      items = await tableRows("pallet_items"),
      receptions = await tableRows("receptions");
    expect(await print()).toEqual({
      pallet_id: id(4, 1),
      print_id: id(8, 1),
      status: "Etiquetado",
      revision: 8,
      recorded: true,
    });
    const after = await tableRows("pallets");
    const a = { ...before[0] },
      b = { ...after[0] };
    delete a.status;
    delete a.updated_at;
    delete b.status;
    delete b.updated_at;
    expect(b).toEqual(a);
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(await tableRows("reception_weights")).toEqual(weights);
    expect(await tableRows("pallet_items")).toEqual(items);
    expect(await tableRows("receptions")).toEqual(receptions);
    const logs = await tableRows("audit_logs");
    expect(logs).toHaveLength(2);
    const intent = logs.find((r) => r.id === id(8, 1))!;
    expect(intent).toMatchObject({
      organization_id: org,
      created_by: user,
      actor: "Operador de prueba",
      action: "Solicitud de impresión de etiqueta",
      before: null,
      after: { solicitada: true },
    });
    const update = logs.find((r) => r.action === "Actualización · pallets")!;
    expect(update.before).toMatchObject({ status: "En armado" });
    expect(update.after).toMatchObject({ status: "Etiquetado" });
    expect(update.reason).toBe(
      "Solicitud de impresión de etiqueta desde la cuenta autenticada",
    );
    expect(await print()).toEqual({
      pallet_id: id(4, 1),
      print_id: id(8, 1),
      status: "Etiquetado",
      revision: 8,
      recorded: false,
    });
    expect(await tableRows("audit_logs")).toEqual(logs);
    expect(await tableRows("pallets")).toEqual(after);
  });
  it("preserves loaded/shipped status and permits a distinct legitimate reprint", async () => {
    const before = await tableRows("pallets");
    expect(await print(id(4, 2))).toMatchObject({
      status: "Listo para carga",
      recorded: true,
      revision: 8,
    });
    expect(await print(id(4, 3), id(8, 2))).toMatchObject({
      status: "Expedido",
      recorded: true,
      revision: 9,
    });
    expect(await print(id(4, 2), id(8, 3))).toMatchObject({
      status: "Listo para carga",
      recorded: true,
      revision: 10,
    });
    expect(await tableRows("pallets")).toEqual(before);
    expect(await tableRows("audit_logs")).toHaveLength(3);
  });
  it("enforces active writer roles and tenant without granting direct table writes", async () => {
    for (const role of ["recepcion", "pesaje", "auditor", "destinatario"]) {
      await db.query("update profiles set role=$1 where user_id=$2", [
        role,
        user,
      ]);
      await assertNoChanges(
        () => print(),
        "Su perfil no puede imprimir etiquetas",
      );
    }
    await db.query(
      "update profiles set role='administrador',status='Inactivo' where user_id=$1",
      [user],
    );
    await assertNoChanges(
      () => print(),
      "Su perfil no puede imprimir etiquetas",
    );
    await db.query("update profiles set status='Activo' where user_id=$1", [
      user,
    ]);
    await assertNoChanges(
      () => print(id(4, 5)),
      "Pallet no disponible en su organización",
    );
    await assertNoChanges(() => print(id(4, 1), id(8, 1), ""), "Inicie sesión");
    const rights = (
      await db.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        pallet_write: boolean;
        audit_write: boolean;
        public_invoker: boolean;
        private_definer: boolean;
      }>(`select
      has_function_privilege('anon','public.record_pallet_label_print(uuid,uuid)','EXECUTE') anon_execute,
      has_function_privilege('authenticated','public.record_pallet_label_print(uuid,uuid)','EXECUTE') authenticated_execute,
      has_table_privilege('authenticated','public.pallets','UPDATE') pallet_write,
      has_table_privilege('authenticated','public.audit_logs','INSERT') audit_write,
      not (select prosecdef from pg_proc where oid='public.record_pallet_label_print(uuid,uuid)'::regprocedure) public_invoker,
      (select prosecdef from pg_proc where oid='agronorte_private.record_pallet_label_print(uuid,uuid)'::regprocedure) private_definer`)
    ).rows[0];
    expect(rights).toEqual({
      anon_execute: false,
      authenticated_execute: true,
      pallet_write: false,
      audit_write: false,
      public_invoker: true,
      private_definer: true,
    });
    for (const role of ["gestor", "packing"]) {
      await db.query("update profiles set role=$1 where user_id=$2", [
        role,
        user,
      ]);
      expect(
        await print(id(4, 2), id(8, role === "gestor" ? 2 : 3)),
      ).toMatchObject({ recorded: true });
    }
  });
  it("rejects canceled pallets and print identifiers belonging to another operation/pallet/user", async () => {
    await assertNoChanges(() => print(id(4, 4)), "pallet cancelado");
    await print();
    await assertNoChanges(
      () => print(id(4, 2)),
      "ya utilizado por otra operación",
    );
    await assertNoChanges(
      () => print(id(4, 1), id(8, 1), otherUser),
      "ya utilizado por otra operación",
    );
    await db.query(
      "insert into audit_logs(id,organization_id,entity_type,entity_id,action,actor,created_by) values($1,$2,'pallets',$3,'Otra acción','Operador de prueba',$4)",
      [id(8, 2), org, id(4, 1), user],
    );
    await assertNoChanges(
      () => print(id(4, 1), id(8, 2)),
      "ya utilizado por otra operación",
    );
    await assertNoChanges(() => print(null), "obligatorios");
  });
  it("fails atomically when the audit trigger is disabled or inserting the print intent fails", async () => {
    await db.exec("alter table pallets disable trigger audit_change");
    await assertNoChanges(() => print(), "Auditoría de pallets no disponible");
    await db.exec(
      "drop trigger audit_change on pallets;create trigger audit_change after update on pallets for each row when (false) execute function public.audit_record()",
    );
    try {
      await assertNoChanges(
        () => print(),
        "Auditoría de pallets no disponible",
      );
    } finally {
      await db.exec(
        "drop trigger audit_change on pallets;create trigger audit_change after insert or update on pallets for each row execute function public.audit_record()",
      );
    }
    await db.exec(
      "alter table pallets enable trigger audit_change;alter table audit_logs add constraint reject_print_test check(action<>'Solicitud de impresión de etiqueta')",
    );
    await assertNoChanges(() => print(), "reject_print_test");
  });
  it("preserves capabilities on migration rerun and makes stale workspace revisions conflict", async () => {
    const beforeFlags = (
      await db.query<{ flags: RecordRow }>(
        "select public.sandia_features() flags",
      )
    ).rows[0].flags;
    await db.exec(migration);
    expect(
      (
        await db.query<{ flags: RecordRow }>(
          "select public.sandia_features() flags",
        )
      ).rows[0].flags,
    ).toEqual(beforeFlags);
    expect(beforeFlags).toMatchObject({
      pallet_tare: true,
      trap_installations: true,
      label_importer_details: true,
      label_print_audit: true,
    });
    await print();
    await db.exec("set role authenticated");
    try {
      await expect(
        db.query("select public.sync_workspace('{}'::jsonb,7)"),
      ).rejects.toThrow("Conflicto de sincronización");
    } finally {
      await db.exec("reset role");
    }
    expect(await currentRevision()).toBe(8);
    expect(await tableRows("audit_logs")).toHaveLength(2);
  });
});
