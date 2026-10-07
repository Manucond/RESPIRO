// Worker de www.respiroai.es
//  - /assets/*.mp4 → vídeos con peticiones por rangos (206), necesario para Safari en iOS.
//  - /app/*        → Mini App de Telegram (estáticos) con cabeceras de seguridad.
//  - /api/*        → API de la Mini App. Cada petición lleva el initData de Telegram,
//                    que se verifica con HMAC-SHA256 y el token del bot. El cliente se
//                    deduce SOLO de esa identidad verificada (nunca de un parámetro).
// El resto de rutas las sirven directamente los assets estáticos.
//
// Secretos (wrangler secret put / panel de Cloudflare, nunca en el repo):
//   TELEGRAM_BOT_TOKEN, SUPABASE_SERVICE_ROLE_KEY, MINIAPP_SECRETO
// Variables (wrangler.jsonc): SUPABASE_URL, N8N_MINIAPP_URL, BOT_USUARIO

const MAX_EDAD_INITDATA = 60 * 60;       // 1 h: después hay que volver a abrir la Mini App
const LIMITE_POR_MINUTO = 60;            // por usuario de Telegram
const TIPOS_OK = /^[A-Z_]{2,20}$/;
const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;
const HORA_OK = /^([01]\d|2[0-3]):[0-5]\d$/;

const CSP_APP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors https://web.telegram.org https://*.telegram.org https://telegram.org",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env, url);
    const res = await env.ASSETS.fetch(request);
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) return conCabecerasApp(res);
    if (url.pathname.endsWith('.mp4')) return rangos(request, res);
    return res;
  },
};

// ---------------------------------------------------------------- vídeos
async function rangos(request, res) {
  const range = request.headers.get('Range');
  if (!range || res.status !== 200) return res;

  const body = await res.arrayBuffer();
  const size = body.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start, end;
  if (m && m[1] !== '') {
    start = Number(m[1]);
    end = m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
  } else if (m && m[2] !== '') {
    start = Math.max(size - Number(m[2]), 0);
    end = size - 1;
  }
  if (start === undefined || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const headers = new Headers(res.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

// ---------------------------------------------------------------- cabeceras
function seguridad(h) {
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return h;
}

function conCabecerasApp(res) {
  const h = seguridad(new Headers(res.headers));
  h.set('Content-Security-Policy', CSP_APP);
  h.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, headers: h });
}

function json(obj, status = 200) {
  const h = seguridad(new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }));
  h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  return new Response(JSON.stringify(obj), { status, headers: h });
}

// ---------------------------------------------------------------- utilidades cripto
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(clave, mensaje) {
  const k = await crypto.subtle.importKey('raw', typeof clave === 'string' ? enc.encode(clave) : clave,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(mensaje));
}

function igualSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Verificación oficial de Telegram Mini Apps:
// secret = HMAC_SHA256("WebAppData", bot_token); hash = HMAC_SHA256(secret, data_check_string)
export async function verificarInitData(initData, botToken, ahoraSeg = Math.floor(Date.now() / 1000)) {
  if (!initData || typeof initData !== 'string' || initData.length > 4096 || !botToken) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  const pares = [];
  for (const [k, v] of p) if (k !== 'hash') pares.push(`${k}=${v}`);
  pares.sort();
  const secreto = await hmac('WebAppData', botToken);
  const calculado = hex(await hmac(new Uint8Array(secreto), pares.join('\n')));
  if (!igualSeguro(calculado, hash)) return null;
  const auth = Number(p.get('auth_date'));
  if (!Number.isFinite(auth) || ahoraSeg - auth > MAX_EDAD_INITDATA || auth - ahoraSeg > 60) return null;
  let user;
  try { user = JSON.parse(p.get('user') || 'null'); } catch { return null; }
  if (!user || !Number.isSafeInteger(user.id)) return null;
  return { id: user.id, nombre: user.first_name || '' };
}

// ---------------------------------------------------------------- servicios
async function rpc(env, fn, args) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error((cuerpo && cuerpo.message) || 'supabase');
    e.status = cuerpo && cuerpo.code === '42501' ? 403 : 502;
    throw e;
  }
  return cuerpo;
}

// Petición firmada a n8n: HMAC(secreto, ts.nonce.payload), con marca de tiempo anti-repetición.
export async function firmar(secreto, payload, ts = Math.floor(Date.now() / 1000)) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(12)));
  const firma = hex(await hmac(secreto, `${ts}.${nonce}.${payload}`));
  return { ts, nonce, payload, firma };
}

