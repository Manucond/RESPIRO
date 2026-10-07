// ---- RESPIRO · utilidades comunes (generadas por n8n/build.py: no editar en n8n) ----
// Fechas con Luxon (DateTime está disponible en los nodos Code de n8n).
const G = $('G').first().json;
const SEP = '·';
const IGNORAR = ['BLOQUEO', 'COMIDA', 'REUNION', 'FORMACION', 'VACACIONES'];
const CERRADO = 'CERRADO';
const NOVINO = 'NOVINO';
const PASO_MIN = 15;          // los huecos se buscan cada 15 min
const AVISO_MIN_MIN = 0;      // el dueño puede apuntar citas para dentro de un rato

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const capital = (s) => String(s || '').replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

const zona = (cfg) => (cfg && cfg.zona_horaria) || 'Europe/Madrid';
const ahora = (cfg) => DateTime.now().setZone(zona(cfg)).setLocale('es');
const dt = (cfg, v) => DateTime.fromISO(String(v), { zone: zona(cfg) }).setLocale('es');
const fDia = (d) => d.setLocale('es').toFormat("cccc d 'de' LLLL");
const fDiaCorto = (d) => d.setLocale('es').toFormat('ccc d');
const fHora = (d) => d.toFormat('HH:mm');
const diaRelativo = (cfg, d) => {
  const h = ahora(cfg).startOf('day');
  const x = d.setZone(zona(cfg)).startOf('day');
  const n = Math.round(x.diff(h, 'days').days);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  if (n > 1 && n < 7) return 'el ' + x.setLocale('es').toFormat('cccc d');
  return 'el ' + x.setLocale('es').toFormat("cccc d 'de' LLLL");
};

// --- Tipos genéricos de cita (nunca el tratamiento concreto) ---
const tipos = (cfg) => (Array.isArray(cfg.tipos_cita) && cfg.tipos_cita.length ? cfg.tipos_cita
  : [{ codigo: 'OTRO', nombre: 'otro', min: 30 }]);
const tipoPor = (cfg, codigo) => {
  const t = tipos(cfg);
  return t.find((x) => norm(x.codigo) === norm(codigo)) || t.find((x) => x.codigo === 'OTRO') || t[t.length - 1];
};

// --- Teléfonos ---
const normMovil = (p) => {
  if (p === null || p === undefined || p === '') return null;
  let d = String(p).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9) d = '34' + d;
  return /^\d{10,15}$/.test(d) ? d : null;
};
const movilVisible = (m) => (m ? '+' + m : 'sin móvil');

// --- Títulos del calendario: "Nombre · +34600111222 · TIPO" ---
const titulo = (cfg, nombre, movil, codigo) =>
  `${capital(nombre).trim()} ${SEP} ${movil ? '+' + movil : 'sin móvil'} ${SEP} ${tipoPor(cfg, codigo).codigo}`;

const leerTitulo = (cfg, summary) => {
  const s = String(summary || '');
  const partes = s.split(SEP).map((x) => x.trim()).filter(Boolean);
  const N = norm(s);
  const novino = N.includes(NOVINO);
  const nombre = (partes[0] || '').replace(new RegExp(NOVINO, 'i'), '').trim();
  let movil = null;
  let codigo = null;
  for (const p of partes.slice(1)) {
    const m = normMovil(p);
    if (!movil && m && /\d{6,}/.test(p.replace(/\s/g, ''))) { movil = m; continue; }
    const t = tipos(cfg).find((x) => norm(p).includes(norm(x.codigo)));
    if (!codigo && t) codigo = t.codigo;
  }
  return { nombre, movil, codigo: codigo || 'OTRO', novino };
};

const esIgnorable = (summary) => IGNORAR.some((p) => norm(summary).startsWith(p));

