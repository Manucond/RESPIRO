\set ON_ERROR_STOP on
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALLO: %', msg; end if; raise notice 'OK  %', msg; end $$;
create or replace function pg_temp.como(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;

-- Datos: dos negocios de la web y un admin
insert into public.businesses (id, auth_user_id, business_name, business_type_key) values
 ('11111111-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'Dental Uno', 'clinica'),
 ('22222222-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000002', 'Fisio Dos', 'clinica');
insert into public.admins values ('cccc0000-0000-0000-0000-000000000003', 'Conde');

set role authenticated;
select pg_temp.como('aaaa0000-0000-0000-0000-000000000001');
select pg_temp.ok(public.panel_asistente()->>'estado' = 'pendiente', 'Sin activar: el cliente ve "pendiente"');
select pg_temp.ok(public.panel_invitacion_telegram()->>'motivo' = 'pendiente', 'Sin activar: no puede sacar invitación');
do $$ begin
  begin perform public.admin_activar_asistente('11111111-0000-0000-0000-000000000001', 'cal@group.calendar.google.com');
    raise exception 'FALLO: un cliente activó su asistente';
  exception when insufficient_privilege then raise notice 'OK  Un cliente no puede activar asistentes'; end;
  begin perform public.admin_asistentes(); raise exception 'FALLO: un cliente vio la lista de admin';
  exception when insufficient_privilege then raise notice 'OK  Un cliente no ve la lista de admin'; end;
end $$;

select pg_temp.como('cccc0000-0000-0000-0000-000000000003');
select pg_temp.ok(public.admin_activar_asistente('11111111-0000-0000-0000-000000000001', 'mal calendario')->>'motivo' = 'calendario', 'Admin: ID de calendario inválido rechazado');
select pg_temp.ok((public.admin_activar_asistente('11111111-0000-0000-0000-000000000001', 'dental1@group.calendar.google.com')->>'ok')::boolean, 'Admin activa el asistente de Dental Uno');
select pg_temp.ok((public.admin_activar_asistente('11111111-0000-0000-0000-000000000001', 'otro@group.calendar.google.com')->>'ok')::boolean, 'Admin puede cambiar el calendario (sin duplicar cliente)');
select pg_temp.ok(jsonb_array_length(public.admin_asistentes()) = 1 and public.admin_asistentes()->0->>'calendario_id' = 'otro@group.calendar.google.com', 'Admin ve el asistente enlazado');

select pg_temp.como('aaaa0000-0000-0000-0000-000000000001');
select pg_temp.ok(public.panel_asistente()->>'estado' = 'listo' and public.panel_asistente()->>'cliente' = 'Dental Uno', 'Activado: el cliente lo ve listo');
select public.panel_invitacion_telegram()->>'codigo' as c1 \gset
select pg_temp.ok(length(:'c1') = 32, 'El cliente saca su invitación de dueño');
select pg_temp.ok(public.panel_invitacion_telegram()->>'codigo' = :'c1', 'Recargar no genera otra invitación (reutiliza la vigente)');

select pg_temp.como('bbbb0000-0000-0000-0000-000000000002');
select pg_temp.ok(public.panel_asistente()->>'estado' = 'pendiente', 'Otro negocio no ve el asistente de Dental Uno');
select pg_temp.ok(public.panel_invitacion_telegram()->>'ok' = 'false', 'Otro negocio no puede sacar invitación de Dental Uno');
select pg_temp.como('dddd0000-0000-0000-0000-000000000009');
select pg_temp.ok(public.panel_asistente()->>'estado' = 'sin_negocio', 'Usuario sin negocio → sin_negocio');
reset role;

-- La invitación sacada desde la web funciona en el bot y deja al cliente conectado
select pg_temp.ok((respiro.canjear_invitacion(:'c1', 4242, 4242, 'Dueña Uno')->>'rol') = 'dueno', 'La invitación de la web se canjea en el bot como dueño');
set role authenticated;
select pg_temp.como('aaaa0000-0000-0000-0000-000000000001');
select pg_temp.ok((public.panel_asistente()->>'dueno_conectado')::boolean, 'El panel muestra que ya está conectado');
reset role;

set role anon;
do $$ begin
  begin perform public.panel_asistente(); raise exception 'FALLO: anon llamó al panel';
  exception when insufficient_privilege then raise notice 'OK  Sin sesión no se puede llamar'; end;
end $$;
reset role;
\echo FIN_PANEL
