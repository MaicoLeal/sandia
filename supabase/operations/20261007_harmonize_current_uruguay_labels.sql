-- Authorized harmonization of current labels, including new receptions.
-- Project znbtwkhktlldzhkiwodu / Cooperativa Agronorte. Run complete in SQL Editor.
-- Cutoff: 07/10/2026 15:13:45 Paraguay (18:13:45 UTC); no future defaults.
-- AFIDI 1571652, SENAVE label model and pending packaging date 07/10/2026.
-- Harvest references and SPE/CAN codes come exclusively from existing records.
-- Existing dates and legitimate explicit producer codes remain unchanged.
-- Multiple distinct harvest dates are never collapsed into one label date.
-- Fill only missing confirmed origin and a coherent Rinalir importer pair.
-- No receptions, producer references, weights, destinations, pallet/lot codes or QR change.
-- Changed open labels return to En armado for reprinting; closed/linked stay unchanged.
-- Optional expected_revision below checks concurrency; null never overrides a revision.
-- Audit identity comes from the real SQL session through public.audit_record().
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';

do $$begin
  if exists(select 1 from unnest(array['organizations','profiles','producers','farms','plots','field_lots',
    'receptions','pallets','pallet_items','shipment_pallets','trap_installations','audit_logs']) t(table_name)
    where to_regclass('public.'||t.table_name) is null) then
    raise exception 'La base Sandía no existe en este proyecto. Abra znbtwkhktlldzhkiwodu.';
  end if;
  if to_regprocedure('agronorte_private.valid_export_label(jsonb)') is null
    or to_regprocedure('agronorte_private.trap_reference_codes(uuid,uuid)') is null
    or to_regprocedure('public.audit_record()') is null or to_regprocedure('public.sandia_features()') is null then
    raise exception 'Aplique primero las actualizaciones de etiquetas, productores y planilla de trampas.';
  end if;
  if coalesce(public.sandia_features()->>'label_export_data','false')<>'true'
    or coalesce(public.sandia_features()->>'trap_installations','false')<>'true'
    or coalesce(public.sandia_features()->>'label_importer_details','false')<>'true' then
    raise exception 'Aplique primero las actualizaciones de etiquetas, planilla de trampas e importador.';
  end if;
end$$;

do $refresh_labels$
declare
  org constant uuid='20000000-0000-4000-8000-000000000001';
  cutoff constant timestamptz='2026-10-07 18:13:45+00';
  packaging_date constant date='2026-10-07';
  operation_config constant jsonb=$harmonization_config${"expected_revision":null}$harmonization_config$::jsonb;
  importer_name constant text='RINALIR SOCIEDAD ANÓNIMA';
  importer_address constant text='BATLLE Y ORDÓÑEZ 534, TACUAREMBÓ, URUGUAY';
  expected_revision bigint;actual_revision bigint;
  scoped_ids uuid[]=array[]::uuid[];changed_lots uuid[]=array[]::uuid[];
  item record;lot_item record;source record;reference_value jsonb;reference_date date;
  fields jsonb;new_fields jsonb;new_metadata jsonb;label_changed boolean;
  explicit_code text;code_value text;codes_value text[];joined_codes text;codes_complete boolean;
  origins_value text[];origin_value text;joined_origin text;origins_complete boolean;
  existing_importer_name text;existing_importer_address text;
  source_count integer;harvest_dates date[];harvest_complete boolean;chronology_safe boolean;
  source_date date;already_packaged date;lot_label_changed boolean;
  lots_updated integer=0;pallets_updated integer=0;packaging_pending integer=0;
