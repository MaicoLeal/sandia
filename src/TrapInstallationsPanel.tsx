import { useId } from "react";
import { ChevronDown, Leaf } from "lucide-react";
import type { Producer, TrapInstallation } from "./types";
import { dateLabel } from "./domain";
import "./trap-installations.css";

interface TrapInstallationsPanelProps {
  records: TrapInstallation[];
  producers?: Producer[];
}

const show = (value: string | null | undefined) =>
  value?.trim() || "No informado";
const areaFormat = new Intl.NumberFormat("es-PY", {
  maximumFractionDigits: 2,
});
const trapTypes: Record<string, string> = {
  MP: "MP · Mc Phail",
  J: "J · Jakson",
  TC: "TC · Trampa casera",
};
const installationPlaces: Record<string, string> = {
  TP: "TP · Tras patio",
  CC: "CC · Cultivo comercial",
  Cco: "Cco · Cultivo para consumo familiar",
  D: "D · Depósito",
};
const cropStages: Record<string, string> = {
  GV: "GV · Vegetativo",
  F: "F · Floración",
  Fru: "Fru · Fructificación",
  C: "C · Cosecha",
};

export function TrapInstallationsPanel({
  records,
  producers,
}: TrapInstallationsPanelProps) {
  const headingId = useId();
  const ordered = [...records].sort(
    (left, right) =>
      (right.installed_on ?? "").localeCompare(left.installed_on ?? "") ||
      left.source_row - right.source_row ||
      left.trap_code.localeCompare(right.trap_code, "es"),
  );

  return (
    <section className="trap-installations-panel" aria-labelledby={headingId}>
      <div className="trap-installations-heading">
        <div>
          <h3 id={headingId}>
            <Leaf size={18} aria-hidden="true" />
            Instalaciones de trampas
          </h3>
          <p>
            Referencias de instalaciones; no indican capturas ni diagnósticos.
          </p>
        </div>
        <span className="trap-installations-count">
          {records.length} {records.length === 1 ? "registro" : "registros"}
        </span>
      </div>

      {ordered.length === 0 ? (
        <p className="trap-installations-empty">
          No hay referencias de instalaciones vinculadas.
        </p>
      ) : (
        <div className="trap-installations-list">
          {ordered.map((record) => {
            const installedLabel = record.installed_on
              ? dateLabel(record.installed_on)
              : "No informada";
            const producer = producers?.find(
              (item) => item.id === record.producer_id,
            );
            const producerName = record.producer_id
              ? producer?.name ||
                record.source_producer_name ||
                "Productor vinculado"
              : "Sin productor vinculado";
            return (
              <details className="trap-installation" key={record.id}>
                <summary>
                  <span className="trap-installation-summary-text">
                    <strong>{show(record.trap_code)}</strong>
                    <span>Instalación: {installedLabel}</span>
                    <span>{show(record.community)}</span>
                  </span>
                  <ChevronDown size={19} aria-hidden="true" />
                </summary>
                <div className="trap-installation-body">
                  <dl className="trap-installation-fields">
                    <div>
                      <dt>Productor</dt>
                      <dd>{producerName}</dd>
                    </div>
                    <div>
                      <dt>Nombre en la planilla</dt>
                      <dd>
                        {record.source_producer_name ||
                          "No identifica un productor"}
                      </dd>
                    </div>
                    <div>
                      <dt>Departamento / distrito</dt>
                      <dd>
                        {show(record.department)} / {show(record.district)}
                      </dd>
                    </div>
                    <div>
                      <dt>Compañía / zona</dt>
                      <dd>{show(record.community)}</dd>
                    </div>
                    <div>
                      <dt>Fecha de instalación</dt>
                      <dd>{installedLabel}</dd>
                    </div>
                    <div>
                      <dt>Tipo de trampa</dt>
                      <dd>
                        {trapTypes[record.trap_type] || show(record.trap_type)}
                      </dd>
                    </div>
                    <div>
                      <dt>Lugar de instalación</dt>
                      <dd>
                        {installationPlaces[record.installation_place] ||
                          show(record.installation_place)}
                      </dd>
                    </div>
                    <div>
                      <dt>Hospedante</dt>
                      <dd>{show(record.host)}</dd>
                    </div>
                    <div>
                      <dt>Superficie de la planilla</dt>
                      <dd>
                        {record.area_ha != null &&
                        Number.isFinite(record.area_ha)
                          ? `${areaFormat.format(record.area_ha)} ha`
                          : "No informada"}
                      </dd>
                    </div>
                    <div>
                      <dt>Etapa del cultivo al instalar</dt>
                      <dd>
                        {cropStages[record.crop_stage] ||
                          show(record.crop_stage)}
                      </dd>
                    </div>
                    <div>
                      <dt>Responsable de la instalación</dt>
                      <dd>{show(record.responsible)}</dd>
                    </div>
                  </dl>

                  <div className="trap-installation-coordinates">
                    <p>U.T.M · valores de la planilla</p>
                    <dl>
                      <div>
                        <dt>Latitud</dt>
                        <dd>{show(record.latitude_raw)}</dd>
                      </div>
                      <div>
                        <dt>Longitud</dt>
                        <dd>{show(record.longitude_raw)}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="trap-installation-source">
                    <p>
                      <strong>Fuente:</strong> {show(record.source_form)} ·
                      versión {show(record.source_version)} · fila{" "}
                      {record.source_row}
                    </p>
                    <p>{show(record.source_document)}</p>
                  </div>

                  {record.review_notes.length > 0 && (
                    <div className="trap-installation-notes">
                      <p>Notas de la referencia</p>
                      <ul>
                        {record.review_notes.map((note, index) => (
                          <li key={`${record.id}-note-${index}`}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
