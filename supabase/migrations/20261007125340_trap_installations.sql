-- Provenance-preserving trap installations; installation dates are not harvest dates.
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';
do $$begin
  if to_regclass('public.organizations') is null or to_regclass('public.producers') is null
    or to_regprocedure('agronorte_private.assign_producer_internal_code()') is null then
    raise exception 'Aplique primero la base Sandía y la actualización de códigos internos de productores.';
  end if;
end$$;

create table if not exists public.trap_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  producer_id uuid,
  source_key text not null check(length(trim(source_key)) between 1 and 200),
  source_row integer not null check(source_row>0),
  source_document text not null,
  source_form text not null,
  source_version text not null,
  source_producer_name text,
  trap_code text not null check(length(trim(trap_code)) between 1 and 100),
  department text not null default '',
  district text not null default '',
  community text not null default '',
  installed_on date,
  trap_type text not null default '',
  latitude_raw text not null default '',
  longitude_raw text not null default '',
  installation_place text not null default '',
  host text not null default '',
  area_ha numeric(12,2) check(area_ha>=0),
  crop_stage text not null default '',
  responsible text not null default '',
  review_notes text[] not null default array[]::text[],
  status text not null default 'Activo' check(status in ('Activo','Cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(id,organization_id),
  unique(organization_id,source_key,source_row),
  foreign key(producer_id,organization_id) references public.producers(id,organization_id)
);
create index if not exists trap_installations_producer on public.trap_installations(organization_id,producer_id);
alter table public.trap_installations enable row level security;
revoke all on public.trap_installations from public,anon,authenticated;
grant select on public.trap_installations to authenticated;
drop policy if exists internal_organization_read on public.trap_installations;
create policy internal_organization_read on public.trap_installations for select to authenticated using (
  organization_id=(select public.my_org())
  and (select public.my_role()) in ('administrador','gestor','recepcion','pesaje','packing','auditor')
);

create or replace function agronorte_private.normalize_producer_name(value text)
returns text language sql immutable security invoker set search_path='' as $$
  select upper(trim(regexp_replace(translate(coalesce(value,''),'ÁÉÍÓÚÜáéíóúü','AEIOUUaeiouu'),'\s+',' ','g')))
$$;
revoke all on function agronorte_private.normalize_producer_name(text) from public,anon,authenticated;

create or replace function agronorte_private.trap_reference_codes(target_org uuid,target_producer uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(code order by source_key,source_row,code),'[]'::jsonb)
  from (
    select distinct on (upper(trim(t.trap_code))) t.trap_code as code,t.source_key,t.source_row
    from public.trap_installations t
    where t.organization_id=target_org and t.producer_id=target_producer and t.status='Activo'
      and lower(trim(t.host)) in ('sandia','sandía','melancia')
    order by upper(trim(t.trap_code)),t.source_key,t.source_row,t.id
  ) codes
$$;
revoke all on function agronorte_private.trap_reference_codes(uuid,uuid) from public,anon,authenticated;

create or replace function agronorte_private.derive_producer_trap_references()
returns trigger language plpgsql security invoker set search_path='' as $$
declare references_value jsonb;
begin
  references_value=agronorte_private.trap_reference_codes(new.organization_id,new.id);
  if new.metadata is not null and jsonb_typeof(new.metadata)<>'object' then raise exception 'Metadatos del productor inválidos';end if;
  if jsonb_array_length(references_value)>0 then
    new.metadata=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('trap_reference_codes',references_value);
  elsif new.metadata is not null then
    new.metadata=new.metadata-'trap_reference_codes';
  end if;
  return new;
end$$;
revoke all on function agronorte_private.derive_producer_trap_references() from public,anon,authenticated;
drop trigger if exists derive_trap_references on public.producers;
create trigger derive_trap_references before insert or update on public.producers
  for each row execute function agronorte_private.derive_producer_trap_references();

create or replace function agronorte_private.touch_trap_installation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'No se permite eliminar una instalación; cancele conservando su historial';end if;
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
      or new.source_key is distinct from old.source_key or new.source_row is distinct from old.source_row then
      raise exception 'La identidad y fila de origen de una instalación son permanentes';
    end if;
    new.created_at=old.created_at;new.created_by=old.created_by;new.updated_at=now();
  end if;
  return new;
end$$;
revoke all on function agronorte_private.touch_trap_installation() from public,anon,authenticated;
drop trigger if exists touch_record on public.trap_installations;
create trigger touch_record before update or delete on public.trap_installations
  for each row execute function agronorte_private.touch_trap_installation();

create or replace function agronorte_private.audit_trap_installation()
returns trigger language plpgsql security invoker set search_path='' as $$
declare actor_name text;
begin
  select name into actor_name from public.profiles where user_id=auth.uid();
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,actor,"before","after",reason,created_by)
    values(new.organization_id,'trap_installations',new.id,
      case when tg_op='INSERT' then 'Creación · ' else 'Actualización · ' end||'trap_installations',
      coalesce(actor_name,'Administrador del servidor'),case when tg_op='UPDATE' then to_jsonb(old) else null end,
      to_jsonb(new),coalesce(current_setting('agronorte.correction_reason',true),''),auth.uid());
  return new;
