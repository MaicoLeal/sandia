-- Limited recipient access is enforced in PostgreSQL, not only by the UI.
-- Apply after migrations 202610020001 through 202610020006.
begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('administrador','recepcion','pesaje','packing','gestor','auditor','destinatario'));

-- All existing organization policies, private trace and Storage policies rely
-- on my_org(). A recipient never receives an internal organization context.
create or replace function public.my_org() returns uuid
language sql stable security definer set search_path='' as $$
  select organization_id from public.profiles
  where user_id=auth.uid() and status='Activo' and role<>'destinatario'
$$;
revoke all on function public.my_org() from public,anon;
grant execute on function public.my_org() to authenticated;
revoke all on function public.my_role() from public,anon;
grant execute on function public.my_role() to authenticated;

create table if not exists public.recipient_pallet_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  pallet_id uuid not null,
  status text not null default 'Activo' check(status in ('Activo','Revocado')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(organization_id,user_id,pallet_id),
  foreign key(pallet_id,organization_id) references public.pallets(id,organization_id)
);
create index if not exists recipient_pallet_access_user_org_status
  on public.recipient_pallet_access(user_id,organization_id,status);
create index if not exists recipient_pallet_access_pallet
  on public.recipient_pallet_access(pallet_id);
alter table public.recipient_pallet_access enable row level security;
-- No raw-table API access. Only the checked RPCs below can read/write grants.
revoke all on public.recipient_pallet_access from public,anon,authenticated;

create schema if not exists agronorte_private;
revoke all on schema agronorte_private from public,anon;
grant usage on schema agronorte_private to authenticated;

create or replace function agronorte_private.recipient_pallets() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare recipient_org uuid; result jsonb;
begin
  if auth.uid() is null then raise exception 'Inicie sesión para consultar sus pallets'; end if;
  select organization_id into recipient_org from public.profiles
    where user_id=auth.uid() and status='Activo' and role='destinatario';
  if recipient_org is null then raise exception 'Perfil sin acceso de destinatario'; end if;

  select coalesce(jsonb_agg(row_value order by assembled_at desc,code),'[]'::jsonb)
  into result from (
    select p.assembled_at,p.code,jsonb_build_object(
      'code',p.code,'token',p.token,'product','Sandía',
      'net_kg',p.net_kg,'gross_kg',p.gross_kg,'status',p.status,
      'destination',p.destination,'assembled_at',p.assembled_at,
      'weighed_date',p.weighed_date,
      'reception_dates',coalesce((
        select jsonb_agg(d.date order by d.date) from (
          select distinct r.date from public.pallet_items i
          join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
          where i.pallet_id=p.id and i.organization_id=recipient_org
            and i.status='Activo' and r.status<>'Cancelado'
        ) d),'[]'::jsonb),
      'lot_codes',coalesce((
        select jsonb_agg(d.code order by d.code) from (
          select distinct l.code from public.pallet_items i
          join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
          join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
          where i.pallet_id=p.id and i.organization_id=recipient_org
            and i.status='Activo' and r.status<>'Cancelado'
        ) d),'[]'::jsonb),
      'shipments',coalesce((
        select jsonb_agg(jsonb_build_object(
          'destination',s.destination,'country',s.country,'departure',s.departure
        ) order by s.departure) from public.shipment_pallets sp
        join public.shipments s on s.id=sp.shipment_id and s.organization_id=sp.organization_id
        where sp.pallet_id=p.id and sp.organization_id=recipient_org
          and sp.status='Activo' and s.status<>'Cancelado'
      ),'[]'::jsonb)
    ) as row_value
    from public.recipient_pallet_access a
    join public.pallets p on p.id=a.pallet_id and p.organization_id=a.organization_id
    where a.user_id=auth.uid() and a.organization_id=recipient_org
      and a.status='Activo' and p.status<>'Cancelado'
  ) safe_rows;
  return result;
end $$;
revoke all on function agronorte_private.recipient_pallets() from public,anon;
grant execute on function agronorte_private.recipient_pallets() to authenticated;

