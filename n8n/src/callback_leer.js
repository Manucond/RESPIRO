// Callback · Leer: interpreta el botón pulsado. Formato: b|<id>|si|no|e|q[|i[|k]]
const { m, cfg } = $json;
const p = String(m.cb_data || '').split('|');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if (p[0] !== 'b' || !UUID.test(p[1] || '') || !['si', 'no', 'e', 'q'].includes(p[2])) {
  return [{ json: { salida: { logs: [], tg: [tgAviso(m.cb_id, 'Este botón ya no funciona.')] } } }];
}
const op = p[2];
return [{ json: { m, cfg, pid: p[1], op, i: Number(p[3] || 0), k: Number(p[4] || 0) } }];
