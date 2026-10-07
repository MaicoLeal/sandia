import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { beforeAll, describe, expect, it } from "vitest";
import { base, receptionTotal } from "./domain";
import { seed } from "./test-fixtures";
import type { Pallet, ProducerHarvestReference } from "./types";
import {
  palletLabelData,
  palletLabelEditValues,
  palletLabelDeclaration,
  palletLabelProducerIdentity,
  palletLabelRows,
  SENAVE_DECLARATION,
} from "./services/pallet-label-data";
import {
  createPalletLabelPdf,
  labelPrintFontSizes,
} from "./services/pallet-label-pdf";

function fixture() {
  const data = seed();
  const reception = data.receptions[0];
  const pallet: Pallet = {
    ...base(reception.organization_id, "Etiquetado"),
    code: "PAL-TEST-390",
    token: "test-public-token",
    destination: "Uruguay",
    assembled_at: "2026-10-02T15:00:00Z",
    responsible: "Operador de prueba",
    gross_kg: 415,
    net_kg: 390,
    fruit_count: null,
    notes: "",
  };
  data.pallets.push(pallet);
  data.pallet_items.push({
    ...base(reception.organization_id),
    pallet_id: pallet.id,
    reception_id: reception.id,
    kg: pallet.net_kg,
  });
  return { data, pallet };
}