begin
  if not exists(select 1 from public.organizations where id=org and name='Cooperativa Agronorte') then
    raise exception 'Esta base no es la Cooperativa Agronorte autorizada. Abra znbtwkhktlldzhkiwodu.';
  end if;
  if (cutoff at time zone 'America/Asuncion')::date<>packaging_date then
    raise exception 'La fecha de envasado y el corte autorizado no coinciden en Paraguay.';
  end if;
  if exists(select 1 from unnest(array['field_lots','pallets']) t(table_name)
    where not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid=('public.'||t.table_name)::regclass and tgname='audit_change'
        and tgfoid=to_regprocedure('public.audit_record()') and tgenabled in ('O','A')
        and not tgisinternal and tgqual is null and (tgtype::integer & 17)=17 and (tgtype::integer & 2)=0)) then
    raise exception 'La auditoría de lotes y pallets debe estar activa y vinculada a public.audit_record().';
  end if;
  if jsonb_typeof(operation_config) is distinct from 'object' then
    raise exception 'Configuración de revisión inválida. No se cambió ningún registro.';
  end if;
  if exists(select 1 from jsonb_object_keys(operation_config) k where k<>'expected_revision') then
    raise exception 'Configuración de revisión inválida. No se cambió ningún registro.';
  end if;
  if operation_config->'expected_revision' is not null and operation_config->'expected_revision'<>'null'::jsonb then
    if jsonb_typeof(operation_config->'expected_revision')<>'number'
      or (operation_config->>'expected_revision')!~'^[0-9]+$' then
      raise exception 'La revisión esperada debe ser un entero no negativo o null.';
    end if;
    expected_revision=(operation_config->>'expected_revision')::bigint;
  end if;
  select revision into actual_revision from public.organizations where id=org for update;
  if expected_revision is not null and expected_revision<>actual_revision then
    raise exception 'Conflicto de revisión: se esperaba %, pero la base tiene %. Actualice los datos; no se cambió ningún registro.',expected_revision,actual_revision;
  end if;

  -- Verify and lock every current eligible pallet before any updates.
  for item in select p.* from public.pallets p
    where p.organization_id=org and p.created_at<=cutoff and lower(trim(p.destination))='uruguay'
      and p.status in ('En armado','Etiquetado','Listo para carga')
      and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
    order by p.id for update of p
  loop
    if item.metadata is not null and jsonb_typeof(item.metadata)<>'object' then
      raise exception 'Metadatos inválidos en pallet %. No se cambió ningún registro.',item.code;
    end if;
    fields=coalesce(nullif(item.metadata->'export_label','null'::jsonb),'{}'::jsonb);
    if jsonb_typeof(fields)<>'object' then
      raise exception 'Datos de etiqueta inválidos en pallet %. No se cambió ningún registro.',item.code;
    end if;
    if fields ? 'packaged_date' and nullif(trim(fields->>'packaged_date'),'') is null then
      fields=fields||jsonb_build_object('packaged_date',null);
    end if;
    if fields ? 'harvest_date' and nullif(trim(fields->>'harvest_date'),'') is null then
      fields=fields||jsonb_build_object('harvest_date',null);
    end if;
    if not agronorte_private.valid_export_label(fields) then
      raise exception 'Datos o fechas de etiqueta inválidos en pallet %. No se cambió ningún registro.',item.code;
    end if;
    scoped_ids=array_append(scoped_ids,item.id);
  end loop;

  perform set_config('agronorte.correction_reason',
    'Armonización autorizada el 07/10/2026 hasta 18:13:45 UTC: cosecha confirmada compatible, AFIDI 1571652 y modelo SENAVE, envasado pendiente 07/10/2026, códigos SPE/CAN, origen confirmado de todas las procedencias e importador RINALIR según imagen del propietario; conserva fechas, códigos legítimos, comprador propio, pesos y QR.',true);

  -- A lot may be prepared before palletization. Its real harvest is independent
  -- of destination; only current receptions are considered and existing dates stay.
  for lot_item in select l.*,pr.metadata as producer_metadata
    from public.field_lots l
    left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
    left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
    left join public.producers pr on pr.id=coalesce(f.producer_id,l.producer_id) and pr.organization_id=l.organization_id
    where l.organization_id=org and l.created_at<=cutoff and l.harvest_date is null
      and lower(trim(l.crop)) in ('sandia','sandía','melancia')
      and l.status not in ('Expedido','Rechazado','Cancelado')
      and exists(select 1 from public.receptions r where r.lot_id=l.id and r.organization_id=org
        and r.created_at<=cutoff and r.date between '2026-01-01'::date and packaging_date and r.status<>'Cancelado')
      and not exists(select 1 from public.pallet_items i
        join public.pallets p on p.id=i.pallet_id and p.organization_id=i.organization_id
        join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
        where r.lot_id=l.id and r.organization_id=org
          and (p.status='Expedido' or exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)))
    order by l.id for update of l
  loop
    reference_value=lot_item.producer_metadata->'harvest_reference';
    if reference_value is null or reference_value='null'::jsonb then continue;end if;
    if jsonb_typeof(reference_value)<>'object' then
      raise exception 'Referencia de cosecha inválida en lote %. No se cambió ningún registro.',lot_item.code;
    end if;
    if reference_value->>'status' is distinct from 'Confirmado' or reference_value->>'season' is distinct from '2026' then continue;end if;
    if nullif(reference_value->>'date','') is null
      or not agronorte_private.valid_export_label(jsonb_build_object('harvest_date',reference_value->'date')) then
      raise exception 'Fecha de cosecha confirmada inválida en lote %. No se cambió ningún registro.',lot_item.code;
    end if;
    reference_date=(reference_value->>'date')::date;
    if reference_date>packaging_date or extract(year from reference_date)<>2026 then continue;end if;
    if exists(select 1 from public.receptions r where r.lot_id=lot_item.id and r.organization_id=org and r.status<>'Cancelado'
      and (r.date<reference_date or r.date>packaging_date or r.created_at>cutoff)) then continue;end if;
    update public.field_lots set harvest_date=reference_date,updated_at=now()
      where id=lot_item.id and organization_id=org;
    changed_lots=array_append(changed_lots,lot_item.id);lots_updated=lots_updated+1;
  end loop;

  for item in select p.* from public.pallets p where p.organization_id=org and p.id=any(scoped_ids) order by p.id
  loop
    fields=coalesce(nullif(item.metadata->'export_label','null'::jsonb),'{}'::jsonb);
    if fields ? 'packaged_date' and nullif(trim(fields->>'packaged_date'),'') is null then
      fields=fields||jsonb_build_object('packaged_date',null);
    end if;
    if fields ? 'harvest_date' and nullif(trim(fields->>'harvest_date'),'') is null then
      fields=fields||jsonb_build_object('harvest_date',null);
    end if;
    new_fields=fields||jsonb_build_object('afidi','1571652','senave_program',true);
    explicit_code=nullif(trim(fields->>'producer_code'),'');
    codes_value=array[]::text[];codes_complete=true;source_count=0;
    origins_value=array[]::text[];origins_complete=true;
    harvest_dates=array[]::date[];harvest_complete=true;chronology_safe=true;lot_label_changed=false;
    already_packaged=nullif(fields->>'packaged_date','')::date;
    if nullif(fields->>'harvest_date','')::date>packaging_date then chronology_safe=false;end if;

    for source in select i.id,r.date as reception_date,r.created_at as reception_created,r.status as reception_status,
      l.id as lot_id,l.harvest_date,l.created_at as lot_created,l.crop as lot_crop,l.status as lot_status,
      pr.metadata as producer_metadata,
      agronorte_private.trap_reference_codes(org,pr.id) as reference_codes
      from public.pallet_items i
      join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
      join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
      left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
      left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
      left join public.producers pr on pr.id=coalesce(f.producer_id,l.producer_id) and pr.organization_id=l.organization_id
      where i.pallet_id=item.id and i.organization_id=org and i.status<>'Cancelado'
      order by i.created_at,i.id
    loop
      source_count=source_count+1;
      if source.lot_id=any(changed_lots) then lot_label_changed=true;end if;
      if source.reception_status='Cancelado' or lower(trim(source.lot_crop)) not in ('sandia','sandía','melancia')
        or source.lot_status in ('Expedido','Rechazado','Cancelado') then
        codes_complete=false;harvest_complete=false;chronology_safe=false;origins_complete=false;continue;
      end if;
      origin_value=nullif(trim(source.producer_metadata->>'export_origin'),'');
      if jsonb_typeof(source.producer_metadata->'export_origin') is distinct from 'string' or origin_value is null then
        origins_complete=false;
      elsif not origin_value=any(origins_value) then origins_value=array_append(origins_value,origin_value);end if;
      if source.reception_date>packaging_date or source.harvest_date>packaging_date
        or source.harvest_date>source.reception_date
        or source.reception_created>cutoff or source.lot_created>cutoff then chronology_safe=false;end if;
      if nullif(fields->>'harvest_date','')::date>source.reception_date then chronology_safe=false;end if;
      source_date=source.harvest_date;
      if source_date is null or source_date>source.reception_date or source_date>packaging_date
        or source.reception_created>cutoff or source.lot_created>cutoff
        or (already_packaged is not null and (source_date>already_packaged or source.reception_date>already_packaged)) then
        harvest_complete=false;
      elsif not source_date=any(harvest_dates) then harvest_dates=array_append(harvest_dates,source_date);end if;
      if jsonb_array_length(source.reference_codes)>0 then
        for code_value in select trim(value) from jsonb_array_elements_text(source.reference_codes) with ordinality order by ordinality
        loop
          if code_value='' or code_value~*'^AGN-[0-9]+(\s*/\s*AGN-[0-9]+)*$' then codes_complete=false;
          elsif not code_value=any(codes_value) then codes_value=array_append(codes_value,code_value);end if;
        end loop;
      else
        code_value=nullif(trim(source.producer_metadata->>'export_code'),'');
        if code_value is null or code_value~*'^AGN-[0-9]+(\s*/\s*AGN-[0-9]+)*$' then codes_complete=false;
        elsif not code_value=any(codes_value) then codes_value=array_append(codes_value,code_value);end if;
      end if;
    end loop;

    -- Preserve explicit real codes; AGN is an internal identifier, never official.
    if explicit_code is null or explicit_code~*'^AGN-[0-9]+(\s*/\s*AGN-[0-9]+)*$' then
      joined_codes=array_to_string(codes_value,' / ');
      if source_count>0 and codes_complete and length(joined_codes) between 1 and 100 then
        new_fields=new_fields||jsonb_build_object('producer_code',joined_codes);
      elsif explicit_code is not null then
        new_fields=new_fields||jsonb_build_object('producer_code','');
      end if;
    end if;
    if nullif(fields->>'harvest_date','') is null and source_count>0 and harvest_complete
      and cardinality(harvest_dates)=1 then
      new_fields=new_fields||jsonb_build_object('harvest_date',to_char(harvest_dates[1],'YYYY-MM-DD'));
    end if;
    if already_packaged is null then
      if source_count>0 and chronology_safe then
        new_fields=new_fields||jsonb_build_object('packaged_date',to_char(packaging_date,'YYYY-MM-DD'));
      else packaging_pending=packaging_pending+1;end if;
    end if;
    -- Origin is confirmed per producer; never force San Pedro over Canindeyú.
    joined_origin=array_to_string(origins_value,' / ');
    if nullif(trim(fields->>'origin'),'') is null and source_count>0 and origins_complete
      and length(joined_origin) between 1 and 200 then
      new_fields=new_fields||jsonb_build_object('origin',joined_origin);
    end if;
    -- Keep another buyer's data, including incomplete pairs, instead of mixing buyers.
    existing_importer_name=nullif(trim(fields->>'importer_name'),'');
    existing_importer_address=nullif(trim(fields->>'importer_address'),'');
    if (existing_importer_name is null or lower(existing_importer_name)=lower(importer_name))
      and (existing_importer_address is null or lower(existing_importer_address)=lower(importer_address)) then
      if existing_importer_name is null then new_fields=new_fields||jsonb_build_object('importer_name',importer_name);end if;
      if existing_importer_address is null then new_fields=new_fields||jsonb_build_object('importer_address',importer_address);end if;
    end if;
    if not agronorte_private.valid_export_label(new_fields) then
      raise exception 'La etiqueta resultante es inválida en pallet %. No se cambió ningún registro.',item.code;
    end if;
    new_metadata=coalesce(item.metadata,'{}'::jsonb)||jsonb_build_object('export_label',new_fields);
    label_changed=item.metadata is distinct from new_metadata;
    -- A newly confirmed lot date affects a dynamic label even if its override stays blank.
    if label_changed or (lot_label_changed and nullif(fields->>'harvest_date','') is null
      and item.status in ('Etiquetado','Listo para carga')) then
      update public.pallets set metadata=new_metadata,status='En armado',updated_at=now()
        where id=item.id and organization_id=org;
      pallets_updated=pallets_updated+1;
    end if;
  end loop;
  if lots_updated+pallets_updated>0 then update public.organizations set revision=revision+1 where id=org;end if;
  perform set_config('agronorte.correction_reason','',true);
  raise notice 'Armonización: % lotes con cosecha confirmada, % pallets actualizados, % envasados pendientes por origen/cronología. Revise origen/importador y demás pendientes; sincronice y reimprima etiquetas modificadas.',lots_updated,pallets_updated,packaging_pending;
