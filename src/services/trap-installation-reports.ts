import type { Producer, TrapInstallation } from "../types";
import { dateLabel } from "../domain";

export function trapInstallationRows(
  records: TrapInstallation[],
  producers: Producer[],
) {
  const names = new Map(
    producers.map((producer) => [producer.id, producer.name]),
  );
  return records.map((record) => ({
    Código_productor: record.producer_id ? record.trap_code : "",
    Código_en_planilla: record.trap_code,
    Productor: record.producer_id
      ? (names.get(record.producer_id) ??
        record.source_producer_name ??
        "Productor vinculado")
      : "Sin productor vinculado",
    Nombre_en_planilla: record.source_producer_name ?? "",
    Fecha_instalación: record.installed_on
      ? dateLabel(record.installed_on)
      : "No informada",
    Departamento: record.department,
    Distrito: record.district,
    Comunidad: record.community,
    Tipo_trampa: record.trap_type,
    Latitud_UTM_original: record.latitude_raw,
    Longitud_UTM_original: record.longitude_raw,
    Lugar_instalación: record.installation_place,
    Hospedante: record.host,
    Área_ha: record.area_ha ?? "No informada",
    Etapa_cultivo: record.crop_stage,
    Responsable_instalación: record.responsible,
    Formulario: record.source_form,
    Versión: record.source_version,
    Fila_planilla: record.source_row,
    Documento_fuente: record.source_document,
    Estado: record.status,
    Revisión: record.review_notes.join(" · "),
  }));
}

export function filterTrapInstallations(
  records: TrapInstallation[],
  producers: Producer[],
  filters: { from?: string; to?: string; producerId?: string; query?: string },
) {
  const rows = trapInstallationRows(records, producers);
  const query = (filters.query ?? "").trim().toLocaleLowerCase("es");
  return records.filter(
    (record, index) =>
      (!filters.from ||
        (!!record.installed_on && record.installed_on >= filters.from)) &&
      (!filters.to ||
        (!!record.installed_on && record.installed_on <= filters.to)) &&
      (!filters.producerId || record.producer_id === filters.producerId) &&
      (!query ||
        Object.values(rows[index]).some((value) =>
          String(value).toLocaleLowerCase("es").includes(query),
        )),
  );
}
