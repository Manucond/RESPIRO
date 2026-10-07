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
-- Tablas de la web (misma estructura que en producción)
create table public.businesses (id uuid primary key default gen_random_uuid(), auth_user_id uuid unique, business_name text not null default 'Negocio',
  business_type_key text, contact_name text not null default '', email text not null default '', phone text, created_at timestamptz not null default now(),
  stripe_customer_id text, stripe_subscription_id text, subscription_status text not null default 'none', privacy_accepted_at timestamptz);
create table public.business_services (id bigserial primary key, business_id uuid not null references public.businesses(id), service_name text not null,
  status text not null default 'active', created_at timestamptz not null default now(), cancelled_at timestamptz, health_status text not null default 'ok',
  last_checked_at timestamptz);
create table public.contact_requests (id bigserial primary key, name text not null default '', business_name text not null default '', email text not null default '',
  phone text, comment text, status text not null default 'new', created_at timestamptz not null default now(), privacy_accepted_at timestamptz);
create table public.admins (auth_user_id uuid primary key, name text);
create function public.is_admin(uid uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from admins where auth_user_id = uid) $$;
