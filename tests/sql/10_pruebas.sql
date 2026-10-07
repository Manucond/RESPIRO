\set ON_ERROR_STOP on
\pset footer off
-- Utilidad: comprobación con mensaje
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALLO: %', msg; end if; raise notice 'OK  %', msg; end $$;

-- ---------- Datos de prueba: dos clínicas ----------
insert into respiro.clientes (id, nombre) values
 ('aaaaaaaa-0000-0000-0000-000000000001','Clínica A'),
 ('bbbbbbbb-0000-0000-0000-000000000002','Clínica B');
insert into respiro.clientes_automatizaciones (cliente_id, clave)
 select id, k from respiro.clientes, unnest(array['bot_agenda','recordatorio','llamada_atendida']) k;
insert into respiro.usuarios_bot (chat_id, telegram_user_id, cliente_id, rol, nombre) values
 (101,101,'aaaaaaaa-0000-0000-0000-000000000001','dueno','Ana'),
 (102,102,'aaaaaaaa-0000-0000-0000-000000000001','personal','Pepe'),
 (201,201,'bbbbbbbb-0000-0000-0000-000000000002','dueno','Bea'),
 (900,900,null,'admin','Conde');

select pg_temp.ok(respiro.log_evento('aaaaaaaa-0000-0000-0000-000000000001','recordatorio','enviado','ok','tg:u:1:r'), 'log_evento inserta');
select pg_temp.ok(not respiro.log_evento('aaaaaaaa-0000-0000-0000-000000000001','recordatorio','enviado','ok','tg:u:1:r'), 'log_evento no duplica mismo origen');
select respiro.log_evento('aaaaaaaa-0000-0000-0000-000000000001','llamada_atendida','entrante','ok', 'v:'||g) from generate_series(1,5) g;
select respiro.log_evento('bbbbbbbb-0000-0000-0000-000000000002','llamada_atendida','entrante','ok', 'vb:'||g) from generate_series(1,40) g;
select respiro.log_evento('bbbbbbbb-0000-0000-0000-000000000002','recordatorio','enviado','error', 'rb:1');

do $$ begin
  begin
    perform respiro.log_evento('aaaaaaaa-0000-0000-0000-000000000001','bot_agenda','crear','ok',null,'{"nombre":"Marta"}');
    raise exception 'FALLO: aceptó metadatos con nombre';
  exception when check_violation then raise notice 'OK  metadatos con clave no permitida rechazados';
  end;
  begin
    perform respiro.log_evento('aaaaaaaa-0000-0000-0000-000000000001','bot_agenda','crear','ok',null,'{"motivo":"Marta García López tiene un empaste pendiente"}');
    raise exception 'FALLO: aceptó texto libre largo';
  exception when check_violation then raise notice 'OK  metadatos con texto largo rechazados';
  end;
end $$;

-- Dedupe
select pg_temp.ok(respiro.dedupe('tg:u:555','telegram'), 'dedupe: primera vez true');
select pg_temp.ok(not respiro.dedupe('tg:u:555','telegram'), 'dedupe: repetido false');

-- Invitaciones
select respiro.crear_invitacion('aaaaaaaa-0000-0000-0000-000000000001','personal',101) as cod \gset
select pg_temp.ok((respiro.canjear_invitacion(:'cod', 103, 103, 'Luis')->>'ok')::boolean, 'invitación válida se canjea');
select pg_temp.ok(respiro.canjear_invitacion(:'cod', 104, 104, 'Otro')->>'motivo' = 'usado', 'invitación de un solo uso');
insert into respiro.codigos_invitacion (codigo, cliente_id, rol, caduca_en)
 values (repeat('ab',16),'aaaaaaaa-0000-0000-0000-000000000001','personal', now() - interval '1 hour');
select pg_temp.ok(respiro.canjear_invitacion(repeat('ab',16), 105, 105, 'X')->>'motivo' = 'caducado', 'invitación caducada rechazada');
select pg_temp.ok(respiro.canjear_invitacion('nada', 105, 105, 'X')->>'motivo' = 'no_existe', 'código con formato inválido');
select pg_temp.ok(respiro.auth_chat(105) is null, 'chat desconocido no tiene acceso');
select pg_temp.ok(respiro.auth_chat(103)->>'rol' = 'personal', 'nuevo usuario con rol personal');
select pg_temp.ok(respiro.auth_chat(900) is not null and respiro.auth_chat(900)->>'cliente_id' is null, 'admin sin cliente elegido');
select pg_temp.ok((respiro.admin_cambiar_cliente(900,'Clínica B')->>'ok')::boolean, 'admin cambia a Clínica B');
select pg_temp.ok(respiro.auth_chat(900)->>'cliente' = 'Clínica B', 'admin ve Clínica B');
select pg_temp.ok(respiro.admin_cambiar_cliente(101,'Clínica B')->>'motivo' = 'no_admin', 'un dueño no puede cambiar de cliente');
update respiro.usuarios_bot set cliente_id = null where chat_id = 900;

-- Consumo IA
select pg_temp.ok(respiro.registrar_consumo_ia('aaaaaaaa-0000-0000-0000-000000000001','claude-haiku-4-5',1500,150) = 0.00225, 'coste Haiku 1500/150 = 0,00225 $');

