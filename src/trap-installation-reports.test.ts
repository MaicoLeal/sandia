import { describe, expect, it } from "vitest";
import { base } from "./domain";
import type { TrapInstallation } from "./types";
import {
  filterTrapInstallations,
  trapInstallationRows,
} from "./services/trap-installation-reports";

const org = "20000000-0000-4000-8000-000000000001";
const producer = {
  ...base(org),
  name: "Productor de prueba",
  document: "Documento privado",
  phone: "Privado",
  community: "Comunidad",
  address: "Dirección privada",
  notes: "Privado",
};
const installation: TrapInstallation = {
  ...base(org),
  producer_id: producer.id,
  source_key: "TEST",
  source_row: 1,
  source_document: "Planilla de prueba.pdf",
  source_form: "FOR-DVF-013",
  source_version: "01",
  source_producer_name: "NOMBRE ORIGINAL",
  trap_code: "SPE-TEST-001-SAN",
  department: "SAN PEDRO",
  district: "DISTRITO",
  community: "COMUNIDAD",
  installed_on: "2026-08-12",
  trap_type: "MP",
  latitude_raw: "5680,15",
  longitude_raw: "730323,86",
  installation_place: "CC",
  host: "SANDIA",
  area_ha: 0.25,
  crop_stage: "F",
  responsible: "Técnico de prueba",
  review_notes: ["Verificar valor original"],
};

describe("informes de instalaciones de trampas", () => {
  it("conserva la fecha de instalación, referencias y coordenadas originales sin incluir datos personales del productor", () => {
    const rows = trapInstallationRows([installation], [producer]);
    expect(rows[0]).toMatchObject({
      Productor: producer.name,
      Nombre_en_planilla: "NOMBRE ORIGINAL",
      Fecha_instalación: "12/08/2026",
      Longitud_UTM_original: "730323,86",
      Área_ha: 0.25,
      Revisión: "Verificar valor original",
    });
    expect(JSON.stringify(rows)).not.toMatch(
      /Documento privado|Dirección privada|Privado/,
    );
  });
  it("mantiene la instalación adicional sin inventar un productor y permite buscarla", () => {
    const additional = {
      ...installation,
      ...base(org),
      producer_id: null,
      source_producer_name: null,
      host: "MELON",
      installed_on: "2026-08-25",
      trap_code: "SPE-TEST-001-MEL",
    };
    expect(trapInstallationRows([additional], [producer])[0].Productor).toBe(
      "Sin productor vinculado",
    );
    expect(
      filterTrapInstallations([installation, additional], [producer], {
        query: "sin productor",
      }),
    ).toEqual([additional]);
    expect(
      filterTrapInstallations([installation, additional], [producer], {
        producerId: producer.id,
      }),
    ).toEqual([installation]);
  });
  it("filtra por fecha de instalación y código, con límites inclusivos, y no asume fechas faltantes", () => {
    const unknownDate = { ...installation, ...base(org), installed_on: null };
    const filters = { from: "2026-08-12", to: "2026-08-12", query: "spe-test" };
    expect(
      filterTrapInstallations([installation, unknownDate], [producer], filters),
    ).toEqual([installation]);
    expect(
      filterTrapInstallations([installation], [producer], {
        from: "2026-10-01",
      }),
    ).toHaveLength(0);
    expect(
      trapInstallationRows([unknownDate], [producer])[0].Fecha_instalación,
    ).toBe("No informada");
  });
});
