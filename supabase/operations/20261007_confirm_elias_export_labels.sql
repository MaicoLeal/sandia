-- Explicit owner confirmation for Elias Galeano / lot 01102026 only.
-- Nine current pallets, 3,297 kg NET; weights already exclude the 42 kg packaging.
-- The owner reconfirmed BOTH harvest 02/10/2026 and reception 01/10/2026.
-- This operation preserves that chronology conflict; it does not repair a date.
-- Cutoff: 07/10/2026 18:13:45 UTC / 15:13:45 Paraguay. No future defaults.
-- Optional expected_revision may be set to 83 after verifying the live snapshot.
-- null permits an idempotent recheck; it never overwrites a revision or payload.
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';

do $$begin
  if exists(select 1 from unnest(array['organizations','profiles','producers','farms','plots','field_lots',
    'receptions','pallets','pallet_items','shipment_pallets','trap_installations','audit_logs']) t(table_name)
    where to_regclass('public.'||t.table_name) is null) then
    raise exception 'La base Sandía no existe en este proyecto. Abra znbtwkhktlldzhkiwodu.';
  end if;
  if to_regprocedure('agronorte_private.normalize_producer_name(text)') is null
    or to_regprocedure('agronorte_private.trap_reference_codes(uuid,uuid)') is null
    or to_regprocedure('agronorte_private.valid_export_label(jsonb)') is null
    or to_regprocedure('public.audit_record()') is null or to_regprocedure('public.sandia_features()') is null
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='pallets' and column_name='tare_kg') then
    raise exception 'Aplique primero las actualizaciones de productores, etiquetas, importador, trampas y tara.';
  end if;
  if coalesce(public.sandia_features()->>'label_export_data','false')<>'true'
    or coalesce(public.sandia_features()->>'label_importer_details','false')<>'true'
    or coalesce(public.sandia_features()->>'trap_installations','false')<>'true' then
    raise exception 'Aplique primero las actualizaciones de etiquetas, importador y trampas.';
  end if;
end$$;

do $confirm_elias$
declare
  org constant uuid='20000000-0000-4000-8000-000000000001';
  cutoff constant timestamptz='2026-10-07 18:13:45+00';
  harvest_date_value constant date='2026-10-02';
  reception_date_value constant date='2026-10-01';
  packaged_date_value constant date='2026-10-07';
  config constant jsonb=$elias_config${"expected_revision":null}$elias_config$::jsonb;
  importer_name constant text='RINALIR SOCIEDAD ANÓNIMA';
  importer_address constant text='BATLLE Y ORDÓÑEZ 534, TACUAREMBÓ, URUGUAY';
  confirmation_note constant text='El propietario reconfirmó cosecha 02/10/2026 y recepción 01/10/2026; la cosecha es posterior a la recepción. Fechas preservadas sin corrección automática.';
  expected_weights constant numeric[]=array[148,381,389,390,393,394,395,397,410]::numeric[];
  expected_revision bigint;actual_revision bigint;match_count integer;
  producer_id_value uuid;lot_id_value uuid;producer_record record;lot_record record;item record;planned record;
  pallet_ids uuid[];actual_weights numeric[];actual_total numeric;
  reference_value jsonb;notes_value jsonb;new_producer_metadata jsonb;
  reference_codes jsonb;producer_code_value text;origin_value text;
  fields jsonb;new_fields jsonb;new_metadata jsonb;planned_updates jsonb='[]'::jsonb;
  changed_count integer=0;
