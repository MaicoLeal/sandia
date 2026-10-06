-- Audited reception correction/cancellation and confirmed 42 kg pallet packaging.
begin;
do $$begin
  if to_regprocedure('public.correct_pallet(uuid,jsonb,text,bigint)') is null then
    raise exception 'Aplique primero la actualización de correcciones de pallets';
  end if;
end$$;

alter table public.pallets add column if not exists tare_kg numeric(14,2) not null default 42 check(tare_kg>=0);
-- A known gross measurement remains authoritative; only missing gross is derived.
do $$declare affected uuid[];begin
  select coalesce(array_agg(distinct organization_id),array[]::uuid[]) into affected
    from public.pallets where gross_kg is null or tare_kg is distinct from gross_kg-net_kg;
  perform set_config('agronorte.correction_reason','Tara de embalaje de 42 kg confirmada por la cooperativa; bruto calculado cuando faltaba; pesos brutos conocidos conservados',true);
  update public.pallets set gross_kg=coalesce(gross_kg,net_kg+42),
    tare_kg=case when gross_kg is null then 42 else gross_kg-net_kg end,updated_at=now()
    where gross_kg is null or tare_kg is distinct from gross_kg-net_kg;
  update public.organizations set revision=revision+1 where id=any(affected);
  perform set_config('agronorte.correction_reason','',true);
end$$;

-- Prefer the explicit operation reason, including cancellation, and retain legacy intents.
create or replace function public.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
declare actor_name text;reason_text text;
begin
  select name into actor_name from public.profiles where user_id=auth.uid();
  reason_text=coalesce(nullif(current_setting('agronorte.correction_reason',true),''),
    case when tg_table_name='reception_weights' then coalesce(to_jsonb(new)->>'correction_reason','')
    when tg_table_name='receptions' and new.status='Cancelado' then coalesce(to_jsonb(new)->>'notes','') else '' end);
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,actor,"before","after",reason,created_by)
    values(new.organization_id,tg_table_name,new.id,case when tg_op='INSERT' then 'Creación · ' else 'Actualización · ' end||tg_table_name,
    coalesce(actor_name,'Administrador del servidor'),case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),reason_text,auth.uid());
  return new;
end$$;
revoke all on function public.audit_record() from public,anon,authenticated;

