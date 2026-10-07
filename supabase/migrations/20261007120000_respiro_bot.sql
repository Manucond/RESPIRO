-- =====================================================================
-- RESPIRO · Bot general de Telegram + Mini App
-- Esquema "respiro": configuración por cliente, usuarios del bot,
-- invitaciones, registro de eventos (informes), consumo de IA y
-- estado temporal de confirmaciones.
--
-- Modelo de seguridad
--  * El esquema "respiro" NO está expuesto por la API REST de Supabase.
--    anon/authenticated no tienen ningún permiso sobre él.
--  * RLS activo en todas las tablas.
--  * n8n entra con el rol "respiro_n8n" (solo este esquema, nada de public).
--  * La Mini App (Worker de Cloudflare) solo puede llamar a las funciones
--    public.miniapp_* con la clave de servicio. Esas funciones reciben el
--    user.id de Telegram YA VERIFICADO por el Worker, nunca un cliente_id,
--    y se ejecutan como "respiro_lector", un rol SIN bypass de RLS cuyas
--    políticas solo dejan ver filas del cliente resuelto a partir de ese
--    user.id. Aunque una consulta olvide el filtro, RLS no deja mezclar
--    datos entre negocios.
--  * Las tablas de informes no guardan nombres ni datos de salud.
-- =====================================================================

create schema if not exists respiro;
revoke all on schema respiro from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'respiro_lector') then
    create role respiro_lector nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'respiro_n8n') then
    -- La contraseña y LOGIN se activan en la puesta en marcha (fase 6).
    create role respiro_n8n nologin;
  end if;
end $$;
grant respiro_lector to postgres;   -- necesario para asignarle funciones
grant usage on schema respiro to respiro_lector, respiro_n8n;

-- ---------------------------------------------------------------------
-- Catálogo de automatizaciones (claves estables para informes)
-- ---------------------------------------------------------------------
create table respiro.automatizaciones (
  clave            text primary key check (clave ~ '^[a-z_]{3,40}$'),
  nombre           text not null,
  descripcion      text not null,
  -- Si una automatización activa no se ejecuta en este tiempo, semáforo ámbar.
  horas_alerta     integer not null default 48,
  orden            integer not null default 100
);

insert into respiro.automatizaciones (clave, nombre, descripcion, horas_alerta, orden) values
  ('bot_agenda',       'Asistente de agenda',      'Citas que apuntas, mueves o cancelas hablando con el asistente.', 168, 10),
  ('reserva_ia',       'Reservas automáticas',     'Citas que se reservan solas, sin que tengas que intervenir.',      72, 20),
  ('llamada_atendida', 'Llamadas atendidas',       'Llamadas que atiende el asistente de voz.',                       72, 30),
  ('recordatorio',     'Recordatorios',            'Recordatorios de cita enviados a tus clientes.',                  48, 40),
  ('confirmacion',     'Confirmaciones',           'Clientes que confirman su cita tras el recordatorio.',            72, 50),
  ('lista_espera',     'Lista de espera',          'Huecos libres rellenados con gente en lista de espera.',         336, 60),
  ('resena',           'Reseñas',                  'Peticiones de reseña enviadas tras la cita.',                    168, 70),
  ('informe_semanal',  'Informe semanal',          'Resumen que te llega cada lunes.',                               192, 90);

-- ---------------------------------------------------------------------
-- Clientes (negocios) y su configuración: la "CFG" única por cliente
-- ---------------------------------------------------------------------
create table respiro.clientes (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid unique references public.businesses(id) on delete set null,
  nombre               text not null check (length(nombre) between 2 and 120),
  tipo_negocio         text not null default 'clinica',
  zona_horaria         text not null default 'Europe/Madrid',
  -- Horario por día ISO (1 = lunes … 7 = domingo): lista de tramos [inicio, fin]
  horario              jsonb not null default '{"1":[["09:00","14:00"],["16:00","20:00"]],"2":[["09:00","14:00"],["16:00","20:00"]],"3":[["09:00","14:00"],["16:00","20:00"]],"4":[["09:00","14:00"],["16:00","20:00"]],"5":[["09:00","14:00"]]}',
  -- Tipos GENÉRICOS de cita (nunca el tratamiento concreto). codigo va en el título del evento.
  tipos_cita           jsonb not null default '[{"codigo":"REV","nombre":"revisión","min":30},{"codigo":"LIM","nombre":"limpieza","min":45},{"codigo":"OTRO","nombre":"otro","min":30}]',
  calendario_id        text,
  -- Horario de silencio: lo que se mande al cliente en este tramo se aplaza.
  silencio_inicio      time not null default '21:00',
  silencio_fin         time not null default '08:30',
  -- Parámetros del ahorro estimado (editables por el dueño desde la Mini App)
  min_por_llamada      numeric(5,1) not null default 3   check (min_por_llamada between 0 and 60),
  min_por_reserva      numeric(5,1) not null default 3   check (min_por_reserva between 0 and 60),
  min_por_mensaje      numeric(5,1) not null default 1   check (min_por_mensaje between 0 and 30),
  coste_hora_personal  numeric(7,2) not null default 12  check (coste_hora_personal between 0 and 200),
  valor_medio_cita     numeric(8,2) not null default 40  check (valor_medio_cita between 0 and 5000),
  -- IA
  modelo_ia            text not null default 'claude-haiku-4-5'
                       check (modelo_ia in ('claude-haiku-4-5','claude-haiku-4-5-20251001','claude-sonnet-5-5')),
  limite_ia_mensual_usd numeric(8,2) not null default 5,
  activo               boolean not null default true,
  creado_en            timestamptz not null default now()
);

