// Admin · Validar: lee la consulta propuesta por Claude.
const prev = $('Admin · Preparar').first().json;
const { admin_body, ...ctx } = prev;
const r = $json;
const u = r.usage || {};
const consumo = {
  modelo: admin_body.model, cliente_id: null, uso: 'admin',
  entrada: (prev.consumo?.entrada || 0) + (u.input_tokens || 0),
  salida: (prev.consumo?.salida || 0) + (u.output_tokens || 0),
  cache_lect: (prev.consumo?.cache_lect || 0) + (u.cache_read_input_tokens || 0),
  cache_escr: (prev.consumo?.cache_escr || 0) + (u.cache_creation_input_tokens || 0),
};
if (r.error || !Array.isArray(r.content)) {
  const e = r.error || {};
  return [{ json: { ...ctx, consumo, sql: null, directa: '😵 Ahora mismo no puedo consultar a la IA. Inténtalo en un rato.',
    admin_aviso: String(e.message || e.type || 'error').slice(0, 150) } }];
}
let o = {};
try { o = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch (e) { o = {}; }
const sql = typeof o.sql === 'string' && o.sql.trim() ? o.sql.trim().slice(0, 4000) : null;
const directa = !sql ? (typeof o.respuesta === 'string' && o.respuesta.trim() ? o.respuesta.trim() : '🤔 No sé cómo sacar eso de los datos. Pregúntame por clientes, uso, gastos, errores, invitaciones o solicitudes.') : null;
return [{ json: { ...ctx, consumo, sql, directa } }];
