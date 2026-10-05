-- Optional, explicitly confirmed export label details. No assumed registration,
-- origin, producer identifier, harvest date or packing date is created here.
begin;
do $$begin
  if to_regprocedure('public.recipient_pallets()') is null then
    raise exception 'Aplique primero la actualización de edición y destinatarios';
  end if;
end$$;
alter table public.producers add column if not exists metadata jsonb;
alter table public.pallets add column if not exists metadata jsonb;

create schema if not exists agronorte_private;
revoke all on schema agronorte_private from public,anon;
grant usage on schema agronorte_private to authenticated;

create or replace function agronorte_private.valid_export_label(fields jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare key_name text; date_value date;
begin
  if fields is null then return true;end if;
  if jsonb_typeof(fields)<>'object' then return false;end if;
  if exists(select 1 from jsonb_object_keys(fields) k where k not in ('afidi','packaged_date','harvest_date','producer_code','origin','senave_program')) then return false;end if;
  foreach key_name in array array['afidi','producer_code','origin'] loop
    if fields ? key_name and (jsonb_typeof(fields->key_name)<>'string' or length(fields->>key_name)>case when key_name='origin' then 200 else 100 end) then return false;end if;
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

alter table public.producers drop constraint if exists producers_export_metadata_check;
alter table public.producers add constraint producers_export_metadata_check check (
  metadata is null or (
    jsonb_typeof(metadata)='object' and length(metadata::text)<=4096
    and (not(metadata ? 'export_code') or (jsonb_typeof(metadata->'export_code')='string' and length(metadata->>'export_code')<=100))
    and (not(metadata ? 'export_origin') or (jsonb_typeof(metadata->'export_origin')='string' and length(metadata->>'export_origin')<=200))
  )
);
alter table public.pallets drop constraint if exists pallets_export_metadata_check;
alter table public.pallets add constraint pallets_export_metadata_check check (
  metadata is null or (
    jsonb_typeof(metadata)='object' and length(metadata::text)<=4096
    and agronorte_private.valid_export_label(metadata->'export_label')
    and (metadata#>'{export_label,senave_program}' is distinct from 'true'::jsonb or lower(trim(destination))='uruguay')
  )
);

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
  if old_pallet.status in ('Expedido','Cancelado') then raise exception 'Pallet cerrado';end if;
  if export_fields->'senave_program'='true'::jsonb and lower(trim(old_pallet.destination))<>'uruguay' then
    raise exception 'El programa SENAVE para Uruguay requiere destino Uruguay confirmado';
  end if;
  new_metadata=coalesce(old_pallet.metadata,'{}'::jsonb)||jsonb_build_object('export_label',export_fields);
  if old_pallet.metadata is not distinct from new_metadata then return;end if;
  perform set_config('agronorte.correction_reason',trim(correction_reason),true);
  update public.pallets set metadata=new_metadata,updated_at=now() where id=target_pallet_id and organization_id=org;
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

create or replace function public.sandia_features() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('reception_edit',true,'recipient_access',true,'label_export_data',true)
$$;
revoke all on function public.sandia_features() from public,anon;
grant execute on function public.sandia_features() to authenticated;
comment on column public.producers.metadata is 'Optional confirmed export code and origin; document/CI is not used as export code';
comment on column public.pallets.metadata is 'Optional confirmed export_label details, revised only by a restricted audited RPC after creation';
commit;