create table respiro.clientes_automatizaciones (
  cliente_id   uuid not null references respiro.clientes(id) on delete cascade,
  clave        text not null references respiro.automatizaciones(clave),
  activa       boolean not null default true,
  desde        date not null default current_date,
  primary key (cliente_id, clave)
);

-- ---------------------------------------------------------------------
-- Usuarios del bot e invitaciones
-- ---------------------------------------------------------------------
create table respiro.usuarios_bot (
  chat_id            bigint primary key,           -- chat privado = user.id de Telegram
  telegram_user_id   bigint not null unique,
  cliente_id         uuid references respiro.clientes(id) on delete cascade,  -- null solo para admin sin cliente elegido
  rol                text not null check (rol in ('dueno','personal','admin')),
  nombre             text not null default '' check (length(nombre) <= 80),
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  check (rol = 'admin' or cliente_id is not null)
);
create index on respiro.usuarios_bot (cliente_id);

create table respiro.codigos_invitacion (
  codigo        text primary key check (codigo ~ '^[a-f0-9]{32}$'),
  cliente_id    uuid not null references respiro.clientes(id) on delete cascade,
  rol           text not null check (rol in ('dueno','personal')),
  creado_por    bigint,                              -- chat_id de quien la generó (null = script)
  creado_en     timestamptz not null default now(),
  caduca_en     timestamptz not null default now() + interval '48 hours',
  usado_en      timestamptz,
  usado_por     bigint
);
create index on respiro.codigos_invitacion (cliente_id);

-- ---------------------------------------------------------------------
-- Deduplicación de entradas (update de Telegram, callback, webhook…)
-- ---------------------------------------------------------------------
create table respiro.processed_events (
  id          text primary key check (length(id) <= 200),   -- p. ej. 'tg:u:123456789'
  fuente      text not null,
  cliente_id  uuid references respiro.clientes(id) on delete cascade,
  creado_en   timestamptz not null default now()
);
create index on respiro.processed_events (creado_en);

-- ---------------------------------------------------------------------
-- Registro de eventos: base de los informes. SIN datos personales.
-- ---------------------------------------------------------------------
create or replace function respiro.metadatos_seguros(m jsonb) returns boolean
language sql immutable as $$
  -- Solo claves de una lista cerrada y valores escalares cortos:
  -- impide colar nombres, móviles o textos libres en los informes.
  select jsonb_typeof(m) = 'object'
     and not exists (
       select 1 from jsonb_each(m) e
       where e.key not in ('canal','origen','motivo','tipo_cita','n_acciones','duracion_ms','modelo','reintento','fuente')
          or jsonb_typeof(e.value) not in ('string','number','boolean','null')
          or (jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 40)
     );
$$;

create table respiro.eventos_automatizacion (
  id               bigint generated always as identity primary key,
  cliente_id       uuid not null references respiro.clientes(id) on delete cascade,
  automatizacion   text not null references respiro.automatizaciones(clave),
  tipo             text not null check (tipo ~ '^[a-z_]{2,30}$'),
  resultado        text not null check (resultado in ('ok','error','omitido')),
  evento_origen    text unique,          -- id de processed_events (+ sufijo): evita duplicados
  creado_en        timestamptz not null default now(),
  metadatos        jsonb not null default '{}' check (respiro.metadatos_seguros(metadatos))
);
create index on respiro.eventos_automatizacion (cliente_id, creado_en desc);
create index on respiro.eventos_automatizacion (cliente_id, automatizacion, creado_en desc);

