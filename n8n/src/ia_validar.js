// IA · Validar: comprueba el JSON contra el catálogo cerrado. Un reintento;
// si sigue sin valer → no_entendido. Nunca se ejecuta nada sin validar.
const prev = $('IA · Preparar').item.json;
const r = $json;
const { ia_body, ...ctx } = prev;
const ACC = ['crear', 'mover', 'cancelar', 'consultar', 'ayuda', 'saludo', 'no_entendido'];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]?\d|2[0-3]):[0-5]\d$/;
const u = r.usage || {};
const consumo = {
  modelo: ia_body.model,
  entrada: (prev.consumo?.entrada || 0) + (u.input_tokens || 0),
  salida: (prev.consumo?.salida || 0) + (u.output_tokens || 0),
  cache_lect: (prev.consumo?.cache_lect || 0) + (u.cache_read_input_tokens || 0),
  cache_escr: (prev.consumo?.cache_escr || 0) + (u.cache_creation_input_tokens || 0),
};

let error = null;
let errorApi = null;
let acciones = null;
if (r.error || !Array.isArray(r.content)) {
  const e = r.error || {};
  errorApi = String(e.message || e.type || JSON.stringify(e)).slice(0, 300);
  error = 'api';
} else if (r.stop_reason === 'refusal') {
  error = 'rechazo';
} else {
  try {
    const txt = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const o = JSON.parse(txt);
    if (!o || !Array.isArray(o.acciones)) throw new Error('sin lista de acciones');
    // Tolerante: una acción rara no tira el mensaje entero; lo que falte lo pregunta el Plan.
    const s = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const hora = (v) => {
      const m = String(v || '').match(/^(\d{1,2})(?:[:.h](\d{2}))?/);
      if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) return null;
      return `${m[1].padStart(2, '0')}:${(m[2] || '00')}`;
    };
    acciones = o.acciones.filter((a) => a && ACC.includes(a.accion)).slice(0, 5).map((a) => {
      const out = {
        accion: a.accion,
        nombre: s(a.nombre),
        fecha: FECHA.test(a.fecha || '') ? a.fecha : null,
        hora: hora(a.hora),
        tipo_cita: s(a.tipo_cita, 20),
        movil: s(a.movil, 20),
        ref_fecha: FECHA.test(a.ref_fecha || '') ? a.ref_fecha : null,
        ref_hora: hora(a.ref_hora),
        consulta: ['dia', 'huecos', 'persona', 'semana', 'lista_espera', 'no_shows'].includes(a.consulta) ? a.consulta : null,
        franja: ['manana', 'tarde'].includes(a.franja) ? a.franja : null,
        tema: ['como_funciona', 'automatizaciones', 'invitar', 'otro'].includes(a.tema) ? a.tema : null,
      };
      if (out.accion === 'consultar' && !out.consulta) out.consulta = out.nombre ? 'persona' : 'dia';
      return out;
    });
    if (!acciones.length) acciones = [{ accion: 'no_entendido' }];
    if (o.acciones.filter((a) => a && ACC.includes(a.accion)).length > 5) acciones.push({ accion: 'demasiadas' });
  } catch (e) {
    error = 'json: ' + String(e.message).slice(0, 120);
  }
}

const reintentar = !!error && error !== 'api' && !prev.ia_reintento;
if (reintentar) return [{ json: { ...ctx, consumo, ia_reintento: true, ia_error: error, reintentar: true } }];
if (error) acciones = [{ accion: errorApi ? 'error_ia' : 'no_entendido' }];
return [{ json: { ...ctx, consumo, acciones, ia_error: error, ia_error_api: errorApi, reintentar: false, siguiente: 'plan' } }];
