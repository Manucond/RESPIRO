// Comando · Respuesta: da formato al resultado de la consulta SQL del comando.
const x = $('Comando').item.json;
const { m, cfg, luego } = x;
const r = $json;
const tg = [];
const logs = [];
const enlace = (cod) => `https://t.me/${G.bot_usuario}?start=${cod}`;
switch (luego) {
  case 'espera':
    tg.push(tgTexto(m.chat_id, textoConsulta(cfg, [], { consulta: 'lista_espera' }, r.espera)));
    logs.push(log(cfg, 'bot_agenda', 'consultar', 'ok', `tg:m:${m.upd}`, { canal: 'comando' }));
    break;
  case 'informe': {
    const i = r.informe || {};
    const mes = i.mes || {};
    const a = i.ahorro_estimado || {};
    const lineas = [
      ['📞 Llamadas atendidas', mes.llamadas_atendidas],
      ['🤖 Citas reservadas solas', mes.citas_sin_intervencion],
      ['💬 Citas con el asistente', mes.citas_por_asistente],
      ['⏰ Recordatorios', mes.recordatorios],
      ['✅ Confirmaciones', mes.confirmaciones],
      ['🔁 Huecos rellenados', mes.huecos_rellenados],
      ['⭐ Reseñas pedidas', mes.resenas_pedidas],
    ].filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}: <b>${v}</b>`);
    const estado = i.todo_en_marcha ? '🟢 Todo en marcha' : '🟠 Hay algo que revisar (míralo en la app)';
    tg.push(tgTexto(m.chat_id,
      `📊 <b>Este mes</b>\n${estado}\n\n${lineas.length ? lineas.join('\n') : 'Todavía no hay actividad registrada este mes.'}` +
      `\n\n⏱ Ahorro estimado: <b>${a.horas || 0} h</b> (≈ ${a.euros_tiempo || 0} €)` +
      `\n<i>Es una estimación con tus parámetros; puedes ajustarlos en la app.</i>`,
      [botonApp('📈 Ver informe completo', 'informes')]));
    break;
  }
  case 'equipo': {
    const l = r.equipo || [];
    const rol = { dueno: 'dueño', personal: 'equipo' };
    tg.push(tgTexto(m.chat_id, '👥 <b>Tu equipo</b>\n' + (l.length ? l.map((u) => `• ${esc(u.nombre || 'Sin nombre')} · ${rol[u.rol] || u.rol}`).join('\n') : 'Nadie todavía.') + '\n\nPara añadir a alguien: /invitar'));
    break;
  }
  case 'invitar': {
    const v = r.r || {};
    if (!v.ok) {
      tg.push(tgTexto(m.chat_id, '⚠️ No he podido crear la invitación' + ({ no_existe: ': no encuentro ese cliente.', ambiguo: ': hay varios clientes con ese nombre, sé más concreto.', no_admin: '.', rol: ': el rol debe ser dueno o personal.' }[v.motivo] || '.')));
    } else {
      tg.push(tgTexto(m.chat_id,
        `🎟 Invitación para <b>${esc(v.cliente)}</b> (${v.rol === 'dueno' ? 'dueño' : 'equipo'}).\nReenvía este enlace a quien quieras dar acceso. Sirve <b>una sola vez</b> y caduca en 48 horas:\n\n${enlace(v.codigo)}`));
    }
    break;
  }
  case 'clientes': {
    const l = r.clientes || [];
    tg.push(tgTexto(m.chat_id, '🏢 <b>Clientes</b>\n' + (l.length ? l.map((c) => `• ${esc(c.nombre)} · ${c.usuarios} usuarios${c.calendario ? '' : ' · ⚠️ sin calendario'}`).join('\n') : 'Ninguno.') + '\n\nCambia con /cliente &lt;nombre&gt;'));
    break;
  }
  case 'respiro':
    tg.push(tgTexto(m.chat_id, '🛠 <b>Modo RESPIRO</b>. Pregúntame lo que quieras sobre clientes, uso o gastos. Por ejemplo: «¿cuánto ha gastado cada cliente este mes?» o «¿qué automatizaciones han fallado esta semana?».'));
    break;
  case 'cliente': {
    const v = r.r || {};
    tg.push(tgTexto(m.chat_id, v.ok ? `🛠 Ahora estás viendo <b>${esc(v.cliente)}</b>. Para volver al modo RESPIRO: /respiro` : '⚠️ ' + ({ no_existe: 'No encuentro ese cliente.', ambiguo: 'Hay varios clientes con ese nombre.', no_admin: 'Solo para admins.' }[v.motivo] || 'No he podido cambiar.')));
    break;
  }
}
return [{ json: { salida: { logs, tg } } }];
