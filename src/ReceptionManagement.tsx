import { useState } from "react";
import { Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { Field, NumericInput } from "./components";
import { kg, lossReasons, origin, receptionTotal, round } from "./domain";
import {
  assertReceptionManagement,
  parseReceptionManagement,
  receptionManagementImpact,
} from "./reception-management";
import type { ReceptionManagementValues } from "./reception-management";
import type { Data, Reception } from "./types";

export function ReceptionManagement({
  data,
  reception,
  action,
  busy,
  activated,
  blockedReason = "",
  onSubmit,
  onCancel,
  onRefresh,
}: {
  data: Data;
  reception: Reception;
  action: "edit" | "cancel";
  busy: boolean;
  activated: boolean;
  blockedReason?: string;
  onSubmit: (values: ReceptionManagementValues) => Promise<void>;
  onCancel: () => void;
  onRefresh?: () => Promise<void>;
}) {
  const impact = receptionManagementImpact(data, reception);
  const classification = impact.classifications[0];
  const source = origin(data, reception.id);
  const [weights, setWeights] = useState(() =>
    impact.activeWeights.map((weight) => ({
      id: weight.id,
      kg: String(weight.kg),
      operator: weight.operator,
      notes: weight.notes,
    })),
  );
  const [rejected, setRejected] = useState(
    String(classification?.rejected_kg ?? 0),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const actualBlocked =
    blockedReason ||
    (action === "cancel"
      ? impact.cancelBlockedReason
      : impact.editBlockedReason);
  const disabled = busy || !activated || !!actualBlocked;
  const validWeights = weights.every(
    (weight) =>
      /^\d+(?:[.,]\d{1,2})?$/.test(weight.kg.trim()) &&
      Number(weight.kg.replace(",", ".")) > 0,
  );
  const total = validWeights
    ? round(
        weights.reduce(
          (sum, weight) => sum + Number(weight.kg.replace(",", ".")),
          0,
        ),
      )
    : null;
  const rejectedNumber = /^\d+(?:[.,]\d{1,2})?$/.test(rejected.trim())
    ? Number(rejected.replace(",", "."))
    : null;
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled) return;
        setError("");
        const form = new FormData(event.currentTarget);
        const value = (name: string) => String(form.get(name) ?? "");
        try {
          const values: ReceptionManagementValues =
            action === "cancel"
              ? {
                  action,
                  reason: value("reason").trim(),
                  confirmPallets: confirmed,
                }
              : parseReceptionManagement(data, reception, {
                  date: value("date"),
                  responsible: value("responsible"),
                  notes: value("notes"),
                  weights,
                  rejectedKg: rejected,
                  lossReason: value("loss_reason"),
                  reason: value("reason"),
                });
          assertReceptionManagement(data, reception, values);
          await onSubmit(values);
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "No se pudo guardar la recepción.",
          );
        }
      }}
    >
      <div className="weight-summary">
        <div>
          <small>Productor · lote</small>
          <strong style={{ fontSize: "1rem", overflowWrap: "anywhere" }}>
            {source.producer?.name ?? "Productor pendiente"}
          </strong>
          <small>{source.lot?.code}</small>
        </div>
        <div>
          <small>Recibido actualmente</small>
          <strong>
            {kg(receptionTotal(data, reception.id))} <span>kg</span>
          </strong>
        </div>
      </div>
      {!activated && (
        <>
          <p className="error" role="status">
            La edición de pesajes y cancelación completa aún no está confirmada
            para esta cuenta. Si ya aplicó el SQL, sincronice para verificar.
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
      {actualBlocked && (
        <p className="error" role="status">
          {actualBlocked}
        </p>
      )}
      {action === "cancel" ? (
        <>
          <p className="hint">
            La recepción dejará de contar en los kg entregados del productor.
            Los pesajes y la selección se conservan como registros cancelados;
            las fotos y el historial permanecen disponibles.
          </p>
          {impact.pallets.length > 0 && (
            <>
              <h3>Pallets que también se cancelarán</h3>
              <p className="hint">
                {impact.pallets.length} pallets · {kg(impact.allocatedKg)} kg.
                Sus etiquetas dejarán de ser válidas para carga.
              </p>
              <div className="weight-table">
                {impact.pallets.map((pallet) => (
                  <div className="weight-row" key={pallet.id}>
                    <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>
                      {pallet.code}
                    </span>
                    <strong>{kg(pallet.net_kg)} kg</strong>
                  </div>
                ))}
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={busy}
                />
                Confirmo cancelar esta recepción y los {impact.pallets.length}{" "}
                pallets listados.
              </label>
            </>
          )}
        </>
      ) : (
        <>
          <p className="hint">
            Registre el peso de las sandías: ya es neto, sin el embalaje de 42
            kg. No se descuenta la tara nuevamente.
          </p>
          <div className="form-grid">
            <Field label="Fecha de recepción *">
              <input
                type="date"
                name="date"
                required
                defaultValue={reception.date}
              />
            </Field>
            <Field label="Responsable *">
              <input
                name="responsible"
                required
                maxLength={200}
                defaultValue={reception.responsible}
              />
            </Field>
          </div>
          <h3>Pesajes recibidos</h3>
          <p className="hint">
            Corrija el valor, quite un pesaje duplicado o agregue uno faltante.
            Quitar conserva el peso anterior en el historial.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {weights.map((weight, index) => (
              <div
                key={weight.id}
                className="row"
                style={{ alignItems: "end", flexWrap: "nowrap" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field label={`Pesaje ${index + 1} (kg) *`}>
                    <NumericInput
                      required
                      value={weight.kg}
                      maxLength={15}
                      disabled={busy}
                      onChange={(event) =>
                        setWeights((current) =>
                          current.map((row) =>
                            row.id === weight.id
                              ? { ...row, kg: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  style={{ marginBottom: 14, minHeight: 48 }}
                  disabled={busy}
                  aria-label={`Quitar pesaje ${index + 1}`}
                  onClick={() =>
                    setWeights((current) =>
                      current.filter((row) => row.id !== weight.id),
                    )
                  }
                >
                  <Trash2 size={18} />
                  <span>Quitar</span>
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="button secondary full"
            disabled={busy || weights.length >= 1000}
            onClick={() =>
              setWeights((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  kg: "",
                  operator: reception.responsible,
                  notes: "",
                },
              ])
            }
          >
            <Plus size={18} />
            Agregar pesaje
          </button>
          <div className="weight-summary" aria-live="polite">
            <div>
              <small>Total corregido</small>
              <strong>
                {total === null ? "Revise los pesos" : `${kg(total)} kg`}
              </strong>
            </div>
            <div>
              <small>Pesajes activos</small>
              <strong>{weights.length}</strong>
            </div>
          </div>
          {classification && (
            <>
              <h3>Pérdidas de esta recepción</h3>
              <Field label="Pérdida registrada (kg) *">
                <NumericInput
                  required
                  value={rejected}
                  maxLength={15}
                  onChange={(event) => setRejected(event.target.value)}
                />
              </Field>
              <Field label="Motivo de pérdida">
                <select name="loss_reason" defaultValue={classification.reason}>
                  <option value="">Sin pérdida</option>
                  {[
                    ...new Set([
                      ...lossReasons,
                      ...(classification.reason ? [classification.reason] : []),
                    ]),
                  ].map((reason) => (
                    <option key={reason}>{reason}</option>
                  ))}
                </select>
              </Field>
              <p className="hint">
                Aprobado:{" "}
                {total !== null &&
                rejectedNumber !== null &&
                rejectedNumber <= total
                  ? `${kg(round(total - rejectedNumber))} kg`
                  : "revise los pesos y pérdidas"}
                . El sistema recalcula la selección y conserva sus demás datos.
              </p>
            </>
          )}
          {impact.pallets.length > 0 && (
            <p className="hint">
              Ya hay {impact.pallets.length} pallets con{" "}
              {kg(impact.allocatedKg)} kg asignados. El aprobado debe cubrir ese
              peso; para reducirlo, corrija o cancele primero los pallets
              correspondientes.
            </p>
          )}
          <Field label="Observaciones">
            <textarea
              name="notes"
              defaultValue={reception.notes}
              maxLength={5000}
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
              ? "Ej.: recepción registrada dos veces"
              : "Ej.: corregir un peso digitado por error"
          }
        />
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary full" type="submit" disabled={disabled}>
        {action === "cancel" ? <XCircle size={18} /> : <Pencil size={18} />}
        {busy
          ? "Guardando…"
          : action === "cancel"
            ? "Cancelar recepción con historial"
            : "Guardar recepción corregida"}
      </button>
      <button
        className="button full"
        type="button"
        disabled={busy}
        onClick={onCancel}
        style={{ marginTop: 12 }}
      >
        Volver a la recepción
      </button>
    </form>
  );
}
