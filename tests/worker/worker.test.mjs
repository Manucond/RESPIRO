// Pruebas del Worker de la Mini App (node --test).
// Integración real: código del Worker + funciones de Supabase (vía psql como service_role)
// + n8n local con el flujo "RESPIRO · Mini App API" + Google Calendar simulado.
// Requiere el entorno de tests/n8n/entorno.py arrancado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import worker, { verificarInitData, firmar } from '../../worker.js';

const TOKEN = '123456:TOKENPRUEBA';
const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const MOCK = 'http://localhost:8080';
const N8N = 'http://localhost:5678/webhook/respiro-miniapp';
const SECRETO = 'secreto-miniapp-prueba';
const fetchReal = globalThis.fetch;

const sql = (q) => execFileSync('docker', ['exec', '-i', 'respiro-pg', 'psql', '-U', 'postgres', '-At', '-q', '-c', q], { encoding: 'utf8' }).trim();

// Supabase simulado: cada RPC se ejecuta de verdad en Postgres con el rol service_role.
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('http://supabase.prueba/rest/v1/rpc/')) {
    const fn = u.split('/').pop();
    const args = JSON.parse(init.body || '{}');
    const lista = Object.entries(args).map(([k, v]) => `${k} => ${typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : Number(v)}`).join(', ');
    try {
      const out = execFileSync('docker', ['exec', '-i', 'respiro-pg', 'psql', '-U', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-c',
        `set role service_role; select public.${fn}(${lista})::text;`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return new Response(out.trim() || 'null', { status: 200 });
    } catch (e) {
      const permiso = /sin_acceso|solo_dueno|permission denied/.test(String(e.stderr));
      return new Response(JSON.stringify({ code: permiso ? '42501' : 'P0001', message: String(e.stderr).slice(0, 200) }), { status: permiso ? 403 : 400 });
    }
  }
  return fetchReal(url, init);
};

const env = {
  TELEGRAM_BOT_TOKEN: TOKEN, SUPABASE_URL: 'http://supabase.prueba', SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio',
  N8N_MINIAPP_URL: N8N, N8N_CHAT_URL: 'http://localhost:5678/webhook/respiro-chat', MINIAPP_SECRETO: SECRETO, BOT_USUARIO: 'RespiroPruebaBot',
  MISTRAL_BASE: MOCK, MISTRAL_API_KEY: 'clave-mistral-prueba',
  ASSETS: { fetch: async () => new Response('<!doctype html><title>x</title>', { status: 200, headers: { 'content-type': 'text/html' } }) },
};

function initData(userId, { authDate = Math.floor(Date.now() / 1000), token = TOKEN, extra = {} } = {}) {
  const campos = { auth_date: String(authDate), query_id: 'AAH' + userId, user: JSON.stringify({ id: userId, first_name: 'Prueba' }), ...extra };
  const dcs = Object.keys(campos).sort().map((k) => `${k}=${campos[k]}`).join('\n');
  const secreto = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secreto).update(dcs).digest('hex');
  return new URLSearchParams({ ...campos, hash }).toString();
}

async function pedir(ruta, { usuario, metodo = 'GET', cuerpo, origen, init } = {}) {
  const h = {};
  if (usuario || init) h.Authorization = 'tma ' + (init || initData(usuario));
  if (origen) h.Origin = origen;
  if (cuerpo) h['Content-Type'] = 'application/json';
  const r = await worker.fetch(new Request('https://www.respiroai.es' + ruta, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined }), env);
  return { status: r.status, j: await r.json().catch(() => null), h: r.headers };
}

const hoy = new Date();
const iso = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const manana = iso(new Date(hoy.getTime() + 86400000));

