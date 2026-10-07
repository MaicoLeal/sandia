import {
  useCallback,
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
} from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  ClipboardList,
  Cloud,
  CloudOff,
  FileText,
  Home,
  Leaf,
  LogOut,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Settings,
  Truck,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import type {
  AuditLog,
  Data,
  Pallet,
  Reception,
  Table,
  PalletTrace,
  PalletExportLabel,
  TrapInstallation,
} from "./types";
import {
  intakeSelection,
  regionalLosses,
  lossReasons,
  groupPalletsByProducer,
  assertClassification,
  assertPallet,
  available,
  base,
  can,
  code,
  dateLabel,
  day,
  kg,
  now,
  LOCAL_KEY,
  origin,
  parseKg,
  producerIdentity,
  receptionTotal,
  round,
  summary,
} from "./domain";
import { LossFields } from "./LossFields";
import { TrapInstallationsPanel } from "./TrapInstallationsPanel";
import { PalletCorrection } from "./PalletCorrection";
import { ReceptionManagement } from "./ReceptionManagement";
import {
  applyReceptionManagement,
  assertReceptionManagement,
} from "./reception-management";
import type { ReceptionManagementValues } from "./reception-management";
import {
  DEFAULT_PALLET_TARE_KG,
  palletGrossKg,
  palletWeightDetails,
} from "./pallet-weight";
import { assertPalletCorrection } from "./pallet-corrections";
import type { PalletCorrectionValues } from "./pallet-corrections";
import { useWorkspace } from "./useWorkspace";
import { getErrorMessage } from "./services/error-message";
import { RecipientPortal } from "./RecipientPortal";
import { RecipientAccess } from "./RecipientAccess";
import {
  Badge,
  Brand,
  Empty,
  Field,
  Label,
  Modal,
  Submit,
  NumericInput,
} from "./components";
import {
  clearDraft,
  getFile,
  readDraft,
  readWorkspace,
  saveDraft,
  saveFile,
} from "./services/storage";
import {
  publicTrace,
  supabase,
  updatePalletExportLabel,
  updatePalletLabelDetails,
  revisePallet,
  reviseReception,
} from "./services/supabase";
import {
  exportCsv,
  printReport,
  receptionRows,
  receptionWeightRows,
} from "./services/reports";
import {
  palletReportRows,
  shipmentReportRows,
  producerAllocatedKg,
} from "./services/operational-report-rows";
import {
  palletLabelEditValues,
  SENAVE_DECLARATION,
} from "./services/pallet-label-data";
import {
  filterTrapInstallations,
  trapInstallationRows,
} from "./services/trap-installation-reports";
import {
  applyAppUpdate,
  checkAppUpdate,
  getAppUpdateSnapshot,
  subscribeAppUpdate,
} from "./services/app-update";

const appVersion = "2026.10.07-6 · Mensajes de sincronización";