begin
  if not exists(select 1 from public.organizations where id=org and name='Cooperativa Agronorte') then
    raise exception 'Esta base no es la Cooperativa Agronorte autorizada.';
  end if;
  if exists(select 1 from unnest(array['producers','field_lots','pallets']) t(table_name)
    where not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid=('public.'||t.table_name)::regclass and tgname='audit_change'
        and tgfoid=to_regprocedure('public.audit_record()') and tgenabled in ('O','A')
        and not tgisinternal and tgqual is null and (tgtype::integer & 17)=17 and (tgtype::integer & 2)=0)) then
    raise exception 'La auditoría real de productores, lotes y pallets debe estar activa.';
  end if;
  if jsonb_typeof(config) is distinct from 'object' then raise exception 'Configuración de revisión inválida';end if;
  if exists(select 1 from jsonb_object_keys(config) k where k<>'expected_revision') then raise exception 'Configuración de revisión inválida';end if;
  if config->'expected_revision' is not null and config->'expected_revision'<>'null'::jsonb then
    if jsonb_typeof(config->'expected_revision')<>'number' or (config->>'expected_revision')!~'^[0-9]+$' then
      raise exception 'La revisión esperada debe ser un entero no negativo o null.';
    end if;
    expected_revision=(config->>'expected_revision')::bigint;
  end if;
  select revision into actual_revision from public.organizations where id=org for update;
  if expected_revision is not null and expected_revision<>actual_revision then
    raise exception 'Conflicto de revisión: se esperaba %, la base tiene %. No se cambió ningún registro.',expected_revision,actual_revision;
  end if;

  select count(*),(array_agg(p.id order by p.id))[1] into match_count,producer_id_value
    from public.producers p where p.organization_id=org
      and agronorte_private.normalize_producer_name(p.name)='ELIAS GALEANO';
  if match_count<>1 then raise exception 'Elias Galeano debe tener una única coincidencia exacta. Revise el productor.';end if;
  select * into producer_record from public.producers where id=producer_id_value and organization_id=org for update;
  if producer_record.metadata is not null and jsonb_typeof(producer_record.metadata)<>'object' then raise exception 'Metadatos del productor inválidos';end if;
  origin_value=nullif(trim(producer_record.metadata->>'export_origin'),'');
  if origin_value is null or replace(agronorte_private.normalize_producer_name(origin_value),'–','-')<>'DEPTO. DE SAN PEDRO - PARAGUAY' then
    raise exception 'La procedencia confirmada de Elias debe ser San Pedro. Revise el origen; no se sustituye otro valor.';
  end if;
  reference_codes=agronorte_private.trap_reference_codes(org,producer_id_value);
  if jsonb_array_length(reference_codes)=0 or exists(select 1 from jsonb_array_elements_text(reference_codes) c(value)
    where trim(c.value)!~*'^(SPE|CAN)-') then raise exception 'Falta código SPE/CAN confirmado de Elias. No se usa AGN como código oficial.';end if;
  select string_agg(trim(value),' / ' order by ordinality) into producer_code_value
    from jsonb_array_elements_text(reference_codes) with ordinality;
  if length(producer_code_value) not between 1 and 100 then raise exception 'Los códigos SPE/CAN exceden el campo único; revise sin truncar.';end if;

  select count(*),(array_agg(l.id order by l.id))[1] into match_count,lot_id_value
    from public.field_lots l
    left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
    left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
    where l.organization_id=org and l.code='01102026' and coalesce(f.producer_id,l.producer_id)=producer_id_value;
  if match_count<>1 then raise exception 'El lote 01102026 de Elias debe tener una única coincidencia. Revise el lote.';end if;
  select * into lot_record from public.field_lots where id=lot_id_value and organization_id=org for update;
  if lot_record.created_at>cutoff or lot_record.status in ('Expedido','Rechazado','Cancelado')
    or lower(trim(lot_record.crop)) not in ('sandia','sandía','melancia') then raise exception 'El lote de Elias está fuera del alcance actual autorizado.';end if;
  if lot_record.harvest_date is not null and lot_record.harvest_date<>harvest_date_value then
    raise exception 'El lote tiene otra cosecha registrada. Revise; no se sustituye una fecha existente.';
  end if;

  select array_agg(p.id order by p.id),array_agg(p.net_kg order by p.net_kg),sum(p.net_kg)
    into pallet_ids,actual_weights,actual_total from public.pallets p
    where p.organization_id=org and p.created_at<=cutoff
      and p.status in ('En armado','Etiquetado','Listo para carga')
      and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
      and exists(select 1 from public.pallet_items i join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
        where i.pallet_id=p.id and i.organization_id=org and i.status<>'Cancelado' and r.lot_id=lot_id_value);
  if coalesce(cardinality(pallet_ids),0)<>9 or actual_weights is distinct from expected_weights or actual_total is distinct from 3297::numeric then
    raise exception 'El lote debe tener los 9 pallets confirmados y el conjunto de pesos netos de 3297 kg. Revise; no se corrigen pesos automáticamente.';
  end if;

  reference_value=coalesce(nullif(producer_record.metadata->'harvest_reference','null'::jsonb),'{}'::jsonb);
  if jsonb_typeof(reference_value)<>'object' then raise exception 'Referencia de cosecha inválida';end if;
  if nullif(reference_value->>'date','') is not null and reference_value->>'date'<>'2026-10-02' then
    raise exception 'El productor tiene otra referencia de cosecha. Revise; no se sustituye otro valor.';
  end if;
  if reference_value ? 'season' and reference_value->>'season' is distinct from '2026' then raise exception 'La referencia pertenece a otra campaña. Revise.';end if;
  if reference_value ? 'status' and reference_value->>'status' not in ('Confirmado','Pendiente de confirmar') then raise exception 'Estado de referencia inválido';end if;
  notes_value=coalesce(nullif(reference_value->'notes','null'::jsonb),'[]'::jsonb);
  if jsonb_typeof(notes_value)<>'array' then raise exception 'Notas de referencia inválidas';end if;
  if exists(select 1 from jsonb_array_elements(notes_value) n where jsonb_typeof(n)<>'string') then raise exception 'Notas de referencia inválidas';end if;
  if not notes_value ? confirmation_note then notes_value=notes_value||jsonb_build_array(confirmation_note);end if;
  reference_value=reference_value||jsonb_build_object('date','2026-10-02','season',2026,'status','Confirmado','notes',notes_value);
  if nullif(trim(reference_value->>'source'),'') is null then reference_value=reference_value||jsonb_build_object('source','Confirmación expresa del propietario, 07/10/2026: cosecha y recepción reconfirmadas');end if;
  new_producer_metadata=coalesce(producer_record.metadata,'{}'::jsonb)||jsonb_build_object('harvest_reference',reference_value);
  if length(new_producer_metadata::text)>4096 then raise exception 'Referencia de cosecha excede el límite permitido';end if;

  -- All guards and planned metadata are checked before the first UPDATE.
  for item in select p.* from public.pallets p where p.id=any(pallet_ids) and p.organization_id=org order by p.id for update
  loop
    if exists(select 1 from public.pallet_items i join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
      join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
      left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
      left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
      where i.pallet_id=item.id and i.organization_id=org and i.status<>'Cancelado'
        and (l.id<>lot_id_value or coalesce(f.producer_id,l.producer_id) is distinct from producer_id_value
          or r.status='Cancelado' or r.created_at>cutoff or r.date<>reception_date_value)) then
      raise exception 'Pallet % tiene otra procedencia o recepción distinta de 01/10/2026. Revise sin sustituir datos.',item.code;
    end if;
    if item.metadata is not null and jsonb_typeof(item.metadata)<>'object' then raise exception 'Metadatos inválidos en pallet %',item.code;end if;
    fields=coalesce(nullif(item.metadata->'export_label','null'::jsonb),'{}'::jsonb);
    if not agronorte_private.valid_export_label(fields) then raise exception 'Etiqueta inválida en pallet %',item.code;end if;
    if nullif(fields->>'harvest_date','') is not null and fields->>'harvest_date'<>'2026-10-02'
      or nullif(fields->>'packaged_date','') is not null and fields->>'packaged_date'<>'2026-10-07' then
      raise exception 'Pallet % tiene otra fecha explícita. Revise; no se sustituye una fecha existente.',item.code;
    end if;
    if nullif(trim(fields->>'producer_code'),'') is not null
      and trim(fields->>'producer_code')!~*'^AGN-[0-9]+(\s*/\s*AGN-[0-9]+)*$'
      and trim(fields->>'producer_code')<>producer_code_value then raise exception 'Pallet % tiene otro código de productor explícito. Revise.',item.code;end if;
    if nullif(trim(fields->>'origin'),'') is not null
      and replace(agronorte_private.normalize_producer_name(fields->>'origin'),'–','-')<>'DEPTO. DE SAN PEDRO - PARAGUAY' then raise exception 'Pallet % tiene otro origen explícito. Revise.',item.code;end if;
    if nullif(trim(fields->>'importer_name'),'') is not null and lower(trim(fields->>'importer_name'))<>lower(importer_name)
      or nullif(trim(fields->>'importer_address'),'') is not null and lower(trim(fields->>'importer_address'))<>lower(importer_address) then
      raise exception 'Pallet % tiene datos de otro importador. Revise; no se mezclan compradores.',item.code;
    end if;
    new_fields=fields||jsonb_build_object('afidi','1571652','senave_program',true,'packaged_date','2026-10-07',
      'harvest_date','2026-10-02','producer_code',producer_code_value);
    if nullif(trim(fields->>'origin'),'') is null then new_fields=new_fields||jsonb_build_object('origin',origin_value);end if;
    if nullif(trim(fields->>'importer_name'),'') is null then new_fields=new_fields||jsonb_build_object('importer_name',importer_name);end if;
    if nullif(trim(fields->>'importer_address'),'') is null then new_fields=new_fields||jsonb_build_object('importer_address',importer_address);end if;
    new_metadata=coalesce(item.metadata,'{}'::jsonb)||jsonb_build_object('export_label',new_fields);
    if not agronorte_private.valid_export_label(new_fields) or length(new_metadata::text)>4096 then raise exception 'Etiqueta resultante inválida en pallet %',item.code;end if;
    planned_updates=planned_updates||jsonb_build_array(jsonb_build_object('id',item.id,'metadata',new_metadata));
  end loop;

  perform set_config('agronorte.correction_reason',
    'Confirmación expresa del propietario el 07/10/2026: Elias Galeano, lote 01102026, 9 pallets y 3297 kg netos para Uruguay/RINALIR/AFIDI 1571652; cosecha 02/10/2026 Y recepción 01/10/2026 reconfirmadas. Se conserva el conflicto cronológico sin corregir recepción, pesos ni QR.',true);
  if producer_record.metadata is distinct from new_producer_metadata then
    update public.producers set metadata=new_producer_metadata,updated_at=now() where id=producer_id_value and organization_id=org;
    changed_count=changed_count+1;
  end if;
  if lot_record.harvest_date is null then
    update public.field_lots set harvest_date=harvest_date_value,updated_at=now() where id=lot_id_value and organization_id=org;
    changed_count=changed_count+1;
  end if;
  for planned in select * from jsonb_to_recordset(planned_updates) as x(id uuid,metadata jsonb)
  loop
    update public.pallets set metadata=planned.metadata,destination='Uruguay',status='En armado',updated_at=now()
      where id=planned.id and organization_id=org and (metadata is distinct from planned.metadata or destination<>'Uruguay');
    if found then changed_count=changed_count+1;end if;
  end loop;
  if changed_count>0 then update public.organizations set revision=revision+1 where id=org;end if;
  perform set_config('agronorte.correction_reason','',true);
  raise notice 'Elias: % cambios auditados. Cosecha 02/10/2026 y recepción 01/10/2026 preservadas; conflicto cronológico explícito. Sincronice y reimprima las etiquetas modificadas.',changed_count;
