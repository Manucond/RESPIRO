// Admin · Redactar: Claude resume los resultados en lenguaje natural (sin inventar).
const j = $json;
if (j.directa) return [{ json: { ...j, redactar_body: null } }];
const filas = JSON.stringify(j.filas === null ? { error: j.sql_error } : j.filas).slice(0, 30000);
const body = {
  model: 'claude-sonnet-5-5',
  max_tokens: 1200,
  output_config: { effort: 'low' },
  system: 'Eres el analista interno de RESPIRO. Responde en español de España, de tú, breve y claro, usando SOLO los datos de <resultado>. Cifras exactas; dinero en dólares con hasta 4 decimales y recuerda que el gasto de IA es una estimación a precio de lista. Si no hay filas, dilo. Si hay un error, explica en una frase que no has podido sacar el dato. Las fechas ya vienen en hora de España: no menciones UTC. Texto plano: sin Markdown ni tablas; para listas usa líneas que empiecen por «• ». No menciones SQL ni vistas.',
  messages: [{ role: 'user', content: `<pregunta>\n${j.m.texto}\n</pregunta>\n<resultado>\n${filas}\n</resultado>` }],
};
return [{ json: { ...j, redactar_body: body } }];
