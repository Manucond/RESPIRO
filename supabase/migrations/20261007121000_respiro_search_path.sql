-- Fija search_path vacío en las funciones del esquema respiro (aviso 0011 del asesor de Supabase).
-- Todas usan nombres cualificados (respiro.*), así que no cambia su comportamiento.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'respiro'::regnamespace loop
    execute format('alter function %s set search_path = %L', f, '');
  end loop;
end $$;
