-- Complete missing label data before printing. Stored pallet identity, weights,
-- reception allocations, shipment records and QR token remain unchanged.
-- Apply after 20261005225807_pallet_export_label.sql.
begin;

do $$begin
  if to_regprocedure('public.update_pallet_export_label(uuid,jsonb,text,bigint)') is null then
    raise exception 'Aplique primero la actualización de etiquetas de exportación';
  end if;
end$$;

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
  update public.pallets set metadata=new_metadata,destination=new_destination,updated_at=now()
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

-- The original export-label RPC is deliberately retained for older clients.
create or replace function public.sandia_features() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('reception_edit',true,'recipient_access',true,'label_export_data',true,'label_destination_edit',true)
$$;
revoke all on function public.sandia_features() from public,anon;
grant execute on function public.sandia_features() to authenticated;
notify pgrst,'reload schema';
commit;