async function n8n(env, identidad, op, params) {
  const payload = JSON.stringify({ op, cliente_id: identidad.cliente_id, rol: identidad.rol, params });
  const r = await fetch(env.N8N_MINIAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await firmar(env.MINIAPP_SECRETO, payload)),
  });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok || !cuerpo) {
    const e = new Error('n8n');
    e.status = 502;
    throw e;
  }
  return cuerpo;
}

// ---------------------------------------------------------------- API
async function api(request, env, url) {
  // CORS cerrado: solo peticiones del mismo origen (la Mini App se sirve desde aquí).
  const origen = request.headers.get('Origin');
  if (origen && origen !== url.origin) return json({ error: 'origen' }, 403);
  if (request.method === 'OPTIONS') return json({ error: 'metodo' }, 405);
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'metodo' }, 405);

  const auth = request.headers.get('Authorization') || '';
  const usuario = await verificarInitData(auth.startsWith('tma ') ? auth.slice(4) : '', env.TELEGRAM_BOT_TOKEN);
  if (!usuario) return json({ error: 'sesion' }, 401);

  if (env.LIMITADOR) {
    const { success } = await env.LIMITADOR.limit({ key: `tg:${usuario.id}` });
    if (!success) return json({ error: 'demasiadas' }, 429);
  }

  let cuerpo = {};
  if (request.method === 'POST') {
    const t = await request.text();
    if (t.length > 4000) return json({ error: 'grande' }, 413);
    try { cuerpo = t ? JSON.parse(t) : {}; } catch { return json({ error: 'json' }, 400); }
  }
  const q = url.searchParams;
  const ruta = `${request.method} ${url.pathname}`;
  const tg = { p_tg_user_id: usuario.id };

  try {
    switch (ruta) {
      case 'GET /api/resumen':
        return json(await rpc(env, 'miniapp_resumen', tg));
      case 'GET /api/espera':
        return json(await rpc(env, 'miniapp_lista_espera', tg));
      case 'GET /api/equipo':
        return json(await rpc(env, 'miniapp_equipo', tg));
      case 'POST /api/invitar': {
        const r = await rpc(env, 'miniapp_invitar', tg);
        return json({ ...r, enlace: `https://t.me/${env.BOT_USUARIO}?start=${r.codigo}` });
      }
      case 'POST /api/parametros': {
        const p = {};
        for (const k of ['min_por_llamada', 'min_por_reserva', 'min_por_mensaje', 'coste_hora_personal', 'valor_medio_cita']) {
          if (cuerpo[k] === undefined || cuerpo[k] === '') continue;
          const n = Number(cuerpo[k]);
          if (!Number.isFinite(n) || n < 0 || n > 5000) return json({ error: 'parametros' }, 400);
          p[k] = n;
        }
        return json(await rpc(env, 'miniapp_guardar_parametros', { ...tg, p }));
      }
      case 'GET /api/agenda':
      case 'GET /api/huecos':
      case 'GET /api/noshows':
      case 'POST /api/cita': {
        const id = await rpc(env, 'miniapp_identidad', tg);
        if (ruta === 'GET /api/noshows') return json(await n8n(env, id, 'noshows', {}));
        if (ruta === 'GET /api/agenda') {
          const fecha = q.get('fecha');
          if (!FECHA_OK.test(fecha || '')) return json({ error: 'fecha' }, 400);
          return json(await n8n(env, id, 'agenda', { fecha }));
        }
        if (ruta === 'GET /api/huecos') {
          const fecha = q.get('fecha');
          const tipo = q.get('tipo') || 'OTRO';
          if (!FECHA_OK.test(fecha || '') || !TIPOS_OK.test(tipo)) return json({ error: 'parametros' }, 400);
          return json(await n8n(env, id, 'huecos', { fecha, tipo }));
        }
        const { nombre, movil, fecha, hora, tipo } = cuerpo;
        if (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.length > 80
          || !FECHA_OK.test(fecha || '') || !HORA_OK.test(hora || '') || !TIPOS_OK.test(tipo || '')
          || (movil && (typeof movil !== 'string' || movil.length > 20))) {
          return json({ error: 'datos' }, 400);
        }
        return json(await n8n(env, id, 'crear', { nombre: nombre.trim(), movil: movil || null, fecha, hora, tipo }));
      }
      default:
        return json({ error: 'ruta' }, 404);
    }
  } catch (e) {
    return json({ error: e.status === 403 ? 'sin_acceso' : 'servicio' }, e.status || 500);
  }
}
