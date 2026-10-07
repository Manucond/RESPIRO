-- =====================================================================
-- RESPIRO · Funciones auxiliares para los flujos de n8n del bot
-- =====================================================================

-- Tipos genéricos con códigos que también reconoce el núcleo dental
-- (sus palabras clave: REVISION, LIMPIEZA, PRIMERA, CITA…).
alter table respiro.clientes alter column tipos_cita set default
  '[{"codigo":"REVISION","nombre":"revisión","min":30},
    {"codigo":"LIMPIEZA","nombre":"limpieza","min":45},
    {"codigo":"PRIMERA","nombre":"primera visita","min":30},
    {"codigo":"OTRO","nombre":"otro","min":30}]';
update respiro.clientes set tipos_cita = default
 where tipos_cita @> '[{"codigo":"REV"}]';

-- Configuración de un cliente por id (Mini App vía n8n, informe semanal).
create or replace function respiro.cfg_cliente(p_cliente uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'cliente_id', c.id, 'cliente', c.nombre, 'tipo_negocio', c.tipo_negocio,
    'zona_horaria', c.zona_horaria, 'horario', c.horario, 'tipos_cita', c.tipos_cita,
    'calendario_id', c.calendario_id, 'modelo_ia', c.modelo_ia,
    'silencio_inicio', c.silencio_inicio, 'silencio_fin', c.silencio_fin)
  from respiro.clientes c where c.id = p_cliente and c.activo;
$$;

-- /invitar <cliente> <rol> para admins (cliente por id o parte del nombre).
create or replace function respiro.admin_invitar(p_chat_id bigint, p_cliente text, p_rol text)
returns jsonb language plpgsql set search_path = '' as $$
declare v respiro.clientes; n integer; cod text;
begin
  if not exists (select 1 from respiro.usuarios_bot where chat_id = p_chat_id and rol = 'admin' and activo) then
    return jsonb_build_object('ok', false, 'motivo', 'no_admin');
  end if;
  if p_rol not in ('dueno','personal') then return jsonb_build_object('ok', false, 'motivo', 'rol'); end if;
  select count(*) into n from respiro.clientes
   where activo and (id::text = p_cliente or nombre ilike '%' || p_cliente || '%');
  if n <> 1 then return jsonb_build_object('ok', false, 'motivo', case when n = 0 then 'no_existe' else 'ambiguo' end); end if;
  select * into v from respiro.clientes where activo and (id::text = p_cliente or nombre ilike '%' || p_cliente || '%');
  cod := respiro.crear_invitacion(v.id, p_rol, p_chat_id);
  return jsonb_build_object('ok', true, 'cliente', v.nombre, 'rol', p_rol, 'codigo', cod);
end $$;

-- Lista de clientes para admins.
create or replace function respiro.admin_clientes()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('nombre', c.nombre, 'id', c.id,
           'usuarios', (select count(*) from respiro.usuarios_bot u where u.cliente_id = c.id and u.activo and u.rol <> 'admin'),
           'calendario', c.calendario_id is not null) order by c.nombre), '[]')
  from respiro.clientes c where c.activo;
$$;

-- chat_id de los admins (avisos de errores).
create or replace function respiro.admins()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(chat_id), '[]') from respiro.usuarios_bot where rol = 'admin' and activo;
$$;

-- Informe semanal: un elemento por dueño activo con el informe de su cliente.
create or replace function respiro.destinatarios_informe_semanal()
returns table (chat_id bigint, nombre text, cliente_id uuid, informe jsonb)
language sql stable set search_path = '' as $$
  select u.chat_id, u.nombre, c.id, respiro.informe(c.id)
  from respiro.usuarios_bot u join respiro.clientes c on c.id = u.cliente_id and c.activo
  where u.rol = 'dueno' and u.activo
    and exists (select 1 from respiro.clientes_automatizaciones ca where ca.cliente_id = c.id and ca.activa and ca.clave = 'informe_semanal');
$$;

-- Equipo de un cliente (comando /equipo)
create or replace function respiro.equipo(p_cliente uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'rol', rol, 'desde', creado_en::date) order by creado_en), '[]')
  from respiro.usuarios_bot where cliente_id = p_cliente and activo and rol <> 'admin';
$$;

-- Guarda (o actualiza) un pendiente de confirmación. Devuelve su id.
create or replace function respiro.guardar_pendiente(
  p_id uuid, p_cliente uuid, p_chat_id bigint, p_acciones jsonb, p_estado text, p_pregunta jsonb)
