-- Authorized packaging date: 07/10/2026, America/Asuncion.
-- SQL Editor operation for project znbtwkhktlldzhkiwodu; no future default.
-- Scope cutoff: 07/10/2026 11:37:55 Paraguay (14:37:55 UTC).
-- Only blank dates on current, open, unshipped Uruguay pallets are filled.
-- The entire batch aborts before updates when chronology needs correction.
-- Audit identity is the actual SQL session user, or the server administrator
-- recorded by public.audit_record(); no application user is impersonated.
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';

do $$begin
  if to_regclass('public.organizations') is null or to_regclass('public.pallets') is null
    or to_regclass('public.pallet_items') is null or to_regclass('public.receptions') is null
    or to_regclass('public.field_lots') is null or to_regclass('public.shipment_pallets') is null
    or to_regclass('public.audit_logs') is null or to_regclass('public.profiles') is null then
    raise exception 'La base Sandía no existe en este proyecto. Abra znbtwkhktlldzhkiwodu.';
  end if;
  if to_regprocedure('agronorte_private.valid_export_label(jsonb)') is null
    or to_regprocedure('public.audit_record()') is null or to_regprocedure('public.sandia_features()') is null then
    raise exception 'Aplique primero la actualización de etiquetas y auditoría de Sandía.';
  end if;
  if coalesce(public.sandia_features()->>'label_export_data','false')<>'true' then
    raise exception 'Aplique primero la actualización de etiquetas de Sandía.';
  end if;
end$$;

do $packaging$
declare
  org constant uuid='20000000-0000-4000-8000-000000000001';
  cutoff constant timestamptz='2026-10-07 14:37:55+00';
  packaging_date constant date='2026-10-07';
  pending_ids uuid[]=array[]::uuid[];
  item record;fields jsonb;checked_fields jsonb;new_metadata jsonb;
  updated_count integer=0;preserved_count integer=0;
begin
  if not exists(select 1 from public.organizations where id=org and name='Cooperativa Agronorte') then
    raise exception 'Esta base no es la Cooperativa Agronorte autorizada. Abra znbtwkhktlldzhkiwodu.';
  end if;
  if (cutoff at time zone 'America/Asuncion')::date<>packaging_date then
    raise exception 'La fecha de envasado y el corte autorizado no coinciden en Paraguay.';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger
    where tgrelid='public.pallets'::regclass and tgname='audit_change'
      and tgfoid=to_regprocedure('public.audit_record()')
      and tgenabled in ('O','A') and not tgisinternal and tgqual is null
      and (tgtype::integer & 17)=17 and (tgtype::integer & 2)=0) then
    raise exception 'La auditoría de pallets debe estar activa y vinculada a public.audit_record().';
  end if;
  perform 1 from public.organizations where id=org for update;

  -- Lock and verify every eligible pallet before changing any record.
  for item in select p.* from public.pallets p
    where p.organization_id=org and p.created_at<=cutoff
      and lower(trim(p.destination))='uruguay'
      and p.status in ('En armado','Etiquetado','Listo para carga')
      and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
    order by p.id for update of p
  loop
    if item.metadata is not null and jsonb_typeof(item.metadata)<>'object' then
      raise exception 'Metadatos inválidos en pallet %. No se cambió ningún pallet.',item.code;
    end if;
    fields=coalesce(nullif(item.metadata->'export_label','null'::jsonb),'{}'::jsonb);
    if jsonb_typeof(fields)<>'object' then
      raise exception 'Datos de etiqueta inválidos en pallet %. No se cambió ningún pallet.',item.code;
    end if;
    -- Legacy blank strings are treated as pending, without accepting other bad fields.
    checked_fields=fields;
    if fields ? 'packaged_date' and nullif(trim(fields->>'packaged_date'),'') is null then
      checked_fields=fields||jsonb_build_object('packaged_date',null);
    end if;
    if not agronorte_private.valid_export_label(checked_fields) then
      raise exception 'Datos de etiqueta inválidos en pallet %. No se cambió ningún pallet.',item.code;
    end if;
    if nullif(trim(fields->>'packaged_date'),'') is not null then
      preserved_count=preserved_count+1;continue;
    end if;
    if nullif(fields->>'harvest_date','')::date>packaging_date then
      raise exception 'Pallet %: la cosecha de la etiqueta es posterior al 07/10/2026. Corrija o revise esa fecha; no se cambió ningún pallet.',item.code;
    end if;
    if exists(select 1 from public.pallet_items i
      join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
      join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
      where i.pallet_id=item.id and i.organization_id=org and i.status<>'Cancelado'
        and (r.date>packaging_date or l.harvest_date>packaging_date)) then
      raise exception 'Pallet %: la recepción o cosecha del lote es posterior al 07/10/2026. Corrija o revise esas fechas; no se cambió ningún pallet.',item.code;
    end if;
    pending_ids=array_append(pending_ids,item.id);
  end loop;

  perform set_config('agronorte.correction_reason',
    'Fecha de envasado 07/10/2026 (America/Asuncion) confirmada por el propietario; completar solo campos pendientes de pallets actuales para Uruguay, sin sustituir fechas ya registradas.',true);
  for item in select p.* from public.pallets p where p.organization_id=org and p.id=any(pending_ids) order by p.id
  loop
    fields=coalesce(nullif(item.metadata->'export_label','null'::jsonb),'{}'::jsonb);
    new_metadata=coalesce(item.metadata,'{}'::jsonb)||jsonb_build_object(
      'export_label',fields||jsonb_build_object('packaged_date',to_char(packaging_date,'YYYY-MM-DD')));
    update public.pallets set metadata=new_metadata,status='En armado',updated_at=now()
      where id=item.id and organization_id=org;
    updated_count=updated_count+1;
  end loop;
  if updated_count>0 then update public.organizations set revision=revision+1 where id=org;end if;
  perform set_config('agronorte.correction_reason','',true);
  raise notice 'Envasado 07/10/2026: % pallets actualizados; % fechas existentes conservadas. Expedidos, vinculados, cancelados y futuros sin cambios. Actualice los datos y reimprima las etiquetas modificadas.',updated_count,preserved_count;
end
$packaging$;
commit;

select p.code as pallet,p.destination as destino,p.status as estado,
  p.metadata#>>'{export_label,packaged_date}' as fecha_de_envasado
from public.pallets p
where p.organization_id='20000000-0000-4000-8000-000000000001'
  and lower(trim(p.destination))='uruguay' and p.created_at<='2026-10-07 14:37:55+00'::timestamptz
order by p.created_at,p.code;
