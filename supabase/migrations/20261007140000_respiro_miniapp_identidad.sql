-- Identidad para la Mini App: el Worker la usa para firmar las peticiones a n8n.
-- Como el resto de miniapp_*, se ejecuta como respiro_lector (RLS activo) y
-- solo la puede llamar service_role.
create or replace function public.miniapp_identidad(p_tg_user_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u respiro.usuarios_bot;
begin
  u := respiro.fijar_identidad(p_tg_user_id);
  return jsonb_build_object('cliente_id', u.cliente_id, 'rol', u.rol, 'nombre', u.nombre);
end $$;

grant create on schema public to respiro_lector;
alter function public.miniapp_identidad(bigint) owner to respiro_lector;
revoke create on schema public from respiro_lector;
revoke all on function public.miniapp_identidad(bigint) from public, anon, authenticated;
grant execute on function public.miniapp_identidad(bigint) to service_role;
