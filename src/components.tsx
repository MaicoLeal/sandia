import { cloneElement, useEffect, useId, useState } from "react";
import type {
  ReactElement,
  ReactNode,
  ComponentProps,
  CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import { X, Printer, Download, CheckCircle2, Leaf, Pencil } from "lucide-react";
import QRCode from "qrcode";
import type { Data, Pallet } from "./types";
import {
  palletLabelData,
  palletLabelDeclaration,
  palletLabelImporterRows,
  palletLabelProducerIdentity,
  palletLabelRows,
} from "./services/pallet-label-data";
export function Brand() {
  return (
    <div className="brand">
      <img
        src={import.meta.env.BASE_URL + "agronorte-logo.png"}
        alt="Cooperativa Agronorte"
        width="180"
        height="101"
      />
    </div>
  );
}
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}
export function NumericInput(props: ComponentProps<"input">) {
  return (
    <input
      {...props}
      type={props.type ?? "text"}
      inputMode={props.inputMode ?? "decimal"}
      autoComplete="off"
      enterKeyHint={props.enterKeyHint ?? "done"}
      onFocus={(event) => {
        event.currentTarget.select();
        props.onFocus?.(event);
      }}
    />
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Leaf />
      <p>{children}</p>
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = document.querySelector<HTMLDialogElement>("dialog");
    el?.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el?.addEventListener("cancel", onCancel);
    return () => {
      el?.removeEventListener("cancel", onCancel);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <dialog className="modal" aria-label={title}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Cerrar" onClick={onClose}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Submit({
  children = "Guardar",
  disabled = false,
}: {
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button className="button primary full" disabled={disabled} type="submit">
      <CheckCircle2 size={18} />
      {children}
    </button>
  );
}
export function Label({
  pallet,
  data,
  onPrinted,
  pending = false,
  busy = false,
  online = true,
  syncError = "",
  onSync,
  onEditExport,
  editActivationPending = false,
}: {
  pallet: Pallet;
  data: Data;
  onPrinted: () => Promise<void>;
  pending?: boolean;
  busy?: boolean;
  online?: boolean;
  syncError?: string;
  onSync?: () => Promise<void>;
  onEditExport?: () => void;
  editActivationPending?: boolean;
}) {
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [printSizes, setPrintSizes] = useState<number[]>([]);
  const cancelled = pallet.status === "Cancelado";
  const label = palletLabelData(data, pallet);
  const importerRows = palletLabelImporterRows(label);
  const publicBase =
    import.meta.env.VITE_PUBLIC_TRACE_URL ||
    window.location.origin + window.location.pathname;
  const link = publicBase + "?trace=" + encodeURIComponent(pallet.token);
  useEffect(() => {
    let active = true;
    setQr("");
    QRCode.toDataURL(link, { width: 800, margin: 4, errorCorrectionLevel: "M" })
      .then((value) => {
        if (active) setQr(value);
      })
      .catch(() => {
        if (active) setError("No se pudo generar el QR.");
      });
    return () => {
      active = false;
    };
  }, [link]);
  const print = async () => {
    setError("");
    setPreparingPdf(true);
    try {
      if (cancelled)
        throw new Error("No se puede imprimir un pallet cancelado.");
      const { createPalletLabelPdf, loadLabelLogo, labelPrintFontSizes } =
        await import("./services/pallet-label-pdf");
      createPalletLabelPdf(label, { logo: await loadLabelLogo(), qr });
      const sizes = labelPrintFontSizes(label);
      await onPrinted();
      flushSync(() => setPrintSizes(sizes));
      window.print();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo registrar la impresión.",
      );
    } finally {
      setPreparingPdf(false);
    }
  };
  const downloadPdf = async () => {
    setError("");
    setPreparingPdf(true);
    try {
      if (cancelled)
        throw new Error(
          "No se puede descargar la etiqueta de un pallet cancelado.",
        );
      const { createPalletLabelPdf, loadLabelLogo } =
        await import("./services/pallet-label-pdf");
      const logo = await loadLabelLogo();
      const pdf = createPalletLabelPdf(label, { logo, qr });
      await onPrinted();
      pdf.save(pallet.code + "-A4.pdf");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo descargar la etiqueta.",
      );
    } finally {
      setPreparingPdf(false);
    }
  };
  return (
    <>
      <div className="row between no-print label-format-note">
        <p className="hint">
          A4 horizontal · 297 × 210 mm · Una etiqueta por hoja
        </p>
        {onEditExport && (
          <button
            className="button primary label-edit-button"
            disabled={busy || preparingPdf}
            onClick={onEditExport}
          >
            <Pencil size={18} />
            Editar etiqueta
          </button>
        )}
      </div>
      {onEditExport && editActivationPending && (
        <p className="hint no-print">
          Puede consultar los campos pendientes. Para guardar, el administrador
          debe activar la actualización de etiquetas en Supabase.
        </p>
      )}
      <div className="print-label export-label">
        <header className="export-label-head">
          <div className="export-label-brand-row">
            <img
              className="export-label-logo"
              src={import.meta.env.BASE_URL + "agronorte-logo.png"}
              alt="Cooperativa Agronorte"
            />
            {importerRows.length > 0 && (
              <section
                className="export-label-importer"
                aria-label="Importador"
              >
                {importerRows.map((row) => (
                  <div
                    key={row.title}
                    className={row.name ? "export-label-importer-name" : ""}
                  >
                    <strong>{row.title}</strong>
                    <p>{row.value}</p>
                  </div>
                ))}
              </section>
            )}
          </div>
          <div className="export-label-context">
            <span>{palletLabelProducerIdentity(label)}</span>
          </div>
        </header>
        <div className="export-label-main">
          <table className="export-label-fields">
            <tbody>
              {palletLabelRows(label).map((row, index) => (
                <tr key={row.title}>
                  <th scope="row">{row.title}</th>
                  <td
                    style={
                      printSizes[index]
                        ? ({
                            "--label-print-size": `${printSizes[index]}pt`,
                          } as CSSProperties)
                        : undefined
                    }
                    className={
                      row.title === "PESO NETO (kg)"
                        ? "export-label-weight"
                        : ""
                    }
                  >
                    {row.scientific ? (
                      <>
                        <em>Citrullus lanatus</em> (sandía)
                      </>
                    ) : (
                      row.value
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <aside className="export-label-trace">
            <strong className="export-label-qr-title">TRAZABILIDAD</strong>
            {qr && (
              <img
                className="export-label-qr"
                width="180"
                height="180"
                src={qr}
                alt="QR de trazabilidad del pallet"
              />
            )}
            <strong className="export-label-code">{label.code}</strong>
            <dl>
              <dt>Lote</dt>
              <dd>{label.lots}</dd>
              <dt>Recepción</dt>
              <dd>{label.reception}</dd>
              <dt>Destino</dt>
              <dd>{label.destination}</dd>
            </dl>
          </aside>
        </div>
        <footer className="export-label-declaration">
          <p>{palletLabelDeclaration(label)}</p>
          <strong>
            {label.senaveProgram && (
              <>
                <em>Anastrepha grandis.</em>{" "}
              </>
            )}
            LOTE N°: {label.lots}
          </strong>
        </footer>
      </div>
      <p className="hint no-print">
        El QR abre la identificación, peso, destino y estado del pallet. Para
        consultar productor, lote y origen completo, inicie sesión con una
        cuenta de la cooperativa.
      </p>
      {pending && (
        <div className="setting-info no-print" role="status">
          <div>
            <strong>
              {busy ? "Sincronizando…" : "Etiqueta pendiente de sincronizar"}
            </strong>
            <p>
              {online
                ? "Confirme los datos en Supabase antes de imprimir o descargar el QR."
                : "Conecte el celular a internet. Sus datos siguen guardados en este dispositivo."}
            </p>
            {onSync && (
              <button
                className="button secondary"
                disabled={busy || !online}
                onClick={() => void onSync()}
              >
                Sincronizar
              </button>
            )}
            {syncError && (
              <p className="error" role="alert">
                {syncError}
              </p>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="row no-print">
        <button
          className="button primary"
          onClick={() => void print()}
          disabled={!qr || cancelled || pending || busy || preparingPdf}
        >
          <Printer size={18} />
          Imprimir A4
        </button>
        <button
          className="button secondary"
          disabled={!qr || cancelled || pending || busy || preparingPdf}
          onClick={() => void downloadPdf()}
        >
          <Download size={18} />
          {preparingPdf ? "Preparando PDF…" : "Descargar PDF A4"}
        </button>
        {qr && !cancelled && !pending && !busy && !preparingPdf && (
          <a
            className="button secondary"
            download={pallet.code + "-qr.png"}
            href={qr}
          >
            <Download size={18} />
            Descargar QR
          </a>
        )}
      </div>
    </>
  );
}
