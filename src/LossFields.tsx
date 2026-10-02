import { useState } from "react";
import type { Data } from "./types";
import {
  origin,
  receptionTotal,
  intakeSelection,
  kg,
  lossReasons,
} from "./domain";
import { Empty, Field, NumericInput } from "./components";

export function LossFields({
  data,
  receptionId,
  producerId,
}: {
  data: Data;
  receptionId: string | null;
  producerId: string | null;
}) {
  const eligible = data.receptions.filter(
    (r) =>
      r.status !== "Cancelado" &&
      (!producerId || origin(data, r.id).producer?.id === producerId) &&
      !data.classifications.some(
        (c) => c.reception_id === r.id && c.status !== "Cancelado",
      ),
  );
  const [id, setId] = useState(
    receptionId && eligible.some((r) => r.id === receptionId)
      ? receptionId
      : eligible.length === 1
        ? eligible[0].id
        : "",
  );
  const [rejected, setRejected] = useState("0");
  const [reason, setReason] = useState("");
  const source = origin(data, id);
  const total = receptionTotal(data, id);
  let approved = total;
  let error = "";
  try {
    approved = intakeSelection(total, rejected, reason).approved;
  } catch (e) {
    error = (e as Error).message;
  }
  if (!eligible.length)
    return (
      <Empty>
        No hay recepciones pendientes de selección para este productor. Las
        pérdidas ya registradas aparecen en su historial. Registre la próxima
        entrega en Nueva recepción.
      </Empty>
    );
  return (
    <>
      <Field label="Productor / recepción *">
        <select
          name="reception"
          required
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setRejected("0");
            setReason("");
          }}
        >
          <option value="">Seleccione la entrega</option>
          {eligible.map((r) => (
            <option value={r.id} key={r.id}>
              {origin(data, r.id).producer?.name} ·{" "}
              {origin(data, r.id).lot?.code} · {kg(receptionTotal(data, r.id))}{" "}
              kg
            </option>
          ))}
        </select>
      </Field>
      <div className="weight-summary">
        <div>
          <small>Total recibido</small>
          <strong>
            {kg(total)} <span>kg</span>
          </strong>
        </div>
        <div>
          <small>Aprobado automático</small>
          <strong>
            {error ? "—" : kg(approved)} <span>kg</span>
          </strong>
        </div>
      </div>
      <input type="hidden" name="approved" value={error ? "" : approved} />
      <Field label="Pérdidas (kg) *">
        <NumericInput
          name="rejected"
          required
          value={rejected}
          onChange={(e) => setRejected(e.target.value)}
          placeholder="0,00"
        />
      </Field>
      <Field label="Motivo de la pérdida">
        <select
          name="reason"
          required={Number(rejected.replace(",", ".")) > 0}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="">Sin pérdidas / seleccione</option>
          {lossReasons.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </Field>
      {error && (
        <p className="hint" role="status">
          {error}
        </p>
      )}
      <details className="loss-details" key={id}>
        <summary>Región y observaciones de campo (opcional)</summary>
        <Field label="Región / comunidad">
          <input
            name="region"
            defaultValue={
              source.plot?.location || source.producer?.community || ""
            }
            placeholder="Comunidad de origen de la carga"
            maxLength={160}
          />
        </Field>
        <Field label="Posible plaga observada">
          <input
            name="pest_observation"
            placeholder="Nombre, si se conoce"
            maxLength={200}
          />
        </Field>
        <Field label="Señales observadas">
          <textarea
            name="symptoms"
            placeholder="Daño, manchas, insectos u otros signos"
            maxLength={2000}
          />
        </Field>
        <p className="hint">
          Una observación orienta la revisión del técnico; no confirma una
          plaga. Puede adjuntar fotos desde el detalle de la recepción.
        </p>
        <div className="form-grid">
          <Field label="Frutas aprobadas">
            <NumericInput
              name="approved_count"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
            />
          </Field>
          <Field label="Frutas perdidas">
            <NumericInput
              name="rejected_count"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
            />
          </Field>
        </div>
        <Field label="Calibre / tamaño">
          <input name="size" />
        </Field>
        <Field label="Calidad visual">
          <select name="quality" defaultValue="">
            <option value="">Sin evaluar</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} / 5
              </option>
            ))}
          </select>
        </Field>
        <Field label="Observaciones">
          <textarea name="notes" />
        </Field>
      </details>
    </>
  );
}
