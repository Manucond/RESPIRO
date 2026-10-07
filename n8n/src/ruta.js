// Ruta · decide qué camino sigue el mensaje.
const { cfg, m } = $json;
const t = (m.texto || '').trim();
const start = t.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})$/);
const adminSinCliente = cfg && cfg.rol === 'admin' && !cfg.cliente_id;
let ruta;
if (start) ruta = 'start';
else if (!cfg) ruta = 'fija';
else if (m.tipo === 'callback') ruta = adminSinCliente ? 'fija' : 'callback';
else if (t.startsWith('/')) ruta = 'comando';
else if (adminSinCliente && m.tipo === 'texto') ruta = 'admin';    // modo RESPIRO: preguntas sobre datos
else if (adminSinCliente) ruta = 'fija';
else if (m.tipo === 'voz') ruta = 'voz';
else if (m.tipo === 'texto') ruta = 'texto';
else ruta = 'fija';
return [{ json: { m, cfg, ruta, codigo: start ? start[1] : null } }];