create or replace function agronorte_private.correct_reception(target_reception_id uuid,corrected_fields jsonb,correction_reason text,expected_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid;role_name text;actual_revision bigint;old_reception public.receptions;old_class public.classifications;
  new_date date;responsible_name text;new_notes text;total numeric=0;rejected numeric;approved numeric;allocated numeric;
  entry jsonb;weight_id uuid;weight_ids uuid[]=array[]::uuid[];old_weight public.reception_weights;kg_value numeric;
  next_sequence integer;classification_value jsonb;rejection_reason text;changed boolean=false;row_count integer;
begin
  if auth.uid() is null then raise exception 'Inicie sesión';end if;
  org=public.my_org();role_name=public.my_role();
  if org is null or role_name not in ('administrador','gestor') then raise exception 'Solo administrador o gestor puede corregir recepciones';end if;
  if length(trim(coalesce(correction_reason,'')))=0 or length(correction_reason)>1000 then raise exception 'Corrección requiere justificación de hasta 1000 caracteres';end if;
  if jsonb_typeof(corrected_fields) is distinct from 'object'
    or not(corrected_fields ?& array['date','responsible','notes','weights','classification'])
    or exists(select 1 from jsonb_object_keys(corrected_fields) k where k not in ('date','responsible','notes','weights','classification')) then raise exception 'Datos de recepción inválidos';end if;
  if jsonb_typeof(corrected_fields->'date') is distinct from 'string' or (corrected_fields->>'date')!~'^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(corrected_fields->'responsible') is distinct from 'string' or jsonb_typeof(corrected_fields->'notes') is distinct from 'string'
    or jsonb_typeof(corrected_fields->'weights') is distinct from 'array' then raise exception 'Tipos de recepción inválidos';end if;
  new_date=(corrected_fields->>'date')::date;
  if to_char(new_date,'YYYY-MM-DD')<>corrected_fields->>'date' then raise exception 'Fecha de recepción inválida';end if;
  responsible_name=trim(corrected_fields->>'responsible');new_notes=corrected_fields->>'notes';
  if length(responsible_name)=0 or length(responsible_name)>200 or length(new_notes)>5000 then raise exception 'Informe responsable y observaciones válidos';end if;
  if jsonb_array_length(corrected_fields->'weights') not between 1 and 1000 then raise exception 'Informe entre 1 y 1000 pesajes activos';end if;
  select revision into actual_revision from public.organizations where id=org for update;
  if expected_revision is null or actual_revision<>expected_revision then raise exception 'Conflicto de sincronización: actualice los datos antes de corregir';end if;
  select * into old_reception from public.receptions where id=target_reception_id and organization_id=org for update;
  if not found then raise exception 'Recepción no disponible en su organización';end if;
  if old_reception.status='Cancelado' then raise exception 'Recepción cancelada';end if;
  if exists(select 1 from public.pallet_items i join public.pallets p on p.id=i.pallet_id and p.organization_id=i.organization_id
    where i.reception_id=target_reception_id and i.organization_id=org and (p.status='Expedido' or exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id))) then
    raise exception 'Recepción con pallets expedidos o vinculados a una expedición; requiere conciliación';end if;
  perform 1 from public.reception_weights where reception_id=target_reception_id and organization_id=org for update;
  select * into old_class from public.classifications where reception_id=target_reception_id and organization_id=org and status<>'Cancelado' for update;
  classification_value=corrected_fields->'classification';
  if old_class.id is null then
    if classification_value is distinct from 'null'::jsonb then raise exception 'Clasificación no disponible; clasifique por el flujo de recepción';end if;
    rejected=0;
  else
    if jsonb_typeof(classification_value) is distinct from 'object' or not(classification_value ?& array['id','rejected_kg','reason'])
      or exists(select 1 from jsonb_object_keys(classification_value) k where k not in ('id','rejected_kg','reason'))
      or jsonb_typeof(classification_value->'id') is distinct from 'string'
      or jsonb_typeof(classification_value->'rejected_kg') is distinct from 'number'
      or jsonb_typeof(classification_value->'reason') is distinct from 'string' then raise exception 'Confirme las pérdidas de la clasificación activa';end if;
    if (classification_value->>'id')::uuid<>old_class.id then raise exception 'Clasificación no corresponde a la recepción';end if;
    rejected=(classification_value->>'rejected_kg')::numeric;rejection_reason=trim(classification_value->>'reason');
    if rejected<0 or rejected>999999999999.99 or round(rejected,2)<>rejected or length(rejection_reason)>1000
      or (rejected>0 and rejection_reason='') then raise exception 'Pérdida inválida o motivo de rechazo pendiente';end if;
  end if;
  for entry in select value from jsonb_array_elements(corrected_fields->'weights') loop
    if jsonb_typeof(entry) is distinct from 'object' or not(entry ?& array['id','kg','operator','notes'])
      or exists(select 1 from jsonb_object_keys(entry) k where k not in ('id','kg','operator','notes'))
      or jsonb_typeof(entry->'id') is distinct from 'string' or jsonb_typeof(entry->'kg') is distinct from 'number'
      or jsonb_typeof(entry->'operator') is distinct from 'string' or jsonb_typeof(entry->'notes') is distinct from 'string' then raise exception 'Datos de pesaje inválidos';end if;
    weight_id=(entry->>'id')::uuid;kg_value=(entry->>'kg')::numeric;
    if weight_id=any(weight_ids) then raise exception 'Pesaje duplicado en la corrección';end if;
    weight_ids=array_append(weight_ids,weight_id);
    if kg_value<=0 or kg_value>999999999999.99 or round(kg_value,2)<>kg_value
      or length(trim(entry->>'operator'))=0 or length(entry->>'operator')>200 or length(entry->>'notes')>5000 then raise exception 'Peso inválido o datos de operador pendientes';end if;
    select * into old_weight from public.reception_weights where id=weight_id;
    if found and (old_weight.organization_id<>org or old_weight.reception_id<>target_reception_id or old_weight.status<>'Activo') then
      raise exception 'Pesaje de otra recepción, organización o cancelado';end if;
    total=total+kg_value;
  end loop;
  if total>999999999999.99 or rejected>total then raise exception 'Las pérdidas no pueden superar el peso recibido';end if;
  approved=total-rejected;
  select coalesce(sum(i.kg),0) into allocated from public.pallet_items i join public.pallets p on p.id=i.pallet_id and p.organization_id=i.organization_id
    where i.reception_id=target_reception_id and i.organization_id=org and p.status<>'Cancelado';
  if allocated>approved then raise exception 'El peso aprobado es menor que los pallets activos: corrija o cancele primero esos pallets';end if;
  if old_class.id is null and allocated>0 then raise exception 'Origen de pallets requiere conciliación de clasificación';end if;
  perform set_config('agronorte.correction_reason',trim(correct_reception.correction_reason),true);
  select coalesce(max(sequence),0) into next_sequence from public.reception_weights where reception_id=target_reception_id and organization_id=org;
  for entry in select value from jsonb_array_elements(corrected_fields->'weights') loop
    weight_id=(entry->>'id')::uuid;kg_value=(entry->>'kg')::numeric;
    select * into old_weight from public.reception_weights where id=weight_id;
    if found then
      if old_weight.kg is distinct from kg_value or old_weight.operator is distinct from trim(entry->>'operator') or old_weight.notes is distinct from entry->>'notes' then
        update public.reception_weights set kg=kg_value,operator=trim(entry->>'operator'),notes=entry->>'notes',correction_reason=trim(correct_reception.correction_reason),updated_at=now() where id=weight_id;changed=true;
      end if;
    else
      next_sequence=next_sequence+1;
      insert into public.reception_weights(id,organization_id,reception_id,sequence,kg,operator,notes,correction_reason,created_by)
        values(weight_id,org,target_reception_id,next_sequence,kg_value,trim(entry->>'operator'),entry->>'notes',trim(correct_reception.correction_reason),auth.uid());changed=true;
    end if;
  end loop;
  update public.reception_weights set status='Cancelado',correction_reason=trim(correct_reception.correction_reason),updated_at=now()
    where reception_id=target_reception_id and organization_id=org and status='Activo' and not(id=any(weight_ids));
  get diagnostics row_count=row_count;changed=changed or row_count>0;
  if old_class.id is not null and (old_class.approved_kg is distinct from approved or old_class.rejected_kg is distinct from rejected or old_class.reason is distinct from rejection_reason) then
    update public.classifications set approved_kg=approved,rejected_kg=rejected,reason=rejection_reason,updated_at=now() where id=old_class.id;changed=true;
  end if;
  if old_reception.date is distinct from new_date or old_reception.responsible is distinct from responsible_name or old_reception.notes is distinct from new_notes then
    update public.receptions set date=new_date,responsible=responsible_name,notes=new_notes,updated_at=now() where id=target_reception_id;changed=true;
  end if;
  if old_reception.date is distinct from new_date then
    update public.pallets p set status='En armado',updated_at=now() where p.organization_id=org and p.status in ('Etiquetado','Listo para carga')
      and exists(select 1 from public.pallet_items i where i.pallet_id=p.id and i.reception_id=target_reception_id);
  end if;
  if changed then update public.organizations set revision=revision+1 where id=org;end if;
