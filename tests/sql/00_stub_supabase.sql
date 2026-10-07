-- Simula lo mínimo de Supabase para probar la migración en un Postgres limpio.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role postgres_test login;
grant usage on schema public to anon, authenticated, service_role;
create table public.businesses (id uuid primary key default gen_random_uuid(), business_name text);
