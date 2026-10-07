// Salida: reparte los mensajes. En Telegram, un elemento por mensaje (y avisos a admins).
// En el chat de la Mini App, los mensajes se devuelven en la respuesta HTTP en un formato neutro.
const tg = Array.isArray($json.tg) ? $json.tg : [];
const out = [];
const avisos = [];
if ($json.admin_txt) {
  for (const chat of $json.admins || []) avisos.push({ json: { tg: tgTexto(chat, esc($json.admin_txt)) } });
}
if ($('Mini App · Chat').isExecuted) {
  const mensajes = [];
  for (const t of tg) {
    const b = t.body || {};
    if (!['sendMessage', 'sendPhoto', 'editMessageText', 'editMessageReplyMarkup'].includes(t.method)) continue;
    const botones = ((b.reply_markup && b.reply_markup.inline_keyboard) || []).map((fila) => fila
      .filter((x) => x.callback_data || x.web_app)
      .map((x) => (x.callback_data ? { texto: x.text, data: x.callback_data } : { texto: x.text, seccion: (x.web_app.url.split('?s=')[1] || 'hoy') })))
      .filter((fila) => fila.length);
    if (t.method === 'editMessageReplyMarkup') { mensajes.push({ quitar_botones: true }); continue; }
    mensajes.push({ texto: b.text || b.caption || '', foto: t.method === 'sendPhoto' ? b.photo : null, botones, reemplaza: t.method === 'editMessageText' });
  }
  return [{ json: { respuesta: { ok: true, mensajes } } }, ...avisos];
}
for (const t of tg) out.push({ json: { tg: t } });
return [...out, ...avisos];
