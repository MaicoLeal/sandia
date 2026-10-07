import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base, emptyData } from "./domain";
import type { Data } from "./types";

const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const id = (group: number, number: number) =>
  `${group}0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const admin = id(3, 1);
const db = new PGlite();
const sourceNames = [
  "PRODUCTOR DE PRUEBA 2",
  "ELIAS GALEANO",
  "PRODUCTOR DE PRUEBA 1",
  "PRODUCTOR DE PRUEBA 3",
  "PRODUCTOR DE PRUEBA 4",
  "PRODUCTOR DE PRUEBA 11",
  "PRODUCTOR DE PRUEBA 7",
  "PRODUCTOR DE PRUEBA 8",
  null,
  "PRODUCTOR DE PRUEBA 5",
  "RICHARD LLAMOSAS",
  "RICHARD LLAMOSAS",
  "MATIAS ALARCON",
  "PRODUCTOR DE PRUEBA 10",
  "PRODUCTOR DE PRUEBA 13",
  "PRODUCTOR DE PRUEBA 14",
  "PRODUCTOR DE PRUEBA 15",
  "PRODUCTOR DE PRUEBA 16",
  "PRODUCTOR DE PRUEBA 9",
  "CIRILA SALINAS",
  "PRODUCTOR DE PRUEBA 6",
  "AGUSTIN VERA TAPARI",
  "PRODUCTOR DE PRUEBA 12",
];
const canonical = (name: string) =>
  ({
    "RICHARD LLAMOSAS": "Richar Llamosas",
    "MATIAS ALARCON": "Matia Alarcon",
    "CIRILA SALINAS": "Ciria Salinas",
    "AGUSTIN VERA TAPARI": "Agustin Vera",
    "PRODUCTOR DE PRUEBA 10": "Próductor de prueba 10",
  })[name] ?? name;
// Synthetic coordinates/community values; no production source file is required by CI.
const rows = sourceNames.map((name, index) => ({
  source_row: index + 1,
  source_producer_name: name,
  trap_code:
    index === 8
      ? "SPE-GUA-008-MEL"
      : index === 10
        ? "SPE-LIB-001-SAN"
        : index === 11
          ? "SPE-LIB-002-SAN"
          : index === 17
            ? "SPE-GUA-01-SAN"
            : index === 21
              ? "CAN-MAR-001-SAN"
              : `SPE-GUA-${String(index + 1).padStart(3, "0")}-SAN`,
  department: index === 21 ? "CANINDEYU" : "SAN PEDRO",
  district: index === 21 ? "MARACANA" : "GUAJAYVI",
  community: "Comunidad de fuente",
  installed_on:
    index === 8 || index === 21 || index === 22 ? "2026-08-25" : "2026-08-12",
  trap_type: "MP",
  latitude_raw: "1234,56",
  longitude_raw: index === 17 ? "730323,86" : "12345,67",
  installation_place: "CC",
  host: index === 8 ? "MELON" : "SANDIA",
  area_ha: 0.5,
  crop_stage: "F",
  responsible: "Responsable de fuente",
  review_notes:
    index === 8
      ? ["TRAMPA ADCIONAL no identifica un productor", "Hospedante MELON"]
      : index === 17
        ? ["Código de dos dígitos y UTM literal requieren revisión"]
        : [],
}));
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261007125340_trap_installations.sql",
    import.meta.url,
  ),
  "utf8",
);
const importTemplate = readFileSync(
  new URL(
    "../supabase/operations/import_trap_installations.sql",
    import.meta.url,
  ),
  "utf8",
);
const operation = (sourceRows: unknown[] = rows) =>
  importTemplate.replace(
    "$trap_rows$[]$trap_rows$",
    `$trap_rows$${JSON.stringify(sourceRows)}$trap_rows$`,
  );
let baselineRevision = 0;
let beforeOperational: Pick<
  Data,
  | "field_lots"
  | "receptions"
  | "reception_weights"
  | "classifications"
  | "pallet_items"
  | "shipments"
  | "shipment_pallets"
>;
let originalPallets: Data["pallets"];

async function data() {
  const value = emptyData();
  for (const table of Object.keys(value) as (keyof Data)[]) {
    const result = await db.query<{ row: unknown }>(
      "select to_jsonb(x) as row from public." +
        table +
        " x where organization_id=$1 order by id",
      [org],
    );
    (value[table] as unknown[]) = result.rows.map((row) => row.row);
  }
  return value;
}
async function revision() {
  return (
    await db.query<{ revision: number }>(
      "select revision from organizations where id=$1",
      [org],
    )
  ).rows[0].revision;
}
async function traps() {
  return (
    await db.query<{
      source_row: number;
      producer_id: string | null;
      trap_code: string;
      source_producer_name: string | null;
      host: string;
      latitude_raw: string;
      longitude_raw: string;
      installed_on: string;
      review_notes: string[];
      status: string;
    }>(
      "select source_row,producer_id,trap_code,source_producer_name,host,latitude_raw,longitude_raw,installed_on::text,review_notes,status from trap_installations where organization_id=$1 order by source_row",
      [org],
    )
  ).rows;
}
async function isolated(action: () => Promise<void>) {
  await db.exec("begin");
  try {
    await action();
  } finally {
    await db.exec("rollback");
    await db.exec("reset role");
  }
}
async function authenticatedSync(value: Data, expectedRevision: number) {
  await db.exec("set role authenticated");
  try {
    return await db.query("select sync_workspace($1::jsonb,$2)", [
      JSON.stringify(value),
      expectedRevision,
    ]);
  } finally {
    await db.exec("reset role").catch(() => undefined);
  }
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
    "insert into organizations(id,name) values($1,'Cooperativa Agronorte'),($2,'Otra cooperativa')",
    [org, otherOrg],
  );
  for (const [number, role, status, organization] of [
    [1, "administrador", "Activo", org],
    [2, "destinatario", "Activo", org],
    [3, "auditor", "Activo", org],
    [4, "recepcion", "Activo", org],
    [5, "administrador", "Inactivo", org],
    [6, "administrador", "Activo", otherOrg],
  ] as const) {
    await db.query("insert into auth.users values($1,$2)", [
      id(3, number),
      `test-${number}@test.invalid`,
    ]);
    await db.query(
      "insert into profiles(organization_id,user_id,name,role,status) values($1,$2,'Usuario prueba',$3,$4)",
      [organization, id(3, number), role, status],
    );
  }
  const producers = [
    ...new Set(
      sourceNames
        .filter(
          (name): name is string =>
            name !== null && name !== "PRODUCTOR DE PRUEBA 12",
        )
        .map(canonical),
    ),
  ];
  for (const [index, name] of producers.entries()) {
    const metadata =
      name === "Agustin Vera"
        ? { export_origin: "Depto. de San Pedro – Paraguay" }
        : name === "ELIAS GALEANO"
          ? {
              export_code: "OFICIAL-ELIAS",
              export_origin: "Origen personal confirmado",
              other: "Conservar",
            }
          : null;
    await db.query(
      "insert into producers(id,organization_id,name,community,metadata) values($1,$2,$3,$4,$5::jsonb)",
      [
        id(4, index + 1),
        org,
        name,
        name === "ELIAS GALEANO" ? "Comunidad personalizada" : "",
        metadata === null ? null : JSON.stringify(metadata),
      ],
    );
  }
  await db.query(
    "insert into producers(id,organization_id,name) values($1,$2,'PRODUCTOR DE PRUEBA 15'),($3,$4,'ELIAS GALEANO')",
    [id(4, 90), org, id(4, 91), otherOrg],
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
  const producerByName = new Map(
    (await data()).producers.map((producer) => [producer.name, producer.id]),
  );
  for (const [number, name, status] of [
    [1, "ELIAS GALEANO", "Etiquetado"],
    [2, "Richar Llamosas", "Listo para carga"],
    [3, "Richar Llamosas", "Expedido"],
    [4, "PRODUCTOR DE PRUEBA 15", "Etiquetado"],
    [5, "Agustin Vera", "Etiquetado"],
  ] as const) {
    await db.query(
      "insert into field_lots(id,organization_id,producer_id,code,harvest_date) values($1,$2,$3,$4,'2026-09-29')",
      [id(5, number), org, producerByName.get(name), `L-${number}`],
    );
    await db.query(
      "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,'2026-10-01','Responsable')",
      [id(6, number), org, id(5, number)],
    );
    await db.query(
      "insert into reception_weights(id,organization_id,reception_id,sequence,kg,operator) values($1,$2,$3,1,100,'Operador')",
      [id(7, number), org, id(6, number)],
    );
    await db.query(
      "insert into classifications(id,organization_id,reception_id,approved_kg,rejected_kg,quality) values($1,$2,$3,100,0,5)",
      [id(8, number), org, id(6, number)],
    );
    await db.query(
      "insert into pallets(id,organization_id,code,destination,assembled_at,responsible,net_kg,gross_kg,status) values($1,$2,$3,'Uruguay','2026-10-01T12:00:00Z','Responsable',100,142,$4)",
      [id(1, number), org, `PAL-ORIGINAL-${number}`, status],
    );
    await db.query(
      "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,100)",
      [id(2, number), org, id(1, number), id(6, number)],
    );
  }
  await db.query(
    "insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible) values($1,$2,'Uruguay','Uruguay','Conductor','ABC123','2026-10-01','Responsable')",
    [id(9, 1), org],
  );
  await db.query(
    "insert into shipment_pallets(id,organization_id,shipment_id,pallet_id) values($1,$2,$3,$4)",
    [id(9, 2), org, id(9, 1), id(1, 3)],
  );
  const before = await data();
  originalPallets = before.pallets;
  beforeOperational = {
    field_lots: before.field_lots,
    receptions: before.receptions,
    reception_weights: before.reception_weights,
    classifications: before.classifications,
    pallet_items: before.pallet_items,
    shipments: before.shipments,
    shipment_pallets: before.shipment_pallets,
  };
  await db.exec(migration);
  await db.query(
    "insert into trap_installations(organization_id,producer_id,source_key,source_row,source_document,source_form,source_version,trap_code,host) values($1,$2,'OTHER',1,'Otro.pdf','OTHER','01','OTHER-CODE','SANDIA')",
    [otherOrg, id(4, 91)],
  );
  baselineRevision = await revision();
  await db.exec("delete from audit_logs");
  await db.exec(operation());
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin,
  ]);
}, 30000);
afterAll(async () => await db.close());

describe.sequential(
  "instalaciones de trampas y referencias de productores",
  () => {
    it("conserva 23 filas, aliases confirmados, instalaciones dobles y anomalías sin inventar productor, coordenadas ni fechas de cosecha", async () => {
      const records = await traps();
      const current = await data();
      expect(records).toHaveLength(23);
      const richar = current.producers.find(
        (p) => p.name === "Richar Llamosas",
      )!;
      expect(records[10].producer_id).toBe(richar.id);
      expect(records[11].producer_id).toBe(richar.id);
      expect(richar.metadata?.trap_reference_codes).toEqual([
        "SPE-LIB-001-SAN",
        "SPE-LIB-002-SAN",
      ]);
      for (const [row, name] of [
        [13, "Matia Alarcon"],
        [20, "Ciria Salinas"],
        [22, "Agustin Vera"],
      ] as const) {
        expect(records[row - 1].producer_id).toBe(
          current.producers.find((p) => p.name === name)?.id,
        );
      }
      expect(records[8].producer_id).toBeNull();
      expect(records[8].source_producer_name).toBeNull();
      expect(records[8].host).toBe("MELON");
      expect(records[8].review_notes.join(" ")).toContain("sin vincular");
      expect(records[17].trap_code).toBe("SPE-GUA-01-SAN");
      expect(records[17].longitude_raw).toBe("730323,86");
      expect(records[17].latitude_raw).toBe("1234,56");
      expect(records[17].review_notes.join(" ")).toContain(
        "requieren revisión",
      );
      expect(records[0].installed_on).toBe("2026-08-12");
      expect(records[16].producer_id).toBeNull();
      expect(records[16].review_notes.join(" ")).toContain(
        "Coincidencias múltiples",
      );
      expect(records[22].producer_id).toBeNull();
      expect(records[22].review_notes.join(" ")).toContain(
        "Sin coincidencia exacta",
      );
      for (const [table, rowsBefore] of Object.entries(beforeOperational)) {
        expect(current[table as keyof Data]).toEqual(rowsBefore);
      }
      expect(current.farms).toHaveLength(0);
      expect(current.plots).toHaveLength(0);
    });

    it("completa únicamente comunidad/origen faltante, corrige el default de Agustin y mantiene datos oficiales y overrides personales", async () => {
      const current = await data();
      const elias = current.producers.find((p) => p.name === "ELIAS GALEANO")!;
      expect(elias.community).toBe("Comunidad personalizada");
      expect(elias.metadata).toMatchObject({
        export_code: "OFICIAL-ELIAS",
        export_origin: "Origen personal confirmado",
        other: "Conservar",
      });
      expect(elias.metadata?.internal_code).toMatch(/^AGN-\d+$/);
      const agustin = current.producers.find((p) => p.name === "Agustin Vera")!;
      expect(agustin.metadata?.export_origin).toBe(
        "Depto. de Canindeyú – Paraguay",
      );
      expect(agustin.metadata?.trap_reference_codes).toEqual([
        "CAN-MAR-001-SAN",
      ]);
      expect(agustin.community).toBe("Comunidad de fuente");
      expect(
        current.producers.find((p) => p.name === "PRODUCTOR DE PRUEBA 2")
          ?.metadata?.export_origin,
      ).toBe("Depto. de San Pedro – Paraguay");
      expect(await revision()).toBe(baselineRevision + 1);
      const audit = current.audit_logs.filter(
        (log) => log.entity_type === "trap_installations",
      );
      expect(audit).toHaveLength(23);
      expect(
        audit.every(
          (log) =>
            log.actor === "Administrador del servidor" &&
            log.created_by === null &&
            log.reason.includes("FOR-DVF-013"),
        ),
      ).toBe(true);
    });

    it("marca solo etiquetas afectadas para reimprimir sin modificar códigos QR, kilos, embalajes ni expediciones", async () => {
      const current = await data();
      for (const pallet of current.pallets) {
        const old = originalPallets.find((p) => p.id === pallet.id)!;
        expect(pallet).toMatchObject({
          id: old.id,
          code: old.code,
          token: old.token,
          net_kg: old.net_kg,
          gross_kg: old.gross_kg,
          tare_kg: old.tare_kg,
          metadata: old.metadata,
        });
      }
      expect(current.pallets.find((p) => p.id === id(1, 1))?.status).toBe(
        "En armado",
      );
      expect(current.pallets.find((p) => p.id === id(1, 2))?.status).toBe(
        "En armado",
      );
      expect(current.pallets.find((p) => p.id === id(1, 3))).toEqual(
        originalPallets.find((p) => p.id === id(1, 3)),
      );
      expect(current.pallets.find((p) => p.id === id(1, 4))?.status).toBe(
        "Etiquetado",
      );
    });

    it("permite consulta solo a perfiles internos activos de su organización y no concede escritura directa", async () => {
      for (const [number, expected] of [
        [1, 23],
        [2, 0],
        [3, 23],
        [4, 23],
        [5, 0],
        [6, 1],
      ] as const) {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          id(3, number),
        ]);
        await db.exec("set role authenticated");
        expect(
          (
            await db.query<{ count: number }>(
              "select count(*)::int count from trap_installations",
            )
          ).rows[0].count,
        ).toBe(expected);
        await db.exec("reset role");
      }
      await db.exec("set role anon");
      await expect(
        db.query("select * from trap_installations"),
      ).rejects.toThrow("permission denied");
      await db.exec("reset role");
      const permissions = await db.query<{
        insert: boolean;
        update: boolean;
        delete: boolean;
        definer: boolean;
      }>(`select has_table_privilege('authenticated','public.trap_installations','INSERT') as insert,
      has_table_privilege('authenticated','public.trap_installations','UPDATE') as update,has_table_privilege('authenticated','public.trap_installations','DELETE') as delete,
      (select bool_or(prosecdef) from pg_proc where oid in ('agronorte_private.derive_producer_trap_references()'::regprocedure,'agronorte_private.refresh_trap_producer_references()'::regprocedure,'agronorte_private.audit_trap_installation()'::regprocedure)) as definer`);
      expect(permissions.rows[0]).toEqual({
        insert: false,
        update: false,
        delete: false,
        definer: false,
      });
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        admin,
      ]);
      await db.exec("set role authenticated");
      const flags = await db.query<{ features: Record<string, boolean> }>(
        "select sandia_features() features",
      );
      expect(Object.values(flags.rows[0].features).every(Boolean)).toBe(true);
      expect(flags.rows[0].features.trap_installations).toBe(true);
      expect(flags.rows[0].features.pallet_tare).toBe(true);
      await db.exec("reset role");
    });

    it("deriva las referencias en la RPC de productor y elimina valores falsos de cliente incluso durante UPSERT y clientes anteriores", async () =>
      await isolated(async () => {
        const current = await data();
        const producer = current.producers.find(
          (p) => p.name === "ELIAS GALEANO",
        )!;
        const expected = producer.metadata?.trap_reference_codes;
        const originalMetadata = structuredClone(producer.metadata);
        producer.name = "Elias nombre corregido";
        producer.metadata = {
          ...producer.metadata,
          trap_reference_codes: ["FAKE-SOURCE"],
        };
        current.audit_logs.push({
          ...base(org),
          entity_type: "producers",
          entity_id: producer.id,
          action: "Productor corregido",
          actor: "Cliente",
          before: null,
          after: producer,
          reason: "Nombre verificado",
        });
        await authenticatedSync(current, baselineRevision + 1);
        let saved = (await data()).producers.find((p) => p.id === producer.id)!;
        expect(saved.metadata?.trap_reference_codes).toEqual(expected);
        const legacy = await data();
        const legacyProducer = legacy.producers.find(
          (p) => p.id === producer.id,
        )!;
        legacyProducer.name = "Elias nombre revisado";
        legacyProducer.metadata = null;
        legacy.audit_logs.push({
          ...base(org),
          entity_type: "producers",
          entity_id: producer.id,
          action: "Productor corregido",
          actor: "Cliente",
          before: null,
          after: legacyProducer,
          reason: "Confirmación de nombre",
        });
        await authenticatedSync(legacy, baselineRevision + 2);
        saved = (await data()).producers.find((p) => p.id === producer.id)!;
        expect(saved.metadata).toEqual(originalMetadata);
      }));

    it("impide vincular instalaciones a otra organización y conserva historial al cancelar una de dos trampas", async () => {
      await isolated(async () => {
        await expect(
          db.query(
            "update trap_installations set producer_id=$1 where organization_id=$2 and source_row=2",
            [id(4, 91), org],
          ),
        ).rejects.toThrow("foreign key");
      });
      await isolated(async () => {
        const previous = await revision();
        await db.query(
          "update trap_installations set status='Cancelado' where organization_id=$1 and source_row=11",
          [org],
        );
        const richar = (await data()).producers.find(
          (p) => p.name === "Richar Llamosas",
        )!;
        expect(richar.metadata?.trap_reference_codes).toEqual([
          "SPE-LIB-002-SAN",
        ]);
        expect(
          (await traps()).find((row) => row.source_row === 11)?.status,
        ).toBe("Cancelado");
        expect(await revision()).toBe(previous + 1);
      });
      await isolated(async () => {
        await expect(
          db.query(
            "delete from trap_installations where organization_id=$1 and source_row=11",
            [org],
          ),
        ).rejects.toThrow("No se permite eliminar");
      });
    });

    it("rechaza fuente incompleta y desactivación de auditoría sin cambios parciales", async () => {
      const before = await data();
      const beforeTraps = await traps();
      const previous = await revision();
      await expect(db.exec(operation(rows.slice(0, 22)))).rejects.toThrow(
        "23 filas",
      );
      await db.exec("rollback");
      expect(await data()).toEqual(before);
      expect(await traps()).toEqual(beforeTraps);
      expect(await revision()).toBe(previous);
      await db.exec("begin");
      await db.exec(
        "alter table trap_installations disable trigger audit_change",
      );
      await expect(db.exec(operation())).rejects.toThrow("auditoría");
      await db.exec("rollback");
      expect(await data()).toEqual(before);
      expect(await revision()).toBe(previous);
      const invalid = structuredClone(rows);
      invalid[0].trap_code = "SPE-CAMBIO-ANTES-DEL-ERROR";
      invalid[22].installed_on = "2026-02-30";
      await expect(db.exec(operation(invalid))).rejects.toThrow(
        "date/time field value out of range",
      );
      await db.exec("rollback");
      expect(await data()).toEqual(before);
      expect(await traps()).toEqual(beforeTraps);
      expect(await revision()).toBe(previous);
    });

    it("mantiene origen personal de Agustin y excluye referencias de MELON aunque exista una vinculación manual", async () =>
      await isolated(async () => {
        const current = await data();
        const agustin = current.producers.find(
          (producer) => producer.name === "Agustin Vera",
        )!;
        await db.query(
          "update producers set metadata=metadata||jsonb_build_object('export_origin','Origen personal de Agustin') where id=$1",
          [agustin.id],
        );
        const elias = current.producers.find(
          (producer) => producer.name === "ELIAS GALEANO",
        )!;
        await db.query(
          `insert into trap_installations(organization_id,producer_id,source_key,source_row,source_document,source_form,source_version,trap_code,host)
      values($1,$2,'MANUAL-MELON',1,'Otra fuente','Otra','01','MELON-EXCLUIDO','MELON')`,
          [org, elias.id],
        );
        // Use the same body inside the test transaction; the caller owns its commit.
        await db.exec(
          operation()
            .replace(/^begin;\s*$/m, "")
            .replace(/^commit;\s*$/m, ""),
        );
        const saved = await data();
        expect(
          saved.producers.find((producer) => producer.id === agustin.id)
            ?.metadata?.export_origin,
        ).toBe("Origen personal de Agustin");
        expect(
          saved.producers.find((producer) => producer.id === elias.id)?.metadata
            ?.trap_reference_codes,
        ).toEqual(elias.metadata?.trap_reference_codes);
      }));

    it("puede repetirse sin duplicar instalaciones, auditoría, referencias o revisiones y sin perder capacidades existentes", async () => {
      const before = await data();
      const beforeTraps = await traps();
      const previous = await revision();
      await db.exec(migration);
      await db.exec(operation());
      expect(await data()).toEqual(before);
      expect(await traps()).toEqual(beforeTraps);
      expect(await revision()).toBe(previous);
    });
  },
);
