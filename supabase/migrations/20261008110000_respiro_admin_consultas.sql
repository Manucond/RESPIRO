-- =====================================================================
-- Modo RESPIRO del bot: los admins preguntan en lenguaje natural y Claude
-- genera una consulta SQL que se ejecuta con un rol de SOLO LECTURA que
-- únicamente ve las vistas de este esquema. Ninguna vista contiene datos de
-- pacientes (nombres, móviles) ni acciones pendientes del bot.
-- =====================================================================

create schema if not exists respiro_admin;
revoke all on schema respiro_admin from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'respiro_consultas') then
    create role respiro_consultas nologin;
  end if;
end $$;
grant respiro_consultas to postgres;
grant usage on schema respiro_admin to respiro_consultas;

-- Gasto de las consultas de admin (sin cliente)
alter table respiro.consumo_ia alter column cliente_id drop not null;

-- ---------------------------------------------------------------- vistas
create or replace view respiro_admin.clientes as
select c.id, c.nombre, c.tipo_negocio, c.activo, c.calendario_id is not null as calendario_conectado,
       c.modelo_ia, c.limite_ia_mensual_usd, c.valor_medio_cita, c.min_por_llamada, c.creado_en,
       b.business_name as negocio_web, b.email as email_web
from respiro.clientes c left join public.businesses b on b.id = c.business_id;

create or replace view respiro_admin.usuarios_bot as
select c.nombre as cliente, u.rol, u.nombre, u.activo, u.creado_en
from respiro.usuarios_bot u left join respiro.clientes c on c.id = u.cliente_id;

create or replace view respiro_admin.automatizaciones_activas as
select c.nombre as cliente, ca.clave as automatizacion, a.nombre as nombre_automatizacion, ca.activa, ca.desde
from respiro.clientes_automatizaciones ca
join respiro.clientes c on c.id = ca.cliente_id
join respiro.automatizaciones a on a.clave = ca.clave;

create or replace view respiro_admin.eventos as
select c.nombre as cliente, e.creado_en, e.automatizacion, e.tipo, e.resultado,
       e.metadatos->>'canal' as canal, e.metadatos->>'motivo' as motivo, e.metadatos->>'tipo_cita' as tipo_cita
from respiro.eventos_automatizacion e join respiro.clientes c on c.id = e.cliente_id;

create or replace view respiro_admin.consumo_ia as
select coalesce(c.nombre, 'RESPIRO (consultas de admin)') as cliente, ci.creado_en,
       case when ci.uso = 'transcripcion' then 'mistral' else 'claude' end as api,
       ci.uso, ci.modelo, ci.tokens_entrada, ci.tokens_salida, ci.tokens_cache_lect, ci.tokens_cache_escr,
       ci.coste_estimado_usd as coste_usd
from respiro.consumo_ia ci left join respiro.clientes c on c.id = ci.cliente_id;

create or replace view respiro_admin.invitaciones as
select c.nombre as cliente, i.rol, i.creado_en, i.caduca_en, i.usado_en is not null as usada, i.usado_en,
       case when i.creado_por is null then 'web o script' else 'bot' end as origen
from respiro.codigos_invitacion i join respiro.clientes c on c.id = i.cliente_id;

create or replace view respiro_admin.lista_espera as
select c.nombre as cliente, l.estado, count(*) as personas
from respiro.lista_espera l join respiro.clientes c on c.id = l.cliente_id
group by 1, 2;

create or replace view respiro_admin.negocios_web as
select b.business_name as negocio, b.business_type_key as tipo, b.contact_name as contacto, b.email, b.phone as telefono,
       b.subscription_status as suscripcion, b.created_at as creado_en,
       exists (select 1 from respiro.clientes c where c.business_id = b.id and c.activo and c.calendario_id is not null) as asistente_activo
from public.businesses b;

create or replace view respiro_admin.servicios_web as
select b.business_name as negocio, s.service_name as servicio, s.status as estado, s.health_status as salud,
       s.created_at as creado_en, s.cancelled_at as cancelado_en
