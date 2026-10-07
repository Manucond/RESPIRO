// Norm · reduce la entrada a lo que necesitamos. Dos orígenes:
//  - Telegram: se valida la cabecera secreta del webhook. Solo chats privados.
//  - Chat de la Mini App: el Worker ya verificó initData; aquí se valida su firma
//    HMAC(secreto, ts.nonce.payload) (calculada por el nodo "Firma chat") y la hora.
const nombreDe = (f) => [f && f.first_name, f && f.last_name].filter(Boolean).join(' ').slice(0, 80);

if ($('Mini App · Chat').isExecuted) {
  const b = ($('Mini App · Chat').first().json.body) || {};
  const calc = $json.firma_calc || '';
  let dif = calc.length === String(b.firma || '').length ? 0 : 1;
  for (let i = 0; i < calc.length && !dif; i++) dif |= calc.charCodeAt(i) ^ String(b.firma).charCodeAt(i);
  const ahoraS = Math.floor(Date.now() / 1000);
  const rechazo = (motivo) => [{ json: { canal: 'miniapp', rechazado: motivo } }];
  if (dif) return rechazo('firma');
  if (Math.abs(ahoraS - Number(b.ts)) > 60 || !/^[0-9a-f]{24}$/.test(b.nonce || '')) return rechazo('caducada');
  let p;
  try { p = JSON.parse(b.payload); } catch (e) { return rechazo('payload'); }
  if (!Number.isSafeInteger(p.user_id)) return rechazo('payload');
  const o = { upd: 'mini:' + b.nonce, dedupe: 'mini:' + b.nonce, canal: 'miniapp', chat_id: p.user_id, user_id: p.user_id,
    nombre_tg: String(p.nombre || '').slice(0, 80) };
  if (p.tipo === 'callback') return [{ json: { ...o, tipo: 'callback', cb_id: 'mini', cb_data: String(p.cb_data || '').slice(0, 64), msg_id: null } }];
  const texto = String(p.texto || '').trim().slice(0, 1000);
  if (!texto) return rechazo('vacio');
  return [{ json: { ...o, tipo: 'texto', texto, ...(p.via_voz ? { via_voz: true, transcripcion: texto.slice(0, 300) } : {}) } }];
}

const w = $('Telegram · Entrada').first().json;
const cab = w.headers || {};
if ((cab['x-telegram-bot-api-secret-token'] || '') !== G.tg_secret) return [];
const u = w.body || {};
let o = { upd: u.update_id, dedupe: 'tg:u:' + u.update_id, canal: 'telegram' };
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
