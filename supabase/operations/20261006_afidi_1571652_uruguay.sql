-- AFIDI real confirmado por el propietario: 1571652.
-- Alcance confirmado: todos los pallets ACTUALES en preparación para Uruguay.
-- Proyecto: znbtwkhktlldzhkiwodu / Cooperativa Agronorte.
-- Ejecutar completo en SQL Editor, con su cuenta administradora del proyecto.
-- Sin valor predeterminado para futuros pallets. No cambia destino, kilos ni QR.
-- Corte de autorización: 06/10/2026 14:19:13 Paraguay (17:19:13 UTC).
-- Una etiqueta modificada debe imprimirse otra vez: vuelve a En armado.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

do $afidi$
declare
  target_org constant uuid := '20000000-0000-4000-8000-000000000001';
  cutoff constant timestamptz := '2026-10-06 17:19:13+00';
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
  ) or to_regprocedure('public.update_pallet_export_label(uuid,jsonb,text,bigint)') is null then
    raise exception 'Aplique primero la actualización de etiquetas de exportación del sistema Sandía.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.pallets'::regclass and tgname = 'audit_change'
      and tgenabled in ('O', 'A') and not tgisinternal
  ) then
    raise exception 'La auditoría de pallets debe estar activa antes de registrar el AFIDI.';
  end if;

  -- El mismo bloqueo de organización utilizado por sincronización y correcciones.
  perform 1 from public.organizations where id = target_org for update;
  perform set_config(
    'agronorte.correction_reason',
    'AFIDI 1571652 confirmado por el propietario para todos los pallets actuales en preparación para Uruguay; aplicado desde SQL Editor el 06/10/2026.',
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
    new_metadata := coalesce(item.metadata, '{}'::jsonb) || jsonb_build_object(
      'export_label',
      coalesce(nullif(item.metadata->'export_label', 'null'::jsonb), '{}'::jsonb)
        || jsonb_build_object('afidi', '1571652')
    );
    if item.metadata is distinct from new_metadata then
      -- audit_change conserva antes/después, motivo y actor real del servidor.
      update public.pallets
      set metadata = new_metadata, status = 'En armado', updated_at = now()
      where id = item.id and organization_id = target_org;
      updated_count := updated_count + 1;
    end if;
  end loop;
  if updated_count > 0 then
    update public.organizations set revision = revision + 1 where id = target_org;
  end if;
  raise notice 'AFIDI 1571652: % pallets actualizados. Actualice los datos del aplicativo y vuelva a imprimir sus etiquetas.', updated_count;
end
$afidi$;

commit;

-- Verificación: el AFIDI debe ser 1571652 en todos los pallets incluidos.
-- Códigos, QR, peso neto/bruto, tara y origen permanecen iguales.
select p.code as pallet, p.destination as destino, p.status as estado,
       p.metadata->'export_label'->>'afidi' as afidi,
       p.net_kg as peso_neto_kg, p.gross_kg as peso_bruto_kg,
       case
         when p.created_at > '2026-10-06 17:19:13+00'::timestamptz then 'Fuera del corte: pallet posterior'
         when p.status in ('Expedido', 'Cancelado') then 'Cerrado: sin cambios'
         when exists(select 1 from public.shipment_pallets sp where sp.pallet_id = p.id) then 'Vinculado a expedición: sin cambios'
         when lower(trim(p.destination)) <> 'uruguay' then 'Destino diferente o pendiente: sin cambios'
         when p.metadata->'export_label'->>'afidi' = '1571652' then 'AFIDI confirmado'
         else 'Revisar'
       end as resultado
from public.pallets p
where p.organization_id = '20000000-0000-4000-8000-000000000001'
order by p.created_at, p.code;