end$$;
revoke all on function agronorte_private.correct_reception(uuid,jsonb,text,bigint) from public,anon;
grant execute on function agronorte_private.correct_reception(uuid,jsonb,text,bigint) to authenticated;
create or replace function public.correct_reception(target_reception_id uuid,corrected_fields jsonb,correction_reason text,expected_revision bigint)
returns void language sql security invoker set search_path='' as $$select agronorte_private.correct_reception(target_reception_id,corrected_fields,correction_reason,expected_revision)$$;
revoke all on function public.correct_reception(uuid,jsonb,text,bigint) from public,anon;
grant execute on function public.correct_reception(uuid,jsonb,text,bigint) to authenticated;

create or replace function agronorte_private.cancel_reception(target_reception_id uuid,correction_reason text,expected_revision bigint,cancel_linked_pallets boolean)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid;role_name text;actual_revision bigint;old_reception public.receptions;active_pallets uuid[];
begin
  if auth.uid() is null then raise exception 'Inicie sesión';end if;
  org=public.my_org();role_name=public.my_role();
  if org is null or role_name not in ('administrador','gestor') then raise exception 'Solo administrador o gestor puede eliminar recepciones';end if;
  if length(trim(coalesce(correction_reason,'')))=0 or length(correction_reason)>1000 then raise exception 'Eliminación requiere justificación de hasta 1000 caracteres';end if;
  select revision into actual_revision from public.organizations where id=org for update;
  if expected_revision is null or actual_revision<>expected_revision then raise exception 'Conflicto de sincronización: actualice los datos antes de eliminar';end if;
  select * into old_reception from public.receptions where id=target_reception_id and organization_id=org for update;
  if not found then raise exception 'Recepción no disponible en su organización';end if;
  if old_reception.status='Cancelado' then return;end if;
  select coalesce(array_agg(distinct p.id),array[]::uuid[]) into active_pallets from public.pallet_items i join public.pallets p on p.id=i.pallet_id and p.organization_id=i.organization_id
    where i.reception_id=target_reception_id and i.organization_id=org and p.status<>'Cancelado';
  if exists(select 1 from public.pallets p where p.id=any(active_pallets) and (p.status='Expedido' or exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id))) then
    raise exception 'Recepción con pallets expedidos o vinculados a una expedición; requiere conciliación';end if;
  if exists(select 1 from public.pallet_items i where i.pallet_id=any(active_pallets) and i.reception_id<>target_reception_id) then
    raise exception 'Pallet con varias recepciones: concilie o cancele el pallet antes de eliminar esta recepción';end if;
  if cardinality(active_pallets)>0 and cancel_linked_pallets is distinct from true then raise exception 'Confirme la cancelación de los pallets vinculados antes de eliminar la recepción';end if;
  perform set_config('agronorte.correction_reason',trim(cancel_reception.correction_reason),true);
  update public.pallets set status='Cancelado',updated_at=now() where id=any(active_pallets) and organization_id=org;
  update public.classifications set status='Cancelado',updated_at=now() where reception_id=target_reception_id and organization_id=org and status<>'Cancelado';
  update public.reception_weights set status='Cancelado',correction_reason=trim(cancel_reception.correction_reason),updated_at=now() where reception_id=target_reception_id and organization_id=org and status='Activo';
  update public.receptions set status='Cancelado',updated_at=now() where id=target_reception_id and organization_id=org;
  update public.organizations set revision=revision+1 where id=org;
