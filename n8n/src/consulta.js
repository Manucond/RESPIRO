// Consulta (comandos /hoy, /manana, /huecos, /noshows)
const { m, cfg, q, eventos, log_tipo } = $json;
return [{ json: { salida: {
  logs: [log(cfg, 'bot_agenda', log_tipo || 'consultar', 'ok', `tg:m:${m.upd}`, { canal: 'comando' })],
  tg: [tgTexto(m.chat_id, textoConsulta(cfg, eventos, q, []), [botonApp('📱 Abrir mi agenda')])],
} } }];