-- ---------------------------------------------------------------------
-- Consumo de IA
-- ---------------------------------------------------------------------
create table respiro.precios_modelo (
  modelo                text primary key,
  usd_mtok_entrada      numeric(8,4) not null,
  usd_mtok_salida       numeric(8,4) not null,
  usd_mtok_cache_lect   numeric(8,4) not null,
  usd_mtok_cache_escr   numeric(8,4) not null
);
-- Precios de la API de Anthropic (oct 2026). Caché: lectura ~0,1x, escritura 1,25x (TTL 5 min).
insert into respiro.precios_modelo values
  ('claude-haiku-4-5',          1.00,  5.00, 0.10, 1.25),
  ('claude-haiku-4-5-20251001', 1.00,  5.00, 0.10, 1.25),
  ('claude-sonnet-5-5',         2.00, 10.00, 0.20, 2.50);

create table respiro.consumo_ia (
  id                 bigint generated always as identity primary key,
  cliente_id         uuid not null references respiro.clientes(id) on delete cascade,
  creado_en          timestamptz not null default now(),
  modelo             text not null,
  uso                text not null default 'acciones',      -- acciones | transcripcion
  tokens_entrada     integer not null default 0,
  tokens_salida      integer not null default 0,
  tokens_cache_lect  integer not null default 0,
  tokens_cache_escr  integer not null default 0,
  coste_estimado_usd numeric(10,6) not null default 0
);
create index on respiro.consumo_ia (cliente_id, creado_en desc);

-- ---------------------------------------------------------------------
-- Estado temporal del bot: acciones a la espera de "Sí / No".
-- Contiene nombres de pacientes (dato operativo): se borra a las 24 h.
-- ---------------------------------------------------------------------
create table respiro.bot_pendientes (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references respiro.clientes(id) on delete cascade,
  chat_id      bigint not null,
  acciones     jsonb not null,
  estado       text not null default 'pendiente' check (estado in ('pendiente','confirmado','cancelado','caducado','esperando_dato')),
  pregunta     jsonb,                 -- dato que falta (móvil, apellido…) si estado = esperando_dato
  mensaje_id   bigint,
  creado_en    timestamptz not null default now(),
  caduca_en    timestamptz not null default now() + interval '30 minutes'
);
create index on respiro.bot_pendientes (chat_id, estado);

-- ---------------------------------------------------------------------
-- Lista de espera (dato operativo del negocio)
-- ---------------------------------------------------------------------
create table respiro.lista_espera (
  id           bigint generated always as identity primary key,
  cliente_id   uuid not null references respiro.clientes(id) on delete cascade,
  nombre       text not null check (length(nombre) between 1 and 80),
  movil        text check (movil ~ '^\+?[0-9]{9,15}$'),
  tipo_cita    text not null,
  preferencia  text check (length(preferencia) <= 120),
  estado       text not null default 'esperando' check (estado in ('esperando','avisado','reservado','retirado')),
  creado_en    timestamptz not null default now()
);
create index on respiro.lista_espera (cliente_id, estado);

-- =====================================================================
-- RLS
-- =====================================================================
alter table respiro.automatizaciones           enable row level security;
alter table respiro.clientes                   enable row level security;
alter table respiro.clientes_automatizaciones  enable row level security;
alter table respiro.usuarios_bot               enable row level security;
alter table respiro.codigos_invitacion         enable row level security;
alter table respiro.processed_events           enable row level security;
alter table respiro.eventos_automatizacion     enable row level security;
alter table respiro.precios_modelo             enable row level security;
alter table respiro.consumo_ia                 enable row level security;
alter table respiro.bot_pendientes             enable row level security;
alter table respiro.lista_espera               enable row level security;

-- Identidad de la sesión de la Mini App (la fijan las funciones miniapp_*)
create or replace function respiro.tg_actual() returns bigint
language sql stable as $$ select nullif(current_setting('respiro.tg_user_id', true), '')::bigint $$;
create or replace function respiro.cliente_actual() returns uuid
language sql stable as $$ select nullif(current_setting('respiro.cliente_id', true), '')::uuid $$;

-- --- respiro_lector: solo lo de SU cliente ---------------------------
grant select on respiro.automatizaciones, respiro.precios_modelo to respiro_lector;
grant select on respiro.clientes, respiro.clientes_automatizaciones, respiro.usuarios_bot,
               respiro.eventos_automatizacion, respiro.lista_espera to respiro_lector;