end$$;
revoke all on function agronorte_private.audit_trap_installation() from public,anon,authenticated;
drop trigger if exists audit_change on public.trap_installations;
create trigger audit_change after insert or update on public.trap_installations
  for each row execute function agronorte_private.audit_trap_installation();

create or replace function agronorte_private.refresh_trap_producer_references()
returns trigger language plpgsql security invoker set search_path='' as $$
declare target_id uuid;affected_ids uuid[]=array[]::uuid[];references_value jsonb;old_value jsonb;
begin
  perform 1 from public.organizations where id=new.organization_id for update;
  for target_id in select distinct v from unnest(case when tg_op='UPDATE'
    then array[new.producer_id,old.producer_id] else array[new.producer_id] end) v where v is not null
  loop
    references_value=agronorte_private.trap_reference_codes(new.organization_id,target_id);
    select metadata->'trap_reference_codes' into old_value from public.producers
      where id=target_id and organization_id=new.organization_id for update;
    if coalesce(old_value,'[]'::jsonb) is distinct from references_value then
      update public.producers set metadata=coalesce(metadata,'{}'::jsonb),updated_at=now()
        where id=target_id and organization_id=new.organization_id;
      affected_ids=array_append(affected_ids,target_id);
    end if;
  end loop;
  if cardinality(affected_ids)>0 then
    update public.pallets p set status='En armado',updated_at=now()
      where p.organization_id=new.organization_id and p.status in ('Etiquetado','Listo para carga')
      and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
      and exists(select 1 from public.pallet_items i
        join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
        join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
        left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
        left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
        where i.pallet_id=p.id and i.organization_id=new.organization_id and i.status<>'Cancelado'
          and coalesce(f.producer_id,l.producer_id)=any(affected_ids));
  end if;
  if coalesce(current_setting('agronorte.trap_import_batch',true),'')<>'on' then
    update public.organizations set revision=revision+1 where id=new.organization_id;
  end if;
  return new;
end$$;
revoke all on function agronorte_private.refresh_trap_producer_references() from public,anon,authenticated;
drop trigger if exists refresh_references on public.trap_installations;
create trigger refresh_references after insert or update on public.trap_installations
  for each row execute function agronorte_private.refresh_trap_producer_references();

create or replace function public.sandia_features() returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('reception_edit',true,'recipient_access',true,'label_export_data',true,
    'label_destination_edit',true,'pallet_corrections',true,'reception_management',true,'pallet_tare',true,'trap_installations',true)
$$;
revoke all on function public.sandia_features() from public,anon;
grant execute on function public.sandia_features() to authenticated;
comment on table public.trap_installations is 'Source trap installations with original producer names and raw UTM text; never interpreted as harvest dates, farm ownership or geographic coordinates';
notify pgrst, 'reload schema';
commit;
