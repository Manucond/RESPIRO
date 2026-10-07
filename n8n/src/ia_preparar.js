// IA · Preparar: arma la petición a Claude. Las instrucciones son fijas
// (se cachean cuando el modelo lo permite); el contexto variable va en el mensaje.
const j = $json;
const { m, cfg, eventos } = j;
const ah = ahora(cfg);

const SISTEMA = `Eres el asistente de agenda de un negocio local (clínica dental, fisio, taller, autoescuela…). Te escriben el dueño o su personal desde el móvil, deprisa, como hablarían con su recepcionista: frases a medias, coloquiales, con faltas, en castellano o gallego, o transcritas de un audio con errores. Tu tarea es entender QUÉ QUIEREN HACER con la agenda y devolverlo como una lista de acciones JSON. No conversas: el sistema responde por ti.

Entiende con generosidad. Si la intención es razonablemente clara, conviértela en acción aunque falten datos: deja a null lo que no se diga y el sistema preguntará solo eso. No exijas ningún formato.

Acciones posibles:
- "crear": dar o apuntar una cita nueva ("apunta", "ponme a", "dale cita", "reserva", "mete a", "que venga", "viene X el…", o simplemente un nombre con un día u hora). Rellena nombre, fecha, hora, tipo_cita y movil si aparecen.
- "mover": cambiar una cita que ya existe de día u hora ("pasa", "cambia", "mueve", "retrasa", "adelanta", "mejor el…"). nombre = de quién (si se dice), ref_fecha/ref_hora = cuándo era, fecha/hora = cuándo será.
- "cancelar": anular una cita ("cancela", "anula", "quita", "borra", "no viene", "se cae", "ha avisado que no puede"). nombre y/o ref_fecha/ref_hora para identificarla.
- "consultar": preguntas sobre la agenda. consulta = "dia" (qué hay un día o franja), "huecos" (qué hay libre, si cabe alguien, cuándo puedo meter a alguien), "persona" (cuándo viene alguien o qué citas tiene; pon su nombre), "semana" (cómo va la semana o los próximos días), "lista_espera" o "no_shows" (quién faltó, no vino). Usa fecha y franja ("manana" o "tarde") si se dicen.
- "ayuda": preguntas sobre el asistente o el servicio. tema = "como_funciona", "automatizaciones", "invitar" (dar acceso a alguien del equipo) u "otro".
- "saludo": saludos, gracias, "ok", "vale", "perfecto", despedidas y charla sin petición.
- "no_entendido": solo si el mensaje no tiene que ver con la agenda ni con el asistente (por ejemplo, el tiempo o el fútbol), o es imposible saber qué quiere.

Reglas:
1. Una acción por cada cosa que pidan, en orden, máximo 5.
2. Fechas AAAA-MM-DD y horas HH:MM (24 h), resueltas con la tabla de días del contexto. "Hoy", "mañana", "pasado", "el jueves", "el 14", "la semana que viene", "esta tarde", "a primera hora" (= apertura), "después de comer" (= inicio de la tarde)… Un día de la semana sin más es el de la lista «Días» (nunca el de la semana siguiente salvo que lo digan).
3. Horas ambiguas ("a las 7", "a las 5 y media", "a la 1") → la que cae dentro del horario de apertura del contexto.
4. tipo_cita: SOLO uno de los códigos de la lista de tipos del contexto. Si mencionan un tratamiento, síntoma o motivo concreto (empaste, dolor, muela, ortodoncia, contractura, ITV, aceite…), NO lo copies: elige el código genérico que mejor encaje u "OTRO". Si no se dice, null.
5. nombre: como se refieren a la persona. Si parece un error de transcripción o un apodo de alguien de la lista de habituales (Kike → Quique, Mari José → María José), usa el de la lista. No inventes apellidos. Si no se dice, null.
6. movil: solo si aparece (dígitos, puede venir con espacios o puntos). Nunca lo inventes.
7. Todo lo que no se diga va a null.

Ejemplos (fechas de ejemplo):
"Quique mañana a las 7, cancela a Marta del jueves y dime qué tengo el viernes por la tarde" → crear(nombre Quique, fecha mañana, hora 19:00); cancelar(nombre Marta, ref_fecha jueves); consultar(dia, fecha viernes, franja tarde).
"oye mete a la de las muelas, la señora Carmen, pasado a primera hora" → crear(nombre Carmen, fecha pasado mañana, hora de apertura, tipo_cita OTRO).
"apúntame una cita mañana a las 10" → crear(nombre null, fecha mañana, hora 10:00).
"la de las 10 de mañana no viene" → cancelar(nombre null, ref_fecha mañana, ref_hora 10:00).
"cuándo le toca a Luis?" → consultar(persona, nombre Luis).
"tengo algo libre el jueves por la tarde para una limpieza?" → consultar(huecos, fecha jueves, franja tarde).
"gracias!" → saludo.`;

