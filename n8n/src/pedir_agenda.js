// Pedir agenda: fija el rango de lectura del calendario según lo que venga después.
const j = $json;
if (j.salida) return [{ json: j }];
const { m, cfg } = j;
if (!cfg.calendario_id) {
  return [{ json: { salida: { logs: [], tg: [
    ...(m.tipo === 'callback' ? [tgAviso(m.cb_id)] : []),
    tgTexto(m.chat_id, '📅 Tu calendario todavía no está conectado. Avisa a RESPIRO y lo dejamos listo.'),
  ] } } }];
}
const hoy = ahora(cfg).startOf('day');
let min = hoy.minus({ days: 45 });
let max = hoy.plus({ days: 46 });
if (j.siguiente === 'consulta') {
  const q = j.q || {};
  if (q.consulta === 'no_shows') { min = hoy.minus({ days: 31 }); max = ahora(cfg); }
  else if (q.fecha) { min = dt(cfg, q.fecha).startOf('day'); max = min.endOf('day'); }
  else { min = ahora(cfg).startOf('day'); max = hoy.plus({ days: 22 }); }
}
if (j.siguiente === 'ejecutar') {
  const fechas = (j.pendiente.acciones || []).flatMap((a) => [a.inicio, a.ini_original]).filter(Boolean).map((v) => dt(cfg, v));
  if (fechas.length) {
    min = DateTime.min(...fechas).startOf('day');
    max = DateTime.max(...fechas).endOf('day');
  }
}
return [{ json: { ...j, rango: { min: min.toISO(), max: max.toISO() } } }];
