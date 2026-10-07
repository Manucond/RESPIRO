// Transcripción · Entrada: datos mínimos (nunca el audio en el flujo padre).
// Si falta algo se corta aquí: no se descarga ni se transcribe nada.
const i = $('Inicio').first().json;
if (!i.file_id || !/^[0-9a-f-]{36}$/.test(String(i.cliente_id || ''))) {
  throw new Error('Transcripción llamada sin file_id o cliente_id');
}
return [{ json: { file_id: String(i.file_id), segundos: Number(i.segundos) || 0, cliente_id: i.cliente_id } }];
