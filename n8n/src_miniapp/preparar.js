// Mini App · Preparar: comprueba repetición (nonce), cliente y rango de lectura.
const { nuevo, cfg, req } = $json;
const mal = (status, error) => [{ json: { status, respuesta: { ok: false, error } } }];
if (!nuevo) return mal(409, 'repetida');
if (!cfg) return mal(403, 'cliente');
if (!cfg.calendario_id) return mal(200, 'sin_calendario');
const p = req.params || {};
let min; let max;
if (req.op === 'noshows') { max = ahora(cfg); min = max.minus({ days: 31 }).startOf('day'); }
else {
  const d = dt(cfg, p.fecha);
  if (!d.isValid) return mal(400, 'fecha');
  min = d.startOf('day'); max = d.endOf('day');
}
return [{ json: { cfg, req, nonce: $('Verificar').first().json.nonce, rango: { min: min.toISO(), max: max.toISO() } } }];
