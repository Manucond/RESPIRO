// Plan · convierte acciones en cambios concretos y comprobados. Nada se
// escribe aquí: el resultado se guarda como pendiente hasta que se pulse "Sí".
// Entradas posibles:
//  - acciones de la IA (j.acciones)
//  - respuesta escrita a una pregunta (j.pendiente + j.respuesta)
//  - botón de elección (j.pendiente + j.eleccion)
const j = $json;
const { m, cfg } = j;
const eventos = j.eventos || [];
const ESCRITURA = ['crear', 'mover', 'cancelar'];
const logs = [];
const info = [];
const admin = [];
const origen = m.tipo === 'callback' ? `tg:cb:${m.cb_id}` : `tg:m:${m.upd}`;

// --- 1. Lista de acciones de escritura a resolver ---
let acciones = [];
if (j.pendiente) {
  acciones = (j.pendiente.acciones || []).map((a) => ({ ...a }));
  const pq = j.pendiente.pregunta;
  if (j.respuesta !== undefined && pq) {
    const a = acciones[pq.i];
    if (a && pq.tipo === 'nombre') {
      a.nombre = capital(String(j.respuesta).trim().replace(/^(es |para |a )/i, '')).slice(0, 80);
    } else if (a) {
      const mv = normMovil(j.respuesta);
      if (mv) { a.movil = mv; a.persona_ok = true; a.sin_movil = false; }
      else { a.sin_movil = true; a.persona_ok = true; }
    }
  }
  if (j.eleccion) {
    const { op, i, k } = j.eleccion;
    const a = acciones[i];
    if (a && op === 'q') acciones.splice(i, 1);
    else if (a && op === 'e' && a.pregunta && a.pregunta.opciones && a.pregunta.opciones[k]) {
      const v = a.pregunta.opciones[k].v;
      if (a.pregunta.tipo === 'hora') {
        const t = dt(cfg, v);
        a.fecha = t.toISODate(); a.hora = fHora(t);
      } else if (a.pregunta.tipo === 'persona') {
        if (v === 'otra') { a.persona_otra = true; }
        else { const c = (a.candidatos || [])[Number(v)]; if (c) { a.nombre = c.nombre; a.movil = c.movil; a.persona_ok = true; } }
      } else if (a.pregunta.tipo === 'cual') {
        a.ev_id = v;
      } else if (a.pregunta.tipo === 'movil' && v === 'sin') {
        a.sin_movil = true; a.persona_ok = true;
      }
    }
  }
} else {
  for (const a of j.acciones || []) {
    if (ESCRITURA.includes(a.accion)) {
      acciones.push({ accion: a.accion, nombre: a.nombre, movil: normMovil(a.movil), codigo: a.tipo_cita ? tipoPor(cfg, a.tipo_cita).codigo : null,
        fecha: a.fecha, hora: a.hora, ref_fecha: a.ref_fecha, ref_hora: a.ref_hora, persona_ok: !!normMovil(a.movil) });
      continue;
    }
    // Acciones informativas: se responden ya
    if (a.accion === 'consultar') {
      info.push(textoConsulta(cfg, eventos, a, j.espera || []));
      logs.push(log(cfg, 'bot_agenda', 'consultar', 'ok', `${origen}:c${info.length}`, { canal: m.via_voz ? 'voz' : 'texto' }));
    } else if (a.accion === 'ayuda') {
      info.push(TEXTO_AYUDA[a.tema] || TEXTO_AYUDA.general);
    } else if (a.accion === 'demasiadas') {
      info.push('✋ Solo puedo hacer 5 cosas por mensaje. Mándame el resto en otro.');
    } else if (a.accion === 'error_ia') {
      info.push('😵 Ahora mismo no consigo entender mensajes. Puedes usar /hoy, /huecos o la app, y lo intento de nuevo en un rato.');
      logs.push(log(cfg, 'bot_agenda', 'interpretar', 'error', origen, { motivo: 'api_ia' }));
      admin.push(`⚠️ ${cfg.cliente}: la IA ha fallado (${String(j.ia_error_api || '').slice(0, 150)})`);
    } else if (a.accion === 'saludo') {
      info.push(['👋 ¡Aquí estoy! Dime qué necesitas de tu agenda.', '😊 ¡A mandar! Si necesitas algo de la agenda, dímelo como te salga.'][String(m.upd).length % 2]);
    } else {
      info.push('🙈 Perdona, no lo he pillado. ¿Quieres apuntar, mover o cancelar una cita, o mirar la agenda? Dímelo como te salga.');
      logs.push(log(cfg, 'bot_agenda', 'no_entendido', 'omitido', origen, { canal: m.via_voz ? 'voz' : 'texto' }));
    }
  }
}

