// Prueba de comprensión con la API real de Claude (cuesta céntimos).
// Ejecuta el mismo código que los nodos de n8n con contexto simulado.
const fs = require('fs');
const { DateTime } = require(process.env.LUXON);
const cod = JSON.parse(fs.readFileSync('/t/.codigo.json'));
const TZ = 'Europe/Madrid';
const ahora = DateTime.now().setZone(TZ);
const d = (n) => ahora.plus({ days: n }).toISODate();
const proximo = (wd) => { for (let i = 1; i <= 7; i++) { const x = ahora.plus({ days: i }); if (x.weekday === wd) return x.toISODate(); } };
const hoyWd = ahora.weekday;
const sig = (wd) => (wd === hoyWd ? ahora.toISODate() : proximo(wd));

const cfg = {
  cliente_id: 'x', cliente: 'Demo', zona_horaria: TZ, modelo_ia: 'claude-haiku-4-5',
  horario: { 1: [['09:00', '14:00'], ['16:00', '20:00']], 2: [['09:00', '14:00'], ['16:00', '20:00']], 3: [['09:00', '14:00'], ['16:00', '20:00']], 4: [['09:00', '14:00'], ['16:00', '20:00']], 5: [['09:00', '14:00']] },
  tipos_cita: [{ codigo: 'REVISION', nombre: 'revisión', min: 30 }, { codigo: 'LIMPIEZA', nombre: 'limpieza', min: 45 }, { codigo: 'PRIMERA', nombre: 'primera visita', min: 30 }, { codigo: 'OTRO', nombre: 'otro', min: 30 }],
};
const habit = ['Quique Pérez', 'Marta López', 'Ana Vidal', 'María José Fernández', 'Pedro Gil', 'Luis Mora', 'Carmen Sanz'];
const eventos = habit.map((n, i) => ({ id: 'h' + i, status: 'confirmed', summary: `${n} · +3460000000${i} · REVISION`,
  start: { dateTime: ahora.minus({ days: 10 + i }).set({ hour: 10 }).toISO() }, end: { dateTime: ahora.minus({ days: 10 + i }).set({ hour: 10, minute: 30 }).toISO() } }));

const TODOS = [
  ['Quique mañana a las 7, cancela a Marta del jueves y dime qué tengo el viernes por la tarde',
    [{ accion: 'crear', nombre: /quique/i, fecha: d(1), hora: '19:00' }, { accion: 'cancelar', nombre: /marta/i, ref_fecha: sig(4) }, { accion: 'consultar', consulta: 'dia', fecha: sig(5), franja: 'tarde' }]],
  ['Kike mañana a las 7', [{ accion: 'crear', nombre: /quique/i, fecha: d(1), hora: '19:00' }]],
  ['Apúntame a Laura García el lunes a las 10 y media para una limpieza, su móvil es 666 123 456',
    [{ accion: 'crear', nombre: /laura garc/i, fecha: sig(1), hora: '10:30', tipo_cita: 'LIMPIEZA', movil: /666\s*123\s*456|666123456/ }]],
  ['Pon a Juan el martes a las 5 para un empaste', [{ accion: 'crear', nombre: /juan/i, fecha: sig(2), hora: '17:00', tipo_cita: /OTRO|REVISION/ }]],
  ['Pasa a Ana del miércoles a las 12 al jueves a la misma hora', [{ accion: 'mover', nombre: /ana/i, ref_fecha: sig(3), ref_hora: '12:00', fecha: sig(4), hora: '12:00' }]],
  ['Anula la cita de Pedro de hoy', [{ accion: 'cancelar', nombre: /pedro/i, ref_fecha: d(0) }]],
  ['¿Qué huecos tengo mañana por la mañana?', [{ accion: 'consultar', consulta: 'huecos', fecha: d(1), franja: 'manana' }]],
  ['¿Quién está en lista de espera?', [{ accion: 'consultar', consulta: 'lista_espera' }]],
  ['¿Cuántos pacientes no vinieron este mes?', [{ accion: 'consultar', consulta: 'no_shows' }]],
  ['¿Cómo invito a mi recepcionista?', [{ accion: 'ayuda', tema: 'invitar' }]],
  ['Qué tiempo hace hoy en Coruña', [{ accion: 'no_entendido' }]],
  ['Primera visita para Sofía Martín el martes a las 9', [{ accion: 'crear', nombre: /sof[ií]a mart[ií]n/i, fecha: sig(2), hora: '09:00', tipo_cita: 'PRIMERA' }]],
  ['Mari José viene mañana a las 4 a revisión', [{ accion: 'crear', nombre: /mar[ií]a jos[eé]/i, fecha: d(1), hora: '16:00', tipo_cita: 'REVISION' }]],
  ['Cancela a Luis y a Carmen de mañana', [{ accion: 'cancelar', nombre: /luis/i, ref_fecha: d(1) }, { accion: 'cancelar', nombre: /carmen/i, ref_fecha: d(1) }]],
  ['Le duele mucho la muela a Raúl, ponle hoy a las 18:30', [{ accion: 'crear', nombre: /ra[uú]l/i, fecha: d(0), hora: '18:30', tipo_cita: /OTRO|null/ }]],
  // --- Lenguaje natural, sin formato ---
  ['oye mete a la señora Carmen pasado a primera hora que le duele una muela', [{ accion: 'crear', nombre: /carmen/i, fecha: d(2), hora: '09:00', tipo_cita: /OTRO/ }]],
  ['apúntame una cita mañana a las 10', [{ accion: 'crear', nombre: null, fecha: d(1), hora: '10:00' }]],
  ['la de las 10 de mañana no viene', [{ accion: 'cancelar', ref_fecha: d(1), ref_hora: '10:00' }]],
  ['cuándo le toca a Luis?', [{ accion: 'consultar', consulta: 'persona', nombre: /luis/i }]],
  ['tengo algo libre el jueves por la tarde para una limpieza?', [{ accion: 'consultar', consulta: 'huecos', fecha: sig(4), franja: 'tarde' }]],
  ['gracias!!', [{ accion: 'saludo' }]],
  ['q tal va la semana', [{ accion: 'consultar', consulta: /semana|dia/ }]],
  ['ponme a pedro el lunes a las 12 y a ana el martes a las 5 para revision', [{ accion: 'crear', nombre: /pedro/i, fecha: sig(1), hora: '12:00' }, { accion: 'crear', nombre: /ana/i, fecha: sig(2), hora: '17:00', tipo_cita: 'REVISION' }]],
  ['marta ha llamado q no puede venir el jueves', [{ accion: 'cancelar', nombre: /marta/i, ref_fecha: sig(4) }]],
  ['retrasa a Quique media hora mañana, que venga a las 7 y media', [{ accion: 'mover', nombre: /quique/i, fecha: d(1), hora: '19:30' }]],
  ['dale cita a laura garcia para limpieza cuando haya hueco el viernes', [{ accion: 'crear', nombre: /laura/i, fecha: sig(5), tipo_cita: 'LIMPIEZA' }]],
  ['qien tengo hoy x la tarde', [{ accion: 'consultar', consulta: 'dia', fecha: d(0), franja: 'tarde' }]],
  ['Bo día! Mete a Xosé mañá ás 11', [{ accion: 'crear', nombre: /xos[eé]/i, fecha: d(1), hora: '11:00' }]],
  ['cuantos han faltado este mes', [{ accion: 'consultar', consulta: 'no_shows' }]],
  ['hay alguien esperando hueco?', [{ accion: 'consultar', consulta: 'lista_espera' }]],
  ['Pon a Maria Jose el miércoles que viene a las 9', [{ accion: 'crear', nombre: /mar[ií]a jos[eé]/i, fecha: proximo(3) === ahora.plus({ days: 7 }).toISODate() ? proximo(3) : ahora.plus({ days: ((3 - hoyWd + 7) % 7) + 7 }).toISODate(), hora: '09:00' }]],
  ['ok perfecto', [{ accion: 'saludo' }]],
  ['cambia lo de pedro gil al viernes misma hora', [{ accion: 'mover', nombre: /pedro/i, fecha: sig(5) }]],
  ['nueva cita kike seis seis seis uno dos tres cuatro cinco seis mañana a las cuatro', [{ accion: 'crear', nombre: /quique/i, fecha: d(1), hora: '16:00', movil: /666123456/ }]],
  ['que hay mañana', [{ accion: 'consultar', consulta: 'dia', fecha: d(1) }]],
  ['como hago para que mi recepcionista tambien pueda usar esto', [{ accion: 'ayuda', tema: 'invitar' }]],
  ['quien gana la liga este año?', [{ accion: 'no_entendido' }]],
];
const CASOS = process.env.SOLO ? TODOS.filter((c, i) => process.env.SOLO.split(',').includes(String(i))) : TODOS;

