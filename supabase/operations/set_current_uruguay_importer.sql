-- GENERIC TEMPLATE: substitute verified {name,address,source} JSON.
-- Only current, open, unshipped Uruguay pallets; no future default.
-- Current cutoff: 07/10/2026 10:51:04 Paraguay (13:51:04 UTC).
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';
do $$begin
  if to_regclass('public.organizations') is null or to_regclass('public.pallets') is null
    or to_regclass('public.shipment_pallets') is null or to_regclass('public.audit_logs') is null then
    raise exception 'La base Sandía no existe en este proyecto. Abra znbtwkhktlldzhkiwodu.';
  end if;
  if to_regprocedure('public.sandia_features()') is null then raise exception 'Aplique primero la actualización de datos de importador.';end if;
  if coalesce(public.sandia_features()->>'label_importer_details','false')<>'true' then raise exception 'Aplique primero la actualización de datos de importador.';end if;
end$$;
do $importer$
declare
  org constant uuid='20000000-0000-4000-8000-000000000001';
  cutoff constant timestamptz='2026-10-07 13:51:04+00';
  details constant jsonb=$importer_details${}$importer_details$::jsonb;
  name_value text;address_value text;source_value text;existing_name text;existing_address text;
  item record;fields jsonb;new_fields jsonb;new_metadata jsonb;updated_count integer=0;
begin
  if not exists(select 1 from public.organizations where id=org and name='Cooperativa Agronorte') then raise exception 'Esta base no es la Cooperativa Agronorte autorizada.';end if;
  if jsonb_typeof(details) is distinct from 'object' or not(details ?& array['name','address','source'])
    or jsonb_typeof(details->'name') is distinct from 'string' or jsonb_typeof(details->'address') is distinct from 'string'
    or jsonb_typeof(details->'source') is distinct from 'string' then raise exception 'Confirme nombre, dirección y fuente del importador.';end if;
  name_value=trim(details->>'name');address_value=trim(details->>'address');source_value=trim(details->>'source');
  if length(name_value) not between 1 and 200 or length(address_value) not between 1 and 400 or length(source_value) not between 1 and 200 then raise exception 'Nombre, dirección o fuente del importador exceden los límites permitidos.';end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.pallets'::regclass
    and tgname='audit_change' and tgenabled in ('O','A') and not tgisinternal) then raise exception 'La auditoría de pallets debe estar activa.';end if;
  perform 1 from public.organizations where id=org for update;
  perform set_config('agronorte.correction_reason','Importador confirmado por el propietario en '||source_value||'; aplicado únicamente a pallets actuales en preparación para Uruguay, sin sustituir datos propios.',true);
  for item in select p.* from public.pallets p where p.organization_id=org and p.created_at<=cutoff
    and lower(trim(p.destination))='uruguay' and p.status in ('En armado','Etiquetado','Listo para carga')
    and not exists(select 1 from public.shipment_pallets sp where sp.pallet_id=p.id)
    order by p.id for update of p
  loop
    if item.metadata is not null and jsonb_typeof(item.metadata)<>'object' then raise exception 'Metadatos inválidos en pallet %. No se cambió ningún pallet.',item.code;end if;
    fields=coalesce(nullif(item.metadata->'export_label','null'::jsonb),'{}'::jsonb);
    if jsonb_typeof(fields)<>'object' then raise exception 'Datos de etiqueta inválidos en pallet %. No se cambió ningún pallet.',item.code;end if;
    if not agronorte_private.valid_export_label(fields) then raise exception 'Datos de etiqueta inválidos en pallet %. No se cambió ningún pallet.',item.code;end if;
    existing_name=nullif(trim(fields->>'importer_name'),'');existing_address=nullif(trim(fields->>'importer_address'),'');
    -- A partial personal pair is not completed with another buyer's details.
    if existing_name is not null and lower(existing_name)<>lower(name_value) then continue;end if;
    if existing_address is not null and lower(existing_address)<>lower(address_value) then continue;end if;
    new_fields=fields;
    if existing_name is null then new_fields=new_fields||jsonb_build_object('importer_name',name_value);end if;
    if existing_address is null then new_fields=new_fields||jsonb_build_object('importer_address',address_value);end if;
    new_metadata=coalesce(item.metadata,'{}'::jsonb)||jsonb_build_object('export_label',new_fields);
    if item.metadata is distinct from new_metadata then
      update public.pallets set metadata=new_metadata,status='En armado',updated_at=now() where id=item.id and organization_id=org;
      updated_count=updated_count+1;
    end if;
  end loop;
  if updated_count>0 then update public.organizations set revision=revision+1 where id=org;end if;
  perform set_config('agronorte.correction_reason','',true);
  raise notice 'Importador: % pallets actualizados. Datos propios, expedidos y futuros conservados; reimprima las etiquetas modificadas.',updated_count;
end
$importer$;
commit;

select p.code as pallet,p.destination as destino,p.status as estado,
  p.metadata#>>'{export_label,importer_name}' as importador,p.metadata#>>'{export_label,importer_address}' as direccion
from public.pallets p where p.organization_id='20000000-0000-4000-8000-000000000001'
order by p.created_at,p.code;