end
$confirm_elias$;
commit;

select p.code as pallet,p.net_kg as peso_neto_kg,p.gross_kg as peso_bruto_kg,p.tare_kg as tara_kg,p.destination as destino,
  l.code as lote,r.date as recepcion,l.harvest_date as cosecha_del_lote,
  p.metadata#>>'{export_label,harvest_date}' as cosecha_de_etiqueta,p.metadata#>>'{export_label,packaged_date}' as envasado,
  p.metadata#>>'{export_label,producer_code}' as codigo_del_productor,p.metadata#>>'{export_label,afidi}' as afidi,
  p.metadata#>>'{export_label,importer_name}' as importador,p.metadata#>>'{export_label,origin}' as origen,
  l.harvest_date>r.date as conflicto_cronologico,
  'Fechas reconfirmadas por el propietario; cosecha posterior a recepción. No se corrigió automáticamente.' as observacion
from public.pallets p join public.pallet_items i on i.pallet_id=p.id and i.organization_id=p.organization_id and i.status<>'Cancelado'
join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
join public.producers pr on pr.id=coalesce(f.producer_id,l.producer_id) and pr.organization_id=l.organization_id
where p.organization_id='20000000-0000-4000-8000-000000000001'
  and agronorte_private.normalize_producer_name(pr.name)='ELIAS GALEANO' and l.code='01102026'
  and p.created_at<='2026-10-07 18:13:45+00'::timestamptz and p.status in ('En armado','Etiquetado','Listo para carga')
  and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
order by p.code;