create or replace function agronorte_private.list_recipient_accounts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare admin_org uuid=public.my_org(); result jsonb;
begin
  if auth.uid() is null or admin_org is null or public.my_role() is distinct from 'administrador'
    then raise exception 'Solo el administrador puede gestionar destinatarios'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',p.user_id,'email',u.email,'name',p.name,
    'pallet_ids',coalesce((select jsonb_agg(a.pallet_id order by a.pallet_id)
      from public.recipient_pallet_access a
      where a.organization_id=admin_org and a.user_id=p.user_id and a.status='Activo'),'[]'::jsonb)
  ) order by p.name,p.user_id),'[]'::jsonb) into result
  from public.profiles p join auth.users u on u.id=p.user_id
  where p.organization_id=admin_org and p.role='destinatario' and p.status='Activo';
  return result;
end $$;
revoke all on function agronorte_private.list_recipient_accounts() from public,anon;
grant execute on function agronorte_private.list_recipient_accounts() to authenticated;

create or replace function agronorte_private.set_recipient_pallet_access(
  target_user_id uuid,target_email text,target_name text,pallet_ids uuid[]
) returns void
language plpgsql security definer set search_path='' as $$
declare
  admin_org uuid=public.my_org(); actual_email text; old_profile public.profiles;
  new_profile public.profiles; selected_ids uuid[]; old_ids uuid[];
  actor_name text; before_value jsonb; after_value jsonb;
begin
  if auth.uid() is null or admin_org is null or public.my_role() is distinct from 'administrador'
    then raise exception 'Solo el administrador puede gestionar destinatarios'; end if;
  if target_user_id is null or length(trim(coalesce(target_email,'')))=0
    or length(trim(coalesce(target_name,'')))=0
    then raise exception 'Informe UUID, correo y nombre del destinatario'; end if;
  if length(trim(target_name))>120 then raise exception 'Nombre demasiado largo'; end if;
  if pallet_ids is null or array_position(pallet_ids,null) is not null
    then raise exception 'La selección de pallets no es válida'; end if;
  select coalesce(array_agg(distinct x order by x),array[]::uuid[])
    into selected_ids from unnest(pallet_ids) x;
  perform 1 from public.organizations where id=admin_org for update;
  select email into actual_email from auth.users where id=target_user_id for update;
  if not found or lower(coalesce(actual_email,''))<>lower(trim(target_email))
    then raise exception 'El UUID y el correo no corresponden a una cuenta registrada'; end if;
  select * into old_profile from public.profiles where user_id=target_user_id for update;
  if found and (old_profile.organization_id<>admin_org or old_profile.role<>'destinatario')
    then raise exception 'La cuenta ya tiene un perfil interno o pertenece a otra organización'; end if;
  if exists(select 1 from unnest(selected_ids) x where not exists(
    select 1 from public.pallets p where p.id=x and p.organization_id=admin_org and p.status<>'Cancelado'
  )) then raise exception 'Seleccione únicamente pallets activos de su organización'; end if;

  select coalesce(array_agg(pallet_id order by pallet_id),array[]::uuid[]) into old_ids
  from public.recipient_pallet_access
  where organization_id=admin_org and user_id=target_user_id and status='Activo';
  before_value=jsonb_build_object('profile',case when old_profile.id is null then null else to_jsonb(old_profile) end,'pallet_ids',old_ids);
  insert into public.profiles(organization_id,user_id,name,role,status,created_by)
  values(admin_org,target_user_id,trim(target_name),'destinatario','Activo',auth.uid())
  on conflict(user_id) do update set name=excluded.name,role=excluded.role,status=excluded.status,updated_at=now()
  where profiles.organization_id=admin_org and profiles.role='destinatario'
  returning * into new_profile;
  if not found then raise exception 'El perfil no puede convertirse en destinatario'; end if;

  update public.recipient_pallet_access set status='Revocado',updated_at=now(),
    metadata=metadata||jsonb_build_object('changed_by',auth.uid())
  where organization_id=admin_org and user_id=target_user_id and status='Activo'
    and not(pallet_id=any(selected_ids));
  insert into public.recipient_pallet_access(organization_id,user_id,pallet_id,created_by,metadata)
  select admin_org,target_user_id,x,auth.uid(),jsonb_build_object('changed_by',auth.uid())
  from unnest(selected_ids) x
  on conflict(organization_id,user_id,pallet_id) do update
    set status='Activo',updated_at=now(),metadata=recipient_pallet_access.metadata||excluded.metadata;
  after_value=jsonb_build_object('profile',to_jsonb(new_profile),'pallet_ids',selected_ids);
  select name into actor_name from public.profiles where user_id=auth.uid();
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,actor,"before","after",reason,created_by)
  values(admin_org,'profiles',new_profile.id,'Acceso de destinatario actualizado',actor_name,
    before_value,after_value,'Administrador asignó o revocó consulta de pallets seleccionados',auth.uid());
