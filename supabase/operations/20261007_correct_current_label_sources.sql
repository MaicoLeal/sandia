-- Point correction template: verified source binding and three known tare errors.
-- Fill only the private operational copy's payload; never commit real IDs/names.
-- No insert/delete, no producer rename, no reception/date/net/QR/item changes.
-- SQL session identity is recorded by existing audit triggers, never impersonated.
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';
do $correct_label_sources$
declare
  org constant uuid='20000000-0000-4000-8000-000000000001';
  cutoff constant timestamptz='2026-10-07 18:13:45+00';
  payload constant jsonb='{}'::jsonb; -- PRIVATE_CORRECTION_PAYLOAD
  target uuid;source_record public.trap_installations;producer_record public.producers;
  item record;entry jsonb;target_ids uuid[]=array[]::uuid[];net_value numeric;
  source_changed boolean=false;metadata_changed boolean=false;tara_changed integer=0;
  changes_needed boolean=false;actual_revision bigint;expected_revision bigint;old_codes jsonb;real_codes jsonb;
  identity_before text;items_before text;intake_before text;other_gross_before text;
  identity_after text;items_after text;intake_after text;other_gross_after text;
begin
  if to_regprocedure('agronorte_private.trap_reference_codes(uuid,uuid)') is null
    or to_regprocedure('agronorte_private.refresh_trap_producer_references()') is null
    or to_regprocedure('public.audit_record()') is null then
    raise exception 'Aplique primero las actualizaciones de trampas y auditoría de Sandía.';
  end if;
  if jsonb_typeof(payload) is distinct from 'object'
    or not(payload ?& array['target_producer_id','allowed_producer_names','trap_source_key','trap_source_row','trap_code','tare_producer_id','tare_pallets'])
    or jsonb_typeof(payload->'allowed_producer_names') is distinct from 'array'
    or jsonb_array_length(payload->'allowed_producer_names') not between 1 and 4
    or jsonb_typeof(payload->'tare_pallets') is distinct from 'array'
    or jsonb_array_length(payload->'tare_pallets')<>3
    or length(trim(coalesce(payload->>'trap_code',''))) not between 1 and 100
    or length(trim(coalesce(payload->>'trap_source_key',''))) not between 1 and 200 then
    raise exception 'Complete la copia privada con la fuente y los tres pallets verificados.';
  end if;
  target=(payload->>'target_producer_id')::uuid;
  expected_revision=nullif(payload->>'expected_revision','')::bigint;
  select revision into actual_revision from public.organizations where id=org and name='Cooperativa Agronorte' for update;
  if not found then raise exception 'Esta base no es la Cooperativa Agronorte autorizada.';end if;
  if exists(select 1 from unnest(array['producers','pallets']) t(name)
    where not exists(select 1 from pg_trigger g where g.tgrelid=('public.'||t.name)::regclass
      and g.tgname='audit_change' and g.tgfoid=to_regprocedure('public.audit_record()')
      and g.tgenabled in ('O','A') and not g.tgisinternal and g.tgqual is null
      and (g.tgtype::integer & 17)=17 and (g.tgtype::integer & 2)=0))
    or not exists(select 1 from pg_trigger g where g.tgrelid='public.trap_installations'::regclass
      and g.tgname='audit_change' and g.tgfoid=to_regprocedure('agronorte_private.audit_trap_installation()')
      and g.tgenabled in ('O','A') and not g.tgisinternal and g.tgqual is null
      and (g.tgtype::integer & 17)=17 and (g.tgtype::integer & 2)=0)
    or not exists(select 1 from pg_trigger g where g.tgrelid='public.trap_installations'::regclass
      and g.tgname='refresh_references' and g.tgfoid=to_regprocedure('agronorte_private.refresh_trap_producer_references()')
      and g.tgenabled in ('O','A') and g.tgqual is null and (g.tgtype::integer & 17)=17 and (g.tgtype::integer & 2)=0)
    or not exists(select 1 from pg_trigger g where g.tgrelid='public.producers'::regclass
      and g.tgname='derive_trap_references' and g.tgfoid=to_regprocedure('agronorte_private.derive_producer_trap_references()')
      and g.tgenabled in ('O','A') and g.tgqual is null and (g.tgtype::integer & 19)=19) then
    raise exception 'La auditoría y los vínculos derivados de productores deben estar activos.';
  end if;
  select * into producer_record from public.producers where id=target and organization_id=org for update;
  if not found or not exists(select 1 from jsonb_array_elements_text(payload->'allowed_producer_names') n(name)
    where agronorte_private.normalize_producer_name(n.name)=agronorte_private.normalize_producer_name(producer_record.name)) then
    raise exception 'El productor verificado no coincide con su UUID, organización o nombre autorizado.';
  end if;
  if producer_record.metadata is not null and jsonb_typeof(producer_record.metadata)<>'object' then
    raise exception 'Metadatos inválidos del productor; no se cambió ningún registro.';
  end if;
  select * into source_record from public.trap_installations
    where organization_id=org and source_key=payload->>'trap_source_key'
      and source_row=(payload->>'trap_source_row')::integer for update;
  if not found or source_record.status<>'Activo' or source_record.created_at>cutoff
    or upper(trim(source_record.trap_code))<>upper(trim(payload->>'trap_code'))
    or lower(trim(source_record.host)) not in ('sandia','sandía','melancia')
    or not exists(select 1 from jsonb_array_elements_text(payload->'allowed_producer_names') n(name)
      where agronorte_private.normalize_producer_name(n.name)=agronorte_private.normalize_producer_name(source_record.source_producer_name)) then
    raise exception 'La fila/código de la fuente verificada no coincide; no se cambió ningún registro.';
  end if;
  if source_record.producer_id is not null and source_record.producer_id<>target then
    raise exception 'La referencia ya pertenece a otro productor; requiere conciliación sin reasignar datos.';
  end if;
  source_changed=source_record.producer_id is null;
  old_codes=coalesce(producer_record.metadata->'trap_reference_codes','[]'::jsonb);
  real_codes=agronorte_private.trap_reference_codes(org,target);
  metadata_changed=old_codes is distinct from real_codes;

  -- The existing refresh trigger must not rearm labels created after authorization.
  if (source_changed or metadata_changed) and exists(select 1 from public.pallets p
    join public.pallet_items i on i.pallet_id=p.id and i.organization_id=p.organization_id
    join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
    join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
    left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
    left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
    where p.organization_id=org and coalesce(f.producer_id,l.producer_id)=target and i.status<>'Cancelado'
      and p.status in ('Etiquetado','Listo para carga') and p.created_at>cutoff
      and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)) then
    raise exception 'Hay etiquetas posteriores al corte; revise el alcance antes de vincular la referencia.';
  end if;
  for entry in select value from jsonb_array_elements(payload->'tare_pallets')
  loop
    if jsonb_typeof(entry) is distinct from 'object' or jsonb_typeof(entry->'expected_net_kg') is distinct from 'number'
      or (entry->>'expected_net_kg')::numeric<=0 then raise exception 'Informe el peso neto verificado de cada pallet.';end if;
    if (entry->>'id')::uuid=any(target_ids) then raise exception 'Los tres pallets verificados deben ser distintos.';end if;
    target_ids=array_append(target_ids,(entry->>'id')::uuid);net_value=(entry->>'expected_net_kg')::numeric;
    select * into item from public.pallets where id=(entry->>'id')::uuid and organization_id=org for update;
    if not found or item.created_at>cutoff or lower(trim(item.destination))<>'uruguay'
      or item.status not in ('En armado','Etiquetado','Listo para carga')
      or exists(select 1 from public.shipment_pallets sp where sp.pallet_id=item.id)
      or item.net_kg<>net_value
      or not exists(select 1 from public.pallet_items i where i.pallet_id=item.id and i.organization_id=org and i.status<>'Cancelado')
      or exists(select 1 from public.pallet_items i
        join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
        join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
        left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
        left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
        where i.pallet_id=item.id and i.organization_id=org and i.status<>'Cancelado'
          and coalesce(f.producer_id,l.producer_id) is distinct from (payload->>'tare_producer_id')::uuid) then
      raise exception 'Un pallet cambió, no está abierto para Uruguay o su peso neto no coincide; no se cambió ningún registro.';
    end if;
    if item.tare_kg<>42 or item.gross_kg is distinct from net_value+42 then changes_needed=true;end if;
  end loop;
  changes_needed=changes_needed or source_changed or metadata_changed;
  if changes_needed and expected_revision is not null and actual_revision<>expected_revision then
    raise exception 'Conflicto de sincronización: revisión actual %, esperada %. Actualice la evidencia antes de corregir.',actual_revision,expected_revision;
  end if;
  select md5(coalesce(string_agg(concat_ws('|',id::text,code,token::text,net_kg::text,created_at::text,created_by::text),E'\n' order by id),''))
    into identity_before from public.pallets where organization_id=org;
  select md5(coalesce(string_agg(to_jsonb(i)::text,E'\n' order by id),'')) into items_before from public.pallet_items i where organization_id=org;
  select md5(coalesce(string_agg(row_value,E'\n' order by row_value),'')) into intake_before from (
    select to_jsonb(r)::text row_value from public.receptions r where organization_id=org
    union all select to_jsonb(w)::text from public.reception_weights w where organization_id=org
    union all select to_jsonb(l)::text from public.field_lots l where organization_id=org
  ) intake_rows;
  select md5(coalesce(string_agg(concat_ws('|',id::text,gross_kg::text,tare_kg::text),E'\n' order by id),''))
    into other_gross_before from public.pallets where organization_id=org and not id=any(target_ids);
  perform set_config('agronorte.trap_import_batch','on',true);
  perform set_config('agronorte.correction_reason',
    'Corrección puntual autorizada el 07/10/2026: vinculación del código real de productor de la planilla verificada y tara física de embalaje 42 kg en tres pallets identificados, conservando pesos netos, fechas, códigos, QR y recepciones.',true);
  if source_changed then
    update public.trap_installations set producer_id=target where id=source_record.id and organization_id=org;
  elsif metadata_changed then
    update public.producers set metadata=coalesce(metadata,'{}'::jsonb),updated_at=now() where id=target and organization_id=org;
    update public.pallets p set status='En armado',updated_at=now()
      where p.organization_id=org and p.created_at<=cutoff and p.status in ('Etiquetado','Listo para carga')
      and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
      and exists(select 1 from public.pallet_items i join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
        join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
        left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
        left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
        where i.pallet_id=p.id and i.organization_id=org and i.status<>'Cancelado' and coalesce(f.producer_id,l.producer_id)=target);
  end if;
  if not (agronorte_private.trap_reference_codes(org,target) @> jsonb_build_array(source_record.trap_code))
    or (select metadata->'trap_reference_codes' from public.producers where id=target and organization_id=org)
      is distinct from agronorte_private.trap_reference_codes(org,target) then
    raise exception 'El código del productor no se derivó correctamente; se revierte la corrección completa.';
  end if;
  update public.pallets p set tare_kg=42,gross_kg=net_kg+42,status='En armado',updated_at=now()
    where p.organization_id=org and p.id=any(target_ids) and (p.tare_kg<>42 or p.gross_kg is distinct from p.net_kg+42);
  get diagnostics tara_changed=row_count;
  select md5(coalesce(string_agg(concat_ws('|',id::text,code,token::text,net_kg::text,created_at::text,created_by::text),E'\n' order by id),''))
    into identity_after from public.pallets where organization_id=org;
  select md5(coalesce(string_agg(to_jsonb(i)::text,E'\n' order by id),'')) into items_after from public.pallet_items i where organization_id=org;
  select md5(coalesce(string_agg(row_value,E'\n' order by row_value),'')) into intake_after from (
    select to_jsonb(r)::text row_value from public.receptions r where organization_id=org
    union all select to_jsonb(w)::text from public.reception_weights w where organization_id=org
    union all select to_jsonb(l)::text from public.field_lots l where organization_id=org
  ) intake_rows;
  select md5(coalesce(string_agg(concat_ws('|',id::text,gross_kg::text,tare_kg::text),E'\n' order by id),''))
    into other_gross_after from public.pallets where organization_id=org and not id=any(target_ids);
  if identity_before is distinct from identity_after or items_before is distinct from items_after
    or intake_before is distinct from intake_after or other_gross_before is distinct from other_gross_after then
    raise exception 'Se detectó un cambio fuera de alcance en peso neto, identidad QR, vínculos, recepción o tara; se revierte la corrección completa.';
  end if;
  if coalesce(producer_record.metadata,'{}'::jsonb)-'trap_reference_codes' is distinct from
    (select coalesce(metadata,'{}'::jsonb)-'trap_reference_codes' from public.producers where id=target and organization_id=org) then
    raise exception 'Se detectó un cambio fuera de alcance en metadatos del productor; se revierte la corrección completa.';
  end if;
  if changes_needed then update public.organizations set revision=revision+1 where id=org;end if;
  perform set_config('agronorte.trap_import_batch','',true);
  perform set_config('agronorte.correction_reason','',true);
  raise notice 'Corrección: vínculo fuente %, referencia restaurada %, tara corregida en % pallets. Pesos netos y QR conservados.',source_changed,metadata_changed,tara_changed;
end
$correct_label_sources$;
commit;
