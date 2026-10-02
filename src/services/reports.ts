import type { Data } from "../types";
import { dateLabel, kg, origin, receptionTotal } from "../domain";
export function exportCsv(
  rows: Record<string, string | number>[],
  name: string,
) {
  if (!rows.length) throw new Error("No hay registros para exportar.");
  const keys = Object.keys(rows[0]);
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return (
      '"' +
      (/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""') +
      '"'
    );
  };
  const content =
    "\uFEFF" +
    [
      keys.map(cell).join(";"),
      ...rows.map((row) => keys.map((k) => cell(row[k])).join(";")),
    ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function receptionRows(data: Data) {
  return data.receptions.map((r) => {
    const o = origin(data, r.id);
    return {
      Fecha: dateLabel(r.date),
      Productor: o.producer?.name ?? "",
      Parcela: o.plot?.name ?? "",
      Lote: o.lot?.code ?? "",
      Kg: receptionTotal(data, r.id),
      Responsable: r.responsible,
      Estado: r.status,
    };
  });
}
export function printReport(
  title: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Permita ventanas emergentes para imprimir.");
  const esc = (v: unknown) =>
    String(v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  win.document.write(
    `<html lang="es"><head><title>${esc(title)}</title><style>body{font:14px Arial;padding:24px;color:#183414}h1{font-size:24px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:9px;text-align:left}@page{margin:15mm}</style></head><body><h1>Cooperativa Agronorte</h1><h2>${esc(title)}</h2><p>${esc(dateLabel(new Date().toISOString()))} · Peso en kg</p><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${esc(typeof c === "number" ? kg(c) : c)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`,
  );
  win.document.close();
  win.focus();
  win.print();
}
