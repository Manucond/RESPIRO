// Admin · Preparar: pregunta de un admin → Claude genera una consulta SQL de solo lectura.
const j = $json;
const { m } = j;
const ah = DateTime.now().setZone('Europe/Madrid').setLocale('es');
const MODELO = 'claude-sonnet-5-5';

const SISTEMA = `Eres el analista de datos interno de RESPIRO, una empresa que vende automatizaciones (citas, recordatorios, asistente de Telegram con IA…) a negocios locales. Quien pregunta es un socio de RESPIRO. Convierte su pregunta en UNA consulta SQL de PostgreSQL de solo lectura sobre estas vistas (esquema respiro_admin, ya en el search_path; no uses otros esquemas):

clientes(id, nombre, tipo_negocio, activo, calendario_conectado, modelo_ia, limite_ia_mensual_usd, valor_medio_cita, min_por_llamada, creado_en, negocio_web, email_web)
  → negocios que tienen el asistente de agenda.
usuarios_bot(cliente, rol['dueno'|'personal'|'admin'], nombre, activo, creado_en)
  → personas con acceso al bot de Telegram (nombre de Telegram, no pacientes).
automatizaciones_activas(cliente, automatizacion, nombre_automatizacion, activa, desde)
eventos(cliente, creado_en, automatizacion['bot_agenda'|'reserva_ia'|'llamada_atendida'|'recordatorio'|'confirmacion'|'lista_espera'|'resena'|'informe_semanal'], tipo, resultado['ok'|'error'|'omitido'], canal, motivo, tipo_cita)
  → cada ejecución de una automatización. En bot_agenda, tipo = crear | mover | cancelar | consultar | no_entendido | interpretar…
consumo_ia(cliente, creado_en, api['claude'|'mistral'], uso['acciones'|'transcripcion'|'admin'], modelo, tokens_entrada, tokens_salida, tokens_cache_lect, tokens_cache_escr, coste_usd)
  → gasto ESTIMADO de IA (precios de lista). cliente = 'RESPIRO (consultas de admin)' para estas consultas internas.
invitaciones(cliente, rol, creado_en, caduca_en, usada, usado_en, origen)
lista_espera(cliente, estado, personas)
negocios_web(negocio, tipo, contacto, email, telefono, suscripcion['none'|'active'|'past_due'|'cancelled'], creado_en, asistente_activo)
  → negocios registrados en la web respiroai.es.
servicios_web(negocio, servicio, estado['active'|'cancelled'], salud['ok'|'warning'|…], creado_en, cancelado_en)
solicitudes_contacto(nombre, negocio, email, telefono, comentario, estado['new'|'contacted'|'closed'], creado_en)

Reglas:
- Solo SELECT (o WITH … SELECT). Una única sentencia, sin punto y coma.
- Fechas en hora de España: compara con (now() at time zone 'Europe/Madrid') y usa date_trunc('month', …) / date_trunc('week', …) para "este mes" / "esta semana". Cuando devuelvas fechas u horas, conviértelas: to_char(creado_en at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI').
- Agrega en SQL (count, sum, round(…, 4) para dinero) en vez de traer filas sueltas; máximo 50 filas útiles.
- Nombres de clientes: compara sin distinguir mayúsculas (ilike '%texto%').
- Si la pregunta no necesita datos (saludo, cómo funciona algo) o no se puede responder con estas vistas, no generes SQL: explica brevemente qué sí puedes consultar.
- Puedes usar el historial reciente para entender preguntas encadenadas ("¿y el mes pasado?").`;

const ESQUEMA = {
  type: 'object', additionalProperties: false, required: ['sql', 'respuesta'],
  properties: {
    sql: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    respuesta: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
};
const historial = (j.historial || []).map((h) => `P: ${h.pregunta}\nSQL: ${h.sql || '(sin consulta)'}`).join('\n\n');
const error = j.admin_error ? `\n\nTu consulta anterior falló:\nSQL: ${j.admin_sql}\nError: ${j.admin_error}\nCorrígela.` : '';
const body = {
  model: MODELO,
  max_tokens: 2000,
  output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
  system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content:
    `Ahora: ${ah.toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm")} (Europe/Madrid).` +
    (historial ? `\n\n<historial>\n${historial}\n</historial>` : '') +
    `\n\n<pregunta>\n${m.texto}\n</pregunta>${error}` }],
};
return [{ json: { ...j, admin_body: body } }];
