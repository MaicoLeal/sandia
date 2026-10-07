import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyData } from "./domain";
import type { Data } from "./types";

const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const user = "30000000-0000-4000-8000-000000000001";
const id = (group: number, number: number) =>
  `${group}0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const db = new PGlite();
const sourceRows = [
  ["Richar Llamosas", "2026-10-06"],
  ["Productor de prueba 1", null],
  ["Productor de prueba 2", "2026-10-29"],
  ["Productor de prueba 3", null],
  ["Productor de prueba 4", null],
  ["Productor de prueba 5", null],
  ["Productor de prueba 6", "2026-10-04"],
  ["Productor de prueba 7", "2026-10-04"],
  ["Elias Galeano", "2026-10-02"],
  ["Productor de prueba 8", "2026-10-06"],
  ["Cirila Salinas", "2026-10-01"],
  ["Productor de prueba 9", "2026-09-30"],
  ["Agustin Vera", null],
  ["Productor de prueba 10", "2026-10-02"],
  ["Productor de prueba 11", null],
  ["Productor de prueba 12", null],
  ["Matia Alarcon", "2026-10-06"],
  ["Productor de prueba 13", "2026-10-03"],
  ["Productor de prueba 14", "2026-10-03"],
  ["Productor de prueba 15", "2026-10-03"],
  ["Productor de prueba 16", "2026-10-03"],
  ["Productor de prueba 17", "2026-10-07"],
] as const;
const rows = sourceRows.map(([producer_name, date], index) => ({
  source_row: index + 1,
  producer_name,
  date,
  status:
    date === null
      ? null
      : producer_name === "Productor de prueba 2" ||
          producer_name === "Elias Galeano"
        ? "Pendiente de confirmar"
        : "Confirmado",
  notes: ["Referencia documental de prueba"],
}));
const template = readFileSync(
  new URL(
    "../supabase/operations/import_producer_harvest_dates.sql",
    import.meta.url,
  ),
  "utf8",
);
const operation = (source: unknown[] = rows) =>
  template.replace(
    "$harvest_rows$[]$harvest_rows$",
    `$harvest_rows$${JSON.stringify(source)}$harvest_rows$`,
  );
let initial: Data;
let baselineRevision: number;

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
type Reference = {
  date: string;
  status: string;
  season: number;
  source: string;
  notes: string[];
};
function reference(producer: Data["producers"][number] | undefined) {
  return (producer?.metadata as { harvest_reference?: Reference } | null)
    ?.harvest_reference;
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
    "insert into organizations(id,name,revision) values($1,'Cooperativa Agronorte',1),($2,'Otra cooperativa',9)",
    [org, otherOrg],
  );
  await db.query("insert into auth.users values($1,'admin@test.invalid')", [
    user,
  ]);
  await db.query(
    "insert into profiles(organization_id,user_id,name,role) values($1,$2,'Administrador real','administrador')",
    [org, user],
  );
  for (const row of rows) {
    if (row.producer_name === "Productor de prueba 16") continue;
    const name =
      row.producer_name === "Cirila Salinas"
        ? "Ciria Salinas"
        : row.producer_name;
    const metadata: Record<string, unknown> = {
      export_origin: "Origen confirmado",
      custom: "Conservar",
    };
    if (row.producer_name === "Elias Galeano")
      metadata.export_code = "OFICIAL-ELIAS";
    if (row.date === null)
      metadata.harvest_reference = {
        date: "2026-09-11",
        status: "Confirmado",
        season: 2026,
        source: "Fuente anterior",
        notes: ["No reemplazar una fecha por celda vacía"],
      };
    await db.query(
      "insert into producers(id,organization_id,name,metadata) values($1,$2,$3,$4::jsonb)",
      [id(4, row.source_row), org, name, JSON.stringify(metadata)],
    );
  }
  await db.query(
    "insert into producers(id,organization_id,name) values($1,$2,'Productor de prueba 15'),($3,$4,'Elias Galeano')",
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
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261007125340_trap_installations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query(
    "insert into trap_installations(organization_id,producer_id,source_key,source_row,source_document,source_form,source_version,trap_code,host) values($1,$2,'TEST',1,'Fuente.pdf','TEST','01','SPE-GUA-002-SAN','SANDIA')",
    [org, id(4, 9)],
  );
  await db.query(
    "insert into farms(id,organization_id,producer_id,name) values($1,$2,$3,'Finca')",
    [id(5, 90), org, id(4, 11)],
  );
  await db.query(
    "insert into plots(id,organization_id,farm_id,name) values($1,$2,$3,'Parcela')",
    [id(5, 91), org, id(5, 90)],
  );
  for (const config of [
    { number: 1, producer: 1, reception: "2026-10-06", status: "Etiquetado" },
    {
      number: 2,
      producer: 7,
      reception: "2026-10-05",
      status: "Etiquetado",
      harvest: "2026-09-29",
    },
    { number: 3, producer: 9, reception: "2026-10-01", status: "Etiquetado" },
    { number: 4, producer: 3, reception: "2026-10-01", status: "Etiquetado" },
    {
      number: 5,
      producer: 8,
      reception: "2026-10-05",
      status: "Expedido",
      lotStatus: "Expedido",
    },
    { number: 6, producer: 10, reception: "2026-10-01", status: "Etiquetado" },
    {
      number: 7,
      producer: 11,
      reception: "2026-10-02",
      status: "Listo para carga",
      plot: true,
    },
    {
      number: 8,
      producer: 12,
      reception: "2026-10-07",
      status: "Etiquetado",
      createdAt: "2026-10-07T13:21:08Z",
    },
    { number: 9, producer: 22, reception: "2026-10-07", status: "Etiquetado" },
    { number: 10, producer: 19, reception: "2026-10-05", status: "Expedido" },
    {
      number: 11,
      producer: 17,
      reception: "2026-10-07",
      status: "Etiquetado",
      override: "2026-09-20",
    },
    { number: 12, producer: 18, reception: "2026-10-02", status: "Etiquetado" },
    { number: 13, producer: 13, reception: "2026-10-05", status: "Etiquetado" },
  ] as const) {
    const optional = config as {
      harvest?: string;
      lotStatus?: string;
      createdAt?: string;
      plot?: boolean;
      override?: string;
    };
    await db.query(
      "insert into field_lots(id,organization_id,producer_id,plot_id,code,harvest_date,status,created_at) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id(6, config.number),
        org,
        optional.plot ? null : id(4, config.producer),
        optional.plot ? id(5, 91) : null,
        "LOT-" + config.number,
        optional.harvest ?? null,
        optional.lotStatus ?? "En recepción",
        optional.createdAt ?? "2026-10-01T12:00:00Z",
      ],
    );
    await db.query(
      "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,$4,'Responsable')",
      [id(7, config.number), org, id(6, config.number), config.reception],
    );
    await db.query(
      "insert into reception_weights(id,organization_id,reception_id,sequence,kg,operator) values($1,$2,$3,1,100,'Operador')",
      [id(8, config.number), org, id(7, config.number)],
    );
    await db.query(
      "insert into classifications(id,organization_id,reception_id,approved_kg,rejected_kg,quality) values($1,$2,$3,100,0,5)",
      [id(9, config.number), org, id(7, config.number)],
    );
    await db.query(
      "insert into pallets(id,organization_id,code,destination,assembled_at,responsible,net_kg,gross_kg,status,metadata) values($1,$2,$3,'Uruguay','2026-10-01T12:00:00Z','Responsable',100,142,$4,$5::jsonb)",
      [
        id(1, config.number),
        org,
        "PAL-" + config.number,
        config.status,
        optional.override
          ? JSON.stringify({
              export_label: {
                harvest_date: optional.override,
                afidi: "1571652",
              },
            })
          : null,
      ],
    );
    await db.query(
      "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,100)",
      [id(2, config.number), org, id(1, config.number), id(7, config.number)],
    );
    if (config.status === "Expedido") {
      await db.query(
        "insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible) values($1,$2,'Uruguay','Uruguay','Conductor','ABC123','2026-10-06','Responsable')",
        [id(3, config.number), org],
      );
      await db.query(
        "insert into shipment_pallets(id,organization_id,shipment_id,pallet_id) values($1,$2,$3,$4)",
        [
          id(3, config.number + 20),
          org,
          id(3, config.number),
          id(1, config.number),
        ],
      );
    }
  }
  // Every reception must respect the candidate date, even with a later delivery.
  await db.query(
    "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,'2026-10-06','Otra entrega')",
    [id(7, 90), org, id(6, 12)],
  );
  await db.exec("delete from audit_logs");
  initial = await data();
  baselineRevision = await revision();
  await db.exec(operation());
}, 30000);
afterAll(async () => await db.close());

describe.sequential("importación de fechas de cosecha por productor", () => {
  it("aplica solo referencias confirmadas y conserva las siete celdas vacías sin crear productores ni lotes", async () => {
    const current = await data();
    expect(current.producers).toHaveLength(initial.producers.length);
    expect(current.field_lots).toHaveLength(initial.field_lots.length);
    for (const row of rows) {
      const producer = current.producers.find(
        (p) => p.id === id(4, row.source_row),
      );
      if (row.date === null) {
        expect(producer).toEqual(
          initial.producers.find((p) => p.id === id(4, row.source_row)),
        );
        continue;
      }
      if (
        row.producer_name === "Productor de prueba 16" ||
        row.producer_name === "Productor de prueba 15"
      )
        continue;
      expect(reference(producer)).toMatchObject({
        date: row.date,
        status: row.status,
        season: 2026,
      });
    }
    expect(current.producers.find((p) => p.name === "Ciria Salinas")?.id).toBe(
      id(4, 11),
    );
    expect(
      reference(
        current.producers.find((p) => p.name === "Productor de prueba 17"),
      )?.date,
    ).toBe("2026-10-07");
    expect(
      (
        await db.query<{ metadata: null }>(
          "select metadata from producers where id=$1",
          [id(4, 91)],
        )
      ).rows[0].metadata,
    ).toBeNull();
    expect(
      (
        await db.query<{ revision: number }>(
          "select revision from organizations where id=$1",
          [otherOrg],
        )
      ).rows[0].revision,
    ).toBe(9);
    expect(await revision()).toBe(baselineRevision + 1);
  });

  it("llena únicamente lotes actuales sin fecha cuando la cosecha no supera ninguna recepción y respeta origen por parcela", async () => {
    const current = await data();
    const date = (number: number) =>
      current.field_lots.find((lot) => lot.id === id(6, number))?.harvest_date;
    expect(date(1)).toBe("2026-10-06");
    expect(date(7)).toBe("2026-10-01");
    expect(date(9)).toBe("2026-10-07");
    expect(date(11)).toBe("2026-10-06");
    expect(date(2)).toBe("2026-09-29");
    expect(date(3)).toBeNull();
    expect(date(4)).toBeNull();
    expect(date(5)).toBeNull();
    expect(date(6)).toBeNull();
    expect(date(8)).toBeNull();
    expect(date(10)).toBeNull();
    expect(date(12)).toBeNull();
    expect(date(13)).toBeNull();
    expect(
      reference(current.producers.find((p) => p.name === "Elias Galeano"))
        ?.status,
    ).toBe("Pendiente de confirmar");
    expect(
      reference(
        current.producers.find((p) => p.name === "Productor de prueba 2"),
      )?.status,
    ).toBe("Pendiente de confirmar");
    expect(
      reference(
        current.producers.find((p) => p.name === "Productor de prueba 8"),
      )?.notes.join(" "),
    ).toContain("recepción anterior");
    expect(
      reference(
        current.producers.find((p) => p.name === "Productor de prueba 6"),
      )?.notes.join(" "),
    ).toContain("fecha de cosecha distinta");
  });

  it("preserva códigos internos/SPE/oficiales, pesos, tara, QR y override de etiqueta, sin cambiar lotes ni pallets expedidos", async () => {
    const current = await data();
    const elias = current.producers.find((p) => p.name === "Elias Galeano")!;
    expect(elias.metadata).toMatchObject({
      internal_code: initial.producers.find((p) => p.id === elias.id)?.metadata
        ?.internal_code,
      export_code: "OFICIAL-ELIAS",
      trap_reference_codes: ["SPE-GUA-002-SAN"],
      export_origin: "Origen confirmado",
      custom: "Conservar",
    });
    for (const pallet of current.pallets) {
      const old = initial.pallets.find((p) => p.id === pallet.id)!;
      expect(pallet).toMatchObject({
        code: old.code,
        token: old.token,
        net_kg: old.net_kg,
        gross_kg: old.gross_kg,
        tare_kg: old.tare_kg,
        metadata: old.metadata,
      });
      if (old.status === "Expedido") expect(pallet).toEqual(old);
    }
    expect(
      current.pallets.find((p) => p.id === id(1, 11))?.metadata?.export_label
        ?.harvest_date,
    ).toBe("2026-09-20");
    expect(current.pallets.find((p) => p.id === id(1, 1))?.status).toBe(
      "En armado",
    );
    expect(current.pallets.find((p) => p.id === id(1, 7))?.status).toBe(
      "En armado",
    );
    expect(current.pallets.find((p) => p.id === id(1, 13))).toEqual(
      initial.pallets.find((p) => p.id === id(1, 13)),
    );
    for (const table of [
      "farms",
      "plots",
      "receptions",
      "reception_weights",
      "classifications",
      "pallet_items",
      "shipments",
      "shipment_pallets",
      "attachments",
    ] as const) {
      expect(current[table]).toEqual(initial[table]);
    }
  });

  it("se abstiene ante nombres ausentes o duplicados y deja fuente/notas auditadas con el actor real", async () => {
    const current = await data();
    expect(current.producers.find((p) => p.id === id(4, 20))).toEqual(
      initial.producers.find((p) => p.id === id(4, 20)),
    );
    expect(current.producers.find((p) => p.id === id(4, 90))).toEqual(
      initial.producers.find((p) => p.id === id(4, 90)),
    );
    const unresolved = current.audit_logs.filter(
      (log) => log.entity_type === "producer_harvest_import",
    );
    expect(unresolved).toHaveLength(2);
    expect(
      unresolved.map((log) =>
        (log.after as { notes: string[] }).notes.join(" "),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Coincidencias múltiples"),
        expect.stringContaining("Sin coincidencia exacta"),
      ]),
    );
    expect(
      current.audit_logs.every(
        (log) =>
          log.actor === "Administrador del servidor" &&
          log.created_by === null &&
          log.reason.includes("07/10/2026"),
      ),
    ).toBe(true);
    expect(
      current.audit_logs.some(
        (log) =>
          log.entity_type === "field_lots" &&
          (log.before as { harvest_date: string | null }).harvest_date ===
            null &&
          (log.after as { harvest_date: string }).harvest_date === "2026-10-06",
      ),
    ).toBe(true);
  });

  it("es idempotente y revierte todo el lote si aparece un error en la última fila después de cambios válidos", async () => {
    const before = await data();
    const previous = await revision();
    await db.exec(operation());
    expect(await data()).toEqual(before);
    expect(await revision()).toBe(previous);
    const invalid = structuredClone(rows);
    invalid[0].date = "2026-10-05" as (typeof invalid)[0]["date"];
    invalid[21].date = "2026-02-30" as (typeof invalid)[21]["date"];
    await expect(db.exec(operation(invalid))).rejects.toThrow(
      "date/time field value out of range",
    );
    await db.exec("rollback");
    expect(await data()).toEqual(before);
    expect(await revision()).toBe(previous);
  });

  it("rechaza proyecto equivocado/auditoría desactivada y nunca convierte una fecha futura en cosecha realizada aunque la fuente diga Confirmado", async () => {
    const before = await data();
    const previous = await revision();
    for (const [damage, message] of [
      [
        "update organizations set name='Otra empresa' where id='" + org + "'",
        "Cooperativa Agronorte autorizada",
      ],
      ["alter table field_lots disable trigger audit_change", "auditoría"],
    ]) {
      await db.exec("begin");
      await db.exec(damage);
      await expect(db.exec(operation())).rejects.toThrow(message);
      await db.exec("rollback");
      expect(await data()).toEqual(before);
    }
    const confirmedFuture = structuredClone(rows);
    confirmedFuture[2].status = "Confirmado";
    await db.exec(operation(confirmedFuture));
    expect(
      reference(
        (await data()).producers.find(
          (p) => p.name === "Productor de prueba 2",
        ),
      )?.status,
    ).toBe("Pendiente de confirmar");
    expect(await data()).toEqual(before);
    expect(await revision()).toBe(previous);
  });
});
