// Ejecutar · Preparar: vuelve a comprobar cada cambio con el calendario
// recién leído y prepara las peticiones a Google Calendar.
// La última petición siempre es una lectura de verificación.
const { m, cfg, pendiente, eventos } = $json;
const cal = encodeURIComponent(cfg.calendario_id);
const base = `${G.gcal_base}/calendars/${cal}/events`;
const zonaCfg = zona(cfg);
let virtual = [...eventos];
const out = [];
const resultado = [];
pendiente.acciones.forEach((a, i) => {
  // Id fijo por acción: si Telegram repite la pulsación, Google responde 409 y no se duplica.
  const evId = ('rsp' + pendiente.id.replace(/-/g, '') + i).toLowerCase();
  if (a.accion === 'crear') {
    const ini = dt(cfg, a.inicio);
    const fin = dt(cfg, a.fin);
    const h = comprobarHueco(cfg, virtual, ini, fin);
    if (!h.libre) { resultado.push({ i, ok: false, motivo: h.motivo }); return; }
    virtual.push({ id: evId, summary: 'x', start: { dateTime: ini.toISO() }, end: { dateTime: fin.toISO() } });
    out.push({ i, req: { method: 'POST', url: base, qs: { sendUpdates: 'none' }, body: {
      id: evId,
      summary: titulo(cfg, a.nombre, a.sin_movil ? null : a.movil, a.codigo),
      description: 'Origen: Asistente de Telegram (RESPIRO).',
      start: { dateTime: ini.toISO(), timeZone: zonaCfg },
      end: { dateTime: fin.toISO(), timeZone: zonaCfg },
      extendedProperties: { private: { respiro_origen: 'bot_telegram', respiro_pendiente: pendiente.id } },
    } } });
  } else if (a.accion === 'mover') {
    const ev = eventos.find((e) => e.id === a.ev_id);
    if (!ev) { resultado.push({ i, ok: false, motivo: 'no_existe' }); return; }
    const ini = dt(cfg, a.inicio);
    const fin = dt(cfg, a.fin);
    virtual = virtual.filter((e) => e.id !== a.ev_id);
    const h = comprobarHueco(cfg, virtual, ini, fin);
    if (!h.libre) { resultado.push({ i, ok: false, motivo: h.motivo }); virtual.push(ev); return; }
    virtual.push({ ...ev, start: { dateTime: ini.toISO() }, end: { dateTime: fin.toISO() } });
    out.push({ i, req: { method: 'PATCH', url: `${base}/${encodeURIComponent(a.ev_id)}`, qs: { sendUpdates: 'none' }, body: {
      start: { dateTime: ini.toISO(), timeZone: zonaCfg },
      end: { dateTime: fin.toISO(), timeZone: zonaCfg },
    } } });
  } else if (a.accion === 'cancelar') {
    const ev = eventos.find((e) => e.id === a.ev_id);
    if (!ev) { resultado.push({ i, ok: false, motivo: 'no_existe' }); return; }
    virtual = virtual.filter((e) => e.id !== a.ev_id);
    out.push({ i, req: { method: 'DELETE', url: `${base}/${encodeURIComponent(a.ev_id)}`, qs: { sendUpdates: 'none' }, body: null } });
  }
});
// La verificación la hace después el nodo "Calendar · Verificar", cuando han terminado todas
// las escrituras (el nodo HTTP lanza sus peticiones a la vez y no se puede mezclar aquí).
const verif = { url: base, qs: { timeMin: $json.rango.min, timeMax: $json.rango.max, singleEvents: 'true', maxResults: '2500' } };
const ctx = { m, cfg, pendiente, previos: resultado, verif };
// Si no hay nada que escribir (todo falló al recomprobar), se pasa una lectura inofensiva.
const lista = out.length ? out : [{ i: -1, req: { method: 'GET', url: base, qs: verif.qs, body: null } }];
return lista.map((o) => ({ json: { ...o, ctx } }));