end$$;
revoke all on function agronorte_private.cancel_reception(uuid,text,bigint,boolean) from public,anon;
grant execute on function agronorte_private.cancel_reception(uuid,text,bigint,boolean) to authenticated;
create or replace function public.cancel_reception(target_reception_id uuid,correction_reason text,expected_revision bigint,cancel_linked_pallets boolean)
returns void language sql security invoker set search_path='' as $$select agronorte_private.cancel_reception(target_reception_id,correction_reason,expected_revision,cancel_linked_pallets)$$;
revoke all on function public.cancel_reception(uuid,text,bigint,boolean) from public,anon;
grant execute on function public.cancel_reception(uuid,text,bigint,boolean) to authenticated;

create or replace function public.sandia_features() returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('reception_edit',true,'recipient_access',true,'label_export_data',true,'label_destination_edit',true,'pallet_corrections',true,'reception_management',true,'pallet_tare',true)
$$;
revoke all on function public.sandia_features() from public,anon;
grant execute on function public.sandia_features() to authenticated;

-- Updated synchronization and pallet correction are appended below.

create or replace function agronorte_private.correct_pallet(
  target_pallet_id uuid,corrected_fields jsonb,correction_reason text,expected_revision bigint
) returns void language plpgsql security definer set search_path='' as $$
declare org uuid;role_name text;actual_revision bigint;old_pallet public.pallets;
  net numeric;gross numeric;fruit integer;weighed date;responsible_name text;new_notes text;
  origin_item public.pallet_items;origin_count integer;approved numeric;allocated_other numeric;
  label_changed boolean;packaging numeric;
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
    or exists(select 1 from jsonb_object_keys(corrected_fields) k where k not in ('net_kg','gross_kg','fruit_count','weighed_date','responsible','notes','tare_kg')) then
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

  packaging=case when old_pallet.gross_kg is null then old_pallet.tare_kg else old_pallet.gross_kg-old_pallet.net_kg end;
  if corrected_fields ? 'tare_kg' then
    if jsonb_typeof(corrected_fields->'tare_kg') is distinct from 'number' or (corrected_fields->>'tare_kg')::numeric<>42 then raise exception 'La tara estándar de embalaje es 42 kg';end if;
    packaging=42;
    if gross is not null and gross<>net+packaging then raise exception 'El bruto debe ser peso neto más 42 kg de embalaje';end if;
    gross=net+packaging;
  elsif gross is null then gross=net+packaging;
  else packaging=gross-net;end if;
  if gross>999999999999.99 then raise exception 'Peso bruto fuera de rango';end if;
  label_changed=old_pallet.tare_kg is distinct from packaging or old_pallet.net_kg is distinct from net or old_pallet.gross_kg is distinct from gross
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
  update public.pallets set net_kg=net,gross_kg=gross,tare_kg=packaging,fruit_count=fruit,weighed_date=weighed,
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
 if t='pallets' then
   if previous is not null and not(row_value ? 'tare_kg') then row_value=row_value||jsonb_build_object('tare_kg',previous->'tare_kg');end if;
   if previous is null then
     if row_value ? 'tare_kg' and (jsonb_typeof(row_value->'tare_kg') is distinct from 'number' or (row_value->>'tare_kg')::numeric<>42) then raise exception 'La tara estándar de embalaje es 42 kg';end if;
     if row_value->>'gross_kg' is null then row_value=row_value||jsonb_build_object('gross_kg',(row_value->>'net_kg')::numeric+42,'tare_kg',42);
     elsif row_value ? 'tare_kg' then
       if (row_value->>'gross_kg')::numeric<>(row_value->>'net_kg')::numeric+42 then raise exception 'El bruto debe ser peso neto más 42 kg de embalaje';end if;
     else row_value=row_value||jsonb_build_object('tare_kg',(row_value->>'gross_kg')::numeric-(row_value->>'net_kg')::numeric);end if;
   end if;
 end if;
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
     if previous->>'status'='Cancelado' or canonical->>'status' is distinct from previous->>'status' then raise exception 'Pesaje cancelado o eliminación requiere gestión supervisada de la recepción';end if;
     if role_name not in ('administrador','gestor') or length(trim(coalesce(row_value->>'correction_reason','')))=0 then raise exception 'Corrección de peso requiere gestor y justificación';end if;
     if (previous->>'reception_id') is distinct from (canonical->>'reception_id') or (previous->>'sequence') is distinct from (canonical->>'sequence') then raise exception 'No se puede cambiar el origen de un pesaje';end if;
     if exists(select 1 from public.classifications where reception_id=(previous->>'reception_id')::uuid and status<>'Cancelado') then raise exception 'No se puede corregir una recepción ya clasificada';end if;
   end if;
   if t='pallets' then
     if previous->>'status' in ('Expedido','Cancelado') then raise exception 'Pallet cerrado';end if;
     if canonical->>'status'='Cancelado' then
       raise exception 'Use la cancelación supervisada del pallet con justificación';end if;
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
 if t in ('receptions','reception_weights','classifications') and previous is null and canonical->>'status'='Cancelado' then raise exception 'Un registro nuevo debe iniciar activo';end if;
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

