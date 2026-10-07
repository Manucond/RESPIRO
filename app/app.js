// RESPIRO · Mini App de Telegram. Sin dependencias: HTML, CSS y JS.
// La identidad viaja en cada petición como "Authorization: tma <initData>";
// el servidor la verifica y deduce el cliente. Aquí no se decide nada de permisos.
(() => {
  'use strict';
  const tg = window.Telegram && window.Telegram.WebApp;
  const vista = document.getElementById('vista');
  const hoja = document.getElementById('hoja');
  const estado = { resumen: null, dia: null, ruta: 'hoy', cache: {} };

  // ------------------------------------------------------------ utilidades
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n) => new Intl.NumberFormat('es-ES').format(Number(n) || 0);
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sumarDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const deISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const diaSemana = (d) => d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '');
  const fechaLarga = (s) => deISO(s).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const haceCuanto = (iso) => {
    if (!iso) return 'todavía no se ha ejecutado';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'ayer' : `hace ${d} días`;
  };
  const vibrar = (t = 'light') => { try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(t); } catch (e) { /* sin vibración */ } };
  const robot = (exp, texto, sub = '', peque = false) =>
    `<div class="estado-vacio${peque ? ' estado-vacio--peque' : ''}${exp === 'pensando' ? ' cargando' : ''}">
       <img src="robot/${exp}.svg" alt="" width="112" height="112">
       <p><b>${texto}</b></p>${sub ? `<p class="suave">${sub}</p>` : ''}</div>`;

  // ------------------------------------------------------------ API
  class ErrorApi extends Error { constructor(codigo, status) { super(codigo); this.codigo = codigo; this.status = status; } }
  async function api(ruta, opciones = {}) {
    const r = await fetch(ruta, {
      method: opciones.metodo || 'GET',
      headers: { Authorization: 'tma ' + ((tg && tg.initData) || ''), ...(opciones.cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErrorApi(j.error || 'servicio', r.status);
    return j;
  }
  const textoError = (e) => ({
    sesion: ['La sesión ha caducado', 'Cierra la app y vuelve a abrirla desde el bot.'],
    sin_acceso: ['No tienes acceso', 'Pide tu enlace de invitación a RESPIRO.'],
    demasiadas: ['Vas muy rápido', 'Espera unos segundos y vuelve a intentarlo.'],
    sin_calendario: ['Tu calendario aún no está conectado', 'Avisa a RESPIRO y lo dejamos listo.'],
  }[e.codigo] || ['Algo no ha ido bien', 'Inténtalo de nuevo en un momento.']);
  const pintarError = (e, destino = vista) => {
    const [t, s] = textoError(e);
    destino.innerHTML = robot('confundido', t, s) + (e.codigo === 'sesion' || e.codigo === 'sin_acceso' ? '' : '<button class="boton boton--secundario" data-reintentar>Reintentar</button>');
    const b = destino.querySelector('[data-reintentar]');
    if (b) b.addEventListener('click', () => navegar());
  };

  // ------------------------------------------------------------ hoja inferior
  function abrirHoja(titulo, html) {
    document.getElementById('hoja-titulo').textContent = titulo;
    document.getElementById('hoja-cuerpo').innerHTML = html;
    if (typeof hoja.showModal === 'function') hoja.showModal(); else hoja.setAttribute('open', '');
    return document.getElementById('hoja-cuerpo');
  }
  document.getElementById('hoja-cerrar').addEventListener('click', () => hoja.close());
  hoja.addEventListener('click', (e) => { if (e.target === hoja) hoja.close(); });


  // ------------------------------------------------------------ CHAT (pantalla principal)
  // Mismo asistente que en Telegram: texto o nota de voz → resumen con botones → Sí.
  // El historial solo vive mientras la app está abierta (no se guarda en el móvil).
  const ETIQUETAS_OK = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', CODE: 'code' };
  function htmlSeguro(html) {
    // El bot manda HTML sencillo (<b>, <i>). Se reconstruye nodo a nodo: nada más pasa.
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const copiar = (origen, destino) => {
      origen.childNodes.forEach((n) => {
        if (n.nodeType === 3) destino.appendChild(document.createTextNode(n.textContent));
        else if (n.nodeType === 1) {
          const tag = ETIQUETAS_OK[n.tagName];
          const el = tag ? document.createElement(tag) : document.createDocumentFragment();
          copiar(n, el);
          destino.appendChild(el);
        }
      });
    };
    const frag = document.createDocumentFragment();
    copiar(doc.body.firstChild, frag);
    return frag;
  }

  const SUGERENCIAS = ['¿Qué tengo hoy?', '¿Huecos libres mañana?', 'Apunta una cita', '¿Cómo va la semana?'];
  let grabador = null;

  function pantallaChat() {
    vista.classList.add('vista--chat');
    vista.innerHTML = `
      <div class="chat">
        <div class="chat__lista" id="chat-lista" role="log" aria-live="polite" aria-label="Conversación con el asistente"></div>
        <div class="sugerencias" id="chat-sugerencias">${SUGERENCIAS.map((t) => `<button class="chip" data-sugerencia="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <form class="redactor" id="chat-form">
          <textarea id="chat-texto" rows="1" maxlength="1000" placeholder="Escribe o graba un audio…" aria-label="Mensaje"></textarea>
          <button type="button" class="boton boton--icono" id="chat-boton" aria-label="Grabar nota de voz">🎤</button>
        </form>
      </div>`;
    if (!estado.chat) {
      const nombre = (estado.resumen.usuario.nombre || '').split(' ')[0];
      estado.chat = [{ de: 'bot', texto: `👋 ¡Hola${nombre ? ', ' + esc(nombre) : ''}! Soy tu asistente de agenda.\nEscríbeme o mándame un audio como se lo dirías a tu recepcionista. Antes de tocar tu calendario te enseño un resumen.`, foto: 'robot/normal.svg' }];
    }
    estado.chat.forEach((m) => pintarMensaje(m));
    document.getElementById('chat-sugerencias').hidden = estado.chat.some((m) => m.de === 'yo');
    vista.querySelectorAll('[data-sugerencia]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.sugerencia === 'Apunta una cita') { const t = document.getElementById('chat-texto'); t.value = 'Apunta a '; t.focus(); actualizarBoton(); return; }
      enviarTexto(b.dataset.sugerencia);
    }));
    const texto = document.getElementById('chat-texto');
    texto.addEventListener('input', () => { texto.style.height = 'auto'; texto.style.height = Math.min(texto.scrollHeight, 120) + 'px'; actualizarBoton(); });
    texto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); enviarDesdeCaja(); } });
    document.getElementById('chat-form').addEventListener('submit', (e) => { e.preventDefault(); enviarDesdeCaja(); });
    document.getElementById('chat-boton').addEventListener('click', () => {
      if (texto.value.trim()) enviarDesdeCaja(); else empezarGrabacion();
    });
    bajar();
  }

  function actualizarBoton() {
    const b = document.getElementById('chat-boton');
    if (!b) return;
    const hay = !!document.getElementById('chat-texto').value.trim();
    b.textContent = hay ? '➤' : '🎤';
    b.setAttribute('aria-label', hay ? 'Enviar' : 'Grabar nota de voz');
  }
  const bajar = () => { const l = document.getElementById('chat-lista'); if (l) l.scrollTop = l.scrollHeight; };

  function pintarMensaje(m) {
    const lista = document.getElementById('chat-lista');
    if (!lista) return;
    const div = document.createElement('div');
    div.className = 'burbuja burbuja--' + m.de;
    if (m.foto) { const img = document.createElement('img'); img.className = 'foto'; img.alt = ''; img.src = m.foto.replace(/^https:\/\/[^/]+\/app\//, '').replace(/\.png$/, '.svg'); div.appendChild(img); }
    if (m.de === 'bot') div.appendChild(htmlSeguro(m.texto)); else div.appendChild(document.createTextNode(m.texto));
    if (m.botones && m.botones.length) {
      const caja = document.createElement('div');
      caja.className = 'burbuja__botones';
      m.botones.flat().forEach((b) => {
        const el = document.createElement('button');
        el.className = 'chip';
        el.textContent = b.texto;
        el.disabled = !!m.usado;
        el.addEventListener('click', () => {
          if (b.seccion) { location.hash = '#/' + (b.seccion === 'nueva' ? 'nueva' : b.seccion); return; }
          m.usado = true;
          caja.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          enviarBoton(b, m);
        });
        caja.appendChild(el);
      });
      div.appendChild(caja);
    }
    m.el = div;
    lista.appendChild(div);
    bajar();
  }

  function escribiendo(mostrar) {
    const lista = document.getElementById('chat-lista');
    const prev = document.getElementById('escribiendo');
    if (prev) prev.remove();
    if (!mostrar || !lista) return;
    const d = document.createElement('div');
    d.id = 'escribiendo';
    d.className = 'burbuja burbuja--bot escribiendo';
    d.innerHTML = '<img src="robot/pensando.svg" alt=""><span class="puntos" aria-label="El asistente está pensando"><span></span><span></span><span></span></span>';
    lista.appendChild(d);
    bajar();
  }

  function recibir(r, origen) {
    escribiendo(false);
    for (const x of r.mensajes || []) {
      if (x.quitar_botones) continue;
      const m = { de: 'bot', texto: x.texto || '', botones: x.botones || [], foto: x.foto };
      // Una edición sustituye al resumen cuyo botón se pulsó (como en Telegram).
      if (x.reemplaza && origen && origen.el) {
        Object.assign(origen, m, { usado: false });
        const viejo = origen.el;
        pintarMensaje(origen);
        viejo.replaceWith(origen.el);
        continue;
      }
      estado.chat.push(m);
      pintarMensaje(m);
    }
    if (!(r.mensajes || []).length) { const m = { de: 'bot', texto: '👌' }; estado.chat.push(m); pintarMensaje(m); }
  }

  function fallo(e, origen) {
    escribiendo(false);
    if (origen) { origen.usado = false; origen.el.querySelectorAll('button').forEach((x) => { x.disabled = false; }); }
    const [t, s2] = e.codigo === 'transcripcion' ? ['No he podido escuchar el audio', '¿Me lo escribes?'] : textoError(e);
    const m = { de: 'bot', texto: `😵 ${t}. ${s2}` };
    estado.chat.push(m);
    pintarMensaje(m);
  }

  async function enviarTexto(texto) {
    const t = texto.trim();
    if (!t) return;
    document.getElementById('chat-sugerencias').hidden = true;
    const m = { de: 'yo', texto: t };
    estado.chat.push(m);
    pintarMensaje(m);
    escribiendo(true);
    vibrar();
    try { recibir(await api('/api/chat', { metodo: 'POST', cuerpo: { tipo: 'texto', texto: t } })); } catch (e) { fallo(e); }
  }
  function enviarDesdeCaja() {
    const caja = document.getElementById('chat-texto');
    const t = caja.value;
    caja.value = ''; caja.style.height = ''; actualizarBoton();
    enviarTexto(t);
  }
  async function enviarBoton(b, origen) {
    escribiendo(true);
    vibrar();
    try { recibir(await api('/api/chat', { metodo: 'POST', cuerpo: { tipo: 'callback', data: b.data } }), origen); } catch (e) { fallo(e, origen); }
  }

  // --- Notas de voz ---
  const FORMATOS = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
  async function empezarGrabacion() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return sinMicro();
    let flujo;
    try { flujo = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return sinMicro(e && e.name === 'NotAllowedError'); }
    const tipo = FORMATOS.find((f) => MediaRecorder.isTypeSupported(f)) || '';
    const rec = new MediaRecorder(flujo, tipo ? { mimeType: tipo } : undefined);
    const trozos = [];
    const inicio = Date.now();
    grabador = { rec, flujo, cancelado: false };
    rec.ondataavailable = (e) => { if (e.data && e.data.size) trozos.push(e.data); };
    rec.onstop = () => {
      flujo.getTracks().forEach((t) => t.stop());
      clearInterval(grabador.reloj);
      const seg = Math.max(1, Math.round((Date.now() - inicio) / 1000));
      const cancelado = grabador.cancelado;
      grabador = null;
      restaurarRedactor();
      if (!cancelado) enviarAudio(new Blob(trozos, { type: (rec.mimeType || tipo || 'audio/webm') }), seg);
    };
    rec.start();
    vibrar('medium');
    const form = document.getElementById('chat-form');
    form.innerHTML = `<div class="grabacion" role="status"><span class="rec" aria-hidden="true"></span><span id="grab-tiempo">0:00</span>
        <span class="suave">Grabando…</span><button type="button" class="boton boton--peque boton--secundario" id="grab-cancelar">Cancelar</button></div>
      <button type="button" class="boton boton--icono grabando" id="grab-enviar" aria-label="Enviar nota de voz">➤</button>`;
    document.getElementById('grab-cancelar').addEventListener('click', () => { grabador.cancelado = true; rec.stop(); });
    document.getElementById('grab-enviar').addEventListener('click', () => rec.stop());
    grabador.reloj = setInterval(() => {
      const s2 = Math.round((Date.now() - inicio) / 1000);
      const el = document.getElementById('grab-tiempo');
      if (el) el.textContent = `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, '0')}`;
      if (s2 >= 120 && rec.state === 'recording') rec.stop();   // máximo 2 minutos
    }, 250);
  }
  function restaurarRedactor() {
    const form = document.getElementById('chat-form');
    if (!form) return;
    form.innerHTML = `<textarea id="chat-texto" rows="1" maxlength="1000" placeholder="Escribe o graba un audio…" aria-label="Mensaje"></textarea>
      <button type="button" class="boton boton--icono" id="chat-boton" aria-label="Grabar nota de voz">🎤</button>`;
    const texto = document.getElementById('chat-texto');
    texto.addEventListener('input', () => { texto.style.height = 'auto'; texto.style.height = Math.min(texto.scrollHeight, 120) + 'px'; actualizarBoton(); });
    texto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); enviarDesdeCaja(); } });
    document.getElementById('chat-boton').addEventListener('click', () => { if (texto.value.trim()) enviarDesdeCaja(); else empezarGrabacion(); });
  }
  async function enviarAudio(blob, seg) {
    document.getElementById('chat-sugerencias').hidden = true;
    const m = { de: 'yo', texto: `🎤 Nota de voz · ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}` };
    estado.chat.push(m);
    pintarMensaje(m);
    escribiendo(true);
    try {
      const r = await fetch('/api/voz', { method: 'POST', body: blob,
        headers: { Authorization: 'tma ' + ((tg && tg.initData) || ''), 'Content-Type': blob.type.split(';')[0], 'X-Duracion': String(seg) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new ErrorApi(j.error || 'servicio', r.status);
      if (j.transcripcion) { m.texto = `🎤 «${j.transcripcion}»`; m.el.textContent = m.texto; }
      recibir(j);
    } catch (e) { fallo(e); }
  }
  function sinMicro(denegado) {
    const m = { de: 'bot', texto: denegado
      ? '🎤 No tengo permiso para usar el micrófono. Puedes darlo en los ajustes de Telegram, o mandarme el audio por el chat de Telegram.'
      : '🎤 Aquí no puedo usar el micrófono. Mándame el audio por el chat de Telegram: lo entiendo igual.', botones: [[{ texto: 'Ir al chat de Telegram', cerrar: true }]] };
    estado.chat.push(m);
    pintarMensaje(m);
    const ult = m.el.querySelector('.burbuja__botones button');
    if (ult) { const nuevo = ult.cloneNode(true); ult.replaceWith(nuevo); nuevo.addEventListener('click', () => { if (tg && tg.close) tg.close(); }); }
  }

  // ------------------------------------------------------------ HOY
  const ESTADO_TXT = { confirmada: '✓ Confirmada', pendiente: 'Pendiente', no_vino: '✕ No vino' };
  async function pantallaHoy() {
    const hoy = new Date();
    if (!estado.dia) estado.dia = isoLocal(hoy);
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i));
    vista.innerHTML = `
      <div class="tira" role="group" aria-label="Día">
        ${dias.map((d, i) => `<button class="chip dia" data-dia="${isoLocal(d)}" aria-pressed="${isoLocal(d) === estado.dia}">
          <small>${i === 0 ? 'hoy' : i === 1 ? 'mañana' : diaSemana(d)}</small><b>${d.getDate()}</b></button>`).join('')}
      </div>
      <div class="tira" role="group" aria-label="Accesos rápidos">
        <button class="chip" data-rapido="huecos">🟢 Huecos libres</button>
        <button class="chip" data-rapido="espera">📋 Lista de espera</button>
        <button class="chip" data-rapido="noshows">❌ No-shows</button>
        <button class="chip" data-rapido="resenas">⭐ Reseñas pendientes</button>
      </div>
      <section class="tarjeta" aria-labelledby="t-agenda">
        <div class="tarjeta__cab"><h2 id="t-agenda">${esc(fechaLarga(estado.dia).replace(/^./, (c) => c.toUpperCase()))}</h2><span class="suave" id="n-citas"></span></div>
        <a class="boton boton--secundario boton--peque" href="#/nueva">➕ Nueva cita</a>
        <div id="agenda">${robot('pensando', 'Mirando tu agenda…', '', true)}</div>
      </section>`;
    vista.querySelectorAll('[data-dia]').forEach((b) => b.addEventListener('click', () => { estado.dia = b.dataset.dia; vibrar(); pantallaHoy(); }));
    vista.querySelectorAll('[data-rapido]').forEach((b) => b.addEventListener('click', () => rapido(b.dataset.rapido)));
    const destino = document.getElementById('agenda');
    try {
      const a = await api(`/api/agenda?fecha=${estado.dia}`);
      estado.cache['agenda:' + estado.dia] = a;
      pintarAgenda(a, destino);
    } catch (e) { pintarError(e, destino); }
  }

  function pintarAgenda(a, destino) {
    if (a.error === 'sin_calendario') {
      destino.innerHTML = robot('confundido', 'Tu calendario aún no está conectado', 'Avisa a RESPIRO y lo dejamos listo.');
      return;
    }
    const filas = [
      ...(a.citas || []).map((c) => ({ t: c.hora, html: `<li class="cita">
          <span class="cita__hora">${esc(c.hora)}</span>
          <span><span class="cita__nombre">${esc(c.nombre)}</span><br><span class="cita__tipo">${esc(c.tipo)}</span></span>
          <span class="estado estado--${esc(c.estado)}">${ESTADO_TXT[c.estado] || ''}</span></li>` })),
      ...(a.libres || []).map((l) => ({ t: l.desde, html: `<li class="cita cita--libre">
          <span class="cita__hora">${esc(l.desde)}</span>
          <span><span class="cita__nombre">Hueco libre</span><br><span class="cita__tipo">${esc(l.desde)}–${esc(l.hasta)}</span></span>
          <button class="boton boton--peque boton--secundario" data-apuntar="${esc(l.desde)}" aria-label="Apuntar cita a las ${esc(l.desde)}">Apuntar</button></li>` })),
    ].sort((x, y) => x.t.localeCompare(y.t));
    document.getElementById('n-citas').textContent = a.citas && a.citas.length ? `${a.citas.length} cita${a.citas.length === 1 ? '' : 's'}` : '';
    if (a.cerrado && !filas.length) { destino.innerHTML = robot('durmiendo', 'Este día no abres'); return; }
    if (!filas.length) { destino.innerHTML = robot('durmiendo', 'No hay citas ni huecos', 'Día completo o sin horario.'); return; }
    destino.innerHTML = (a.citas && a.citas.length ? '' : `<p class="suave">No tienes citas este día. Todo está libre:</p>`) +
      `<ul class="citas">${filas.map((f) => f.html).join('')}</ul>`;
    destino.querySelectorAll('[data-apuntar]').forEach((b) => b.addEventListener('click', () => {
      estado.nueva = { fecha: estado.dia, hora: b.dataset.apuntar };
      location.hash = '#/nueva';
    }));
  }

  async function rapido(cual) {
    vibrar();
    if (cual === 'huecos') {
      const c = abrirHoja('Huecos libres', robot('pensando', 'Buscando huecos…', '', true));
      try {
        const dias = [];
        for (let i = 0; i < 3; i++) {
          const f = isoLocal(sumarDias(new Date(), i));
          const a = estado.cache['agenda:' + f] || await api(`/api/agenda?fecha=${f}`);
          estado.cache['agenda:' + f] = a;
          dias.push([f, a]);
        }
        c.innerHTML = dias.map(([f, a]) => `<div><h3>${esc(fechaLarga(f))}</h3>
          <p class="suave">${a.cerrado ? 'Cerrado' : (a.libres || []).length ? a.libres.map((l) => `${esc(l.desde)}–${esc(l.hasta)}`).join(' · ') : 'Completo'}</p></div>`).join('');
      } catch (e) { pintarError(e, c); }
    } else if (cual === 'espera') {
      const c = abrirHoja('Lista de espera', robot('pensando', 'Cargando…', '', true));
      try {
        const l = await api('/api/espera');
        c.innerHTML = l.length ? `<ul class="lista">${l.map((x) => `<li><b>${esc(x.nombre)}</b><br><span class="suave">${esc(x.tipo)}${x.preferencia ? ' · ' + esc(x.preferencia) : ''}</span></li>`).join('')}</ul>`
          : robot('durmiendo', 'Nadie en lista de espera', '', true);
      } catch (e) { pintarError(e, c); }
    } else if (cual === 'noshows') {
      const c = abrirHoja('No-shows (30 días)', robot('pensando', 'Cargando…', '', true));
      try {
        const r = await api('/api/noshows');
        c.innerHTML = r.citas && r.citas.length
          ? `<p><b>${r.citas.length}</b> ${r.citas.length === 1 ? 'persona no vino' : 'personas no vinieron'} en los últimos 30 días.</p>
             <ul class="lista">${r.citas.map((x) => `<li><b>${esc(x.nombre)}</b><br><span class="suave">${esc(x.fecha)} · ${esc(x.hora)}</span></li>`).join('')}</ul>`
          : robot('contento', 'Nadie ha faltado', 'En los últimos 30 días todos vinieron.', true);
      } catch (e) { pintarError(e, c); }
    } else if (cual === 'resenas') {
      const activa = (estado.resumen.informe.estado || []).some((a) => a.clave === 'resena');
      abrirHoja('Reseñas pendientes', activa
        ? robot('normal', 'Las peticiones de reseña salen solas', 'Verás cuántas se han pedido en Informes.', true)
        : robot('durmiendo', 'Aún no tienes activadas las reseñas', 'Pregunta a RESPIRO cómo pedir reseñas automáticamente tras cada cita.', true));
    }
  }

  // ------------------------------------------------------------ NUEVA CITA
  async function pantallaNueva() {
    const tipos = estado.resumen.tipos_cita || [];
    const pre = estado.nueva || {};
    estado.nueva = null;
    const hoy = isoLocal(new Date());
    vista.innerHTML = `
      <form class="tarjeta" id="form-cita" novalidate>
        <h2>Nueva cita</h2>
        <p class="suave">Para cuando el asistente dude o prefieras rellenarlo tú. Se guarda directamente en tu calendario.</p>
        <div class="campo"><label for="f-nombre">Nombre</label>
          <input id="f-nombre" name="nombre" autocomplete="off" maxlength="80" required placeholder="Nombre y apellido"></div>
        <div class="campo"><label for="f-movil">Móvil</label>
          <input id="f-movil" name="movil" inputmode="tel" autocomplete="off" maxlength="20" placeholder="600 000 000">
          <label class="check"><input type="checkbox" id="f-sinmovil"> No tengo su móvil (no recibirá recordatorios)</label></div>
        <fieldset class="campo"><legend>Tipo de cita</legend>
          <div class="opciones" role="radiogroup">${tipos.map((t, i) => `<button type="button" class="chip" role="radio" data-tipo="${esc(t.codigo)}" aria-pressed="${i === 0}" aria-checked="${i === 0}">${esc(t.nombre)}</button>`).join('')}</div>
          <small>Solo el tipo general. No hace falta poner el motivo.</small></fieldset>
        <div class="campo"><label for="f-fecha">Día</label><input id="f-fecha" type="date" min="${hoy}" value="${esc(pre.fecha || hoy)}" required></div>
        <div class="campo"><label for="f-hora">Hora</label><select id="f-hora" required><option value="">Elige el día y el tipo…</option></select>
          <small id="f-hora-info"></small></div>
        <p class="error" id="f-error" role="alert"></p>
        <button class="boton boton--principal" type="submit" id="f-guardar">Guardar cita</button>
      </form>`;
    const f = document.getElementById('form-cita');
    const tipoSel = () => (f.querySelector('[data-tipo][aria-pressed="true"]') || {}).dataset?.tipo || 'OTRO';
    f.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => {
      f.querySelectorAll('[data-tipo]').forEach((x) => { x.setAttribute('aria-pressed', 'false'); x.setAttribute('aria-checked', 'false'); });
      b.setAttribute('aria-pressed', 'true'); b.setAttribute('aria-checked', 'true'); vibrar(); cargarHoras();
    }));
    const sinMovil = document.getElementById('f-sinmovil');
    sinMovil.addEventListener('change', () => { document.getElementById('f-movil').disabled = sinMovil.checked; });
    document.getElementById('f-fecha').addEventListener('change', cargarHoras);

    async function cargarHoras(preferida) {
      const sel = document.getElementById('f-hora');
      const info = document.getElementById('f-hora-info');
      const fecha = document.getElementById('f-fecha').value;
      sel.innerHTML = '<option value="">Buscando huecos…</option>';
      sel.disabled = true;
      try {
        const r = await api(`/api/huecos?fecha=${fecha}&tipo=${encodeURIComponent(tipoSel())}`);
        if (r.error === 'sin_calendario') throw new ErrorApi('sin_calendario', 200);
        const h = r.horas || [];
        sel.innerHTML = h.length ? h.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('') : '<option value="">No hay huecos este día</option>';
        if (typeof preferida === 'string' && h.includes(preferida)) sel.value = preferida;
        info.textContent = h.length ? `${h.length} horas libres para ${r.duracion} min.` : (r.cerrado ? 'Ese día no abres.' : 'Prueba con otro día.');
        sel.disabled = !h.length;
      } catch (e) { sel.innerHTML = '<option value="">No se han podido cargar</option>'; info.textContent = textoError(e)[1]; }
    }
    cargarHoras(pre.hora);

    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = document.getElementById('f-error');
      const datos = {
        nombre: document.getElementById('f-nombre').value.trim(),
        movil: sinMovil.checked ? null : document.getElementById('f-movil').value.trim(),
        fecha: document.getElementById('f-fecha').value,
        hora: document.getElementById('f-hora').value,
        tipo: tipoSel(),
      };
      err.textContent = '';
      if (datos.nombre.length < 2) { err.textContent = 'Escribe el nombre.'; return; }
      if (!sinMovil.checked && !/^\+?[\d\s]{9,16}$/.test(datos.movil || '')) { err.textContent = 'Escribe un móvil válido o marca que no lo tienes.'; return; }
      if (!datos.hora) { err.textContent = 'Elige una hora libre.'; return; }
      const confirmar = await new Promise((res) => {
        const t = `¿Apuntar a ${datos.nombre} el ${fechaLarga(datos.fecha)} a las ${datos.hora}?`;
        if (tg && tg.showConfirm && tg.platform !== 'unknown') tg.showConfirm(t, res); else res(window.confirm(t));
      });
      if (!confirmar) return;
      const b = document.getElementById('f-guardar');
      b.disabled = true; b.textContent = 'Guardando…';
      try {
        const r = await api('/api/cita', { metodo: 'POST', cuerpo: datos });
        if (r.ok) {
          try { tg.HapticFeedback.notificationOccurred('success'); } catch (e) { /* nada */ }
          delete estado.cache['agenda:' + datos.fecha];
          vista.innerHTML = robot('contento', '¡Apuntado!', `${esc(datos.nombre)} · ${esc(fechaLarga(datos.fecha))} a las ${esc(datos.hora)}`) +
            '<button class="boton boton--principal" id="ver-dia">Ver ese día</button><button class="boton boton--secundario" id="otra">Apuntar otra</button>';
          document.getElementById('ver-dia').addEventListener('click', () => { estado.dia = datos.fecha; location.hash = '#/hoy'; });
          document.getElementById('otra').addEventListener('click', () => pantallaNueva());
        } else {
          err.textContent = r.error === 'ocupado' ? 'Ese hueco se acaba de ocupar. Elige otra hora.' : 'No se ha podido guardar. Revisa los datos.';
          b.disabled = false; b.textContent = 'Guardar cita';
          if (r.error === 'ocupado') cargarHoras();
        }
      } catch (e) { err.textContent = textoError(e).join('. '); b.disabled = false; b.textContent = 'Guardar cita'; }
    });
  }

  // ------------------------------------------------------------ INFORMES
  const METRICAS = [
    ['llamadas_atendidas', '📞 Llamadas atendidas'],
    ['citas_sin_intervencion', '🤖 Citas reservadas solas'],
    ['citas_por_asistente', '💬 Citas con el asistente'],
    ['recordatorios', '⏰ Recordatorios enviados'],
    ['confirmaciones', '✅ Confirmaciones recibidas'],
    ['huecos_rellenados', '🔁 Huecos rellenados'],
    ['resenas_pedidas', '⭐ Reseñas pedidas'],
  ];
  async function pantallaInformes(recargar = true) {
    if (recargar) {
      vista.innerHTML = robot('pensando', 'Preparando tus informes…');
      try { estado.resumen = await api('/api/resumen'); } catch (e) { pintarError(e); return; }
    }
    const i = estado.resumen.informe;
    const esDueno = ['dueno', 'admin'].includes(estado.resumen.usuario.rol);
    const mes = i.mes || {};
    const ant = i.mes_anterior || {};
    const activas = METRICAS.filter(([k]) => Number(mes[k]) > 0 || Number(ant[k]) > 0);
    const SEM = { verde: ['✓', 'En marcha'], ambar: ['!', 'Revisar'], rojo: ['✕', 'Con errores'] };
    const a = i.ahorro_estimado || {};
    vista.innerHTML = `
      <section class="tarjeta" aria-labelledby="t-estado">
        <div class="resumen-estado">
          <img src="robot/${i.todo_en_marcha ? 'contento' : 'confundido'}.svg" alt="" width="56" height="56">
          <div><h2 id="t-estado">${i.todo_en_marcha ? 'Todo en marcha' : 'Hay algo que revisar'}</h2>
          <p class="suave">${i.todo_en_marcha ? 'Tus automatizaciones están funcionando.' : 'Alguna automatización lleva tiempo sin ejecutarse o ha fallado.'}</p></div>
        </div>
        ${(i.estado || []).length ? `<ul class="semaforo">${i.estado.map((s) => `<li>
          <span class="punto punto--${esc(s.semaforo)}" aria-hidden="true">${SEM[s.semaforo][0]}</span>
          <div><b>${esc(s.nombre)}</b> · <span class="suave">${SEM[s.semaforo][1]}</span><br>
          <span class="suave">Última vez: ${esc(haceCuanto(s.ultima))}${s.errores_24h ? ` · ${s.errores_24h} errores en 24 h` : ''}</span></div></li>`).join('')}</ul>`
          : '<p class="suave">Aún no hay automatizaciones activas.</p>'}
      </section>

      <section class="tarjeta" aria-labelledby="t-mes">
        <div class="tarjeta__cab"><h2 id="t-mes">Este mes</h2><span class="suave">frente al mismo punto del mes pasado</span></div>
        ${activas.length ? `<div class="kpis">${activas.map(([k, et]) => {
          const v = Number(mes[k]) || 0; const p = Number(ant[k]) || 0; const d = v - p;
          return `<div class="kpi"><span class="kpi__etiqueta">${et}</span><span class="kpi__valor">${fmtNum(v)}</span>
            <span class="kpi__delta">${d === 0 ? 'igual que el mes pasado' : `${d > 0 ? '▲ +' : '▼ '}${fmtNum(d)} vs. mes pasado`}</span></div>`;
        }).join('')}</div>` : robot('durmiendo', 'Todavía no hay actividad este mes', 'En cuanto tus automatizaciones trabajen, lo verás aquí.', true)}
      </section>

      <section class="tarjeta" aria-labelledby="t-tend">
        <div class="tarjeta__cab"><h2 id="t-tend">Tendencia semanal</h2></div>
        <p class="suave">Tareas hechas por tus automatizaciones cada semana. La última es la semana en curso.</p>
        <div class="leyenda"><span><i class="rec"></i>Últimas 4 semanas</span><span><i class="ant"></i>4 semanas anteriores</span></div>
        <div id="grafico"></div>
        <p class="globo" id="globo" aria-live="polite"></p>
        <details><summary>Ver como tabla</summary><div id="tabla"></div></details>
      </section>

      <section class="tarjeta" aria-labelledby="t-ahorro">
        <div class="tarjeta__cab"><h2 id="t-ahorro">Ahorro estimado este mes</h2><span class="etiqueta">Estimación</span></div>
        <p><span class="heroe">${fmtNum(a.horas)}</span> <b>horas</b></p>
        <p class="suave">≈ ${fmtNum(a.euros_tiempo)} € de tiempo de personal${Number(a.euros_huecos) > 0 ? ` y ≈ ${fmtNum(a.euros_huecos)} € en huecos recuperados` : ''}.</p>
        <p class="suave">Se calcula con tus parámetros: ${fmtNum(i.parametros.min_por_llamada)} min por llamada, ${fmtNum(i.parametros.min_por_reserva)} min por cita, ${fmtNum(i.parametros.min_por_mensaje)} min por mensaje, ${fmtNum(i.parametros.coste_hora_personal)} €/h y ${fmtNum(i.parametros.valor_medio_cita)} € por cita. No es una cifra garantizada.</p>
        ${esDueno ? '<button class="boton boton--secundario" id="ajustar">Ajustar parámetros</button>' : ''}
      </section>`;
    grafico(i.semanas || []);
    const b = document.getElementById('ajustar');
    if (b) b.addEventListener('click', ajustarParametros);
  }

  // Barras semanales en SVG a mano: columnas ≤24 px, extremo redondeado de 4 px,
  // separación de 2 px, rejilla fina, valor solo en la última semana, toque = valor.
  function grafico(semanas) {
    const cont = document.getElementById('grafico');
    if (!semanas.length) { cont.innerHTML = ''; return; }
    const W = 320; const H = 170; const izq = 30; const abajo = 24; const arriba = 18;
    const max = Math.max(1, ...semanas.map((s) => s.ok));
    const paso = max <= 5 ? 1 : Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
    const tope = Math.ceil(max / paso) * paso;
    const ancho = (W - izq) / semanas.length;
    const barra = Math.min(24, ancho - 2);
    const y = (v) => arriba + (H - arriba - abajo) * (1 - v / tope);
    const etiqueta = (s) => { const d = deISO(s.semana); return `${d.getDate()}/${d.getMonth() + 1}`; };
    let svg = `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tareas por semana en las últimas 8 semanas">`;
    for (let v = 0; v <= tope; v += paso) {
      svg += `<line class="rejilla" x1="${izq}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="eje" x="${izq - 6}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v)}</text>`;
    }
    semanas.forEach((s, k) => {
      const x = izq + k * ancho + (ancho - barra) / 2;
      const alto = Math.max(0, H - abajo - y(s.ok));
      const cls = k >= semanas.length - 4 ? 'rec' : 'ant';
      const r = Math.min(4, alto, barra / 2);
      // columna con esquinas superiores redondeadas y base recta
      const d = alto > 0
        ? `M${x},${H - abajo} V${H - abajo - alto + r} Q${x},${H - abajo - alto} ${x + r},${H - abajo - alto} H${x + barra - r} Q${x + barra},${H - abajo - alto} ${x + barra},${H - abajo - alto + r} V${H - abajo} Z`
        : '';
      svg += `<path class="${cls}" data-k="${k}" d="${d}"/>`;
      svg += `<text class="eje" x="${x + barra / 2}" y="${H - 6}" text-anchor="middle">${etiqueta(s)}</text>`;
      if (k === semanas.length - 1) svg += `<text class="valor" x="${x + barra / 2}" y="${H - abajo - alto - 5}" text-anchor="middle">${fmtNum(s.ok)}</text>`;
      svg += `<rect class="zona" data-k="${k}" x="${izq + k * ancho}" y="0" width="${ancho}" height="${H}" tabindex="0" aria-label="Semana del ${etiqueta(s)}: ${s.ok} tareas"/>`;
    });
    svg += '</svg>';
    cont.innerHTML = svg;
    const globo = document.getElementById('globo');
    const marcar = (k) => {
      cont.querySelectorAll('path').forEach((p) => p.classList.toggle('activa', p.dataset.k !== String(k)));
      const s = semanas[k];
      globo.textContent = `Semana del ${etiqueta(s)}${Number(k) === semanas.length - 1 ? ' (en curso)' : ''}: ${fmtNum(s.ok)} tareas`;
    };
    cont.querySelectorAll('.zona').forEach((z) => {
      z.addEventListener('click', () => { marcar(z.dataset.k); vibrar(); });
      z.addEventListener('mouseenter', () => marcar(z.dataset.k));
      z.addEventListener('focus', () => marcar(z.dataset.k));
    });
    const rec = semanas.slice(-4).reduce((a, s) => a + s.ok, 0);
    const prev = semanas.slice(0, 4).reduce((a, s) => a + s.ok, 0);
    globo.textContent = `Últimas 4 semanas: ${fmtNum(rec)} · 4 anteriores: ${fmtNum(prev)}`;
    document.getElementById('tabla').innerHTML = `<table><thead><tr><th>Semana del</th><th class="num">Tareas</th></tr></thead><tbody>
      ${semanas.map((s) => `<tr><td>${etiqueta(s)}</td><td class="num">${fmtNum(s.ok)}</td></tr>`).join('')}</tbody></table>`;
  }

  function ajustarParametros() {
    const p = estado.resumen.informe.parametros;
    const campo = (k, et, paso, ayuda) => `<div class="campo"><label for="p-${k}">${et}</label>
      <input id="p-${k}" type="number" inputmode="decimal" min="0" step="${paso}" value="${esc(p[k])}"><small>${ayuda}</small></div>`;
    const c = abrirHoja('Parámetros del ahorro', `
      <p class="suave">Ajusta estos valores a tu negocio. Con ellos calculamos la estimación; no cambian lo que hacen tus automatizaciones.</p>
      <div class="parametros">
        ${campo('min_por_llamada', 'Min por llamada', '0.5', 'Lo que tardaría tu personal')}
        ${campo('min_por_reserva', 'Min por cita', '0.5', 'Apuntar o mover una cita')}
        ${campo('min_por_mensaje', 'Min por mensaje', '0.5', 'Recordatorio o reseña')}
        ${campo('coste_hora_personal', '€ por hora', '1', 'Coste de una hora de personal')}
        ${campo('valor_medio_cita', '€ por cita', '1', 'Ingreso medio de una cita')}
      </div>
      <p class="error" id="p-error" role="alert"></p>
      <button class="boton boton--principal" id="p-guardar">Guardar</button>`);
    c.querySelector('#p-guardar').addEventListener('click', async () => {
      const cuerpo = {};
      c.querySelectorAll('input').forEach((x) => { cuerpo[x.id.slice(2)] = x.value; });
      try {
        const inf = await api('/api/parametros', { metodo: 'POST', cuerpo });
        estado.resumen.informe = inf;
        hoja.close();
        pantallaInformes(false);
      } catch (e) { c.querySelector('#p-error').textContent = e.codigo === 'parametros' ? 'Revisa los números.' : textoError(e).join('. '); }
    });
  }

  // ------------------------------------------------------------ EQUIPO
  async function pantallaEquipo() {
    vista.innerHTML = robot('pensando', 'Cargando tu equipo…');
    let l;
    try { l = await api('/api/equipo'); } catch (e) { pintarError(e); return; }
    const ROL = { dueno: 'Dueño', personal: 'Equipo' };
    vista.innerHTML = `
      <section class="tarjeta" aria-labelledby="t-eq">
        <h2 id="t-eq">Tu equipo</h2>
        <ul class="lista">${l.map((u) => `<li><b>${esc(u.nombre || 'Sin nombre')}</b> · <span class="suave">${ROL[u.rol] || esc(u.rol)} desde ${esc(u.desde)}</span></li>`).join('')}</ul>
      </section>
      <section class="tarjeta" aria-labelledby="t-inv">
        <h2 id="t-inv">Invitar a alguien</h2>
        <p class="suave">Genera un enlace para tu recepcionista o tu equipo. Sirve una sola vez y caduca en 48 horas.</p>
        <div id="invitacion"></div>
        <button class="boton boton--principal" id="generar">Generar invitación</button>
      </section>`;
    document.getElementById('generar').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      const d = document.getElementById('invitacion');
      try {
        const r = await api('/api/invitar', { metodo: 'POST' });
        d.innerHTML = `<p class="enlace-invitacion">${esc(r.enlace)}</p><div class="fila-botones">
          <button class="boton boton--principal" id="compartir">Compartir</button><button class="boton boton--secundario" id="copiar">Copiar</button></div>`;
        document.getElementById('compartir').addEventListener('click', () => {
          const u = `https://t.me/share/url?url=${encodeURIComponent(r.enlace)}&text=${encodeURIComponent('Te invito al asistente de agenda de RESPIRO')}`;
          if (tg && tg.openTelegramLink) tg.openTelegramLink(u); else window.open(u);
        });
        document.getElementById('copiar').addEventListener('click', async (e2) => {
          try { await navigator.clipboard.writeText(r.enlace); e2.target.textContent = 'Copiado'; } catch (x) { e2.target.textContent = 'Mantén pulsado el enlace'; }
        });
        ev.target.hidden = true;
      } catch (e) { pintarError(e, d); ev.target.disabled = false; }
    });
  }

  // ------------------------------------------------------------ AYUDA
  function pantallaAyuda() {
    const p = (q, r) => `<details class="tarjeta"><summary><b>${q}</b></summary><p>${r}</p></details>`;
    vista.innerHTML = [
      p('¿Cómo apunto una cita?', 'Escríbele al bot o mándale un audio: «Quique mañana a las 7, limpieza». Te enseña un resumen y solo lo guarda si pulsas <b>Sí</b>. También puedes usar <b>Nueva</b> aquí abajo.'),
      p('¿Puedo hacer varias cosas en un mensaje?', 'Sí, hasta 5: «Pon a Ana el jueves a las 10, cancela a Marta del viernes y dime qué tengo mañana».'),
      p('¿Dónde se guardan las citas?', 'En tu Google Calendar, como siempre. Desde ahí siguen funcionando tus recordatorios y confirmaciones.'),
      p('¿Qué datos guarda el asistente?', 'Solo nombre, móvil y un tipo general de cita (revisión, limpieza…). No guarda audios ni el motivo de la consulta. Los informes solo tienen números.'),
      p('¿Cómo invito a mi recepcionista?', 'En <b>Equipo</b> pulsa «Generar invitación» y envíale el enlace. También puedes escribir /invitar en el bot.'),
      p('¿Qué es el ahorro estimado?', 'Una estimación hecha con tus parámetros (minutos por llamada, valor de una cita…). Puedes ajustarlos en Informes.'),
      p('¿Algo no funciona?', 'Escríbenos y lo miramos: RESPIRO te atiende directamente.'),
    ].join('');
  }

  // ------------------------------------------------------------ navegación
  const PANTALLAS = { chat: pantallaChat, hoy: pantallaHoy, nueva: pantallaNueva, informes: pantallaInformes, equipo: pantallaEquipo, ayuda: pantallaAyuda };
  function navegar() {
    let ruta = (location.hash.replace('#/', '') || 'chat').split('?')[0];
    if (!PANTALLAS[ruta]) ruta = 'chat';
    if (grabador && grabador.rec.state === 'recording') { grabador.cancelado = true; grabador.rec.stop(); }
    vista.classList.toggle('vista--chat', ruta === 'chat');
    if (ruta === 'equipo' && !['dueno', 'admin'].includes(estado.resumen.usuario.rol)) ruta = 'chat';
    estado.ruta = ruta;
    const pestana = ruta === 'nueva' ? 'hoy' : ruta;
    document.querySelectorAll('.pestanas a').forEach((a) => {
      if (a.dataset.ruta === pestana) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (tg && tg.BackButton) { if (ruta === 'chat') tg.BackButton.hide(); else tg.BackButton.show(); }
    window.scrollTo(0, 0);
    PANTALLAS[ruta]();
  }

  function aplicarTema() {
    const oscuro = tg && tg.colorScheme ? tg.colorScheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.tema = oscuro ? 'oscuro' : 'claro';
  }

  async function iniciar() {
    if (tg) {
      tg.ready();
      tg.expand();
      try { tg.setHeaderColor('secondary_bg_color'); } catch (e) { /* versiones antiguas */ }
      tg.onEvent('themeChanged', aplicarTema);
      if (tg.BackButton) tg.BackButton.onClick(() => { location.hash = estado.ruta === 'nueva' ? '#/hoy' : '#/chat'; });
    }
    aplicarTema();
    if (!tg || !tg.initData) {
      vista.innerHTML = robot('confundido', 'Abre esta app desde Telegram', 'Pulsa el botón «Mi agenda» en el chat con el asistente de RESPIRO.');
      document.querySelector('.pestanas').hidden = true;
      return;
    }
    vista.innerHTML = robot('pensando', 'Un momento…');
    try {
      estado.resumen = await api('/api/resumen');
    } catch (e) {
      pintarError(e);
      document.querySelector('.pestanas').hidden = true;
      return;
    }
    const u = estado.resumen.usuario;
    document.getElementById('hola').textContent = `Hola${u.nombre ? ', ' + u.nombre.split(' ')[0] : ''}`;
    document.getElementById('cliente').textContent = estado.resumen.informe.cliente || 'RESPIRO';
    document.getElementById('pestana-equipo').hidden = !['dueno', 'admin'].includes(u.rol);
    window.addEventListener('hashchange', navegar);
    // start_param permite abrir directamente en una sección (p. ej. desde el informe semanal)
    // ?s=informes (botones del bot) o start_param (enlaces t.me/...?startapp=informes)
    const inicio = new URLSearchParams(location.search).get('s') || (tg.initDataUnsafe && tg.initDataUnsafe.start_param);
    if (inicio && PANTALLAS[inicio] && !location.hash.startsWith('#/')) location.hash = '#/' + inicio; else navegar();
  }

  iniciar();
})();
