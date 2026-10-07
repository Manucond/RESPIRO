// Comando · interpreta /comandos. Devuelve una de tres cosas:
//  { salida }                    → respuesta directa
//  { sql, luego }                → consulta a la base y luego "Comando · Respuesta"
//  { siguiente: 'consulta', q }  → necesita leer el calendario
const { m, cfg } = $json;
const [cmdRaw, ...args] = (m.texto || '').trim().split(/\s+/);
const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, '');
const arg = args.join(' ').trim();
const esAdmin = cfg.rol === 'admin';
const sinCliente = !cfg.cliente_id;
const res = (tg) => [{ json: { salida: { logs: [], tg: Array.isArray(tg) ? tg : [tg] } } }];
const sql = (q, p, luego) => [{ json: { m, cfg, sql: { q, p }, luego } }];
const consulta = (q, tipo) => [{ json: { m, cfg, siguiente: 'consulta', q, log_tipo: tipo } }];

const soloAdmin = ['/cliente', '/clientes', '/respiro', '/gasto'];
if (soloAdmin.includes(cmd) && !esAdmin) return res(tgTexto(m.chat_id, '🔒 Ese comando es solo para RESPIRO.'));
if (sinCliente && !['/cliente', '/clientes', '/invitar', '/ayuda', '/start', '/help', '/respiro', '/gasto'].includes(cmd)) {
  return res(tgTexto(m.chat_id, '🛠 Estás en el modo RESPIRO. Para ver la agenda de un cliente: /clientes y luego /cliente &lt;nombre&gt;.'));
}

switch (cmd) {
  case '/start':
  case '/ayuda':
  case '/help':
    if (sinCliente) return res(tgTexto(m.chat_id, '🛠 <b>Modo RESPIRO</b>\nPregúntame en lenguaje normal por clientes, uso del asistente, gastos de IA, errores, invitaciones, negocios de la web o solicitudes de contacto.\n\n• /gasto · gasto de IA del mes\n• /clientes · lista de clientes\n• /cliente &lt;nombre&gt; · gestionar la agenda de un cliente\n• /respiro · volver a este modo\n• /invitar &lt;cliente&gt; &lt;dueno|personal&gt;'));
    return res(tgTexto(m.chat_id, TEXTO_AYUDA.general, [botonApp('📱 Abrir mi agenda')]));
  case '/hoy':
    return consulta({ consulta: 'dia', fecha: null, franja: null }, 'consultar');
  case '/manana':
  case '/mañana':
    return consulta({ consulta: 'dia', fecha: ahora(cfg).plus({ days: 1 }).toISODate(), franja: null }, 'consultar');
  case '/huecos': {
    const f = norm(arg);
    const franja = f.includes('TARDE') ? 'tarde' : (f.includes('MANANA') && !f.startsWith('MANANA') ? 'manana' : null);
    const fecha = f.startsWith('MANANA') ? ahora(cfg).plus({ days: 1 }).toISODate() : (f.includes('HOY') ? ahora(cfg).toISODate() : null);
    return consulta({ consulta: 'huecos', fecha, franja }, 'consultar');
  }
  case '/noshows':
    return consulta({ consulta: 'no_shows' }, 'consultar');
  case '/espera':
    return sql('select respiro.lista_espera_cliente($1::uuid) as espera', [cfg.cliente_id], 'espera');
  case '/nueva':
    return res(tgTexto(m.chat_id, '✍️ Dime la cita como se la dirías a tu recepcionista, por ejemplo:\n«Quique mañana a las 7, limpieza, 600 111 222»\n\nO usa el formulario:', [botonApp('➕ Nueva cita', 'nueva')]));
  case '/cancelar':
    return res(tgTexto(m.chat_id, '🗑 Dime qué cita quieres cancelar, por ejemplo:\n«Cancela a Marta del jueves»'));
  case '/informe':
    return sql('select respiro.informe($1::uuid) as informe', [cfg.cliente_id], 'informe');
  case '/equipo':
    if (!['dueno', 'admin'].includes(cfg.rol)) return res(tgTexto(m.chat_id, '🔒 Solo el dueño puede ver el equipo.'));
    return sql('select respiro.equipo($1::uuid) as equipo', [cfg.cliente_id], 'equipo');
  case '/invitar': {
    if (esAdmin && arg) {
      const p = arg.split(/\s+/);
      const rol = ['dueno', 'personal'].includes((p[p.length - 1] || '').toLowerCase()) ? p.pop().toLowerCase() : 'dueno';
      return sql('select respiro.admin_invitar($1::bigint, $2, $3) as r', [m.chat_id, p.join(' '), rol], 'invitar');
    }
    if (esAdmin && sinCliente) return res(tgTexto(m.chat_id, 'Uso: /invitar &lt;cliente&gt; &lt;dueno|personal&gt;'));
    if (!['dueno', 'admin'].includes(cfg.rol)) return res(tgTexto(m.chat_id, '🔒 Solo el dueño puede invitar a su equipo.'));
    return sql("select jsonb_build_object('ok', true, 'codigo', respiro.crear_invitacion($1::uuid, 'personal', $2::bigint), 'cliente', $3::text, 'rol', 'personal') as r",
      [cfg.cliente_id, m.chat_id, cfg.cliente], 'invitar');
  }
  case '/respiro':
    return sql('select respiro.admin_salir_cliente($1::bigint) as r', [m.chat_id], 'respiro');
  case '/gasto':
    return [{ json: { m: { ...m, texto: arg || '¿Cuánto llevamos gastado de IA este mes, por cliente y por API? Y el total.' }, cfg, siguiente: 'admin' } }];
  case '/clientes':
    return sql('select respiro.admin_clientes() as clientes', [], 'clientes');
  case '/cliente':
    if (!arg) return res(tgTexto(m.chat_id, 'Uso: /cliente &lt;nombre&gt;'));
    return sql('select respiro.admin_cambiar_cliente($1::bigint, $2) as r', [m.chat_id, arg], 'cliente');
  default:
    return res(tgTexto(m.chat_id, '🤔 No conozco ese comando.\n\n' + TEXTO_AYUDA.general));
}