test.before(async () => {
  const horario = JSON.stringify(Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, [['09:00', '21:00']]])));
  sql(`truncate respiro.clientes, respiro.processed_events, respiro.codigos_invitacion cascade; delete from respiro.usuarios_bot;
    insert into respiro.clientes (id, nombre, calendario_id, horario) values ('${A}', 'Clínica A', 'cal-a', '${horario}'), ('${B}', 'Clínica B', 'cal-b', '${horario}');
    insert into respiro.clientes_automatizaciones (cliente_id, clave) select id, k from respiro.clientes, unnest(array['bot_agenda','recordatorio']) k;
    insert into respiro.usuarios_bot (chat_id, telegram_user_id, cliente_id, rol, nombre) values
      (101, 101, '${A}', 'dueno', 'Ana'), (102, 102, '${A}', 'personal', 'Pepa'), (201, 201, '${B}', 'dueno', 'Bea');
    select respiro.log_evento('${A}', 'recordatorio', 'enviado', 'ok', 'w:a' || g) from generate_series(1, 4) g;
    select respiro.log_evento('${B}', 'recordatorio', 'enviado', 'ok', 'w:b' || g) from generate_series(1, 9) g;`);
  await fetchReal(MOCK + '/_mock/reset', { method: 'POST', body: '{}' });
  const ev = (n, h, m = 30) => ({ id: 'e' + n.replace(/\W/g, '') + h, status: 'confirmed', summary: `${n} · +34600000000 · REVISION`,
    start: { dateTime: `${manana}T${h}:00+02:00` }, end: { dateTime: `${manana}T${h.slice(0, 3)}${m}:00+02:00` } });
  await fetchReal(MOCK + '/_mock/calendario/cal-a', { method: 'POST', body: JSON.stringify([ev('Ana Vidal', '10:00')]) });
  await fetchReal(MOCK + '/_mock/calendario/cal-b', { method: 'POST', body: JSON.stringify([ev('Bruno B', '11:00')]) });
});

test('initData: firma correcta se acepta y alterada se rechaza', async () => {
  const ok = await verificarInitData(initData(101), TOKEN);
  assert.equal(ok.id, 101);
  const alterado = initData(101).replace('101', '201');
  assert.equal(await verificarInitData(alterado, TOKEN), null);
  assert.equal(await verificarInitData(initData(101, { token: '999:OTRO' }), TOKEN), null);
});

test('initData: caducado (2 h) o del futuro se rechaza', async () => {
  const ahora = Math.floor(Date.now() / 1000);
  assert.equal(await verificarInitData(initData(101, { authDate: ahora - 7200 }), TOKEN), null);
  assert.equal(await verificarInitData(initData(101, { authDate: ahora + 600 }), TOKEN), null);
});

test('API sin initData o con firma falsa → 401', async () => {
  assert.equal((await pedir('/api/resumen')).status, 401);
  assert.equal((await pedir('/api/resumen', { init: 'user=%7B%22id%22%3A101%7D&auth_date=1&hash=abc' })).status, 401);
});

test('Usuario de Telegram no registrado → sin acceso', async () => {
  const r = await pedir('/api/resumen', { usuario: 555 });
  assert.equal(r.status, 403);
  assert.equal(r.j.error, 'sin_acceso');
});

test('CORS cerrado: otro origen → 403', async () => {
  assert.equal((await pedir('/api/resumen', { usuario: 101, origen: 'https://malo.example' })).status, 403);
});

test('Resumen: cada cliente ve solo sus datos (dos clientes)', async () => {
  const a = await pedir('/api/resumen', { usuario: 101 });
  const b = await pedir('/api/resumen', { usuario: 201 });
  assert.equal(a.status, 200);
  assert.equal(a.j.informe.cliente, 'Clínica A');
  assert.equal(a.j.informe.mes.recordatorios, 4);
  assert.equal(b.j.informe.cliente, 'Clínica B');
  assert.equal(b.j.informe.mes.recordatorios, 9);
  assert.equal(a.j.informe.ahorro_estimado.es_estimacion, true);
});

test('Un parámetro cliente_id en la petición se ignora', async () => {
  const r = await pedir(`/api/resumen?cliente_id=${B}`, { usuario: 101 });
  assert.equal(r.j.informe.cliente, 'Clínica A');
});

test('Agenda vía n8n firmada: A ve su agenda y no la de B', async () => {
  const a = await pedir(`/api/agenda?fecha=${manana}`, { usuario: 101 });
  assert.equal(a.status, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j.citas.map((c) => c.nombre), ['Ana Vidal']);
  assert.equal(a.j.citas[0].tipo, 'revisión');
  assert.ok(a.j.libres.length > 0);
  const b = await pedir(`/api/agenda?fecha=${manana}`, { usuario: 201 });
  assert.deepEqual(b.j.citas.map((c) => c.nombre), ['Bruno B']);
});

