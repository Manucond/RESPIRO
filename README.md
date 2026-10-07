# RESPIRO

Web de RESPIRO (www.respiroai.es) y **asistente de agenda por Telegram** para los clientes: un único bot (@RespiroAsistenteBot) + Mini App + informes de sus automatizaciones.

## Qué hay en el repo

| Carpeta / fichero | Qué es |
|---|---|
| `index.html`, `privacidad.html`, `condiciones.html`, `assets/` | Web pública |
| `worker.js`, `wrangler.jsonc` | Worker de Cloudflare: web, vídeos por rangos, **Mini App** (`/app`) y su **API** (`/api/*`) |
| `app/` | Mini App de Telegram (HTML/CSS/JS sin dependencias) y el robot (`app/robot/`) |
| `supabase/migrations/` | Esquema `respiro` en Supabase (`respiro-app`) |
| `n8n/src*/` | Código de los nodos de n8n (fuente de verdad) |
| `n8n/build.py` | Genera los flujos importables en `n8n/flujos/` |
| `n8n/deploy.py` | Sube credenciales y flujos a n8n y configura Telegram |
| `tests/` | Pruebas: SQL, extremo a extremo del bot (APIs simuladas), Worker y comprensión con Claude real |
| `scripts/` | Generación del robot (SVG → PNG) |
| `docs/` | Alta de cliente y nota de privacidad |

`.assetsignore` impide que se publique en la web nada que no sea la web y `app/`. **Si creas una carpeta nueva, añádela ahí.**

## Cómo funciona

```
Telegram ──► n8n «RESPIRO · Bot Telegram»
             Norm (cabecera secreta) → Dedupe → Auth (chat → cliente y rol) → Ruta
               ├─ /start CÓDIGO → canjear invitación
               ├─ comandos (/hoy /manana /huecos /informe /invitar …)
               ├─ voz → «Bot Transcripción» (Mistral Voxtral, UE; no guarda el audio)
               └─ texto → Claude Haiku 4.5 (JSON con catálogo cerrado) → Plan
                    Plan comprueba huecos, horario, nombres repetidos y móvil
                    → un resumen con Sí / No → Google Calendar (fuente de verdad)

Web (Mi panel) ──► Supabase public.panel_* (sesión de la web)
   cliente: «Conectar mi Telegram» → su invitación de dueño (enlace o QR)
   admin:   «Activar asistente» → enlaza el negocio con su calendario

Mini App (www.respiroai.es/app) ──► Worker /api/*
   ├─ Chat (pantalla principal): texto → /api/chat; audio → /api/voz (Mistral) → mismo flujo del bot
   verifica initData (HMAC con el token del bot) → cliente desde la identidad verificada
   ├─ lecturas de informes → Supabase public.miniapp_* (RLS por cliente)
   └─ agenda / huecos / nueva cita → n8n «Mini App API» (petición firmada HMAC + ts + nonce)
```

**Modo RESPIRO** (solo admins, en el bot): sin cliente elegido, lo que escribís es una pregunta sobre datos.
Claude Sonnet 5.5 la convierte en una consulta SQL que se ejecuta con el rol `respiro_consultas` (solo SELECT sobre
las vistas de `respiro_admin`, sin datos de pacientes) y redacta la respuesta. `/gasto`, `/clientes`, `/cliente X`, `/respiro`.

Flujos de n8n (todos generados por `n8n/build.py`):

- **RESPIRO · Bot Telegram**: el bot.
- **RESPIRO · Bot Transcripción**: notas de voz. No guarda ejecuciones.
- **RESPIRO · Mini App API**: agenda, huecos y nueva cita para la Mini App.
- **RESPIRO · Informe semanal y mantenimiento**: lunes 9:30 y limpieza diaria a las 3:15.
- **RESPIRO · Bot Errores**: aviso por Telegram a los admins.

Reglas que no se rompen:

- Nada se escribe en el calendario sin pulsar **Sí** (o enviar el formulario de la Mini App).
- Toda cita acaba en **Google Calendar** con título `Nombre · +34600000000 · TIPO`, compatible con el núcleo dental.
- Solo **tipos genéricos** (REVISION, LIMPIEZA, PRIMERA, OTRO); nunca el tratamiento.
- Los informes (`eventos_automatizacion`) no admiten nombres ni texto libre (lo impide la propia base de datos).

## Cambiar el bot

1. Edita `n8n/src*/…` (no edites los flujos a mano en n8n: se sobrescriben).
2. `python3 n8n/build.py`
3. Pruebas: `python3 tests/n8n/entorno.py arrancar && python3 tests/n8n/e2e.py`
4. Despliegue: `python3 n8n/deploy.py n8n`

## Pruebas

| Comando | Qué prueba |
|---|---|
| `python3 tests/n8n/entorno.py arrancar` | Monta Postgres 17 + simulador (Telegram, Calendar, Claude, Mistral) + n8n 2.39.10 en Docker |
| `python3 tests/n8n/e2e.py` | Bot de extremo a extremo, modo RESPIRO incluido (88 comprobaciones) |
| `npm run test:worker` | Worker + Mini App (chat y voz incluidos) + n8n local, con dos clientes (25 pruebas) |
| `tests/ia/real.js`, `tests/ia/admin_real.js` | Comprensión con la **API real** de Claude y modo RESPIRO contra la base real (cuestan céntimos) |
| `tests/sql/10_pruebas.sql`, `20_panel_web.sql`, `30_admin_consultas.sql` | RLS, panel web y seguridad del modo RESPIRO (42 + 17 + 19) |
| `tests/miniapp/vista.html` | Ver la Mini App en el navegador con datos de ejemplo |

## Secretos

Todos en `.dev.vars` (ignorado por git y por `.assetsignore`), nunca en el repo:

- `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `N8N_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (clave secreta de Supabase)
- Generados por `n8n/deploy.py secretos`: `TG_WEBHOOK_SECRETO`, `TG_RUTA`, `MINIAPP_SECRETO`, `N8N_PG_PASSWORD`

En Cloudflare (`wrangler secret put … --name respiro`): `TELEGRAM_BOT_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `MINIAPP_SECRETO`, `MISTRAL_API_KEY`.
En n8n: credenciales `RESPIRO Supabase`, `RESPIRO Anthropic`, `RESPIRO Mistral` y `Google Calendar account`. El token del bot y los secretos del webhook van en el nodo `G` de cada flujo, que rellena `deploy.py`.

## Despliegue

- **Web y Mini App**: push a `main` → Cloudflare despliega solo.
- **n8n**: `python3 n8n/deploy.py n8n`. En n8n 2.x los subflujos y el flujo de errores tienen que estar activos.
- **Telegram** (webhook, comandos, botón «Mi agenda»): `python3 n8n/deploy.py telegram`.
- **Base de datos**: migraciones de `supabase/migrations/` en orden.
- Estado: `python3 n8n/deploy.py comprobar`.

Recomendación: fijar la imagen de n8n del VPS a `n8nio/n8n:2.39.10` en vez de `latest`.
