import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base, emptyData } from "./domain";
import type { Data } from "./types";

const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const user = "30000000-0000-4000-8000-000000000001";
const db = new PGlite();
const id = (group: number, number: number) =>
  `${group}0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261007121008_producer_internal_codes.sql",
    import.meta.url,
  ),
  "utf8",
);

async function remote() {
  const data = emptyData();
  for (const table of Object.keys(data) as (keyof Data)[]) {
    const result = await db.query<{ row: unknown }>(
      "select to_jsonb(x) as row from public." +
        table +
        " x where organization_id=$1 order by id",
      [org],
    );
    (data[table] as unknown[]) = result.rows.map((row) => row.row);
  }
  return data;
}

async function revision() {
  return (
    await db.query<{ revision: number }>(
      "select revision from organizations where id=$1",
      [org],
    )
  ).rows[0].revision;
}

async function sync(data: Data, expectedRevision: number) {
  await db.exec("set role authenticated");
  try {
    return await db.query<{ revision: number }>(
      "select sync_workspace($1::jsonb,$2) as revision",
      [JSON.stringify(data), expectedRevision],
    );
  } finally {
    // A rejected RPC aborts the enclosing test transaction until rollback.
    await db.exec("reset role").catch(() => undefined);
  }
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

beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
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
  await db.query("insert into auth.users values($1,'operator@test.invalid')", [
    user,
  ]);
  await db.query(
    "insert into organizations(id,name,revision) values($1,'Cooperativa Agronorte',7),($2,'Otra cooperativa',2)",
    [org, otherOrg],
  );
  await db.query(
    "insert into profiles(organization_id,user_id,name,role) values($1,$2,'Administrador real','administrador')",
    [org, user],
  );
  for (const [number, name, metadata, status] of [
    [
      1,
      "Alice Productora",
      {
        export_code: "SENAVE-88",
        export_origin: "San Pedro",
        note: "Preservar",
      },
      "Activo",
    ],
    [2, "Elias Galeano", null, "Inactivo"],
    [3, "Zulu Productor", null, "Activo"],
    [
      4,
      "Anterior con código",
      { internal_code: "LEGACY-KEEP", export_code: "OFICIAL-9" },
      "Activo",
    ],
  ] as const) {
    await db.query(
      "insert into producers(id,organization_id,name,status,metadata,created_by) values($1,$2,$3,$4,$5::jsonb,$6)",
      [
        id(4, number),
        org,
        name,
        status,
        metadata === null ? null : JSON.stringify(metadata),
        user,
      ],
    );
  }
  await db.query(
    "insert into producers(id,organization_id,name) values($1,$2,'Productor de otra empresa')",
    [id(4, 5), otherOrg],
  );
  await db.query(
    "insert into farms(id,organization_id,producer_id,name) values($1,$2,$3,'Finca')",
    [id(5, 1), org, id(4, 3)],
  );
  await db.query(
    "insert into plots(id,organization_id,farm_id,name) values($1,$2,$3,'Parcela')",
    [id(5, 2), org, id(5, 1)],
  );
  for (let number = 1; number <= 4; number++) {
    await db.query(
      "insert into field_lots(id,organization_id,producer_id,plot_id,code) values($1,$2,$3,$4,$5)",
      [
        id(6, number),
        org,
        number === 3 ? null : id(4, number),
        number === 3 ? id(5, 2) : null,
        "LOTE-" + number,
      ],
    );
    await db.query(
      "insert into receptions(id,organization_id,lot_id,date,responsible) values($1,$2,$3,'2026-10-01','Responsable')",
      [id(7, number), org, id(6, number)],
    );
    await db.query(
      "insert into reception_weights(id,organization_id,reception_id,sequence,kg,operator) values($1,$2,$3,1,500,'Operador')",
      [id(8, number), org, id(7, number)],
    );
    await db.query(
      "insert into classifications(id,organization_id,reception_id,approved_kg,rejected_kg,quality) values($1,$2,$3,500,0,5)",
      [id(9, number), org, id(7, number)],
    );
  }
  for (const [number, producer, status] of [
    [1, 1, "Etiquetado"],
    [2, 3, "Listo para carga"],
    [3, 2, "Expedido"],
    [4, 1, "Cancelado"],
    [5, 4, "En armado"],
    [6, 4, "Etiquetado"],
  ] as const) {
    await db.query(
      "insert into pallets(id,organization_id,code,destination,assembled_at,responsible,net_kg,gross_kg,tare_kg,status) values($1,$2,$3,'Uruguay','2026-10-01T15:00:00Z','Operador',100,142,42,$4)",
      [id(1, number), org, "PAL-" + number, status],
    );
    await db.query(
      "insert into pallet_items(id,organization_id,pallet_id,reception_id,kg) values($1,$2,$3,$4,100)",
      [id(2, number), org, id(1, number), id(7, producer)],
    );
  }
  await db.query(
    "insert into shipments(id,organization_id,destination,country,driver,plate,departure,responsible) values($1,$2,'Uruguay','Uruguay','Conductor','ABC123','2026-10-01','Responsable')",
    [id(3, 1), org],
  );
  await db.query(
    "insert into shipment_pallets(id,organization_id,shipment_id,pallet_id) values($1,$2,$3,$4)",
    [id(3, 2), org, id(3, 1), id(1, 3)],
  );
  await db.exec("delete from audit_logs");
  await db.exec(migration);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}, 30000);

afterAll(async () => await db.close());

describe.sequential("códigos internos permanentes de productores", () => {
  it("asigna por nombre e id a productores existentes activos e inactivos, preservando datos oficiales y otras organizaciones", async () => {
    const data = await remote();
    expect(data.producers.find((p) => p.id === id(4, 1))?.metadata).toEqual({
      internal_code: "AGN-0001",
      export_code: "SENAVE-88",
      export_origin: "San Pedro",
      note: "Preservar",
    });
    expect(
      data.producers.find((p) => p.id === id(4, 2))?.metadata?.internal_code,
    ).toBe("AGN-0002");
    expect(
      data.producers.find((p) => p.id === id(4, 3))?.metadata?.internal_code,
    ).toBe("AGN-0003");
    expect(data.producers.find((p) => p.id === id(4, 4))?.metadata).toEqual({
      internal_code: "LEGACY-KEEP",
      export_code: "OFICIAL-9",
    });
    expect(
      (
        await db.query<{ metadata: null }>(
          "select metadata from producers where id=$1",
          [id(4, 5)],
        )
      ).rows[0].metadata,
    ).toBeNull();
    expect(await revision()).toBe(8);
    expect(
      (
        await db.query<{ revision: number }>(
          "select revision from organizations where id=$1",
          [otherOrg],
        )
      ).rows[0].revision,
    ).toBe(2);
  });

  it("audita la asignación y marca etiquetas afectadas para reimprimir, sin alterar pallets expedidos ni sus kilos y QR", async () => {
    const data = await remote();
    expect(data.pallets.find((p) => p.id === id(1, 1))?.status).toBe(
      "En armado",
    );
    expect(data.pallets.find((p) => p.id === id(1, 2))?.status).toBe(
      "En armado",
    );
    expect(data.pallets.find((p) => p.id === id(1, 3))?.status).toBe(
      "Expedido",
    );
    expect(data.pallets.find((p) => p.id === id(1, 4))?.status).toBe(
      "Cancelado",
    );
    expect(data.pallets.find((p) => p.id === id(1, 6))?.status).toBe(
      "Etiquetado",
    );
    const logs = data.audit_logs;
    expect(logs.filter((log) => log.entity_type === "producers")).toHaveLength(
      3,
    );
    expect(logs.filter((log) => log.entity_type === "pallets")).toHaveLength(2);
    for (const log of logs) {
      expect(log.actor).toBe("Administrador del servidor");
      expect(log.created_by).toBeNull();
      expect(log.reason).not.toBe("");
      if (log.entity_type === "producers") {
        expect(
          (log.before as { metadata?: { internal_code?: string } } | null)
            ?.metadata?.internal_code,
        ).toBeUndefined();
        expect(
          (log.after as { metadata: { internal_code: string } }).metadata
            .internal_code,
        ).toMatch(/^AGN-000[1-3]$/);
      } else {
        const before = log.before as Record<string, unknown>;
        const after = log.after as Record<string, unknown>;
        for (const key of [
          "code",
          "token",
          "net_kg",
          "gross_kg",
          "tare_kg",
          "destination",
        ]) {
          expect(after[key]).toEqual(before[key]);
        }
      }
    }
  });

  it("genera códigos únicos de servidor para dos productores nuevos en la RPC real y conserva los códigos de los existentes", async () =>
    await isolated(async () => {
      const data = await remote();
      const originalCodes = data.producers.map(
        (p) => p.metadata?.internal_code,
      );
      for (const name of ["Nuevo uno", "Nuevo dos"]) {
        data.producers.push({
          ...base(org),
          created_by: user,
          name,
          document: "",
          phone: "",
          community: "",
          address: "",
          notes: "",
          metadata: {
            internal_code: "AGN-9999",
            export_code: "OFICIAL-CLIENTE",
          },
        });
      }
      const result = await sync(data, 8);
      expect(result.rows[0].revision).toBe(9);
      const saved = await remote();
      const created = saved.producers.filter((p) => p.name.startsWith("Nuevo"));
      expect(created.map((p) => p.metadata?.internal_code).sort()).toEqual([
        "AGN-0004",
        "AGN-0005",
      ]);
      expect(
        created.every((p) => p.metadata?.export_code === "OFICIAL-CLIENTE"),
      ).toBe(true);
      for (const code of originalCodes) {
        expect(
          saved.producers.some((p) => p.metadata?.internal_code === code),
        ).toBe(true);
      }
      expect(
        new Set(saved.producers.map((p) => p.metadata?.internal_code)).size,
      ).toBe(6);
    }));

  it("permite correcciones justificadas de clientes anteriores que omiten metadata, preservando código y datos oficiales", async () =>
    await isolated(async () => {
      const data = await remote();
      const producer = data.producers.find((p) => p.id === id(4, 1))!;
      const previous = structuredClone(producer);
      producer.name = "Alice nombre corregido";
      producer.metadata = null;
      data.audit_logs.push({
        ...base(org),
        entity_type: "producers",
        entity_id: producer.id,
        action: "Productor corregido",
        actor: "Cliente",
        before: previous,
        after: producer,
        reason: "Nombre verificado",
      });
      await sync(data, 8);
      const saved = (await remote()).producers.find(
        (p) => p.id === producer.id,
      )!;
      expect(saved.name).toBe("Alice nombre corregido");
      expect(saved.metadata).toEqual(previous.metadata);
      const unchanged = await remote();
      await sync(unchanged, 9);
      expect(
        (await remote()).producers.find((p) => p.id === producer.id)?.metadata
          ?.internal_code,
      ).toBe("AGN-0001");
    }));

  it("rechaza cambios y eliminación explícita del código por la RPC y conserva toda la transacción", async () => {
    for (const code of ["AGN-0099", "", null]) {
      await isolated(async () => {
        const data = await remote();
        const producer = data.producers.find((p) => p.id === id(4, 1))!;
        producer.metadata = {
          ...producer.metadata,
          internal_code: code,
        } as typeof producer.metadata;
        data.audit_logs.push({
          ...base(org),
          entity_type: "producers",
          entity_id: producer.id,
          action: "Productor corregido",
          actor: "Cliente",
          before: null,
          after: producer,
          reason: "Intento de cambiar código",
        });
        await expect(sync(data, 8)).rejects.toThrow(
          "código interno del productor es permanente",
        );
      });
      expect(
        (await remote()).producers.find((p) => p.id === id(4, 1))?.metadata
          ?.internal_code,
      ).toBe("AGN-0001");
      expect(await revision()).toBe(8);
    }
  });

  it("continúa la secuencia después de AGN-9999 y separa las secuencias por organización", async () =>
    await isolated(async () => {
      await db.exec(
        "alter table producers disable trigger assign_internal_code",
      );
      await db.query(
        "insert into producers(id,organization_id,name,metadata) values($1,$2,'Código alto',$3::jsonb)",
        [id(4, 10), org, JSON.stringify({ internal_code: "AGN-9999" })],
      );
      await db.exec(
        "alter table producers enable trigger assign_internal_code",
      );
      await db.query(
        "insert into producers(id,organization_id,name) values($1,$2,'Nuevo con código grande'),($3,$4,'Nuevo de otra empresa')",
        [id(4, 11), org, id(4, 12), otherOrg],
      );
      const codes = await db.query<{
        id: string;
        metadata: { internal_code: string };
      }>("select id,metadata from producers where id in ($1,$2)", [
        id(4, 11),
        id(4, 12),
      ]);
      expect(
        codes.rows.find((p) => p.id === id(4, 11))?.metadata.internal_code,
      ).toBe("AGN-10000");
      expect(
        codes.rows.find((p) => p.id === id(4, 12))?.metadata.internal_code,
      ).toBe("AGN-0001");
    }));

  it("mantiene RLS y permisos directos restringidos, y usa exclusivamente trigger invoker privado", async () => {
    const permissions = await db.query<{
      direct_insert: boolean;
      direct_update: boolean;
      direct_delete: boolean;
      helper_execute: boolean;
      rls: boolean;
      security_definer: boolean;
    }>(`select
      has_table_privilege('authenticated','public.producers','INSERT') direct_insert,
      has_table_privilege('authenticated','public.producers','UPDATE') direct_update,
      has_table_privilege('authenticated','public.producers','DELETE') direct_delete,
      has_function_privilege('authenticated','agronorte_private.assign_producer_internal_code()','EXECUTE') helper_execute,
      (select relrowsecurity from pg_class where oid='public.producers'::regclass) rls,
      (select prosecdef from pg_proc where oid='agronorte_private.assign_producer_internal_code()'::regprocedure) security_definer`);
    expect(permissions.rows[0]).toEqual({
      direct_insert: false,
      direct_update: false,
      direct_delete: false,
      helper_execute: false,
      rls: true,
      security_definer: false,
    });
    const before = await remote();
    await db.exec("set role authenticated");
    await expect(
      db.query("update producers set name='Sin permiso' where id=$1", [
        id(4, 1),
      ]),
    ).rejects.toThrow("permission denied");
    await db.exec("reset role");
    expect(await remote()).toEqual(before);
  });

  it("es idempotente: repetir la migración no cambia códigos, estados, revisión ni auditoría", async () => {
    const before = await remote();
    const oldRevision = await revision();
    await db.exec(migration);
    expect(await remote()).toEqual(before);
    expect(await revision()).toBe(oldRevision);
  });
});