// --- 2. Resolver cada acción contra el calendario (con una copia "virtual") ---
let virtual = eventos.filter((e) => e.status !== 'cancelled').map((e) => e);
const quitarVirtual = (id) => { virtual = virtual.filter((e) => e.id !== id); };
const ponerVirtual = (id, ini, fin) => { virtual.push({ id, summary: 'reservado', start: { dateTime: ini.toISO() }, end: { dateTime: fin.toISO() } }); };
const citas = citasDe(cfg, eventos);
const habit = habituales(cfg, eventos);
const hoy0 = ahora(cfg).startOf('day');
const cuando = (t) => `${diaRelativo(cfg, t)} a las ${fHora(t)}`;
const opcionesHora = (lista) => lista.map((t) => ({ t: `${capital(diaRelativo(cfg, t).replace(/^el /, ''))} ${fHora(t)}`, v: t.toISO() }));
const MOTIVO = {
  ocupado: 'está ocupado', horario: 'está fuera de tu horario', cerrado: 'ese día está cerrado', pasado: 'ya ha pasado', fecha: 'no es una fecha válida',
};

const buscarCita = (a) => {
  if (a.ev_id) return { una: citas.find((c) => c.id === a.ev_id) || null, varias: [] };
  let l = citas.filter((c) => (a.nombre ? coincideNombre(c.nombre, a.nombre) : true) && c.inicio >= hoy0);
  if (!a.nombre && !a.ref_fecha && !a.ref_hora) return { una: null, varias: [] };
  if (a.ref_fecha) l = l.filter((c) => c.inicio.toISODate() === a.ref_fecha);
  if (a.ref_hora) l = l.filter((c) => fHora(c.inicio) === a.ref_hora);
  return l.length === 1 ? { una: l[0], varias: [] } : { una: null, varias: l };
};