grant update (min_por_llamada, min_por_reserva, min_por_mensaje, coste_hora_personal, valor_medio_cita)
  on respiro.clientes to respiro_lector;
grant select, insert on respiro.codigos_invitacion to respiro_lector;

create policy lector_catalogo on respiro.automatizaciones for select to respiro_lector using (true);
create policy lector_precios  on respiro.precios_modelo   for select to respiro_lector using (true);
create policy lector_yo on respiro.usuarios_bot for select to respiro_lector
  using (telegram_user_id = respiro.tg_actual() or cliente_id = respiro.cliente_actual());
create policy lector_cliente on respiro.clientes for select to respiro_lector
  using (id = respiro.cliente_actual());
create policy lector_cliente_upd on respiro.clientes for update to respiro_lector
  using (id = respiro.cliente_actual()) with check (id = respiro.cliente_actual());
create policy lector_autos on respiro.clientes_automatizaciones for select to respiro_lector
  using (cliente_id = respiro.cliente_actual());
create policy lector_eventos on respiro.eventos_automatizacion for select to respiro_lector
  using (cliente_id = respiro.cliente_actual());
create policy lector_espera on respiro.lista_espera for select to respiro_lector
  using (cliente_id = respiro.cliente_actual());
create policy lector_codigos_sel on respiro.codigos_invitacion for select to respiro_lector
  using (cliente_id = respiro.cliente_actual());
create policy lector_codigos_ins on respiro.codigos_invitacion for insert to respiro_lector
  with check (cliente_id = respiro.cliente_actual() and rol = 'personal');

-- --- respiro_n8n: el motor del bot, acceso operativo a este esquema ---
grant select, insert, update, delete on all tables in schema respiro to respiro_n8n;
grant usage on all sequences in schema respiro to respiro_n8n;
do $$
declare t text;
begin
  foreach t in array array['automatizaciones','clientes','clientes_automatizaciones','usuarios_bot',
    'codigos_invitacion','processed_events','eventos_automatizacion','precios_modelo',
    'consumo_ia','bot_pendientes','lista_espera'] loop
    execute format('create policy n8n_todo on respiro.%I for all to respiro_n8n using (true) with check (true)', t);
  end loop;
end $$;

-- =====================================================================
-- Funciones de negocio (las usa n8n)
-- =====================================================================

-- Deduplicación: true si es la primera vez que vemos este id.
create or replace function respiro.dedupe(p_id text, p_fuente text, p_cliente uuid default null)
returns boolean language sql as $$
  with ins as (
    insert into respiro.processed_events (id, fuente, cliente_id)
    values (p_id, p_fuente, p_cliente)
    on conflict (id) do nothing
    returning 1)
  select exists (select 1 from ins);
$$;

-- Log único de automatizaciones. Idempotente por p_origen.
create or replace function respiro.log_evento(
  p_cliente uuid, p_automatizacion text, p_tipo text, p_resultado text,
  p_origen text default null, p_metadatos jsonb default '{}')
returns boolean language sql as $$
  with ins as (
    insert into respiro.eventos_automatizacion (cliente_id, automatizacion, tipo, resultado, evento_origen, metadatos)
    values (p_cliente, p_automatizacion, p_tipo, p_resultado, p_origen, coalesce(p_metadatos, '{}'))
    on conflict (evento_origen) do nothing
    returning 1)
  select exists (select 1 from ins);
$$;

-- Configuración + rol del chat. Devuelve null si el chat no tiene acceso.
create or replace function respiro.auth_chat(p_chat_id bigint)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'chat_id', u.chat_id, 'rol', u.rol, 'nombre_usuario', u.nombre,
    'cliente_id', c.id, 'cliente', c.nombre, 'tipo_negocio', c.tipo_negocio,
    'zona_horaria', c.zona_horaria, 'horario', c.horario, 'tipos_cita', c.tipos_cita,
    'calendario_id', c.calendario_id, 'modelo_ia', c.modelo_ia,
    'silencio_inicio', c.silencio_inicio, 'silencio_fin', c.silencio_fin,
    'gasto_ia_mes_usd', coalesce((select sum(coste_estimado_usd) from respiro.consumo_ia ci
                                  where ci.cliente_id = c.id
                                    and ci.creado_en >= date_trunc('month', now() at time zone c.zona_horaria) at time zone c.zona_horaria), 0),
    'limite_ia_mensual_usd', c.limite_ia_mensual_usd,
    'automatizaciones', coalesce((select jsonb_agg(ca.clave) from respiro.clientes_automatizaciones ca
                                  where ca.cliente_id = c.id and ca.activa), '[]'))
  from respiro.usuarios_bot u
  left join respiro.clientes c on c.id = u.cliente_id and c.activo
  where u.chat_id = p_chat_id and u.activo
    and (u.rol = 'admin' or c.id is not null);