test('Huecos para un tipo: no ofrece la hora ocupada', async () => {
  const r = await pedir(`/api/huecos?fecha=${manana}&tipo=REVISION`, { usuario: 101 });
  assert.equal(r.status, 200);
  assert.ok(!r.j.horas.includes('10:00'));
  assert.ok(r.j.horas.includes('11:00'));
  assert.equal(r.j.duracion, 30);
});

test('Nueva cita desde la Mini App → evento en Calendar con formato y log', async () => {
  const r = await pedir('/api/cita', { usuario: 102, metodo: 'POST', cuerpo: { nombre: 'Lola Prieto', movil: '600 123 456', fecha: manana, hora: '12:00', tipo: 'LIMPIEZA' } });
  assert.equal(r.status, 200);
  assert.equal(r.j.ok, true, JSON.stringify(r.j));
  const cal = await (await fetchReal(MOCK + '/_mock/calendario/cal-a')).json();
  const e = cal.find((x) => x.summary.startsWith('Lola'));
  assert.equal(e.summary, 'Lola Prieto · +34600123456 · LIMPIEZA');
  assert.ok(e.start.dateTime.startsWith(`${manana}T12:00`));
  assert.equal(sql(`select count(*) from respiro.eventos_automatizacion where cliente_id='${A}' and metadatos->>'canal'='miniapp' and resultado='ok'`), '1');
  const calB = await (await fetchReal(MOCK + '/_mock/calendario/cal-b')).json();
  assert.ok(!calB.some((x) => x.summary.startsWith('Lola')));
});

test('Nueva cita en hueco ocupado → error "ocupado", nada se crea', async () => {
  const antes = (await (await fetchReal(MOCK + '/_mock/calendario/cal-a')).json()).length;
  const r = await pedir('/api/cita', { usuario: 101, metodo: 'POST', cuerpo: { nombre: 'Otro', movil: null, fecha: manana, hora: '10:00', tipo: 'REVISION' } });
  assert.equal(r.j.ok, false);
  assert.equal(r.j.error, 'ocupado');
  assert.equal((await (await fetchReal(MOCK + '/_mock/calendario/cal-a')).json()).length, antes);
});

test('Datos inválidos en nueva cita → 400', async () => {
  const r = await pedir('/api/cita', { usuario: 101, metodo: 'POST', cuerpo: { nombre: 'X', fecha: 'mañana', hora: '25:00', tipo: 'revision' } });
  assert.equal(r.status, 400);
});

test('Invitar y parámetros: solo el dueño', async () => {
  assert.equal((await pedir('/api/invitar', { usuario: 102, metodo: 'POST' })).status, 403);
  const r = await pedir('/api/invitar', { usuario: 101, metodo: 'POST' });
  assert.match(r.j.enlace, /^https:\/\/t\.me\/RespiroPruebaBot\?start=[0-9a-f]{32}$/);
  assert.equal((await pedir('/api/parametros', { usuario: 102, metodo: 'POST', cuerpo: { valor_medio_cita: 1 } })).status, 403);
  const p = await pedir('/api/parametros', { usuario: 101, metodo: 'POST', cuerpo: { valor_medio_cita: 55 } });
  assert.equal(Number(p.j.parametros.valor_medio_cita), 55);
  assert.equal(sql(`select valor_medio_cita from respiro.clientes where id='${B}'`), '40.00');
});

test('Equipo y lista de espera: solo los del propio cliente', async () => {
  const e = await pedir('/api/equipo', { usuario: 101 });
  assert.deepEqual(e.j.map((u) => u.nombre).sort(), ['Ana', 'Pepa']);
  assert.equal((await pedir('/api/equipo', { usuario: 102 })).status, 403);
});

