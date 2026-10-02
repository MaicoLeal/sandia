-- Run manually in Supabase SQL Editor after creating the Auth user.
-- Replace the UUID with the real user ID from Authentication > Users.
-- Never run this template without replacing the placeholder.
begin;
insert into public.organizations (id,name) values ('20000000-0000-4000-8000-000000000001','Cooperativa Agronorte') on conflict(id) do nothing;
insert into public.profiles (organization_id,user_id,name,role)
values ('20000000-0000-4000-8000-000000000001','REPLACE_WITH_AUTH_USER_UUID','Administrador Agronorte','administrador');
commit;
