// Texto · Ruta: ¿responde a una pregunta pendiente (móvil…) o es un mensaje nuevo para la IA?
const { p, espera, x } = $json;
const { m, cfg } = x;
const t = (m.texto || '').trim();
const pide = p && p.pregunta && p.pregunta.tipo;
const pareceRespuesta = p && (
  (pide === 'nombre' && t.length <= 60 && !t.includes('?') && !/\d{1,2}[:h]\d{2}|mañana|hoy|cancela|mueve|pasa/i.test(t)) ||
  (pide === 'movil' && (normMovil(t) || /^\s*(sin\s*m[oó]vil|no\s*(lo\s*)?(tengo|s[eé])|ninguno|no)\s*\.?$/i.test(t))));
if (pareceRespuesta) {
  return [{ json: { m, cfg, espera, pendiente: p, respuesta: t, siguiente: 'plan' } }];
}
// Límite de gasto de IA del mes
if (Number(cfg.gasto_ia_mes_usd) >= Number(cfg.limite_ia_mensual_usd)) {
  return [{ json: { salida: { logs: [log(cfg, 'bot_agenda', 'limite_ia', 'omitido', `tg:m:${m.upd}`)], tg: [
    tgTexto(m.chat_id, '😴 Este mes ya he usado todo el cupo para entender mensajes. Mientras tanto puedes usar /hoy, /huecos o la app.', [botonApp('📱 Abrir mi agenda')]),
  ] } } }];
}
return [{ json: { m, cfg, espera, texto: t, siguiente: 'ia' } }];