test('n8n: firma falsa → 401; repetición → 409; caducada → 401; cliente cambiado sin firmar → 401', async () => {
  const payload = JSON.stringify({ op: 'agenda', cliente_id: A, rol: 'dueno', params: { fecha: manana } });
  const malo = await fetchReal(N8N, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ts: Math.floor(Date.now() / 1000), nonce: 'a'.repeat(24), payload, firma: 'f'.repeat(64) }) });
  assert.equal(malo.status, 401);
  const firmado = await firmar(SECRETO, payload);
  const r1 = await fetchReal(N8N, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(firmado) });
  assert.equal(r1.status, 200);
  const r2 = await fetchReal(N8N, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(firmado) });
  assert.equal(r2.status, 409);
  const viejo = await firmar(SECRETO, payload, Math.floor(Date.now() / 1000) - 300);
  assert.equal((await fetchReal(N8N, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(viejo) })).status, 401);
  const otro = await firmar(SECRETO, payload);
  otro.payload = otro.payload.replace(A, B);
  assert.equal((await fetchReal(N8N, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(otro) })).status, 401);
});

test('Límite de peticiones → 429', async () => {
  const r = await worker.fetch(new Request('https://www.respiroai.es/api/resumen', { headers: { Authorization: 'tma ' + initData(101) } }),
    { ...env, LIMITADOR: { limit: async () => ({ success: false }) } });
  assert.equal(r.status, 429);
});

test('Cabeceras de seguridad en /app y en la API', async () => {
  const r = await worker.fetch(new Request('https://www.respiroai.es/app/'), env);
  const csp = r.headers.get('Content-Security-Policy');
  assert.match(csp, /script-src 'self' https:\/\/telegram\.org/);
  assert.match(csp, /frame-ancestors https:\/\/web\.telegram\.org/);
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  const a = await pedir('/api/resumen', { usuario: 101 });
  assert.equal(a.h.get('Cache-Control'), 'no-store');
});

// ------------------------------------------------------------ Chat de la Mini App
const ia = (...acciones) => fetchReal(MOCK + '/_mock/anthropic', { method: 'POST', body: JSON.stringify({ acciones: acciones.map((a) => ({
  nombre: null, fecha: null, hora: null, tipo_cita: null, movil: null, ref_fecha: null, ref_hora: null, consulta: null, franja: null, tema: null, ...a })) }) });

test('Chat: una consulta escrita se contesta en la propia Mini App', async () => {
  await ia({ accion: 'consultar', consulta: 'dia', fecha: manana });
  const r = await pedir('/api/chat', { usuario: 101, metodo: 'POST', cuerpo: { tipo: 'texto', texto: 'qué tengo mañana' } });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.ok(r.j.mensajes.some((m) => /Mañana/.test(m.texto) && /Ana Vidal/.test(m.texto)), JSON.stringify(r.j));
});

test('Chat: apuntar una cita con botones Sí / No y que llegue a Calendar', async () => {
  await ia({ accion: 'crear', nombre: 'Rita Gómez', fecha: manana, hora: '15:00', movil: '622 333 444' });
  const r = await pedir('/api/chat', { usuario: 101, metodo: 'POST', cuerpo: { tipo: 'texto', texto: 'mete a Rita Gómez mañana a las 3, 622333444' } });
  const m = r.j.mensajes.find((x) => x.botones && x.botones.length);
  assert.ok(m && /Rita Gómez/.test(m.texto), JSON.stringify(r.j));
  const si = m.botones.flat().find((b) => /\|si$/.test(b.data));
  const r2 = await pedir('/api/chat', { usuario: 101, metodo: 'POST', cuerpo: { tipo: 'callback', data: si.data } });
  assert.equal(r2.status, 200, JSON.stringify(r2.j));
  assert.ok(r2.j.mensajes.some((x) => x.reemplaza && /Hecho/.test(x.texto)), JSON.stringify(r2.j));
  const cal = await (await fetchReal(MOCK + '/_mock/calendario/cal-a')).json();
  assert.ok(cal.some((e) => e.summary === 'Rita Gómez · +34622333444 · OTRO'), JSON.stringify(cal.map((e) => e.summary)));
});