$$;

-- Genera una invitación de un solo uso.
create or replace function respiro.crear_invitacion(
  p_cliente uuid, p_rol text, p_creado_por bigint default null, p_horas integer default 48)
returns text language plpgsql as $$
declare v text := replace(gen_random_uuid()::text, '-', '');
begin
  if p_horas not between 1 and 168 then raise exception 'caducidad no válida'; end if;
  insert into respiro.codigos_invitacion (codigo, cliente_id, rol, creado_por, caduca_en)
  values (v, p_cliente, p_rol, p_creado_por, now() + make_interval(hours => p_horas));
  return v;
end $$;

-- Canjea una invitación (atómico). Devuelve {ok, motivo, cliente, rol}.
create or replace function respiro.canjear_invitacion(
  p_codigo text, p_chat_id bigint, p_user_id bigint, p_nombre text)
returns jsonb language plpgsql as $$
declare inv respiro.codigos_invitacion; v_cliente text; v_actual respiro.usuarios_bot;
begin
  if p_codigo !~ '^[a-f0-9]{32}$' then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;
  select * into v_actual from respiro.usuarios_bot where chat_id = p_chat_id and activo;
  if found and v_actual.rol = 'admin' then
    return jsonb_build_object('ok', false, 'motivo', 'es_admin');
  end if;

  update respiro.codigos_invitacion
     set usado_en = now(), usado_por = p_chat_id
   where codigo = p_codigo and usado_en is null and caduca_en > now()
  returning * into inv;

  if not found then
    return jsonb_build_object('ok', false, 'motivo',
      case when exists (select 1 from respiro.codigos_invitacion where codigo = p_codigo and usado_en is not null) then 'usado'
           when exists (select 1 from respiro.codigos_invitacion where codigo = p_codigo) then 'caducado'
           else 'no_existe' end);
  end if;

  insert into respiro.usuarios_bot (chat_id, telegram_user_id, cliente_id, rol, nombre)
  values (p_chat_id, p_user_id, inv.cliente_id, inv.rol, left(coalesce(p_nombre, ''), 80))
  on conflict (chat_id) do update
     set cliente_id = excluded.cliente_id, rol = excluded.rol, nombre = excluded.nombre, activo = true;

  select nombre into v_cliente from respiro.clientes where id = inv.cliente_id;
  return jsonb_build_object('ok', true, 'cliente', v_cliente, 'rol', inv.rol, 'cliente_id', inv.cliente_id);
end $$;

-- Admin: cambiar de cliente para depurar (p_cliente puede ser id o parte del nombre).
create or replace function respiro.admin_cambiar_cliente(p_chat_id bigint, p_cliente text)
returns jsonb language plpgsql as $$
declare v respiro.clientes; n integer;
begin
  if not exists (select 1 from respiro.usuarios_bot where chat_id = p_chat_id and rol = 'admin' and activo) then
    return jsonb_build_object('ok', false, 'motivo', 'no_admin');
  end if;
  select count(*) into n from respiro.clientes
   where activo and (id::text = p_cliente or nombre ilike '%' || p_cliente || '%');
  if n <> 1 then return jsonb_build_object('ok', false, 'motivo', case when n = 0 then 'no_existe' else 'ambiguo' end); end if;
  select * into v from respiro.clientes where activo and (id::text = p_cliente or nombre ilike '%' || p_cliente || '%');
  update respiro.usuarios_bot set cliente_id = v.id where chat_id = p_chat_id;
  return jsonb_build_object('ok', true, 'cliente', v.nombre, 'cliente_id', v.id);
end $$;

-- Registra consumo de IA calculando el coste con la tabla de precios.
create or replace function respiro.registrar_consumo_ia(
  p_cliente uuid, p_modelo text, p_entrada integer, p_salida integer,
  p_cache_lect integer default 0, p_cache_escr integer default 0, p_uso text default 'acciones')
returns numeric language sql as $$
  insert into respiro.consumo_ia (cliente_id, modelo, uso, tokens_entrada, tokens_salida, tokens_cache_lect, tokens_cache_escr, coste_estimado_usd)
  select p_cliente, p_modelo, p_uso, p_entrada, p_salida, p_cache_lect, p_cache_escr,
         coalesce((p_entrada * p.usd_mtok_entrada + p_salida * p.usd_mtok_salida
                 + p_cache_lect * p.usd_mtok_cache_lect + p_cache_escr * p.usd_mtok_cache_escr) / 1e6, 0)
  from (select 1) x left join respiro.precios_modelo p on p.modelo = p_modelo
  returning coste_estimado_usd;
