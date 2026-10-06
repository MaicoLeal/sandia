import { useState } from "react";
import { Pencil, XCircle } from "lucide-react";
import { Field, NumericInput } from "./components";
import { kg } from "./domain";
import {
  assertPalletCorrection,
  palletCorrectionSource,
  parsePalletCorrection,
} from "./pallet-corrections";
import type { PalletCorrectionValues } from "./pallet-corrections";
import type { Data, Pallet } from "./types";

export function PalletCorrection({
  data,
  pallet,
  busy,
  activated,
  blockedReason = "",
  onSubmit,
  onCancel,
  onRefresh,
  action,
}: {
  data: Data;
  pallet: Pallet;
  busy: boolean;
  activated: boolean;
  blockedReason?: string;
  onSubmit: (values: PalletCorrectionValues) => Promise<void>;
  onCancel: () => void;
  onRefresh?: () => Promise<void>;
  action: "edit" | "cancel";
}) {
  const [error, setError] = useState("");
  const [net, setNet] = useState(String(pallet.net_kg));
  const source = palletCorrectionSource(data, pallet);
  const submitDisabled = busy || !activated || !!blockedReason;
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitDisabled) return;
        setError("");
        const form = new FormData(event.currentTarget);
        const value = (name: string) => String(form.get(name) ?? "");
        try {
          let values: PalletCorrectionValues;
          if (action === "cancel") {
            values = { action, reason: value("reason").trim() };
            assertPalletCorrection(data, pallet, values);
          } else {
            values = parsePalletCorrection(data, pallet, {
              netKg: net,
              grossKg: value("gross"),
              fruitCount: value("fruits"),
              weighedDate: value("weighed_date"),
              responsible: value("responsible"),
              notes: value("notes"),
              reason: value("reason"),
            });
          }
          await onSubmit(values);
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "No se pudo guardar la corrección.",
          );
        }
      }}
    >
      <div className="weight-summary">
        <div>
          <small>Código del pallet · se conserva</small>
          <strong style={{ fontSize: "1rem", overflowWrap: "anywhere" }}>
            {pallet.code}
          </strong>
        </div>
        <div>
          <small>Peso neto actual</small>
          <strong>
            {kg(pallet.net_kg)} <span>kg</span>
          </strong>
        </div>
      </div>
      {!activated && (
        <>
          <p className="error" role="status">
            La función de edición y cancelación aún no está confirmada para esta
            cuenta. Si ya aplicó el SQL, sincronice para volver a verificar.
          </p>
          {onRefresh && (
            <button
              className="button full"
              type="button"
              disabled={busy}
              onClick={() => void onRefresh()}
            >
              Sincronizar y verificar acceso
            </button>
          )}
        </>
      )}
      {blockedReason && (
        <p className="error" role="status">
          {blockedReason}
        </p>
      )}
      {action === "cancel" ? (
        <p className="hint">
          Se quitará este pallet de la cantidad y del peso palletizado. El
          registro y su historial se conservarán; el peso volverá al saldo de su
          recepción. Para agregar pallets faltantes, use Crear pallet.
        </p>
      ) : (
        <>
          <p className="hint">
            Corrija los datos de este pallet. El total recibido del productor se
            corrige en Recepción. Si falta un pallet, use Crear pallet; si
            sobra, cancélelo.
          </p>
          {source.maxNetKg !== null ? (
            <p className="hint">
              Peso neto máximo de este pallet:{" "}
              <strong>{kg(source.maxNetKg)} kg</strong>, incluyendo su peso
              actual.
            </p>
          ) : (
            <p className="hint">{source.blockedReason}</p>
          )}
          <div className="form-grid">
            <Field label="Peso neto del pallet (kg) *">
              <NumericInput
                name="net"
                required
                value={net}
                readOnly={source.maxNetKg === null}
                onChange={(event) => setNet(event.target.value)}
                maxLength={15}
                aria-describedby="pallet-net-hint"
              />
            </Field>
            <Field label="Peso bruto (kg), si se conoce">
              <NumericInput
                name="gross"
                defaultValue={pallet.gross_kg ?? ""}
                maxLength={15}
              />
            </Field>
          </div>
          <p className="hint" id="pallet-net-hint">
            Use coma o punto para decimales. El bruto incluye la tara y debe ser
            igual o mayor al neto.
          </p>
          <div className="form-grid">
            <Field label="Cantidad de frutas, si se conoce">
              <NumericInput
                name="fruits"
                inputMode="numeric"
                defaultValue={pallet.fruit_count ?? ""}
                maxLength={10}
              />
            </Field>
            <Field label="Fecha de pesaje, si se conoce">
              <input
                type="date"
                name="weighed_date"
                defaultValue={pallet.weighed_date ?? ""}
              />
            </Field>
          </div>
          <Field label="Responsable *">
            <input
              name="responsible"
              required
              maxLength={200}
              defaultValue={pallet.responsible}
            />
          </Field>
          <Field label="Observaciones">
            <textarea
              name="notes"
              maxLength={5000}
              defaultValue={pallet.notes}
            />
          </Field>
        </>
      )}
      <Field
        label={
          action === "cancel"
            ? "Motivo de la cancelación *"
            : "Motivo de la corrección *"
        }
      >
        <textarea
          name="reason"
          required
          maxLength={1000}
          placeholder={
            action === "cancel"
              ? "Ej.: pallet registrado dos veces"
              : "Ej.: corregir peso digitado por error"
          }
        />
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button primary full"
        type="submit"
        disabled={submitDisabled}
      >
        {action === "cancel" ? <XCircle size={18} /> : <Pencil size={18} />}
        {busy
          ? "Guardando…"
          : action === "cancel"
            ? "Cancelar pallet"
            : "Guardar corrección"}
      </button>
      <button
        className="button full"
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={{ marginTop: 12 }}
      >
        Volver a pallets
      </button>
    </form>
  );
}
