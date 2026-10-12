import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Plus, X } from "lucide-react";
import type { Data } from "./types";
import { Field, NumericInput, Submit } from "./components";
import {
  intakeSelection,
  lossReasons,
  dateLabel,
  kg,
  origin,
  parseKg,
  producerIdentity,
  receptionTotal,
  round,
  summary,
} from "./domain";
import {
  getFile,
  readDraft,
  readDraftEntries,
  saveDraft,
  saveFile,
} from "./services/storage";
import { validateReceptionOrigin } from "./reception-creation";
import type { ReceptionCreationValues as ReceptionValues } from "./reception-creation";
import {
  freshReceptionValues,
  hasReceptionDraft,
  restoreReceptionDraft,
  changeReceptionProducer,
} from "./reception-draft";
import type { ReceptionDraft } from "./reception-draft";

type DraftPhoto = ReceptionValues["photos"][number];
const reasons = lossReasons;
export function ReceptionForm({
  data,
  organizationId,
  busy,
  draftKey,
  actor,
  allowSelection,
  initialProducerId,
  resumeDraft = false,
  onSave,
  onQuickCreate,
}: {
  data: Data;
  organizationId: string;
  busy: boolean;
  draftKey: string;
  actor: string;
  allowSelection: boolean;
  initialProducerId: string;
  resumeDraft?: boolean;
  onSave: (values: ReceptionValues) => Promise<void>;
  onQuickCreate: (type: "producer" | "plot") => void;
}) {
  const defaults = useRef(
    freshReceptionValues(initialProducerId, actor, allowSelection),
  );
  const [values, setValues] = useState<ReceptionValues>(() => defaults.current);
  const weightRef = useRef<HTMLInputElement>(null);
  const [weight, setWeight] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [draftChoice, setDraftChoice] = useState<ReceptionDraft | null>(null);
  const [archivedDrafts, setArchivedDrafts] = useState<
    { key: string; value: ReceptionDraft }[]
  >([]);
  const [choosingDraft, setChoosingDraft] = useState(false);
  const [lotMode, setLotMode] = useState<"new" | "existing">("new");
  const [draftStatus, setDraftStatus] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      readDraft<ReceptionDraft>(draftKey),
      readDraftEntries<ReceptionDraft>(`${draftKey}:archive:`),
    ])
      .then(([draft, archives]) => {
        if (active) {
          setArchivedDrafts(
            archives.filter((entry) => hasReceptionDraft(entry.value)),
          );
          if (draft && (hasReceptionDraft(draft) || resumeDraft)) {
            if (resumeDraft) {
              setValues(restoreReceptionDraft(defaults.current, draft));
              setWeight(draft.pendingWeight ?? "");
              setLotMode(draft.lotId ? "existing" : "new");
              setReady(true);
            } else {
              setDraftChoice(draft);
            }
          } else setReady(true);
        }
      })
      .catch(() => {
        if (active) setError("No se pudo recuperar el borrador.");
      });
    return () => {
      active = false;
    };
  }, [draftKey, resumeDraft]);
  useEffect(() => {
    if (!ready || choosingDraft || busy) return;
    const timer = setTimeout(() => {
      void saveDraft(draftKey, { ...values, pendingWeight: weight })
        .then(() => setDraftStatus("Borrador guardado en este dispositivo"))
        .catch(() => setError("No se pudo guardar el borrador."));
    }, 250);
    return () => clearTimeout(timer);
  }, [draftKey, values, weight, ready, choosingDraft, busy]);
  const archive = async (draft: ReceptionDraft) => {
    if (!hasReceptionDraft(draft)) return;
    const entry = {
      key: `${draftKey}:archive:${crypto.randomUUID()}`,
      value: draft,
    };
    await saveDraft(entry.key, entry.value);
    setArchivedDrafts((entries) => [...entries, entry]);
  };
  const chooseDraft = async (draft: ReceptionDraft | null) => {
    setChoosingDraft(true);
    try {
      // Preserve the previous work before replacing the active draft.
      if (draftChoice && draft !== draftChoice) await archive(draftChoice);
      if (!draftChoice && ready)
        await archive({ ...values, pendingWeight: weight });
      const next = draft
        ? restoreReceptionDraft(defaults.current, draft)
        : freshReceptionValues(initialProducerId, actor, allowSelection);
      const nextWeight = draft?.pendingWeight ?? "";
      await saveDraft(draftKey, { ...next, pendingWeight: nextWeight });
      setValues(next);
      setWeight(nextWeight);
      setLotMode(next.lotId ? "existing" : "new");
      setDraftChoice(null);
      setReady(true);
      setError("");
      setDraftStatus(
        draft
          ? "Borrador retomado. Revise la fecha antes de guardar."
          : "Nueva recepción; el borrador anterior se conserva abajo.",
      );
    } catch {
      setError(
        "No se pudo conservar el borrador. Sus datos siguen aquí; intente nuevamente.",
      );
    } finally {
      setChoosingDraft(false);
    }
  };
  const describeDraft = (draft: ReceptionDraft) => {
    const name =
      data.producers.find((p) => p.id === draft.producerId)?.name ??
      "Productor pendiente";
    return `${name} · ${draft.date ? dateLabel(draft.date) : "Fecha pendiente"} · ${kg(summary(draft.weights ?? []).total)} kg${draft.pendingWeight ? ` + ${draft.pendingWeight} kg por agregar` : ""}`;
  };
  const producerReceptions = data.receptions
    .filter(
      (reception) =>
        reception.organization_id === organizationId &&
        reception.status !== "Cancelado" &&
        origin(data, reception.id).producer?.id === values.producerId,
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.created_at.localeCompare(a.created_at),
    );
  const producerTotal = round(
    producerReceptions.reduce(
      (sum, reception) => sum + receptionTotal(data, reception.id),
      0,
    ),
  );
  const selectedLot = data.field_lots.find((lot) => lot.id === values.lotId);
  const availableLots = data.field_lots.filter((lot) => {
    const plot = data.plots.find((item) => item.id === lot.plot_id);
    const owner =
      data.farms.find((farm) => farm.id === plot?.farm_id)?.producer_id ??
      lot.producer_id;
    return (
      lot.organization_id === organizationId &&
      owner === values.producerId &&
      (lot.plot_id ?? "") === values.plotId &&
      [
        "En recepción",
        "En selección",
        "En pesaje",
        "Palletizado",
        "Listo para exportación",
        "Parcialmente rechazado",
      ].includes(lot.status)
    );
  });
  const set = <K extends keyof ReceptionValues>(
    key: K,
    value: ReceptionValues[K],
  ) => setValues((v) => ({ ...v, [key]: value }));
  const add = () => {
    try {
      set("weights", [...values.weights, parseKg(weight)]);
      setWeight("");
      setError("");
      weightRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const s = summary(values.weights);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy || choosingDraft) return;
    if (weight.trim()) {
      setError("Agregue el peso pendiente con el botón + antes de guardar.");
      return;
    }
    if (!values.weights.length) {
      setError("Agregue al menos un pesaje.");
      return;
    }
    try {
      if (lotMode === "existing" && !values.lotId)
        throw new Error("Seleccione el lote que desea continuar.");
      const submission = selectedLot
        ? { ...values, harvest: selectedLot.harvest_date ?? "" }
        : values;
      validateReceptionOrigin(data, submission, organizationId);
      if (values.classifyNow)
        intakeSelection(s.total, values.rejectedKg, values.rejectionReason);
      void onSave(submission).catch((failure: unknown) =>
        setError(
          failure instanceof Error
            ? failure.message
            : "No se pudo guardar la recepción.",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <form onSubmit={submit}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {draftChoice && (
        <section
          className="setting-info"
          style={{ display: "block" }}
          aria-label="Borrador pendiente"
        >
          <strong>Hay una recepción sin guardar</strong>
          <p>{describeDraft(draftChoice)}</p>
          <p className="hint">
            Retome esos datos o empiece otra entrega. El borrador anterior se
            conservará.
          </p>
          <div className="row">
            <button
              type="button"
              className="button primary"
              disabled={busy || choosingDraft}
              onClick={() => void chooseDraft(draftChoice)}
            >
              Retomar borrador
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy || choosingDraft}
              onClick={() => void chooseDraft(null)}
            >
              Nueva recepción vacía
            </button>
          </div>
        </section>
      )}
      <fieldset
        disabled={busy || !ready || choosingDraft}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <legend className="sr-only">Datos de esta recepción</legend>
        <Field label="Productor *">
          <select
            required
            value={values.producerId}
            onChange={(e) => {
              setValues((v) => changeReceptionProducer(v, e.target.value));
              setLotMode("new");
            }}
          >
            <option value="">Seleccione un productor</option>
            {data.producers
              .filter(
                (p) =>
                  p.organization_id === organizationId && p.status === "Activo",
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {producerIdentity(p)}
                </option>
              ))}
          </select>
        </Field>
        {values.producerId && (
          <section
            className="setting-info"
            style={{ display: "block" }}
            aria-label="Entregas anteriores del productor"
          >
            <strong>
              {producerReceptions.length} entregas anteriores ·{" "}
              {kg(producerTotal)} kg
            </strong>
            {producerReceptions[0] && (
              <p className="hint">
                Última recepción: {dateLabel(producerReceptions[0].date)}
              </p>
            )}
            <p className="hint">
              Los pesos que ingrese abajo pertenecen solo a esta entrega. Las
              recepciones anteriores se conservan.
            </p>
          </section>
        )}
        <div className="row">
          <button
            type="button"
            className="link"
            disabled={busy || !ready}
            onClick={() =>
              void saveDraft(draftKey, { ...values, pendingWeight: weight })
                .then(() => onQuickCreate("producer"))
                .catch(() => setError("No se pudo guardar el borrador."))
            }
          >
            <Plus size={14} />
            Nuevo productor
          </button>
          <button
            type="button"
            className="link"
            disabled={busy || !ready}
            onClick={() =>
              void saveDraft(draftKey, { ...values, pendingWeight: weight })
                .then(() => onQuickCreate("plot"))
                .catch(() => setError("No se pudo guardar el borrador."))
            }
          >
            <Plus size={14} />
            Nueva parcela
          </button>
        </div>
        <Field label="Parcela (si se conoce)">
          <select
            value={values.plotId}
            onChange={(e) => {
              setValues((v) => ({
                ...v,
                plotId: e.target.value,
                lotId: "",
                lotCode: "",
                harvest: "",
              }));
              setLotMode("new");
            }}
          >
            <option value="">Parcela pendiente de informar</option>
            {data.plots
              .filter(
                (p) =>
                  p.organization_id === organizationId &&
                  p.status === "Activo" &&
                  data.farms.some(
                    (f) =>
                      f.id === p.farm_id &&
                      f.producer_id === values.producerId &&
                      f.organization_id === organizationId &&
                      f.status === "Activo",
                  ),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {data.farms.find((f) => f.id === p.farm_id)?.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Esta entrega">
          <select
            value={lotMode}
            onChange={(e) => {
              setLotMode(e.target.value as "new" | "existing");
              setValues((v) => ({ ...v, lotId: "", lotCode: "", harvest: "" }));
            }}
          >
            <option value="new">Nueva entrega / lote nuevo</option>
            <option value="existing">Continuar lote existente</option>
          </select>
        </Field>
        {lotMode === "existing" ? (
          <>
            <Field label="Lote existente de este productor *">
              <select
                required
                value={values.lotId}
                onChange={(e) => {
                  const lot = availableLots.find(
                    (item) => item.id === e.target.value,
                  );
                  setValues((v) => ({
                    ...v,
                    lotId: e.target.value,
                    lotCode: "",
                    harvest: lot?.harvest_date ?? "",
                  }));
                }}
              >
                <option value="">Seleccione el lote que continúa</option>
                {availableLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.code} · Cosecha{" "}
                    {lot.harvest_date
                      ? dateLabel(lot.harvest_date)
                      : "sin informar"}
                  </option>
                ))}
              </select>
            </Field>
            <p className="hint">
              Use esta opción solo para otra descarga de la misma cosecha y
              parcela. Se registra una recepción separada, con el mismo lote.
            </p>
            {!availableLots.length && (
              <p className="hint">
                No hay lotes abiertos para este productor y parcela. Puede crear
                un lote nuevo.
              </p>
            )}
          </>
        ) : (
          <Field label="Código / nombre del lote">
            <input
              maxLength={80}
              value={values.lotCode}
              onChange={(e) => set("lotCode", e.target.value)}
              placeholder="Automático si se deja vacío"
            />
          </Field>
        )}
        <div className="form-grid">
          <Field label="Fecha de recepción *">
            <input
              type="date"
              required
              value={values.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          {lotMode === "existing" ? (
            <Field label="Cosecha del lote seleccionado">
              <input
                readOnly
                value={
                  selectedLot?.harvest_date
                    ? dateLabel(selectedLot.harvest_date)
                    : "Sin informar"
                }
              />
            </Field>
          ) : (
            <Field label="Fecha de cosecha de esta entrega (si se conoce)">
              <input
                type="date"
                max={values.date || undefined}
                value={values.harvest}
                onChange={(e) => set("harvest", e.target.value)}
              />
            </Field>
          )}
        </div>
        <Field label="Responsable *">
          <input
            required
            value={values.responsible}
            onChange={(e) => set("responsible", e.target.value)}
          />
        </Field>
        <div className="weigh-entry">
          <Field label="Agregar peso (kg)">
            <NumericInput
              inputMode="decimal"
              ref={weightRef}
              enterKeyHint="next"
              placeholder="0,00"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
          </Field>
          <button
            className="button primary"
            type="button"
            onClick={add}
            aria-label="Agregar peso"
          >
            <Plus />
          </button>
        </div>
        <div className="weight-chips">
          {values.weights.map((w, i) => (
            <span key={i}>
              {kg(w)} kg
              <button
                type="button"
                aria-label={"Quitar peso " + (i + 1) + " del borrador"}
                onClick={() =>
                  set(
                    "weights",
                    values.weights.filter((_, n) => n !== i),
                  )
                }
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
        <div className="weight-summary">
          <div>
            <small>Total recibido</small>
            <strong>
              {kg(s.total)} <span>kg</span>
            </strong>
          </div>
          <p>
            {s.count} pesajes · Promedio {kg(s.average)} kg
            <br />
            Mín. {kg(s.min)} kg · Máx. {kg(s.max)} kg
          </p>
        </div>
        {allowSelection && (
          <section className="intake-selection">
            <label className="check-row">
              <input
                type="checkbox"
                checked={values.classifyNow}
                onChange={(e) => set("classifyNow", e.target.checked)}
              />
              Registrar selección / pérdidas ahora
            </label>
            {values.classifyNow ? (
              <>
                <Field label="Pérdidas / rechazado (kg)">
                  <NumericInput
                    inputMode="decimal"
                    value={values.rejectedKg}
                    onChange={(e) => set("rejectedKg", e.target.value)}
                  />
                </Field>
                {Number(values.rejectedKg.replace(",", ".")) > 0 && (
                  <Field label="Motivo de las pérdidas *">
                    <select
                      required
                      value={values.rejectionReason}
                      onChange={(e) => set("rejectionReason", e.target.value)}
                    >
                      <option value="">Seleccione el motivo</option>
                      {reasons.map((reason) => (
                        <option key={reason}>{reason}</option>
                      ))}
                    </select>
                  </Field>
                )}
                <details className="loss-details">
                  <summary>Región y observaciones de campo (opcional)</summary>
                  <Field label="Región / comunidad">
                    <input
                      value={values.region}
                      placeholder={
                        data.producers.find((p) => p.id === values.producerId)
                          ?.community || "Comunidad de origen"
                      }
                      onChange={(e) => set("region", e.target.value)}
                      maxLength={160}
                    />
                  </Field>
                  <Field label="Posible plaga observada">
                    <input
                      value={values.pestObservation}
                      onChange={(e) => set("pestObservation", e.target.value)}
                      placeholder="Nombre, si se conoce"
                      maxLength={200}
                    />
                  </Field>
                  <Field label="Señales observadas">
                    <textarea
                      value={values.symptoms}
                      onChange={(e) => set("symptoms", e.target.value)}
                      placeholder="Daño, manchas, insectos u otros signos"
                      maxLength={2000}
                    />
                  </Field>
                  <p className="hint">
                    Registro para revisión técnica; no es un diagnóstico. Puede
                    adjuntar una foto abajo.
                  </p>
                </details>
                <p className="hint">
                  Aprobado:{" "}
                  {kg(
                    Math.max(
                      0,
                      round(
                        s.total -
                          (Number(values.rejectedKg.replace(",", ".")) || 0),
                      ),
                    ),
                  )}{" "}
                  kg · El total recibido incluye lo rechazado.
                </p>
              </>
            ) : (
              <p className="hint">
                Puede continuar el pesaje y clasificar después.
              </p>
            )}
          </section>
        )}
        <section className="intake-photos">
          <label className="button secondary full">
            Foto de la carga / pérdida (opcional)
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={busy || !ready}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void (async () => {
                  try {
                    if (
                      !["image/jpeg", "image/png", "image/webp"].includes(
                        file.type,
                      ) ||
                      !file.size ||
                      file.size > 10 * 1024 * 1024
                    )
                      throw new Error("Use JPG, PNG o WEBP de hasta 10 MB.");
                    const photo = {
                      id: crypto.randomUUID(),
                      name: file.name,
                      mime: file.type,
                      size: file.size,
                    };
                    await saveFile(photo.id, file);
                    setValues((v) => ({
                      ...v,
                      photos: [...(v.photos ?? []), photo],
                    }));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                })();
              }}
            />
          </label>
          {values.photos?.map((photo) => (
            <div className="draft-photo" key={photo.id}>
              <DraftPhotoPreview photo={photo} />
              <button
                className="link"
                type="button"
                onClick={() =>
                  set(
                    "photos",
                    values.photos.filter((p) => p.id !== photo.id),
                  )
                }
              >
                Quitar foto del borrador
              </button>
            </div>
          ))}
        </section>
        <Field label="Observaciones">
          <textarea
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
        <p className="hint">{draftStatus || "Preparando borrador…"}</p>
        <Submit disabled={busy || !ready}>Guardar recepción</Submit>
      </fieldset>
      {archivedDrafts.length > 0 && (
        <details className="loss-details">
          <summary>Borradores anteriores ({archivedDrafts.length})</summary>
          <p className="hint">
            Estos borradores no son recepciones guardadas. Al retomarlos,
            también se conserva el trabajo actual.
          </p>
          {archivedDrafts.map((entry) => (
            <div className="draft-photo" key={entry.key}>
              <span>{describeDraft(entry.value)}</span>
              <button
                type="button"
                className="button secondary"
                disabled={busy || choosingDraft}
                onClick={() => void chooseDraft(entry.value)}
              >
                Retomar este borrador
              </button>
            </div>
          ))}
        </details>
      )}
    </form>
  );
}
function DraftPhotoPreview({ photo }: { photo: DraftPhoto }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void getFile(photo.id).then((file) => {
      if (!file || !active) return;
      objectUrl = URL.createObjectURL(file);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.id]);
  return (
    <>
      {url && <img src={url} alt={photo.name} width={96} height={96} />}
      <span>{photo.name}</span>
    </>
  );
}
