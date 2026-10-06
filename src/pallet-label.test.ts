import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { beforeAll, describe, expect, it } from "vitest";
import { base, receptionTotal } from "./domain";
import { seed } from "./test-fixtures";
import type { Pallet } from "./types";
import {
  palletLabelData,
  palletLabelEditValues,
  palletLabelDeclaration,
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
    expect(label.producerCode).toBe("No informado");
    expect(label.origin).toBe("No informado");
    expect(label.afidi).toBe("No informado");
    expect(label.harvest).toBe("No informada");
    expect(label.packaged).toBe("No informada");
    expect(label.reception).toBe("01/10/2026");
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
      title: "N.º DE AFIDI",
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
      export_code: "CODE-1",
      export_origin: "San Pedro",
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
      metadata: { export_code: "CODE-2", export_origin: "Caaguazú" },
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
    expect(label.producerCode).toBe("CODE-1 / CODE-2");
    expect(label.origin).toBe("San Pedro / Caaguazú");
    expect(label.lots).toBe("SAN-20261001-DEMO01 / LOT-2");
    expect(label.harvest).toBe("01/10/2026 / 03/10/2026");
    expect(label.reception).toBe("01/10/2026 / 04/10/2026");
    expect(label.netKg).toBe(390);
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
      pallet.metadata = {
        export_label: { senave_program: senaveProgram, afidi: "1571652" },
      };
      const pdf = createPalletLabelPdf(palletLabelData(data, pallet), assets);
      expect(pdf.getNumberOfPages()).toBe(1);
      expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(297, 1);
      expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(210, 1);
      expect(pdf.output("arraybuffer").byteLength).toBeGreaterThan(1000);
      const raw = pdf.output();
      const contents = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
        .map((match) => {
          try {
            return inflateSync(Buffer.from(match[1], "latin1")).toString(
              "latin1",
            );
          } catch {
            return match[1];
          }
        })
        .join("\n");
      expect(contents).toContain("PAL-TEST-390");
      expect(contents).toContain("390");
      expect(contents).toContain("1571652");
      expect(raw).toContain("/Subtype /Image");
      expect(contents.includes("Anastrepha grandis")).toBe(senaveProgram);
    },
  );

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
