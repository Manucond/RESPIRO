-- =====================================================================
-- Panel web ↔ asistente de Telegram
-- El cliente, con su sesión de la web (Supabase Auth), ve el estado de su
-- asistente y genera su propia invitación de dueño. Un admin activa el
-- asistente de un negocio enlazándolo con su calendario.
-- Todas: SECURITY DEFINER, solo para usuarios con sesión (authenticated), y
-- la identidad sale SIEMPRE de auth.uid(), nunca de un parámetro.
-- =====================================================================

-- Estado del asistente del negocio del usuario con sesión.
create or replace function public.panel_asistente()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.businesses; c respiro.clientes;
begin
  select * into b from public.businesses where auth_user_id = auth.uid();
  if not found then return jsonb_build_object('estado', 'sin_negocio'); end if;
  select * into c from respiro.clientes where business_id = b.id and activo;
  if not found or c.calendario_id is null then return jsonb_build_object('estado', 'pendiente'); end if;
  return jsonb_build_object(
    'estado', 'listo',
    'cliente', c.nombre,
    'conectados', (select count(*) from respiro.usuarios_bot u where u.cliente_id = c.id and u.activo and u.rol in ('dueno', 'personal')),
    'dueno_conectado', exists (select 1 from respiro.usuarios_bot u where u.cliente_id = c.id and u.activo and u.rol = 'dueno'));
end $$;

-- Invitación de dueño para el negocio del usuario con sesión. Reutiliza la última
-- vigente (para que recargar la página no genere enlaces nuevos) y limita a 10 al día.
create or replace function public.panel_invitacion_telegram()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.businesses; c respiro.clientes; cod text; caduca timestamptz;
begin
  select * into b from public.businesses where auth_user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_negocio'); end if;
  select * into c from respiro.clientes where business_id = b.id and activo;
  if not found or c.calendario_id is null then return jsonb_build_object('ok', false, 'motivo', 'pendiente'); end if;

  select codigo, caduca_en into cod, caduca from respiro.codigos_invitacion
   where cliente_id = c.id and rol = 'dueno' and creado_por is null and usado_en is null and caduca_en > now() + interval '2 hours'
   order by creado_en desc limit 1;
  if cod is null then
    if (select count(*) from respiro.codigos_invitacion
         where cliente_id = c.id and creado_por is null and creado_en > now() - interval '24 hours') >= 10 then
      return jsonb_build_object('ok', false, 'motivo', 'limite');
    end if;
    cod := respiro.crear_invitacion(c.id, 'dueno', null, 48);
    caduca := now() + interval '48 hours';
  end if;
  return jsonb_build_object('ok', true, 'codigo', cod, 'caduca_en', caduca);
end $$;

-- Admin: estado del asistente de todos los negocios.
create or replace function public.admin_asistentes()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admins where auth_user_id = auth.uid()) then raise exception 'solo_admin' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'business_id', c.business_id, 'cliente', c.nombre, 'calendario_id', c.calendario_id, 'activo', c.activo,
      'usuarios', (select count(*) from respiro.usuarios_bot u where u.cliente_id = c.id and u.activo and u.rol <> 'admin')))
    from respiro.clientes c where c.business_id is not null), '[]');
end $$;

-- Admin: activa (o actualiza) el asistente de un negocio con el ID de su calendario.
create or replace function public.admin_activar_asistente(p_business_id uuid, p_calendario_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.businesses; c respiro.clientes; cal text := nullif(trim(p_calendario_id), '');
begin
  if not exists (select 1 from public.admins where auth_user_id = auth.uid()) then raise exception 'solo_admin' using errcode = '42501'; end if;
  if cal is null or length(cal) > 200 or cal !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$' then
    return jsonb_build_object('ok', false, 'motivo', 'calendario');
  end if;
  select * into b from public.businesses where id = p_business_id;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'negocio'); end if;
  select * into c from respiro.clientes where business_id = b.id;
  if found then
    update respiro.clientes set calendario_id = cal, activo = true where id = c.id returning * into c;
  else
    insert into respiro.clientes (business_id, nombre, tipo_negocio, calendario_id)
    values (b.id, left(b.business_name, 120), coalesce(b.business_type_key, 'otro'), cal)
    returning * into c;
  end if;
  insert into respiro.clientes_automatizaciones (cliente_id, clave)
  values (c.id, 'bot_agenda'), (c.id, 'informe_semanal')
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'cliente_id', c.id, 'cliente', c.nombre);
end $$;

revoke all on function public.panel_asistente(), public.panel_invitacion_telegram(),
  public.admin_asistentes(), public.admin_activar_asistente(uuid, text) from public, anon;
grant execute on function public.panel_asistente(), public.panel_invitacion_telegram(),
  public.admin_asistentes(), public.admin_activar_asistente(uuid, text) to authenticated;
