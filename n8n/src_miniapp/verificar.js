// Verificar · la petición viene del Worker de la Mini App:
// firma HMAC(secreto, ts.nonce.payload) correcta y marca de tiempo de menos de 60 s.
const e = $('Mini App · Entrada').first().json;
const b = e.body || {};
const calc = $json.firma_calc;
const mal = (status, error) => [{ json: { status, respuesta: { ok: false, error } } }];
if (typeof b.firma !== 'string' || typeof b.payload !== 'string' || typeof b.nonce !== 'string') return mal(400, 'formato');
if (b.firma.length !== calc.length) return mal(401, 'firma');
let dif = 0;
for (let i = 0; i < calc.length; i++) dif |= calc.charCodeAt(i) ^ b.firma.charCodeAt(i);
if (dif !== 0) return mal(401, 'firma');
const ahora = Math.floor(Date.now() / 1000);
if (!Number.isFinite(Number(b.ts)) || Math.abs(ahora - Number(b.ts)) > 60) return mal(401, 'caducada');
if (!/^[0-9a-f]{24}$/.test(b.nonce)) return mal(400, 'nonce');
let req;
try { req = JSON.parse(b.payload); } catch (x) { return mal(400, 'payload'); }
if (!['agenda', 'huecos', 'noshows', 'crear'].includes(req.op) || !/^[0-9a-f-]{36}$/.test(req.cliente_id || '')) return mal(400, 'op');
return [{ json: { ok: true, nonce: b.nonce, req } }];