test('Chat: el botón de otro usuario no sirve (cada uno solo sus resúmenes)', async () => {
  await ia({ accion: 'crear', nombre: 'Saúl Paz', fecha: manana, hora: '16:00', movil: '633444555' });
  const r = await pedir('/api/chat', { usuario: 101, metodo: 'POST', cuerpo: { tipo: 'texto', texto: 'Saúl mañana a las 4' } });
  const si = r.j.mensajes.find((x) => x.botones && x.botones.length).botones.flat().find((b) => /\|si$/.test(b.data));
  const ajeno = await pedir('/api/chat', { usuario: 201, metodo: 'POST', cuerpo: { tipo: 'callback', data: si.data } });
  assert.ok(!(await (await fetchReal(MOCK + '/_mock/calendario/cal-a')).json()).some((e) => e.summary.startsWith('Saúl')));
  assert.ok(JSON.stringify(ajeno.j).length > 0);
});

test('Chat: usuario sin acceso recibe "No tienes acceso"', async () => {
  const r = await pedir('/api/chat', { usuario: 555, metodo: 'POST', cuerpo: { tipo: 'texto', texto: 'hola' } });
  assert.ok(r.j.mensajes.some((m) => /No tienes acceso/.test(m.texto)), JSON.stringify(r.j));
});

test('Chat: datos de botón manipulados → 400', async () => {
  assert.equal((await pedir('/api/chat', { usuario: 101, metodo: 'POST', cuerpo: { tipo: 'callback', data: 'b|x|borrar_todo' } })).status, 400);
  assert.equal((await pedir('/api/chat', { usuario: 101, metodo: 'POST', cuerpo: { tipo: 'texto', texto: '' } })).status, 400);
});

test('Nota de voz desde la Mini App: se transcribe, se contesta y se apunta el gasto', async () => {
  await fetchReal(MOCK + '/_mock/mistral', { method: 'POST', body: JSON.stringify({ text: '¿Qué tengo mañana?' }) });
  await ia({ accion: 'consultar', consulta: 'dia', fecha: manana });
  const antes = Number(sql(`select count(*) from respiro.consumo_ia where cliente_id='${A}' and uso='transcripcion'`));
  const r = await worker.fetch(new Request('https://www.respiroai.es/api/voz', { method: 'POST', body: new Uint8Array(3000).fill(7),
    headers: { Authorization: 'tma ' + initData(101), 'Content-Type': 'audio/webm', 'X-Duracion': '6' } }), env);
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.transcripcion, '¿Qué tengo mañana?');
  assert.ok(j.mensajes.some((m) => /🎧/.test(m.texto) && /Mañana/.test(m.texto)), JSON.stringify(j));
  assert.equal(Number(sql(`select count(*) from respiro.consumo_ia where cliente_id='${A}' and uso='transcripcion'`)), antes + 1);
  const llamadas = await (await fetchReal(MOCK + '/_mock/llamadas')).json();
  assert.ok(llamadas.some((c) => c.servicio === 'mistral' && c.multipart));
});

test('Nota de voz: formato, duración y usuario sin acceso', async () => {
  const voz = (uid, tipo, seg) => worker.fetch(new Request('https://www.respiroai.es/api/voz', { method: 'POST', body: new Uint8Array(100),
    headers: { Authorization: 'tma ' + initData(uid), 'Content-Type': tipo, 'X-Duracion': String(seg) } }), env);
  assert.equal((await voz(101, 'text/html', 5)).status, 415);
  assert.equal((await voz(101, 'audio/webm', 300)).status, 400);
  assert.equal((await voz(555, 'audio/webm', 5)).status, 403);
});

test('Chat en n8n: firma falsa → 401 y repetición → 409', async () => {
  const URL_CHAT = 'http://localhost:5678/webhook/respiro-chat';
  const payload = JSON.stringify({ tipo: 'texto', texto: '/ayuda', user_id: 101, nombre: 'Ana' });
  const falso = await fetchReal(URL_CHAT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ts: Math.floor(Date.now() / 1000), nonce: 'b'.repeat(24), payload, firma: '0'.repeat(64) }) });
  assert.equal(falso.status, 401);
  const firmado = await firmar(SECRETO, payload);
  const r1 = await fetchReal(URL_CHAT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(firmado) });
  assert.equal(r1.status, 200);
  const r2 = await fetchReal(URL_CHAT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(firmado) });
  assert.equal(r2.status, 409);
});