// Citas (eventos con hora) a partir de la respuesta de Google Calendar
const citasDe = (cfg, eventos) => (eventos || [])
  .filter((e) => e.status !== 'cancelled' && e.start && e.start.dateTime && !esIgnorable(e.summary) && !norm(e.summary).includes(CERRADO))
  .map((e) => {
    const t = leerTitulo(cfg, e.summary);
    return {
      id: e.id,
      inicio: DateTime.fromISO(e.start.dateTime).setZone(zona(cfg)),
      fin: DateTime.fromISO(e.end.dateTime).setZone(zona(cfg)),
      ...t,
    };
  })
  .sort((a, b) => a.inicio.toMillis() - b.inicio.toMillis());

// Ocupación: eventos que bloquean (cualquier evento con hora no transparente
// y los días completos marcados como CERRADO).
const ocupacion = (cfg, eventos, excluirId) => {
  const cerrados = new Set();
  const ocupado = [];
  for (const e of eventos || []) {
    if (e.status === 'cancelled' || e.transparency === 'transparent' || e.id === excluirId) continue;
    if (e.start && e.start.date) {
      if (norm(e.summary).includes(CERRADO)) {
        let d = DateTime.fromISO(e.start.date, { zone: zona(cfg) });
        const fin = DateTime.fromISO(e.end.date, { zone: zona(cfg) });
        while (d < fin) { cerrados.add(d.toISODate()); d = d.plus({ days: 1 }); }
      }
      continue;
    }
    if (!e.start || !e.start.dateTime) continue;
    ocupado.push({ s: DateTime.fromISO(e.start.dateTime).toMillis(), e: DateTime.fromISO(e.end.dateTime).toMillis() });
  }
  return { cerrados, ocupado };
};

const tramosDia = (cfg, d) => ((cfg.horario || {})[String(d.weekday)] || []);

const dentroHorario = (cfg, ini, fin) => tramosDia(cfg, ini).some(([a, b]) =>
  ini.toFormat('HH:mm') >= a && fin.toFormat('HH:mm') <= b && ini.toISODate() === fin.minus({ minutes: 1 }).toISODate());

// ¿Está libre [ini, fin)? Devuelve { libre, motivo }
const comprobarHueco = (cfg, eventos, ini, fin, excluirId) => {
  const { cerrados, ocupado } = ocupacion(cfg, eventos, excluirId);
  if (!ini.isValid) return { libre: false, motivo: 'fecha' };
  if (ini < ahora(cfg).minus({ minutes: 5 })) return { libre: false, motivo: 'pasado' };
  if (cerrados.has(ini.toISODate())) return { libre: false, motivo: 'cerrado' };
  if (!dentroHorario(cfg, ini, fin)) return { libre: false, motivo: 'horario' };
  const s = ini.toMillis();
  const e = fin.toMillis();
  if (ocupado.some((x) => x.s < e && x.e > s)) return { libre: false, motivo: 'ocupado' };
  return { libre: true, motivo: null };
};

// Huecos libres de `dur` minutos entre desde y hasta.
const huecos = (cfg, eventos, desde, hasta, dur, opts = {}) => {
  const { cerrados, ocupado } = ocupacion(cfg, eventos, opts.excluirId);
  const minimo = ahora(cfg).plus({ minutes: AVISO_MIN_MIN });
  const res = [];
  for (let dia = desde.startOf('day'); dia <= hasta; dia = dia.plus({ days: 1 })) {
    if (cerrados.has(dia.toISODate())) continue;
    for (const [a, b] of tramosDia(cfg, dia)) {
      const [ah, am] = a.split(':').map(Number);
      const [bh, bm] = b.split(':').map(Number);
      const cierre = dia.set({ hour: bh, minute: bm, second: 0, millisecond: 0 });
      for (let t = dia.set({ hour: ah, minute: am, second: 0, millisecond: 0 }); t.plus({ minutes: dur }) <= cierre; t = t.plus({ minutes: PASO_MIN })) {
        if (t < minimo || t < desde || t > hasta) continue;
        if (opts.franja === 'manana' && t.hour >= 14) continue;
        if (opts.franja === 'tarde' && t.hour < 14) continue;
        const s = t.toMillis();
        const e = t.plus({ minutes: dur }).toMillis();
        if (!ocupado.some((x) => x.s < e && x.e > s)) res.push(t);
      }
    }
  }
  return res;
};

