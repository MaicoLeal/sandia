-- Record a print request directly from an authenticated account. A print request
-- is an intention: the browser/printer cannot prove that paper was produced.
begin;
do $$begin
  if to_regclass('public.pallets') is null or to_regclass('public.audit_logs') is null
    or to_regprocedure('public.my_org()') is null
    or to_regprocedure('public.my_role()') is null
    or to_regprocedure('public.audit_record()') is null
    or to_regprocedure('public.sandia_features()') is null then
    raise exception 'Aplique primero las actualizaciones del sistema Sandía';
  end if;
end$$;

create or replace function agronorte_private.record_pallet_label_print(target_pallet_id uuid,print_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid;role_name text;actor_id uuid;actor_name text;actual_revision bigint;
  pallet_row public.pallets;existing_log public.audit_logs;previous_reason text;
begin
  actor_id=auth.uid();
  if actor_id is null then raise exception 'Inicie sesión para imprimir etiquetas';end if;
  org=public.my_org();role_name=public.my_role();
  if org is null or role_name is null or role_name not in ('administrador','gestor','packing') then
    raise exception 'Su perfil no puede imprimir etiquetas';
  end if;
  if target_pallet_id is null or print_id is null then
    raise exception 'Pallet e identificador de impresión son obligatorios';
  end if;
  -- Match the lock order of sync_workspace and correction RPCs. No client
  -- snapshot or expected revision is required for this narrowly scoped action.
  select revision into actual_revision from public.organizations where id=org for update;
  if not found then raise exception 'Organización no disponible';end if;
  select name,role into actor_name,role_name from public.profiles
    where user_id=actor_id and organization_id=org and status='Activo';
  if not found or role_name not in ('administrador','gestor','packing') then
    raise exception 'Su perfil no puede imprimir etiquetas';
  end if;
  select * into pallet_row from public.pallets where id=target_pallet_id and organization_id=org for update;
  if not found then raise exception 'Pallet no disponible en su organización';end if;
  if pallet_row.status='Cancelado' then raise exception 'No se puede imprimir un pallet cancelado';end if;
  select * into existing_log from public.audit_logs where id=print_id;
  if found then
    if existing_log.organization_id is distinct from org
      or existing_log.entity_type is distinct from 'pallets'
      or existing_log.entity_id is distinct from target_pallet_id
      or existing_log.action is distinct from 'Solicitud de impresión de etiqueta'
      or existing_log.created_by is distinct from actor_id then
      raise exception 'Identificador de impresión ya utilizado por otra operación';
    end if;
    return jsonb_build_object('pallet_id',target_pallet_id,'print_id',print_id,
      'status',pallet_row.status,'revision',actual_revision,'recorded',false);
  end if;
  -- Fail atomically if operational status changes would no longer be audited.
  if not exists(select 1 from pg_catalog.pg_trigger g
    where g.tgrelid='public.pallets'::regclass and g.tgname='audit_change'
      and not g.tgisinternal and g.tgenabled in ('O','A') and g.tgqual is null
      and g.tgfoid='public.audit_record()'::regprocedure
      and (g.tgtype::integer & 1)=1 and (g.tgtype::integer & 2)=0
      and (g.tgtype::integer & 16)=16) then
    raise exception 'Auditoría de pallets no disponible';
  end if;
  previous_reason=coalesce(current_setting('agronorte.correction_reason',true),'');
  perform set_config('agronorte.correction_reason','Solicitud de impresión de etiqueta desde la cuenta autenticada',true);
  if pallet_row.status='En armado' then
    update public.pallets set status='Etiquetado',updated_at=now()
      where id=target_pallet_id and organization_id=org returning * into pallet_row;
  end if;
  insert into public.audit_logs(id,organization_id,entity_type,entity_id,action,actor,"after",reason,created_by)
    values(print_id,org,'pallets',target_pallet_id,'Solicitud de impresión de etiqueta',actor_name,
      jsonb_build_object('solicitada',true),'Solicitud registrada; la salida de la impresora depende del dispositivo',actor_id);
  update public.organizations set revision=revision+1 where id=org returning revision into actual_revision;
  perform set_config('agronorte.correction_reason',previous_reason,true);
  return jsonb_build_object('pallet_id',target_pallet_id,'print_id',print_id,
    'status',pallet_row.status,'revision',actual_revision,'recorded',true);
end$$;
revoke all on function agronorte_private.record_pallet_label_print(uuid,uuid) from public,anon;
grant execute on function agronorte_private.record_pallet_label_print(uuid,uuid) to authenticated;
create or replace function public.record_pallet_label_print(target_pallet_id uuid,print_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select agronorte_private.record_pallet_label_print(target_pallet_id,print_id)
$$;
revoke all on function public.record_pallet_label_print(uuid,uuid) from public,anon;
grant execute on function public.record_pallet_label_print(uuid,uuid) to authenticated;

-- Preserve every installed capability, including later flags when reapplied.
do $$declare previous_flags jsonb;begin
  select public.sandia_features() into previous_flags;
  execute format('create or replace function public.sandia_features() returns jsonb language sql stable security invoker set search_path='''' as $flags$ select %L::jsonb || jsonb_build_object(''label_print_audit'',true) $flags$',previous_flags::text);
end$$;
revoke all on function public.sandia_features() from public,anon;
grant execute on function public.sandia_features() to authenticated;
notify pgrst,'reload schema';
commit;
