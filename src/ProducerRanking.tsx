import { useId, useMemo, useState } from "react";
import { ArrowRight, Trophy } from "lucide-react";
import { day, kg } from "./domain";
import { producerDeliveryRanking } from "./services/producer-ranking";
import type { Data } from "./types";

type Period = "all" | "today" | "week" | "month";

export function ProducerRanking({
  data,
  today = day(),
  onSelectProducer,
}: {
  data: Data;
  today?: string;
  onSelectProducer: (id: string) => void;
}) {
  const id = useId();
  const [period, setPeriod] = useState<Period>("all");
  const [expanded, setExpanded] = useState(false);
  const monday = new Date(today + "T12:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const from = {
    all: "",
    today,
    week: monday.toISOString().slice(0, 10),
    month: today.slice(0, 7) + "-01",
  }[period];
  const to = period === "all" ? "" : today;
  const ranking = useMemo(
    () => producerDeliveryRanking(data, from, to),
    [data, from, to],
  );
  const visibleRows = expanded ? ranking.rows : ranking.rows.slice(0, 5);

  return (
    <section className="panel producer-ranking" aria-labelledby={id + "-title"}>
      <div className="section-heading producer-ranking-heading">
        <div>
          <h2 id={id + "-title"}>
            <Trophy size={19} aria-hidden="true" /> Ranking de productores
          </h2>
          <p>De mayor a menor peso recibido</p>
        </div>
        <div className="producer-ranking-period">
          <label htmlFor={id + "-period"}>Período del ranking</label>
          <select
            id={id + "-period"}
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value as Period);
              setExpanded(false);
            }}
          >
            <option value="all">Todo el período</option>
            <option value="today">Hoy</option>
            <option value="week">Esta semana</option>
            <option value="month">Este mes</option>
          </select>
        </div>
      </div>
      <div className="producer-ranking-summary" aria-live="polite">
        <span>
          <strong>{kg(ranking.totalKg)} kg</strong> recibidos
        </span>
        <span>
          {ranking.rows.length}{" "}
          {ranking.rows.length === 1 ? "productor" : "productores"} con entregas
        </span>
      </div>
      {ranking.rows.length > 0 ? (
        <>
          <ol className="producer-ranking-list" id={id + "-list"}>
            {visibleRows.map((row) => (
              <li key={row.producer.id} value={row.rank}>
                <button
                  type="button"
                  className="producer-ranking-entry"
                  onClick={() => onSelectProducer(row.producer.id)}
                  aria-label={`Ver historial de ${row.producer.name}, puesto ${row.rank}, ${kg(row.receivedKg)} kg recibidos`}
                >
                  <span
                    className={`producer-ranking-position${row.rank <= 3 ? " leading" : ""}`}
                  >
                    {row.rank}
                  </span>
                  <span className="producer-ranking-info">
                    <strong>{row.producer.name}</strong>
                    <small>
                      {row.deliveries}{" "}
                      {row.deliveries === 1 ? "entrega" : "entregas"}
                      {row.producer.metadata?.internal_code?.trim() &&
                        ` · ${row.producer.metadata.internal_code.trim()}`}
                    </small>
                    <span className="producer-ranking-bar" aria-hidden="true">
                      <span style={{ width: `${row.sharePercent}%` }} />
                    </span>
                  </span>
                  <span className="producer-ranking-weight">
                    <strong>
                      {kg(row.receivedKg)} <small>kg</small>
                    </strong>
                    <small>{kg(row.sharePercent)}% del total</small>
                  </span>
                  <ArrowRight
                    className="producer-ranking-arrow"
                    size={17}
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ol>
          {ranking.rows.length > 5 && (
            <button
              type="button"
              className="button secondary producer-ranking-expand"
              aria-expanded={expanded}
              aria-controls={id + "-list"}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? "Ver primeros 5"
                : `Ver ranking completo (${ranking.rows.length})`}
            </button>
          )}
          <p className="hint producer-ranking-note">
            Suma las entregas de cada productor. Las recepciones y pesajes
            cancelados no se cuentan. Toque un productor para ver su historial.
          </p>
        </>
      ) : (
        <p className="producer-ranking-empty">
          Todavía no hay entregas de productores en este período.
        </p>
      )}
      {ranking.unassignedKg > 0 && (
        <p className="hint producer-ranking-note">
          {kg(ranking.unassignedKg)} kg recibidos están pendientes de vincular a
          un productor.
        </p>
      )}
    </section>
  );
}