// Agrupa huecos consecutivos en tramos "10:00–12:30" para mostrarlos.
const tramosLibres = (lista, dur) => {
  const out = [];
  for (const t of lista) {
    const ult = out[out.length - 1];
    if (ult && ult.dia === t.toISODate() && t <= ult.fin) ult.fin = t.plus({ minutes: dur });
    else out.push({ dia: t.toISODate(), ini: t, fin: t.plus({ minutes: dur }) });
  }
  return out;
};

// Siguientes huecos cerca de una hora pedida (mismo día primero, luego días siguientes)
const alternativas = (cfg, eventos, ini, dur, n = 3, excluirId) => {
  const mismoDia = huecos(cfg, eventos, ini.startOf('day'), ini.endOf('day'), dur, { excluirId })
    .sort((a, b) => Math.abs(a.diff(ini).toMillis()) - Math.abs(b.diff(ini).toMillis()));
  const out = [];
  for (const t of mismoDia) {
    if (out.length >= n) break;
    if (out.some((o) => Math.abs(o.diff(t, 'minutes').minutes) < dur)) continue;
    out.push(t);
  }
  if (out.length < n) {
    const otros = huecos(cfg, eventos, ini.plus({ days: 1 }).startOf('day'), ini.plus({ days: 14 }).endOf('day'), dur, { excluirId });
    for (const t of otros) {
      if (out.length >= n) break;
      if (out.some((o) => o.toISODate() === t.toISODate())) continue;   // uno por día
      out.push(t);
    }
  }
  return out.sort((a, b) => a.toMillis() - b.toMillis());
};

// Busca citas por nombre (tolerante a tildes y a nombre parcial).
const coincideNombre = (nombreCita, buscado) => {
  if (!buscado) return false;
  const a = norm(nombreCita);
  const b = norm(buscado);
  if (!a || !b) return false;
  if (a === b) return true;
  const pa = a.split(/\s+/);
  const pb = b.split(/\s+/);
  return pb.every((x) => pa.some((y) => y === x || (x.length >= 4 && y.startsWith(x))));
};

// Pacientes habituales (solo nombre y móvil) sacados del calendario.
const habituales = (cfg, eventos) => {
  const m = new Map();
  for (const c of citasDe(cfg, eventos)) {
    if (!c.nombre) continue;
    const k = norm(c.nombre) + '|' + (c.movil || '');
    const prev = m.get(k);
    if (!prev || prev.ultima < c.inicio) m.set(k, { nombre: c.nombre, movil: c.movil, ultima: c.inicio });
  }
  return [...m.values()].sort((a, b) => b.ultima.toMillis() - a.ultima.toMillis());
};

// Mensaje de Telegram (sendMessage / editMessageText / answerCallbackQuery / sendPhoto)
const tgTexto = (chat_id, text, botones, extra = {}) => ({
  method: 'sendMessage',
  body: {
    chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true,
    ...(botones && botones.length ? { reply_markup: { inline_keyboard: botones } } : {}),
    ...extra,
  },
});
const tgEditar = (chat_id, message_id, text, botones) => ({
  method: 'editMessageText',
  body: {
    chat_id, message_id, text, parse_mode: 'HTML', disable_web_page_preview: true,
    reply_markup: { inline_keyboard: botones || [] },
  },
});
const tgAviso = (callback_query_id, text) => ({ method: 'answerCallbackQuery', body: { callback_query_id, ...(text ? { text } : {}) } });
const tgFoto = (chat_id, foto, caption, botones) => ({
  method: 'sendPhoto',
  body: {
    chat_id, photo: foto, caption, parse_mode: 'HTML',
    ...(botones && botones.length ? { reply_markup: { inline_keyboard: botones } } : {}),
  },
});
// La sección va en ?s= (Telegram usa el # de la URL para pasar initData a la Mini App)
const botonApp = (texto, seccion = '') => [{ text: texto, web_app: { url: G.miniapp_url + (seccion ? '?s=' + seccion : '') } }];
const robot = (expresion) => `${G.miniapp_url}robot/${expresion}.png`;

