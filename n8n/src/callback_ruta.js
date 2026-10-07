// Callback · Ruta: con el pendiente ya tomado, decide qué hacer.
const x = $json.x;
const p = $json.p;
const { m, cfg, op, i, k } = x;
if (!p) {
  return [{ json: { salida: { logs: [], tg: [
    tgAviso(m.cb_id, 'Este resumen ya no está activo.'),
    { method: 'editMessageReplyMarkup', body: { chat_id: m.chat_id, message_id: m.msg_id, reply_markup: { inline_keyboard: [] } } },
  ] } } }];
}
if (op === 'no') {
  return [{ json: { salida: {
    logs: [log(cfg, 'bot_agenda', 'descartar', 'omitido', `tg:p:${p.id}:no`)],
    tg: [tgAviso(m.cb_id, 'Hecho'), tgEditar(m.chat_id, m.msg_id, '👌 Vale, no he cambiado nada.', [])],
  } } }];
}
if (op === 'si') return [{ json: { m, cfg, pendiente: p, siguiente: 'ejecutar' } }];
return [{ json: { m, cfg, pendiente: p, eleccion: { op, i, k }, siguiente: 'plan' } }];
