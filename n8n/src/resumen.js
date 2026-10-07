// Resumen: el mensaje único con lo que se va a hacer y sus botones.
const p = $('Plan').item.json;
const id = $json.id || (p.guardar && p.guardar.id) || null;
const { m, cfg } = p;
let tg;
if (p.vista) {
  const botones = p.vista.botones.map((fila) => fila.map((b) => ({ ...b, callback_data: b.callback_data.replace('{ID}', id) })));
  tg = m.tipo === 'callback'
    ? [tgAviso(m.cb_id), tgEditar(m.chat_id, m.msg_id, p.vista.texto, botones)]
    : [tgTexto(m.chat_id, p.vista.texto, botones)];
} else {
  tg = p.salida_directa.tg;
}
return [{ json: { salida: {
  logs: p.logs, tg, admin: (p.admin || []).join('\n'),
  consumo: p.consumo ? { ...p.consumo, cliente_id: cfg.cliente_id } : null,
} } }];