$$;

-- Limpieza diaria (la llama un cron de n8n).
create or replace function respiro.limpieza() returns jsonb language plpgsql as $$
declare a integer; b integer; c integer;
begin
  delete from respiro.bot_pendientes where creado_en < now() - interval '24 hours'; get diagnostics a = row_count;
  update respiro.bot_pendientes set estado = 'caducado' where estado in ('pendiente','esperando_dato') and caduca_en < now();
  delete from respiro.processed_events where creado_en < now() - interval '30 days'; get diagnostics b = row_count;
  delete from respiro.codigos_invitacion where caduca_en < now() - interval '30 days'; get diagnostics c = row_count;
  return jsonb_build_object('pendientes', a, 'eventos_dedupe', b, 'codigos', c);
end $$;

-- =====================================================================
-- Informes agregados (los usan la Mini App y el informe semanal)
-- =====================================================================
create or replace view respiro.v_eventos_diarios with (security_invoker = true) as
select e.cliente_id,
       (e.creado_en at time zone c.zona_horaria)::date as dia,
       e.automatizacion, e.tipo,
       count(*) filter (where resultado = 'ok')      as ok,
       count(*) filter (where resultado = 'error')   as error,
       count(*) filter (where resultado = 'omitido') as omitido
from respiro.eventos_automatizacion e
join respiro.clientes c on c.id = e.cliente_id
group by 1, 2, 3, 4;
grant select on respiro.v_eventos_diarios to respiro_lector, respiro_n8n;

-- Informe completo de un cliente. Se usa desde respiro_lector (Mini App,
-- filtrado además por RLS) y desde n8n (informe semanal).
create or replace function respiro.informe(p_cliente uuid, p_hoy date default null)
returns jsonb language plpgsql stable as $$
declare
  c respiro.clientes;
  hoy date; ini_mes date; ini_mes_ant date;
  mes jsonb; mes_ant jsonb; semanas jsonb; estado jsonb;
  m_llamadas numeric; m_reservas numeric; m_mensajes numeric; m_huecos numeric;
