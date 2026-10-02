-- Keep operational lot names; do not invent harvest dates or visual grades.
begin;
alter table public.field_lots alter column harvest_date drop not null;
alter table public.field_lots alter column plot_id drop not null;
alter table public.field_lots add column producer_id uuid;
alter table public.field_lots add constraint field_lots_producer_org_fk foreign key(producer_id,organization_id) references public.producers(id,organization_id);
alter table public.field_lots add constraint field_lots_known_origin check(plot_id is not null or producer_id is not null);
alter table public.classifications alter column quality drop not null;
alter table public.pallets alter column gross_kg drop not null;
create or replace function public.sync_workspace(payload jsonb, expected_revision bigint) returns bigint language plpgsql security definer set search_path='' as $$
declare org uuid=public.my_org();role_name text=public.my_role();actual_revision bigint;t text;row_value jsonb;previous jsonb;canonical jsonb;row_id uuid;columns_list text;update_list text;allowed_roles text[];existing_ids uuid[];new_ids uuid[];log_value jsonb;original_pallets jsonb;
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
 allowed_roles=case when t in ('producers','farms','plots') then array['administrador','gestor','recepcion'] when t='receptions' then array['administrador','gestor','recepcion'] when t='reception_weights' then array['administrador','gestor','recepcion','pesaje'] when t in ('classifications','pallets','pallet_items','shipments','shipment_pallets') then array['administrador','gestor','packing'] else array['administrador','gestor','recepcion','pesaje','packing'] end;
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
     if role_name not in ('administrador','gestor') or previous->>'status'='Cancelado' or canonical->>'status'<>'Cancelado' or length(trim(coalesce(canonical->>'notes','')))=0 or (previous-array['status','notes','updated_at']) is distinct from (canonical-array['status','notes','updated_at']) then raise exception 'Cancelación requiere gestor, justificación y conservación del origen';end if;
     if exists(select 1 from public.classifications where reception_id=row_id) then raise exception 'No se puede cancelar una recepción clasificada';end if;
   end if;
 end if;
 if t='reception_weights' and previous is null and exists(select 1 from public.classifications where reception_id=(row_value->>'reception_id')::uuid and status<>'Cancelado') then raise exception 'Recepción clasificada';end if;
 if t='reception_weights' and exists(select 1 from public.receptions where id=(row_value->>'reception_id')::uuid and status='Cancelado') then raise exception 'Recepción cancelada';end if;
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
commit;
