// Norm · valida que la petición viene de Telegram (cabecera secreta) y
// reduce el update a lo que necesitamos. Solo chats privados.
const w = $('Telegram · Entrada').first().json;
const cab = w.headers || {};
if ((cab['x-telegram-bot-api-secret-token'] || '') !== G.tg_secret) return [];
const u = w.body || {};
const nombreDe = (f) => [f && f.first_name, f && f.last_name].filter(Boolean).join(' ').slice(0, 80);
let o = { upd: u.update_id };
if (u.callback_query) {
  const cb = u.callback_query;
  if (!cb.message || cb.message.chat.type !== 'private') return [];
  o = { ...o, tipo: 'callback', chat_id: cb.message.chat.id, user_id: cb.from.id, nombre_tg: nombreDe(cb.from),
        cb_id: cb.id, cb_data: String(cb.data || '').slice(0, 64), msg_id: cb.message.message_id };
} else if (u.message) {
  const msg = u.message;
  if (!msg.chat || msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) return [];
  o = { ...o, chat_id: msg.chat.id, user_id: msg.from.id, nombre_tg: nombreDe(msg.from), msg_id: msg.message_id };
  const audio = msg.voice || msg.audio;
  if (audio) {
    o.tipo = 'voz';
    o.voz = { file_id: audio.file_id, duracion: audio.duration || 0, tam: audio.file_size || 0 };
  } else if (typeof msg.text === 'string') {
    o.tipo = 'texto';
    o.texto = msg.text.trim().slice(0, 1000);
  } else {
    o.tipo = 'otro';
  }
} else {
  return [];
}
if (typeof o.upd !== 'number' || !o.chat_id) return [];
return [{ json: o }];
