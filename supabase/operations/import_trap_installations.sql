-- GENERIC TEMPLATE: replace the $trap_rows$ JSON before execution.
-- Source: FOR-DVF-013 / DPV-DVF / version 01, effective 13/08/2025.
-- Oficina Regional San Pedro. Uruguay cucurbit export surveillance programme.
-- Raw source installation dates and UTM strings are retained without conversion.
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';
do $$begin
  if to_regclass('public.trap_installations') is null
    or to_regprocedure('agronorte_private.trap_reference_codes(uuid,uuid)') is null then
    raise exception 'Aplique primero la actualización de instalaciones de trampas del sistema Sandía.';
  end if;
end$$;
do $import$
declare
  org constant uuid='20000000-0000-4000-8000-000000000001';
  source_rows constant jsonb=$trap_rows$[]$trap_rows$::jsonb;
  source_key_value constant text='FOR-DVF-013-2026-08-AGRONORTE';
  row_value jsonb;existing_value public.trap_installations;candidate uuid;
  match_name text;match_count integer;notes_value text[];changed integer=0;
  before_producer jsonb;after_producer jsonb;origin_value text;affected_ids uuid[]=array[]::uuid[];
  installation public.trap_installations;producer_record record;
begin
  if to_regclass('public.trap_installations') is null
    or to_regprocedure('agronorte_private.trap_reference_codes(uuid,uuid)') is null then
    raise exception 'Aplique primero la actualización de instalaciones de trampas del sistema Sandía.';
  end if;
  if not exists(select 1 from public.organizations where id=org and name='Cooperativa Agronorte') then
    raise exception 'Esta base no es la Cooperativa Agronorte autorizada. Abra el proyecto znbtwkhktlldzhkiwodu.';
  end if;
  if jsonb_typeof(source_rows) is distinct from 'array' or jsonb_array_length(source_rows)<>23 then
    raise exception 'La importación requiere las 23 filas verificadas de FOR-DVF-013.';
  end if;
  if (select count(distinct (v->>'source_row')::integer) from jsonb_array_elements(source_rows) v)<>23
    or exists(select 1 from jsonb_array_elements(source_rows) v where (v->>'source_row')::integer not between 1 and 23) then
    raise exception 'Las filas de origen deben ser únicas, numeradas del 1 al 23.';
  end if;
  if exists(select 1 from unnest(array['trap_installations','producers','pallets']) required_table(table_name)
    where not exists(select 1 from pg_catalog.pg_trigger where tgrelid=('public.'||required_table.table_name)::regclass
      and tgname='audit_change' and tgenabled in ('O','A') and not tgisinternal)) then
    raise exception 'La auditoría de instalaciones, productores y pallets debe estar activa.';
  end if;
  perform 1 from public.organizations where id=org for update;
  perform set_config('agronorte.correction_reason','Importación autorizada de FOR-DVF-013, versión 01: 23 instalaciones; nombres originales, fechas de instalación y UTM literales conservados; aliases confirmados por el propietario.',true);
  perform set_config('agronorte.trap_import_batch','on',true);

  for row_value in select value from jsonb_array_elements(source_rows) order by (value->>'source_row')::integer
  loop
    candidate=null;
    match_name=agronorte_private.normalize_producer_name(row_value->>'source_producer_name');
    match_name=case match_name when 'RICHARD LLAMOSAS' then 'RICHAR LLAMOSAS'
      when 'MATIAS ALARCON' then 'MATIA ALARCON' when 'CIRILA SALINAS' then 'CIRIA SALINAS'
      when 'AGUSTIN VERA TAPARI' then 'AGUSTIN VERA' else match_name end;
    select coalesce(array_agg(value),array[]::text[]) into notes_value
      from jsonb_array_elements_text(coalesce(row_value->'review_notes','[]'::jsonb));
    if match_name<>'' then
      select count(*),(array_agg(p.id order by p.id))[1] into match_count,candidate
        from public.producers p where p.organization_id=org
          and agronorte_private.normalize_producer_name(p.name)=match_name;
      if match_count=0 then
        candidate=null;notes_value=array_append(notes_value,'Sin coincidencia exacta en los productores registrados; vinculación pendiente.');
      elsif match_count>1 then
        candidate=null;notes_value=array_append(notes_value,'Coincidencias múltiples de nombre; no se vinculó automáticamente a un productor.');
      end if;
    else
      notes_value=array_append(notes_value,'Sin nombre de productor en la fuente; instalación conservada sin vincular.');
    end if;
    select * into existing_value from public.trap_installations
      where organization_id=org and source_key=source_key_value and source_row=(row_value->>'source_row')::integer for update;
    -- A confirmed previous link remains stable if a later duplicate name appears.
    if candidate is null and existing_value.producer_id is not null and match_name<>''
      and exists(select 1 from public.producers p where p.id=existing_value.producer_id and p.organization_id=org
        and agronorte_private.normalize_producer_name(p.name)=match_name) then
      candidate=existing_value.producer_id;
      notes_value=array_append(notes_value,'Vinculación previa conservada; revisar el nombre duplicado o pendiente.');
    end if;
    installation=jsonb_populate_record(null::public.trap_installations,row_value||jsonb_build_object(
      'id',coalesce(existing_value.id,gen_random_uuid()),'organization_id',org,'producer_id',candidate,
      'source_key',source_key_value,'source_document','FOR%20-DVF-013%20PLANILLA%20DE%20INSTALACION%20DE%20TRAMPAS.pdf',
      'source_form','FOR-DVF-013','source_version','01','review_notes',to_jsonb(notes_value),
      'status',coalesce(existing_value.status,'Activo'),'created_at',coalesce(existing_value.created_at,now()),
      'updated_at',now(),'created_by',case when existing_value.id is null then auth.uid() else existing_value.created_by end));
    if existing_value.id is not null and
      (to_jsonb(existing_value)-array['created_at','updated_at','created_by'])=(to_jsonb(installation)-array['created_at','updated_at','created_by']) then
      continue;
    end if;
    insert into public.trap_installations select installation.*
      on conflict(organization_id,source_key,source_row) do update set
        producer_id=excluded.producer_id,source_document=excluded.source_document,source_form=excluded.source_form,source_version=excluded.source_version,
        source_producer_name=excluded.source_producer_name,trap_code=excluded.trap_code,department=excluded.department,district=excluded.district,
        community=excluded.community,installed_on=excluded.installed_on,trap_type=excluded.trap_type,latitude_raw=excluded.latitude_raw,
        longitude_raw=excluded.longitude_raw,installation_place=excluded.installation_place,host=excluded.host,area_ha=excluded.area_ha,
        crop_stage=excluded.crop_stage,responsible=excluded.responsible,review_notes=excluded.review_notes;
    changed=changed+1;
  end loop;

  -- Fill only missing producer information; source-specific Canindeyú supersedes
  -- the earlier generic San Pedro default, while personal origin overrides stay.
  for producer_record in select distinct p.* from public.producers p
    join public.trap_installations t on t.producer_id=p.id and t.organization_id=p.organization_id
    where p.organization_id=org and t.source_key=source_key_value and t.status='Activo'
      and lower(trim(t.host)) in ('sandia','sandía','melancia') order by p.id
  loop
    before_producer=to_jsonb(producer_record);
    select * into installation from public.trap_installations t where t.organization_id=org
      and t.producer_id=producer_record.id and t.source_key=source_key_value and t.status='Activo'
      and lower(trim(t.host)) in ('sandia','sandía','melancia') order by t.source_row limit 1;
    origin_value=case upper(trim(installation.department)) when 'SAN PEDRO' then 'Depto. de San Pedro – Paraguay'
      when 'CANINDEYU' then 'Depto. de Canindeyú – Paraguay' else null end;
    if origin_value is not null and (nullif(trim(producer_record.metadata->>'export_origin'),'') is null
      or (upper(trim(installation.department))='CANINDEYU'
        and replace(agronorte_private.normalize_producer_name(producer_record.metadata->>'export_origin'),'–','-')='DEPTO. DE SAN PEDRO - PARAGUAY')) then
      update public.producers set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('export_origin',origin_value),updated_at=now()
        where id=producer_record.id and organization_id=org;
    end if;
    if nullif(trim(producer_record.community),'') is null and nullif(trim(installation.community),'') is not null then
      update public.producers set community=installation.community,updated_at=now() where id=producer_record.id and organization_id=org;
    end if;
    select to_jsonb(p) into after_producer from public.producers p where p.id=producer_record.id and p.organization_id=org;
    if before_producer is distinct from after_producer then
      affected_ids=array_append(affected_ids,producer_record.id);changed=changed+1;
    end if;
  end loop;
  if cardinality(affected_ids)>0 then
    update public.pallets p set status='En armado',updated_at=now()
      where p.organization_id=org and p.status in ('Etiquetado','Listo para carga')
      and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
      and exists(select 1 from public.pallet_items i
        join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
        join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
        left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
        left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
        where i.pallet_id=p.id and i.organization_id=org and i.status<>'Cancelado'
          and coalesce(f.producer_id,l.producer_id)=any(affected_ids));
  end if;
  if changed>0 then update public.organizations set revision=revision+1 where id=org;end if;
  perform set_config('agronorte.trap_import_batch','off',true);
  perform set_config('agronorte.correction_reason','',true);
  raise notice '23 instalaciones conservadas; % operaciones aplicadas. Actualice los datos y vuelva a imprimir las etiquetas afectadas.',changed;
end
$import$;
commit;

select t.source_row,t.trap_code,t.source_producer_name,p.name as productor_registrado,
  t.department,t.district,t.community,t.installed_on,t.latitude_raw,t.longitude_raw,t.review_notes
from public.trap_installations t left join public.producers p on p.id=t.producer_id and p.organization_id=t.organization_id
where t.organization_id='20000000-0000-4000-8000-000000000001' and t.source_key='FOR-DVF-013-2026-08-AGRONORTE'
order by t.source_row;
