// Simula Telegram.WebApp y la API para ver la Mini App fuera de Telegram (solo pruebas).
(() => {
  const q = new URLSearchParams(location.search);
  const oscuro = q.get('tema') === 'oscuro';
  const tema = oscuro
    ? { bg_color: '#17212b', secondary_bg_color: '#0e1621', text_color: '#f5f5f5', hint_color: '#708499', link_color: '#6ab3f3' }
    : { bg_color: '#ffffff', secondary_bg_color: '#f1f1f4', text_color: '#000000', hint_color: '#999999', link_color: '#2481cc' };
  for (const [k, v] of Object.entries(tema)) document.documentElement.style.setProperty('--tg-theme-' + k.replace(/_/g, '-'), v);
  window.Telegram = { WebApp: {
    initData: 'simulado', initDataUnsafe: {}, colorScheme: oscuro ? 'dark' : 'light', platform: 'unknown',
    ready() {}, expand() {}, onEvent() {}, setHeaderColor() {}, openTelegramLink() {}, showConfirm(t, cb) { cb(true); },
    BackButton: { show() {}, hide() {}, onClick() {} }, HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
  } };
  const hoy = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const lunes = (n) => { const d = new Date(hoy); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * n); return iso(d); };
  const vacio = q.get('vacio') === '1';
  const datos = {
    '/api/resumen': { usuario: { nombre: 'Ana López', rol: 'dueno' }, cliente_id: 'x',
      tipos_cita: [{ codigo: 'REVISION', nombre: 'revisión', min: 30 }, { codigo: 'LIMPIEZA', nombre: 'limpieza', min: 45 }, { codigo: 'PRIMERA', nombre: 'primera visita', min: 30 }, { codigo: 'OTRO', nombre: 'otro', min: 30 }],
      informe: { cliente: 'Clínica Dental Riazor', todo_en_marcha: false,
        mes: vacio ? {} : { llamadas_atendidas: 64, citas_sin_intervencion: 18, citas_por_asistente: 27, recordatorios: 212, confirmaciones: 171, huecos_rellenados: 6, resenas_pedidas: 40 },
        mes_anterior: vacio ? {} : { llamadas_atendidas: 51, citas_sin_intervencion: 14, citas_por_asistente: 9, recordatorios: 198, confirmaciones: 160, huecos_rellenados: 6, resenas_pedidas: 35 },
        semanas: [7, 6, 5, 4, 3, 2, 1, 0].map((n, i) => ({ semana: lunes(n), ok: vacio ? 0 : [96, 104, 88, 112, 121, 134, 129, 58][i] })),
        estado: [
          { clave: 'bot_agenda', nombre: 'Asistente de agenda', ultima: new Date(Date.now() - 36e5 * 2).toISOString(), errores_24h: 0, semaforo: 'verde' },
          { clave: 'recordatorio', nombre: 'Recordatorios', ultima: new Date(Date.now() - 6e5).toISOString(), errores_24h: 0, semaforo: 'verde' },
          { clave: 'resena', nombre: 'Reseñas', ultima: new Date(Date.now() - 36e5 * 80).toISOString(), errores_24h: 0, semaforo: 'ambar' },
          { clave: 'llamada_atendida', nombre: 'Llamadas atendidas', ultima: new Date(Date.now() - 36e5 * 5).toISOString(), errores_24h: 3, semaforo: 'rojo' },
        ],
        parametros: { min_por_llamada: 3, min_por_reserva: 3, min_por_mensaje: 1, coste_hora_personal: 12, valor_medio_cita: 40 },
        ahorro_estimado: { es_estimacion: true, horas: 12.6, euros_tiempo: 151, euros_huecos: 240 } } },
    '/api/agenda': vacio ? { ok: true, citas: [], libres: [{ desde: '09:00', hasta: '14:00' }, { desde: '16:00', hasta: '20:00' }], cerrado: false } : { ok: true, citas: [
      { hora: '09:30', fin: '10:00', nombre: 'Quique Pérez', tipo: 'revisión', estado: 'confirmada' },
      { hora: '10:00', fin: '10:45', nombre: 'Marta López', tipo: 'limpieza', estado: 'pendiente' },
      { hora: '11:30', fin: '12:00', nombre: 'Rosa Mar', tipo: 'revisión', estado: 'no_vino' },
      { hora: '16:00', fin: '16:30', nombre: 'Sofía Martín', tipo: 'primera visita', estado: 'confirmada' },
    ], libres: [{ desde: '12:00', hasta: '14:00' }, { desde: '16:30', hasta: '20:00' }], cerrado: false },
    '/api/huecos': { ok: true, horas: ['09:00', '09:15', '12:00', '12:15', '12:30', '16:30', '17:00'], duracion: 45, cerrado: false },
    '/api/equipo': [{ nombre: 'Ana López', rol: 'dueno', desde: '2026-10-07' }, { nombre: 'Pepa', rol: 'personal', desde: '2026-10-08' }],
    '/api/espera': [{ nombre: 'Luis Mora', tipo: 'REVISION', preferencia: 'tardes', desde: '2026-10-01' }],
    '/api/noshows': { ok: true, citas: [{ nombre: 'Rosa Mar', fecha: 'jue 2', hora: '11:30' }] },
  };
  window.fetch = async (url) => {
    const p = String(url).split('?')[0];
    await new Promise((r) => setTimeout(r, 30));
    return new Response(JSON.stringify(datos[p] || { error: 'ruta' }), { status: datos[p] ? 200 : 404 });
  };
})();