begin
  select * into c from respiro.clientes where id = p_cliente;
  if not found then return null; end if;
  hoy := coalesce(p_hoy, (now() at time zone c.zona_horaria)::date);
  ini_mes := date_trunc('month', hoy)::date;
  ini_mes_ant := (ini_mes - interval '1 month')::date;

  -- Métricas: solo resultados ok. Cada métrica mapea a (automatizacion, tipo).
  select jsonb_build_object(
    'llamadas_atendidas',   coalesce(sum(ok) filter (where automatizacion = 'llamada_atendida'), 0),
    'citas_sin_intervencion', coalesce(sum(ok) filter (where automatizacion = 'reserva_ia'), 0),
    'citas_por_asistente',  coalesce(sum(ok) filter (where automatizacion = 'bot_agenda' and tipo in ('crear','mover','cancelar')), 0),
    'recordatorios',        coalesce(sum(ok) filter (where automatizacion = 'recordatorio'), 0),
    'confirmaciones',       coalesce(sum(ok) filter (where automatizacion = 'confirmacion'), 0),
    'huecos_rellenados',    coalesce(sum(ok) filter (where automatizacion = 'lista_espera' and tipo = 'hueco_rellenado'), 0),
    'resenas_pedidas',      coalesce(sum(ok) filter (where automatizacion = 'resena'), 0),
    'errores',              coalesce(sum(error), 0))
  into mes
  from respiro.v_eventos_diarios where cliente_id = p_cliente and dia between ini_mes and hoy;

  -- Mes anterior hasta el mismo día del mes (comparación justa)
  select jsonb_build_object(
    'llamadas_atendidas',   coalesce(sum(ok) filter (where automatizacion = 'llamada_atendida'), 0),
    'citas_sin_intervencion', coalesce(sum(ok) filter (where automatizacion = 'reserva_ia'), 0),
    'citas_por_asistente',  coalesce(sum(ok) filter (where automatizacion = 'bot_agenda' and tipo in ('crear','mover','cancelar')), 0),
    'recordatorios',        coalesce(sum(ok) filter (where automatizacion = 'recordatorio'), 0),
    'confirmaciones',       coalesce(sum(ok) filter (where automatizacion = 'confirmacion'), 0),
    'huecos_rellenados',    coalesce(sum(ok) filter (where automatizacion = 'lista_espera' and tipo = 'hueco_rellenado'), 0),
    'resenas_pedidas',      coalesce(sum(ok) filter (where automatizacion = 'resena'), 0),
    'errores',              coalesce(sum(error), 0))
  into mes_ant
  from respiro.v_eventos_diarios
  where cliente_id = p_cliente
    and dia between ini_mes_ant and least((ini_mes - 1), (ini_mes_ant + (hoy - ini_mes)));

  -- Últimas 8 semanas (lunes a domingo), total de ejecuciones correctas
  select coalesce(jsonb_agg(jsonb_build_object('semana', s.lunes, 'ok', coalesce(t.ok, 0)) order by s.lunes), '[]')
  into semanas
  from (select (date_trunc('week', hoy) - make_interval(weeks => g))::date as lunes from generate_series(0, 7) g) s
  left join lateral (
    select sum(ok) as ok from respiro.v_eventos_diarios
    where cliente_id = p_cliente and dia between s.lunes and s.lunes + 6) t on true;

  -- Estado por automatización activa: última ejecución y semáforo
  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', a.clave, 'nombre', a.nombre, 'descripcion', a.descripcion,
           'ultima', u.ultima, 'errores_24h', coalesce(u.err24, 0),
           'semaforo', case
              when coalesce(u.err24, 0) > 0 and coalesce(u.ok24, 0) = 0 then 'rojo'
              when u.ultima is null and ca.desde > hoy - 2 then 'verde'      -- recién activada
              when u.ultima is null or u.ultima < now() - make_interval(hours => a.horas_alerta) then 'ambar'
              when coalesce(u.err24, 0) > 0 then 'ambar'
              else 'verde' end)
         order by a.orden), '[]')
  into estado
  from respiro.clientes_automatizaciones ca
  join respiro.automatizaciones a on a.clave = ca.clave
  left join lateral (
    select max(creado_en) as ultima,
           count(*) filter (where resultado = 'error' and creado_en > now() - interval '24 hours') as err24,
           count(*) filter (where resultado = 'ok' and creado_en > now() - interval '24 hours') as ok24
    from respiro.eventos_automatizacion e
    where e.cliente_id = p_cliente and e.automatizacion = ca.clave) u on true
  where ca.cliente_id = p_cliente and ca.activa;

  -- Ahorro ESTIMADO con los parámetros del cliente
  m_llamadas := (mes->>'llamadas_atendidas')::numeric;
  m_reservas := (mes->>'citas_sin_intervencion')::numeric + (mes->>'citas_por_asistente')::numeric;
  m_mensajes := (mes->>'recordatorios')::numeric + (mes->>'resenas_pedidas')::numeric;
  m_huecos   := (mes->>'huecos_rellenados')::numeric;

  return jsonb_build_object(
    'cliente', c.nombre,
    'hoy', hoy,
    'mes', mes,
    'mes_anterior', mes_ant,
    'semanas', semanas,
    'estado', estado,
    'todo_en_marcha', not exists (select 1 from jsonb_array_elements(estado) x where x->>'semaforo' <> 'verde'),
    'parametros', jsonb_build_object(
       'min_por_llamada', c.min_por_llamada, 'min_por_reserva', c.min_por_reserva,
       'min_por_mensaje', c.min_por_mensaje, 'coste_hora_personal', c.coste_hora_personal,
       'valor_medio_cita', c.valor_medio_cita),
    'ahorro_estimado', jsonb_build_object(
       'es_estimacion', true,
       'horas', round((m_llamadas * c.min_por_llamada + m_reservas * c.min_por_reserva + m_mensajes * c.min_por_mensaje) / 60.0, 1),
       'euros_tiempo', round((m_llamadas * c.min_por_llamada + m_reservas * c.min_por_reserva + m_mensajes * c.min_por_mensaje) / 60.0 * c.coste_hora_personal, 0),
       'euros_huecos', round(m_huecos * c.valor_medio_cita, 0)));
end $$;
grant execute on function respiro.informe(uuid, date) to respiro_lector, respiro_n8n;

