-- Optional importer details. No real importer or address is made a default.
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';
do $$begin
  if to_regprocedure('public.update_pallet_label_details(uuid,jsonb,text,text,bigint)') is null
    or to_regprocedure('agronorte_private.valid_export_label(jsonb)') is null
    or to_regprocedure('public.sandia_features()') is null then
    raise exception 'Aplique primero la actualización de datos y correcciones de etiquetas.';
  end if;
end$$;

create or replace function agronorte_private.valid_export_label(fields jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare key_name text;date_value date;max_length integer;
begin
  if fields is null then return true;end if;
  if jsonb_typeof(fields)<>'object' then return false;end if;
  if exists(select 1 from jsonb_object_keys(fields) k where k not in
    ('afidi','packaged_date','harvest_date','producer_code','origin','senave_program','importer_name','importer_address')) then return false;end if;
  foreach key_name in array array['afidi','producer_code','origin','importer_name','importer_address'] loop
    max_length=case key_name when 'importer_address' then 400 when 'origin' then 200 when 'importer_name' then 200 else 100 end;
    if fields ? key_name and (jsonb_typeof(fields->key_name)<>'string' or length(fields->>key_name)>max_length) then return false;end if;
  end loop;
  foreach key_name in array array['packaged_date','harvest_date'] loop
    if fields ? key_name and fields->key_name<>'null'::jsonb then
      if jsonb_typeof(fields->key_name)<>'string' or (fields->>key_name)!~'^\d{4}-\d{2}-\d{2}$' then return false;end if;
      date_value=(fields->>key_name)::date;
      if to_char(date_value,'YYYY-MM-DD')<>fields->>key_name then return false;end if;
    end if;
  end loop;
  if fields ? 'senave_program' and jsonb_typeof(fields->'senave_program')<>'boolean' then return false;end if;
  return true;
exception when others then return false;
end$$;
revoke all on function agronorte_private.valid_export_label(jsonb) from public,anon,authenticated;

-- A legacy form omits these new keys. Explicit empty strings still clear them.
create or replace function agronorte_private.preserve_label_importer(previous_fields jsonb,incoming_fields jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)||incoming_fields
  from jsonb_each(coalesce(nullif(previous_fields,'null'::jsonb),'{}'::jsonb))
  where key in ('importer_name','importer_address') and not(incoming_fields ? key)
$$;
revoke all on function agronorte_private.preserve_label_importer(jsonb,jsonb) from public,anon,authenticated;

create or replace function agronorte_private.update_pallet_label_details(
  target_pallet_id uuid,export_fields jsonb,pallet_destination text,
  correction_reason text,expected_revision bigint
) returns void language plpgsql security definer set search_path='' as $$
declare org uuid;role_name text;actual_revision bigint;old_pallet public.pallets;
  new_metadata jsonb;new_destination text;effective_fields jsonb;
begin
  if auth.uid() is null then raise exception 'Inicie sesión';end if;
  org=public.my_org();role_name=public.my_role();
  if org is null or role_name not in ('administrador','gestor','packing') then raise exception 'Su perfil no puede editar datos de etiqueta';end if;
  if length(trim(coalesce(correction_reason,'')))=0 or length(correction_reason)>1000 then raise exception 'Datos de etiqueta requieren justificación de hasta 1000 caracteres';end if;
  if export_fields is null or not agronorte_private.valid_export_label(export_fields) then raise exception 'Datos de exportación inválidos';end if;
  if pallet_destination is not null and (length(trim(pallet_destination))=0 or length(trim(pallet_destination))>200) then raise exception 'Destino requiere entre 1 y 200 caracteres';end if;
  select revision into actual_revision from public.organizations where id=org for update;
  if expected_revision is null or actual_revision<>expected_revision then raise exception 'Conflicto de sincronización: actualice los datos antes de editar la etiqueta';end if;
  select * into old_pallet from public.pallets where id=target_pallet_id and organization_id=org for update;
  if not found then raise exception 'Pallet no disponible en su organización';end if;
  if old_pallet.status in ('Expedido','Cancelado') or exists(select 1 from public.shipment_pallets where pallet_id=target_pallet_id and organization_id=org) then raise exception 'Pallet cerrado o vinculado a una expedición';end if;
  new_destination=case when pallet_destination is null then old_pallet.destination else trim(pallet_destination) end;
  if export_fields->'senave_program'='true'::jsonb and lower(trim(new_destination))<>'uruguay' then raise exception 'El programa SENAVE para Uruguay requiere destino Uruguay confirmado';end if;
  effective_fields=agronorte_private.preserve_label_importer(old_pallet.metadata->'export_label',export_fields);
  new_metadata=coalesce(old_pallet.metadata,'{}'::jsonb)||jsonb_build_object('export_label',effective_fields);
  if old_pallet.metadata is not distinct from new_metadata and old_pallet.destination=new_destination then return;end if;
  perform set_config('agronorte.correction_reason',trim(correction_reason),true);
  update public.pallets set metadata=new_metadata,destination=new_destination,
    status=case when old_pallet.status in ('Etiquetado','Listo para carga') then 'En armado' else old_pallet.status end,updated_at=now()
    where id=target_pallet_id and organization_id=org;
  update public.organizations set revision=revision+1 where id=org;
end$$;
revoke all on function agronorte_private.update_pallet_label_details(uuid,jsonb,text,text,bigint) from public,anon;

create or replace function agronorte_private.update_pallet_export_label(
  target_pallet_id uuid,export_fields jsonb,correction_reason text,expected_revision bigint
) returns void language plpgsql security definer set search_path='' as $$
declare org uuid;role_name text;actual_revision bigint;old_pallet public.pallets;new_metadata jsonb;effective_fields jsonb;
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
  if export_fields->'senave_program'='true'::jsonb and lower(trim(old_pallet.destination))<>'uruguay' then raise exception 'El programa SENAVE para Uruguay requiere destino Uruguay confirmado';end if;
  effective_fields=agronorte_private.preserve_label_importer(old_pallet.metadata->'export_label',export_fields);
  new_metadata=coalesce(old_pallet.metadata,'{}'::jsonb)||jsonb_build_object('export_label',effective_fields);
  if old_pallet.metadata is not distinct from new_metadata then return;end if;
  perform set_config('agronorte.correction_reason',trim(correction_reason),true);
  update public.pallets set metadata=new_metadata,
    status=case when old_pallet.status in ('Etiquetado','Listo para carga') then 'En armado' else old_pallet.status end,updated_at=now()
    where id=target_pallet_id and organization_id=org;
  update public.organizations set revision=revision+1 where id=org;
end$$;
revoke all on function agronorte_private.update_pallet_export_label(uuid,jsonb,text,bigint) from public,anon;

-- Snapshot every currently enabled flag; later capabilities are not lost on rerun.
do $$declare previous_flags jsonb;begin
  select public.sandia_features() into previous_flags;
  execute format('create or replace function public.sandia_features() returns jsonb language sql stable security invoker set search_path='''' as $flags$ select %L::jsonb || jsonb_build_object(''label_importer_details'',true) $flags$',previous_flags::text);
end$$;
revoke all on function public.sandia_features() from public,anon;
-- Existing authenticated execution rights are retained by CREATE OR REPLACE.
notify pgrst,'reload schema';
commit;