function AppUpdateControls({
  blockedReason = "",
  alwaysVisible = false,
  online = true,
}: {
  blockedReason?: string;
  alwaysVisible?: boolean;
  online?: boolean;
}) {
  const update = useSyncExternalStore(subscribeAppUpdate, getAppUpdateSnapshot);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  if (!alwaysVisible && !update.available && !update.error) return null;
  return (
    <section
      className="app-update-controls no-print"
      aria-label="Actualización de la aplicación"
    >
      <strong>
        {update.available
          ? "Nueva versión disponible"
          : "Versión de la aplicación"}
      </strong>
      <p className="hint">{appVersion}</p>
      <p className="hint" role="status">
        {update.checking
          ? "Buscando una nueva versión…"
          : update.available
            ? "Actualice para usar los cambios más recientes, incluidas las etiquetas."
            : update.checked
              ? "Verificación completada: no hay una actualización pendiente."
              : "Verifique la versión si todavía aparece una etiqueta anterior."}
      </p>
      {(update.error || applyError) && (
        <p className="error" role="alert">
          {update.error || applyError}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="button secondary"
          disabled={!online || update.checking || applying}
          onClick={() => void checkAppUpdate()}
        >
          <RefreshCw size={18} />
          {update.checking ? "Verificando…" : "Verificar actualización"}
        </button>
        {update.available && (
          <button
            type="button"
            className="button primary"
            disabled={
              Boolean(blockedReason) || !online || applying || update.checking
            }
            onClick={() => {
              setApplyError("");
              setApplying(true);
              void applyAppUpdate()
                .catch((e) =>
                  setApplyError(
                    e instanceof Error
                      ? e.message
                      : "No se pudo actualizar la aplicación.",
                  ),
                )
                .finally(() => setApplying(false));
            }}
          >
            {applying ? "Actualizando…" : "Actualizar aplicación"}
          </button>
        )}
      </div>
      {update.available && blockedReason && (
        <p className="hint">{blockedReason}</p>
      )}
      {!online && (
        <p className="hint">
          Conecte el celular a internet para verificar la versión.
        </p>
      )}
    </section>
  );
}

type Page =
  | "Inicio"
  | "Recepción"
  | "Productores"
  | "Pallets"
  | "Expedición"
  | "Informes";
type Dialog =
  | "producer"
  | "plot"
  | "reception"
  | "edit_reception"
  | "cancel_reception"
  | "weight"
  | "classification"
  | "pallet"
  | "edit_export"
  | "edit_pallet"
  | "cancel_pallet"
  | "shipment"
  | "settings"
  | null;
const nav = [
  { name: "Inicio", icon: Home },
  { name: "Recepción", icon: Scale },
  { name: "Productores", icon: Users },
  { name: "Pallets", icon: Box },
  { name: "Expedición", icon: Truck },
  { name: "Informes", icon: FileText },
] as const;
const reasons = lossReasons;
const text = (form: HTMLFormElement, key: string) =>
  String(new FormData(form).get(key) ?? "").trim();
const number = (form: HTMLFormElement, key: string) => {
  const value = text(form, key);
  const result = Number(value.replace(",", "."));
  if (!value || !Number.isFinite(result) || result < 0)
    throw new Error("Ingrese un número válido en " + key);
  return round(result);
};
const optionalNumber = (form: HTMLFormElement, key: string) =>
  text(form, key) ? number(form, key) : null;
const exportLabelFromForm = (
  form: HTMLFormElement,
  previous?: PalletExportLabel,
): PalletExportLabel => ({
  ...(new FormData(form).has("importer_name")
    ? { importer_name: text(form, "importer_name") }
    : previous?.importer_name !== undefined
      ? { importer_name: previous.importer_name }
      : {}),
  ...(new FormData(form).has("importer_address")
    ? { importer_address: text(form, "importer_address") }
    : previous?.importer_address !== undefined
      ? { importer_address: previous.importer_address }
      : {}),
  afidi: text(form, "afidi"),
  packaged_date: text(form, "packaged_date") || null,
  harvest_date: text(form, "export_harvest_date") || null,
  producer_code: text(form, "pallet_producer_code"),
  origin: text(form, "pallet_origin"),
  senave_program: new FormData(form).get("senave_program") === "on",
});
const assertExportDestination = (
  fields: PalletExportLabel,
  destination: string,
) => {
  if (
    fields.senave_program &&
    destination.trim().toLocaleLowerCase("es") !== "uruguay"
  )
    throw new Error(
      "El programa SENAVE para Uruguay requiere destino Uruguay confirmado.",
    );
};
function PublicTrace() {
  const [trace, setTrace] = useState<PalletTrace | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("trace") ?? "";
    const lookup = async () => {
      const local =
        !supabase && import.meta.env.VITE_REQUIRE_AUTH !== "true"
          ? await readWorkspace(LOCAL_KEY)
          : null;
      const p = local?.data.pallets.find(
        (p) => p.token === token && p.status !== "Cancelado",
      );
      if (p)
        return {
          code: p.code,
          product: "Sandía",
          net_kg: p.net_kg,
          destination: p.destination,
          status: p.status,
          weighed_date: p.weighed_date ?? null,
          origins: local!.data.pallet_items
            .filter((i) => i.pallet_id === p.id)
            .map((i) => {
              const o = origin(local!.data, i.reception_id);
              return {
                lot_code: o.lot?.code ?? "",
                producer: o.producer?.name ?? "",
                parcel: o.plot?.name ?? null,
                locality: o.producer?.community ?? "",
                reception_date: o.reception?.date ?? "",
                allocated_kg: i.kg,
              };
            }),
        };
      return publicTrace(token);
    };
    void lookup()
      .then((value) => {
        setTrace(value);
        if (!value) setError("Pallet no encontrado o etiqueta revocada.");
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="public-view">
      <Brand />
      <h1>Trazabilidad de pallet</h1>
      {error ? (
        <p className="error">{error}</p>
      ) : trace ? (
        <section className="panel">
          <Badge>{trace.status}</Badge>
          <h2>{trace.code}</h2>
          <p>{trace.product}</p>
          <strong className="big-number">{kg(trace.net_kg)} kg</strong>
          <p>Destino: {trace.destination}</p>
          {trace.weighed_date && (
            <p>Pesaje del pallet: {dateLabel(trace.weighed_date)}</p>
          )}
          {trace.origins.length > 0 ? (
            <h3>Origen de la sandía</h3>
          ) : (
            <p className="hint">
              Inicie sesión para consultar productor, lote, parcela y fecha de
              origen.
            </p>
          )}
          {trace.origins.map((o, i) => (
            <div className="trace-origin" key={i}>
              <strong>{o.producer}</strong>
              <p>Lote: {o.lot_code}</p>
              <p>Parcela: {o.parcel || "Pendiente de informar"}</p>
              {o.locality && <p>Localidad: {o.locality}</p>}
              <p>
                Recepción: {dateLabel(o.reception_date)} · {kg(o.allocated_kg)}{" "}
                kg
              </p>
            </div>
          ))}
          <a
            className="button primary"
            href={
              location.pathname +
              "?pallet=" +
              encodeURIComponent(
                new URLSearchParams(location.search).get("trace") ?? "",
              )
            }
          >
            Consultar detalle con sesión
          </a>
          <p className="hint">
            Documentos, fotos e historial interno requieren una cuenta
            autorizada.
          </p>
        </section>
      ) : (
        <p>Consultando etiqueta…</p>
      )}
    </main>
  );
}
export default function App() {
  return new URLSearchParams(location.search).has("trace") ? (
    <PublicTrace />
  ) : (
    <WorkspaceApp />
  );
}
function WorkspaceApp() {
  const {
    recipientProfile,
    reload,
    needsLogin,
    workspace,
    error,
    setError,
    busy,
    online,
    commit,
    sync,
    role,
  } = useWorkspace();
  const [page, setPage] = useState<Page>(
    new URLSearchParams(location.search).has("pallet") ? "Pallets" : "Inicio",
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [returnToReception, setReturnToReception] = useState(false);
  const [selectedReception, setSelectedReception] = useState<string | null>(
    null,
  );
  const [selectedProducer, setSelectedProducer] = useState<string | null>(null);
  const [editingProducerId, setEditingProducerId] = useState<string | null>(
    null,
  );
  const [editingReceptionId, setEditingReceptionId] = useState<string | null>(
    null,
  );
  const [editingReceptionRevision, setEditingReceptionRevision] = useState<
    number | null
  >(null);
  const receptionSaveLock = useRef(false);
  const [receptionSaving, setReceptionSaving] = useState(false);
  const [showCancelledReceptions, setShowCancelledReceptions] = useState(false);
  const [label, setLabel] = useState<Pallet | null>(null);
  const [labelSaving, setLabelSaving] = useState(false);
  const [editingPalletId, setEditingPalletId] = useState<string | null>(null);
  const [editingPalletRevision, setEditingPalletRevision] = useState<
    number | null
  >(null);
  const palletSaveLock = useRef(false);
  const [palletSaving, setPalletSaving] = useState(false);
  const [showCancelledPallets, setShowCancelledPallets] = useState(false);
  const [recipientAccessOpen, setRecipientAccessOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [palletToken, setPalletToken] = useState(() =>
    new URLSearchParams(location.search).get("pallet"),
  );
  const [palletProducerId, setPalletProducerId] = useState("");
  const [palletSearch, setPalletSearch] = useState("");
  const close = useCallback(() => {
    setDialog(null);
    setEditingProducerId(null);
    setEditingReceptionId(null);
    setEditingReceptionRevision(null);
    setReturnToReception(false);
    setLabel(null);
    setEditingPalletId(null);
    setEditingPalletRevision(null);
  }, []);
  const workspaceScope = workspace
    ? `${workspace.organizationId}:${workspace.profile?.user_id ?? "local"}`
    : recipientProfile
      ? `${recipientProfile.organization_id}:${recipientProfile.user_id}:destinatario`
      : needsLogin
        ? "signed-out"
        : null;
  const previousScope = useRef<string | null>(null);
  const scopeMatches =
    !previousScope.current || previousScope.current === workspaceScope;
  useEffect(() => {
    if (!workspaceScope) return;
    if (previousScope.current && previousScope.current !== workspaceScope) {
      close();
      setSelectedReception(null);
      setSelectedProducer(null);
      setRecipientAccessOpen(false);
      setPalletProducerId("");
      setPalletSearch("");
      setShowCancelledPallets(false);
      setShowCancelledReceptions(false);
      setMessage("");
    }
    previousScope.current = workspaceScope;
  }, [workspaceScope, close]);
  if (needsLogin) return <LoginScreen error={error} onError={setError} />;
  if (recipientProfile)
    return (
      <RecipientPortal
        key={recipientProfile.user_id}
        profile={recipientProfile}
      />
    );
  if (!workspace)
    return (
      <div className="loading">
        <Brand />
        <p>{error || "Preparando el espacio de trabajo…"}</p>
        {error && (
          <div className="row">
            <button className="button secondary" onClick={() => void reload()}>
              Reintentar
            </button>
            {supabase && (
              <button
                className="button ghost"
                onClick={() => void supabase?.auth.signOut()}
              >
                Cerrar sesión
              </button>
            )}
          </div>
        )}
      </div>
    );
  const data = workspace.data;
  const currentLabel =
    scopeMatches && label?.organization_id === workspace.organizationId
      ? data.pallets.find((pallet) => pallet.id === label.id)
      : undefined;
  const scannedPallet = palletToken
    ? data.pallets.find((p) => p.token === palletToken)
    : null;
  const scannedProducerId = scannedPallet
    ? (data.pallet_items
        .filter((item) => item.pallet_id === scannedPallet.id)
        .map((item) => origin(data, item.reception_id).producer?.id ?? "")
        .filter(Boolean)
        .sort()[0] ?? "")
    : "";
  const activePalletProducerId = palletProducerId || scannedProducerId;
  const palletProducer = data.producers.find(
    (p) => p.id === activePalletProducerId,
  );
  const visiblePallets = palletToken
    ? data.pallets.filter((p) => p.token === palletToken)
    : data.pallets;
  const filteredPallets = visiblePallets.filter((p) => {
    if (p.status === "Cancelado" && !showCancelledPallets && !palletToken)
      return false;
    const origins = data.pallet_items
      .filter((item) => item.pallet_id === p.id)
      .map((item) => origin(data, item.reception_id));
    if (
      !activePalletProducerId ||
      !origins.some((o) => o.producer?.id === activePalletProducerId)
    )
      return false;
    return [
      p.code,
      p.net_kg,
      kg(p.net_kg),
      p.destination,
      ...origins.flatMap((o) => [o.producer?.name, o.lot?.code]),
    ]
      .join(" ")
      .toLocaleLowerCase("es")
      .includes(palletSearch.trim().toLocaleLowerCase("es"));
  });
  const palletGroups = groupPalletsByProducer(data, filteredPallets);
  const activeFilteredPallets = filteredPallets.filter(
    (p) => p.status !== "Cancelado",
  );
  const org = workspace.organizationId;
  const user = workspace.profile?.user_id ?? null;
  const actor = workspace.profile?.name ?? "Operador local";
  const exportFieldsEnabled =
    workspace.localOnly || Boolean(workspace.features?.label_export_data);
  const importerFieldsEnabled =
    workspace.localOnly || Boolean(workspace.features?.label_importer_details);
  const draftKey = org + ":" + (user ?? "local") + ":reception";
  const record = (
    d: Data,
    table: Table,
    id: string,
    action: string,
    before: unknown,
    after: unknown,
    reason = "",
  ) => {
    d.audit_logs.push({
      ...base(org, "Activo", user),
      entity_type: table,
      entity_id: id,
      action,
      actor,
      before,
      after,
      reason,
    });
  };
  const allowed = (operation: Parameters<typeof can>[1]) => {
    if (!can(role, operation))
      throw new Error("Su perfil no tiene permiso para esta operación.");
  };
  const run = async (
    action: () => Promise<void>,
    success = "Registro guardado en este dispositivo.",
  ) => {
    setError("");
    try {
      await action();
      setMessage(success);
      close();
      return true;
    } catch (e) {
      setError(getErrorMessage(e, "No se pudo guardar."));
      return false;
    }
  };
  const rows = data.receptions.filter((r) => {
    const o = origin(data, r.id);
    return `${o.producer?.name} ${o.lot?.code} ${r.date}`
      .toLowerCase()
      .includes(search.toLowerCase());
  });
  const today = day();
  const weekStart = new Date(today + "T12:00:00-03:00");
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const start = day(weekStart);
  const totalFor = (predicate: (r: Reception) => boolean) =>
    round(
      data.receptions
        .filter((r) => r.status !== "Cancelado" && predicate(r))
        .reduce((s, r) => s + receptionTotal(data, r.id), 0),
    );
  const total = totalFor(() => true);
  const rejects = data.classifications
    .filter((c) => c.status !== "Cancelado")
    .reduce((s, c) => s + c.rejected_kg, 0);
  const qualities = data.classifications.filter(
    (c) => c.status !== "Cancelado" && c.quality !== null,
  );
  const quality = qualities.length
    ? round(
        qualities.reduce((s, c) => s + (c.quality ?? 0), 0) / qualities.length,
      )
    : null;
  const newButton = (
    title: string,
    type: Dialog,
    permission: Parameters<typeof can>[1],
    icon: ReactNode = <Plus size={18} />,
  ) => (
    <button
      className="button primary"
      disabled={!can(role, permission) || busy}
      onClick={() => {
        setError("");
        setEditingProducerId(null);
        setEditingReceptionId(null);
        setDialog(type);
      }}
    >
      {icon}
      {title}
    </button>
  );
  const detail = selectedReception ? origin(data, selectedReception) : null;
  const producer = selectedProducer
    ? data.producers.find((p) => p.id === selectedProducer)
    : null;
  const editingProducer = editingProducerId
    ? data.producers.find((p) => p.id === editingProducerId)
    : null;
  const editingReception =
    scopeMatches && editingReceptionId
      ? data.receptions.find(
          (r) => r.id === editingReceptionId && r.organization_id === org,
        )
      : null;
  const editingPallet =
    scopeMatches && editingPalletId
      ? data.pallets.find(
          (p) => p.id === editingPalletId && p.organization_id === org,
        )
      : undefined;
  const palletCorrectionEnabled =
    workspace.localOnly ||
    Boolean(
      workspace.features?.pallet_corrections && workspace.features?.pallet_tare,
    );
  const palletTareEnabled =
    workspace.localOnly || Boolean(workspace.features?.pallet_tare);
  const receptionManagementEnabled =
    workspace.localOnly || Boolean(workspace.features?.reception_management);
  const receptionManagementBlocked =
    editingReceptionRevision !== workspace.revision
      ? "Los datos cambiaron. Cierre y abra nuevamente la recepción antes de corregir."
      : !can(role, "correct")
        ? "Solo un administrador o gestor puede corregir o cancelar recepciones."
        : !workspace.localOnly &&
            (!online || workspace.pending || workspace.needsRefresh)
          ? "Conéctese y sincronice los registros pendientes antes de corregir la recepción."
          : "";
  const openReceptionManagement = (id: string, action: "edit" | "cancel") => {
    setError("");
    setEditingReceptionId(id);
    setEditingReceptionRevision(workspace.revision);
    setDialog(action === "edit" ? "edit_reception" : "cancel_reception");
  };
  const saveReceptionManagement = async (values: ReceptionManagementValues) => {
    if (receptionSaveLock.current) return;
    receptionSaveLock.current = true;
    setReceptionSaving(true);
    setError("");
    try {
      allowed("correct");
      if (receptionManagementBlocked)
        throw new Error(receptionManagementBlocked);
      if (!editingReception) throw new Error("Abra nuevamente la recepción.");
      assertReceptionManagement(data, editingReception, values);
      if (workspace.localOnly) {
        await commit((draft) =>
          applyReceptionManagement(
            draft,
            editingReception.id,
            values,
            record,
            user,
          ),
        );
      } else {
        if (!receptionManagementEnabled)
          throw new Error(
            "Active la actualización SQL de recepciones y tara en Supabase.",
          );
        if (!workspace.profile) throw new Error("Inicie sesión nuevamente.");
        await reviseReception(
          editingReception.id,
          values,
          editingReceptionRevision!,
        );
        await reload(true, {
          userId: workspace.profile.user_id,
          organizationId: workspace.organizationId,
        });
      }
      close();
      setMessage(
        values.action === "cancel"
          ? "Recepción eliminada de los totales activos. Se conservaron los registros cancelados y el historial."
          : "Recepción corregida. Los kg recibidos, las pérdidas y el saldo se recalcularon con historial.",
      );
    } catch (problem) {
      setError(getErrorMessage(problem, "No se pudo guardar la recepción."));
    } finally {
      receptionSaveLock.current = false;
      setReceptionSaving(false);
    }
  };
  const palletCorrectionBlocked =
    editingPalletRevision !== workspace.revision
      ? "Los datos cambiaron desde que abrió el formulario. Ciérrelo y abra nuevamente el pallet antes de corregir."
      : !can(role, "correct")
        ? "Solo un administrador o gestor puede corregir o cancelar pallets."
        : !workspace.localOnly &&
            (!online || workspace.pending || workspace.needsRefresh)
          ? "Conéctese y sincronice los registros pendientes antes de corregir el pallet."
          : "";
  const savePalletCorrection = async (values: PalletCorrectionValues) => {
    if (palletSaveLock.current) return;
    palletSaveLock.current = true;
    setError("");
    setPalletSaving(true);
    try {
      allowed("correct");
      if (palletCorrectionBlocked) throw new Error(palletCorrectionBlocked);
      if (!editingPallet) throw new Error("Abra nuevamente el pallet.");
      assertPalletCorrection(data, editingPallet, values);
      if (workspace.localOnly) {
        await commit((draft) => {
          const pallet = draft.pallets.find((p) => p.id === editingPallet.id);
          if (!pallet) throw new Error("El pallet ya no está disponible.");
          assertPalletCorrection(draft, pallet, values);
          const before = structuredClone(pallet);
          if (values.action === "cancel") {
            pallet.status = "Cancelado";
          } else {
            const materialChange =
              pallet.net_kg !== values.netKg ||
              pallet.gross_kg !== values.grossKg ||
              (values.tareKg !== undefined &&
                pallet.tare_kg !== values.tareKg) ||
              pallet.fruit_count !== values.fruitCount ||
              (pallet.weighed_date ?? null) !== values.weighedDate ||
              pallet.responsible !== values.responsible;
            if (pallet.net_kg !== values.netKg) {
              const item = draft.pallet_items.find(
                (i) => i.pallet_id === pallet.id,
              )!;
              const itemBefore = structuredClone(item);
              item.kg = values.netKg;
              item.updated_at = now();
              record(
                draft,
                "pallet_items",
                item.id,
                "Peso de origen del pallet corregido",
                itemBefore,
                structuredClone(item),
                values.reason,
              );
            }
            pallet.net_kg = values.netKg;
            pallet.gross_kg = values.grossKg;
            if (values.tareKg !== undefined) pallet.tare_kg = values.tareKg;
            pallet.fruit_count = values.fruitCount;
            pallet.weighed_date = values.weighedDate;
            pallet.responsible = values.responsible;
            pallet.notes = values.notes;
            if (materialChange) pallet.status = "En armado";
          }
          pallet.updated_at = now();
          record(
            draft,
            "pallets",
            pallet.id,
            values.action === "cancel"
              ? "Pallet cancelado"
              : "Pallet corregido",
            before,
            structuredClone(pallet),
            values.reason,
          );
        });
      } else {
        if (!palletCorrectionEnabled)
          throw new Error(
            "Active la actualización SQL de corrección de pallets en Supabase.",
          );
        if (palletCorrectionBlocked) throw new Error(palletCorrectionBlocked);
        if (!workspace.profile) throw new Error("Inicie sesión nuevamente.");
        await revisePallet(editingPallet.id, values, editingPalletRevision!);
        await reload(true, {
          userId: workspace.profile.user_id,
          organizationId: workspace.organizationId,
        });
      }
      palletSaveLock.current = false;
      close();
      setMessage(
        values.action === "cancel"
          ? "Pallet cancelado con historial. Se actualizaron la cantidad de pallets activos y el saldo disponible."
          : "Pallet corregido con historial. Revise los datos y vuelva a imprimir la etiqueta si cambiaron.",
      );
    } catch (problem) {
      setError(getErrorMessage(problem, "No se pudo corregir el pallet."));
    } finally {
      palletSaveLock.current = false;
      setPalletSaving(false);
    }
  };
  const producerReceptions = producer
    ? data.receptions.filter(
        (r) => origin(data, r.id).producer?.id === producer.id,
      )
    : [];
  const producerPallets = producer
    ? data.pallets.filter((p) =>
        data.pallet_items.some(
          (i) =>
            i.pallet_id === p.id &&
            origin(data, i.reception_id).producer?.id === producer.id,
        ),
      )
    : [];
  const producerQuality = data.classifications.filter(
    (c) =>
      c.status !== "Cancelado" &&
      producerReceptions.some(
        (r) => r.id === c.reception_id && r.status !== "Cancelado",
      ),
  );
  const recent = data.receptions
    .filter((r) => r.status !== "Cancelado")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  const receptionList = (list: Reception[]) => (
    <div className="record-list">
      {list.length ? (
        list.map((r) => {
          const o = origin(data, r.id);
          return (
            <button
              className="record"
              key={r.id}
              onClick={() => setSelectedReception(r.id)}
            >
              <span className="record-icon">
                <Leaf size={20} />
              </span>
              <span className="record-main">
                <strong>{o.producer?.name}</strong>
                <small>
                  {o.lot?.code} · {dateLabel(r.date)}
                </small>
              </span>
              <span className="record-end">
                <strong>
                  {kg(receptionTotal(data, r.id))} <small>kg</small>
                </strong>
                <Badge>
                  {r.status === "Cancelado"
                    ? "Cancelado"
                    : (o.lot?.status ?? r.status)}
                </Badge>
              </span>
              <ChevronRight size={16} />
            </button>
          );
        })
      ) : (
        <Empty>No hay recepciones para este período.</Empty>
      )}
    </div>
  );
  const attach = async (
    type: "receptions" | "pallets" | "shipments",
    id: string,
    file: File,
  ) => {
    await run(async () => {
      if (type === "receptions") {
        if (
          !can(role, "receive") &&
          !can(role, "weigh") &&
          !can(role, "classify")
        )
          throw new Error("Su perfil no puede adjuntar archivos.");
      } else allowed(type === "pallets" ? "pallet" : "ship");
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Máximo 10 MB por archivo.");
      if (file.size === 0) throw new Error("El archivo está vacío.");
      if (
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
          "text/csv",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ].includes(file.type)
      )
        throw new Error("Use JPG, PNG, WEBP, PDF, CSV o XLSX.");
      const a = {
        ...base(org, "Activo", user),
        entity_type: type,
        entity_id: id,
        name: file.name,
        mime: file.type,
        size: file.size,
        storage_path: "",
      };
      a.storage_path =
        org + "/" + a.id + "/" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      await saveFile(a.id, file);
      await commit((d) => {
        d.attachments.push(a);
        record(d, "attachments", a.id, "Adjunto agregado", null, {
          name: file.name,
        });
      });
    });
  };
  const attachments = (type: string, id: string) => (
    <div className="attachments">
      <label className="button secondary">
        <Plus size={16} />
        Foto / documento
        <input
          type="file"
          className="sr-only"
          accept="image/jpeg,image/png,image/webp,.pdf,.csv,.xlsx"
          disabled={
            busy ||
            (type === "receptions"
              ? !can(role, "receive") &&
                !can(role, "weigh") &&
                !can(role, "classify")
              : !can(role, type === "pallets" ? "pallet" : "ship"))
          }
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f)
              void attach(
                type as "receptions" | "pallets" | "shipments",
                id,
                f,
              );
            e.target.value = "";
          }}
        />
      </label>
      {data.attachments
        .filter((a) => a.entity_type === type && a.entity_id === id)
        .map((a) => (
          <button
            key={a.id}
            className="link"
            onClick={() =>
              void run(async () => {
                const local = await getFile(a.id);
                let url = "";
                if (local) {
                  url = URL.createObjectURL(local);
                  setTimeout(() => URL.revokeObjectURL(url), 60000);
                } else {
                  if (!supabase)
                    throw new Error(
                      "Archivo no disponible en este dispositivo.",
                    );
                  const result = await supabase.storage
                    .from("attachments")
                    .createSignedUrl(a.storage_path, 60);
                  if (result.error) throw result.error;
                  url = result.data.signedUrl;
                }
                const link = document.createElement("a");
                link.href = url;
                link.download = a.name;
                link.click();
              }, "Adjunto descargado.")
            }
          >
            {a.name}
          </button>
        ))}
    </div>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-caption">OPERACIÓN AGRÍCOLA</div>
        <nav>
          {nav.map((n) => (
            <button
              className={page === n.name ? "active" : ""}
              key={n.name}
              onClick={() => {
                setPage(n.name);
                setSelectedReception(null);
                setSelectedProducer(null);
                setSearch("");
              }}
            >
              <n.icon size={20} />
              {n.name}
              {page === n.name && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="season">
            <Leaf size={18} />
            <div>
              <strong>Campaña de sandía</strong>
              <small>Recepción y exportación</small>
            </div>
          </div>
          <button
            className="sidebar-settings"
            onClick={() => setDialog("settings")}
          >
            <Settings size={18} />
            Configuración
          </button>
          <p>
            Cooperativa Agronorte
            <br />
            Paraguay · America/Asuncion
          </p>
        </div>
      </aside>
      <div className="content-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <div className="breadcrumb">
            Sistema Agronorte <ChevronRight size={14} />
            <strong>Recepción de Sandía</strong>
          </div>
          <div className="topbar-actions">
            <span className={"connection " + (!online ? "offline" : "")}>
              {online ? <Cloud size={15} /> : <WifiOff size={15} />}
              <span>
                {workspace.localOnly
                  ? "Datos reales · local"
                  : workspace.pending
                    ? "Pendiente de sincronizar"
                    : "Sincronizado"}
              </span>
            </span>
            <button
              className="avatar"
              aria-label="Configuración y usuario"
              onClick={() => setDialog("settings")}
            >
              {actor.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main>
          <div className="workspace-banner">
            <span>
              <Leaf size={16} />
              {workspace.localOnly
                ? "Datos reales en este dispositivo · sin sincronizar con Supabase"
                : "Espacio de trabajo · " + actor}
            </span>
            {!workspace.localOnly && (
              <button onClick={() => void sync()} disabled={busy || !online}>
                {busy ? "Sincronizando…" : "Sincronizar"}
              </button>
            )}
            {workspace.localOnly && (
              <button onClick={() => setDialog("settings")}>
                Conectar Supabase <ArrowRight size={14} />
              </button>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Cerrar error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {message && (
            <div className="toast" role="status">
              <Check size={16} />
              {message}
              <button
                className="icon-button"
                aria-label="Cerrar aviso"
                onClick={() => setMessage("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <AppUpdateControls
            online={online}
            blockedReason={
              busy
                ? "Espere a que termine la operación."
                : workspace.pending || workspace.needsRefresh
                  ? "Sincronice los registros antes de actualizar."
                  : (dialog && dialog !== "settings") || label
                    ? "Guarde el formulario y cierre la ventana abierta antes de actualizar."
                    : ""
            }
          />
          <div className="page-heading">
            <div>
              <p className="eyebrow">DEL CAMPO AL DESTINO</p>
              <h1>
                {page === "Inicio" ? "Cada entrega, una historia." : page}
              </h1>
              <p className="subtitle">
                {page === "Inicio"
                  ? "Reciba, organice y acompañe su producción de sandía."
                  : {
                      Recepción:
                        "Registro ágil de entregas, selección y pesajes.",
                      Productores: "El origen de cada lote, siempre a mano.",
                      Pallets:
                        "Prepare cada pallet con peso, destino y trazabilidad.",
                      Expedición: "Organice la carga y consulte su origen.",
                      Informes: "Datos claros para acompañar la operación.",
                    }[page]}
              </p>
            </div>
            <span className="date-chip">{dateLabel(today)} · Paraguay</span>
          </div>
          {page === "Inicio" && (
            <>
              <section className="hero">
                <div>
                  <span className="hero-tag">RECEPCIÓN DE SANDÍA</span>
                  <h2>
                    Una operación simple.
                    <br />
                    Una trazabilidad completa.
                  </h2>
                  <p>
                    Del productor al pallet. Registre cada paso
                    <br className="desktop-only" /> y mantenga su equipo
                    conectado.
                  </p>
                  <button
                    className="button cream"
                    disabled={!can(role, "receive")}
                    onClick={() => setDialog("reception")}
                  >
                    <Plus size={20} />
                    Nueva recepción
                    <ArrowRight size={18} />
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-ring ring-one" />
                  <div className="art-ring ring-two" />
                  <div className="melon">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="art-label">
                    <PackageCheck size={24} />
                    <div>
                      <strong>Origen identificado</strong>
                      <small>Productor → Lote → Pallet</small>
                    </div>
                    <Check size={20} />
                  </div>
                </div>
              </section>
              <section className="stats">
                <Stat
                  label="Total recibido"
                  value={kg(total)}
                  unit="kg"
                  icon={<Scale />}
                  note="Todas las recepciones activas"
                />
                <Stat
                  label="Productores registrados"
                  value={String(data.producers.length)}
                  icon={<Users />}
                  note={`${data.producers.filter((p) => p.status === "Activo").length} activos`}
                />
                <Stat
                  label="Pérdidas / rechazos"
                  value={kg(rejects)}
                  unit="kg"
                  icon={<ClipboardList />}
                  note={`${total ? kg(round((rejects / total) * 100)) : "0"}% del peso recibido · selección registrada`}
                />
                <Stat
                  label="Recibido hoy"
                  value={kg(totalFor((r) => r.date === today))}
                  unit="kg"
                  icon={<Scale />}
                  note="Recepciones confirmadas"
                />
                <Stat
                  label="Esta semana"
                  value={kg(
                    totalFor((r) => r.date >= start && r.date <= today),
                  )}
                  unit="kg"
                  icon={<ArrowDownToLine />}
                  note="Lunes a hoy · Paraguay"
                />
                <Stat
                  label="Pallets listos"
                  value={String(
                    data.pallets.filter((p) => p.status === "Listo para carga")
                      .length,
                  )}
                  icon={<Box />}
                  note={`${data.pallets.filter((p) => p.status === "Expedido").length} pallets expedidos`}
                />
                <Stat
                  label="Lotes pendientes"
                  value={String(
                    data.field_lots.filter(
                      (l) =>
                        !["Expedido", "Rechazado"].includes(l.status) &&
                        (!data.receptions.some((r) => r.lot_id === l.id) ||
                          data.receptions.some(
                            (r) =>
                              r.lot_id === l.id && r.status !== "Cancelado",
                          )),
                    ).length,
                  )}
                  icon={<ClipboardList />}
                  note="En proceso de preparación"
                />
              </section>
              <div className="quick-actions">
                <button
                  onClick={() => setDialog("weight")}
                  disabled={!can(role, "weigh")}
                >
                  <Scale />
                  <span>
                    <strong>Registrar pesaje</strong>
                    <small>Agregue pesos a un lote</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
                <button
                  onClick={() => setDialog("pallet")}
                  disabled={!can(role, "pallet")}
                >
                  <Box />
                  <span>
                    <strong>Crear pallet</strong>
                    <small>Organice el peso aprobado</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
                <button
                  onClick={() => setDialog("shipment")}
                  disabled={!can(role, "ship")}
                >
                  <Truck />
                  <span>
                    <strong>Nueva expedición</strong>
                    <small>Prepare la salida de carga</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>Últimas recepciones</h2>
                      <p>El movimiento más reciente de su producción</p>
                    </div>
                    <button
                      className="link"
                      onClick={() => setPage("Recepción")}
                    >
                      Ver todas
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  {receptionList(recent)}
                </section>
                <section className="panel destination-panel">
                  <div className="section-heading">
                    <h2>Destino de la producción</h2>
                    <Truck size={20} />
                  </div>
                  {data.pallets.some((p) => p.status !== "Cancelado") ? (
                    [
                      ...new Set(
                        data.pallets
                          .filter((p) => p.status !== "Cancelado")
                          .map((p) => p.destination),
                      ),
                    ].map((dest) => (
                      <div className="destination" key={dest}>
                        <span>{dest}</span>
                        <strong>
                          {kg(
                            data.pallets
                              .filter(
                                (p) =>
                                  p.destination === dest &&
                                  p.status !== "Cancelado",
                              )
                              .reduce((s, p) => s + p.net_kg, 0),
                          )}{" "}
                          kg
                        </strong>
                      </div>
                    ))
                  ) : (
                    <div className="destination-empty">
                      <span className="flag">UY</span>
                      <strong>Uruguay</strong>
                      <p>
                        Destino sugerido para nuevos pallets.
                        <br />
                        Aún no hay peso asignado.
                      </p>
                    </div>
                  )}
                  <div className="quality">
                    <span>Calidad visual media</span>
                    <strong>
                      {quality === null ? "Sin evaluar" : kg(quality) + " / 5"}
                    </strong>
                    <small>
                      {kg(rejects)} kg rechazados · {kg(total)} kg recibidos
                    </small>
                  </div>
                </section>
              </div>
              <div className="trace-strip">
                <Leaf size={18} />
                <strong>Trazabilidad en cada paso</strong>
                <span>
                  Productor <ChevronRight /> Parcela <ChevronRight /> Lote{" "}
                  <ChevronRight /> Recepción <ChevronRight /> Pallet{" "}
                  <ChevronRight /> Destino
                </span>
              </div>
            </>
          )}
          {page === "Recepción" && (
            <>
              <div className="toolbar">
                <label className="search">
                  <Search size={18} />
                  <input
                    aria-label="Buscar recepción"
                    placeholder="Productor, lote o fecha…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {newButton("Nueva recepción", "reception", "receive")}
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={showCancelledReceptions}
                  onChange={(e) => setShowCancelledReceptions(e.target.checked)}
                />
                Mostrar recepciones eliminadas
              </label>
              <section className="panel">
                {receptionList(
                  rows.filter(
                    (r) => showCancelledReceptions || r.status !== "Cancelado",
                  ),
                )}
              </section>
            </>
          )}
          {page === "Productores" && (
            <>
              <div className="toolbar">
                <label className="search">
                  <Search size={18} />
                  <input
                    aria-label="Buscar productor"
                    placeholder="Nombre, código o comunidad…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {newButton("Nuevo productor", "producer", "catalog")}
                {newButton("Nueva parcela", "plot", "catalog")}
              </div>
              <div className="card-grid">
                {data.producers
                  .filter((p) =>
                    [
                      p.name,
                      p.community,
                      p.metadata?.internal_code,
                      p.metadata?.export_code,
                      ...(p.metadata?.trap_reference_codes ?? []),
                    ]
                      .join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <button
                      key={p.id}
                      className="panel producer-card"
                      onClick={() => setSelectedProducer(p.id)}
                    >
                      <div className="row">
                        <span className="record-icon">
                          <Users />
                        </span>
                        <Badge>{p.status}</Badge>
                      </div>
                      <h2>{p.name}</h2>
                      <p className="hint">
                        Código interno Agronorte:{" "}
                        <strong>
                          {p.metadata?.internal_code?.trim() ||
                            "Pendiente de asignar"}
                        </strong>
                      </p>
                      <p>{p.community || "Localidad no registrada"}</p>
                      {!!p.metadata?.trap_reference_codes?.length && (
                        <p className="hint">
                          Código del productor:{" "}
                          <strong>
                            {p.metadata.trap_reference_codes.join(" / ")}
                          </strong>
                        </p>
                      )}
                      {p.metadata?.harvest_reference && (
                        <p className="hint">
                          Cosecha informada:{" "}
                          {dateLabel(p.metadata.harvest_reference.date)}
                          {p.metadata.harvest_reference.status !==
                            "Confirmado" && " · Pendiente de confirmar"}
                        </p>
                      )}
                      <div className="producer-total">
                        <strong>
                          {kg(
                            data.receptions
                              .filter(
                                (r) => origin(data, r.id).producer?.id === p.id,
                              )
                              .reduce(
                                (s, r) => s + receptionTotal(data, r.id),
                                0,
                              ),
                          )}{" "}
                          kg
                        </strong>
                        <small>Total entregado</small>
                      </div>
                      <span className="link">
                        Ver historial <ArrowRight size={16} />
                      </span>
                    </button>
                  ))}
              </div>
            </>
          )}
          {page === "Pallets" && (
            <>
              <div className="toolbar">
                <p>
                  {palletProducer ? (
                    <>
                      {activeFilteredPallets.length} pallets activos de{" "}
                      {palletProducer.name} ·{" "}
                      {kg(
                        activeFilteredPallets.reduce(
                          (sum, p) => sum + p.net_kg,
                          0,
                        ),
                      )}{" "}
                      kg netos
                    </>
                  ) : (
                    "Seleccione un productor para consultar sus pallets."
                  )}
                </p>
                <div className="row">
                  {role === "administrador" && !workspace.localOnly && (
                    <button
                      className="button secondary"
                      onClick={() => setRecipientAccessOpen(true)}
                    >
                      Acceso de destinatarios
                    </button>
                  )}
                  {newButton("Crear pallet", "pallet", "pallet")}
                </div>
              </div>
              <div className="pallet-filters panel">
                <Field label="Productor">
                  <select
                    value={activePalletProducerId}
                    onChange={(e) => {
                      setPalletProducerId(e.target.value);
                      setPalletToken(null);
                      setPalletSearch("");
                    }}
                  >
                    <option value="">Seleccione un productor</option>
                    {[...data.producers]
                      .sort((a, b) => a.name.localeCompare(b.name, "es"))
                      .map((producer) => (
                        <option key={producer.id} value={producer.id}>
                          {producerIdentity(producer)}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Buscar pallet, lote o peso">
                  <input
                    type="search"
                    disabled={!activePalletProducerId}
                    value={palletSearch}
                    onChange={(e) => setPalletSearch(e.target.value)}
                    placeholder="Código, lote o kg"
                  />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showCancelledPallets}
                    onChange={(event) =>
                      setShowCancelledPallets(event.target.checked)
                    }
                  />
                  Mostrar pallets cancelados (historial)
                </label>
              </div>
              <p className="hint">
                Para ajustar la cantidad, cancele el pallet registrado de más o
                cree los faltantes. Los kg recibidos se consultan en Recepción;
                esta lista suma los pallets activos.
              </p>
              {palletToken && (
                <div className="toolbar">
                  <p>Consulta del pallet escaneado</p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setPalletProducerId(activePalletProducerId);
                      setPalletToken(null);
                      setPalletSearch("");
                    }}
                  >
                    Ver pallets de este productor
                  </button>
                </div>
              )}
              <div className="pallet-groups">
                {palletGroups.length ? (
                  palletGroups.map((group) => (
                    <section className="pallet-producer-group" key={group.key}>
                      <header className="pallet-producer-heading">
                        <div>
                          <span>PRODUCTOR</span>
                          <h2>{group.name}</h2>
                        </div>
                        <p>
                          {
                            group.pallets.filter(
                              (p) => p.status !== "Cancelado",
                            ).length
                          }{" "}
                          pallets activos ·{" "}
                          <strong>{kg(group.netKg)} kg netos</strong>
                          {group.pallets.some(
                            (p) => p.status === "Cancelado",
                          ) && (
                            <>
                              {" "}
                              ·{" "}
                              {
                                group.pallets.filter(
                                  (p) => p.status === "Cancelado",
                                ).length
                              }{" "}
                              cancelados fuera del total
                            </>
                          )}
                        </p>
                      </header>
                      <div className="card-grid">
                        {group.pallets.map((p) => {
                          const item = data.pallet_items.find(
                            (i) => i.pallet_id === p.id,
                          );
                          const o = origin(data, item?.reception_id ?? "");
                          return (
                            <section key={p.id} className="panel pallet-card">
                              <div className="row">
                                <span className="record-icon">
                                  <Box />
                                </span>
                                <Badge>{p.status}</Badge>
                              </div>
                              <h3>{p.code}</h3>
                              <p className="pallet-origin">
                                <strong>{group.name}</strong>
                                <span>
                                  Lote: {o.lot?.code || "Pendiente de informar"}
                                </span>
                                {o.reception && (
                                  <span>
                                    Recepción: {dateLabel(o.reception.date)}
                                  </span>
                                )}
                              </p>
                              <strong className="big-number">
                                {kg(p.net_kg)} <small>kg netos</small>
                              </strong>
                              <p>
                                Destino: <strong>{p.destination}</strong>
                              </p>
                              <p className="hint">
                                AFIDI:{" "}
                                <strong>
                                  {p.metadata?.export_label?.afidi?.trim() ||
                                    "No informado"}
                                </strong>
                              </p>
                              <p className="hint">
                                Bruto: {kg(palletWeightDetails(p).grossKg)} kg
                                {palletWeightDetails(p).grossCalculated
                                  ? " (calculado)"
                                  : ""}{" "}
                                · Tara: {kg(palletWeightDetails(p).tareKg)} kg
                              </p>
                              <div className="row">
                                <button
                                  className="button primary pallet-label-button"
                                  disabled={p.status === "Cancelado"}
                                  onClick={() => setLabel(p)}
                                >
                                  <FileText size={16} />
                                  Etiqueta / QR
                                </button>
                                <button
                                  className="link"
                                  onClick={() =>
                                    setSelectedReception(
                                      item?.reception_id ?? null,
                                    )
                                  }
                                >
                                  Origen <ArrowRight size={16} />
                                </button>
                              </div>
                              {can(role, "correct") &&
                                !["Expedido", "Cancelado"].includes(p.status) &&
                                !data.shipment_pallets.some(
                                  (sp) => sp.pallet_id === p.id,
                                ) && (
                                  <div className="pallet-correction-actions">
                                    <button
                                      className="button secondary"
                                      disabled={busy || palletSaving}
                                      onClick={() => {
                                        setError("");
                                        setEditingPalletId(p.id);
                                        setEditingPalletRevision(
                                          workspace.revision,
                                        );
                                        setDialog("edit_pallet");
                                      }}
                                    >
                                      <Pencil size={18} /> Editar pallet
                                    </button>
                                    <button
                                      className="button secondary"
                                      disabled={busy || palletSaving}
                                      onClick={() => {
                                        setError("");
                                        setEditingPalletId(p.id);
                                        setEditingPalletRevision(
                                          workspace.revision,
                                        );
                                        setDialog("cancel_pallet");
                                      }}
                                    >
                                      <X size={18} /> Cancelar pallet
                                    </button>
                                  </div>
                                )}
                              {p.status === "Cancelado" && (
                                <p className="hint">
                                  Registro conservado en el historial. No cuenta
                                  en los totales ni permite imprimir etiqueta.
                                </p>
                              )}
                              {p.status !== "Expedido" &&
                                p.status !== "Cancelado" &&
                                can(role, "pallet") && (
                                  <button
                                    className="button secondary full"
                                    disabled={
                                      busy || p.status === "Listo para carga"
                                    }
                                    onClick={() =>
                                      void run(() =>
                                        commit((d) => {
                                          allowed("pallet");
                                          const value = d.pallets.find(
                                            (x) => x.id === p.id,
                                          )!;
                                          const before = structuredClone(value);
                                          value.status = "Listo para carga";
                                          value.updated_at = now();
                                          record(
                                            d,
                                            "pallets",
                                            value.id,
                                            "Pallet listo para carga",
                                            before,
                                            value,
                                          );
                                        }),
                                      )
                                    }
                                  >
                                    Marcar listo para carga
                                  </button>
                                )}
                              {attachments("pallets", p.id)}
                            </section>
                          );
                        })}
                      </div>
                    </section>
                  ))
                ) : (
                  <Empty>
                    {palletToken
                      ? "No se encontró este pallet en su organización."
                      : !activePalletProducerId
                        ? "Seleccione un productor para ver sus pallets y abrir Etiqueta / QR."
                        : data.pallets.length
                          ? "No hay pallets con estos filtros. Cambie el productor o la búsqueda."
                          : "Cree el primer pallet después de clasificar una recepción."}
                  </Empty>
                )}
              </div>
            </>
          )}
          {page === "Expedición" && (
            <>
              <div className="toolbar">
                <p>{data.shipments.length} expediciones registradas</p>
                {newButton("Nueva expedición", "shipment", "ship")}
              </div>
              {data.shipments.length ? (
                data.shipments.map((s) => {
                  const pallets = data.pallets.filter((p) =>
                    data.shipment_pallets.some(
                      (i) => i.shipment_id === s.id && i.pallet_id === p.id,
                    ),
                  );
                  return (
                    <section className="panel shipment-card" key={s.id}>
                      <div className="section-heading">
                        <div>
                          <Badge>{s.status}</Badge>
                          <h2>
                            {s.destination} · {s.country}
                          </h2>
                          <p>
                            {dateLabel(s.departure)} · {s.plate} · {s.driver}
                          </p>
                        </div>
                        <strong className="big-number">
                          {kg(pallets.reduce((a, p) => a + p.net_kg, 0))}{" "}
                          <small>kg</small>
                        </strong>
                      </div>
                      <p>
                        {s.customer || "Sin cliente registrado"} ·{" "}
                        {s.carrier || "Sin transportadora"}
                      </p>
                      <div className="record-list">
                        {pallets.map((p) => (
                          <button
                            key={p.id}
                            className="record"
                            onClick={() => setLabel(p)}
                          >
                            <Box size={18} />
                            <span>{p.code}</span>
                            <strong>{kg(p.net_kg)} kg</strong>
                          </button>
                        ))}
                      </div>
                      <button
                        className="button secondary"
                        onClick={() =>
                          void run(async () => {
                            printReport(
                              "Resumen de carga · " + s.destination,
                              ["Pallet", "Productor", "Lote", "Kg"],
                              pallets.map((p) => {
                                const o = origin(
                                  data,
                                  data.pallet_items.find(
                                    (i) => i.pallet_id === p.id,
                                  )?.reception_id ?? "",
                                );
                                return [
                                  p.code,
                                  o.producer?.name ?? "",
                                  o.lot?.code ?? "",
                                  p.net_kg,
                                ];
                              }),
                            );
                          }, "Resumen preparado para impresión.")
                        }
                      >
                        <FileText size={16} />
                        Resumen de carga / PDF
                      </button>
                      {attachments("shipments", s.id)}
                    </section>
                  );
                })
              ) : (
                <Empty>
                  No hay expediciones. Marque los pallets listos para carga.
                </Empty>
              )}
            </>
          )}
          {page === "Informes" && (
            <Reports
              data={data}
              trapInstallations={workspace.trapInstallations ?? []}
              trapsEnabled={Boolean(workspace.features?.trap_installations)}
              onError={setError}
            />
          )}
          <footer>
            Peso siempre en kg · Fechas del Paraguay ·{" "}
            {workspace.localOnly
              ? "Datos reales · local"
              : "Organización protegida por acceso autenticado"}
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navegación principal">
        {nav.map((n) => (
          <button
            key={n.name}
            className={page === n.name ? "active" : ""}
            onClick={() => {
              setPage(n.name);
              setSelectedReception(null);
              setSelectedProducer(null);
              setSearch("");
            }}
          >
            <n.icon size={20} />
            <span>{n.name}</span>
          </button>
        ))}
      </nav>
      {dialog && (
        <Modal
          title={
            {
              producer: editingProducer
                ? "Editar productor"
                : "Nuevo productor",
              plot: "Nueva propiedad y parcela",
              reception: "Nueva recepción",
              edit_reception: "Editar recepción y pesos",
              cancel_reception: "Eliminar recepción",
              weight: "Registrar pesaje",
              classification: "Registrar pérdidas / selección",
              pallet: "Crear pallet",
              edit_export: "Editar etiqueta antes de imprimir",
              edit_pallet: "Editar pallet",
              cancel_pallet: "Cancelar pallet",
              shipment: "Nueva expedición",
              settings: "Configuración",
            }[dialog]
          }
          onClose={() => {
            if (!palletSaveLock.current && !receptionSaveLock.current) close();
          }}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {(dialog === "edit_pallet" || dialog === "cancel_pallet") &&
            editingPallet && (
              <PalletCorrection
                key={`${org}:${user ?? "local"}:${editingPallet.id}:${editingPalletRevision}:${dialog}`}
                data={data}
                pallet={editingPallet}
                action={dialog === "cancel_pallet" ? "cancel" : "edit"}
                busy={busy || palletSaving}
                activated={palletCorrectionEnabled}
                blockedReason={palletCorrectionBlocked}
                onSubmit={savePalletCorrection}
                onRefresh={sync}
                onCancel={close}
              />
            )}
          {dialog === "producer" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void run(async () => {
                  if (editingProducerId && !editingProducer)
                    throw new Error("El productor ya no está disponible.");
                  allowed(editingProducer ? "correct" : "catalog");
                  if (!text(form, "name"))
                    throw new Error("Ingrese el nombre del productor.");
                  const p = {
                    ...(editingProducer ??
                      base(org, text(form, "status"), user)),
                    updated_at: now(),
                    status: text(form, "status"),
                    name: text(form, "name"),
                    document: text(form, "document"),
                    phone: text(form, "phone"),
                    community: text(form, "community"),
                    address: text(form, "address"),
                    notes: text(form, "notes"),
                    ...(exportFieldsEnabled
                      ? {
                          metadata: {
                            ...editingProducer?.metadata,
                            export_code: text(form, "export_code"),
                            export_origin: text(form, "export_origin"),
                          },
                        }
                      : {}),
                  };
                  await commit((d) => {
                    if (editingProducer) {
                      const reason = text(form, "reason");
                      if (!reason)
                        throw new Error("Indique el motivo de la corrección.");
                      const existing = d.producers.find(
                        (x) => x.id === editingProducer.id,
                      );
                      if (!existing)
                        throw new Error("El productor ya no está disponible.");
                      if (
                        existing.name === p.name &&
                        existing.document === p.document &&
                        existing.phone === p.phone &&
                        existing.community === p.community &&
                        existing.address === p.address &&
                        existing.status === p.status &&
                        existing.notes === p.notes &&
                        (existing.metadata?.export_code ?? "") ===
                          (p.metadata?.export_code ?? "") &&
                        (existing.metadata?.export_origin ?? "") ===
                          (p.metadata?.export_origin ?? "")
                      )
                        throw new Error(
                          "Cambie al menos un dato para guardar.",
                        );
                      const before = structuredClone(existing);
                      Object.assign(existing, {
                        updated_at: p.updated_at,
                        status: p.status,
                        name: p.name,
                        document: p.document,
                        phone: p.phone,
                        community: p.community,
                        address: p.address,
                        notes: p.notes,
                        ...(exportFieldsEnabled
                          ? { metadata: p.metadata }
                          : {}),
                      });
                      record(
                        d,
                        "producers",
                        p.id,
                        "Productor corregido",
                        before,
                        structuredClone(existing),
                        reason,
                      );
                    } else {
                      d.producers.push(p);
                      record(d, "producers", p.id, "Productor creado", null, p);
                    }
                  });
                }).then((saved) => {
                  if (saved && returnToReception) {
                    setReturnToReception(false);
                    setDialog("reception");
                  }
                });
              }}
            >
              <Field label="Nombre del productor *">
                <input
                  name="name"
                  required
                  autoFocus
                  defaultValue={editingProducer?.name}
                />
              </Field>
              <Field label="Código interno Agronorte">
                <input
                  readOnly
                  value={
                    editingProducer?.metadata?.internal_code?.trim() ||
                    "Pendiente de asignar"
                  }
                />
              </Field>
              <p className="hint">
                Identificación interna de Agronorte. Se asigna automáticamente
                al sincronizar y permanece vinculada al productor.
              </p>
              {!!editingProducer?.metadata?.trap_reference_codes?.length && (
                <Field label="Código del productor (SPE/CAN)">
                  <input
                    readOnly
                    value={editingProducer.metadata.trap_reference_codes.join(
                      " / ",
                    )}
                  />
                </Field>
              )}
              {editingProducer?.metadata?.harvest_reference && (
                <Field label="Cosecha informada en la planilla">
                  <input
                    readOnly
                    value={`${dateLabel(editingProducer.metadata.harvest_reference.date)} · ${editingProducer.metadata.harvest_reference.status}`}
                  />
                </Field>
              )}
              <div className="form-grid">
                <Field label="Documento / RUC / CI">
                  <input
                    name="document"
                    defaultValue={editingProducer?.document}
                  />
                </Field>
                <Field label="Teléfono">
                  <input
                    name="phone"
                    type="tel"
                    defaultValue={editingProducer?.phone}
                  />
                </Field>
              </div>
              <Field label="Comunidad / localidad">
                <input
                  name="community"
                  defaultValue={editingProducer?.community}
                />
              </Field>
              <Field label="Dirección o referencia">
                <input name="address" defaultValue={editingProducer?.address} />
              </Field>
              <Field label="Estado">
                <select
                  name="status"
                  defaultValue={editingProducer?.status ?? "Activo"}
                >
                  <option>Activo</option>
                  <option>Inactivo</option>
                </select>
              </Field>
              <Field label="Observaciones">
                <textarea name="notes" defaultValue={editingProducer?.notes} />
              </Field>
              <details className="optional-fields">
                <summary>Datos para etiqueta de exportación</summary>
                <p className="hint">
                  Complete los datos confirmados del productor. No se usa el
                  documento personal como código de exportación.
                </p>
                {!exportFieldsEnabled && (
                  <p className="hint">
                    El administrador debe activar la actualización de etiquetas
                    en Supabase.
                  </p>
                )}
                <Field label="Código de exportación (si corresponde)">
                  <input
                    name="export_code"
                    maxLength={100}
                    defaultValue={editingProducer?.metadata?.export_code}
                    disabled={!exportFieldsEnabled}
                  />
                </Field>
                <Field label="Origen confirmado (departamento / país)">
                  <input
                    name="export_origin"
                    maxLength={200}
                    defaultValue={editingProducer?.metadata?.export_origin}
                    disabled={!exportFieldsEnabled}
                  />
                </Field>
              </details>
              {editingProducer && (
                <Field label="Motivo de la corrección *">
                  <textarea
                    name="reason"
                    required
                    placeholder="Explique qué datos se corrigieron y por qué"
                  />
                </Field>
              )}
              <Submit disabled={busy}>
                {editingProducer ? "Guardar cambios" : "Guardar productor"}
              </Submit>
            </form>
          )}
          {dialog === "plot" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void run(async () => {
                  allowed("catalog");
                  const producerId = text(form, "producer");
                  const farm = {
                    ...base(org, "Activo", user),
                    producer_id: producerId,
                    name: text(form, "farm"),
                    location: text(form, "location"),
                  };
                  const plot = {
                    ...base(org, "Activo", user),
                    farm_id: farm.id,
                    name: text(form, "name"),
                    location: text(form, "location"),
                    area_ha: optionalNumber(form, "area"),
                    crop: "Sandía",
                    variety: text(form, "variety"),
                    planting_date: text(form, "planting") || null,
                    harvest_date: text(form, "harvest") || null,
                    notes: text(form, "notes"),
                  };
                  await commit((d) => {
                    if (
                      !d.producers.some(
                        (p) => p.id === producerId && p.status === "Activo",
                      )
                    )
                      throw new Error("Seleccione un productor activo.");
                    d.farms.push(farm);
                    d.plots.push(plot);
                    record(d, "plots", plot.id, "Parcela creada", null, plot);
                  });
                }).then((saved) => {
                  if (saved && returnToReception) {
                    setReturnToReception(false);
                    setDialog("reception");
                  }
                });
              }}
            >
              <Field label="Productor *">
                <select name="producer" required>
                  <option value="">Seleccione</option>
                  {data.producers
                    .filter((p) => p.status === "Activo")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Nombre de la propiedad *">
                <input name="farm" required />
              </Field>
              <Field label="Nombre / número de parcela *">
                <input name="name" required />
              </Field>
              <Field label="Ubicación / referencia">
                <input name="location" />
              </Field>
              <div className="form-grid">
                <Field label="Área aproximada (ha)">
                  <NumericInput name="area" inputMode="decimal" />
                </Field>
                <Field label="Variedad">
                  <input name="variety" />
                </Field>
                <Field label="Fecha de plantación">
                  <input type="date" name="planting" />
                </Field>
                <Field label="Cosecha prevista">
                  <input type="date" name="harvest" />
                </Field>
              </div>
              <Field label="Observaciones técnicas">
                <textarea name="notes" />
              </Field>
              <Submit disabled={busy} />
            </form>
          )}
          {dialog === "reception" && (
            <ReceptionForm
              data={data}
              busy={busy}
              draftKey={
                draftKey + (selectedProducer ? ":" + selectedProducer : "")
              }
              initialProducerId={selectedProducer ?? ""}
              actor={actor}
              allowSelection={can(role, "classify")}
              onQuickCreate={(type) => {
                setEditingProducerId(null);
                setEditingReceptionId(null);
                setReturnToReception(true);
                setDialog(type);
              }}
              onSave={async (values) => {
                await run(async () => {
                  allowed("receive");
                  await commit((d) => {
                    const selection = values.classifyNow
                      ? intakeSelection(
                          summary(values.weights).total,
                          values.rejectedKg,
                          values.rejectionReason,
                        )
                      : null;
                    if (selection) allowed("classify");
                    const plot = d.plots.find((p) => p.id === values.plotId);
                    const selected = d.producers.find(
                      (p) =>
                        p.id === values.producerId && p.status === "Activo",
                    );
                    if (!selected)
                      throw new Error("Seleccione un productor activo.");
                    if (values.plotId && !plot)
                      throw new Error("Seleccione una parcela válida.");
                    if (
                      plot &&
                      d.farms.find((f) => f.id === plot.farm_id)
                        ?.producer_id !== selected.id
                    )
                      throw new Error("La parcela pertenece a otro productor.");
                    let lot = d.field_lots.find((l) => l.id === values.lotId);
                    if (
                      lot &&
                      ((lot.plot_id !== null &&
                        lot.plot_id !== values.plotId) ||
                        (lot.producer_id && lot.producer_id !== selected.id))
                    )
                      throw new Error("El lote pertenece a otro origen.");
                    if (lot && ["Expedido", "Rechazado"].includes(lot.status))
                      throw new Error("El lote está cerrado.");
                    if (!lot) {
                      if (
                        values.lotCode.trim() &&
                        d.field_lots.some(
                          (l) => l.code === values.lotCode.trim(),
                        )
                      )
                        throw new Error("Ya existe un lote con este código.");
                      lot = {
                        ...base(org, "En recepción", user),
                        plot_id: plot?.id ?? null,
                        producer_id: selected.id,
                        code: values.lotCode.trim() || code("SAN"),
                        crop: "Sandía",
                        variety: plot?.variety ?? "",
                        harvest_date: values.harvest || null,
                        notes: "",
                      };
                      d.field_lots.push(lot);
                      record(d, "field_lots", lot.id, "Lote creado", null, lot);
                    }
                    const r = {
                      ...base(org, "Confirmado", user),
                      lot_id: lot.id,
                      date: values.date,
                      responsible: values.responsible,
                      notes: values.notes,
                    };
                    d.receptions.push(r);
                    values.weights.forEach((weight, i) =>
                      d.reception_weights.push({
                        ...base(org, "Activo", user),
                        reception_id: r.id,
                        sequence: i + 1,
                        kg: weight,
                        operator: values.responsible,
                        notes: "",
                        correction_reason: "",
                      }),
                    );
                    if (selection) {
                      const classification = {
                        ...base(org, "Activo", user),
                        reception_id: r.id,
                        approved_kg: selection.approved,
                        rejected_kg: selection.rejected,
                        approved_count: null,
                        rejected_count: null,
                        reason:
                          selection.rejected > 0 ? values.rejectionReason : "",
                        size: "",
                        quality: null,
                        notes: "Selección registrada al recibir la carga.",
                        region:
                          values.region ||
                          selected.community ||
                          plot?.location ||
                          "",
                        pest_observation: values.pestObservation,
                        symptoms: values.symptoms,
                      };
                      d.classifications.push(classification);
                      lot.status =
                        selection.approved === 0
                          ? "Rechazado"
                          : selection.rejected > 0
                            ? "Parcialmente rechazado"
                            : "En pesaje";
                      record(
                        d,
                        "classifications",
                        classification.id,
                        "Clasificación registrada",
                        null,
                        classification,
                      );
                    }
                    for (const photo of values.photos ?? []) {
                      const attachment = {
                        ...base(org, "Activo", user),
                        id: photo.id,
                        entity_type: "receptions" as const,
                        entity_id: r.id,
                        name: photo.name,
                        mime: photo.mime,
                        size: photo.size,
                        storage_path:
                          org +
                          "/" +
                          photo.id +
                          "/" +
                          photo.name.replace(/[^a-zA-Z0-9._-]/g, "_"),
                      };
                      d.attachments.push(attachment);
                      record(
                        d,
                        "attachments",
                        attachment.id,
                        "Adjunto agregado",
                        null,
                        { name: photo.name },
                      );
                    }
                    record(d, "receptions", r.id, "Recepción creada", null, {
                      ...r,
                      total_kg: summary(values.weights).total,
                    });
                  });
                  await clearDraft(
                    draftKey + (selectedProducer ? ":" + selectedProducer : ""),
                  );
                });
              }}
            />
          )}
          {(dialog === "edit_reception" || dialog === "cancel_reception") &&
            editingReception && (
              <ReceptionManagement
                key={
                  org +
                  ":" +
                  (user ?? "local") +
                  ":" +
                  editingReception.id +
                  ":" +
                  editingReceptionRevision +
                  ":" +
                  dialog
                }
                data={data}
                reception={editingReception}
                action={dialog === "cancel_reception" ? "cancel" : "edit"}
                busy={busy || receptionSaving}
                activated={receptionManagementEnabled}
                blockedReason={receptionManagementBlocked}
                onSubmit={saveReceptionManagement}
                onRefresh={sync}
                onCancel={close}
              />
            )}
          {dialog === "weight" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void run(async () => {
                  allowed("weigh");
                  const id = text(form, "reception");
                  const weight = parseKg(text(form, "kg"));
                  await commit((d) => {
                    if (
                      d.classifications.some(
                        (c) =>
                          c.reception_id === id && c.status !== "Cancelado",
                      )
                    )
                      throw new Error(
                        "La recepción ya está clasificada. Solicite una corrección al gestor.",
                      );
                    if (
                      !d.receptions.some(
                        (r) => r.id === id && r.status !== "Cancelado",
                      )
                    )
                      throw new Error("Seleccione una recepción activa.");
                    const w = {
                      ...base(org, "Activo", user),
                      reception_id: id,
                      sequence:
                        Math.max(
                          0,
                          ...d.reception_weights
                            .filter((w) => w.reception_id === id)
                            .map((w) => w.sequence),
                        ) + 1,
                      kg: weight,
                      operator: text(form, "operator"),
                      notes: text(form, "notes"),
                      correction_reason: "",
                    };
                    d.reception_weights.push(w);
                    record(
                      d,
                      "reception_weights",
                      w.id,
                      "Pesaje registrado",
                      null,
                      w,
                    );
                  });
                });
              }}
            >
              <Field label="Recepción / lote *">
                <select
                  name="reception"
                  defaultValue={selectedReception ?? ""}
                  required
                >
                  <option value="">Seleccione</option>
                  {data.receptions
                    .filter((r) => r.status !== "Cancelado")
                    .map((r) => (
                      <option value={r.id} key={r.id}>
                        {origin(data, r.id).producer?.name} ·{" "}
                        {origin(data, r.id).lot?.code}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Peso (kg) *">
                <NumericInput
                  name="kg"
                  inputMode="decimal"
                  required
                  autoFocus
                  placeholder="0,00"
                />
              </Field>
              <Field label="Operador *">
                <input name="operator" defaultValue={actor} required />
              </Field>
              <Field label="Observación">
                <textarea name="notes" />
              </Field>
              <Submit disabled={busy}>Registrar pesaje</Submit>
            </form>
          )}
          {dialog === "classification" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void run(async () => {
                  allowed("classify");
                  const id = text(form, "reception");
                  const approved = number(form, "approved");
                  const rejected = number(form, "rejected");
                  await commit((d) => {
                    assertClassification(d, id, approved, rejected);
                    if (
                      d.classifications.some(
                        (c) =>
                          c.reception_id === id && c.status !== "Cancelado",
                      )
                    )
                      throw new Error(
                        "Esta recepción ya tiene una clasificación.",
                      );
                    if (rejected > 0 && !text(form, "reason"))
                      throw new Error("Indique el motivo de rechazo.");
                    const c = {
                      ...base(org, "Activo", user),
                      reception_id: id,
                      approved_kg: approved,
                      rejected_kg: rejected,
                      approved_count: optionalNumber(form, "approved_count"),
                      rejected_count: optionalNumber(form, "rejected_count"),
                      reason: text(form, "reason"),
                      size: text(form, "size"),
                      quality: optionalNumber(form, "quality"),
                      notes: text(form, "notes"),
                      region: text(form, "region"),
                      pest_observation: text(form, "pest_observation"),
                      symptoms: text(form, "symptoms"),
                    };
                    d.classifications.push(c);
                    const lot = d.field_lots.find(
                      (l) =>
                        l.id === d.receptions.find((r) => r.id === id)?.lot_id,
                    );
                    if (lot)
                      lot.status =
                        approved === 0
                          ? "Rechazado"
                          : rejected > 0
                            ? "Parcialmente rechazado"
                            : "En pesaje";
                    record(
                      d,
                      "classifications",
                      c.id,
                      "Clasificación registrada",
                      null,
                      c,
                    );
                  });
                });
              }}
            >
              <LossFields
                data={data}
                receptionId={selectedReception}
                producerId={selectedProducer}
              />
              <Submit
                disabled={
                  busy ||
                  !data.receptions.some(
                    (r) =>
                      r.status !== "Cancelado" &&
                      (!selectedProducer ||
                        origin(data, r.id).producer?.id === selectedProducer) &&
                      !data.classifications.some(
                        (c) =>
                          c.reception_id === r.id && c.status !== "Cancelado",
                      ),
                  )
                }
              >
                Guardar selección / pérdidas
              </Submit>
            </form>
          )}
          {dialog === "pallet" && (
            <PalletForm
              data={data}
              actor={actor}
              busy={busy}
              exportFieldsEnabled={exportFieldsEnabled}
              importerFieldsEnabled={importerFieldsEnabled}
              tareEnabled={palletTareEnabled}
              selectedReception={selectedReception}
              onSave={async (form) => {
                await run(async () => {
                  allowed("pallet");
                  const id = text(form, "reception");
                  const net = number(form, "net");
                  if (!palletTareEnabled)
                    throw new Error(
                      "Active la actualización SQL de tara antes de crear pallets.",
                    );
                  const gross = palletGrossKg(net);
                  const count = number(form, "count");
                  const exportFields = exportLabelFromForm(form);
                  assertExportDestination(
                    exportFields,
                    text(form, "destination"),
                  );
                  if (!Number.isInteger(count) || count < 1 || count > 100)
                    throw new Error("Use entre 1 y 100 pallets.");
                  await commit((d) => {
                    assertPallet(
                      d,
                      id,
                      round(net * count),
                      gross === null ? null : round(gross * count),
                    );
                    for (let i = 0; i < count; i++) {
                      const p = {
                        ...base(org, "En armado", user),
                        code: code("PAL"),
                        token: crypto.randomUUID(),
                        destination: text(form, "destination"),
                        assembled_at: now(),
                        weighed_date: text(form, "weighed_date") || null,
                        responsible: text(form, "responsible"),
                        gross_kg: gross,
                        tare_kg: DEFAULT_PALLET_TARE_KG,
                        net_kg: net,
                        fruit_count: optionalNumber(form, "fruits"),
                        notes: text(form, "notes"),
                        ...(exportFieldsEnabled
                          ? {
                              metadata: {
                                export_label: exportFields,
                              },
                            }
                          : {}),
                      };
                      d.pallets.push(p);
                      d.pallet_items.push({
                        ...base(org, "Activo", user),
                        pallet_id: p.id,
                        reception_id: id,
                        kg: net,
                      });
                      record(d, "pallets", p.id, "Pallet creado", null, p);
                    }
                    const lot = d.field_lots.find(
                      (l) =>
                        l.id === d.receptions.find((r) => r.id === id)?.lot_id,
                    );
                    if (lot) lot.status = "Palletizado";
                  });
                });
              }}
            />
          )}
          {dialog === "edit_export" && currentLabel && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                void (async () => {
                  setError("");
                  setLabelSaving(true);
                  try {
                    allowed("pallet");
                    const current = data.pallets.find(
                      (p) => p.id === currentLabel.id,
                    );
                    if (
                      !current ||
                      ["Expedido", "Cancelado"].includes(current.status)
                    )
                      throw new Error("El pallet está cerrado.");
                    if (
                      data.shipment_pallets.some(
                        (link) => link.pallet_id === current.id,
                      )
                    )
                      throw new Error(
                        "El pallet está vinculado a una expedición. Revise la carga antes de corregir la etiqueta.",
                      );
                    const reason = text(form, "export_reason");
                    if (!reason)
                      throw new Error(
                        "Indique el motivo del registro o corrección.",
                      );
                    const fields = exportLabelFromForm(
                      form,
                      current.metadata?.export_label,
                    );
                    const canEditDestination =
                      workspace.localOnly ||
                      Boolean(workspace.features?.label_destination_edit);
                    const destination = canEditDestination
                      ? text(form, "label_destination")
                      : current.destination;
                    if (!destination)
                      throw new Error("Indique el destino del pallet.");
                    assertExportDestination(fields, destination);
                    if (workspace.localOnly) {
                      await commit((draft) => {
                        const pallet = draft.pallets.find(
                          (p) => p.id === currentLabel.id,
                        )!;
                        const before = structuredClone(pallet);
                        const labelChanged =
                          pallet.destination !== destination ||
                          JSON.stringify(
                            pallet.metadata?.export_label ?? {},
                          ) !== JSON.stringify(fields);
                        pallet.metadata = {
                          ...pallet.metadata,
                          export_label: fields,
                        };
                        pallet.destination = destination;
                        if (labelChanged) pallet.status = "En armado";
                        pallet.updated_at = now();
                        record(
                          draft,
                          "pallets",
                          pallet.id,
                          "Datos de etiqueta corregidos",
                          before,
                          structuredClone(pallet),
                          reason,
                        );
                      });
                    } else {
                      if (!online)
                        throw new Error(
                          "Conéctese para guardar los datos de exportación.",
                        );
                      if (!exportFieldsEnabled)
                        throw new Error(
                          "Active la actualización SQL de etiquetas en Supabase.",
                        );
                      if (workspace.pending || workspace.needsRefresh)
                        throw new Error(
                          "Sincronice primero para conservar los registros pendientes.",
                        );
                      if (canEditDestination) {
                        await updatePalletLabelDetails(
                          current.id,
                          fields,
                          destination,
                          reason,
                          workspace.revision,
                        );
                      } else {
                        await updatePalletExportLabel(
                          current.id,
                          fields,
                          reason,
                          workspace.revision,
                        );
                      }
                      if (!workspace.profile)
                        throw new Error(
                          "Su sesión cambió. Abra nuevamente el pallet.",
                        );
                      await reload(true, {
                        userId: workspace.profile.user_id,
                        organizationId: workspace.organizationId,
                      });
                    }
                    setDialog(null);
                    setMessage(
                      "Etiqueta guardada con historial. Revise la vista previa antes de imprimir.",
                    );
                  } catch (problem) {
                    setError(getErrorMessage(problem, "No se pudo guardar."));
                  } finally {
                    setLabelSaving(false);
                  }
                })();
              }}
            >
              <div className="setting-info">
                <FileText />
                <div>
                  <strong>{currentLabel.code}</strong>
                  <p>{kg(currentLabel.net_kg)} kg netos · Sandía</p>
                  <p className="hint">
                    El peso y los códigos de trazabilidad provienen del registro
                    del pallet.
                  </p>
                </div>
              </div>
              <p className="hint">
                Complete los datos confirmados. Al guardar, volverá a la
                etiqueta para revisar e imprimir el modelo A4.
              </p>
              {!exportFieldsEnabled && (
                <div className="setting-info" role="status">
                  <div>
                    <strong>Edición pendiente de activar</strong>
                    <p>
                      El administrador debe ejecutar la actualización de
                      etiquetas en el proyecto Supabase de este sistema.
                      Después, cierre esta ventana y sincronice.
                    </p>
                  </div>
                </div>
              )}
              <Field label="Destino del pallet *">
                <input
                  name="label_destination"
                  maxLength={200}
                  required
                  defaultValue={currentLabel.destination}
                  readOnly={
                    !workspace.localOnly &&
                    !workspace.features?.label_destination_edit
                  }
                />
              </Field>
              {!workspace.localOnly &&
                !workspace.features?.label_destination_edit && (
                  <p className="hint">
                    La edición del destino requiere la actualización de
                    etiquetas del administrador.
                  </p>
                )}
              <ExportLabelFields
                value={palletLabelEditValues(data, currentLabel)}
                importerEnabled={importerFieldsEnabled}
              />
              <Field label="Motivo del registro o corrección *">
                <textarea
                  name="export_reason"
                  required
                  maxLength={1000}
                  placeholder="Ej.: completar AFIDI y fecha de envasado"
                />
              </Field>
              <Submit
                disabled={
                  busy ||
                  labelSaving ||
                  !exportFieldsEnabled ||
                  (!workspace.localOnly &&
                    (!online || workspace.pending || workspace.needsRefresh))
                }
              >
                {labelSaving ? "Guardando…" : "Guardar y ver etiqueta"}
              </Submit>
              {!workspace.localOnly &&
                (!online || workspace.pending || workspace.needsRefresh) && (
                  <p className="hint">
                    Conéctese y sincronice los registros para guardar la
                    etiqueta.
                  </p>
                )}
              <button
                type="button"
                className="button secondary full"
                disabled={labelSaving}
                onClick={() => setDialog(null)}
              >
                Volver a la etiqueta
              </button>
            </form>
          )}
          {dialog === "shipment" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void run(
                  async () => {
                    allowed("ship");
                    if (!workspace.localOnly && !online)
                      throw new Error(
                        "La expedición requiere conexión para validar la disponibilidad.",
                      );
                    if (!workspace.localOnly && workspace.pending)
                      throw new Error(
                        "Sincronice los pallets listos antes de registrar una expedición.",
                      );
                    const ids = new FormData(form)
                      .getAll("pallets")
                      .map(String);
                    if (!ids.length)
                      throw new Error("Seleccione al menos un pallet.");
                    await commit((d) => {
                      const destination = text(form, "destination");
                      for (const id of ids) {
                        const p = d.pallets.find((p) => p.id === id);
                        if (
                          !p ||
                          p.status !== "Listo para carga" ||
                          p.destination !== destination ||
                          d.shipment_pallets.some((i) => i.pallet_id === id)
                        )
                          throw new Error(
                            "Seleccione pallets disponibles y con el mismo destino.",
                          );
                      }
                      const s = {
                        ...base(org, "Expedido", user),
                        destination,
                        country: text(form, "country"),
                        customer: text(form, "customer"),
                        carrier: text(form, "carrier"),
                        driver: text(form, "driver"),
                        plate: text(form, "plate"),
                        departure: text(form, "date"),
                        responsible: text(form, "responsible"),
                        notes: text(form, "notes"),
                      };
                      d.shipments.push(s);
                      ids.forEach((id) => {
                        d.shipment_pallets.push({
                          ...base(org, "Activo", user),
                          shipment_id: s.id,
                          pallet_id: id,
                        });
                        const p = d.pallets.find((p) => p.id === id)!;
                        p.status = "Expedido";
                        p.updated_at = now();
                      });
                      for (const lot of d.field_lots) {
                        const rs = d.receptions.filter(
                          (r) => r.lot_id === lot.id,
                        );
                        const items = d.pallet_items.filter((i) =>
                          rs.some((r) => r.id === i.reception_id),
                        );
                        if (
                          items.length &&
                          rs.every((r) => available(d, r.id) === 0) &&
                          items.every(
                            (i) =>
                              d.pallets.find((p) => p.id === i.pallet_id)
                                ?.status === "Expedido",
                          )
                        )
                          lot.status = "Expedido";
                      }
                      record(
                        d,
                        "shipments",
                        s.id,
                        "Expedición registrada",
                        null,
                        { ...s, pallets: ids },
                      );
                    });
                  },
                  workspace.localOnly
                    ? "Expedición guardada en este dispositivo."
                    : "Expedición guardada localmente. Compruebe la sincronización antes de liberar la carga.",
                );
              }}
            >
              <div className="form-grid">
                <Field label="Destino *">
                  <input name="destination" defaultValue="Uruguay" required />
                </Field>
                <Field label="País *">
                  <input name="country" defaultValue="Uruguay" required />
                </Field>
              </div>
              <Field label="Comprador / cliente">
                <input name="customer" />
              </Field>
              <Field label="Transportadora">
                <input name="carrier" />
              </Field>
              <div className="form-grid">
                <Field label="Chofer *">
                  <input name="driver" required />
                </Field>
                <Field label="Chapa del camión *">
                  <input name="plate" required />
                </Field>
              </div>
              <Field label="Fecha de salida *">
                <input name="date" type="date" defaultValue={today} required />
              </Field>
              <Field label="Responsable *">
                <input name="responsible" defaultValue={actor} required />
              </Field>
              <fieldset>
                <legend>Pallets listos para carga</legend>
                {data.pallets
                  .filter(
                    (p) =>
                      p.status === "Listo para carga" &&
                      !data.shipment_pallets.some((i) => i.pallet_id === p.id),
                  )
                  .map((p) => (
                    <label className="check-row" key={p.id}>
                      <input type="checkbox" name="pallets" value={p.id} />
                      <span>
                        {p.code}
                        <small>
                          {p.destination} · {kg(p.net_kg)} kg
                        </small>
                      </span>
                    </label>
                  ))}
              </fieldset>
              <Field label="Observaciones">
                <textarea name="notes" />
              </Field>
              <Submit disabled={busy}>Registrar expedición</Submit>
            </form>
          )}
          {dialog === "settings" && (
            <>
              <AppUpdateControls
                alwaysVisible
                online={online}
                blockedReason={
                  busy
                    ? "Espere a que termine la operación."
                    : workspace.pending || workspace.needsRefresh
                      ? "Cierre esta ventana y sincronice los registros antes de actualizar."
                      : ""
                }
              />
              <button
                className="button secondary full"
                disabled={busy}
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(workspace, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "agronorte-respaldo-" + day() + ".json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <ArrowDownToLine size={16} />
                Descargar respaldo local
              </button>
              <p className="hint">
                Sin una cuenta, los datos se guardan solo en este dispositivo.
                Con Supabase se utiliza el perfil asignado en el servidor.
              </p>
              {can(role, "correct") && (
                <details>
                  <summary>Ver respaldo JSON</summary>
                  <textarea
                    aria-label="Respaldo JSON"
                    readOnly
                    rows={6}
                    value={JSON.stringify(workspace, null, 2)}
                  />
                </details>
              )}
              <div className="setting-info">
                <CloudOff />
                <div>
                  <strong>{online ? "Con conexión" : "Sin conexión"}</strong>
                  <p>
                    {workspace.localOnly
                      ? "Datos guardados localmente en IndexedDB."
                      : "Los cambios locales requieren sincronización."}
                  </p>
                </div>
              </div>
              {!supabase ? (
                <p className="hint">
                  Supabase pendiente de configurar. Complete VITE_SUPABASE_URL y
                  VITE_SUPABASE_ANON_KEY en .env.local y aplique la migración
                  incluida. Nunca coloque una service_role en el navegador.
                </p>
              ) : workspace.localOnly ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    void run(async () => {
                      const { error } = await supabase!.auth.signInWithPassword(
                        {
                          email: text(form, "email"),
                          password: text(form, "password"),
                        },
                      );
                      if (error) throw error;
                    }, "Sesión iniciada.");
                  }}
                >
                  <Field label="Correo electrónico">
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="username"
                    />
                  </Field>
                  <Field label="Contraseña">
                    <input
                      name="password"
                      type="password"
                      required
                      autoComplete="current-password"
                    />
                  </Field>
                  <Submit>Iniciar sesión</Submit>
                </form>
              ) : (
                <button
                  className="button secondary"
                  disabled={workspace.pending || busy}
                  onClick={() =>
                    void run(async () => {
                      await supabase!.auth.signOut();
                    }, "Sesión cerrada.")
                  }
                >
                  <LogOut size={18} />
                  Cerrar sesión
                </button>
              )}
              <p className="hint">
                Para instalar en el celular: publique con HTTPS y use “Agregar a
                pantalla de inicio”. El icono utiliza el logotipo oficial de la
                cooperativa.
              </p>
            </>
          )}
        </Modal>
      )}
      {recipientAccessOpen &&
        role === "administrador" &&
        !workspace.localOnly && (
          <RecipientAccess
            pallets={data.pallets}
            onClose={() => setRecipientAccessOpen(false)}
          />
        )}
      {currentLabel && dialog !== "edit_export" && (
        <Modal title="Etiqueta y QR de pallet" onClose={close}>
          <AppUpdateControls
            online={online}
            blockedReason="Cierre la etiqueta y guarde cualquier formulario antes de actualizar la aplicación."
          />
          <Label
            data={data}
            pallet={currentLabel}
            pending={
              !workspace.localOnly &&
              Boolean(workspace.pending || workspace.needsRefresh)
            }
            busy={busy}
            online={online}
            syncError={error}
            onSync={sync}
            editActivationPending={!exportFieldsEnabled}
            onEditExport={
              can(role, "pallet") &&
              !["Expedido", "Cancelado"].includes(currentLabel.status) &&
              !data.shipment_pallets.some(
                (item) => item.pallet_id === currentLabel.id,
              )
                ? () => {
                    setError("");
                    setDialog("edit_export");
                  }
                : undefined
            }
            onPrinted={async () => {
              allowed("pallet");
              if (currentLabel.status === "Cancelado")
                throw new Error(
                  "No se puede imprimir una etiqueta de un pallet cancelado.",
                );
              if (
                !workspace.localOnly &&
                (workspace.pending || workspace.needsRefresh)
              )
                throw new Error(
                  "Sincronice antes de imprimir los códigos definitivos de lote y pallet.",
                );
              await commit((d) => {
                const p = d.pallets.find((p) => p.id === currentLabel.id);
                if (!p)
                  throw new Error(
                    "Abra nuevamente el pallet antes de imprimir.",
                  );
                if (p.status === "Cancelado")
                  throw new Error("El pallet está cancelado.");
                const before = structuredClone(p);
                if (p.status === "En armado") p.status = "Etiquetado";
                p.updated_at = now();
                record(
                  d,
                  "pallets",
                  p.id,
                  "Solicitud de impresión de etiqueta",
                  before,
                  p,
                );
              });
            }}
          />
        </Modal>
      )}
      {detail?.reception && !dialog && !label && (
        <Modal
          title={"Lote · " + detail.lot?.code}
          onClose={() => setSelectedReception(null)}
        >
          <div className="detail-summary">
            <Badge>
              {detail.reception.status === "Cancelado"
                ? "Cancelado"
                : detail.lot?.status}
            </Badge>
            <h2>{detail.producer?.name}</h2>
            <p>
              {detail.plot
                ? detail.farm?.name + " · " + detail.plot.name
                : "Parcela pendiente de informar"}
            </p>
            <strong className="big-number">
              {kg(receptionTotal(data, detail.reception.id))}{" "}
              <small>kg recibidos</small>
            </strong>
            <p>
              {dateLabel(detail.reception.date)} ·{" "}
              {detail.reception.responsible}
            </p>
          </div>
          {detail.reception.status !== "Cancelado" && (
            <>
              {can(role, "correct") && (
                <div className="producer-actions">
                  <button
                    className="button secondary full"
                    disabled={busy || receptionSaving}
                    onClick={() =>
                      openReceptionManagement(detail.reception!.id, "edit")
                    }
                  >
                    <Pencil size={18} /> Editar recepción / pesos
                  </button>
                  <button
                    className="button secondary full"
                    disabled={busy || receptionSaving}
                    onClick={() =>
                      openReceptionManagement(detail.reception!.id, "cancel")
                    }
                  >
                    <X size={18} /> Eliminar recepción
                  </button>
                </div>
              )}
              <div className="row">
                {newButton("Pesaje", "weight", "weigh", <Scale size={16} />)}
                {!data.classifications.some(
                  (c) =>
                    c.reception_id === detail.reception?.id &&
                    c.status !== "Cancelado",
                ) &&
                  newButton(
                    "Registrar pérdidas / selección",
                    "classification",
                    "classify",
                  )}
                {newButton("Pallet", "pallet", "pallet", <Box size={16} />)}
              </div>
            </>
          )}
          {detail.reception.notes && (
            <p className="hint">{detail.reception.notes}</p>
          )}
          {detail.reception.status === "Cancelado" && (
            <p className="hint">
              Recepción eliminada de los totales activos. Registros conservados
              para consulta y auditoría.
            </p>
          )}
          <h3>Pesajes</h3>
          <div className="weight-table">
            {data.reception_weights
              .filter((w) => w.reception_id === detail.reception?.id)
              .map((w) => (
                <div className="weight-row" key={w.id}>
                  <span>#{w.sequence}</span>
                  <strong>{kg(w.kg)} kg</strong>
                  <small>{w.operator}</small>
                  <Badge>{w.status}</Badge>
                  {can(role, "correct") &&
                    w.status !== "Cancelado" &&
                    detail.reception?.status !== "Cancelado" && (
                      <button
                        className="link"
                        disabled={busy || receptionSaving}
                        onClick={() =>
                          openReceptionManagement(w.reception_id, "edit")
                        }
                      >
                        Editar / quitar
                      </button>
                    )}
                </div>
              ))}
          </div>
          <h3>Clasificación</h3>
          {data.classifications
            .filter((c) => c.reception_id === detail.reception?.id)
            .map((c) => (
              <div className="panel inset" key={c.id}>
                <p>
                  Aprobado: <strong>{kg(c.approved_kg)} kg</strong> · Rechazado:{" "}
                  <strong>{kg(c.rejected_kg)} kg</strong>
                </p>
                <p>
                  Estado: {c.status} · Calidad:{" "}
                  {c.quality === null ? "Sin evaluar" : c.quality + "/5"} ·{" "}
                  {c.reason || "Sin rechazo"}
                </p>
                <p>
                  Saldo disponible:{" "}
                  <strong>{kg(available(data, c.reception_id))} kg</strong>
                </p>
              </div>
            ))}
          <h3>Pallets y destino</h3>
          {data.pallet_items
            .filter((i) => i.reception_id === detail.reception?.id)
            .map((i) => {
              const p = data.pallets.find((p) => p.id === i.pallet_id)!;
              return (
                <button
                  className="record"
                  key={i.id}
                  disabled={p.status === "Cancelado"}
                  onClick={() => setLabel(p)}
                >
                  <Box size={18} />
                  <span>
                    {p.code}
                    <small>
                      {p.destination} · {p.status}
                    </small>
                  </span>
                  <strong>{kg(i.kg)} kg</strong>
                </button>
              );
            })}
          <h3>Línea de tiempo / auditoría</h3>
          <div className="timeline">
            {data.audit_logs
              .filter((a) => {
                const reception = detail.reception!;
                return (
                  a.entity_id === reception.id ||
                  a.entity_id === reception.lot_id ||
                  data.reception_weights.some(
                    (w) =>
                      w.id === a.entity_id && w.reception_id === reception.id,
                  ) ||
                  data.classifications.some(
                    (c) =>
                      c.id === a.entity_id && c.reception_id === reception.id,
                  ) ||
                  data.pallet_items.some(
                    (i) =>
                      i.reception_id === reception.id &&
                      (i.id === a.entity_id ||
                        i.pallet_id === a.entity_id ||
                        data.shipment_pallets.some(
                          (sp) =>
                            sp.pallet_id === i.pallet_id &&
                            sp.shipment_id === a.entity_id,
                        )),
                  )
                );
              })
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map((a) => (
                <Timeline key={a.id} log={a} />
              ))}
          </div>
          {attachments("receptions", detail.reception.id)}
          <button
            className="button secondary"
            onClick={() =>
              void run(async () => {
                const rows = receptionWeightRows(data, detail.reception!.id);
                const headers = [
                  "Pesaje",
                  "Kg_registrados",
                  "Kg_activos",
                  "Operador",
                  "Estado",
                  "Motivo",
                ];
                printReport(
                  "Resumen de recepción · " +
                    detail.lot?.code +
                    " · Total activo: " +
                    kg(receptionTotal(data, detail.reception!.id)) +
                    " kg",
                  headers,
                  rows.map((row) =>
                    headers.map((header) => row[header as keyof typeof row]),
                  ),
                );
              }, "Resumen preparado.")
            }
          >
            <FileText size={16} />
            Imprimir resumen / PDF
          </button>
        </Modal>
      )}
      {producer && !dialog && !selectedReception && (
        <Modal
          title="Historial del productor"
          onClose={() => setSelectedProducer(null)}
        >
          <Badge>{producer.status}</Badge>
          <h2>{producer.name}</h2>
          <p className="hint">
            Código interno Agronorte:{" "}
            <strong>
              {producer.metadata?.internal_code?.trim() ||
                "Pendiente de asignar"}
            </strong>
          </p>
          {!!producer.metadata?.trap_reference_codes?.length && (
            <p className="hint">
              Código del productor:{" "}
              <strong>
                {producer.metadata.trap_reference_codes.join(" / ")}
              </strong>
            </p>
          )}
          {producer.metadata?.harvest_reference && (
            <section
              className="panel inset"
              aria-label="Fecha de cosecha informada"
            >
              <h3>
                Cosecha informada · {producer.metadata.harvest_reference.season}
              </h3>
              <p>
                <strong>
                  {dateLabel(producer.metadata.harvest_reference.date)}
                </strong>{" "}
                · <Badge>{producer.metadata.harvest_reference.status}</Badge>
              </p>
              <p className="hint">
                Las etiquetas usan la fecha confirmada del lote o esta
                referencia cuando corresponde a la recepción.
              </p>
              <details>
                <summary>Fuente de la fecha</summary>
                <p className="hint">
                  {producer.metadata.harvest_reference.source}
                </p>
                {producer.metadata.harvest_reference.notes.map(
                  (note, index) => (
                    <p className="hint" key={index}>
                      {note}
                    </p>
                  ),
                )}
              </details>
            </section>
          )}
          {can(role, "correct") && (
            <button
              className="button secondary full"
              disabled={busy}
              onClick={() => {
                setError("");
                setEditingProducerId(producer.id);
                setDialog("producer");
              }}
            >
              <Pencil size={18} />
              Editar productor
            </button>
          )}
          <p>
            Pérdidas registradas:{" "}
            <strong>
              {kg(producerQuality.reduce((sum, c) => sum + c.rejected_kg, 0))}{" "}
              kg
            </strong>
          </p>
          <div className="producer-actions">
            {can(role, "receive") && (
              <button
                className="button secondary full"
                onClick={() => setDialog("reception")}
              >
                Nueva recepción de este productor
              </button>
            )}
            {can(role, "classify") && (
              <button
                className="button primary full"
                onClick={() => {
                  setSelectedReception(null);
                  setDialog("classification");
                }}
              >
                Registrar pérdidas / selección
              </button>
            )}
          </div>

          <p>
            {producer.community} · {producer.phone || "Sin teléfono"}
          </p>
          <p>
            {producer.document || "Documento no registrado"} ·{" "}
            {producer.address}
          </p>
          <p>{producer.notes}</p>
          <strong className="big-number">
            {kg(
              producerReceptions.reduce(
                (s, r) => s + receptionTotal(data, r.id),
                0,
              ),
            )}{" "}
            <small>kg entregados</small>
          </strong>
          {workspace.features?.trap_installations && (
            <TrapInstallationsPanel
              records={(workspace.trapInstallations ?? []).filter(
                (record) => record.producer_id === producer.id,
              )}
            />
          )}
          <h3>Propiedades y parcelas</h3>
          {data.plots
            .filter(
              (p) =>
                data.farms.find((f) => f.id === p.farm_id)?.producer_id ===
                producer.id,
            )
            .map((p) => (
              <div className="record" key={p.id}>
                <Leaf size={18} />
                <span>
                  {data.farms.find((f) => f.id === p.farm_id)?.name} · {p.name}
                  <small>
                    {p.area_ha ?? "—"} ha · {p.variety || "Sin variedad"}
                  </small>
                </span>
              </div>
            ))}
          <h3>Entregas y lotes</h3>
          {receptionList(producerReceptions)}
          <h3>Pallets y destinos</h3>
          <p>
            <strong>
              {producerPallets.filter((p) => p.status !== "Cancelado").length}{" "}
              pallets activos ·{" "}
              {kg(
                producerPallets
                  .filter((p) => p.status !== "Cancelado")
                  .reduce(
                    (sum, p) => sum + producerAllocatedKg(data, p, producer.id),
                    0,
                  ),
              )}{" "}
              kg en pallets
            </strong>
          </p>
          <button
            className="button secondary full"
            onClick={() => {
              setPalletProducerId(producer.id);
              setPalletSearch("");
              setPalletToken(null);
              setSelectedProducer(null);
              setPage("Pallets");
            }}
          >
            <Box size={18} /> Ver / corregir pallets de este productor
          </button>
          {producerPallets.map((p) => (
            <p key={p.id}>
              {p.code} · {p.destination} · {kg(p.net_kg)} kg · {p.status}
            </p>
          ))}
          <h3>Evolución mensual</h3>
          {[...new Set(producerReceptions.map((r) => r.date.slice(0, 7)))]
            .sort()
            .map((month) => (
              <p key={month}>
                {month}:{" "}
                <strong>
                  {kg(
                    producerReceptions
                      .filter((r) => r.date.startsWith(month))
                      .reduce((s, r) => s + receptionTotal(data, r.id), 0),
                  )}{" "}
                  kg
                </strong>
              </p>
            ))}
          <h3>Pérdidas del productor</h3>
          <p className="hint">
            Cada pérdida se vincula a una entrega y su lote. Las fotos se
            adjuntan desde esa recepción.
          </p>
          <p>
            Calidad media:{" "}
            <strong>
              {producerQuality.some((c) => c.quality !== null)
                ? kg(
                    producerQuality.reduce((s, c) => s + (c.quality ?? 0), 0) /
                      producerQuality.filter((c) => c.quality !== null).length,
                  ) + " / 5"
                : "Sin evaluar"}
            </strong>{" "}
            · Rechazos:{" "}
            <strong>
              {kg(producerQuality.reduce((s, c) => s + c.rejected_kg, 0))} kg
            </strong>
          </p>
          {data.classifications
            .filter((c) =>
              producerReceptions.some((r) => r.id === c.reception_id),
            )
            .map((c) => (
              <p key={c.id}>
                <Badge>
                  {c.status === "Cancelado"
                    ? "Cancelado · historial"
                    : c.status}
                </Badge>{" "}
                Calidad {c.quality === null ? "Sin evaluar" : c.quality + "/5"}{" "}
                · {kg(c.rejected_kg)} kg rechazados ·{" "}
                {c.reason || "Sin rechazo"}
                {c.region && <span> · Región: {c.region}</span>}
                {c.pest_observation && (
                  <span> · Observación: {c.pest_observation}</span>
                )}
                {c.symptoms && <span> · {c.symptoms}</span>}
              </p>
            ))}
        </Modal>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  unit,
  icon,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  note: string;
}) {
  return (
    <article className="stat">
      <div>
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>
        {value} <small>{unit}</small>
      </strong>
      <p>{note}</p>
    </article>
  );
}
function Timeline({ log }: { log: AuditLog }) {
  return (
    <div className="timeline-item">
      <span className="timeline-dot" />
      <div>
        <strong>{log.action}</strong>
        <small>
          {dateLabel(log.created_at)} · {log.actor}
        </small>
        {log.reason && <p>{log.reason}</p>}
        {log.before !== null && (
          <details>
            <summary>Ver antes / después</summary>
            <pre>
              {JSON.stringify(
                { anterior: log.before, nuevo: log.after },
                null,
                2,
              )}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
interface DraftPhoto {
  id: string;
  name: string;
  mime: string;
  size: number;
}
interface ReceptionValues {
  producerId: string;
  plotId: string;
  lotId: string;
  lotCode: string;
  date: string;
  harvest: string;
  responsible: string;
  notes: string;
  weights: number[];
  classifyNow: boolean;
  rejectedKg: string;
  rejectionReason: string;
  region: string;
  pestObservation: string;
  symptoms: string;
  photos: DraftPhoto[];
}
function ReceptionForm({
  data,
  busy,
  draftKey,
  actor,
  allowSelection,
  initialProducerId,
  onSave,
  onQuickCreate,
}: {
  data: Data;
  busy: boolean;
  draftKey: string;
  actor: string;
  allowSelection: boolean;
  initialProducerId: string;
  onSave: (values: ReceptionValues) => Promise<void>;
  onQuickCreate: (type: "producer" | "plot") => void;
}) {
  const [values, setValues] = useState<ReceptionValues>({
    producerId: initialProducerId,
    plotId: "",
    lotId: "",
    lotCode: "",
    date: day(),
    harvest: "",
    responsible: actor,
    notes: "",
    weights: [],
    classifyNow: allowSelection,
    rejectedKg: "0",
    rejectionReason: "",
    region: "",
    pestObservation: "",
    symptoms: "",
    photos: [],
  });
  const weightRef = useRef<HTMLInputElement>(null);
  const [weight, setWeight] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  useEffect(() => {
    let active = true;
    void readDraft<ReceptionValues>(draftKey)
      .then((draft) => {
        if (active) {
          if (draft) setValues((initial) => ({ ...initial, ...draft }));
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setError("No se pudo recuperar el borrador.");
      });
    return () => {
      active = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void saveDraft(draftKey, values)
        .then(() => setDraftStatus("Borrador guardado en este dispositivo"))
        .catch(() => setError("No se pudo guardar el borrador."));
    }, 250);
    return () => clearTimeout(timer);
  }, [draftKey, values, ready]);
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
    if (weight.trim()) {
      setError("Agregue el peso pendiente con el botón + antes de guardar.");
      return;
    }
    if (!values.weights.length) {
      setError("Agregue al menos un pesaje.");
      return;
    }
    try {
      if (values.classifyNow)
        intakeSelection(s.total, values.rejectedKg, values.rejectionReason);
      void onSave(values);
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
      <Field label="Productor *">
        <select
          required
          value={values.producerId}
          onChange={(e) =>
            setValues((v) => ({
              ...v,
              producerId: e.target.value,
              plotId: "",
              lotId: "",
            }))
          }
        >
          <option value="">Seleccione un productor</option>
          {data.producers
            .filter((p) => p.status === "Activo")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {producerIdentity(p)}
              </option>
            ))}
        </select>
      </Field>
      <div className="row">
        <button
          type="button"
          className="link"
          disabled={busy || !ready}
          onClick={() =>
            void saveDraft(draftKey, values)
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
            void saveDraft(draftKey, values)
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
          onChange={(e) =>
            setValues((v) => ({ ...v, plotId: e.target.value, lotId: "" }))
          }
        >
          <option value="">Parcela pendiente de informar</option>
          {data.plots
            .filter(
              (p) =>
                data.farms.find((f) => f.id === p.farm_id)?.producer_id ===
                values.producerId,
            )
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {data.farms.find((f) => f.id === p.farm_id)?.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Lote de campo">
        <select
          value={values.lotId}
          onChange={(e) => set("lotId", e.target.value)}
        >
          <option value="">Crear un nuevo lote</option>
          {data.field_lots
            .filter(
              (l) =>
                (values.plotId
                  ? l.plot_id === values.plotId
                  : l.producer_id === values.producerId) &&
                !["Expedido", "Rechazado"].includes(l.status),
            )
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
        </select>
      </Field>
      {!values.lotId && (
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
        <Field label="Fecha de cosecha (si se conoce)">
          <input
            type="date"
            value={values.harvest}
            onChange={(e) => set("harvest", e.target.value)}
          />
        </Field>
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
    </form>
  );
}
function PalletForm({
  data,
  actor,
  busy,
  selectedReception,
  exportFieldsEnabled,
  importerFieldsEnabled,
  tareEnabled,
  onSave,
}: {
  data: Data;
  actor: string;
  busy: boolean;
  selectedReception: string | null;
  exportFieldsEnabled: boolean;
  importerFieldsEnabled: boolean;
  tareEnabled: boolean;
  onSave: (form: HTMLFormElement) => Promise<void>;
}) {
  const [id, setId] = useState(selectedReception ?? "");
  const [netWeight, setNetWeight] = useState("");
  const netNumber = /^\d+(?:[.,]\d{1,2})?$/.test(netWeight.trim())
    ? Number(netWeight.replace(",", "."))
    : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(e.currentTarget);
      }}
    >
      <Field label="Recepción clasificada *">
        <select
          name="reception"
          required
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          <option value="">Seleccione</option>
          {data.receptions
            .filter((r) => available(data, r.id) > 0)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {origin(data, r.id).producer?.name} ·{" "}
                {origin(data, r.id).lot?.code}
              </option>
            ))}
        </select>
      </Field>
      <div className="weight-summary">
        <div>
          <small>Saldo aprobado disponible</small>
          <strong>
            {kg(available(data, id))} <span>kg</span>
          </strong>
        </div>
      </div>
      <div className="form-grid">
        <Field label="Cantidad de pallets iguales *">
          <NumericInput
            name="count"
            type="number"
            required
            min="1"
            max="100"
            step="1"
            defaultValue="1"
            inputMode="numeric"
          />
        </Field>
        <Field label="Destino *">
          <input name="destination" required defaultValue="Uruguay" />
        </Field>
        <Field label="Peso neto por pallet (kg) *">
          <NumericInput
            name="net"
            inputMode="decimal"
            required
            value={netWeight}
            onChange={(e) => setNetWeight(e.target.value)}
          />
        </Field>
        <Field label="Peso bruto calculado por pallet (kg)">
          <NumericInput
            name="gross"
            inputMode="decimal"
            readOnly
            value={netNumber === null ? "" : palletGrossKg(netNumber)}
          />
        </Field>
      </div>
      <p className="hint">
        Tara del envase: 42 kg por pallet. Ingrese solo los kg netos de sandía;
        el bruto es neto + 42 kg.
      </p>
      {!tareEnabled && (
        <p className="error">
          Aplique la actualización SQL de recepciones y tara, y sincronice antes
          de crear pallets.
        </p>
      )}
      <Field label="Fecha de pesaje del pallet (si se conoce)">
        <input type="date" name="weighed_date" />
      </Field>
      <Field label="Cantidad de frutas por pallet">
        <NumericInput
          name="fruits"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
        />
      </Field>
      <Field label="Responsable *">
        <input name="responsible" required defaultValue={actor} />
      </Field>
      <Field label="Observaciones">
        <textarea name="notes" />
      </Field>
      <details className="optional-fields">
        <summary>Datos de exportación para etiqueta</summary>
        <p className="hint">
          Opcionales. Complete únicamente los datos confirmados; los mismos
          datos se aplican a todos los pallets creados aquí.
        </p>
        {exportFieldsEnabled ? (
          <ExportLabelFields importerEnabled={importerFieldsEnabled} />
        ) : (
          <p className="hint">
            El administrador debe activar la actualización de etiquetas en
            Supabase.
          </p>
        )}
      </details>
      <Submit disabled={busy || !tareEnabled}>Crear pallets</Submit>
    </form>
  );
}
function ExportLabelFields({
  value,
  importerEnabled,
}: {
  value?: PalletExportLabel;
  importerEnabled: boolean;
}) {
  const [packagedDate, setPackagedDate] = useState(value?.packaged_date ?? "");
  return (
    <>
      <Field label="Importador (razón social)">
        <input
          name="importer_name"
          maxLength={200}
          defaultValue={value?.importer_name}
          disabled={!importerEnabled}
          autoComplete="off"
        />
      </Field>
      <Field label="Dirección del importador">
        <textarea
          name="importer_address"
          maxLength={400}
          rows={2}
          defaultValue={value?.importer_address}
          disabled={!importerEnabled}
          autoComplete="off"
        />
      </Field>
      {!importerEnabled && (
        <p className="hint" role="status">
          Para registrar el importador, aplique la actualización SQL de
          importadores en Supabase y sincronice.
        </p>
      )}
      <Field label="N° de AFIDI">
        <input
          name="afidi"
          inputMode="numeric"
          maxLength={100}
          defaultValue={value?.afidi}
        />
      </Field>
      <div className="form-grid">
        <Field label="Fecha de cosecha para esta etiqueta">
          <input
            type="date"
            name="export_harvest_date"
            defaultValue={value?.harvest_date ?? ""}
          />
        </Field>
        <div>
          <Field label="Fecha de envasado confirmada">
            <input
              type="date"
              name="packaged_date"
              value={packagedDate}
              onChange={(event) => setPackagedDate(event.target.value)}
            />
          </Field>
          <button
            type="button"
            className="button secondary"
            onClick={() => setPackagedDate(day())}
          >
            Usar fecha de hoy
          </button>
        </div>
      </div>
      <p className="hint">
        Si deja la cosecha vacía, se muestra la fecha registrada en el lote,
        cuando exista. La fecha de envasado se confirma por separado; el botón
        usa la fecha actual de Paraguay.
      </p>
      <Field label="Código del productor para esta etiqueta (opcional)">
        <input
          name="pallet_producer_code"
          maxLength={100}
          defaultValue={value?.producer_code}
        />
      </Field>
      <Field label="Origen confirmado para esta etiqueta (opcional)">
        <input
          name="pallet_origin"
          maxLength={200}
          defaultValue={value?.origin}
        />
      </Field>
      <p className="hint">
        El código del productor es el SPE/CAN registrado en su ficha. Si deja
        este campo vacío, se usa ese código; cuando no esté registrado, se usa
        el código de exportación disponible. El origen se toma del productor.
      </p>
      <label className="check-row">
        <input
          type="checkbox"
          name="senave_program"
          defaultChecked={value?.senave_program ?? false}
        />
        Lote incluido en el programa SENAVE para Uruguay
      </label>
      <details className="panel inset">
        <summary>Ver texto del modelo para Uruguay</summary>
        <p>
          {SENAVE_DECLARATION} <em>Anastrepha grandis.</em> LOTE N°: [lote
          registrado]
        </p>
        <p className="hint">
          Este texto se imprime al seleccionar el programa SENAVE para Uruguay.
          La etiqueta toma la especie, origen, código del productor, cosecha,
          AFIDI y lote de los registros confirmados.
        </p>
      </details>
    </>
  );
}
function Reports({
  data,
  trapInstallations,
  trapsEnabled,
  onError,
}: {
  data: Data;
  trapInstallations: TrapInstallation[];
  trapsEnabled: boolean;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState("Recepción");
  const [lossThreshold, setLossThreshold] = useState("5");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [producer, setProducer] = useState("");
  const [query, setQuery] = useState("");
  const [includeCancelledPallets, setIncludeCancelledPallets] = useState(false);
  let report: Record<string, string | number>[] = [];
  const included = (date: string) =>
    (!from || date.slice(0, 10) >= from) && (!to || date.slice(0, 10) <= to);
  const includedReception = (id: string) => {
    const o = origin(data, id);
    return (
      !!o.reception &&
      included(o.reception.date) &&
      (!producer || o.producer?.id === producer)
    );
  };
  if (["Recepción", "Productor", "Lote"].includes(kind))
    report = receptionRows(data).filter((_, i) =>
      includedReception(data.receptions[i].id),
    );
  if (kind === "Pallet")
    report = palletReportRows(
      data,
      producer,
      from,
      to,
      includeCancelledPallets,
    );
  if (["Expedición", "Exportación"].includes(kind))
    report = shipmentReportRows(data, producer, from, to);
  const filteredTraps = filterTrapInstallations(
    trapInstallations,
    data.producers,
    { from, to, producerId: producer, query },
  );
  if (kind === "Instalación de trampas")
    report = trapInstallationRows(filteredTraps, data.producers);
  const regional = regionalLosses(data, from, to, producer);
  const threshold = Number(lossThreshold.replace(",", "."));
  const validThreshold =
    lossThreshold.trim() !== "" &&
    Number.isFinite(threshold) &&
    threshold > 0 &&
    threshold <= 100;
  if (kind === "Pérdidas por región")
    report = regional.map((r) => ({
      Región: r.region,
      Productores: r.producers,
      Recepciones: r.receptions,
      Seleccionadas: r.classified,
      Recibido_kg: r.received,
      Evaluado_kg: r.assessed,
      Pérdidas_kg: r.rejected,
      Índice_porcentaje: r.rate ?? "Sin selección",
      Observaciones_de_campo: r.observations,
      Seguimiento:
        r.region === "Región sin informar"
          ? "Completar región"
          : r.classified < 2
            ? "Datos iniciales"
            : validThreshold && (r.rate ?? 0) >= threshold
              ? "Revisar registros"
              : "Seguimiento habitual",
    }));
  if (kind === "Rechazos")
    report = data.classifications
      .filter(
        (c) =>
          c.status !== "Cancelado" &&
          c.rejected_kg > 0 &&
          includedReception(c.reception_id),
      )
      .map((c) => {
        const o = origin(data, c.reception_id);
        return {
          Fecha: dateLabel(o.reception!.date),
          Productor: o.producer?.name ?? "",
          Lote: o.lot?.code ?? "",
          Región:
            c.region ||
            o.plot?.location ||
            o.producer?.community ||
            "Sin informar",
          Rechazado_kg: c.rejected_kg,
          Posible_plaga: c.pest_observation || "Sin observación",
          Señales: c.symptoms || "",
          Motivo: c.reason,
          Calidad: c.quality ?? "Sin evaluar",
        };
      });
  if (kind !== "Instalación de trampas")
    report = report.filter((r) =>
      Object.values(r).some((v) =>
        String(v).toLowerCase().includes(query.toLowerCase()),
      ),
    );
  const headers = report.length ? Object.keys(report[0]) : [];
  const action = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <section className="panel">
      <div className="report-filters">
        <Field label="Informe">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {[
              "Recepción",
              "Productor",
              "Lote",
              "Pallet",
              "Expedición",
              "Rechazos",
              "Pérdidas por región",
              "Exportación",
              "Instalación de trampas",
            ].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field
          label={
            kind === "Instalación de trampas" ? "Instalación desde" : "Desde"
          }
        >
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field
          label={
            kind === "Instalación de trampas" ? "Instalación hasta" : "Hasta"
          }
        >
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Productor">
          <select
            value={producer}
            onChange={(e) => setProducer(e.target.value)}
          >
            <option value="">Todos</option>
            {data.producers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={
            kind === "Instalación de trampas"
              ? "Código / nombre / localidad"
              : "Lote / pallet / destino"
          }
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar resultados"
          />
        </Field>
      </div>
      {kind === "Instalación de trampas" && !trapsEnabled && (
        <p className="hint" role="status">
          Aplique la actualización SQL de la planilla de trampas en Supabase y
          sincronice para consultar sus registros.
        </p>
      )}
      {kind === "Pallet" && (
        <label className="check">
          <input
            type="checkbox"
            checked={includeCancelledPallets}
            onChange={(event) =>
              setIncludeCancelledPallets(event.target.checked)
            }
          />
          Incluir pallets cancelados para consultar el historial
        </label>
      )}
      {kind === "Pérdidas por región" && (
        <section className="regional-followup">
          <h2>Seguimiento de pérdidas por región</h2>
          <p className="hint">
            Índice = kg perdidos / kg de las entregas seleccionadas. Las
            entregas sin selección no se cuentan como cero pérdidas. Una pérdida
            no confirma una plaga.
          </p>
          <Field label="Referencia de revisión (%)">
            <NumericInput
              value={lossThreshold}
              onChange={(e) => setLossThreshold(e.target.value)}
            />
          </Field>
          <p className="hint">
            Referencia operativa ajustable, no un límite técnico. “Revisar
            registros” requiere al menos dos entregas seleccionadas y una región
            informada.
          </p>
          {!validThreshold && (
            <p role="status">
              Ingrese una referencia mayor que 0 y hasta 100%.
            </p>
          )}
          <div className="regional-grid">
            {regional.map((r) => (
              <article className="regional-card" key={r.region}>
                <h3>{r.region}</h3>
                <strong>
                  {r.rate === null
                    ? "Sin selección"
                    : kg(r.rate) + "% de pérdidas"}
                </strong>
                <p>
                  {kg(r.rejected)} kg perdidos · {kg(r.assessed)} kg evaluados
                </p>
                <p>
                  {r.producers} productores · {r.classified} / {r.receptions}{" "}
                  entregas seleccionadas
                </p>
                <Badge>
                  {r.region === "Región sin informar"
                    ? "Completar región"
                    : r.classified < 2
                      ? "Datos iniciales"
                      : validThreshold && (r.rate ?? 0) >= threshold
                        ? "Revisar registros"
                        : "Seguimiento habitual"}
                </Badge>
                {r.observations > 0 && (
                  <p>{r.observations} registros con observaciones de campo</p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="toolbar">
        <p>{report.length} registros</p>
        <div className="row">
          <button
            className="button secondary"
            disabled={!report.length}
            onClick={() =>
              action(() => exportCsv(report, "agronorte-" + kind.toLowerCase()))
            }
          >
            <ArrowDownToLine size={16} />
            CSV / Excel
          </button>
          <button
            className="button primary"
            disabled={!report.length}
            onClick={() =>
              action(() =>
                printReport(
                  "Informe de " + kind,
                  kind === "Instalación de trampas"
                    ? [
                        "Código del productor / planilla",
                        "Productor",
                        "Instalación",
                        "Localidad",
                        "Hospedante",
                        "Área ha",
                        "Revisión",
                      ]
                    : headers,
                  kind === "Instalación de trampas"
                    ? report.map((r) => [
                        r.Código_productor ||
                          `${r.Código_en_planilla} (sin productor vinculado)`,
                        r.Productor,
                        r.Fecha_instalación,
                        r.Comunidad,
                        r.Hospedante,
                        r.Área_ha,
                        r.Revisión,
                      ])
                    : report.map((r) => headers.map((h) => r[h])),
                  kind === "Instalación de trampas"
                    ? { landscape: true, weightCaption: false }
                    : undefined,
                ),
              )
            }
          >
            <FileText size={16} />
            Imprimir / PDF
          </button>
        </div>
      </div>
      {kind === "Instalación de trampas" ? (
        <TrapInstallationsPanel
          records={filteredTraps}
          producers={data.producers}
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h}>{h.replaceAll("_", " ")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.map((r, i) => (
                <tr key={i}>
                  {headers.map((h) => (
                    <td key={h}>
                      {typeof r[h] === "number" ? kg(r[h]) : r[h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!report.length && (
        <Empty>No hay registros que coincidan con los filtros.</Empty>
      )}
      <p className="hint">
        El archivo CSV puede abrirse en Excel. Para PDF, seleccione “Guardar
        como PDF” en el diálogo de impresión.
      </p>
    </section>
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

function LoginScreen({
  error,
  onError,
}: {
  error: string;
  onError: (message: string) => void;
}) {
  const [sending, setSending] = useState(false);
  return (
    <main className="login-screen">
      <Brand />
      <section className="panel">
        <h1>Recepción de Sandía</h1>
        <p>Inicie sesión para registrar y consultar datos de la cooperativa.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            setSending(true);
            onError("");
            void (async () => {
              try {
                if (!supabase)
                  throw new Error("Conexión pendiente de configurar.");
                const result = await supabase.auth.signInWithPassword({
                  email: text(form, "email"),
                  password: text(form, "password"),
                });
                if (result.error) throw result.error;
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setSending(false);
              }
            })();
          }}
        >
          <Field label="Correo electrónico">
            <input name="email" type="email" required autoComplete="username" />
          </Field>
          <Field label="Contraseña">
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </Field>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <Submit disabled={sending}>
            {sending ? "Ingresando…" : "Iniciar sesión"}
          </Submit>
        </form>
        <p className="hint">
          Su administrador asigna el perfil de acceso. El QR del pallet permite
          consultar su identificación sin iniciar sesión.
        </p>
      </section>
    </main>
  );
}
