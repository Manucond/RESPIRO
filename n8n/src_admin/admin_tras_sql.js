// Admin · Tras SQL: si la consulta falló, un reintento con el error; si no, a redactar.
const prev = $('Admin · Validar').first().json;
const r = $json;
const error = r.error ? String(r.error.message || r.error.description || r.error).slice(0, 300) : null;
if (error && !prev.admin_reintento) {
  return [{ json: { ...prev, admin_reintento: true, admin_error: error, admin_sql: prev.sql, reintentar: true } }];
}
return [{ json: { ...prev, filas: error ? null : (r.filas || []), sql_error: error, reintentar: false } }];
