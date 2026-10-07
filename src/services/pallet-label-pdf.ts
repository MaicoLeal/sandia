import { jsPDF } from "jspdf";
import {
  palletLabelDeclaration,
  palletLabelProducerIdentity,
  palletLabelRows,
} from "./pallet-label-data";
import type { PalletLabelData } from "./pallet-label-data";

export function labelPrintFontSizes(label: PalletLabelData) {
  const measure = new jsPDF();
  return palletLabelRows(label).map((row, index) => {
    measure.setFont("helvetica", row.scientific ? "italic" : "normal");
    let size = index === 3 ? 23 : 12.5;
    measure.setFontSize(size);
    while (
      (measure.splitTextToSize(row.value, 126) as string[]).length > 2 &&
      size > 8
    )
      measure.setFontSize((size -= 0.5));
    if ((measure.splitTextToSize(row.value, 126) as string[]).length > 2)
      throw new Error(
        `El campo ${row.title} no cabe en la etiqueta A4. Revise su longitud.`,
      );
    return size;
  });
}

export function createPalletLabelPdf(
  label: PalletLabelData,
  assets: { logo: string; qr: string },
) {
  if (
    label.senaveProgram &&
    label.destination.trim().toLocaleLowerCase("es") !== "uruguay"
  )
    throw new Error(
      "El programa SENAVE para Uruguay requiere destino Uruguay. Revise el pallet.",
    );
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  pdf.setProperties({
    title: `Agronorte - ${label.code}`,
    subject: "Etiqueta de pallet A4 horizontal",
    author: "Cooperativa Agronorte",
  });
  pdf.setDrawColor(0, 111, 50);
  pdf.setLineWidth(1.2);
  pdf.roundedRect(8, 8, 281, 194, 3, 3);
  pdf.saveGraphicsState();
  pdf.rect(78.5, 13, 140, 47, null);
  pdf.clip();
  pdf.discardPath();
  pdf.addImage(assets.logo, "PNG", 78.5, -2.875, 140, 78.75);
  pdf.restoreGraphicsState();
  pdf.setTextColor(20, 30, 20);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  const headerText = palletLabelProducerIdentity(label);
  const headerLines = pdf.splitTextToSize(headerText, 264) as string[];
  if (headerLines.length > 2)
    throw new Error(
      "Nombre o responsable demasiado largo para la etiqueta. Revise los datos.",
    );
  pdf.text(headerLines, 16, 66, { lineHeightFactor: 1.1 });

  const rows = palletLabelRows(label);
  const rowY = 75,
    rowHeight = 13,
    tableX = 13,
    tableWidth = 216,
    titleWidth = 79;
  for (const [index, row] of rows.entries()) {
    const y = rowY + index * rowHeight;
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.5);
    pdf.setFillColor(0, 111, 50);
    pdf.rect(tableX, y, titleWidth, rowHeight, "FD");
    pdf.rect(tableX + titleWidth, y, tableWidth - titleWidth, rowHeight, "S");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(row.title, tableX + 3, y + 8);
    pdf.setTextColor(0, 0, 0);
    pdf.setFont("helvetica", row.scientific ? "italic" : "normal");
    let size = index === 3 ? 23 : 16;
    pdf.setFontSize(size);
    let lines = pdf.splitTextToSize(
      row.value,
      tableWidth - titleWidth - 7,
    ) as string[];
    while (lines.length > 2 && size > 8) {
      pdf.setFontSize(--size);
      lines = pdf.splitTextToSize(
        row.value,
        tableWidth - titleWidth - 7,
      ) as string[];
    }
    if (lines.length > 2)
      throw new Error(
        `El campo ${row.title} no cabe en la etiqueta A4. Revise su longitud.`,
      );
    const lineHeight = size * 0.352778 * 1.1;
    pdf.text(
      lines,
      tableX + titleWidth + 4,
      y + (rowHeight - lineHeight * lines.length) / 2 + size * 0.352778 * 0.82,
      { lineHeightFactor: 1.1 },
    );
  }
  pdf.setDrawColor(0, 111, 50);
  pdf.setLineWidth(0.5);
  pdf.rect(233, 75, 51, 91);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(0, 80, 35);
  pdf.text("TRAZABILIDAD", 258.5, 81, { align: "center" });
  pdf.addImage(assets.qr, "PNG", 237.5, 84, 42, 42);
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(8.5);
  const codeLines = pdf.splitTextToSize(label.code, 43) as string[];
  pdf.text(codeLines, 258.5, 130, { align: "center", lineHeightFactor: 1.05 });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  const traceLines = pdf.splitTextToSize(
    `Lote: ${label.lots}\nRecepción: ${label.reception}\nDestino: ${label.destination}`,
    43,
  ) as string[];
  if (codeLines.length > 3 || traceLines.length > 7)
    throw new Error(
      "Los datos de trazabilidad son demasiado largos para la etiqueta. Revise los datos.",
    );
  pdf.text(traceLines, 237, 142, { lineHeightFactor: 1.1 });

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.5);
  pdf.rect(13, 170, 271, 27);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  const declaration = pdf.splitTextToSize(
    palletLabelDeclaration(label),
    261,
  ) as string[];
  if (declaration.length > 3)
    throw new Error("La declaración no cabe en una hoja A4. Revise los datos.");
  pdf.text(declaration, 148.5, 176, { align: "center", lineHeightFactor: 1.1 });
  const lastY = 176 + declaration.length * 13 * 0.352778 * 1.1;
  pdf.setFont("helvetica", label.senaveProgram ? "bolditalic" : "bold");
  pdf.setFontSize(12);
  const lotLine = `${label.senaveProgram ? "Anastrepha grandis.  " : ""}LOTE N.º: ${label.lots}`;
  if (pdf.getTextWidth(lotLine) > 261)
    throw new Error(
      "Los códigos de lote no caben en la etiqueta. Revise los datos.",
    );
  pdf.text(lotLine, 148.5, lastY, { align: "center" });
  return pdf;
}

export async function loadLabelLogo(): Promise<string> {
  const response = await fetch(import.meta.env.BASE_URL + "agronorte-logo.png");
  if (!response.ok)
    throw new Error("No se pudo cargar el logotipo para el PDF.");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("No se pudo preparar el logotipo."));
    reader.readAsDataURL(blob);
  });
}