-- =====================================================================
-- API de la Mini App (public.miniapp_*). Solo service_role puede llamarlas.
-- p_tg_user_id llega del Worker tras verificar initData con HMAC.
-- Se ejecutan como respiro_lector => RLS por cliente siempre activo.
-- =====================================================================
create or replace function respiro.fijar_identidad(p_tg_user_id bigint)
returns respiro.usuarios_bot language plpgsql as $$
declare u respiro.usuarios_bot;
begin
  perform set_config('respiro.cliente_id', '', true);
  perform set_config('respiro.tg_user_id', p_tg_user_id::text, true);
  select * into u from respiro.usuarios_bot where telegram_user_id = p_tg_user_id and activo;
  if not found or u.cliente_id is null then
    raise exception 'sin_acceso' using errcode = '42501';
  end if;
  perform set_config('respiro.cliente_id', u.cliente_id::text, true);
  return u;
end $$;
grant execute on function respiro.fijar_identidad(bigint) to respiro_lector;

create or replace function public.miniapp_resumen(p_tg_user_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u respiro.usuarios_bot;
begin
  u := respiro.fijar_identidad(p_tg_user_id);
  return jsonb_build_object(
    'usuario', jsonb_build_object('nombre', u.nombre, 'rol', u.rol),
    'cliente_id', u.cliente_id,
    'tipos_cita', (select tipos_cita from respiro.clientes where id = u.cliente_id),
    'informe', respiro.informe(u.cliente_id));
end $$;

create or replace function public.miniapp_guardar_parametros(p_tg_user_id bigint, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u respiro.usuarios_bot;
begin
  u := respiro.fijar_identidad(p_tg_user_id);
  if u.rol not in ('dueno','admin') then raise exception 'solo_dueno' using errcode = '42501'; end if;
  update respiro.clientes set
    min_por_llamada     = coalesce((p->>'min_por_llamada')::numeric, min_por_llamada),
    min_por_reserva     = coalesce((p->>'min_por_reserva')::numeric, min_por_reserva),
    min_por_mensaje     = coalesce((p->>'min_por_mensaje')::numeric, min_por_mensaje),
    coste_hora_personal = coalesce((p->>'coste_hora_personal')::numeric, coste_hora_personal),
    valor_medio_cita    = coalesce((p->>'valor_medio_cita')::numeric, valor_medio_cita)
  where id = u.cliente_id;
  return respiro.informe(u.cliente_id);
end $$;

create or replace function public.miniapp_invitar(p_tg_user_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u respiro.usuarios_bot; v text := replace(gen_random_uuid()::text, '-', '');
begin
  u := respiro.fijar_identidad(p_tg_user_id);
  if u.rol not in ('dueno','admin') then raise exception 'solo_dueno' using errcode = '42501'; end if;
  insert into respiro.codigos_invitacion (codigo, cliente_id, rol, creado_por)
  values (v, u.cliente_id, 'personal', u.chat_id);
  return jsonb_build_object('codigo', v, 'caduca_en', now() + interval '48 hours');
end $$;

create or replace function public.miniapp_equipo(p_tg_user_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u respiro.usuarios_bot;
begin
  u := respiro.fijar_identidad(p_tg_user_id);
  if u.rol not in ('dueno','admin') then raise exception 'solo_dueno' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'rol', rol, 'desde', creado_en::date) order by creado_en)
                   from respiro.usuarios_bot where cliente_id = u.cliente_id and activo and rol <> 'admin'), '[]');
end $$;

create or replace function public.miniapp_lista_espera(p_tg_user_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u respiro.usuarios_bot;
begin
  u := respiro.fijar_identidad(p_tg_user_id);
  return coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'tipo', tipo_cita, 'preferencia', preferencia, 'desde', creado_en::date) order by creado_en)
                   from respiro.lista_espera where cliente_id = u.cliente_id and estado = 'esperando'), '[]');
end $$;

-- Ejecutarse como respiro_lector (sin bypass de RLS) y solo para service_role.
-- Para cambiar el dueño hace falta CREATE en el esquema; se concede y se retira.
grant create on schema public to respiro_lector;
do $$
declare f text;
begin
  foreach f in array array['miniapp_resumen(bigint)','miniapp_guardar_parametros(bigint, jsonb)',
                           'miniapp_invitar(bigint)','miniapp_equipo(bigint)','miniapp_lista_espera(bigint)'] loop
    execute format('alter function public.%s owner to respiro_lector', f);
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke create on schema public from respiro_lector;
grant usage on schema public to respiro_lector;

-- Funciones de n8n: solo respiro_n8n
revoke all on all functions in schema respiro from public;
grant execute on all functions in schema respiro to respiro_n8n;
grant execute on function respiro.tg_actual(), respiro.cliente_actual(), respiro.metadatos_seguros(jsonb),
                          respiro.fijar_identidad(bigint), respiro.informe(uuid, date) to respiro_lector;
