# Alta de un cliente nuevo en el asistente de agenda

Tiempo: unos 10 minutos. Lo hace un admin de RESPIRO.

## 1. Conectar su calendario

El bot lee y escribe en el Google Calendar del cliente con la credencial **Google Calendar account** de n8n. Hace falta que esa cuenta de Google tenga acceso al calendario de la clínica:

1. El cliente abre Google Calendar en el ordenador → en la lista de la izquierda, ⋮ junto a su calendario → **Configuración y uso compartido**.
2. En **Compartir con determinadas personas**, añade la cuenta de Google conectada a n8n con el permiso **Hacer cambios en eventos**.
3. Más abajo, en **Integrar el calendario**, copia el **ID del calendario**.

## 2. Activar el asistente (recomendado: desde la web)

Si el cliente se registró en www.respiroai.es:

1. Entra en la web con tu cuenta de admin → **Mi panel**.
2. En su negocio, pega el **ID del calendario** (paso 1) y pulsa **Activar asistente**.
3. Listo: el cliente verá en su **Mi panel** el bloque «🤖 Tu asistente de agenda» con el botón **Conectar mi Telegram**. Desde el móvil abre el bot directamente; desde el ordenador le sale un **código QR**. Se convierte en dueño de su asistente sin que le mandéis nada.

Si no tiene cuenta en la web, créalo a mano (paso 2 bis) y mándale la invitación (paso 3).

## 2 bis. Crear el cliente a mano en Supabase

En supabase.com → `respiro-app` → **SQL Editor**, pega esto y cambia los valores marcados:

```sql
with c as (
  insert into respiro.clientes (
    nombre, tipo_negocio, calendario_id, horario,
    min_por_llamada, valor_medio_cita
  ) values (
    'Clínica Ejemplo',                                  -- nombre que verá el cliente
    'clinica',                                          -- clinica | fisio | taller | autoescuela…
    'xxxxxxxx@group.calendar.google.com',               -- ID del calendario (paso 1)
    '{"1":[["09:00","14:00"],["16:00","20:00"]],
      "2":[["09:00","14:00"],["16:00","20:00"]],
      "3":[["09:00","14:00"],["16:00","20:00"]],
      "4":[["09:00","14:00"],["16:00","20:00"]],
      "5":[["09:00","14:00"]]}',                        -- 1 = lunes … 7 = domingo
    3,                                                  -- minutos que dura una llamada
    40                                                  -- euros de media por cita
  ) returning id)
insert into respiro.clientes_automatizaciones (cliente_id, clave)
select c.id, k from c, unnest(array['bot_agenda', 'informe_semanal']) k;
```

- **Tipos de cita**: por defecto revisión (30 min), limpieza (45), primera visita (30) y otro (30). Para cambiar duraciones o tipos (por ejemplo en un taller), edita la columna `tipos_cita` del cliente. Usa siempre **tipos generales**, nunca tratamientos concretos.
- **Automatizaciones activas**: añade en `clientes_automatizaciones` las que tenga contratadas (`recordatorio`, `confirmacion`, `llamada_atendida`, `reserva_ia`, `lista_espera`, `resena`…). Solo esas aparecen en su semáforo de la Mini App.
- **Límite de IA**: por defecto 5 $ al mes por cliente (`limite_ia_mensual_usd`). Un mensaje cuesta unos 0,003 $.

## 3. Generar la invitación del dueño (solo si no usa la web)

En el chat con @RespiroAsistenteBot, como admin:

```
/invitar Clínica Ejemplo dueno
```

El bot devuelve un enlace `https://t.me/RespiroAsistenteBot?start=…`. **Sirve una sola vez y caduca en 48 horas.** Envíaselo al dueño por WhatsApp o correo.

El dueño, después, invita a su personal desde el bot (`/invitar`) o desde la Mini App (Equipo → Generar invitación).

## 4. Comprobar

1. El dueño abre el enlace y pulsa **Iniciar** → debe recibir la bienvenida con el robot.
2. Que escriba «¿qué tengo hoy?» → debe ver su agenda (y no otra).
3. Que pulse **Mi agenda** (botón abajo a la izquierda en el chat) → se abre la Mini App con su nombre de clínica.
4. Como admin: `/clientes` → el cliente aparece sin el aviso «⚠️ sin calendario».

Para ver lo que ve un cliente sin pedirle el móvil: `/cliente Clínica Ejemplo` (y luego `/cliente` del siguiente).

## Si algo falla

- A los admins os llega un aviso 🚨 por Telegram con el flujo y el nodo que ha fallado.
- «📅 Tu calendario todavía no está conectado»: falta `calendario_id` en el cliente.
- «😵 No he podido leer tu calendario»: la cuenta de n8n no tiene acceso al calendario (paso 1).
- Dar de baja a un usuario: `update respiro.usuarios_bot set activo = false where nombre = '…';`
- Dar de baja un cliente: `update respiro.clientes set activo = false where nombre = '…';` (sus usuarios dejan de tener acceso al momento).
