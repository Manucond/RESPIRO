-- Gasto de los audios grabados en el chat de la Mini App (los transcribe el Worker
-- con Mistral). Solo service_role puede llamarla; se ejecuta como respiro_lector y
-- solo puede apuntar gasto de transcripción del cliente del usuario verificado.
-- El límite mensual de IA lo sigue comprobando n8n al recibir el texto.
grant insert on respiro.consumo_ia to respiro_lector;
grant usage on all sequences in schema respiro to respiro_lector;
create policy lector_consumo_ins on respiro.consumo_ia for insert to respiro_lector
  with check (cliente_id = respiro.cliente_actual() and uso = 'transcripcion');

create or replace function public.miniapp_consumo_audio(p_tg_user_id bigint, p_segundos integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u respiro.usuarios_bot;
begin
  u := respiro.fijar_identidad(p_tg_user_id);
  insert into respiro.consumo_ia (cliente_id, modelo, uso, coste_estimado_usd)
  values (u.cliente_id, 'voxtral-mini-latest', 'transcripcion', round(greatest(least(p_segundos, 600), 1) / 60.0 * 0.003, 6));
  return jsonb_build_object('ok', true);
end $$;

grant create on schema public to respiro_lector;
alter function public.miniapp_consumo_audio(bigint, integer) owner to respiro_lector;
revoke create on schema public from respiro_lector;
revoke all on function public.miniapp_consumo_audio(bigint, integer) from public, anon, authenticated;
grant execute on function public.miniapp_consumo_audio(bigint, integer) to service_role;
