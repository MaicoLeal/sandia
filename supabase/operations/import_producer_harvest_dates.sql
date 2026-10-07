-- GENERIC TEMPLATE: replace $harvest_rows$ JSON with the verified 22 source rows.
-- Source image: WhatsApp Image 2026-10-07 at 9.42.27 AM.jpeg.
-- The source shows day/month; 2026 comes from the owner's campaign context.
-- Blank dates are not inferred. Pending dates are stored as references only.
-- Cutoff: 07/10/2026 10:21:07 Paraguay (13:21:07 UTC).
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';
do $$begin
  if to_regclass('public.organizations') is null or to_regclass('public.producers') is null
    or to_regclass('public.field_lots') is null or to_regclass('public.receptions') is null
    or to_regclass('public.pallets') is null or to_regclass('public.pallet_items') is null
    or to_regclass('public.shipment_pallets') is null or to_regclass('public.audit_logs') is null then
    raise exception 'La base Sandía no existe en este proyecto. Abra el proyecto znbtwkhktlldzhkiwodu.';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='producers' and column_name='metadata')
    or to_regprocedure('agronorte_private.normalize_producer_name(text)') is null then
    raise exception 'Aplique primero la actualización de productores e instalaciones de trampas.';
  end if;
end$$;
do $harvest_import$
declare
  org constant uuid='20000000-0000-4000-8000-000000000001';
  cutoff constant timestamptz='2026-10-07 13:21:07+00';
  source_name constant text='WhatsApp Image 2026-10-07 at 9.42.27 AM.jpeg';
  source_rows constant jsonb=$harvest_rows$[]$harvest_rows$::jsonb;
  row_value jsonb;match_name text;match_count integer;producer_id_value uuid;date_value date;status_value text;
  notes_value text[];old_metadata jsonb;new_metadata jsonb;reference_value jsonb;
  lot_record record;affected_ids uuid[]=array[]::uuid[];changed_count integer=0;
  older_receipts integer;other_dates integer;closed_lots integer;
  source_entity uuid;source_audit jsonb;actor_name text;
