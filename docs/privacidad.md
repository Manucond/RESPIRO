# Nota de privacidad · Asistente de agenda por Telegram

*Para añadir a la guía de implantación que se entrega al cliente.*

## Qué datos trata el asistente

| Dato | Para qué | Dónde se guarda | Cuánto tiempo |
|---|---|---|---|
| Nombre y móvil del paciente | Apuntar la cita y que le lleguen los recordatorios | En **su propio Google Calendar**, en el título de la cita | Lo que el negocio decida en su calendario |
| Tipo **general** de cita (revisión, limpieza, primera visita, otro) | Duración de la cita | Google Calendar | Igual que la cita |
| Acciones pendientes de confirmar | El resumen con «Sí / No» | Base de datos de RESPIRO (UE, Irlanda) | Se borran a las **24 horas** |
| Recuentos de actividad (cuántos recordatorios, citas…) | Informes y ahorro estimado | Base de datos de RESPIRO | Mientras dure el servicio |
| Usuarios del bot (nombre de Telegram y rol) | Saber quién tiene acceso | Base de datos de RESPIRO | Hasta la baja |

**No se guardan datos de salud.** Si el dueño dice «empaste» o «le duele la muela», el asistente lo convierte en un tipo general («otro») y la palabra original no se guarda en ningún sitio. Los informes solo contienen números: la base de datos rechaza nombres y textos libres.

## Notas de voz

- Se transcriben con **Mistral (Voxtral)**, empresa europea que procesa en la UE y ofrece acuerdo de tratamiento de datos (DPA).
- **RESPIRO no guarda el audio**: se descarga, se transcribe y se descarta; el flujo de transcripción no conserva ejecuciones en n8n. Mistral puede conservar temporalmente las peticiones según sus condiciones de API (por ejemplo, para vigilancia de abusos).
- El texto transcrito sigue el mismo camino que un mensaje escrito.

## Inteligencia artificial

- Los mensajes se interpretan con **Claude (Anthropic)**, que solo devuelve una lista de acciones de un catálogo cerrado (crear, mover, cancelar, consultar). No responde en texto libre ni actúa sin confirmación.
- Se le envían el mensaje, la fecha, el horario y los **nombres** de pacientes habituales (sin móviles) para reconocer nombres mal escritos o mal transcritos.
- Anthropic actúa como encargado del tratamiento según sus condiciones comerciales y no usa los datos de la API para entrenar modelos. Las peticiones se procesan por defecto **fuera de la UE (EE. UU.)** y se conservan temporalmente según su política de retención: es una transferencia internacional que debe figurar en el registro de actividades del negocio.

## Quién puede usarlo

- Solo personas **invitadas** por RESPIRO o por el dueño, con un enlace de **un solo uso** que caduca en 48 horas.
- Cualquier otro usuario de Telegram recibe «No tienes acceso».
- Cada negocio solo ve **sus** datos: el aislamiento lo garantiza la base de datos (seguridad a nivel de fila), no solo la aplicación.
- La Mini App comprueba la firma de Telegram en cada petición y caduca a la hora.

## Recomendaciones para el negocio

- Usar el chat del asistente **solo con personal autorizado** y dar de baja a quien deje el negocio (Equipo en la Mini App o avisando a RESPIRO).
- No escribir en el chat motivos de consulta ni datos clínicos: no hacen falta para apuntar la cita.
- Proteger el móvil con bloqueo de pantalla; el chat de Telegram da acceso a la agenda.

## Pendiente de revisar por RESPIRO

- Firmar o aceptar los **DPA de Anthropic y de Mistral** y guardarlos con la documentación del cliente.
- Confirmar los plazos de retención actuales de ambos proveedores, porque pueden cambiar.
- Incluir a RESPIRO como encargado del tratamiento en el contrato con el negocio.
