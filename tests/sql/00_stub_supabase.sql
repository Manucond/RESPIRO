-- Simula lo mínimo de Supabase para probar las migraciones en un Postgres limpio.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role postgres_test login;
grant usage on schema public to anon, authenticated, service_role;
-- auth.uid() como en Supabase: sale del JWT de la petición (aquí, de un ajuste de sesión).
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.businesses (id uuid primary key default gen_random_uuid(), auth_user_id uuid unique, business_name text not null default 'Negocio',
  business_type_key text, contact_name text, email text);
create table public.admins (auth_user_id uuid primary key, name text);
create function public.is_admin(uid uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from admins where auth_user_id = uid) $$;
