\set ON_ERROR_STOP on
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALLO: %', msg; end if; raise notice 'OK  %', msg; end $$;
create or replace function pg_temp.rechaza(q text, msg text) returns void language plpgsql as $$
begin
  begin perform respiro_admin.consultar(q); raise exception 'FALLO: se ejecutó: %', msg;
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    raise notice 'OK  rechazado: % (%)', msg, left(sqlerrm, 60);
  end;
end $$;

insert into respiro.clientes (id, nombre) values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Clínica Uno'), ('aaaaaaaa-0000-0000-0000-0000000000a2', 'Fisio Dos');
select respiro.registrar_consumo_ia('aaaaaaaa-0000-0000-0000-0000000000a1', 'claude-haiku-4-5', 2400, 100);
select respiro.registrar_consumo_ia(null, 'claude-sonnet-5-5', 3000, 300, 0, 0, 'admin');
insert into respiro.bot_pendientes (cliente_id, chat_id, acciones) values ('aaaaaaaa-0000-0000-0000-0000000000a1', 1, '[{"nombre":"Paciente Secreto"}]');
insert into respiro.lista_espera (cliente_id, nombre, tipo_cita) values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Paciente Secreto', 'OTRO');

set role respiro_n8n;
select pg_temp.ok((respiro_admin.consultar('select count(*) as n from clientes')->0->>'n')::int = 2, 'Consulta normal sobre las vistas');
select pg_temp.ok((respiro_admin.consultar($q$select cliente, round(sum(coste_usd),4) as usd from consumo_ia group by 1 order by 1$q$)->0->>'cliente') = 'Clínica Uno', 'Gasto por cliente');
select pg_temp.ok(respiro_admin.consultar($q$select * from consumo_ia where cliente like 'RESPIRO%'$q$) <> '[]', 'Las consultas de admin cuentan su propio gasto');
select pg_temp.ok(jsonb_array_length(respiro_admin.consultar('select g from generate_series(1, 1000) g')) = 200, 'Máximo 200 filas');
select pg_temp.ok(respiro_admin.consultar('select personas from lista_espera')->0->>'personas' = '1', 'Lista de espera solo como recuento');
select pg_temp.ok(respiro_admin.consultar('select * from lista_espera')::text not like '%Paciente Secreto%', 'Ninguna vista enseña nombres de pacientes');
select pg_temp.rechaza('select * from respiro.bot_pendientes', 'leer pendientes con pacientes');
select pg_temp.rechaza('select * from respiro.lista_espera', 'leer la lista de espera con nombres');
select pg_temp.rechaza('select * from respiro.usuarios_bot', 'tablas internas del esquema respiro');
select pg_temp.rechaza('select * from public.businesses', 'tablas de la web sin pasar por las vistas');
select pg_temp.rechaza('delete from clientes', 'DELETE');
select pg_temp.rechaza('update clientes set nombre = $$x$$', 'UPDATE');
select pg_temp.rechaza('with x as (delete from clientes returning 1) select * from x', 'DELETE dentro de un WITH');
select pg_temp.rechaza('select 1; drop table respiro.clientes', 'dos sentencias');
select pg_temp.rechaza('select pg_sleep(30)', 'pg_sleep');
select pg_temp.rechaza('select lo_create(0)', 'objetos grandes');
select pg_temp.rechaza($q$select set_config('role', 'postgres', false)$q$, 'cambiar de rol');
reset role;
select pg_temp.ok((select count(*) from respiro.clientes) = 2, 'Nada se ha borrado ni cambiado');
set role anon;
do $$ begin
  begin perform respiro_admin.consultar('select 1'); raise exception 'FALLO: anon consultó';
  exception when insufficient_privilege then raise notice 'OK  anon no puede usar el modo RESPIRO'; end;
end $$;
reset role;
\echo FIN_ADMIN
