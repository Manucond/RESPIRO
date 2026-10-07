// Modo RESPIRO con Claude real y la base real (como respiro_n8n). Cuesta céntimos.
const fs = require('fs');
const { DateTime } = require(process.env.LUXON);
const { Client } = require(process.env.PG);
const cod = JSON.parse(fs.readFileSync('/t/.codigo_admin.json'));
const ejecutar = (codigo, $J, nodos) => new Function('$J_IN', '$', '$input', 'DateTime', codigo.replace('const $J = $input.first().json;', 'const $J = $J_IN;'))(
  $J, (n) => ({ first: () => ({ json: nodos[n] }) }), { first: () => ({ json: $J }) }, DateTime);
const claude = async (body) => (await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) })).json();
const PREGUNTAS = [
  '¿cuánto llevamos gastado de IA este mes por cliente y por API?',
  '¿y cuánto es en total?',
  '¿cuántas citas ha apuntado el asistente esta semana y cuántas fallaron?',
  '¿qué clientes tienen el calendario sin conectar?',
  '¿hay solicitudes de contacto sin atender?',
  'dame los negocios registrados en la web y si tienen el asistente activo',
];
(async () => {
  const db = new Client({ host: 'aws-1-eu-west-1.pooler.supabase.com', port: 5432, database: 'postgres', user: 'respiro_n8n.ookbxfjqvbbqmjaoimkp',
    password: process.env.N8N_PG_PASSWORD, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const historial = [];
  let tin = 0, tout = 0;
  for (const p of PREGUNTAS) {
    const t0 = Date.now();
    let ctx = { m: { chat_id: 1, texto: p }, historial: historial.slice(-3) };
    let prep = ejecutar(cod['admin_preparar.js'], ctx, { G: {} })[0].json;
    let r1 = await claude(prep.admin_body);
    let val = ejecutar(cod['admin_validar.js'], r1, { G: {}, 'Admin · Preparar': prep })[0].json;
    let filas = null, err = null;
    if (val.sql) {
      try { filas = (await db.query('select respiro_admin.consultar($1) as filas', [val.sql])).rows[0].filas; }
      catch (e) {
        err = e.message;   // reintento con el error, como en n8n
        prep = ejecutar(cod['admin_preparar.js'], { ...val, admin_error: err, admin_sql: val.sql, admin_reintento: true }, { G: {} })[0].json;
        r1 = await claude(prep.admin_body);
        val = ejecutar(cod['admin_validar.js'], r1, { G: {}, 'Admin · Preparar': prep })[0].json;
        if (val.sql) { try { filas = (await db.query('select respiro_admin.consultar($1) as filas', [val.sql])).rows[0].filas; err = null; } catch (e2) { err = e2.message; } }
      }
    }
    const red = ejecutar(cod['admin_redactar.js'], { ...val, filas, sql_error: err }, { G: {} })[0].json;
    const r2 = red.redactar_body ? await claude(red.redactar_body) : {};
    const fin = ejecutar(cod['admin_respuesta.js'], r2, { G: {}, 'Admin · Redactar': red })[0].json;
    tin += fin.salida.consumo.entrada; tout += fin.salida.consumo.salida;
    historial.push({ pregunta: p, sql: val.sql });
    const texto = fin.salida.tg[0].body.text.replace(/<blockquote[\s\S]*$/, '').replace(/&[a-z]+;/g, (x) => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&' }[x] || x));
    console.log(`\n❓ ${p}   (${Date.now() - t0} ms)\n   SQL: ${(val.sql || '—').replace(/\s+/g, ' ').slice(0, 220)}${err ? '\n   ERROR SQL: ' + err : ''}\n   ${texto.replace(/\n/g, '\n   ')}`);
  }
  await db.end();
  const coste = (tin * 2 + tout * 10) / 1e6;
  console.log(`\nTokens: entrada ${tin}, salida ${tout} · coste ≈ ${coste.toFixed(4)} $ (${(coste / PREGUNTAS.length).toFixed(4)} $ por pregunta)`);
})().catch((e) => { console.error(e); process.exit(1); });
