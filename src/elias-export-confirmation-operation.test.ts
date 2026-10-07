import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const org = "20000000-0000-4000-8000-000000000001";
const user = "30000000-0000-4000-8000-000000000001";
const id = (group: number, number: number) =>
  `${group}0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const producer = id(4, 1);
const lot = id(6, 1);
const reception = id(7, 1);
const weights = [390, 410, 381, 395, 394, 389, 393, 397, 148];
const db = new PGlite();
const operation = readFileSync(
  new URL(
    "../supabase/operations/20261007_confirm_elias_export_labels.sql",
    import.meta.url,
  ),
  "utf8",
);
type Row = {
  id: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};
async function rows(table: string): Promise<Row[]> {
  return (
    await db.query<{ row: Row }>(
      `select to_jsonb(x) row from public.${table} x order by id`,
    )
  ).rows.map((r) => r.row);
}
const tables = [
  "producers",
  "field_lots",
  "receptions",
  "reception_weights",
  "classifications",
  "pallets",
  "pallet_items",
  "shipments",
  "shipment_pallets",
  "audit_logs",
];
async function snapshot() {
  return Promise.all(tables.map(rows));
}
async function revision() {
  return (
    await db.query<{ revision: number }>(
      "select revision from organizations where id=$1",
      [org],
    )
  ).rows[0].revision;
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
    "insert into organizations(id,name,revision) values($1,'Cooperativa Agronorte',83)",
    [org],
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
    "insert into producers(id,organization_id,name,metadata) values($1,$2,'Elias Galeano',$3::jsonb),($4,$2,'Otro productor','{}'::jsonb)",
    [
      producer,
      org,
      JSON.stringify({
        export_origin: "Depto. de San Pedro – Paraguay",
        custom: "Conservar",
        harvest_reference: {
          date: "2026-10-02",
          season: 2026,
          status: "Pendiente de confirmar",
          source: "Imagen verificada",
          notes: ["Recepción anterior a la fecha de la fuente"],
        },
      }),
      id(4, 2),
    ],
  );
  await db.query(
    "insert into trap_installations(organization_id,producer_id,source_key,source_row,source_document,source_form,source_version,trap_code,host) values($1,$2,'TEST',1,'Prueba.pdf','TEST','01','SPE-GUA-002-SAN','SANDIA')",
    [org, producer],
  );
}, 30000);
afterAll(async () => await db.close());

beforeEach(async () => {
  await db.exec(
    "rollback;reset role;delete from shipment_pallets;delete from shipments;delete from pallet_items;delete from pallets;delete from classifications;delete from reception_weights;delete from receptions;delete from field_lots;delete from audit_logs",
  );
  await db.query("update organizations set revision=83 where id=$1", [org]);
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await db.query(
    "update producers set metadata=jsonb_set(metadata,'{harvest_reference}',$1::jsonb) where id=$2",
    [
      JSON.stringify({
        date: "2026-10-02",
        season: 2026,
        status: "Pendiente de confirmar",
        source: "Imagen verificada",
        notes: ["Recepción anterior a la fecha de la fuente"],
      }),
      producer,
    ],
  );
  for (const [number, owner, code] of [
    [1, producer, "01102026"],
    [2, id(4, 2), "OTRO-LOTE"],
  ] as const) {
    await db.query(
      "insert into field_lots(id,organization_id,producer_id,code,created_at) values($1,$2,$3,$4,'2026-10-01T12:00:00Z')",
      [id(6, number), org, owner, code],
    );
    await db.query(
      "insert into receptions(id,organization_id,lot_id,date,responsible,created_at) values($1,$2,$3,'2026-10-01','Responsable','2026-10-01T12:00:00Z')",
      [id(7, number), org, id(6, number)],
    );
  }
  for (let number = 1; number <= 13; number++) {
    const target = number <= 9;
    const net = target ? weights[number - 1] : 100;
    await db.query(
      "insert into pallets(id,organization_id,code,destination,assembled_at,weighed_date,responsible,gross_kg,net_kg,tare_kg,status,created_at,metadata) values($1,$2,$3,'Pendiente de confirmar','2026-10-02T12:00:00Z','2026-10-01','Responsable',$4,$5,42,$6,$7,$8::jsonb)",
      [
        id(1, number),
        org,
        `PAL-PRUEBA-${number}`,
        net + 42,
        net,
        number === 10 ? "Expedido" : number === 11 ? "Cancelado" : "Etiquetado",
        number === 12 ? "2026-10-07T18:13:45.001Z" : "2026-10-02T12:00:00Z",
        JSON.stringify({
          custom: "Preservar",
          export_label:
            target && number === 9
              ? {
                  harvest_date: "2026-10-02",
                  origin: "Depto. de San Pedro – Paraguay",
                }
              : {},
        }),
      ],
    );
    await db.query(
      "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,$5)",
      [id(2, number), org, id(1, number), target ? reception : id(7, 2), net],
    );
    if (target)
      await db.query(
        "insert into reception_weights(id,organization_id,reception_id,sequence,kg,operator) values($1,$2,$3,$4,$5,'Operador')",
        [id(8, number), org, reception, number, net],
      );
  }
  await db.query(
    "insert into classifications(id,organization_id,reception_id,approved_kg,rejected_kg,quality) values($1,$2,$3,3297,0,5)",
    [id(9, 1), org, reception],
  );
  await db.exec("delete from audit_logs");
});

describe.sequential(
  "confirmación expresa del lote de Elias y ambas fechas incompatibles",
  () => {
    it("completa los nueve pallets sin cambiar pesos, QR, recepción ni registros ajenos; audita el usuario real", async () => {
      const beforePallets = await rows("pallets");
      const protectedTables = [
        "receptions",
        "reception_weights",
        "classifications",
        "pallet_items",
        "shipments",
        "shipment_pallets",
      ];
      const beforeSources = await Promise.all(protectedTables.map(rows));
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      await db.exec(operation);
      const after = await rows("pallets");
      const protectedFields = (row: Row) =>
        Object.fromEntries(
          Object.entries(row).filter(
            ([key]) =>
              !["metadata", "status", "destination", "updated_at"].includes(
                key,
              ),
          ),
        );
      for (let number = 1; number <= 9; number++) {
        const row = after.find((r) => r.id === id(1, number))!;
        expect(protectedFields(row)).toEqual(
          protectedFields(beforePallets.find((r) => r.id === row.id)!),
        );
        expect(row.destination).toBe("Uruguay");
        expect(row.status).toBe("En armado");
        expect(row.metadata?.custom).toBe("Preservar");
        expect(row.metadata?.export_label).toMatchObject({
          afidi: "1571652",
          senave_program: true,
          harvest_date: "2026-10-02",
          packaged_date: "2026-10-07",
          producer_code: "SPE-GUA-002-SAN",
          origin: "Depto. de San Pedro – Paraguay",
          importer_name: "RINALIR SOCIEDAD ANÓNIMA",
          importer_address: "BATLLE Y ORDÓÑEZ 534, TACUAREMBÓ, URUGUAY",
        });
      }
      expect(
        after.filter(
          (r) => !beforePallets.slice(0, 9).some((p) => p.id === r.id),
        ),
      ).toEqual(beforePallets.slice(9));
      expect(await Promise.all(protectedTables.map(rows))).toEqual(
        beforeSources,
      );
      const producerAfter = (await rows("producers")).find(
        (r) => r.id === producer,
      )!;
      expect(producerAfter.metadata?.harvest_reference).toMatchObject({
        date: "2026-10-02",
        status: "Confirmado",
        season: 2026,
        source: "Imagen verificada",
      });
      expect(
        JSON.stringify(producerAfter.metadata?.harvest_reference),
      ).toContain("la cosecha es posterior a la recepción");
      expect(producerAfter.metadata?.custom).toBe("Conservar");
      expect(
        (await rows("field_lots")).find((r) => r.id === lot)?.harvest_date,
      ).toBe("2026-10-02");
      const logs = await rows("audit_logs");
      expect(logs).toHaveLength(11);
      expect(
        logs.every(
          (r) =>
            r.actor === "Administrador de prueba" &&
            r.created_by === user &&
            String(r.reason).includes("Y recepción 01/10/2026 reconfirmadas"),
        ),
      ).toBe(true);
      expect(await revision()).toBe(84);
    });

    it("es idempotente: conserva la nota, el historial y la revisión al repetir", async () => {
      await db.exec(operation);
      const first = await snapshot();
      await db.exec(operation);
      expect(await snapshot()).toEqual(first);
      expect(await revision()).toBe(84);
    });

    it("rechaza peso, cantidad, mezcla de procedencias o falta de código antes de cualquier actualización", async () => {
      for (const damage of [
        `update pallets set net_kg=net_kg+1,gross_kg=gross_kg+1 where id='${id(1, 9)}'`,
        `update pallets set status='Cancelado' where id='${id(1, 9)}'`,
        `insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values('${id(2, 99)}','${org}','${id(1, 1)}','${id(7, 2)}',1)`,
        "update trap_installations set status='Cancelado'",
        `update producers set name='ELIAS GALEANO' where id='${id(4, 2)}'`,
      ]) {
        const before = await snapshot();
        await db.exec("begin");
        await db.exec(damage);
        await expect(db.exec(operation)).rejects.toThrow();
        await db.exec("rollback");
        expect(await snapshot()).toEqual(before);
        expect(await revision()).toBe(83);
      }
    });

    it("preserva fechas y datos explícitos distintos y rechaza auditoría falsa/desactivada atómicamente", async () => {
      for (const damage of [
        `update field_lots set harvest_date='2026-10-01' where id='${lot}'`,
        `update producers set metadata=jsonb_set(metadata,'{harvest_reference,date}','"2026-10-03"'::jsonb) where id='${producer}'`,
        `update receptions set date='2026-10-02' where id='${reception}'`,
        `update pallets set metadata='{"export_label":{"harvest_date":"2026-10-04"}}' where id='${id(1, 9)}'`,
        `update pallets set metadata='{"export_label":{"packaged_date":"2026-10-06"}}' where id='${id(1, 9)}'`,
        `update pallets set metadata='{"export_label":{"importer_name":"OTRO CLIENTE"}}' where id='${id(1, 9)}'`,
        "alter table producers disable trigger audit_change",
        "drop trigger audit_change on pallets;create function public.fake_audit() returns trigger language plpgsql as $$begin return new;end$$;create trigger audit_change after insert or update on pallets for each row execute function public.fake_audit()",
      ]) {
        const before = await snapshot();
        await db.exec("begin");
        await db.exec(damage);
        await expect(db.exec(operation)).rejects.toThrow();
        await db.exec("rollback");
        expect(await snapshot()).toEqual(before);
        expect(await revision()).toBe(83);
      }
    });

    it("expone ambas fechas y el conflicto explícito; la revisión opcional no sobrescribe otra sesión", async () => {
      const guarded = operation.replace(
        '{"expected_revision":null}',
        '{"expected_revision":83}',
      );
      expect(guarded).not.toBe(operation);
      const result = await db.exec(guarded);
      const report = result.find((r) =>
        r.fields.some((f) => f.name === "conflicto_cronologico"),
      )!;
      expect(report.rows).toHaveLength(9);
      for (const row of report.rows)
        expect(row).toMatchObject({
          recepcion: new Date("2026-10-01T00:00:00Z"),
          cosecha_del_lote: new Date("2026-10-02T00:00:00Z"),
          cosecha_de_etiqueta: "2026-10-02",
          conflicto_cronologico: true,
        });
      const before = await snapshot();
      await expect(db.exec(guarded)).rejects.toThrow("Conflicto de revisión");
      await db.exec("rollback");
      expect(await snapshot()).toEqual(before);
      expect(await revision()).toBe(84);
    });
  },
);