// Elemento de log para respiro.log_eventos (SIN datos personales)
const log = (cfg, automatizacion, tipo, resultado, origen, metadatos = {}) => ({
  cliente_id: cfg.cliente_id, automatizacion, tipo, resultado, origen, metadatos,
});

// --- Estado de una cita para mostrar (sin datos de salud) ---
// confirmada: la marca el flujo de confirmaciones con extendedProperties
// o con la palabra CONFIRMADA en el título; NOVINO = no vino.
const estadoCita = (e, c) => {
  if (c.novino) return 'no_vino';
  const priv = (e.extendedProperties && e.extendedProperties.private) || {};
  if (priv.respiro_estado === 'confirmada' || norm(e.summary).includes('CONFIRMADA')) return 'confirmada';
  return 'pendiente';
};
const ICONO_ESTADO = { confirmada: '✅', pendiente: '🕓', no_vino: '❌' };
const duracionMinima = (cfg) => Math.min(...tipos(cfg).map((t) => Number(t.min) || 30));

const lineaCita = (cfg, c) => `${fHora(c.inicio)} · ${esc(c.nombre)} · ${esc(tipoPor(cfg, c.codigo).nombre)}`;

// Texto de una consulta: dia | huecos | lista_espera | no_shows
const textoConsulta = (cfg, eventos, q, espera) => {
  const hoy = ahora(cfg).startOf('day');
  if (q.consulta === 'lista_espera') {
    const l = espera || [];
    if (!l.length) return '📋 <b>Lista de espera</b>\nAhora mismo no hay nadie esperando.';
    return '📋 <b>Lista de espera</b> (' + l.length + ')\n' + l.slice(0, 15).map((x) => `• ${esc(x.nombre)} · ${esc(tipoPor(cfg, x.tipo).nombre)}${x.preferencia ? ' · ' + esc(x.preferencia) : ''}`).join('\n');
  }
  if (q.consulta === 'no_shows') {
    const desde = hoy.minus({ days: 30 });
    const l = citasDe(cfg, eventos).filter((c) => c.novino && c.inicio >= desde && c.inicio <= ahora(cfg));
    if (!l.length) return '🙌 <b>No-shows</b>\nNadie ha faltado en los últimos 30 días.';
    return `❌ <b>No-shows</b> (últimos 30 días): ${l.length}\n` + l.slice(-10).map((c) => `• ${fDiaCorto(c.inicio)} ${fHora(c.inicio)} · ${esc(c.nombre)}`).join('\n');
  }
  if (q.consulta === 'persona') {
    if (!q.nombre) return '🔎 ¿De quién quieres saber las citas?';
    const l = citasDe(cfg, eventos).filter((c) => coincideNombre(c.nombre, q.nombre) && c.inicio >= hoy);
    if (!l.length) return `🔎 No veo citas próximas de <b>${esc(q.nombre)}</b>.`;
    return `🔎 <b>Citas de ${esc(q.nombre)}</b>\n` + l.slice(0, 6).map((c) => `• ${capital(diaRelativo(cfg, c.inicio).replace(/^el /, ''))} a las ${fHora(c.inicio)} · ${esc(c.nombre)} · ${esc(tipoPor(cfg, c.codigo).nombre)}`).join('\n');
  }
  if (q.consulta === 'semana') {
    const lineas = [];
    for (let i = 0; i < 7; i++) {
      const d = hoy.plus({ days: i });
      const n = citasDe(cfg, eventos).filter((c) => c.inicio.toISODate() === d.toISODate()).length;
      if (!tramosDia(cfg, d).length && !n) continue;
      lineas.push(`• ${capital(diaRelativo(cfg, d).replace(/^el /, ''))}: ${n} cita${n === 1 ? '' : 's'}`);
    }
    return '📅 <b>Próximos días</b>\n' + (lineas.length ? lineas.join('\n') : 'Sin días de apertura.');
  }
  const dur = duracionMinima(cfg);
  if (q.consulta === 'huecos') {
    let desde = q.fecha ? dt(cfg, q.fecha).startOf('day') : ahora(cfg);
    let dias = q.fecha ? 1 : 3;
    const out = [];
    for (let d = desde, n = 0; n < dias && d < hoy.plus({ days: 21 }); d = d.plus({ days: 1 }).startOf('day')) {
      if (!tramosDia(cfg, d).length) continue;
      n++;
      const l = tramosLibres(huecos(cfg, eventos, d, d.endOf('day'), dur, { franja: q.franja }), dur);
      out.push(`<b>${capital(diaRelativo(cfg, d).replace(/^el /, ''))}</b>: ` + (l.length ? l.map((t) => `${fHora(t.ini)}–${fHora(t.fin)}`).join(', ') : 'completo'));
    }
    if (!out.length) return '🗓 No abres en esos días.';
    return `🟢 <b>Huecos libres</b>${q.franja ? ' (por la ' + (q.franja === 'manana' ? 'mañana' : 'tarde') + ')' : ''}\n` + out.join('\n');
  }
  // dia
  const d = q.fecha ? dt(cfg, q.fecha).startOf('day') : hoy;
  let l = citasDe(cfg, eventos).filter((c) => c.inicio.toISODate() === d.toISODate());
  if (q.franja === 'manana') l = l.filter((c) => c.inicio.hour < 14);
  if (q.franja === 'tarde') l = l.filter((c) => c.inicio.hour >= 14);
  const porId = new Map((eventos || []).map((e) => [e.id, e]));
  const cab = `🗓 <b>${capital(diaRelativo(cfg, d))}</b> · ${d.toFormat('d/LL')}${q.franja ? (q.franja === 'manana' ? ' · mañana' : ' · tarde') : ''}`;
  if (!tramosDia(cfg, d).length && !l.length) return cab + '\nEse día no abres.';
  const lineas = l.map((c) => `${ICONO_ESTADO[estadoCita(porId.get(c.id) || {}, c)]} ${lineaCita(cfg, c)}`);
  const libres = tramosLibres(huecos(cfg, eventos, d, d.endOf('day'), dur, { franja: q.franja }), dur);
  return cab + '\n' + (lineas.length ? lineas.join('\n') : 'No tienes citas.') +
    (libres.length ? '\n\n🟢 Libre: ' + libres.slice(0, 6).map((t) => `${fHora(t.ini)}–${fHora(t.fin)}`).join(', ') : (tramosDia(cfg, d).length ? '\n\nSin huecos libres.' : ''));
};