for (let i = 0; i < acciones.length; i++) {
  const a = acciones[i];
  a.pregunta = null;
  a.estado = 'listo';
  a.motivo = null;

  if (a.accion === 'crear') {
    a.codigo = tipoPor(cfg, a.codigo || 'OTRO').codigo;
    const dur = Number(tipoPor(cfg, a.codigo).min) || 30;
    if (!a.nombre) {
      a.estado = 'pregunta';
      a.pregunta = { tipo: 'nombre', texto: '¿Para quién es la cita? Escríbeme su nombre.', opciones: [] };
    }
    // ¿Quién es? (móvil y nombre canónico a partir de citas anteriores)
    if (!a.pregunta && !a.persona_ok && !a.movil && !a.sin_movil) {
      const cands = [];
      if (!a.persona_otra) {
        for (const h of habit) {
          if (h.movil && coincideNombre(h.nombre, a.nombre) && !cands.some((c) => c.movil === h.movil)) cands.push({ nombre: h.nombre, movil: h.movil });
        }
      }
      if (cands.length === 1) { a.nombre = cands[0].nombre; a.movil = cands[0].movil; a.persona_ok = true; }
      else if (cands.length > 1) {
        a.candidatos = cands.slice(0, 4);
        a.estado = 'pregunta';
        a.pregunta = { tipo: 'persona', texto: `Tengo varias personas llamadas «${esc(a.nombre)}». ¿Cuál es?`,
          opciones: [...a.candidatos.map((c, k) => ({ t: `${c.nombre} · ···${c.movil.slice(-3)}`, v: String(k) })), { t: 'Otra persona', v: 'otra' }] };
      } else {
        a.estado = 'pregunta';
        a.pregunta = { tipo: 'movil', texto: `¿Qué móvil tiene <b>${esc(a.nombre)}</b>? Escríbemelo, o pulsa «Sin móvil» (entonces no le llegarán recordatorios).`,
          opciones: [{ t: 'Sin móvil', v: 'sin' }] };
      }
    }
    // ¿Cuándo?
    if (!a.pregunta) {
      if (!a.fecha && a.hora) {
        const hoyH = dt(cfg, `${ahora(cfg).toISODate()}T${a.hora}`);
        a.fecha = hoyH > ahora(cfg) ? hoyH.toISODate() : ahora(cfg).plus({ days: 1 }).toISODate();
      }
      if (!a.fecha || !a.hora) {
        const base = a.fecha ? dt(cfg, a.fecha).startOf('day') : ahora(cfg);
        const ops = a.fecha ? huecos(cfg, virtual, base, base.endOf('day'), dur).filter((t, k, arr) => k === 0 || t.diff(arr[0], 'minutes').minutes % 60 === 0).slice(0, 4)
          : alternativas(cfg, virtual, base, dur, 4);
        a.estado = 'pregunta';
        a.pregunta = ops.length
          ? { tipo: 'hora', texto: `¿A qué hora apunto a <b>${esc(a.nombre)}</b>${a.fecha ? ' ' + diaRelativo(cfg, base) : ''}? Elige un hueco o dímelo.`, opciones: opcionesHora(ops) }
          : { tipo: 'hora', texto: `No veo huecos libres${a.fecha ? ' ' + diaRelativo(cfg, base) : ''} para <b>${esc(a.nombre)}</b>. Dime otro día.`, opciones: [] };
      }
    }
    if (!a.pregunta) {
      const ini = dt(cfg, `${a.fecha}T${a.hora}`);
      const fin = ini.plus({ minutes: dur });
      const h = comprobarHueco(cfg, virtual, ini, fin);
      if (!h.libre) {
        const ops = alternativas(cfg, virtual, ini.isValid ? ini : ahora(cfg), dur, 3);
        a.estado = 'pregunta';
        a.pregunta = { tipo: 'hora', texto: `Para <b>${esc(a.nombre)}</b>, ${ini.isValid ? cuando(ini) : 'esa hora'} ${MOTIVO[h.motivo]}. ${ops.length ? 'Te propongo:' : 'No encuentro huecos cerca; dime otro día.'}`, opciones: opcionesHora(ops) };
      } else {
        a.inicio = ini.toISO(); a.fin = fin.toISO();
        ponerVirtual(`nuevo${i}`, ini, fin);
      }
    }
  }

  if (a.accion === 'mover' || a.accion === 'cancelar') {
    const { una, varias } = buscarCita(a);
    if (!una && varias.length > 1) {
      a.estado = 'pregunta';
      a.pregunta = { tipo: 'cual', texto: `Hay varias citas${a.nombre ? ' de «' + esc(a.nombre) + '»' : ' que encajan'}. ¿Cuál quieres ${a.accion === 'mover' ? 'mover' : 'cancelar'}?`,
        opciones: varias.slice(0, 4).map((c) => ({ t: `${c.nombre} · ${capital(diaRelativo(cfg, c.inicio).replace(/^el /, ''))} ${fHora(c.inicio)}`, v: c.id })) };
    } else if (!una) {
      a.estado = 'imposible';
      a.motivo = !a.nombre && !a.ref_fecha && !a.ref_hora
        ? `¿Qué cita quieres ${a.accion === 'mover' ? 'mover' : 'cancelar'}? Dime de quién es o cuándo.`
        : `No encuentro ninguna cita${a.nombre ? ' de <b>' + esc(a.nombre) + '</b>' : ''}${a.ref_fecha ? ' ' + diaRelativo(cfg, dt(cfg, a.ref_fecha)) : ''}${a.ref_hora ? ' a las ' + a.ref_hora : ''}.`;
    } else {
      a.ev_id = una.id;
      a.nombre = una.nombre;
      a.movil = una.movil;
      a.codigo = una.codigo;
      a.ini_original = una.inicio.toISO();
      a.fin_original = una.fin.toISO();
      if (a.accion === 'cancelar') {
        quitarVirtual(una.id);
      } else {
        const dur = Math.max(5, Math.round(una.fin.diff(una.inicio, 'minutes').minutes));
        if (!a.fecha && !a.hora) {
          const ops = alternativas(cfg, virtual, una.inicio, dur, 4, una.id);
          a.estado = 'pregunta';
          a.pregunta = { tipo: 'hora', texto: `¿A cuándo muevo a <b>${esc(una.nombre)}</b> (ahora ${cuando(una.inicio)})?`, opciones: opcionesHora(ops) };
        } else {
          const ini = dt(cfg, `${a.fecha || una.inicio.toISODate()}T${a.hora || fHora(una.inicio)}`);
          const fin = ini.plus({ minutes: dur });
          const h = comprobarHueco(cfg, virtual, ini, fin, una.id);
          if (!h.libre) {
            const ops = alternativas(cfg, virtual, ini.isValid ? ini : una.inicio, dur, 3, una.id);
            a.estado = 'pregunta';
            a.pregunta = { tipo: 'hora', texto: `Para mover a <b>${esc(una.nombre)}</b>, ${ini.isValid ? cuando(ini) : 'esa hora'} ${MOTIVO[h.motivo]}. ${ops.length ? 'Te propongo:' : 'Dime otro día.'}`, opciones: opcionesHora(ops) };
          } else {
            a.inicio = ini.toISO(); a.fin = fin.toISO();
            quitarVirtual(una.id);
            ponerVirtual(`mov${i}`, ini, fin);
          }
        }
      }
    }
  }
}

