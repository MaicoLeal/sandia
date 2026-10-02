-- Apply to a new Supabase project. Do not apply blindly to an existing schema.
begin;
create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null, revision bigint not null default 0, created_at timestamptz not null default now());
create table public.profiles (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), user_id uuid not null unique references auth.users(id), name text not null, role text not null check(role in ('administrador','recepcion','pesaje','packing','gestor','auditor')), status text not null default 'Activo', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id));
create function public.my_org() returns uuid language sql stable security definer set search_path='' as $$select organization_id from public.profiles where user_id=auth.uid() and status='Activo'$$;
create function public.my_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where user_id=auth.uid() and status='Activo'$$;
create table public.producers(id uuid primary key, organization_id uuid not null references public.organizations(id), name text not null check(length(trim(name))>0), document text not null default '', phone text not null default '', community text not null default '', address text not null default '', notes text not null default '', status text not null default 'Activo' check(status in ('Activo','Inactivo')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id));
create table public.farms(id uuid primary key, organization_id uuid not null references public.organizations(id), producer_id uuid not null, name text not null, location text not null default '', status text not null default 'Activo', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id), foreign key(producer_id,organization_id) references public.producers(id,organization_id));
create table public.plots(id uuid primary key, organization_id uuid not null references public.organizations(id), farm_id uuid not null, name text not null, location text not null default '', area_ha numeric(12,2) check(area_ha>=0), crop text not null default 'Sandía', variety text not null default '', planting_date date, harvest_date date, notes text not null default '', status text not null default 'Activo', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id), foreign key(farm_id,organization_id) references public.farms(id,organization_id));
create table public.field_lots(id uuid primary key, organization_id uuid not null references public.organizations(id), plot_id uuid not null, code text not null, crop text not null default 'Sandía', variety text not null default '', harvest_date date not null, notes text not null default '', status text not null default 'En recepción' check(status in ('En recepción','En selección','En pesaje','Palletizado','Listo para exportación','Expedido','Rechazado','Parcialmente rechazado')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id), unique(organization_id,code), foreign key(plot_id,organization_id) references public.plots(id,organization_id));
create table public.receptions(id uuid primary key, organization_id uuid not null references public.organizations(id), lot_id uuid not null, date date not null, responsible text not null check(length(trim(responsible))>0), notes text not null default '', status text not null default 'Confirmado' check(status in ('Confirmado','Cancelado')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id), foreign key(lot_id,organization_id) references public.field_lots(id,organization_id));
create table public.reception_weights(id uuid primary key, organization_id uuid not null references public.organizations(id), reception_id uuid not null, sequence integer not null check(sequence>0), kg numeric(14,2) not null check(kg>0), operator text not null check(length(trim(operator))>0), notes text not null default '', correction_reason text not null default '', status text not null default 'Activo' check(status in ('Activo','Cancelado')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id), unique(reception_id,sequence), foreign key(reception_id,organization_id) references public.receptions(id,organization_id));
create table public.classifications(id uuid primary key, organization_id uuid not null references public.organizations(id), reception_id uuid not null, approved_kg numeric(14,2) not null check(approved_kg>=0), rejected_kg numeric(14,2) not null check(rejected_kg>=0), approved_count integer check(approved_count>=0), rejected_count integer check(rejected_count>=0), reason text not null default '', size text not null default '', quality integer not null check(quality between 1 and 5), notes text not null default '', status text not null default 'Activo', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id), foreign key(reception_id,organization_id) references public.receptions(id,organization_id), check(rejected_kg=0 or length(trim(reason))>0));
create unique index classification_active on public.classifications(reception_id) where status<>'Cancelado';
create table public.pallets(id uuid primary key, organization_id uuid not null references public.organizations(id), code text not null, token uuid not null unique default gen_random_uuid(), destination text not null check(length(trim(destination))>0), assembled_at timestamptz not null, responsible text not null check(length(trim(responsible))>0), gross_kg numeric(14,2) not null, net_kg numeric(14,2) not null check(net_kg>0), fruit_count integer check(fruit_count>=0), notes text not null default '', status text not null default 'En armado' check(status in ('En armado','Etiquetado','Listo para carga','Expedido','Cancelado')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id), unique(organization_id,code), check(gross_kg>=net_kg));
create table public.pallet_items(id uuid primary key, organization_id uuid not null references public.organizations(id), pallet_id uuid not null, reception_id uuid not null, kg numeric(14,2) not null check(kg>0), status text not null default 'Activo', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id), unique(pallet_id,reception_id), foreign key(pallet_id,organization_id) references public.pallets(id,organization_id), foreign key(reception_id,organization_id) references public.receptions(id,organization_id));
create table public.shipments(id uuid primary key, organization_id uuid not null references public.organizations(id), destination text not null, country text not null, customer text not null default '', carrier text not null default '', driver text not null, plate text not null, departure date not null, responsible text not null, notes text not null default '', status text not null default 'Expedido', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id));
create table public.shipment_pallets(id uuid primary key, organization_id uuid not null references public.organizations(id), shipment_id uuid not null, pallet_id uuid not null unique, status text not null default 'Activo', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id), foreign key(shipment_id,organization_id) references public.shipments(id,organization_id), foreign key(pallet_id,organization_id) references public.pallets(id,organization_id));
create table public.attachments(id uuid primary key, organization_id uuid not null references public.organizations(id), entity_type text not null check(entity_type in ('receptions','pallets','shipments')), entity_id uuid not null, name text not null, mime text not null, size bigint not null check(size>0 and size<=10485760), storage_path text not null unique, status text not null default 'Activo', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), unique(id,organization_id));
create table public.audit_logs(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), entity_type text not null, entity_id uuid not null, action text not null, actor text not null, "before" jsonb, "after" jsonb, reason text not null default '', status text not null default 'Activo', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id));