begin
  if not exists(select 1 from public.organizations where id=org and name='Cooperativa Agronorte') then
    raise exception 'Esta base no es la Cooperativa Agronorte autorizada. Abra el proyecto znbtwkhktlldzhkiwodu.';
  end if;
  if jsonb_typeof(source_rows) is distinct from 'array' or jsonb_array_length(source_rows)<>22 then
    raise exception 'La importación requiere las 22 filas verificadas de la imagen de cosechas.';
  end if;
  if (select count(distinct (v->>'source_row')::integer) from jsonb_array_elements(source_rows) v)<>22
    or exists(select 1 from jsonb_array_elements(source_rows) v where (v->>'source_row')::integer not between 1 and 22) then
    raise exception 'Las filas de origen deben ser únicas, numeradas del 1 al 22.';
  end if;
  if exists(select 1 from unnest(array['producers','field_lots','pallets']) required_table(table_name)
    where not exists(select 1 from pg_catalog.pg_trigger where tgrelid=('public.'||required_table.table_name)::regclass
      and tgname='audit_change' and tgenabled in ('O','A') and not tgisinternal)) then
    raise exception 'La auditoría de productores, lotes y pallets debe estar activa.';
  end if;
  perform 1 from public.organizations where id=org for update;
  perform set_config('agronorte.correction_reason',
    'Importación autorizada de fechas de cosecha de la imagen del 07/10/2026; campaña 2026. Fechas vacías y conflictos conservados sin inferencias.',true);
  select name into actor_name from public.profiles where user_id=auth.uid();

  for row_value in select value from jsonb_array_elements(source_rows) order by (value->>'source_row')::integer
  loop
    if jsonb_typeof(row_value->'producer_name') is distinct from 'string' or length(trim(row_value->>'producer_name')) not between 1 and 200 then
      raise exception 'Nombre de productor inválido en fila %',row_value->>'source_row';
    end if;
    if row_value->'date' is null or row_value->'date'='null'::jsonb then continue;end if;
    if jsonb_typeof(row_value->'date') is distinct from 'string' or (row_value->>'date')!~'^2026-\d{2}-\d{2}$' then
      raise exception 'Fecha de cosecha inválida en fila %',row_value->>'source_row';
    end if;
    date_value=(row_value->>'date')::date;
    if to_char(date_value,'YYYY-MM-DD')<>row_value->>'date' then raise exception 'Fecha de cosecha inválida';end if;
    status_value=coalesce(row_value->>'status','Confirmado');
    if status_value not in ('Confirmado','Pendiente de confirmar') then raise exception 'Estado de fecha de cosecha inválido';end if;
    if jsonb_typeof(coalesce(row_value->'notes','[]'::jsonb)) is distinct from 'array'
      or jsonb_array_length(coalesce(row_value->'notes','[]'::jsonb))>8
      or exists(select 1 from jsonb_array_elements(coalesce(row_value->'notes','[]'::jsonb)) n where jsonb_typeof(n)<>'string' or length(n#>>'{}')>500) then
      raise exception 'Notas de origen inválidas';
    end if;
    select coalesce(array_agg(value),array[]::text[]) into notes_value from jsonb_array_elements_text(coalesce(row_value->'notes','[]'::jsonb));
    if date_value>(cutoff at time zone 'America/Asuncion')::date then
      status_value='Pendiente de confirmar';
      notes_value=array_append(notes_value,'Fecha posterior al corte de importación: no aplicada como cosecha realizada.');
    end if;
    match_name=agronorte_private.normalize_producer_name(row_value->>'producer_name');
    match_name=case match_name when 'RICHARD LLAMOSAS' then 'RICHAR LLAMOSAS'
      when 'MATIAS ALARCON' then 'MATIA ALARCON' when 'CIRILA SALINAS' then 'CIRIA SALINAS'
      when 'AGUSTIN VERA TAPARI' then 'AGUSTIN VERA' else match_name end;
    select count(*),(array_agg(p.id order by p.id))[1] into match_count,producer_id_value
      from public.producers p where p.organization_id=org and agronorte_private.normalize_producer_name(p.name)=match_name;
    if match_count<>1 then
      notes_value=array_append(notes_value,case when match_count=0 then 'Sin coincidencia exacta: no se cambió ningún productor ni lote.'
        else 'Coincidencias múltiples: no se cambió ningún productor ni lote.' end);
      source_entity=md5(org::text||source_name||':'||(row_value->>'source_row'))::uuid;
      source_audit=jsonb_build_object('source',source_name,'source_row',(row_value->>'source_row')::integer,
        'producer_name',row_value->>'producer_name','date',to_char(date_value,'YYYY-MM-DD'),
        'status',status_value,'season',2026,'notes',to_jsonb(notes_value));
      if not exists(select 1 from public.audit_logs a where a.organization_id=org and a.entity_type='producer_harvest_import'
        and a.entity_id=source_entity and a."after"=source_audit) then
        insert into public.audit_logs(organization_id,entity_type,entity_id,action,actor,"after",reason,created_by)
          values(org,'producer_harvest_import',source_entity,'Fecha de cosecha sin vínculo',coalesce(actor_name,'Administrador del servidor'),
            source_audit,current_setting('agronorte.correction_reason',true),auth.uid());
        changed_count=changed_count+1;
      end if;
      continue;
    end if;
    older_receipts=0;other_dates=0;closed_lots=0;
    for lot_record in select l.*,
      exists(select 1 from public.pallet_items i join public.pallets p on p.id=i.pallet_id and p.organization_id=i.organization_id
        join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
        where r.lot_id=l.id and r.organization_id=org
          and (p.status='Expedido' or exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id))) as shipped,
      exists(select 1 from public.receptions r where r.lot_id=l.id and r.organization_id=org and r.date<date_value) as receipt_before_harvest
      from public.field_lots l left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
      left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
      where l.organization_id=org and coalesce(f.producer_id,l.producer_id)=producer_id_value and l.created_at<=cutoff
      order by l.id for update of l
    loop
      if lot_record.status in ('Expedido','Rechazado','Cancelado') or lot_record.shipped then
        closed_lots=closed_lots+1;continue;
      end if;
      if lot_record.harvest_date is not null and lot_record.harvest_date<>date_value then other_dates=other_dates+1;end if;
      if lot_record.receipt_before_harvest then older_receipts=older_receipts+1;continue;end if;
      if status_value='Confirmado' and lot_record.harvest_date is null then
        update public.field_lots set harvest_date=date_value,updated_at=now() where id=lot_record.id and organization_id=org;
        changed_count=changed_count+1;
        if not producer_id_value=any(affected_ids) then affected_ids=array_append(affected_ids,producer_id_value);end if;
      end if;
    end loop;
    if older_receipts>0 then notes_value=array_append(notes_value,older_receipts||' lote(s) tienen recepción anterior a la fecha de fuente; no se aplicó la fecha a esos lotes.');end if;
    if other_dates>0 then notes_value=array_append(notes_value,other_dates||' lote(s) conservan una fecha de cosecha distinta ya registrada.');end if;
    if closed_lots>0 then notes_value=array_append(notes_value,closed_lots||' lote(s) cerrados o vinculados a expedición se conservaron sin cambios.');end if;
    select metadata into old_metadata from public.producers where id=producer_id_value and organization_id=org for update;
    reference_value=jsonb_build_object('date',to_char(date_value,'YYYY-MM-DD'),'status',status_value,'season',2026,
      'source',source_name||' · fila '||(row_value->>'source_row'),'notes',to_jsonb(notes_value));
    new_metadata=coalesce(old_metadata,'{}'::jsonb)||jsonb_build_object('harvest_reference',reference_value);
    if length(new_metadata::text)>4096 then raise exception 'Referencia de cosecha excede el tamaño permitido; no se cambió ningún dato';end if;
    if old_metadata is distinct from new_metadata then
      update public.producers set metadata=new_metadata,updated_at=now() where id=producer_id_value and organization_id=org;
      changed_count=changed_count+1;
      if not producer_id_value=any(affected_ids) then affected_ids=array_append(affected_ids,producer_id_value);end if;
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
  if changed_count>0 then update public.organizations set revision=revision+1 where id=org;end if;
  perform set_config('agronorte.correction_reason','',true);
  raise notice 'Cosechas: % operaciones aplicadas; campos vacíos, fechas pendientes y lotes con conflictos se conservaron.',changed_count;
end
$harvest_import$;
commit;

select p.name as productor,p.metadata->'harvest_reference' as referencia_cosecha
from public.producers p where p.organization_id='20000000-0000-4000-8000-000000000001'
order by p.name,p.id;
select a."after" as referencia_sin_vinculo from public.audit_logs a
where a.organization_id='20000000-0000-4000-8000-000000000001' and a.entity_type='producer_harvest_import'
order by a.created_at,a.id;
