// Voz · Resultado: el texto transcrito entra por el mismo camino que un mensaje escrito.
const prev = $('Voz · Preparar').first().json;
const r = $json;
const { m, cfg } = prev;
if (!r.texto) {
  return [{ json: { salida: {
    logs: [log(cfg, 'bot_agenda', 'transcribir', 'error', `tg:m:${m.upd}:voz`, { motivo: String(r.error || 'vacio').slice(0, 40) })],
    tg: [tgTexto(m.chat_id, r.error === 'vacio' ? '🎧 No he oído nada en ese audio. ¿Me lo repites?' : '😵 No he podido escuchar el audio. ¿Me lo escribes?')],
    admin: r.error && r.error !== 'vacio' ? `⚠️ ${cfg.cliente}: falla la transcripción (${String(r.error).slice(0, 120)})` : '',
  } } }];
}
return [{ json: { m: { ...m, texto: r.texto.slice(0, 1000), via_voz: true, transcripcion: r.texto.slice(0, 300) }, cfg } }];
