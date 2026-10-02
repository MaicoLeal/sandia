import { useCallback, useEffect, useState } from "react";
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
  Plus,
  Scale,
  Search,
  Settings,
  Truck,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import type { AuditLog, Data, Pallet, Reception, Table } from "./types";
import {
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
  receptionTotal,
  round,
  summary,
} from "./domain";
import { useWorkspace } from "./useWorkspace";
import { Badge, Brand, Empty, Field, Label, Modal, Submit } from "./components";
import {
  clearDraft,
  getFile,
  readDraft,
  readWorkspace,
  saveDraft,
  saveFile,
} from "./services/storage";
import { publicTrace, supabase } from "./services/supabase";
import { exportCsv, printReport, receptionRows } from "./services/reports";

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
  | "weight"
  | "classification"
  | "pallet"
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
const reasons = [
  "Fruta dañada",
  "Tamaño fuera del estándar",
  "Maduración inadecuada",
  "Problema visual",
  "Rajadura",
  "Podredumbre",
  "Otro",
];
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
function PublicTrace() {
  const [trace, setTrace] = useState<{
    code: string;
    product: string;
    net_kg: number;
    destination: string;
    status: string;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("trace") ?? "";
    const lookup = async () => {
      const local = await readWorkspace(LOCAL_KEY);
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
  const { workspace, error, setError, busy, online, commit, sync, role } =
    useWorkspace();
  const [page, setPage] = useState<Page>("Inicio");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [returnToReception, setReturnToReception] = useState(false);
  const [selectedReception, setSelectedReception] = useState<string | null>(
    null,
  );
  const [selectedProducer, setSelectedProducer] = useState<string | null>(null);
  const [label, setLabel] = useState<Pallet | null>(null);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const close = useCallback(() => {
    setDialog(null);
    setLabel(null);
  }, []);
  useEffect(() => {
    const fn = () => setUpdateAvailable(true);
    window.addEventListener("app-update", fn);
    return () => window.removeEventListener("app-update", fn);
  }, []);
  if (!workspace)
    return (
      <div className="loading">
        <Brand />
        <p>{error || "Preparando el espacio de trabajo…"}</p>
      </div>
    );
  const data = workspace.data;
  const org = workspace.organizationId;
  const user = workspace.profile?.user_id ?? null;
  const actor = workspace.profile?.name ?? "Operador local";
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
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
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
  const recent = [...data.receptions]
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
                <Badge>{o.lot?.status ?? r.status}</Badge>
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
          {updateAvailable && (
            <p className="hint">
              Hay una actualización disponible. Guarde su trabajo y vuelva a
              abrir la aplicación.
            </p>
          )}
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
                      (l) => !["Expedido", "Rechazado"].includes(l.status),
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
                  {data.pallets.length ? (
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
              <section className="panel">{receptionList(rows)}</section>
            </>
          )}
          {page === "Productores" && (
            <>
              <div className="toolbar">
                <label className="search">
                  <Search size={18} />
                  <input
                    aria-label="Buscar productor"
                    placeholder="Nombre o comunidad…"
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
                    (p.name + " " + p.community)
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
                      <p>{p.community || "Localidad no registrada"}</p>
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
                <p>{data.pallets.length} pallets registrados</p>
                {newButton("Crear pallet", "pallet", "pallet")}
              </div>
              <div className="card-grid">
                {data.pallets.length ? (
                  data.pallets.map((p) => {
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
                        <h2>{p.code}</h2>
                        <p>
                          {o.producer?.name} · {o.plot?.name}
                        </p>
                        <strong className="big-number">
                          {kg(p.net_kg)} <small>kg netos</small>
                        </strong>
                        <p>
                          Destino: <strong>{p.destination}</strong>
                        </p>
                        <p className="hint">
                          Bruto:{" "}
                          {p.gross_kg === null
                            ? "Sin informar"
                            : kg(p.gross_kg) + " kg"}{" "}
                          · Tara:{" "}
                          {p.gross_kg === null
                            ? "Sin tara registrada"
                            : kg(p.gross_kg - p.net_kg) + " kg"}
                        </p>
                        <div className="row">
                          <button
                            className="button secondary"
                            onClick={() => setLabel(p)}
                          >
                            <FileText size={16} />
                            Etiqueta
                          </button>
                          <button
                            className="link"
                            onClick={() =>
                              setSelectedReception(item?.reception_id ?? null)
                            }
                          >
                            Origen <ArrowRight size={16} />
                          </button>
                        </div>
                        {p.status !== "Expedido" &&
                          p.status !== "Cancelado" &&
                          can(role, "pallet") && (
                            <button
                              className="button secondary full"
                              disabled={busy || p.status === "Listo para carga"}
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
                  })
                ) : (
                  <Empty>
                    Cree el primer pallet después de clasificar una recepción.
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
          {page === "Informes" && <Reports data={data} onError={setError} />}
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
              producer: producer ? "Editar productor" : "Nuevo productor",
              plot: "Nueva propiedad y parcela",
              reception: "Nueva recepción",
              weight: "Registrar pesaje",
              classification: "Clasificación / selección",
              pallet: "Crear pallet",
              shipment: "Nueva expedición",
              settings: "Configuración",
            }[dialog]
          }
          onClose={close}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {dialog === "producer" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void run(async () => {
                  allowed(producer ? "correct" : "catalog");
                  const p = {
                    ...(producer ?? base(org, text(form, "status"), user)),
                    updated_at: now(),
                    status: text(form, "status"),
                    name: text(form, "name"),
                    document: text(form, "document"),
                    phone: text(form, "phone"),
                    community: text(form, "community"),
                    address: text(form, "address"),
                    notes: text(form, "notes"),
                  };
                  await commit((d) => {
                    if (producer) {
                      const reason = text(form, "reason");
                      if (!reason)
                        throw new Error("Indique el motivo de la corrección.");
                      const existing = d.producers.find(
                        (x) => x.id === producer.id,
                      )!;
                      const before = structuredClone(existing);
                      Object.assign(existing, p);
                      record(
                        d,
                        "producers",
                        p.id,
                        "Productor corregido",
                        before,
                        p,
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
                  defaultValue={producer?.name}
                />
              </Field>
              <div className="form-grid">
                <Field label="Documento / RUC / CI">
                  <input name="document" defaultValue={producer?.document} />
                </Field>
                <Field label="Teléfono">
                  <input
                    name="phone"
                    type="tel"
                    defaultValue={producer?.phone}
                  />
                </Field>
              </div>
              <Field label="Comunidad / localidad">
                <input name="community" defaultValue={producer?.community} />
              </Field>
              <Field label="Dirección o referencia">
                <input name="address" defaultValue={producer?.address} />
              </Field>
              <Field label="Estado">
                <select
                  name="status"
                  defaultValue={producer?.status ?? "Activo"}
                >
                  <option>Activo</option>
                  <option>Inactivo</option>
                </select>
              </Field>
              <Field label="Observaciones">
                <textarea name="notes" defaultValue={producer?.notes} />
              </Field>
              {producer && (
                <Field label="Motivo de la corrección *">
                  <textarea name="reason" required />
                </Field>
              )}
              <Submit disabled={busy} />
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
                  <input name="area" inputMode="decimal" />
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
              draftKey={draftKey}
              actor={actor}
              onQuickCreate={(type) => {
                setReturnToReception(true);
                setDialog(type);
              }}
              onSave={async (values) => {
                await run(async () => {
                  allowed("receive");
                  await commit((d) => {
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
                    record(d, "receptions", r.id, "Recepción creada", null, {
                      ...r,
                      total_kg: summary(values.weights).total,
                    });
                  });
                  await clearDraft(draftKey);
                });
              }}
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
                <input
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
              <Field label="Recepción *">
                <select
                  name="reception"
                  required
                  defaultValue={selectedReception ?? ""}
                >
                  <option value="">Seleccione</option>
                  {data.receptions
                    .filter(
                      (r) =>
                        !data.classifications.some(
                          (c) =>
                            c.reception_id === r.id && c.status !== "Cancelado",
                        ),
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {origin(data, r.id).lot?.code} ·{" "}
                        {kg(receptionTotal(data, r.id))} kg
                      </option>
                    ))}
                </select>
              </Field>
              <div className="form-grid">
                <Field label="Aprobado (kg) *">
                  <input
                    name="approved"
                    required
                    inputMode="decimal"
                    defaultValue={
                      selectedReception
                        ? receptionTotal(data, selectedReception)
                        : ""
                    }
                  />
                </Field>
                <Field label="Rechazado (kg) *">
                  <input
                    name="rejected"
                    required
                    inputMode="decimal"
                    defaultValue="0"
                  />
                </Field>
                <Field label="Frutas aprobadas (opcional)">
                  <input name="approved_count" type="number" min="0" step="1" />
                </Field>
                <Field label="Frutas rechazadas (opcional)">
                  <input name="rejected_count" type="number" min="0" step="1" />
                </Field>
              </div>
              <Field label="Motivo de rechazo">
                <select name="reason">
                  <option value="">Sin rechazo</option>
                  {reasons.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="Calibre / tamaño">
                <input name="size" />
              </Field>
              <Field label="Calidad visual (1 a 5)">
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
              <Submit disabled={busy} />
            </form>
          )}
          {dialog === "pallet" && (
            <PalletForm
              data={data}
              actor={actor}
              busy={busy}
              selectedReception={selectedReception}
              onSave={async (form) => {
                await run(async () => {
                  allowed("pallet");
                  const id = text(form, "reception");
                  const net = number(form, "net");
                  const gross = optionalNumber(form, "gross");
                  const count = number(form, "count");
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
                        responsible: text(form, "responsible"),
                        gross_kg: gross,
                        net_kg: net,
                        fruit_count: optionalNumber(form, "fruits"),
                        notes: text(form, "notes"),
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
      {label && (
        <Modal title="Etiqueta de pallet" onClose={close}>
          <Label
            data={data}
            pallet={label}
            onPrinted={async () => {
              allowed("pallet");
              if (!workspace.localOnly && workspace.pending)
                throw new Error(
                  "Sincronice antes de imprimir los códigos definitivos de lote y pallet.",
                );
              await commit((d) => {
                const p = d.pallets.find((p) => p.id === label.id)!;
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
            <Badge>{detail.lot?.status}</Badge>
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
          {detail.reception.notes && (
            <p className="hint">{detail.reception.notes}</p>
          )}
          <div className="row">
            {newButton("Pesaje", "weight", "weigh", <Scale size={16} />)}
            {!data.classifications.some(
              (c) => c.reception_id === detail.reception?.id,
            ) && newButton("Clasificar", "classification", "classify")}
            {newButton("Pallet", "pallet", "pallet", <Box size={16} />)}
          </div>
          {can(role, "correct") &&
            detail.reception.status !== "Cancelado" &&
            !data.classifications.some(
              (c) => c.reception_id === detail.reception?.id,
            ) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const value = text(form, "corrected_date");
                  const reason = text(form, "date_reason");
                  void run(async () => {
                    allowed("correct");
                    if (!reason) throw new Error("Indique la justificación.");
                    if (
                      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                      Number.isNaN(Date.parse(value)) ||
                      new Date(value).toISOString().slice(0, 10) !== value
                    )
                      throw new Error("Fecha inválida. Use AAAA-MM-DD.");
                    await commit((d) => {
                      const r = d.receptions.find(
                        (r) => r.id === detail.reception!.id,
                      )!;
                      const before = structuredClone(r);
                      r.date = value;
                      r.updated_at = now();
                      record(
                        d,
                        "receptions",
                        r.id,
                        "Recepción corregida",
                        before,
                        r,
                        reason,
                      );
                    });
                  });
                }}
              >
                <Field label="Fecha correcta (AAAA-MM-DD)">
                  <input
                    name="corrected_date"
                    required
                    defaultValue={detail.reception.date}
                    pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
                  />
                </Field>
                <Field label="Justificación de la fecha">
                  <input name="date_reason" required />
                </Field>
                <Submit disabled={busy}>
                  Corregir fecha con justificación
                </Submit>
              </form>
            )}
          {can(role, "correct") &&
            detail.reception.status !== "Cancelado" &&
            !data.classifications.some(
              (c) => c.reception_id === detail.reception?.id,
            ) && (
              <button
                className="button secondary full"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt(
                    "Motivo obligatorio para cancelar la recepción (se conserva el historial)",
                  );
                  if (!reason?.trim()) return;
                  void run(() =>
                    commit((d) => {
                      allowed("correct");
                      const r = d.receptions.find(
                        (r) => r.id === detail.reception!.id,
                      )!;
                      const before = structuredClone(r);
                      r.status = "Cancelado";
                      r.notes =
                        "Cancelación: " +
                        reason +
                        (r.notes ? " · " + r.notes : "");
                      r.updated_at = now();
                      record(
                        d,
                        "receptions",
                        r.id,
                        "Recepción cancelada",
                        before,
                        r,
                        reason,
                      );
                    }),
                  );
                }}
              >
                Cancelar recepción con justificación
              </button>
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
                  {can(role, "correct") && (
                    <button
                      className="link"
                      disabled={busy}
                      onClick={() => {
                        const input = window.prompt(
                          "Nuevo peso en kg",
                          String(w.kg),
                        );
                        if (input === null) return;
                        const reason = window.prompt(
                          "Justificación obligatoria",
                        );
                        if (!reason) return;
                        void run(async () => {
                          allowed("correct");
                          const value = parseKg(input);
                          await commit((d) => {
                            if (
                              d.receptions.find((r) => r.id === w.reception_id)
                                ?.status === "Cancelado"
                            )
                              throw new Error("La recepción está cancelada.");
                            if (
                              d.classifications.some(
                                (c) => c.reception_id === w.reception_id,
                              )
                            )
                              throw new Error(
                                "Recepción clasificada: corrija antes de clasificar o gestione una reversión supervisada.",
                              );
                            const row = d.reception_weights.find(
                              (x) => x.id === w.id,
                            )!;
                            const before = structuredClone(row);
                            row.kg = value;
                            row.updated_at = now();
                            row.correction_reason = reason;
                            record(
                              d,
                              "reception_weights",
                              row.id,
                              "Peso corregido",
                              before,
                              row,
                              reason,
                            );
                          });
                        });
                      }}
                    >
                      Corregir
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
                  Calidad:{" "}
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
                      (i.pallet_id === a.entity_id ||
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
                printReport(
                  "Resumen de recepción · " + detail.lot?.code,
                  ["Pesaje", "Kg", "Operador"],
                  data.reception_weights
                    .filter((w) => w.reception_id === detail.reception?.id)
                    .map((w) => [w.sequence, w.kg, w.operator]),
                );
              }, "Resumen preparado.")
            }
          >
            <FileText size={16} />
            Imprimir resumen / PDF
          </button>
        </Modal>
      )}
      {producer && !dialog && (
        <Modal
          title="Historial del productor"
          onClose={() => setSelectedProducer(null)}
        >
          <Badge>{producer.status}</Badge>
          <h2>{producer.name}</h2>
          {can(role, "correct") && (
            <button
              className="button secondary"
              onClick={() => setDialog("producer")}
            >
              Editar datos del productor
            </button>
          )}
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
          <h3>Calidad y rechazos</h3>
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
                Calidad {c.quality === null ? "Sin evaluar" : c.quality + "/5"}{" "}
                · {kg(c.rejected_kg)} kg rechazados ·{" "}
                {c.reason || "Sin rechazo"}
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
}
function ReceptionForm({
  data,
  busy,
  draftKey,
  actor,
  onSave,
  onQuickCreate,
}: {
  data: Data;
  busy: boolean;
  draftKey: string;
  actor: string;
  onSave: (values: ReceptionValues) => Promise<void>;
  onQuickCreate: (type: "producer" | "plot") => void;
}) {
  const [values, setValues] = useState<ReceptionValues>({
    producerId: "",
    plotId: "",
    lotId: "",
    lotCode: "",
    date: day(),
    harvest: "",
    responsible: actor,
    notes: "",
    weights: [],
  });
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
    void onSave(values);
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
                {p.name}
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
          <input
            inputMode="decimal"
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
  onSave,
}: {
  data: Data;
  actor: string;
  busy: boolean;
  selectedReception: string | null;
  onSave: (form: HTMLFormElement) => Promise<void>;
}) {
  const [id, setId] = useState(selectedReception ?? "");
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
          <input
            name="count"
            type="number"
            required
            min="1"
            max="100"
            step="1"
            defaultValue="1"
          />
        </Field>
        <Field label="Destino *">
          <input name="destination" required defaultValue="Uruguay" />
        </Field>
        <Field label="Peso neto por pallet (kg) *">
          <input name="net" inputMode="decimal" required />
        </Field>
        <Field label="Peso bruto por pallet (kg), si se conoce">
          <input name="gross" inputMode="decimal" />
        </Field>
      </div>
      <Field label="Cantidad de frutas por pallet">
        <input name="fruits" type="number" min="0" step="1" />
      </Field>
      <Field label="Responsable *">
        <input name="responsible" required defaultValue={actor} />
      </Field>
      <Field label="Observaciones">
        <textarea name="notes" />
      </Field>
      <Submit disabled={busy}>Crear pallets</Submit>
    </form>
  );
}
function Reports({
  data,
  onError,
}: {
  data: Data;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState("Recepción");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [producer, setProducer] = useState("");
  const [query, setQuery] = useState("");
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
    report = data.pallets
      .filter((p) =>
        data.pallet_items.some(
          (i) => i.pallet_id === p.id && includedReception(i.reception_id),
        ),
      )
      .map((p) => {
        const o = origin(
          data,
          data.pallet_items.find((i) => i.pallet_id === p.id)?.reception_id ??
            "",
        );
        return {
          Pallet: p.code,
          Lote: o.lot?.code ?? "",
          Productor: o.producer?.name ?? "",
          Destino: p.destination,
          Neto_kg: p.net_kg,
          Bruto_kg: p.gross_kg ?? "Sin informar",
          Estado: p.status,
        };
      });
  if (["Expedición", "Exportación"].includes(kind))
    report = data.shipments
      .filter(
        (s) =>
          included(s.departure) &&
          (!producer ||
            data.shipment_pallets.some(
              (sp) =>
                sp.shipment_id === s.id &&
                data.pallet_items.some(
                  (i) =>
                    i.pallet_id === sp.pallet_id &&
                    origin(data, i.reception_id).producer?.id === producer,
                ),
            )),
      )
      .flatMap((s) =>
        data.shipment_pallets
          .filter((sp) => sp.shipment_id === s.id)
          .map((sp) => {
            const p = data.pallets.find((p) => p.id === sp.pallet_id)!;
            const o = origin(
              data,
              data.pallet_items.find((i) => i.pallet_id === p.id)
                ?.reception_id ?? "",
            );
            return {
              Salida: dateLabel(s.departure),
              Destino: s.destination,
              País: s.country,
              Cliente: s.customer,
              Chapa: s.plate,
              Pallet: p.code,
              Lote: o.lot?.code ?? "",
              Productor: o.producer?.name ?? "",
              Parcela: o.plot?.name ?? "",
              Kg: p.net_kg,
            };
          }),
      );
  if (kind === "Rechazos")
    report = data.classifications
      .filter((c) => c.rejected_kg > 0 && includedReception(c.reception_id))
      .map((c) => {
        const o = origin(data, c.reception_id);
        return {
          Fecha: dateLabel(o.reception!.date),
          Productor: o.producer?.name ?? "",
          Lote: o.lot?.code ?? "",
          Rechazado_kg: c.rejected_kg,
          Motivo: c.reason,
          Calidad: c.quality ?? "Sin evaluar",
        };
      });
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
              "Exportación",
            ].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="Desde">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Hasta">
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
        <Field label="Lote / pallet / destino">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar resultados"
          />
        </Field>
      </div>
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
                  headers,
                  report.map((r) => headers.map((h) => r[h])),
                ),
              )
            }
          >
            <FileText size={16} />
            Imprimir / PDF
          </button>
        </div>
      </div>
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
                  <td key={h}>{typeof r[h] === "number" ? kg(r[h]) : r[h]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