from public.business_services s join public.businesses b on b.id = s.business_id;

create or replace view respiro_admin.solicitudes_contacto as
select r.name as nombre, r.business_name as negocio, r.email, r.phone as telefono, r.comment as comentario,
       r.status as estado, r.created_at as creado_en
from public.contact_requests r;

grant select on all tables in schema respiro_admin to respiro_consultas;

-- ---------------------------------------------------------------- ejecución
-- Se ejecuta como respiro_consultas (dueño de la función): solo SELECT sobre las vistas.
create or replace function respiro_admin.consultar(p_sql text)
returns jsonb language plpgsql security definer set search_path = respiro_admin, pg_catalog as $$
declare q text := regexp_replace(trim(coalesce(p_sql, '')), ';\s*$', ''); r jsonb;
begin
  if length(q) > 4000 or q !~* '^\s*(select|with)\s' or q ~ ';'
     or q ~* '\m(pg_sleep|lo_\w+|set_config|dblink\w*|copy|pg_read\w*|pg_ls\w*|pg_terminate\w*|pg_cancel\w*)\M' then
    raise exception 'solo se permiten consultas SELECT sobre las vistas de RESPIRO';
  end if;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) s limit 200) t', q) into r;
  return r;
end $$;

grant create on schema respiro_admin to respiro_consultas;
alter function respiro_admin.consultar(text) owner to respiro_consultas;
revoke create on schema respiro_admin from respiro_consultas;
revoke all on function respiro_admin.consultar(text) from public;
grant usage on schema respiro_admin to respiro_n8n;
grant execute on function respiro_admin.consultar(text) to respiro_n8n;

-- ---------------------------------------------------------------- memoria corta
-- Últimas preguntas de cada admin, para que entienda «¿y el mes pasado?».
create table if not exists respiro.admin_historial (
  id         bigint generated always as identity primary key,
  chat_id    bigint not null,
  pregunta   text not null check (length(pregunta) <= 1000),
  sql        text,
  creado_en  timestamptz not null default now()
);
create index if not exists admin_historial_chat on respiro.admin_historial (chat_id, creado_en desc);
alter table respiro.admin_historial enable row level security;
create policy n8n_todo on respiro.admin_historial for all to respiro_n8n using (true) with check (true);
grant select, insert, delete on respiro.admin_historial to respiro_n8n;

create or replace function respiro.admin_recordar(p_chat_id bigint, p_pregunta text, p_sql text)
returns integer language sql set search_path = '' as $$
  with ins as (insert into respiro.admin_historial (chat_id, pregunta, sql) values (p_chat_id, left(p_pregunta, 1000), p_sql) returning 1),
       del as (delete from respiro.admin_historial where chat_id = p_chat_id and creado_en < now() - interval '1 day' returning 1)
  select (select count(*) from ins)::integer;
$$;

create or replace function respiro.admin_historial_de(p_chat_id bigint)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('pregunta', pregunta, 'sql', sql) order by creado_en), '[]')
  from (select * from respiro.admin_historial where chat_id = p_chat_id and creado_en > now() - interval '2 hours'
        order by creado_en desc limit 3) h;
$$;

-- Volver al modo RESPIRO (dejar de "ser" un cliente)
create or replace function respiro.admin_salir_cliente(p_chat_id bigint)
returns boolean language sql set search_path = '' as $$
  with u as (update respiro.usuarios_bot set cliente_id = null where chat_id = p_chat_id and rol = 'admin' returning 1)
  select exists (select 1 from u);
$$;

-- registrar_consumo_ia admite cliente nulo (consultas de admin)
grant execute on function respiro.admin_recordar(bigint, text, text), respiro.admin_historial_de(bigint),
  respiro.admin_salir_cliente(bigint) to respiro_n8n;
revoke all on function respiro.admin_recordar(bigint, text, text), respiro.admin_historial_de(bigint),
  respiro.admin_salir_cliente(bigint) from public;
