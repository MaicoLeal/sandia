-- Modelo de etiqueta aportado por el propietario en la imagen del 07/10/2026.
-- Pallets actuales de Agronorte para Uruguay con AFIDI 1571652 ya confirmado.
-- Ejecutar completo en SQL Editor del proyecto znbtwkhktlldzhkiwodu.
-- Corte de autorización: 07/10/2026 10:07:38 Paraguay (13:07:38 UTC).
-- Conserva códigos, QR, kilos, tara, fechas y demás datos de la etiqueta.
-- No establece un valor predeterminado para pallets posteriores.
-- Las etiquetas modificadas vuelven a En armado para volver a imprimirlas.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

do $label_model$
declare
  target_org constant uuid := '20000000-0000-4000-8000-000000000001';
  cutoff constant timestamptz := '2026-10-07 13:07:38+00';
  item record;
  updated_count integer := 0;
  new_metadata jsonb;
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.pallets') is null
     or to_regclass('public.shipment_pallets') is null
     or to_regclass('public.audit_logs') is null then
    raise exception 'La base del sistema Sandía no existe en este proyecto. Abra el proyecto znbtwkhktlldzhkiwodu.';
  end if;
  if not exists (
    select 1 from public.organizations
    where id = target_org and name = 'Cooperativa Agronorte'
  ) then
    raise exception 'Esta base no es la organización Cooperativa Agronorte autorizada.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pallets' and column_name = 'metadata'
  ) or to_regprocedure('public.update_pallet_export_label(uuid,jsonb,text,bigint)') is null
    or to_regprocedure('agronorte_private.valid_export_label(jsonb)') is null then
    raise exception 'Aplique primero la actualización de etiquetas de exportación del sistema Sandía.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.pallets'::regclass and tgname = 'audit_change'
      and tgenabled in ('O', 'A') and not tgisinternal
      and tgfoid = to_regprocedure('public.audit_record()')
  ) then
    raise exception 'La auditoría de pallets debe estar activa antes de aplicar el modelo de etiqueta.';
  end if;

  -- El mismo bloqueo utilizado por sincronización y correcciones del aplicativo.
  perform 1 from public.organizations where id = target_org for update;
  perform set_config(
    'agronorte.correction_reason',
    'Modelo de etiqueta SENAVE/Uruguay solicitado por el propietario según imagen enviada el 07/10/2026.',
    true
  );

  for item in
    select p.* from public.pallets p
    where p.organization_id = target_org
      and p.created_at <= cutoff
      and lower(trim(p.destination)) = 'uruguay'
      and p.status in ('En armado', 'Etiquetado', 'Listo para carga')
      and not exists (
        select 1 from public.shipment_pallets sp where sp.pallet_id = p.id
      )
    order by p.id for update of p
  loop
    if item.metadata is not null and jsonb_typeof(item.metadata) <> 'object' then
      raise exception 'Metadatos inválidos en pallet %. No se cambió ningún pallet.', item.code;
    end if;
    if item.metadata->'export_label' is not null
       and item.metadata->'export_label' <> 'null'::jsonb
       and jsonb_typeof(item.metadata->'export_label') <> 'object' then
      raise exception 'Datos de etiqueta inválidos en pallet %. No se cambió ningún pallet.', item.code;
    end if;
    -- No completa ni sustituye un AFIDI ausente o diferente.
    if trim(item.metadata#>>'{export_label,afidi}') is distinct from '1571652' then
      continue;
    end if;
    if not agronorte_private.valid_export_label(item.metadata->'export_label') then
      raise exception 'Datos de etiqueta inválidos en pallet %. No se cambió ningún pallet.', item.code;
    end if;
    new_metadata := item.metadata || jsonb_build_object(
      'export_label',
      (item.metadata->'export_label') || jsonb_build_object('senave_program', true)
    );
    if item.metadata is distinct from new_metadata then
      -- audit_change conserva antes/después, motivo y actor real del SQL Editor.
      update public.pallets
      set metadata = new_metadata, status = 'En armado', updated_at = now()
      where id = item.id and organization_id = target_org;
      updated_count := updated_count + 1;
    end if;
  end loop;
  if updated_count > 0 then
    update public.organizations set revision = revision + 1 where id = target_org;
  end if;
  raise notice 'Modelo de etiqueta SENAVE/Uruguay: % pallets actualizados. Actualice los datos del aplicativo y vuelva a imprimir sus etiquetas.', updated_count;
end
$label_model$;

commit;

-- Verificación del alcance. El campo senave_program es la selección del modelo.
select p.code as pallet, p.destination as destino, p.status as estado,
       p.metadata#>>'{export_label,afidi}' as afidi,
       p.metadata#>'{export_label,senave_program}' as modelo_senave_uruguay,
       p.net_kg as peso_neto_kg, p.gross_kg as peso_bruto_kg,
       case
         when p.created_at > '2026-10-07 13:07:38+00'::timestamptz then 'Fuera del corte: pallet posterior'
         when p.status in ('Expedido', 'Cancelado') then 'Cerrado: sin cambios'
         when exists(select 1 from public.shipment_pallets sp where sp.pallet_id = p.id) then 'Vinculado a expedición: sin cambios'
         when lower(trim(p.destination)) <> 'uruguay' then 'Destino diferente o pendiente: sin cambios'
         when trim(p.metadata#>>'{export_label,afidi}') is distinct from '1571652' then 'AFIDI ausente o diferente: sin cambios'
         when p.metadata#>'{export_label,senave_program}' = 'true'::jsonb then 'Modelo aplicado'
         else 'Revisar'
       end as resultado
from public.pallets p
where p.organization_id = '20000000-0000-4000-8000-000000000001'
order by p.created_at, p.code;
