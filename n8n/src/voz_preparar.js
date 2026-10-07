// Voz · Preparar: filtros antes de transcribir.
const { m, cfg } = $json;
const MAX_SEG = 120;
const tg = (t) => [{ json: { salida: { logs: [], tg: [tgTexto(m.chat_id, t)] } } }];
if ((m.voz.duracion || 0) > MAX_SEG) return tg('⏱ Mándame audios de menos de 2 minutos, porfa.');
if ((m.voz.tam || 0) > 10 * 1024 * 1024) return tg('📦 Ese audio es demasiado grande.');
if (Number(cfg.gasto_ia_mes_usd) >= Number(cfg.limite_ia_mensual_usd)) {
  return tg('😴 Este mes ya he usado todo el cupo para entender mensajes. Mientras tanto puedes usar /hoy, /huecos o la app.');
}
return [{ json: { m, cfg, file_id: m.voz.file_id, segundos: m.voz.duracion || 0, cliente_id: cfg.cliente_id } }];
