// Mini App · Creado: resultado de la escritura en Google Calendar + log sin datos personales.
const prev = $('Mini App · Operar').first().json;
const r = $json;
const err = r.error;
const dup = err && /409|already exists/i.test(JSON.stringify(err));
const okk = !err || dup;
return [{ json: {
  status: 200,
  respuesta: okk ? { ok: true } : { ok: false, error: 'calendario' },
  logs: [log(prev.cfg, 'bot_agenda', 'crear', okk ? 'ok' : 'error', `mini:${prev.nonce}`, { canal: 'miniapp', tipo_cita: prev.tipo })],
} }];