end
$refresh_labels$;
commit;

-- Current eligible pallets, with unresolved dates/codes explicitly visible.
with sources as (
  select i.pallet_id,pr.name as producer,l.code as lot,r.date as reception_date,
    nullif(trim(pr.metadata->>'export_origin'),'') as producer_origin,
    l.harvest_date,pr.metadata->'harvest_reference' as harvest_reference,
    r.created_at as reception_created,l.created_at as lot_created,
    nullif(p.metadata#>>'{export_label,harvest_date}','')::date as label_harvest,
    nullif(p.metadata#>>'{export_label,packaged_date}','')::date as label_packaged,
    r.status<>'Cancelado' and lower(trim(l.crop)) in ('sandia','sandía','melancia')
      and l.status not in ('Expedido','Rechazado','Cancelado') as valid_source,
    case when r.status='Cancelado' or lower(trim(l.crop)) not in ('sandia','sandía','melancia')
      or l.status in ('Expedido','Rechazado','Cancelado') then '[]'::jsonb
      when jsonb_array_length(agronorte_private.trap_reference_codes(p.organization_id,pr.id))>0
        and not exists(select 1 from jsonb_array_elements_text(agronorte_private.trap_reference_codes(p.organization_id,pr.id)) v(value)
          where trim(v.value)='' or trim(v.value)~*'^AGN-[0-9]+(\s*/\s*AGN-[0-9]+)*$')
      then agronorte_private.trap_reference_codes(p.organization_id,pr.id)
      when jsonb_array_length(agronorte_private.trap_reference_codes(p.organization_id,pr.id))>0 then '[]'::jsonb
      when nullif(trim(pr.metadata->>'export_code'),'') is not null
        and trim(pr.metadata->>'export_code')!~*'^AGN-[0-9]+(\s*/\s*AGN-[0-9]+)*$'
      then jsonb_build_array(trim(pr.metadata->>'export_code')) else '[]'::jsonb end as producer_codes
  from public.pallets p join public.pallet_items i on i.pallet_id=p.id and i.organization_id=p.organization_id and i.status<>'Cancelado'
  join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
  join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
  left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
  left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
  left join public.producers pr on pr.id=coalesce(f.producer_id,l.producer_id) and pr.organization_id=l.organization_id
  where p.organization_id='20000000-0000-4000-8000-000000000001'
    and p.created_at<='2026-10-07 18:13:45+00'::timestamptz and lower(trim(p.destination))='uruguay'
    and p.status in ('En armado','Etiquetado','Listo para carga')
    and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
), summaries as (
  select pallet_id,string_agg(distinct producer,' / ' order by producer) as producers,
    string_agg(distinct lot,' / ' order by lot) as lots,count(*) as source_count,
    bool_and(valid_source and harvest_date is not null) as all_harvest_known,count(distinct harvest_date) as harvest_date_count,
    string_agg(distinct to_char(harvest_date,'DD/MM/YYYY'),' / ' order by to_char(harvest_date,'DD/MM/YYYY')) as harvest_dates,
    bool_and(jsonb_array_length(producer_codes)>0) as all_codes_known,
    bool_and(valid_source and producer_origin is not null) as all_origins_known,
    string_agg(distinct producer_origin,' / ' order by producer_origin) as source_origins,
    bool_or(not valid_source) as invalid_source,
    bool_or(reception_date>'2026-10-07'::date or harvest_date>'2026-10-07'::date
      or harvest_date>reception_date or reception_created>'2026-10-07 18:13:45+00'::timestamptz
      or lot_created>'2026-10-07 18:13:45+00'::timestamptz or label_harvest>reception_date
      or (label_packaged is not null and (label_harvest>label_packaged or harvest_date>label_packaged or reception_date>label_packaged))) as chronology_conflict,
    bool_or(harvest_reference->>'status'='Pendiente de confirmar') as pending_reference
  from sources group by pallet_id
), codes as (
  select s.pallet_id,string_agg(distinct trim(c.value),' / ' order by trim(c.value)) as source_codes
  from sources s cross join lateral jsonb_array_elements_text(s.producer_codes) c(value) group by s.pallet_id
)
select p.code as pallet,s.producers as productores,s.lots as lotes,p.status as estado,
  p.metadata#>>'{export_label,afidi}' as afidi,p.metadata#>>'{export_label,packaged_date}' as fecha_de_envasado,
  p.metadata#>>'{export_label,origin}' as origen_de_etiqueta,s.source_origins as origenes_confirmados,
  p.metadata#>>'{export_label,importer_name}' as importador,p.metadata#>>'{export_label,importer_address}' as direccion_del_importador,
  p.metadata#>>'{export_label,harvest_date}' as cosecha_de_etiqueta,s.harvest_dates as cosechas_de_origen,
  coalesce(nullif(trim(p.metadata#>>'{export_label,producer_code}'),''),c.source_codes) as codigo_del_productor,
  array_remove(array[
    case when coalesce(s.source_count,0)=0 then 'Sin origen vinculado' end,
    case when coalesce(s.invalid_source,false) then 'Origen cancelado, cerrado o de otro cultivo: no completar fechas/código automáticamente' end,
    case when nullif(p.metadata#>>'{export_label,packaged_date}','') is null then 'Envasado pendiente: revisar origen/fechas' end,
    case when coalesce(s.chronology_conflict,false)
      or nullif(p.metadata#>>'{export_label,harvest_date}','')::date> '2026-10-07'::date then 'Conflicto cronológico: conservar y revisar fechas' end,
    case when coalesce(s.pending_reference,false) then 'Cosecha del productor pendiente de confirmar' end,
    case when nullif(p.metadata#>>'{export_label,harvest_date}','') is null and not coalesce(s.all_harvest_known,false) then 'Cosecha no guardada en uno o más lotes: revisar referencia del productor en la etiqueta' end,
    case when nullif(p.metadata#>>'{export_label,harvest_date}','') is null and s.harvest_date_count>1 then 'Varias cosechas: etiqueta usa fechas de cada origen, sin fecha única' end,
    case when nullif(trim(p.metadata#>>'{export_label,producer_code}'),'') is null and not coalesce(s.all_codes_known,false) then 'Código de productor pendiente para una o más procedencias' end,
    case when nullif(trim(p.metadata#>>'{export_label,producer_code}'),'') is null and length(c.source_codes)>100 then 'Códigos múltiples conservados por origen: superan límite de campo único' end,
    case when nullif(trim(p.metadata#>>'{export_label,origin}'),'') is null and not coalesce(s.all_origins_known,false) then 'Origen pendiente para una o más procedencias: sin inferencias' end,
    case when nullif(trim(p.metadata#>>'{export_label,origin}'),'') is null and length(s.source_origins)>200 then 'Orígenes múltiples superan límite de campo único: conservados por origen' end,
    case when nullif(trim(p.metadata#>>'{export_label,importer_name}'),'') is null or nullif(trim(p.metadata#>>'{export_label,importer_address}'),'') is null then 'Importador incompleto: datos propios conservados; revisar nombre y dirección' end,
    case when nullif(trim(p.metadata#>>'{export_label,importer_name}'),'') is not null
      and lower(trim(p.metadata#>>'{export_label,importer_name}'))<>lower('RINALIR SOCIEDAD ANÓNIMA') then 'Importador propio distinto de RINALIR: conservado' end,
    case when nullif(trim(p.metadata#>>'{export_label,importer_address}'),'') is not null
      and lower(trim(p.metadata#>>'{export_label,importer_address}'))<>lower('BATLLE Y ORDÓÑEZ 534, TACUAREMBÓ, URUGUAY') then 'Dirección propia del importador: conservada' end
  ],null) as pendientes
from public.pallets p left join summaries s on s.pallet_id=p.id left join codes c on c.pallet_id=p.id
where p.organization_id='20000000-0000-4000-8000-000000000001'
  and p.created_at<='2026-10-07 18:13:45+00'::timestamptz and lower(trim(p.destination))='uruguay'
  and p.status in ('En armado','Etiquetado','Listo para carga')
  and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
order by p.created_at,p.code;

-- Receptions without pallets remain traceable; no date is inferred from missing data.
select r.id as recepcion,r.date as fecha_de_recepcion,pr.name as productor,l.code as lote,l.harvest_date as cosecha,
  pr.metadata->'harvest_reference' as referencia_existente,
  case when l.harvest_date is not null then 'Cosecha registrada: conservada'
    when pr.metadata#>>'{harvest_reference,status}' is distinct from 'Confirmado' then 'Cosecha pendiente: sin referencia confirmada'
    when pr.metadata#>>'{harvest_reference,season}' is distinct from '2026' then 'Referencia de otra campaña: conservada'
    when l.status in ('Expedido','Rechazado','Cancelado') then 'Lote cerrado: conservado'
    when lower(trim(l.crop)) not in ('sandia','sandía','melancia') then 'Otro cultivo: fecha no aplicada'
    when r.date>'2026-10-07'::date or extract(year from r.date)<>2026 then 'Recepción fuera de la fecha/campaña autorizada: conservada'
    else 'Cosecha pendiente: revisar referencia, fechas de recepciones o vínculo con expedición' end as resultado
from public.receptions r join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
left join public.producers pr on pr.id=coalesce(f.producer_id,l.producer_id) and pr.organization_id=l.organization_id
where r.organization_id='20000000-0000-4000-8000-000000000001'
  and r.created_at<='2026-10-07 18:13:45+00'::timestamptz and l.created_at<='2026-10-07 18:13:45+00'::timestamptz
  and r.status<>'Cancelado'
  and not exists(select 1 from public.pallet_items i where i.reception_id=r.id and i.organization_id=r.organization_id and i.status<>'Cancelado')
order by r.date,pr.name,l.code;