const TEXTO_AYUDA = {
  general: '🤖 <b>Soy tu asistente de agenda.</b>\n\nEscríbeme o mándame un audio como se lo dirías a tu recepcionista:\n• «Quique mañana a las 7, limpieza»\n• «Mueve a Ana del jueves a las 10»\n• «Cancela a Marta del viernes»\n• «¿Qué tengo el viernes por la tarde?»\n\nAntes de tocar tu calendario te enseño un resumen y solo lo hago si pulsas <b>Sí</b>.\n\nAtajos: /hoy /manana /huecos /informe /invitar /ayuda',
  como_funciona: '🤖 Entiendo lo que me escribes o me dices, te enseño un resumen y, cuando pulsas <b>Sí</b>, lo apunto en tu Google Calendar. Desde ahí siguen funcionando tus recordatorios y confirmaciones como siempre.\n\nNo guardo audios ni el motivo de la consulta: solo nombre, móvil y un tipo general de cita (revisión, limpieza…).',
  automatizaciones: '⚙️ Tus automatizaciones y lo que han hecho este mes están en <b>Mis automatizaciones</b>, dentro de la app (botón de abajo o /informe).',
  invitar: '👥 Para dar acceso a alguien de tu equipo escribe /invitar. Te daré un enlace de un solo uso que caduca en 48 horas; se lo pasas y listo.',
};
// ----------------------------------------------------------------------
