import { useEffect, useState } from "react";
import { LogOut, RefreshCw } from "lucide-react";
import { Badge, Brand, Empty, Field } from "./components";
import { dateLabel, kg } from "./domain";
import { loadRecipientPallets, supabase } from "./services/supabase";
import type { Profile, RecipientPallet } from "./types";

export function RecipientPortal({ profile }: { profile: Profile }) {
  const [pallets, setPallets] = useState<RecipientPallet[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      setBusy(true);
      setError("");
      setPallets([]);
      setRequest((n) => n + 1);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    let active = true;
    void loadRecipientPallets()
      .then((rows) => {
        if (active) {
          setPallets(rows);
          setBusy(false);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(
            e instanceof Error ? e.message : "No se pudo consultar la carga.",
          );
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [profile.user_id, request]);
  const visible = pallets.filter((p) =>
    `${p.code} ${p.lot_codes.join(" ")} ${p.destination}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <main className="recipient-view">
      <Brand />
      <div className="row between">
        <div>
          <p className="eyebrow">CONSULTA DE CARGA</p>
          <h1>Mis pallets de sandía</h1>
          <p>{profile.name} · Acceso de destinatario</p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            void supabase?.auth.signOut().then(({ error }) => {
              if (error) setError(error.message);
            });
          }}
        >
          <LogOut size={18} /> Cerrar sesión
        </button>
      </div>
      <div className="recipient-summary panel">
        <strong>{pallets.length} pallets autorizados</strong>
        <span>
          {kg(pallets.reduce((total, p) => total + p.net_kg, 0))} kg netos
        </span>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            setPallets([]);
            setRequest((n) => n + 1);
          }}
        >
          <RefreshCw size={18} /> Actualizar
        </button>
      </div>
      <Field label="Buscar código, lote o destino">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy ? (
        <p role="status">Consultando pallets autorizados…</p>
      ) : !visible.length ? (
        <Empty>
          Sin pallets disponibles. La cooperativa debe vincular sus pallets a
          esta cuenta.
        </Empty>
      ) : (
        <div className="recipient-grid">
          {visible.map((p) => (
            <article className="panel recipient-card" key={p.token}>
              <Badge>{p.status}</Badge>
              <h2>{p.code}</h2>
              <p>{p.product}</p>
              <strong className="big-number">
                {kg(p.net_kg)} <small>kg netos</small>
              </strong>
              <dl className="recipient-details">
                <dt>Peso bruto</dt>
                <dd>
                  {p.gross_kg === null
                    ? "Sin informar"
                    : `${kg(p.gross_kg)} kg`}
                </dd>
                <dt>Destino</dt>
                <dd>{p.destination}</dd>
                <dt>Lote</dt>
                <dd>{p.lot_codes.join(", ") || "Sin informar"}</dd>
                <dt>Recepción</dt>
                <dd>
                  {p.reception_dates.map(dateLabel).join(", ") ||
                    "Sin informar"}
                </dd>
                <dt>Armado</dt>
                <dd>{dateLabel(p.assembled_at.slice(0, 10))}</dd>
                <dt>Pesaje</dt>
                <dd>
                  {p.weighed_date ? dateLabel(p.weighed_date) : "Sin informar"}
                </dd>
              </dl>
              {p.shipments.map((s, i) => (
                <div className="trace-origin" key={i}>
                  <strong>Expedición · {s.country}</strong>
                  <p>
                    {s.destination} · Salida: {dateLabel(s.departure)}
                  </p>
                </div>
              ))}
              <a
                className="button secondary full"
                href={`?trace=${encodeURIComponent(p.token)}`}
              >
                Consultar identificación QR
              </a>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