create or replace function agronorte_private.update_pallet_label_details(
  target_pallet_id uuid,export_fields jsonb,pallet_destination text,
  correction_reason text,expected_revision bigint
) returns void language plpgsql security definer set search_path='' as $$
declare org uuid;role_name text;actual_revision bigint;old_pallet public.pallets;
  new_metadata jsonb;new_destination text;
begin
  if auth.uid() is null then raise exception 'Inicie sesión';end if;
  org=public.my_org();role_name=public.my_role();
  if org is null or role_name not in ('administrador','gestor','packing') then
    raise exception 'Su perfil no puede editar datos de etiqueta';
  end if;
  if length(trim(coalesce(correction_reason,'')))=0 or length(correction_reason)>1000 then
    raise exception 'Datos de etiqueta requieren justificación de hasta 1000 caracteres';
  end if;
  if export_fields is null or not agronorte_private.valid_export_label(export_fields) then
    raise exception 'Datos de exportación inválidos';
  end if;
  if pallet_destination is not null and (length(trim(pallet_destination))=0 or length(trim(pallet_destination))>200) then
    raise exception 'Destino requiere entre 1 y 200 caracteres';
  end if;

  -- Same locking order as sync_workspace: organization, then its pallet.
  select revision into actual_revision from public.organizations where id=org for update;
  if expected_revision is null or actual_revision<>expected_revision then
    raise exception 'Conflicto de sincronización: actualice los datos antes de editar la etiqueta';
  end if;
  select * into old_pallet from public.pallets where id=target_pallet_id and organization_id=org for update;
  if not found then raise exception 'Pallet no disponible en su organización';end if;
  if old_pallet.status in ('Expedido','Cancelado') or exists(
    select 1 from public.shipment_pallets where pallet_id=target_pallet_id and organization_id=org
  ) then raise exception 'Pallet cerrado o vinculado a una expedición';end if;

  -- NULL explicitly keeps the stored destination; no destination is assumed.
  new_destination=case when pallet_destination is null then old_pallet.destination else trim(pallet_destination) end;
  if export_fields->'senave_program'='true'::jsonb and lower(trim(new_destination))<>'uruguay' then
    raise exception 'El programa SENAVE para Uruguay requiere destino Uruguay confirmado';
  end if;
  new_metadata=coalesce(old_pallet.metadata,'{}'::jsonb)||jsonb_build_object('export_label',export_fields);
  if old_pallet.metadata is not distinct from new_metadata and old_pallet.destination=new_destination then return;end if;

  -- audit_change records before/after, actual auth.uid(), operator and reason.
  perform set_config('agronorte.correction_reason',trim(correction_reason),true);
  update public.pallets set metadata=new_metadata,destination=new_destination,status=case when old_pallet.status in ('Etiquetado','Listo para carga') then 'En armado' else old_pallet.status end,updated_at=now()
    where id=target_pallet_id and organization_id=org;
  update public.organizations set revision=revision+1 where id=org;