function pdfText(pdf: jsPDF) {
  return [...pdf.output().matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((match) => {
      try {
        return inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
      } catch {
        return match[1];
      }
    })
    .join("\n");
}

function harvestReference(
  date = "2026-09-29",
  status: ProducerHarvestReference["status"] = "Confirmado",
  season = 2026,
): ProducerHarvestReference {
  return {
    date,
    status,
    season,
    source: "Planilla de cosecha de prueba",
    notes: [],
  };
}

describe("datos de la etiqueta de exportación", () => {
  it("prepara edición con los datos reales heredados y fechas ISO, sin asumir envasado ni AFIDI", () => {
    const { data, pallet } = fixture();
    data.producers[0].metadata = {
      export_code: " SENAVE-123 ",
      export_origin: " San Pedro ",
    };
    expect(palletLabelEditValues(data, pallet)).toMatchObject({
      producer_code: "SENAVE-123",
      origin: "San Pedro",
      harvest_date: "2026-10-01",
    });
    expect(palletLabelEditValues(data, pallet).packaged_date).toBeUndefined();
    expect(palletLabelEditValues(data, pallet).afidi).toBeUndefined();
    data.field_lots[0].harvest_date = null;
    expect(palletLabelEditValues(data, pallet).harvest_date).toBeNull();
  });
  it("conserva datos específicos y requiere cosecha explícita si un pallet mezcla fechas", () => {
    const { data, pallet } = fixture();
    const secondLot = {
      ...data.field_lots[0],
      ...base(pallet.organization_id),
      harvest_date: "2026-10-02",
    };
    data.field_lots.push(secondLot);
    const secondReception = {
      ...data.receptions[0],
      ...base(pallet.organization_id),
      lot_id: secondLot.id,
    };
    data.receptions.push(secondReception);
    data.pallet_items.push({
      ...base(pallet.organization_id),
      pallet_id: pallet.id,
      reception_id: secondReception.id,
      kg: 1,
    });
    expect(palletLabelEditValues(data, pallet).harvest_date).toBeNull();
    pallet.metadata = {
      export_label: {
        origin: " Origin confirmada ",
        producer_code: " CODE ",
        harvest_date: "2026-09-29",
        packaged_date: "2026-10-02",
        afidi: "AFIDI-123",
      },
    };
    expect(palletLabelEditValues(data, pallet)).toMatchObject({
      origin: "Origin confirmada",
      producer_code: "CODE",
      harvest_date: "2026-09-29",
      packaged_date: "2026-10-02",
      afidi: "AFIDI-123",
    });
  });

  it("completa la cosecha desde una referencia confirmada del productor cuando falta en el lote", () => {
    const { data, pallet } = fixture();
    data.field_lots[0].harvest_date = null;
    data.producers[0].metadata = { harvest_reference: harvestReference() };
    expect(palletLabelEditValues(data, pallet).harvest_date).toBe("2026-09-29");
    expect(palletLabelData(data, pallet).harvest).toBe("29/09/2026");
    expect(palletLabelRows(palletLabelData(data, pallet))).toContainEqual({
      title: "FECHA DE COSECHA",
      value: "29/09/2026",
    });
    expect(data.field_lots[0].harvest_date).toBeNull();
    expect(data.receptions[0].date).toBe("2026-10-01");
  });

  it("preserva la fecha del lote y la fecha específica de la etiqueta sobre la referencia del productor", () => {
    const { data, pallet } = fixture();
    data.producers[0].metadata = { harvest_reference: harvestReference() };
    expect(palletLabelEditValues(data, pallet).harvest_date).toBe("2026-10-01");
    expect(palletLabelData(data, pallet).harvest).toBe("01/10/2026");
    pallet.metadata = { export_label: { harvest_date: "2026-09-28" } };
    expect(palletLabelEditValues(data, pallet).harvest_date).toBe("2026-09-28");
    expect(palletLabelData(data, pallet).harvest).toBe("28/09/2026");
    expect(data.producers[0].metadata.harvest_reference?.date).toBe(
      "2026-09-29",
    );
    expect(data.field_lots[0].harvest_date).toBe("2026-10-01");
  });

  it.each([
    harvestReference("2026-09-29", "Pendiente de confirmar"),
    harvestReference("2026-10-02"),
    harvestReference("2026-10-29"),
    harvestReference("2026-09-29", "Confirmado", 2025),
    harvestReference("2026-02-30"),
    harvestReference("29/09/2026"),
    harvestReference(""),
  ])(
    "no imprime ni prellena una referencia pendiente o incompatible (%j)",
    (reference) => {
      const { data, pallet } = fixture();
      data.field_lots[0].harvest_date = null;
      data.producers[0].metadata = { harvest_reference: reference };
      expect(palletLabelEditValues(data, pallet).harvest_date).toBeNull();
      expect(palletLabelData(data, pallet).harvest).toBe("No informada");
      expect(data.producers[0].metadata.harvest_reference).toEqual(reference);
    },
  );

  it("requiere una fecha de recepción válida para heredar la referencia de cosecha", () => {
    const { data, pallet } = fixture();
    data.field_lots[0].harvest_date = null;
    data.receptions[0].date = "2026-02-30";
    data.producers[0].metadata = { harvest_reference: harvestReference() };
    expect(palletLabelEditValues(data, pallet).harvest_date).toBeNull();
    expect(palletLabelData(data, pallet).harvest).toBe("No informada");
  });

  it("prellena únicamente una cosecha común y no presenta una fecha parcial como cosecha de todo el pallet", () => {
    const { data, pallet } = fixture();
    data.field_lots[0].harvest_date = null;
    data.producers[0].metadata = { harvest_reference: harvestReference() };
    const secondProducer = {
      ...data.producers[0],
      ...base(pallet.organization_id),
      name: "Otro productor de prueba",
      metadata: { harvest_reference: harvestReference() },
    };
    data.producers.push(secondProducer);
    const secondLot = {
      ...data.field_lots[0],
      ...base(pallet.organization_id),
      plot_id: null,
      producer_id: secondProducer.id,
      code: "LOT-SECOND",
    };
    data.field_lots.push(secondLot);
    const secondReception = {
      ...data.receptions[0],
      ...base(pallet.organization_id),
      lot_id: secondLot.id,
    };
    data.receptions.push(secondReception);
    data.pallet_items.push({
      ...base(pallet.organization_id),
      pallet_id: pallet.id,
      reception_id: secondReception.id,
      kg: 1,
    });
    expect(palletLabelEditValues(data, pallet).harvest_date).toBe("2026-09-29");
    expect(palletLabelData(data, pallet).harvest).toBe("29/09/2026");
    secondProducer.metadata.harvest_reference.date = "2026-09-30";
    expect(palletLabelEditValues(data, pallet).harvest_date).toBeNull();
    expect(palletLabelData(data, pallet).harvest).toBe(
      "29/09/2026 / 30/09/2026",
    );
    secondProducer.metadata.harvest_reference.status = "Pendiente de confirmar";
    expect(palletLabelEditValues(data, pallet).harvest_date).toBeNull();
    expect(palletLabelData(data, pallet).harvest).toBe("No informada");
  });

  it.each(["Expedido", "Cancelado", "Vinculado a expedición"])(
    "no incorpora una nueva referencia del productor a una etiqueta histórica (%s)",
    (state) => {
      const { data, pallet } = fixture();
      data.field_lots[0].harvest_date = null;
      data.producers[0].metadata = { harvest_reference: harvestReference() };
      if (state === "Vinculado a expedición")
        data.shipment_pallets.push({
          ...base(pallet.organization_id, "Cancelado"),
          shipment_id: "shipment-test",
          pallet_id: pallet.id,
        });
      else pallet.status = state;
      expect(palletLabelEditValues(data, pallet).harvest_date).toBeNull();
      expect(palletLabelData(data, pallet).harvest).toBe("No informada");
      data.field_lots[0].harvest_date = "2026-10-01";
      expect(palletLabelEditValues(data, pallet).harvest_date).toBe(
        "2026-10-01",
      );
      expect(palletLabelData(data, pallet).harvest).toBe("01/10/2026");
      pallet.metadata = { export_label: { harvest_date: "2026-09-28" } };
      expect(palletLabelEditValues(data, pallet).harvest_date).toBe(
        "2026-09-28",
      );
      expect(palletLabelData(data, pallet).harvest).toBe("28/09/2026");
    },
  );
  it("usa el peso neto del pallet, aunque la recepción y el bruto sean mayores", () => {
    const { data, pallet } = fixture();
    const label = palletLabelData(data, pallet);
    expect(receptionTotal(data, data.receptions[0].id)).toBe(3247);
    expect(label.netKg).toBe(390);
    expect(
      palletLabelRows(label).find((row) => row.title === "PESO NETO (kg)")
        ?.value,
    ).toBe("390");
  });

  it("no convierte RUC, UUID, recepción o armado en campos oficiales no informados", () => {
    const { data, pallet } = fixture();
    data.producers[0].document = "12345678-9";
    data.field_lots[0].harvest_date = null;
    const label = palletLabelData(data, pallet);
    expect(label.producerInternalCode).toBe("No asignado");
    expect(label.producerCode).toBe("No informado");
    expect(label.origin).toBe("No informado");
    expect(label.afidi).toBe("No informado");
    expect(label.harvest).toBe("No informada");
    expect(label.packaged).toBe("No informada");
    expect(label.reception).toBe("01/10/2026");
    const identity = palletLabelProducerIdentity(label);
    expect(identity).not.toContain("Código interno Agronorte");
    expect(identity).not.toContain(data.producers[0].document);
    expect(identity).not.toContain(data.producers[0].id);
  });

  it("no estima cosecha a partir de referencias de trampa, pesaje o armado", () => {
    const { data, pallet } = fixture();
    data.field_lots[0].harvest_date = null;
    data.producers[0].metadata = { trap_reference_codes: ["SPE-GUA-002-SAN"] };
    pallet.weighed_date = "2026-10-01";
    expect(palletLabelEditValues(data, pallet).harvest_date).toBeNull();
    expect(palletLabelData(data, pallet).harvest).toBe("No informada");
    expect(palletLabelData(data, pallet).packaged).toBe("No informada");
  });

  it("identifica el productor con su código interno sin sustituir el código oficial de la etiqueta", () => {
    const { data, pallet } = fixture();
    data.producers[0].metadata = {
      internal_code: " AGN-0001 ",
      export_code: "SENAVE-123",
      trap_reference_codes: ["SPE-GUA-002-SAN"],
    };
    pallet.metadata = { export_label: { producer_code: "SENAVE-456" } };
    const label = palletLabelData(data, pallet);
    expect(label.producerInternalCode).toBe("AGN-0001");
    expect(label.producerCode).toBe("SENAVE-456");
    expect(palletLabelEditValues(data, pallet).producer_code).toBe(
      "SENAVE-456",
    );
    expect(palletLabelProducerIdentity(label)).toBe(
      "Productor: Elias Galeano   |   Código interno Agronorte: AGN-0001   |   Responsable: Operador de prueba",
    );
    expect(palletLabelRows(label)).toHaveLength(7);
    expect(palletLabelRows(label)).toContainEqual({
      title: "CÓDIGO DEL PRODUCTOR",
      value: "SENAVE-456",
    });
  });

  it.each([
    {
      name: "Elias Galeano",
      refs: ["SPE-GUA-002-SAN"],
      reference: "SPE-GUA-002-SAN",
      producerOrigin: "Depto. de San Pedro – Paraguay",
    },
    {
      name: "Richar Llamosas",
      refs: [" SPE-LIB-001-SAN ", "SPE-LIB-002-SAN", "SPE-LIB-001-SAN"],
      reference: "SPE-LIB-001-SAN / SPE-LIB-002-SAN",
      producerOrigin: "Depto. de San Pedro – Paraguay",
    },
    {
      name: "Agustin Vera",
      refs: ["CAN-MAR-001-SAN"],
      reference: "CAN-MAR-001-SAN",
      producerOrigin: "Depto. de Canindeyú – Paraguay",
    },
  ])(
    "hereda las referencias de trampa confirmadas de $name sin cambiar AGN ni el registro oficial",
    ({ name, refs, reference, producerOrigin }) => {
      const { data, pallet } = fixture();
      const producer = data.producers[0];
      producer.name = name;
      producer.metadata = {
        internal_code: "AGN-0001",
        export_code: "REGISTRO-CONSERVADO",
        export_origin: producerOrigin,
        trap_reference_codes: refs,
      };
      data.field_lots[0].harvest_date = null;
      const label = palletLabelData(data, pallet);
      expect(label.producerCode).toBe(reference);
      expect(palletLabelEditValues(data, pallet).producer_code).toBe(reference);
      expect(label.producerInternalCode).toBe("AGN-0001");
      expect(producer.metadata.export_code).toBe("REGISTRO-CONSERVADO");
      expect(label.origin).toBe(producerOrigin);
      expect(label.harvest).toBe("No informada");
      expect(label.packaged).toBe("No informada");
      expect(palletLabelEditValues(data, pallet).harvest_date).toBeNull();
      expect(label.senaveProgram).toBe(false);
      expect(palletLabelDeclaration(label)).not.toContain("CERTIFICACIÓN");
      expect(palletLabelRows(label)).toHaveLength(7);
      expect(palletLabelRows(label)).toContainEqual({
        title: "CÓDIGO DEL PRODUCTOR",
        value: reference,
      });
    },
  );

  it("usa el registro existente cuando las referencias de trampas aún no están informadas", () => {
    const { data, pallet } = fixture();
    data.producers[0].metadata = {
      export_code: " REGISTRO-123 ",
      trap_reference_codes: ["", "  "],
    };
    pallet.metadata = { export_label: { producer_code: "  " } };
    expect(palletLabelData(data, pallet).producerCode).toBe("REGISTRO-123");
    expect(palletLabelEditValues(data, pallet).producer_code).toBe(
      "REGISTRO-123",
    );
  });

  it("muestra los códigos y el origen oficial del productor, y la cosecha real del lote", () => {
    const { data, pallet } = fixture();
    data.producers[0].metadata = {
      export_code: "  SENAVE-123  ",
      export_origin: "  Depto. de San Pedro – Paraguay  ",
    };
    const label = palletLabelData(data, pallet);
    expect(label.producerCode).toBe("SENAVE-123");
    expect(label.origin).toBe("Depto. de San Pedro – Paraguay");
    expect(label.harvest).toBe("01/10/2026");
    expect(label.packaged).toBe("No informada");
  });

  it("prioriza datos confirmados de esta etiqueta sobre los del productor o lote", () => {
    const { data, pallet } = fixture();
    data.producers[0].metadata = {
      export_code: "OLD",
      export_origin: "Old origin",
    };
    pallet.metadata = {
      export_label: {
        producer_code: "  SENAVE-456 ",
        origin: "  Depto. de San Pedro – Paraguay ",
        harvest_date: "2026-09-29",
        packaged_date: "2026-10-02",
        afidi: "  AFIDI-TEST-123 ",
      },
    };
    const label = palletLabelData(data, pallet);
    expect(label).toMatchObject({
      producerCode: "SENAVE-456",
      origin: "Depto. de San Pedro – Paraguay",
      harvest: "29/09/2026",
      packaged: "02/10/2026",
      afidi: "AFIDI-TEST-123",
      netKg: 390,
    });
  });

  it("muestra el AFIDI confirmado en la edición y la etiqueta sin asignarlo a otros pallets", () => {
    const { data, pallet } = fixture();
    pallet.metadata = { export_label: { afidi: "1571652" } };
    expect(palletLabelEditValues(data, pallet).afidi).toBe("1571652");
    expect(palletLabelRows(palletLabelData(data, pallet))).toContainEqual({
      title: "N° DE AFIDI",
      value: "1571652",
    });
    const otherPallet: Pallet = {
      ...pallet,
      ...base(pallet.organization_id, "En armado"),
      code: "PAL-OTHER",
      token: "other-public-token",
      metadata: null,
    };
    expect(palletLabelEditValues(data, otherPallet).afidi).toBeUndefined();
    expect(palletLabelData(data, otherPallet).afidi).toBe("No informado");
  });

  it("incluye todas las procedencias sin repetir productor, origen, lote o fecha", () => {
    const { data, pallet } = fixture();
    const organizationId = pallet.organization_id;
    data.producers[0].metadata = {
      internal_code: "AGN-0001",
      export_code: "CODE-1",
      export_origin: "San Pedro",
      trap_reference_codes: ["SPE-GUA-002-SAN"],
    };
    const duplicate = {
      ...data.receptions[0],
      ...base(organizationId),
    };
    data.receptions.push(duplicate);
    data.pallet_items.push({
      ...data.pallet_items[0],
      ...base(organizationId),
      reception_id: duplicate.id,
    });
    const secondProducer = {
      ...data.producers[0],
      ...base(organizationId),
      name: "Otro productor",
      metadata: {
        internal_code: "AGN-0002",
        export_code: "CODE-2",
        export_origin: "Caaguazú",
        trap_reference_codes: ["SPE-LIB-001-SAN", "SPE-LIB-002-SAN"],
      },
    };
    data.producers.push(secondProducer);
    const secondLot = {
      ...data.field_lots[0],
      ...base(organizationId),
      plot_id: null,
      producer_id: secondProducer.id,
      code: "LOT-2",
      harvest_date: "2026-10-03",
    };
    data.field_lots.push(secondLot);
    const secondReception = {
      ...data.receptions[0],
      ...base(organizationId),
      lot_id: secondLot.id,
      date: "2026-10-04",
    };
    data.receptions.push(secondReception);
    data.pallet_items.push({
      ...data.pallet_items[0],
      ...base(organizationId),
      reception_id: secondReception.id,
    });
    const label = palletLabelData(data, pallet);
    expect(label.producer).toBe("Elias Galeano / Otro productor");
    expect(label.producerInternalCode).toBe("AGN-0001 / AGN-0002");
    expect(palletLabelProducerIdentity(label)).toContain(
      "Código interno Agronorte: AGN-0001 / AGN-0002",
    );
    expect(label.producerCode).toBe(
      "SPE-GUA-002-SAN / SPE-LIB-001-SAN / SPE-LIB-002-SAN",
    );
    expect(label.origin).toBe("San Pedro / Caaguazú");
    expect(label.lots).toBe("SAN-20261001-DEMO01 / LOT-2");
    expect(label.harvest).toBe("01/10/2026 / 03/10/2026");
    expect(label.reception).toBe("01/10/2026 / 04/10/2026");
    expect(label.netKg).toBe(390);
    secondProducer.metadata.trap_reference_codes = [];
    expect(palletLabelData(data, pallet).producerCode).toBe(
      "SPE-GUA-002-SAN / CODE-2",
    );
    expect(palletLabelEditValues(data, pallet).producer_code).toBe(
      "SPE-GUA-002-SAN / CODE-2",
    );
  });

  it("declara el programa SENAVE solo después de una confirmación explícita", () => {
    const { data, pallet } = fixture();
    const unconfirmed = palletLabelData(data, pallet);
    expect(unconfirmed.senaveProgram).toBe(false);
    expect(palletLabelDeclaration(unconfirmed)).toBe(
      "IDENTIFICACIÓN DE PALLET DE SANDÍA - DESTINO: URUGUAY",
    );
    pallet.metadata = { export_label: { senave_program: false } };
    expect(palletLabelData(data, pallet).senaveProgram).toBe(false);
    pallet.metadata.export_label!.senave_program = true;
    const confirmed = palletLabelData(data, pallet);
    expect(confirmed.senaveProgram).toBe(true);
    expect(palletLabelDeclaration(confirmed)).toBe(SENAVE_DECLARATION);
  });

  it("conserva campos pendientes si no se encuentra la procedencia del pallet", () => {
    const { data, pallet } = fixture();
    data.pallet_items = [];
    expect(palletLabelData(data, pallet)).toMatchObject({
      producer: "No informado",
      producerInternalCode: "No asignado",
      producerCode: "No informado",
      lots: "No informado",
      reception: "No informada",
      netKg: 390,
    });
  });
});

describe("PDF A4 horizontal del pallet", () => {
  let assets: { logo: string; qr: string };
  beforeAll(async () => {
    assets = {
      logo: `data:image/png;base64,${readFileSync("public/agronorte-logo.png").toString("base64")}`,
      qr: await QRCode.toDataURL(
        "https://example.invalid/?trace=test-public-token",
        { margin: 4, width: 800 },
      ),
    };
  });

  it("limita la letra de campos de texto para impresión y ajusta un origen de 200 caracteres a dos líneas", () => {
    const { data, pallet } = fixture();
    const label = palletLabelData(data, pallet);
    label.origin = "Villa ".repeat(34).slice(0, 200);
    expect(label.origin).toHaveLength(200);
    const sizes = labelPrintFontSizes(label);
    for (const [index, size] of sizes.entries()) {
      if (index === 3) continue;
      expect(size).toBeLessThanOrEqual(12.5);
      expect(size).toBeGreaterThanOrEqual(8);
    }
    expect(sizes[1]).toBeLessThan(12.5);
    const measure = new jsPDF();
    measure.setFont("helvetica", "normal");
    measure.setFontSize(sizes[1]);
    expect(
      measure.splitTextToSize(label.origin, 126).length,
    ).toBeLessThanOrEqual(2);
  });

  it.each([false, true])(
    "genera una única página de 297 × 210 mm con QR y datos (programa %s)",
    (senaveProgram) => {
      const { data, pallet } = fixture();
      data.producers[0].metadata = {
        internal_code: "AGN-0001",
        export_code: "SENAVE-123",
      };
      pallet.metadata = {
        export_label: { senave_program: senaveProgram, afidi: "1571652" },
      };
      const pdf = createPalletLabelPdf(palletLabelData(data, pallet), assets);
      expect(pdf.getNumberOfPages()).toBe(1);
      expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(297, 1);
      expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(210, 1);
      expect(pdf.output("arraybuffer").byteLength).toBeGreaterThan(1000);
      const raw = pdf.output();
      const contents = pdfText(pdf);
      expect(contents).toContain("PAL-TEST-390");
      expect(contents).toContain("AGN-0001");
      expect(contents).toContain("SENAVE-123");
      expect(contents).toContain("390");
      expect(contents).toContain("1571652");
      expect(raw).toContain("/Subtype /Image");
      expect(contents.includes("Anastrepha grandis")).toBe(senaveProgram);
    },
  );

  it("imprime ambas referencias de Richar Llamosas con AFIDI, código AGN y QR en una página A4 horizontal", () => {
    const { data, pallet } = fixture();
    data.producers[0].name = "Richar Llamosas";
    data.producers[0].metadata = {
      internal_code: "AGN-0002",
      export_code: "REGISTRO-CONSERVADO",
      trap_reference_codes: ["SPE-LIB-001-SAN", "SPE-LIB-002-SAN"],
      harvest_reference: harvestReference(),
    };
    data.field_lots[0].harvest_date = null;
    pallet.metadata = { export_label: { afidi: "1571652" } };
    const label = palletLabelData(data, pallet);
    const sizes = labelPrintFontSizes(label);
    const measure = new jsPDF();
    measure.setFont("helvetica", "normal");
    measure.setFontSize(sizes[2]);
    expect(
      measure.splitTextToSize(label.producerCode, 126).length,
    ).toBeLessThanOrEqual(2);
    const pdf = createPalletLabelPdf(label, assets);
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(297, 1);
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(210, 1);
    const contents = pdfText(pdf);
    expect(contents).toContain("SPE-LIB-001-SAN");
    expect(contents).toContain("SPE-LIB-002-SAN");
    expect(contents).toContain("AGN-0002");
    expect(contents).toContain("1571652");
    expect(contents).toContain("29/09/2026");
    expect(pdf.output()).toContain("/Subtype /Image");
    expect(contents).not.toContain("Anastrepha grandis");
    expect(data.producers[0].metadata.export_code).toBe("REGISTRO-CONSERVADO");
  });

  it("solo permite la declaración SENAVE para destino Uruguay confirmado", () => {
    const { data, pallet } = fixture();
    const label = palletLabelData(data, pallet);
    label.senaveProgram = true;
    label.destination = "Argentina";
    expect(() => createPalletLabelPdf(label, assets)).toThrow(/Uruguay/);
    label.destination = "  uRuGuAy  ";
    expect(() => createPalletLabelPdf(label, assets)).not.toThrow();
  });

  it("impide un PDF que desborde la tabla por campos oficiales excesivamente largos", () => {
    const { data, pallet } = fixture();
    const label = palletLabelData(data, pallet);
    label.origin = "Origen demasiado largo ".repeat(200);
    expect(() => labelPrintFontSizes(label)).toThrow(/ORIGEN.*no cabe/);
    expect(() => createPalletLabelPdf(label, assets)).toThrow(
      /ORIGEN.*no cabe/,
    );
  });

  it("impide un PDF que desborde el encabezado por nombre o responsable excesivos", () => {
    const { data, pallet } = fixture();
    const label = palletLabelData(data, pallet);
    label.responsible = "Nombre demasiado largo ".repeat(100);
    expect(() => createPalletLabelPdf(label, assets)).toThrow(
      /Nombre o responsable demasiado largo/,
    );
  });

  it("impide desbordamiento de la trazabilidad con códigos de lote excesivos", () => {
    const { data, pallet } = fixture();
    const label = palletLabelData(data, pallet);
    label.lots = "LOT-EXCESIVELY-LONG-".repeat(100);
    expect(() => createPalletLabelPdf(label, assets)).toThrow(
      /datos de trazabilidad.*largos/,
    );
  });
});
