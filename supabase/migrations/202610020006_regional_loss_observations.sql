-- Optional operational observations. Existing classifications remain immutable
-- and organization access/auditing continue through sync_workspace.
begin;
alter table public.classifications add column if not exists region text;
alter table public.classifications add column if not exists pest_observation text;
alter table public.classifications add column if not exists symptoms text;
comment on column public.classifications.pest_observation is 'Observed or suspected pest, not an automatic diagnosis';
commit;