do $$declare t text;begin
 foreach t in array array['organizations','profiles','producers','farms','plots','field_lots','receptions','reception_weights','classifications','pallets','pallet_items','shipments','shipment_pallets','attachments','audit_logs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 if t='organizations' then execute 'create policy organization_read on public.organizations for select to authenticated using(id=public.my_org())';
 elsif t='profiles' then execute 'create policy profile_read on public.profiles for select to authenticated using(user_id=auth.uid())';
 else execute format('create policy organization_read on public.%I for select to authenticated using(organization_id=public.my_org())',t);end if;
 if t not in ('organizations','profiles') then execute format('create index on public.%I(organization_id)',t);end if;
 end loop;end$$;

create function public.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
declare actor_name text;reason_text text;
begin
 select name into actor_name from public.profiles where user_id=auth.uid();
 reason_text=case when tg_table_name='reception_weights' then coalesce(to_jsonb(new)->>'correction_reason','') when tg_table_name='receptions' and new.status='Cancelado' then coalesce(to_jsonb(new)->>'notes','') else coalesce(current_setting('agronorte.correction_reason',true),'') end;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,actor,"before","after",reason,created_by)
 values(new.organization_id,tg_table_name,new.id,case when tg_op='INSERT' then 'Creación · ' else 'Actualización · ' end||tg_table_name,coalesce(actor_name,'Administrador del servidor'),case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),reason_text,auth.uid());
 return new;
end$$;
do $$declare t text;begin foreach t in array array['producers','farms','plots','field_lots','receptions','reception_weights','classifications','pallets','pallet_items','shipments','shipment_pallets','attachments'] loop execute format('create trigger audit_change after insert or update on public.%I for each row execute function public.audit_record()',t);end loop;end$$;

-- One atomic synchronization, guarded by an organization revision. No client DELETE grants.
create function public.sync_workspace(payload jsonb, expected_revision bigint) returns bigint language plpgsql security definer set search_path='' as $$
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
 if t='field_lots' and previous is null then row_value=jsonb_set(row_value,'{code}',to_jsonb('SAN-'||to_char(clock_timestamp() at time zone 'America/Asuncion','YYYYMMDD')||'-'||upper(substr(replace(row_id::text,'-',''),1,12))));end if;
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

create function public.public_pallet_trace(trace_token uuid) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('code',code,'product','Sandía','net_kg',net_kg,'destination',destination,'status',status) from public.pallets where token=trace_token and status<>'Cancelado'$$;
revoke all on function public.public_pallet_trace(uuid) from public;
grant execute on function public.public_pallet_trace(uuid) to anon,authenticated;
revoke all on function public.audit_record() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('attachments','attachments',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy attachment_read on storage.objects for select to authenticated using(bucket_id='attachments' and (storage.foldername(name))[1]=public.my_org()::text);
create policy attachment_insert on storage.objects for insert to authenticated with check(bucket_id='attachments' and (storage.foldername(name))[1]=public.my_org()::text and public.my_role() in ('administrador','gestor','recepcion','pesaje','packing'));
commit;
