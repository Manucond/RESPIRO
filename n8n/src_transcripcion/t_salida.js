// Transcripción · Salida: devuelve solo el texto. El audio (binario) se
// descarta aquí: no se devuelve al flujo padre y este subflujo no guarda
// ejecuciones, así que n8n no lo conserva.
const r = $input.first().json;
const ent = $('Transcripción · Entrada').first().json;
let texto = null;
let error = null;
if (r.error) error = String(r.error.message || r.error.description || JSON.stringify(r.error)).slice(0, 200);
else texto = String(r.text || '').trim() || null;
if (!error && !texto) error = 'vacio';
return [{ json: {
  texto, error,
  consumo: { cliente_id: ent.cliente_id, modelo: 'voxtral-mini-latest', segundos: ent.segundos },
} }];
