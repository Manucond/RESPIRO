// Respuestas fijas: sin acceso, admin sin cliente, mensajes no soportados.
const { m, cfg } = $json;
const tg = [];
if (m.tipo === 'callback') tg.push(tgAviso(m.cb_id));
if (!cfg) {
  tg.push(tgTexto(m.chat_id, '🔒 No tienes acceso. Pide tu enlace de invitación a RESPIRO.'));
} else if (!cfg.cliente_id) {
  tg.push(tgTexto(m.chat_id, m.tipo === 'voz'
    ? '🛠 En el modo RESPIRO escríbeme la pregunta (los audios funcionan dentro de un cliente: /cliente &lt;nombre&gt;).'
    : '🛠 Estás en el modo RESPIRO: pregúntame lo que quieras sobre clientes, uso o gastos. Para gestionar la agenda de un cliente: /cliente &lt;nombre&gt;.'));
} else {
  tg.push(tgTexto(m.chat_id, '🤔 De momento entiendo texto y notas de voz. Escríbeme lo que necesitas o usa /ayuda.'));
}
return [{ json: { salida: { logs: [], tg } } }];