returns uuid language sql set search_path = '' as $$
  insert into respiro.bot_pendientes (id, cliente_id, chat_id, acciones, estado, pregunta)
  values (coalesce(p_id, gen_random_uuid()), p_cliente, p_chat_id, p_acciones, p_estado, p_pregunta)
  on conflict (id) do update
     set acciones = excluded.acciones, estado = excluded.estado, pregunta = excluded.pregunta,
         caduca_en = now() + interval '30 minutes'
   where respiro.bot_pendientes.chat_id = excluded.chat_id
  returning id;
$$;

-- Toma un pendiente para actuar sobre él. Para 'si'/'no' lo cierra de forma
-- atómica (dos pulsaciones seguidas no reservan dos veces).
create or replace function respiro.tomar_pendiente(p_id uuid, p_chat_id bigint, p_accion text)
returns jsonb language plpgsql set search_path = '' as $$
declare p respiro.bot_pendientes;
begin
  -- Antes de nada, se descartan otros pendientes abiertos de este chat:
  -- solo cuenta el último resumen.
  if p_accion = 'si' then
    update respiro.bot_pendientes set estado = 'confirmado'
     where id = p_id and chat_id = p_chat_id and estado = 'pendiente' and pregunta is null and caduca_en > now()
    returning * into p;
  elsif p_accion = 'no' then
    update respiro.bot_pendientes set estado = 'cancelado'
     where id = p_id and chat_id = p_chat_id and estado in ('pendiente','esperando_dato')
    returning * into p;
  else
    select * into p from respiro.bot_pendientes
     where id = p_id and chat_id = p_chat_id and estado in ('pendiente','esperando_dato') and caduca_en > now();
  end if;
  if not found then return null; end if;
  return to_jsonb(p);
end $$;

-- Pendiente que espera un dato escrito (móvil, apellido…) en este chat.
create or replace function respiro.pendiente_esperando(p_chat_id bigint)
returns jsonb language sql stable set search_path = '' as $$
  select to_jsonb(p) from respiro.bot_pendientes p
   where p.chat_id = p_chat_id and p.estado = 'esperando_dato' and p.caduca_en > now()
   order by p.creado_en desc limit 1;
$$;

-- Al abrir un resumen nuevo se caducan los anteriores del mismo chat.
create or replace function respiro.caducar_pendientes(p_chat_id bigint, p_excepto uuid)
returns integer language sql set search_path = '' as $$
  with u as (update respiro.bot_pendientes set estado = 'caducado'
              where chat_id = p_chat_id and estado in ('pendiente','esperando_dato')
                and id is distinct from p_excepto returning 1)
  select count(*)::integer from u;
$$;

-- Lista de espera de un cliente (consulta del bot)
create or replace function respiro.lista_espera_cliente(p_cliente uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'tipo', tipo_cita, 'preferencia', preferencia, 'desde', creado_en::date) order by creado_en), '[]')
  from respiro.lista_espera where cliente_id = p_cliente and estado = 'esperando';
$$;

-- Registro de varios eventos a la vez (lo usa el nodo "Log y salida").
create or replace function respiro.log_eventos(p jsonb)
returns integer language sql set search_path = '' as $$
  select count(*)::integer from (
    select respiro.log_evento(x.cliente_id, x.automatizacion, x.tipo, x.resultado, x.origen, coalesce(x.metadatos, '{}')) as ins
    from jsonb_to_recordset(coalesce(p, '[]')) as x(cliente_id uuid, automatizacion text, tipo text, resultado text, origen text, metadatos jsonb)
  ) t where ins;
$$;

revoke all on all functions in schema respiro from public;
grant execute on all functions in schema respiro to respiro_n8n;
grant execute on function respiro.tg_actual(), respiro.cliente_actual(), respiro.metadatos_seguros(jsonb),
                          respiro.fijar_identidad(bigint), respiro.informe(uuid, date) to respiro_lector;

-- Gasto de transcripción de voz (Mistral Voxtral Mini Transcribe: 0,003 $/min, oct 2026)
create or replace function respiro.registrar_consumo_audio(p_cliente uuid, p_modelo text, p_segundos integer)
returns numeric language sql set search_path = '' as $$
  insert into respiro.consumo_ia (cliente_id, modelo, uso, coste_estimado_usd)
  values (p_cliente, p_modelo, 'transcripcion', round(greatest(p_segundos, 1) / 60.0 * 0.003, 6))
  returning coste_estimado_usd;
$$;
grant execute on function respiro.registrar_consumo_audio(uuid, text, integer) to respiro_n8n;
