// Con agenda: une la respuesta de Google Calendar con el contexto.
const prev = $('Pedir agenda').item.json;
const r = $json;
if (r.error || !Array.isArray(r.items)) {
  const { m, cfg } = prev;
  const motivo = String((r.error && (r.error.message || r.error.description)) || 'sin respuesta').slice(0, 200);
  return [{ json: { siguiente: 'salida', salida: {
    logs: [log(cfg, 'bot_agenda', 'leer_agenda', 'error', `tg:m:${m.upd}:agenda`, { motivo: 'calendario' })],
    tg: [
      ...(m.tipo === 'callback' ? [tgAviso(m.cb_id)] : []),
      tgTexto(m.chat_id, '😵 No he podido leer tu calendario ahora mismo. Lo intento de nuevo en un momento; si sigue fallando, avisa a RESPIRO.'),
    ],
    admin: `⚠️ ${cfg.cliente}: error leyendo Google Calendar (${motivo})`,
  } } }];
}
return [{ json: { ...prev, eventos: r.items } }];