// Las imposibles se explican y se quitan
for (const a of acciones.filter((x) => x.estado === 'imposible')) info.push('⚠️ ' + a.motivo);
acciones = acciones.filter((x) => x.estado !== 'imposible');

// --- 3. Vista ---
const linea = (a) => {
  if (a.accion === 'crear') {
    const t = a.inicio ? cuando(dt(cfg, a.inicio)) : (a.fecha ? diaRelativo(cfg, dt(cfg, a.fecha)) : '¿cuándo?');
    return `➕ Apuntar a <b>${esc(a.nombre || '¿quién?')}</b> · ${t} · ${esc(tipoPor(cfg, a.codigo).nombre)} · ${a.movil ? movilVisible(a.movil) : (a.sin_movil ? 'sin móvil' : '¿móvil?')}`;
  }
  if (a.accion === 'mover') {
    const o = a.ini_original ? cuando(dt(cfg, a.ini_original)) : '?';
    return `🔁 Mover a <b>${esc(a.nombre)}</b> · ${o} → ${a.inicio ? cuando(dt(cfg, a.inicio)) : '¿cuándo?'}`;
  }
  return `🗑 Cancelar a <b>${esc(a.nombre)}</b> · ${a.ini_original ? cuando(dt(cfg, a.ini_original)) : '?'}`;
};
const primeraPregunta = acciones.findIndex((a) => a.estado === 'pregunta');
const partes = [];
if (m.transcripcion) partes.push(`🎧 <i>«${esc(m.transcripcion)}»</i>`);
if (info.length) partes.push(info.join('\n\n'));
let botones = [];
if (acciones.length) {
  partes.push((primeraPregunta >= 0 ? '📝 <b>Esto es lo que voy a hacer:</b>\n' : '📝 <b>¿Lo hago?</b>\n') + acciones.map((a) => (a.estado === 'pregunta' ? '❓ ' : '') + linea(a)).join('\n'));
  if (primeraPregunta >= 0) {
    const a = acciones[primeraPregunta];
    partes.push('❓ ' + a.pregunta.texto);
    botones = a.pregunta.opciones.map((o, k) => [{ text: o.t.slice(0, 60), callback_data: `b|{ID}|e|${primeraPregunta}|${k}` }]);
    botones.push([{ text: '🚫 Quitar esta', callback_data: `b|{ID}|q|${primeraPregunta}` }, { text: '❌ Cancelar todo', callback_data: 'b|{ID}|no' }]);
  } else {
    botones = [[{ text: '✅ Sí, hazlo', callback_data: 'b|{ID}|si' }, { text: '❌ No', callback_data: 'b|{ID}|no' }]];
  }
} else if (j.pendiente) {
  partes.push('👌 No queda nada por hacer.');
}
const texto = partes.join('\n\n').slice(0, 4000) || '🤔 No te he entendido. ¿Qué quieres hacer?';

const base = { m, cfg, consumo: j.consumo || null, logs, admin };
if (!acciones.length) {
  const tg = [];
  if (m.tipo === 'callback') { tg.push(tgAviso(m.cb_id)); tg.push(tgEditar(m.chat_id, m.msg_id, texto, [])); }
  else tg.push(tgTexto(m.chat_id, texto));
  return [{ json: { ...base, guardar: j.pendiente ? { id: j.pendiente.id, acciones: [], estado: 'cancelado', pregunta: null } : null, vista: null, salida_directa: { tg } } }];
}
const pq = primeraPregunta >= 0 ? { i: primeraPregunta, tipo: acciones[primeraPregunta].pregunta.tipo } : null;
return [{ json: { ...base,
  guardar: { id: j.pendiente ? j.pendiente.id : null, acciones, estado: pq && ['movil', 'nombre'].includes(pq.tipo) ? 'esperando_dato' : 'pendiente', pregunta: pq },
  vista: { texto, botones },
} }];
