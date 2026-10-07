// Mini App · Operar: agenda del día, huecos, no-shows o crear cita (con comprobación).
const prev = $('Mini App · Preparar').first().json;
const { cfg, req, nonce } = prev;
const r = $json;
if (r.error || !Array.isArray(r.items)) return [{ json: { status: 502, respuesta: { ok: false, error: 'calendario' } } }];
const eventos = r.items;
const p = req.params || {};
const ok = (respuesta) => [{ json: { status: 200, respuesta } }];

if (req.op === 'agenda') {
  const d = dt(cfg, p.fecha).startOf('day');
  const porId = new Map(eventos.map((e) => [e.id, e]));
  const citas = citasDe(cfg, eventos).filter((c) => c.inicio.toISODate() === d.toISODate()).map((c) => ({
    hora: fHora(c.inicio), fin: fHora(c.fin), nombre: c.nombre, tipo: tipoPor(cfg, c.codigo).nombre, estado: estadoCita(porId.get(c.id) || {}, c),
  }));
  const dur = duracionMinima(cfg);
  const libres = tramosLibres(huecos(cfg, eventos, d, d.endOf('day'), dur), dur).map((t) => ({ desde: fHora(t.ini), hasta: fHora(t.fin) }));
  return ok({ ok: true, fecha: p.fecha, citas, libres, cerrado: !tramosDia(cfg, d).length });
}
if (req.op === 'huecos') {
  const d = dt(cfg, p.fecha).startOf('day');
  const dur = Number(tipoPor(cfg, p.tipo).min) || 30;
  const horas = huecos(cfg, eventos, d, d.endOf('day'), dur).map(fHora).slice(0, 80);
  return ok({ ok: true, horas, duracion: dur, cerrado: !tramosDia(cfg, d).length });
}
if (req.op === 'noshows') {
  const c = citasDe(cfg, eventos).filter((x) => x.novino && x.inicio <= ahora(cfg));
  return ok({ ok: true, citas: c.map((x) => ({ nombre: x.nombre, fecha: fDiaCorto(x.inicio), hora: fHora(x.inicio) })) });
}
// crear: el formulario de la Mini App ya es la confirmación del usuario
const tipo = tipoPor(cfg, p.tipo);
const ini = dt(cfg, `${p.fecha}T${p.hora}`);
const fin = ini.plus({ minutes: Number(tipo.min) || 30 });
const nombre = String(p.nombre || '').trim().slice(0, 80);
const movil = p.movil ? normMovil(p.movil) : null;
if (nombre.length < 2) return ok({ ok: false, error: 'nombre' });
if (p.movil && !movil) return ok({ ok: false, error: 'movil' });
const h = comprobarHueco(cfg, eventos, ini, fin);
if (!h.libre) return ok({ ok: false, error: h.motivo });
const evId = 'rspm' + nonce;
return [{ json: { escribir: true, nonce, cfg, tipo: tipo.codigo, req: {
  method: 'POST', url: `${G.gcal_base}/calendars/${encodeURIComponent(cfg.calendario_id)}/events`,
  body: {
    id: evId,
    summary: titulo(cfg, nombre, movil, tipo.codigo),
    description: 'Origen: Mini App de Telegram (RESPIRO).',
    start: { dateTime: ini.toISO(), timeZone: zona(cfg) },
    end: { dateTime: fin.toISO(), timeZone: zona(cfg) },
    extendedProperties: { private: { respiro_origen: 'miniapp' } },
  },
} } }];