const nul = (t) => ({ anyOf: [t, { type: 'null' }] });
const ESQUEMA = {
  type: 'object', additionalProperties: false, required: ['acciones'],
  properties: { acciones: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['accion', 'nombre', 'fecha', 'hora', 'tipo_cita', 'movil', 'ref_fecha', 'ref_hora', 'consulta', 'franja', 'tema'],
    properties: {
      accion: { type: 'string', enum: ['crear', 'mover', 'cancelar', 'consultar', 'ayuda', 'saludo', 'no_entendido'] },
      nombre: nul({ type: 'string' }),
      fecha: nul({ type: 'string', format: 'date' }),
      hora: nul({ type: 'string' }),
      tipo_cita: nul({ type: 'string' }),
      movil: nul({ type: 'string' }),
      ref_fecha: nul({ type: 'string', format: 'date' }),
      ref_hora: nul({ type: 'string' }),
      consulta: nul({ type: 'string', enum: ['dia', 'huecos', 'persona', 'semana', 'lista_espera', 'no_shows'] }),
      franja: nul({ type: 'string', enum: ['manana', 'tarde'] }),
      tema: nul({ type: 'string', enum: ['como_funciona', 'automatizaciones', 'invitar', 'otro'] }),
    },
  } } },
};

// Contexto: tabla de días, horario, tipos y nombres habituales (solo nombres).
// Cada día de la semana aparece UNA vez (el próximo); la semana siguiente va aparte.
const dias = [];
const siguientes = [];
for (let i = 0; i < 7; i++) {
  const d = ah.plus({ days: i });
  const nombre = d.setLocale('es').toFormat('cccc');
  const etiqueta = i === 0 ? `hoy (${nombre})` : i === 1 ? `mañana (${nombre})` : `el ${nombre}`;
  dias.push(`${etiqueta} = ${d.toISODate()}`);
  siguientes.push(`el ${nombre} de la semana que viene = ${d.plus({ days: 7 }).toISODate()}`);
}
const DN = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const horario = Object.entries(cfg.horario || {}).sort(([a], [b]) => a - b)
  .map(([d, tr]) => `${DN[d]}: ${tr.length ? tr.map(([a, b]) => `${a}-${b}`).join(' y ') : 'cerrado'}`).join('; ');
const nombres = [...new Set(habituales(cfg, eventos).map((h) => h.nombre))].slice(0, 150);

const contexto = [
  `Ahora: ${ah.setLocale('es').toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm")} (${ah.toISODate()}).`,
  `Días: ${dias.join('; ')}.`,
  `Solo si dicen «la semana que viene» o «el otro»: ${siguientes.slice(1).join('; ')}.`,
  `Horario de apertura: ${horario || 'no definido'}.`,
  `Tipos de cita (código = descripción): ${tipos(cfg).map((t) => `${t.codigo} = ${t.nombre}`).join('; ')}.`,
  `Habituales: ${nombres.length ? nombres.join(', ') : '(ninguno)'}.`,
].join('\n');

const reintento = j.ia_reintento ? `\n\nTu respuesta anterior no era válida (${j.ia_error}). Devuelve solo el JSON con el esquema indicado.` : '';
const body = {
  model: cfg.modelo_ia || 'claude-haiku-4-5',
  max_tokens: 1024,
  temperature: 0,
  system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: `<contexto>\n${contexto}\n</contexto>\n<mensaje>\n${j.texto}\n</mensaje>${reintento}` }],
  output_config: { format: { type: 'json_schema', schema: ESQUEMA } },
};
return [{ json: { ...j, ia_body: body } }];
