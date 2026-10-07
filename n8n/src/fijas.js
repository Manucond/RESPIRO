// Respuestas fijas: sin acceso, admin sin cliente, mensajes no soportados.
const { m, cfg } = $json;
const tg = [];
if (m.tipo === 'callback') tg.push(tgAviso(m.cb_id));
if (!cfg) {
  tg.push(tgTexto(m.chat_id, '🔒 No tienes acceso. Pide tu enlace de invitación a RESPIRO.'));
} else if (!cfg.cliente_id) {
  tg.push(tgTexto(m.chat_id, '🛠 Eres admin, pero no has elegido cliente. Usa /clientes y luego /cliente &lt;nombre&gt;.'));
} else {
  tg.push(tgTexto(m.chat_id, '🤔 De momento entiendo texto y notas de voz. Escríbeme lo que necesitas o usa /ayuda.'));
}
return [{ json: { salida: { logs: [], tg } } }];
