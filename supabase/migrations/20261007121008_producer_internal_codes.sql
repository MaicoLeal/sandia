-- Internal Agronorte producer identifiers. These are not official SENAVE codes.
-- Existing official export codes and origin information remain unchanged.
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';

do $$begin
  if to_regclass('public.organizations') is null or to_regclass('public.producers') is null
    or to_regclass('public.pallets') is null or to_regclass('public.pallet_items') is null
    or to_regclass('public.field_lots') is null or to_regclass('public.audit_logs') is null then
    raise exception 'La base Sandía no existe en este proyecto. Abra el proyecto znbtwkhktlldzhkiwodu.';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='producers' and column_name='metadata')
    or to_regprocedure('public.update_pallet_export_label(uuid,jsonb,text,bigint)') is null then
    raise exception 'Aplique primero la actualización de etiquetas de exportación del sistema Sandía.';
  end if;
  if not exists(select 1 from public.organizations where id='20000000-0000-4000-8000-000000000001' and name='Cooperativa Agronorte') then
    raise exception 'Esta base no es la Cooperativa Agronorte autorizada.';
  end if;
  if exists(select 1 from unnest(array['producers','pallets']) as required_table(table_name)
    where not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid=('public.'||required_table.table_name)::regclass and tgname='audit_change'
        and tgenabled in ('O','A') and not tgisinternal)) then
    raise exception 'La auditoría de productores y pallets debe estar activa antes de asignar códigos.';
  end if;
end$$;

alter table public.producers drop constraint if exists producers_internal_code_check;
alter table public.producers add constraint producers_internal_code_check check (
  metadata is null or not(metadata ? 'internal_code') or (
    jsonb_typeof(metadata->'internal_code')='string' and length(trim(metadata->>'internal_code'))<=80
  )
);
create unique index if not exists producers_internal_code_unique
  on public.producers(organization_id,upper(trim(metadata->>'internal_code')))
  where nullif(trim(metadata->>'internal_code'),'') is not null;

-- Invoker-only trigger, reached by the existing restricted server RPCs.
-- Organization locking serializes code allocation across mobile clients.
create or replace function agronorte_private.assign_producer_internal_code()
returns trigger language plpgsql security invoker set search_path='' as $$
declare old_metadata jsonb;old_organization uuid;old_code text;next_number numeric;new_code text;
begin
  if new.metadata is not null and jsonb_typeof(new.metadata)<>'object' then
    raise exception 'Metadatos del productor inválidos';
  end if;
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id then
      raise exception 'No se puede cambiar la identidad u organización del productor';
    end if;
    old_metadata=old.metadata;old_organization=old.organization_id;
  else
    -- sync_workspace uses UPSERT: BEFORE INSERT also runs for an existing id.
    select p.metadata,p.organization_id into old_metadata,old_organization
      from public.producers p where p.id=new.id;
    if old_organization is not null and old_organization<>new.organization_id then
      raise exception 'Productor de otra organización';
    end if;
  end if;
  old_code=nullif(trim(old_metadata->>'internal_code'),'');
  if old_code is not null then
    if new.metadata ? 'internal_code' and (new.metadata->>'internal_code') is distinct from (old_metadata->>'internal_code') then
      raise exception 'El código interno del productor es permanente y no puede modificarse ni eliminarse';
    end if;
    -- Legacy clients can omit the new metadata field without removing it.
    new.metadata=coalesce(new.metadata,old_metadata,'{}'::jsonb)||jsonb_build_object('internal_code',old_metadata->>'internal_code');
    return new;
  end if;
  perform 1 from public.organizations where id=new.organization_id for update;
  if not found then raise exception 'Organización no disponible para asignar código';end if;
  select coalesce(max(substring(upper(trim(p.metadata->>'internal_code')) from '^AGN-([0-9]+)$')::numeric),0)+1
    into next_number from public.producers p where p.organization_id=new.organization_id
      and upper(trim(p.metadata->>'internal_code'))~'^AGN-[0-9]+$';
  new_code='AGN-'||lpad(next_number::text,greatest(4,length(next_number::text)),'0');
  if length(new_code)>80 then raise exception 'Secuencia de códigos internos agotada';end if;
  -- New producer codes are always assigned by the server, never by a client.
  new.metadata=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('internal_code',new_code);
  return new;
end$$;
revoke all on function agronorte_private.assign_producer_internal_code() from public,anon,authenticated;
drop trigger if exists assign_internal_code on public.producers;
create trigger assign_internal_code before insert or update on public.producers
  for each row execute function agronorte_private.assign_producer_internal_code();

do $$declare
  org constant uuid='20000000-0000-4000-8000-000000000001';
  item record;changed_ids uuid[]=array[]::uuid[];
begin
  perform 1 from public.organizations where id=org for update;
  perform set_config('agronorte.correction_reason',
    'Asignación de código interno Agronorte AGN a productores existentes, autorizada por el propietario. No sustituye códigos oficiales de exportación.',true);
  for item in select p.id from public.producers p
    where p.organization_id=org and nullif(trim(p.metadata->>'internal_code'),'') is null
    order by lower(trim(p.name)),p.id for update of p
  loop
    -- The trigger allocates the next code; all other metadata is retained.
    update public.producers set metadata=coalesce(metadata,'{}'::jsonb),updated_at=now() where id=item.id and organization_id=org;
    changed_ids=array_append(changed_ids,item.id);
  end loop;
  if cardinality(changed_ids)>0 then
    perform set_config('agronorte.correction_reason',
      'Etiqueta pendiente de reimpresión por asignación de código interno del productor Agronorte.',true);
    update public.pallets p set status='En armado',updated_at=now()
      where p.organization_id=org and p.status in ('Etiquetado','Listo para carga')
        and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
        and exists(select 1 from public.pallet_items i
          join public.receptions r on r.id=i.reception_id and r.organization_id=i.organization_id
          join public.field_lots l on l.id=r.lot_id and l.organization_id=r.organization_id
          left join public.plots pl on pl.id=l.plot_id and pl.organization_id=l.organization_id
          left join public.farms f on f.id=pl.farm_id and f.organization_id=pl.organization_id
          where i.pallet_id=p.id and i.organization_id=org and i.status<>'Cancelado'
            and coalesce(f.producer_id,l.producer_id)=any(changed_ids));
    update public.organizations set revision=revision+1 where id=org;
  end if;
  perform set_config('agronorte.correction_reason','',true);
  raise notice 'Códigos internos Agronorte: % productores actualizados. Actualice el aplicativo y vuelva a imprimir las etiquetas afectadas.',cardinality(changed_ids);
end$$;

comment on index public.producers_internal_code_unique is 'Unique permanent internal producer code per organization; not an official certification or SENAVE registration';
commit;
