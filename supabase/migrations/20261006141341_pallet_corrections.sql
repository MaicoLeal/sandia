-- Correct stored pallet measurements or cancel a mistaken registration without
-- deleting its origin, identity, QR token or audit trail.
begin;
do $$begin
  if to_regprocedure('public.update_pallet_label_details(uuid,jsonb,text,text,bigint)') is null then
    raise exception 'Aplique primero la actualización de edición de etiquetas';
  end if;
end$$;

create or replace function agronorte_private.correct_pallet(
  target_pallet_id uuid,corrected_fields jsonb,correction_reason text,expected_revision bigint
) returns void language plpgsql security definer set search_path='' as $$
declare org uuid;role_name text;actual_revision bigint;old_pallet public.pallets;
  net numeric;gross numeric;fruit integer;weighed date;responsible_name text;new_notes text;
  origin_item public.pallet_items;origin_count integer;approved numeric;allocated_other numeric;
  label_changed boolean;
begin
  if auth.uid() is null then raise exception 'Inicie sesión';end if;
  org=public.my_org();role_name=public.my_role();
  if org is null or role_name not in ('administrador','gestor') then
    raise exception 'Solo administrador o gestor puede corregir pallets';
  end if;
  if length(trim(coalesce(correction_reason,'')))=0 or length(correction_reason)>1000 then
    raise exception 'Corrección requiere justificación de hasta 1000 caracteres';
  end if;
  if jsonb_typeof(corrected_fields) is distinct from 'object'
    or not(corrected_fields ?& array['net_kg','gross_kg','fruit_count','weighed_date','responsible','notes'])
    or exists(select 1 from jsonb_object_keys(corrected_fields) k where k not in ('net_kg','gross_kg','fruit_count','weighed_date','responsible','notes')) then
    raise exception 'Datos de corrección inválidos';
  end if;
  if jsonb_typeof(corrected_fields->'net_kg') is distinct from 'number'
    or jsonb_typeof(corrected_fields->'gross_kg') not in ('number','null')
    or jsonb_typeof(corrected_fields->'fruit_count') not in ('number','null')
    or jsonb_typeof(corrected_fields->'weighed_date') not in ('string','null')
    or jsonb_typeof(corrected_fields->'responsible') is distinct from 'string'
    or jsonb_typeof(corrected_fields->'notes') is distinct from 'string' then
    raise exception 'Tipos de corrección inválidos';
  end if;
  net=(corrected_fields->>'net_kg')::numeric;gross=(corrected_fields->>'gross_kg')::numeric;
  if net<=0 or net>999999999999.99 or round(net,2)<>net
    or (gross is not null and (gross<net or gross>999999999999.99 or round(gross,2)<>gross)) then
    raise exception 'Peso inválido: use kg positivos, dos decimales y bruto no menor al neto';
  end if;
  if corrected_fields->>'fruit_count' is not null then
    if (corrected_fields->>'fruit_count')::numeric<0
      or (corrected_fields->>'fruit_count')::numeric>2147483647
      or trunc((corrected_fields->>'fruit_count')::numeric)<>(corrected_fields->>'fruit_count')::numeric then
      raise exception 'Cantidad de frutas debe ser un entero no negativo';
    end if;
    fruit=(corrected_fields->>'fruit_count')::integer;
  end if;
  if corrected_fields->>'weighed_date' is not null then
    if (corrected_fields->>'weighed_date')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha de pesaje inválida';end if;
    weighed=(corrected_fields->>'weighed_date')::date;
    if to_char(weighed,'YYYY-MM-DD')<>corrected_fields->>'weighed_date' then raise exception 'Fecha de pesaje inválida';end if;
  end if;
  responsible_name=trim(corrected_fields->>'responsible');new_notes=corrected_fields->>'notes';
  if length(responsible_name)=0 or length(responsible_name)>200 or length(new_notes)>5000 then
    raise exception 'Informe responsable de hasta 200 caracteres y observaciones de hasta 5000';
  end if;

  -- Same lock order as synchronization and export-label corrections.
  select revision into actual_revision from public.organizations where id=org for update;
  if expected_revision is null or actual_revision<>expected_revision then
    raise exception 'Conflicto de sincronización: actualice los datos antes de corregir';
  end if;
  select * into old_pallet from public.pallets where id=target_pallet_id and organization_id=org for update;
  if not found then raise exception 'Pallet no disponible en su organización';end if;
  if old_pallet.status in ('Expedido','Cancelado') or exists(
    select 1 from public.shipment_pallets where pallet_id=target_pallet_id and organization_id=org
  ) then raise exception 'Pallet cerrado o vinculado a una expedición';end if;

  label_changed=old_pallet.net_kg is distinct from net or old_pallet.gross_kg is distinct from gross
    or old_pallet.fruit_count is distinct from fruit or old_pallet.weighed_date is distinct from weighed
    or old_pallet.responsible is distinct from responsible_name;
  if not label_changed and old_pallet.notes=new_notes then return;end if;
  if old_pallet.net_kg<>net then
    select count(*)::integer into origin_count from public.pallet_items where pallet_id=target_pallet_id and organization_id=org;
    if origin_count<>1 then raise exception 'Peso con varios orígenes requiere conciliación; no se distribuye por estimación';end if;
    select * into origin_item from public.pallet_items where pallet_id=target_pallet_id and organization_id=org for update;
    if origin_item.status<>'Activo' or origin_item.kg<>old_pallet.net_kg then raise exception 'Origen del pallet requiere conciliación';end if;
    if not exists(select 1 from public.receptions where id=origin_item.reception_id and organization_id=org and status<>'Cancelado') then
      raise exception 'Recepción de origen cancelada';
    end if;
    select approved_kg into approved from public.classifications where reception_id=origin_item.reception_id and organization_id=org and status<>'Cancelado';
    if not found then raise exception 'Clasifique la recepción antes de corregir el peso';end if;
    select coalesce(sum(i.kg),0) into allocated_other from public.pallet_items i join public.pallets p on p.id=i.pallet_id and p.organization_id=i.organization_id
      where i.reception_id=origin_item.reception_id and i.organization_id=org and i.pallet_id<>target_pallet_id and p.status<>'Cancelado';
    if allocated_other+net>approved then raise exception 'Saldo insuficiente para corregir el peso del pallet';end if;
  end if;
  perform set_config('agronorte.correction_reason',trim(correction_reason),true);
  if old_pallet.net_kg<>net then
    update public.pallet_items set kg=net,updated_at=now() where id=origin_item.id and organization_id=org;
  end if;
  update public.pallets set net_kg=net,gross_kg=gross,fruit_count=fruit,weighed_date=weighed,
    responsible=responsible_name,notes=new_notes,
    status=case when label_changed and old_pallet.status in ('Etiquetado','Listo para carga') then 'En armado' else old_pallet.status end,
    updated_at=now() where id=target_pallet_id and organization_id=org;
  update public.organizations set revision=revision+1 where id=org;
