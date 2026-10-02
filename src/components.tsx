import { cloneElement, useEffect, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { X, Printer, Download, CheckCircle2, Leaf } from "lucide-react";
import QRCode from "qrcode";
import type { Data, Pallet } from "./types";
import { dateLabel, kg, origin } from "./domain";
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
}: {
  pallet: Pallet;
  data: Data;
  onPrinted: () => Promise<void>;
}) {
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const item = data.pallet_items.find((x) => x.pallet_id === pallet.id);
  const o = origin(data, item?.reception_id ?? "");
  const publicBase =
    import.meta.env.VITE_PUBLIC_TRACE_URL ||
    window.location.origin + window.location.pathname;
  const link = publicBase + "?trace=" + encodeURIComponent(pallet.token);
  useEffect(() => {
    QRCode.toDataURL(link, { width: 250, margin: 2, errorCorrectionLevel: "M" })
      .then(setQr)
      .catch(() => setError("No se pudo generar el QR."));
  }, [link]);
  const print = async () => {
    try {
      await onPrinted();
      window.print();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo registrar la impresión.",
      );
    }
  };
  return (
    <>
      <div className="print-label">
        <Brand />
        <h2>Sandía</h2>
        <p className="label-code">{pallet.code}</p>
        <div className="label-details">
          <p>
            <span>Lote</span>
            <strong>{o.lot?.code}</strong>
          </p>
          <p>
            <span>Productor</span>
            <strong>{o.producer?.name}</strong>
          </p>
          <p>
            <span>Parcela / localidad</span>
            <strong>
              {o.plot?.name || o.producer?.community || "Pendiente de informar"}
            </strong>
          </p>
          <p>
            <span>Recepción</span>
            <strong>{o.reception && dateLabel(o.reception.date)}</strong>
          </p>
          <p>
            <span>Peso neto / bruto</span>
            <strong>
              {kg(pallet.net_kg)} kg /{" "}
              {pallet.gross_kg === null
                ? "Sin informar"
                : kg(pallet.gross_kg) + " kg"}
            </strong>
          </p>
          <p>
            <span>Destino</span>
            <strong>{pallet.destination}</strong>
          </p>
          <p>
            <span>Responsable</span>
            <strong>{pallet.responsible}</strong>
          </p>
        </div>
        {qr && (
          <img
            width="180"
            height="180"
            src={qr}
            alt="QR de trazabilidad del pallet"
          />
        )}
        <small>Cooperativa Agronorte · Trazabilidad por pallet</small>
      </div>
      <p className="hint no-print">
        El QR abre la identificación, peso, destino y estado del pallet. Para
        consultar productor, lote y origen completo, inicie sesión con una
        cuenta de la cooperativa.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="row no-print">
        <button
          className="button primary"
          onClick={() => void print()}
          disabled={!qr}
        >
          <Printer size={18} />
          Imprimir / PDF
        </button>
        {qr && (
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
