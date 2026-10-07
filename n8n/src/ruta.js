// Ruta · decide qué camino sigue el mensaje.
const { cfg, m } = $json;
const t = (m.texto || '').trim();
const start = t.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})$/);
let ruta;
if (start) ruta = 'start';
else if (!cfg) ruta = 'fija';
else if (m.tipo === 'callback') ruta = 'callback';
else if (t.startsWith('/')) ruta = 'comando';
else if (m.tipo === 'voz') ruta = 'voz';
else if (m.tipo === 'texto') ruta = 'texto';
else ruta = 'fija';
// Un admin sin cliente elegido solo puede usar comandos.
if (cfg && !cfg.cliente_id && !['comando', 'start'].includes(ruta)) ruta = 'fija';
return [{ json: { m, cfg, ruta, codigo: start ? start[1] : null } }];