end$$;
revoke all on function agronorte_private.update_pallet_label_details(uuid,jsonb,text,text,bigint) from public,anon;
grant execute on function agronorte_private.update_pallet_label_details(uuid,jsonb,text,text,bigint) to authenticated;

create or replace function public.update_pallet_label_details(
  target_pallet_id uuid,export_fields jsonb,pallet_destination text,
  correction_reason text,expected_revision bigint
) returns void language sql security invoker set search_path='' as $$
  select agronorte_private.update_pallet_label_details(target_pallet_id,export_fields,pallet_destination,correction_reason,expected_revision)
$$;
revoke all on function public.update_pallet_label_details(uuid,jsonb,text,text,bigint) from public,anon;
grant execute on function public.update_pallet_label_details(uuid,jsonb,text,text,bigint) to authenticated;


create or replace function agronorte_private.update_pallet_export_label(
  target_pallet_id uuid,export_fields jsonb,correction_reason text,expected_revision bigint
) returns void language plpgsql security definer set search_path='' as $$
declare org uuid;role_name text;actual_revision bigint;old_pallet public.pallets;new_metadata jsonb;
begin
  if auth.uid() is null then raise exception 'Inicie sesión';end if;
  org=public.my_org();role_name=public.my_role();
  if org is null or role_name not in ('administrador','gestor','packing') then raise exception 'Su perfil no puede editar datos de etiqueta';end if;
  if length(trim(coalesce(correction_reason,'')))=0 then raise exception 'Datos de etiqueta requieren justificación';end if;
  if export_fields is null or not agronorte_private.valid_export_label(export_fields) then raise exception 'Datos de exportación inválidos';end if;
  select revision into actual_revision from public.organizations where id=org for update;
  if expected_revision is null or actual_revision<>expected_revision then raise exception 'Conflicto de sincronización: actualice los datos antes de editar la etiqueta';end if;
  select * into old_pallet from public.pallets where id=target_pallet_id and organization_id=org for update;
  if not found then raise exception 'Pallet no disponible en su organización';end if;
  if old_pallet.status in ('Expedido','Cancelado') or exists(select 1 from public.shipment_pallets where pallet_id=target_pallet_id and organization_id=org) then raise exception 'Pallet cerrado o vinculado a una expedición';end if;
  if export_fields->'senave_program'='true'::jsonb and lower(trim(old_pallet.destination))<>'uruguay' then
    raise exception 'El programa SENAVE para Uruguay requiere destino Uruguay confirmado';
  end if;
  new_metadata=coalesce(old_pallet.metadata,'{}'::jsonb)||jsonb_build_object('export_label',export_fields);
  if old_pallet.metadata is not distinct from new_metadata then return;end if;
  perform set_config('agronorte.correction_reason',trim(correction_reason),true);
  update public.pallets set metadata=new_metadata,status=case when old_pallet.status in ('Etiquetado','Listo para carga') then 'En armado' else old_pallet.status end,updated_at=now() where id=target_pallet_id and organization_id=org;
  update public.organizations set revision=revision+1 where id=org;
end$$;
revoke all on function agronorte_private.update_pallet_export_label(uuid,jsonb,text,bigint) from public,anon;
grant execute on function agronorte_private.update_pallet_export_label(uuid,jsonb,text,bigint) to authenticated;

create or replace function public.update_pallet_export_label(
  target_pallet_id uuid,export_fields jsonb,correction_reason text,expected_revision bigint
) returns void language sql security invoker set search_path='' as $$
  select agronorte_private.update_pallet_export_label(target_pallet_id,export_fields,correction_reason,expected_revision)
$$;
revoke all on function public.update_pallet_export_label(uuid,jsonb,text,bigint) from public,anon;
grant execute on function public.update_pallet_export_label(uuid,jsonb,text,bigint) to authenticated;


notify pgrst, 'reload schema';
commit;