const ejecutar = (codigo, $J, nodos) => new Function('$J_IN', '$', '$input', 'DateTime', codigo.replace('const $J = $input.first().json;', 'const $J = $J_IN;'))(
  $J, (n) => ({ first: () => ({ json: nodos[n] }) }), { first: () => ({ json: $J }) }, DateTime);

const cumple = (esp, real) => Object.entries(esp).every(([k, v]) => {
  const r = real[k];
  if (v === null) return r === null || r === undefined;
  if (v instanceof RegExp) return v.test(String(r));
  return r === v;
});

(async () => {
  let ok = 0; let entrada = 0; let salida = 0; const lat = [];
  for (const [frase, esperado] of CASOS) {
    const prep = ejecutar(cod.preparar, { m: { chat_id: 1 }, cfg, eventos, texto: frase }, { G: {} })[0].json;
    const t0 = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(prep.ia_body) });
    const j = await res.json();
    lat.push(Date.now() - t0);
    const val = ejecutar(cod.validar, j, { G: {}, 'IA · Preparar': prep })[0].json;
    entrada += (j.usage || {}).input_tokens || 0; salida += (j.usage || {}).output_tokens || 0;
    const acc = val.acciones || [];
    const bien = !val.ia_error && acc.length === esperado.length && esperado.every((e, i) => cumple(e, acc[i] || {}));
    if (bien) ok++;
    const corto = acc.map((a) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null)));
    console.log(`${bien ? 'OK   ' : 'FALLO'} «${frase}»\n      → ${JSON.stringify(corto)}${val.ia_error ? '  error: ' + val.ia_error : ''}${res.status !== 200 ? ' HTTP ' + res.status + ' ' + JSON.stringify(j).slice(0, 200) : ''}`);
  }
  const n = CASOS.length;
  const coste = (entrada * 1 + salida * 5) / 1e6;
  console.log(`\n${ok}/${n} frases interpretadas como se esperaba`);
  console.log(`Tokens medios por mensaje: entrada ${Math.round(entrada / n)}, salida ${Math.round(salida / n)}`);
  console.log(`Coste total de la prueba: ${coste.toFixed(4)} $ · por mensaje: ${(coste / n).toFixed(5)} $`);
  console.log(`Latencia media de Claude: ${Math.round(lat.reduce((a, b) => a + b) / n)} ms (máx ${Math.max(...lat)} ms)`);
})();
