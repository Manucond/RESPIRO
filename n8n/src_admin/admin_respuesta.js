// Admin · Respuesta: mensaje final (con la consulta plegada, por transparencia) y memoria corta.
const prev = $('Admin · Redactar').first().json;
const r = $json;
const { m } = prev;
const u = r.usage || {};
const consumo = { ...prev.consumo,
  entrada: prev.consumo.entrada + (u.input_tokens || 0), salida: prev.consumo.salida + (u.output_tokens || 0),
  cache_lect: prev.consumo.cache_lect + (u.cache_read_input_tokens || 0), cache_escr: prev.consumo.cache_escr + (u.cache_creation_input_tokens || 0) };
let texto = prev.directa;
if (!texto) {
  texto = !r.error && Array.isArray(r.content) ? r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim() : '';
  if (!texto) texto = prev.filas ? '📊 ' + JSON.stringify(prev.filas).slice(0, 1500) : '😵 No he podido sacar ese dato.';
}
let html = esc(texto.trim()).replace(/\n{3,}/g, '\n\n').slice(0, 3500);
if (prev.sql) html += `\n\n<blockquote expandable>🔎 ${esc(prev.sql).slice(0, 400)}</blockquote>`;
return [{ json: {
  recordar: { chat_id: m.chat_id, pregunta: m.texto, sql: prev.sql || null },
  salida: { logs: [], tg: [tgTexto(m.chat_id, '🛠 ' + html)], consumo, admin: prev.admin_aviso ? `⚠️ Modo RESPIRO: fallo de la IA (${prev.admin_aviso})` : '' },
} }];