-- ---------- Mini App: aislamiento entre clientes ----------
set role service_role;
select pg_temp.ok((public.miniapp_resumen(101)->'informe'->'mes'->>'llamadas_atendidas')::int = 5, 'Mini App A ve sus 5 llamadas (no las 40 de B)');
select pg_temp.ok((public.miniapp_resumen(201)->'informe'->'mes'->>'llamadas_atendidas')::int = 40, 'Mini App B ve sus 40 llamadas');
select pg_temp.ok(public.miniapp_resumen(201)->>'cliente_id' = 'bbbbbbbb-0000-0000-0000-000000000002', 'cliente_id derivado del usuario verificado');
select pg_temp.ok((public.miniapp_resumen(101)->'informe'->>'todo_en_marcha')::boolean is not null, 'informe trae estado general');
select pg_temp.ok(jsonb_array_length(public.miniapp_equipo(101)) = 3, 'equipo de A: Ana, Pepe y Luis (sin admin)');
select pg_temp.ok(length(public.miniapp_invitar(101)->>'codigo') = 32, 'dueño genera invitación');
select pg_temp.ok((public.miniapp_guardar_parametros(101,'{"valor_medio_cita":55}')->'parametros'->>'valor_medio_cita')::numeric = 55, 'dueño ajusta parámetros');
reset role;
select pg_temp.ok((select valor_medio_cita from respiro.clientes where nombre='Clínica B') = 40, 'parámetros de B intactos');
set role service_role;
do $$ begin
  begin perform public.miniapp_resumen(999); raise exception 'FALLO: usuario desconocido entró';
  exception when insufficient_privilege then raise notice 'OK  usuario de Telegram no registrado: sin acceso'; end;
  begin perform public.miniapp_invitar(102); raise exception 'FALLO: personal pudo invitar';
  exception when insufficient_privilege then raise notice 'OK  rol personal no puede invitar'; end;
  begin perform public.miniapp_resumen(900); raise exception 'FALLO: admin sin cliente';
  exception when insufficient_privilege then raise notice 'OK  admin sin cliente elegido no ve datos'; end;
end $$;
reset role;

-- Defensa en profundidad: aunque una consulta olvide filtrar, RLS solo deja ver su cliente.
set role respiro_lector;
select set_config('respiro.cliente_id','aaaaaaaa-0000-0000-0000-000000000001', false);
select pg_temp.ok((select count(distinct cliente_id) from respiro.eventos_automatizacion) = 1, 'RLS: sin WHERE solo se ven eventos de A');
select pg_temp.ok((select count(*) from respiro.clientes) = 1, 'RLS: solo se ve la clínica A');
select pg_temp.ok(respiro.informe('bbbbbbbb-0000-0000-0000-000000000002') is null, 'RLS: pedir el informe de B desde A no devuelve nada');
update respiro.clientes set valor_medio_cita = 1 where nombre = 'Clínica B';
select set_config('respiro.cliente_id','', false);
reset role;
select pg_temp.ok((select valor_medio_cita from respiro.clientes where nombre='Clínica B') = 40, 'RLS: A no puede modificar B');
set role respiro_lector;
do $$ begin
  begin insert into respiro.codigos_invitacion (codigo, cliente_id, rol) values (repeat('cd',16),'bbbbbbbb-0000-0000-0000-000000000002','dueno');
    raise exception 'FALLO: lector creó invitación ajena';
  exception when insufficient_privilege then raise notice 'OK  RLS: no se crean invitaciones para otro cliente'; end;
end $$;
reset role;

-- anon/authenticated: ni esquema ni funciones
set role anon;
do $$ begin
  begin perform 1 from respiro.clientes; raise exception 'FALLO: anon lee respiro';
  exception when insufficient_privilege then raise notice 'OK  anon no accede al esquema respiro'; end;
  begin perform public.miniapp_resumen(101); raise exception 'FALLO: anon llama a miniapp';
  exception when insufficient_privilege then raise notice 'OK  anon no puede llamar a la API de la Mini App'; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  begin perform public.miniapp_resumen(101); raise exception 'FALLO: authenticated llama a miniapp';
  exception when insufficient_privilege then raise notice 'OK  authenticated no puede llamar a la API de la Mini App'; end;
end $$;
reset role;

-- n8n no ve las tablas de la web
set role respiro_n8n;
do $$ begin
  begin perform 1 from public.businesses; raise exception 'FALLO: n8n lee businesses';
  exception when insufficient_privilege then raise notice 'OK  n8n no accede a las tablas de la web'; end;
end $$;
select pg_temp.ok(respiro.auth_chat(101)->>'cliente' = 'Clínica A', 'n8n resuelve chat → cliente');
reset role;

-- Informe: semanas y ahorro
select pg_temp.ok(jsonb_array_length(respiro.informe('aaaaaaaa-0000-0000-0000-000000000001')->'semanas') = 8, 'informe con 8 semanas');
select pg_temp.ok((respiro.informe('aaaaaaaa-0000-0000-0000-000000000001')->'ahorro_estimado'->>'es_estimacion')::boolean, 'ahorro marcado como estimación');
select pg_temp.ok((respiro.informe('bbbbbbbb-0000-0000-0000-000000000002')->'estado'->1->>'semaforo') is not null, 'semáforo por automatización');
select pg_temp.ok((select x->>'semaforo' from jsonb_array_elements(respiro.informe('bbbbbbbb-0000-0000-0000-000000000002')->'estado') x where x->>'clave'='recordatorio') = 'rojo', 'recordatorio con solo errores → rojo');
select respiro.limpieza();
\echo FIN_PRUEBAS
