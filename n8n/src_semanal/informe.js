// Informe semanal: un mensaje por dueño con el resumen agregado (sin datos de pacientes),
// el robot y un botón que abre la Mini App en Informes. Respeta el horario de silencio.
const out = [];
for (const it of $input.all()) {
  const { nombre, cliente_id, informe } = it.json;
  const chat_id = Number(it.json.chat_id);  // bigint llega como texto desde Postgres
  if (!chat_id || !informe) continue;
  const cfg = { cliente_id, zona_horaria: 'Europe/Madrid' };
  const ah = ahora(cfg);
  const semanaIso = `${ah.weekYear}-W${String(ah.weekNumber).padStart(2, '0')}`;
  const origen = `semanal:${cliente_id}:${semanaIso}:${chat_id}`;
  const sem = informe.semanas || [];
  const pasada = sem.length >= 2 ? sem[sem.length - 2].ok : 0;
  const anterior = sem.length >= 3 ? sem[sem.length - 3].ok : 0;
  const mes = informe.mes || {};
  const a = informe.ahorro_estimado || {};
  const lineas = [
    ['📞', 'llamadas atendidas', mes.llamadas_atendidas], ['🤖', 'citas reservadas solas', mes.citas_sin_intervencion],
    ['💬', 'citas con el asistente', mes.citas_por_asistente], ['⏰', 'recordatorios', mes.recordatorios],
    ['✅', 'confirmaciones', mes.confirmaciones], ['🔁', 'huecos rellenados', mes.huecos_rellenados], ['⭐', 'reseñas pedidas', mes.resenas_pedidas],
  ].filter(([, , v]) => Number(v) > 0).map(([i, t, v]) => `${i} ${v} ${t}`);
  const tendencia = pasada > anterior ? `📈 ${pasada - anterior} más que la semana anterior.` : pasada < anterior ? `📉 ${anterior - pasada} menos que la semana anterior.` : 'Igual que la semana anterior.';
  const texto = `👋 ¡Buenos días${nombre ? ', ' + esc(nombre.split(' ')[0]) : ''}!\n\n` +
    `📊 <b>Tu semana con RESPIRO</b>\nLa semana pasada tus automatizaciones hicieron <b>${pasada}</b> tareas. ${tendencia}\n` +
    `${informe.todo_en_marcha ? '🟢 Todo en marcha.' : '🟠 Hay algo que revisar: míralo en la app.'}\n\n` +
    `<b>En lo que va de mes</b>\n${lineas.length ? lineas.join('\n') : 'Todavía sin actividad.'}\n\n` +
    `⏱ Ahorro estimado: <b>${a.horas || 0} h</b> (≈ ${a.euros_tiempo || 0} €). <i>Es una estimación con tus parámetros.</i>`;
  out.push({ json: {
    tg: tgFoto(chat_id, robot(informe.todo_en_marcha ? 'contento' : 'confundido'), texto.slice(0, 1024), [botonApp('📈 Ver informes', 'informes')]),
    log: log(cfg, 'informe_semanal', 'enviado', 'ok', origen),
  } });
}
return out;
