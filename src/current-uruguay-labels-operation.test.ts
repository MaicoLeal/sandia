import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const user = "30000000-0000-4000-8000-000000000001";
const cutoff = "2026-10-07T15:32:35Z";
const id = (group: number, number: number) =>
  `${group}0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const db = new PGlite();
let operation: string;
type Row = {
  id: string;
  metadata: Record<string, unknown> | null;
  [key: string]: unknown;
};
type Label = Record<string, unknown>;
async function rows(table: string): Promise<Row[]> {
  return (
    await db.query<{ row: Row }>(
      `select to_jsonb(x) row from public.${table} x order by id`,
    )
  ).rows.map((r) => r.row);
}
async function revision(organization = org) {
  return (
    await db.query<{ revision: number }>(
      "select revision from organizations where id=$1",
      [organization],
    )
  ).rows[0].revision;
}
const pallet = (values: Row[], number: number) =>
  values.find((r) => r.id === id(1, number))!;
const label = (values: Row[], number: number) =>
  (pallet(values, number).metadata?.export_label ?? {}) as Label;
const lot = (values: Row[], number: number) =>
  values.find((r) => r.id === id(6, number))!;

beforeAll(async () => {
  operation = readFileSync(
    new URL(
      "../supabase/operations/20261007_refresh_current_uruguay_labels.sql",
      import.meta.url,
    ),
    "utf8",
  );
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
  for (const [number, date, status, season, exportCode] of [
    [1, "2026-10-06", "Confirmado", 2026, ""],
    [2, "2026-10-03", "Confirmado", 2026, ""],
    [3, "2026-10-29", "Pendiente de confirmar", 2026, ""],
    [4, "2025-10-01", "Confirmado", 2025, ""],
    [5, "2026-10-08", "Confirmado", 2026, ""],
    [6, "2026-10-02", "Confirmado", 2026, ""],
    [7, "2026-10-06", "Confirmado", 2026, " AGN-0007 "],
    [8, "2026-10-06", "Confirmado", 2026, ""],
    [9, "2026-10-06", "Confirmado", 2026, "REGISTRO-OFICIAL"],
    [10, "2026-10-06", null, 2026, ""],
  ] as const)
    await db.query(
      "insert into producers(id,organization_id,name,metadata) values($1,$2,$3,$4::jsonb)",
      [
        id(4, number),
        org,
        `Productor de prueba ${number}`,
        JSON.stringify({
          export_code: exportCode,
          export_origin: "Origen confirmado",
          harvest_reference: {
            date,
            ...(status ? { status } : {}),
            season,
            source: "Fuente de prueba",
            notes: [],
          },
        }),
      ],
    );
  await db.query(
    "insert into producers(id,organization_id,name) values($1,$2,'Otro productor')",
    [id(4, 90), otherOrg],
  );
  for (const [number, producer, code] of [
    [1, 1, "SPE-PRUEBA-001-SAN"],
    [2, 2, "CAN-PRUEBA-002-SAN"],
    [3, 3, "SPE-PRUEBA-003-SAN"],
    [4, 4, "SPE-PRUEBA-004-SAN"],
    [5, 5, "SPE-PRUEBA-005-SAN"],
    [6, 6, "SPE-PRUEBA-006-SAN"],
    [8, 8, "SPE-PRUEBA-008-SAN"],
    [9, 8, "SPE-PRUEBA-009-SAN"],
  ] as const)
    await db.query(
      "insert into trap_installations(organization_id,producer_id,source_key,source_row,source_document,source_form,source_version,trap_code,host) values($1,$2,'TEST',$3,'Prueba.pdf','TEST','01',$4,'SANDIA')",
      [org, id(4, producer), number, code],
    );
}, 30000);
afterAll(async () => await db.close());

async function insertOrigin(
  number: number,
  producer: number,
  options: {
    organization?: string;
    harvest?: string;
    date?: string;
    createdAt?: string;
    status?: string;
    crop?: string;
    receptionStatus?: string;
  } = {},
) {
  const organization = options.organization ?? org;
  await db.query(
    "insert into field_lots(id,organization_id,producer_id,code,harvest_date,status,created_at,created_by,crop) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      id(6, number),
      organization,
      id(4, producer),
      `LOT-PRUEBA-${number}`,
      options.harvest ?? null,
      options.status ?? "En recepción",
      options.createdAt ?? "2026-10-07T15:00:00Z",
      user,
      options.crop ?? "Sandía",
    ],
  );
  await db.query(
    "insert into receptions(id,organization_id,lot_id,date,responsible,created_at,status) values($1,$2,$3,$4,'Responsable',$5,$6)",
    [
      id(7, number),
      organization,
      id(6, number),
      options.date ?? "2026-10-07",
      options.createdAt ?? "2026-10-07T15:00:00Z",
      options.receptionStatus ?? "Confirmado",
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
}
async function insertPallet(
  number: number,
  producer = 1,
  options: {
    organization?: string;
    harvest?: string;
    date?: string;
    createdAt?: string;
    status?: string;
    destination?: string;
    metadata?: Record<string, unknown> | null;
  } = {},
) {
  const organization = options.organization ?? org;
  await insertOrigin(number, producer, { ...options, status: undefined });
  await db.query(
    "insert into pallets(id,organization_id,code,destination,assembled_at,weighed_date,responsible,gross_kg,net_kg,tare_kg,status,created_at,created_by,metadata) values($1,$2,$3,$4,'2026-10-07T12:00:00Z','2026-10-07','Responsable',142,100,42,$5,$6,$7,$8::jsonb)",
    [
      id(1, number),
      organization,
      `PAL-PRUEBA-${number}`,
      options.destination ?? "Uruguay",
      options.status ?? "Etiquetado",
      options.createdAt ?? "2026-10-07T15:00:00Z",
      user,
      options.metadata == null ? null : JSON.stringify(options.metadata),
    ],
  );
  await db.query(
    "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,100)",
    [id(2, number), organization, id(1, number), id(7, number)],
  );
}
async function addOrigin(
  palletNumber: number,
  originNumber: number,
  producer: number,
) {
  await insertOrigin(originNumber, producer);
  await db.query("update pallets set net_kg=200,gross_kg=242 where id=$1", [
    id(1, palletNumber),
  ]);
  await db.query(
    "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,100)",
    [id(2, originNumber), org, id(1, palletNumber), id(7, originNumber)],
  );
}

beforeEach(async () => {
  await db.exec(
    "rollback;reset role;delete from shipment_pallets;delete from shipments;delete from pallet_items;delete from pallets;delete from classifications;delete from reception_weights;delete from receptions;delete from field_lots;delete from audit_logs",
  );
  await db.query(
    "update organizations set revision=7,name='Cooperativa Agronorte' where id=$1",
    [org],
  );
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await insertPallet(1);
  await insertPallet(2, 1, {
    status: "Listo para carga",
    createdAt: cutoff,
    destination: " URUGUAY ",
  });
  await insertPallet(3, 1, { createdAt: "2026-10-07T15:32:35.001Z" });
  await insertPallet(4, 1, {
    harvest: "2026-10-05",
    metadata: {
      custom: "Preservar",
      export_label: {
        afidi: "AFIDI-ANTIGUO",
        packaged_date: "2026-10-06",
        harvest_date: "2026-10-05",
        producer_code: "CODIGO-CONFIRMADO",
        importer_name: "CLIENTE DE PRUEBA",
        importer_address: "Dirección confirmada",
        origin: "Origen confirmado",
        senave_program: false,
      },
    },
  });
  await insertPallet(5, 1, { status: "Expedido" });
  await insertPallet(6, 1, { status: "Cancelado" });
  await insertPallet(7, 1, { destination: "Argentina" });
  await insertPallet(8, 90, { organization: otherOrg });
  await insertPallet(9);
  await insertPallet(10);
  for (const [number, status] of [
    [9, "Expedido"],
    [10, "Cancelado"],
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
  await insertPallet(11, 7);
  await insertPallet(12, 3);
  await insertPallet(13, 4);
  await insertPallet(14, 5);
  await insertPallet(15, 6, { date: "2026-10-01" });
  await insertPallet(16);
  await addOrigin(16, 116, 2);
  await insertPallet(17);
  await addOrigin(17, 117, 8);
  await insertPallet(18, 9);
  await insertPallet(19);
  await addOrigin(19, 119, 7);
  await insertPallet(20, 1, {
    metadata: { export_label: { producer_code: "AGN-0001", afidi: " " } },
  });
  await insertPallet(21, 1, {
    metadata: {
      export_label: {
        afidi: "1571652",
        packaged_date: "2026-10-07",
        producer_code: "CODIGO-VALIDADO",
        harvest_date: "2026-10-06",
        senave_program: true,
      },
    },
  });
  await insertPallet(22, 1, { date: "2026-10-08" });
  await insertPallet(23, 1, {
    metadata: { export_label: { harvest_date: "2026-10-08" } },
  });
  await insertPallet(24, 1, { harvest: "2026-10-08" });
  await insertOrigin(25, 1);
  await insertOrigin(26, 1, { createdAt: "2026-10-07T15:32:35.001Z" });
  await insertOrigin(27, 1, { status: "Expedido" });
  await insertOrigin(28, 1, { date: "2026-10-01" });
  await insertOrigin(30, 1, { crop: "Melón" });
  await insertOrigin(31, 1, {
    createdAt: "2025-10-07T12:00:00Z",
    date: "2025-10-07",
  });
  await insertOrigin(32, 1, { receptionStatus: "Cancelado" });
  await db.query(
    "insert into field_lots(id,organization_id,producer_id,code,created_at) values($1,$2,$3,'LOT-SIN-RECEPCION','2026-10-07T15:00:00Z')",
    [id(6, 33), org, id(4, 1)],
  );
  await insertOrigin(34, 1, { date: "2026-10-08" });
  await insertOrigin(35, 10);
  await insertPallet(40);
  await addOrigin(40, 140, 3);
  for (const number of [41, 42, 43])
    await insertPallet(number, 1, { harvest: "2026-10-06" });
  await db.query("update field_lots set crop='Melón' where id=$1", [id(6, 41)]);
  await db.query("update receptions set status='Cancelado' where id=$1", [
    id(7, 42),
  ]);
  await db.query("update field_lots set status='Expedido' where id=$1", [
    id(6, 43),
  ]);
  await insertPallet(44);
  await addOrigin(44, 144, 2);
  await db.query("update receptions set status='Cancelado' where id=$1", [
    id(7, 144),
  ]);
  await db.exec("delete from audit_logs");
});

describe.sequential("actualización de etiquetas actuales de Uruguay", () => {
  it("incluye registros después del corte anterior y conserva pesos, QR, códigos, recepción y demás registros", async () => {
    const before = await rows("pallets");
    const sourceTables = [
      "producers",
      "trap_installations",
      "receptions",
      "reception_weights",
      "classifications",
      "pallet_items",
      "shipments",
      "shipment_pallets",
    ];
    const sourcesBefore = await Promise.all(sourceTables.map(rows));
    await db.exec(operation);
    const after = await rows("pallets");
    for (const number of [1, 2]) {
      expect(label(after, number)).toMatchObject({
        afidi: "1571652",
        packaged_date: "2026-10-07",
        producer_code: "SPE-PRUEBA-001-SAN",
        harvest_date: "2026-10-06",
      });
      expect(pallet(after, number).status).toBe("En armado");
    }
    for (const number of [3, 5, 6, 7, 8, 9, 10])
      expect(pallet(after, number)).toEqual(pallet(before, number));
    for (const row of after) {
      const original = before.find((r) => r.id === row.id)!;
      const identityAndWeights = (r: Row) =>
        Object.fromEntries(
          Object.entries(r).filter(
            ([key]) => !["metadata", "status", "updated_at"].includes(key),
          ),
        );
      expect(identityAndWeights(row)).toEqual(identityAndWeights(original));
    }
    expect(await Promise.all(sourceTables.map(rows))).toEqual(sourcesBefore);
    expect(await revision()).toBe(8);
    expect(await revision(otherOrg)).toBe(3);
  });

  it("preserva fechas y código confirmados, importador y origen; aplica el AFIDI autorizado", async () => {
    await db.exec(operation);
    expect(label(await rows("pallets"), 4)).toEqual({
      afidi: "1571652",
      packaged_date: "2026-10-06",
      harvest_date: "2026-10-05",
      producer_code: "CODIGO-CONFIRMADO",
      importer_name: "CLIENTE DE PRUEBA",
      importer_address: "Dirección confirmada",
      origin: "Origen confirmado",
      senave_program: true,
    });
    expect(pallet(await rows("pallets"), 4).metadata?.custom).toBe("Preservar");
    expect(lot(await rows("field_lots"), 4).harvest_date).toBe("2026-10-05");
  });

  it("completa solo cosechas pendientes Confirmado/2026 cronológicamente válidas, incluso recepción sin pallet", async () => {
    await db.exec(operation);
    const lots = await rows("field_lots");
    for (const number of [1, 2, 11, 16, 17, 18, 19, 20, 21, 25])
      expect(lot(lots, number).harvest_date).toBe("2026-10-06");
    expect(lot(lots, 116).harvest_date).toBe("2026-10-03");
    for (const number of [
      3, 5, 9, 10, 12, 13, 14, 15, 26, 27, 28, 30, 31, 32, 33, 34, 35, 140, 144,
    ])
      expect(lot(lots, number).harvest_date).toBeNull();
    const pallets = await rows("pallets");
    for (const number of [12, 13, 14, 15])
      expect(label(pallets, number).harvest_date ?? null).toBeNull();
  });

  it("deriva todos los códigos SPE/CAN sin usar AGN y mantiene cosecha dinámica con varias fechas", async () => {
    const results = await db.exec(operation);
    const pallets = await rows("pallets");
    expect(label(pallets, 16).producer_code).toContain("SPE-PRUEBA-001-SAN");
    expect(label(pallets, 16).producer_code).toContain("CAN-PRUEBA-002-SAN");
    expect(label(pallets, 16).harvest_date ?? null).toBeNull();
    expect(label(pallets, 40).harvest_date ?? null).toBeNull();
    expect(label(pallets, 44).harvest_date ?? null).toBeNull();
    expect(label(pallets, 17).harvest_date).toBe("2026-10-06");
    for (const code of [
      "SPE-PRUEBA-001-SAN",
      "SPE-PRUEBA-008-SAN",
      "SPE-PRUEBA-009-SAN",
    ])
      expect(label(pallets, 17).producer_code).toContain(code);
    expect(label(pallets, 18).producer_code).toBe("REGISTRO-OFICIAL");
    expect(label(pallets, 20).producer_code).toBe("SPE-PRUEBA-001-SAN");
    for (const number of [11, 19])
      expect(label(pallets, number).producer_code ?? "").toBe("");
    expect(JSON.stringify(label(pallets, 20))).not.toContain("AGN-");
    const report = results
      .flatMap((result) => result.rows)
      .find((row) => row.pallet === "PAL-PRUEBA-11");
    expect(report).toBeDefined();
    expect(report?.codigo_del_productor).toBeNull();
    expect(report?.pendientes).toContain(
      "Código de productor pendiente para una o más procedencias",
    );
  });

  it("no inventa envasado cuando recepción, cosecha del lote o de etiqueta superan el 07/10; permite AFIDI y código seguros", async () => {
    await db.exec(operation);
    const pallets = await rows("pallets");
    for (const number of [22, 23, 24]) {
      expect(label(pallets, number).packaged_date ?? null).toBeNull();
      expect(label(pallets, number).afidi).toBe("1571652");
      expect(label(pallets, number).producer_code).toBe("SPE-PRUEBA-001-SAN");
    }
    expect(label(pallets, 23).harvest_date).toBe("2026-10-08");
    expect(lot(await rows("field_lots"), 24).harvest_date).toBe("2026-10-08");
    for (const number of [41, 42, 43, 44]) {
      expect(label(pallets, number).packaged_date ?? null).toBeNull();
      expect(label(pallets, number).harvest_date ?? null).toBeNull();
    }
  });

  it("audita lotes y pallets mediante el trigger real y no atribuye cambios a un usuario ajeno", async () => {
    const beforeLots = await rows("field_lots");
    const beforePallets = await rows("pallets");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec(operation);
    const afterLots = await rows("field_lots");
    const afterPallets = await rows("pallets");
    const logs = await rows("audit_logs");
    expect(logs.length).toBeGreaterThan(0);
    expect(new Set(logs.map((r) => r.entity_type))).toEqual(
      new Set(["field_lots", "pallets"]),
    );
    for (const log of logs) {
      expect(log.actor).toBe("Administrador de prueba");
      expect(log.created_by).toBe(user);
      expect(log.reason).not.toBe("");
      const [before, after] =
        log.entity_type === "field_lots"
          ? [beforeLots, afterLots]
          : [beforePallets, afterPallets];
      expect(log.before).toEqual(before.find((r) => r.id === log.entity_id));
      expect(log.after).toEqual(after.find((r) => r.id === log.entity_id));
    }
  });

  it("es idempotente y no actualiza registros futuros al ejecutar nuevamente la operación", async () => {
    await db.exec(operation);
    const firstPallets = await rows("pallets");
    const firstLots = await rows("field_lots");
    const firstLogs = await rows("audit_logs");
    await db.exec(operation);
    expect(await rows("pallets")).toEqual(firstPallets);
    expect(await rows("field_lots")).toEqual(firstLots);
    expect(await rows("audit_logs")).toEqual(firstLogs);
    expect(await revision()).toBe(8);
    await insertPallet(29, 1, { createdAt: "2026-10-08T12:00:00Z" });
    const future = pallet(await rows("pallets"), 29);
    const futureLot = lot(await rows("field_lots"), 29);
    await db.exec(operation);
    expect(pallet(await rows("pallets"), 29)).toEqual(future);
    expect(lot(await rows("field_lots"), 29)).toEqual(futureLot);
    expect(await revision()).toBe(8);
  });

  it("revierte todo ante metadatos inválidos o auditoría falsa/desactivada", async () => {
    for (const damage of [
      "alter table pallets disable trigger audit_change",
      "alter table field_lots disable trigger audit_change",
      "drop trigger audit_change on pallets;create function public.fake_audit() returns trigger language plpgsql as $$begin return new;end$$;create trigger audit_change after insert or update on pallets for each row execute function public.fake_audit()",
      `alter table pallets drop constraint pallets_export_metadata_check;update pallets set metadata='{"export_label":"inválido"}' where id='${id(1, 21)}'`,
      `update producers set metadata=jsonb_set(metadata,'{harvest_reference,date}','"2026-02-30"'::jsonb) where id='${id(4, 8)}'`,
    ]) {
      const beforePallets = await rows("pallets");
      const beforeLots = await rows("field_lots");
      await db.exec("begin");
      await db.exec(damage);
      await expect(db.exec(operation)).rejects.toThrow();
      await db.exec("rollback");
      expect(await rows("pallets")).toEqual(beforePallets);
      expect(await rows("field_lots")).toEqual(beforeLots);
      expect(await revision()).toBe(7);
      expect(await rows("audit_logs")).toHaveLength(0);
    }
  });

  it("no convierte la operación administrativa en acceso de escritura para clientes anon/authenticated", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    for (const role of ["anon", "authenticated"]) {
      const beforePallets = await rows("pallets");
      const beforeLots = await rows("field_lots");
      await db.exec(`set role ${role}`);
      await expect(db.exec(operation)).rejects.toThrow("permission denied");
      await db.exec("rollback;reset role");
      expect(await rows("pallets")).toEqual(beforePallets);
      expect(await rows("field_lots")).toEqual(beforeLots);
      expect(await revision()).toBe(7);
    }
    expect(
      (
        await db.query(
          "select has_table_privilege('authenticated','pallets','UPDATE') pallet_update,has_table_privilege('authenticated','field_lots','UPDATE') lot_update,has_table_privilege('anon','pallets','UPDATE') anon_update",
        )
      ).rows[0],
    ).toEqual({ pallet_update: false, lot_update: false, anon_update: false });
  });
});