end $$;
revoke all on function agronorte_private.set_recipient_pallet_access(uuid,text,text,uuid[]) from public,anon;
grant execute on function agronorte_private.set_recipient_pallet_access(uuid,text,text,uuid[]) to authenticated;

-- Public endpoints are invoker wrappers around checked private implementations.
create or replace function public.recipient_pallets() returns jsonb
language sql stable security invoker set search_path='' as $$
  select agronorte_private.recipient_pallets()
$$;
revoke all on function public.recipient_pallets() from public,anon;
grant execute on function public.recipient_pallets() to authenticated;

create or replace function public.list_recipient_accounts() returns jsonb
language sql stable security invoker set search_path='' as $$
  select agronorte_private.list_recipient_accounts()
$$;
revoke all on function public.list_recipient_accounts() from public,anon;
grant execute on function public.list_recipient_accounts() to authenticated;

create or replace function public.set_recipient_pallet_access(
  target_user_id uuid,target_email text,target_name text,pallet_ids uuid[]
) returns void language sql security invoker set search_path='' as $$
  select agronorte_private.set_recipient_pallet_access(target_user_id,target_email,target_name,pallet_ids)
$$;
revoke all on function public.set_recipient_pallet_access(uuid,text,text,uuid[]) from public,anon;
grant execute on function public.set_recipient_pallet_access(uuid,text,text,uuid[]) to authenticated;

-- Data-free capability response lets older deployments hide new actions until
-- this migration has been applied. It grants no organization access.
create or replace function public.sandia_features() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('reception_edit',true,'recipient_access',true)
$$;
revoke all on function public.sandia_features() from public,anon;
grant execute on function public.sandia_features() to authenticated;

-- sync_workspace is replaced below to allow audited general reception edits.

create or replace function public.sync_workspace(payload jsonb, expected_revision bigint) returns bigint language plpgsql security definer set search_path='' as $$
declare org uuid=public.my_org();role_name text=public.my_role();actual_revision bigint;t text;row_value jsonb;previous jsonb;canonical jsonb;row_id uuid;columns_list text;update_list text;allowed_roles text[];existing_ids uuid[];new_ids uuid[];log_value jsonb;original_pallets jsonb;correction_cursor jsonb;correction_reasons text[];
begin
 if org is null or role_name='auditor' then raise exception 'Perfil sin permiso de escritura';end if;
 select revision into actual_revision from public.organizations where id=org for update;
 if actual_revision<>expected_revision then raise exception 'Conflicto de sincronización: otra persona modificó los datos. Conserve sus registros locales y solicite una conciliación al gestor.';end if;
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
 if log_value->>'action'='Solicitud de impresión de etiqueta' and exists(select 1 from public.pallets where id=(log_value->>'entity_id')::uuid and organization_id=org) then
 insert into public.audit_logs(id,organization_id,entity_type,entity_id,action,actor,"after",created_by) values((log_value->>'id')::uuid,org,'pallets',(log_value->>'entity_id')::uuid,'Solicitud de impresión de etiqueta',(select name from public.profiles where user_id=auth.uid()),jsonb_build_object('solicitada',true),auth.uid()) on conflict(id) do nothing;
 end if;end loop;end if;
 update public.organizations set revision=revision+1 where id=org returning revision into actual_revision;
 return actual_revision;
end$$;
revoke all on function public.sync_workspace(jsonb,bigint) from public,anon;
grant execute on function public.sync_workspace(jsonb,bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