end$$;
revoke all on function agronorte_private.correct_pallet(uuid,jsonb,text,bigint) from public,anon;
grant execute on function agronorte_private.correct_pallet(uuid,jsonb,text,bigint) to authenticated;
create or replace function public.correct_pallet(target_pallet_id uuid,corrected_fields jsonb,correction_reason text,expected_revision bigint)
returns void language sql security invoker set search_path='' as $$
  select agronorte_private.correct_pallet(target_pallet_id,corrected_fields,correction_reason,expected_revision)
$$;
revoke all on function public.correct_pallet(uuid,jsonb,text,bigint) from public,anon;
grant execute on function public.correct_pallet(uuid,jsonb,text,bigint) to authenticated;

create or replace function agronorte_private.cancel_pallet(target_pallet_id uuid,correction_reason text,expected_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid;role_name text;actual_revision bigint;old_pallet public.pallets;
begin
  if auth.uid() is null then raise exception 'Inicie sesión';end if;
  org=public.my_org();role_name=public.my_role();
  if org is null or role_name not in ('administrador','gestor') then raise exception 'Solo administrador o gestor puede cancelar pallets';end if;
  if length(trim(coalesce(correction_reason,'')))=0 or length(correction_reason)>1000 then raise exception 'Cancelación requiere justificación de hasta 1000 caracteres';end if;
  select revision into actual_revision from public.organizations where id=org for update;
  if expected_revision is null or actual_revision<>expected_revision then raise exception 'Conflicto de sincronización: actualice los datos antes de cancelar';end if;
  select * into old_pallet from public.pallets where id=target_pallet_id and organization_id=org for update;
  if not found then raise exception 'Pallet no disponible en su organización';end if;
  if old_pallet.status='Expedido' or exists(select 1 from public.shipment_pallets where pallet_id=target_pallet_id and organization_id=org) then
    raise exception 'Pallet cerrado o vinculado a una expedición';
  end if;
  if old_pallet.status='Cancelado' then return;end if;
  perform set_config('agronorte.correction_reason',trim(correction_reason),true);
  update public.pallets set status='Cancelado',updated_at=now() where id=target_pallet_id and organization_id=org;
  -- Allocations stay intact for history; active-balance queries exclude cancelled pallets.
  update public.organizations set revision=revision+1 where id=org;
end$$;
revoke all on function agronorte_private.cancel_pallet(uuid,text,bigint) from public,anon;
grant execute on function agronorte_private.cancel_pallet(uuid,text,bigint) to authenticated;
create or replace function public.cancel_pallet(target_pallet_id uuid,correction_reason text,expected_revision bigint)
returns void language sql security invoker set search_path='' as $$
  select agronorte_private.cancel_pallet(target_pallet_id,correction_reason,expected_revision)
$$;
revoke all on function public.cancel_pallet(uuid,text,bigint) from public,anon;
grant execute on function public.cancel_pallet(uuid,text,bigint) to authenticated;

create or replace function public.sandia_features() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('reception_edit',true,'recipient_access',true,'label_export_data',true,'label_destination_edit',true,'pallet_corrections',true)
$$;
revoke all on function public.sandia_features() from public,anon;
grant execute on function public.sandia_features() to authenticated;

-- Existing clients may move active status, but corrections/cancellations require the dedicated audited RPC.
create or replace function public.sync_workspace(payload jsonb, expected_revision bigint) returns bigint language plpgsql security definer set search_path='' as $$
declare org uuid=public.my_org();role_name text=public.my_role();actual_revision bigint;t text;row_value jsonb;previous jsonb;canonical jsonb;row_id uuid;columns_list text;update_list text;allowed_roles text[];existing_ids uuid[];new_ids uuid[];log_value jsonb;original_pallets jsonb;correction_cursor jsonb;correction_reasons text[];
begin
 if auth.uid() is null or org is null or role_name not in ('administrador','gestor','recepcion','pesaje','packing') then raise exception 'Perfil sin permiso de escritura';end if;
 select revision into actual_revision from public.organizations where id=org for update;
 if expected_revision is null or actual_revision<>expected_revision then raise exception 'Conflicto de sincronización: otra persona modificó los datos. Conserve sus registros locales y solicite una conciliación al gestor.';end if;
 select coalesce(jsonb_object_agg(id::text,status),'{}'::jsonb) into original_pallets from public.pallets where organization_id=org;
 foreach t in array array['producers','farms','plots','field_lots','receptions','reception_weights','classifications','pallets','pallet_items','shipments','shipment_pallets','attachments'] loop
 if jsonb_typeof(payload->t) is distinct from 'array' then raise exception 'Falta la tabla %',t;end if;
 execute format('select coalesce(array_agg(id),array[]::uuid[]) from public.%I where organization_id=$1',t) into existing_ids using org;
 select coalesce(array_agg((v->>'id')::uuid),array[]::uuid[]) into new_ids from jsonb_array_elements(payload->t) v;
 if not existing_ids <@ new_ids then raise exception 'No se permite eliminar registros de %',t;end if;
 allowed_roles=case when t in ('producers','farms','plots') then array['administrador','gestor','recepcion'] when t='receptions' then array['administrador','gestor','recepcion'] when t='reception_weights' then array['administrador','gestor','recepcion','pesaje'] when t='classifications' then array['administrador','gestor','packing','recepcion'] when t in ('pallets','pallet_items','shipments','shipment_pallets') then array['administrador','gestor','packing'] else array['administrador','gestor','recepcion','pesaje','packing'] end;
 select string_agg(format('%I',column_name),',' order by ordinal_position),string_agg(format('%1$I=excluded.%1$I',column_name),',' order by ordinal_position) filter(where column_name not in ('id','organization_id','created_at','created_by')) into columns_list,update_list from information_schema.columns where table_schema='public' and table_name=t;
 for row_value in select value from jsonb_array_elements(payload->t) loop
 row_id=(row_value->>'id')::uuid;
 if (row_value->>'organization_id')::uuid<>org then raise exception 'Organización inválida';end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1',t) into previous using row_id;
 if previous is not null and (previous->>'organization_id')::uuid<>org then raise exception 'Registro de otra organización';end if;
 -- Treat dates/numerics as their canonical PostgreSQL types before comparison.
 execute format('select to_jsonb(x) from jsonb_populate_record(null::public.%I,$1) x',t) into canonical using row_value;
 if previous is not null and (previous-array['created_at','updated_at','created_by'])=(canonical-array['created_at','updated_at','created_by']) then continue;end if;
 if not role_name=any(allowed_roles) then raise exception 'Su perfil no puede modificar %',t;end if;
 perform set_config('agronorte.correction_reason','',true);
 if previous is not null then
   if t in ('producers','farms','plots') and role_name not in ('administrador','gestor') then raise exception 'Edición de catastro requiere administrador o gestor';end if;
   if t='producers' then
     select value into log_value from jsonb_array_elements(coalesce(payload->'audit_logs','[]'::jsonb)) where value->>'entity_id'=row_id::text and value->>'action'='Productor corregido' order by value->>'created_at' desc limit 1;
     if length(trim(coalesce(log_value->>'reason','')))=0 then raise exception 'Corrección del productor requiere justificación';end if;
     perform set_config('agronorte.correction_reason',log_value->>'reason',true);
   end if;
   if t in ('pallet_items','shipment_pallets','classifications','attachments') then raise exception 'El registro % es inmutable; solicite una reversión supervisada',t;end if;
   if t='reception_weights' then
     if role_name not in ('administrador','gestor') or length(trim(coalesce(row_value->>'correction_reason','')))=0 then raise exception 'Corrección de peso requiere gestor y justificación';end if;
     if (previous->>'reception_id') is distinct from (canonical->>'reception_id') or (previous->>'sequence') is distinct from (canonical->>'sequence') then raise exception 'No se puede cambiar el origen de un pesaje';end if;
     if exists(select 1 from public.classifications where reception_id=(previous->>'reception_id')::uuid and status<>'Cancelado') then raise exception 'No se puede corregir una recepción ya clasificada';end if;
   end if;
   if t='pallets' then
     if previous->>'status' in ('Expedido','Cancelado') then raise exception 'Pallet cerrado';end if;
     if canonical->>'status'='Cancelado' then raise exception 'Use la cancelación supervisada del pallet con justificación';end if;
     if (previous-array['status','updated_at']) is distinct from (canonical-array['status','updated_at']) then raise exception 'Cambios al pallet requieren una reversión supervisada';end if;
   end if;
   if t='shipments' then raise exception 'Expedición cerrada';end if;
   if t='field_lots' and (previous-array['status','updated_at']) is distinct from (canonical-array['status','updated_at']) then raise exception 'El origen del lote es inmutable';end if;
   if t='receptions' then
     if role_name not in ('administrador','gestor') or previous->>'status'='Cancelado' then raise exception 'Recepción cerrada o perfil sin permiso';end if;
     if canonical->>'status'='Cancelado' then
       if exists(select 1 from public.classifications where reception_id=row_id) then raise exception 'Recepción clasificada: solicite reversión supervisada';end if;
       if length(trim(coalesce(canonical->>'notes','')))=0 or (previous-array['status','notes','updated_at']) is distinct from (canonical-array['status','notes','updated_at']) then raise exception 'Cancelación requiere justificación y conservación del origen';end if;
     else
       if (previous-array['date','responsible','notes','updated_at']) is distinct from (canonical-array['date','responsible','notes','updated_at']) then raise exception 'Solo puede corregir fecha, responsable y observaciones conservando el origen';end if;
       if length(trim(coalesce(canonical->>'responsible','')))=0 then raise exception 'Informe el responsable de la recepción';end if;
       correction_cursor=jsonb_build_object('date',previous->>'date','responsible',previous->>'responsible','notes',previous->>'notes');
       correction_reasons=array[]::text[];
       for log_value in
         select value from jsonb_array_elements(coalesce(payload->'audit_logs','[]'::jsonb)) with ordinality
         where value->>'entity_type'='receptions' and value->>'entity_id'=row_id::text and value->>'action'='Recepción corregida'
         order by ordinality
       loop
         if length(trim(coalesce(log_value->>'reason','')))>0
           and jsonb_build_object('date',log_value->'before'->>'date','responsible',log_value->'before'->>'responsible','notes',log_value->'before'->>'notes')=correction_cursor
         then
           correction_cursor=jsonb_build_object('date',log_value->'after'->>'date','responsible',log_value->'after'->>'responsible','notes',log_value->'after'->>'notes');
           correction_reasons=array_append(correction_reasons,trim(log_value->>'reason'));
         end if;
       end loop;
       if cardinality(correction_reasons)=0 or correction_cursor is distinct from jsonb_build_object('date',canonical->>'date','responsible',canonical->>'responsible','notes',canonical->>'notes') then raise exception 'Corrección de recepción requiere justificación y una secuencia válida de cambios';end if;
       perform set_config('agronorte.correction_reason',array_to_string(correction_reasons,' · '),true);
     end if;
   end if;
 end if;
 if t='reception_weights' and previous is null and exists(select 1 from public.classifications where reception_id=(row_value->>'reception_id')::uuid and status<>'Cancelado') then raise exception 'Recepción clasificada';end if;
 if t='reception_weights' and exists(select 1 from public.receptions where id=(row_value->>'reception_id')::uuid and status='Cancelado') then raise exception 'Recepción cancelada';end if;
 if t='classifications' and (row_value->>'rejected_kg')::numeric>0 and length(trim(coalesce(row_value->>'reason','')))=0 then raise exception 'Seleccione el motivo de las pérdidas';end if;
 if t='classifications' and exists(select 1 from public.receptions where id=(row_value->>'reception_id')::uuid and status='Cancelado') then raise exception 'Recepción cancelada';end if;
 if t='shipment_pallets' and previous is null and coalesce(original_pallets->>(row_value->>'pallet_id'),'')<>'Listo para carga' then raise exception 'Sincronice los pallets listos antes de expedir';end if;
 if t='field_lots' and previous is null then
 if nullif(row_value->>'plot_id','') is not null and nullif(row_value->>'producer_id','') is not null and not exists(select 1 from public.plots p join public.farms f on f.id=p.farm_id where p.id=(row_value->>'plot_id')::uuid and f.producer_id=(row_value->>'producer_id')::uuid and p.organization_id=org) then raise exception 'La parcela pertenece a otro productor';end if;
 if length(trim(coalesce(row_value->>'code','')))>80 then raise exception 'Código de lote demasiado largo';end if;
 if trim(coalesce(row_value->>'code',''))='' then
 row_value=jsonb_set(row_value,'{code}',to_jsonb('SAN-'||to_char(clock_timestamp() at time zone 'America/Asuncion','YYYYMMDD')||'-'||upper(substr(replace(row_id::text,'-',''),1,12))));
 else row_value=jsonb_set(row_value,'{code}',to_jsonb(trim(row_value->>'code')));end if;
 end if;
 if t='pallets' and previous is null and canonical->>'status' in ('Expedido','Cancelado') then raise exception 'Un pallet nuevo debe iniciar activo, sin expedición ni cancelación';end if;
 if t='pallets' and previous is null then row_value=jsonb_set(row_value,'{code}',to_jsonb('PAL-'||to_char(clock_timestamp() at time zone 'America/Asuncion','YYYYMMDD')||'-'||upper(substr(replace(row_id::text,'-',''),1,12))));end if;
 row_value=row_value||jsonb_build_object('organization_id',org,'created_by',coalesce(previous->>'created_by',auth.uid()::text),'created_at',coalesce(previous->>'created_at',now()::text),'updated_at',now());
 execute format('insert into public.%1$I(%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) on conflict(id) do update set %3$s',t,columns_list,update_list) using row_value;
 end loop;
 end loop;
 -- Transactional reconciliation prevents double allocation and over-shipment.
 if exists(select 1 from public.classifications c where c.organization_id=org and c.status<>'Cancelado' and c.approved_kg+c.rejected_kg<>(select coalesce(sum(w.kg),0) from public.reception_weights w where w.reception_id=c.reception_id and w.status<>'Cancelado')) then raise exception 'Clasificación no coincide con el peso recibido';end if;
 if exists(select 1 from public.receptions r where r.organization_id=org and (select coalesce(sum(i.kg),0) from public.pallet_items i join public.pallets p on p.id=i.pallet_id where i.reception_id=r.id and p.status<>'Cancelado')>coalesce((select c.approved_kg from public.classifications c where c.reception_id=r.id and c.status<>'Cancelado'),0)) then raise exception 'Saldo insuficiente para palletizar';end if;
 if exists(select 1 from public.pallets p where p.organization_id=org and p.status<>'Cancelado' and p.net_kg<>(select coalesce(sum(i.kg),0) from public.pallet_items i where i.pallet_id=p.id)) then raise exception 'Peso del pallet no coincide con su origen';end if;
 if exists(select 1 from public.shipment_pallets sp join public.shipments s on s.id=sp.shipment_id join public.pallets p on p.id=sp.pallet_id where sp.organization_id=org and (p.status<>'Expedido' or s.destination<>p.destination)) then raise exception 'Pallet no disponible para expedición';end if;
 if exists(select 1 from public.pallets p where p.organization_id=org and p.status='Expedido' and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)) then raise exception 'Pallet expedido sin expedición';end if;
 if exists(select 1 from public.attachments a where a.organization_id=org and (split_part(a.storage_path,'/',1)<>org::text or not(case a.entity_type when 'receptions' then exists(select 1 from public.receptions r where r.id=a.entity_id and r.organization_id=org) when 'pallets' then exists(select 1 from public.pallets p where p.id=a.entity_id and p.organization_id=org) when 'shipments' then exists(select 1 from public.shipments s where s.id=a.entity_id and s.organization_id=org) else false end))) then raise exception 'Adjunto sin origen válido';end if;
 -- Client-provided operational logs are ignored. Only print requests are accepted as intent.
 if role_name in ('administrador','gestor','packing') then
 for log_value in select value from jsonb_array_elements(coalesce(payload->'audit_logs','[]'::jsonb)) loop
 if log_value->>'action'='Solicitud de impresión de etiqueta' and exists(select 1 from public.pallets where id=(log_value->>'entity_id')::uuid and organization_id=org and status<>'Cancelado') then
 insert into public.audit_logs(id,organization_id,entity_type,entity_id,action,actor,"after",created_by) values((log_value->>'id')::uuid,org,'pallets',(log_value->>'entity_id')::uuid,'Solicitud de impresión de etiqueta',(select name from public.profiles where user_id=auth.uid()),jsonb_build_object('solicitada',true),auth.uid()) on conflict(id) do nothing;
 end if;end loop;end if;
 update public.organizations set revision=revision+1 where id=org returning revision into actual_revision;
 return actual_revision;
end$$;
revoke all on function public.sync_workspace(jsonb,bigint) from public,anon;
grant execute on function public.sync_workspace(jsonb,bigint) to authenticated;
notify pgrst, 'reload schema';
commit;

