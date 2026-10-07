// Ejecutar · Resultado: junta las respuestas, verifica en el calendario y
// registra cada acción (sin datos personales en el log).
const entradas = $('Ejecutar · Preparar').all();
const respuestas = $('🔑 Calendar · Escribir').all();
const { m, cfg, pendiente, previos } = entradas[0].json.ctx;
const res = [...previos];
const v = $input.first().json;
const verificacion = Array.isArray(v.items) ? v.items : null;
respuestas.forEach((r, n) => {
  const e = entradas[n] && entradas[n].json;
  if (!e || e.i === -1) return;
  const j = r.json || {};
  const err = j.error;
  const codigo = err && (err.code || err.httpCode || (err.status && Number(err.status)));
  const dup = e.req.method === 'POST' && (String(codigo) === '409' || /already exists|409/i.test(JSON.stringify(err || '')));
  res.push({ i: e.i, ok: !err || dup, motivo: err && !dup ? 'calendario' : null });
});
// Verificación: lo creado/movido aparece y lo cancelado ya no.
if (verificacion) {
  const ids = new Set(verificacion.filter((e) => e.status !== 'cancelled').map((e) => e.id));
  for (const r of res) {
    if (!r.ok) continue;
    const a = pendiente.acciones[r.i];
    const evId = ('rsp' + pendiente.id.replace(/-/g, '') + r.i).toLowerCase();
    if (a.accion === 'crear' && !ids.has(evId)) { r.ok = false; r.motivo = 'no_verificado'; }
    if (a.accion === 'cancelar' && ids.has(a.ev_id)) { r.ok = false; r.motivo = 'no_verificado'; }
  }
}
res.sort((x, y) => x.i - y.i);
const cuando = (v) => { const t = dt(cfg, v); return `${diaRelativo(cfg, t)} a las ${fHora(t)}`; };
const MOT = { ocupado: 'ese hueco se acaba de ocupar', horario: 'queda fuera de tu horario', cerrado: 'ese día está cerrado', pasado: 'esa hora ya ha pasado',
  no_existe: 'la cita ya no existe', calendario: 'Google Calendar no ha respondido bien', no_verificado: 'no he podido comprobar que se guardó' };
const lineas = res.map((r) => {
  const a = pendiente.acciones[r.i];
  const txt = a.accion === 'crear' ? `<b>${esc(a.nombre)}</b> apuntado ${cuando(a.inicio)}`
    : a.accion === 'mover' ? `<b>${esc(a.nombre)}</b> movido a ${cuando(a.inicio)}`
      : `Cita de <b>${esc(a.nombre)}</b> (${cuando(a.ini_original)}) cancelada`;
  return r.ok ? '✅ ' + txt : `⚠️ ${txt.replace(/ apuntado| movido a| cancelada/, (s) => ({ ' apuntado': ': no la he podido apuntar', ' movido a': ': no la he podido mover a', ' cancelada': ': no la he podido cancelar' }[s]))} — ${MOT[r.motivo] || 'error'}.`;
});
const fallos = res.filter((r) => !r.ok).length;
const texto = (fallos ? '⚠️ <b>Hecho a medias</b>\n' : '✅ <b>Hecho</b>\n') + lineas.join('\n') +
  (fallos ? '\n\nSi quieres, vuelve a pedírmelo con otra hora.' : '');
const logs = res.map((r) => {
  const a = pendiente.acciones[r.i];
  return log(cfg, 'bot_agenda', a.accion, r.ok ? 'ok' : 'error', `tg:p:${pendiente.id}:${r.i}`,
    { canal: 'telegram', tipo_cita: a.codigo || null, ...(r.ok ? {} : { motivo: r.motivo }) });
});
const caidaCalendario = res.some((r) => r.motivo === 'calendario');
return [{ json: { salida: {
  logs,
  tg: [tgAviso(m.cb_id, fallos ? 'Hecho a medias' : 'Hecho'), tgEditar(m.chat_id, m.msg_id, texto, [[botonApp('📱 Ver agenda')[0]]])],
  admin: caidaCalendario ? `⚠️ ${cfg.cliente}: fallo escribiendo en Google Calendar` : '',
} } }];
