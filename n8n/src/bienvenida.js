// Bienvenida tras canjear una invitación (/start CODIGO).
const r = $json.r || {};
const { m } = $json.x;
const tg = [];
if (r.ok) {
  const quien = m.nombre_tg ? ', ' + esc(m.nombre_tg.split(' ')[0]) : '';
  const rol = r.rol === 'dueno' ? 'Ya puedes gestionar tu agenda e invitar a tu equipo con /invitar.' : 'Ya puedes gestionar la agenda.';
  tg.push(tgFoto(m.chat_id, robot('contento'),
    `👋 ¡Hola${quien}! Soy el asistente de <b>${esc(r.cliente)}</b>.\n${rol}\n\nPruébame: escribe «¿qué tengo hoy?» o mándame un audio.`,
    [botonApp('📱 Abrir mi agenda')]));
} else {
  const motivo = { usado: 'Ese enlace ya se ha usado.', caducado: 'Ese enlace ha caducado.', es_admin: 'Eres admin: usa /cliente para cambiar de cliente.' }[r.motivo]
    || 'Ese enlace no es válido.';
  tg.push(tgTexto(m.chat_id, `🔒 ${motivo} Pide uno nuevo a RESPIRO.`));
}
return [{ json: { salida: { logs: [], tg } } }];
