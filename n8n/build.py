#!/usr/bin/env python3
"""Genera los flujos de n8n de RESPIRO a partir de n8n/src*/.

Uso:  python3 n8n/build.py            -> escribe n8n/flujos/*.json

Los JSON llevan marcadores __ASI__ en vez de secretos o ids; los rellena
n8n/deploy.py al subirlos (o tests/n8n/e2e.py en las pruebas).
Los nodos HTTP con credencial llevan 🔑 en el nombre.
"""
import json
import re
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
SRC = RAIZ / 'src'
SRC_T = RAIZ / 'src_transcripcion'
SRC_M = RAIZ / 'src_miniapp'
SRC_S = RAIZ / 'src_semanal'
SRC_A = RAIZ / 'src_admin'
SALIDA = RAIZ / 'flujos'

CRED_PG = {'postgres': {'id': '__CRED_PG__', 'name': 'RESPIRO Supabase'}}
CRED_GCAL = {'googleCalendarOAuth2Api': {'id': '__CRED_GCAL__', 'name': 'Google Calendar account'}}
CRED_ANTHROPIC = {'httpHeaderAuth': {'id': '__CRED_ANTHROPIC__', 'name': 'RESPIRO Anthropic'}}
CRED_MISTRAL = {'httpHeaderAuth': {'id': '__CRED_MISTRAL__', 'name': 'RESPIRO Mistral'}}

LIB = (SRC / 'lib.js').read_text()


def _id(nombre, flujo):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'respiro/{flujo}/{nombre}'))


def codigo(fichero, con_lib=True, carpeta=SRC):
    """Código de un nodo Code (modo "una vez para todos los elementos").
    Los fuentes usan $json / .item por legibilidad; aquí se traducen."""
    src = (carpeta / fichero).read_text()
    usa_json = '$json' in src
    src = src.replace('$json', '$J').replace('.item.json', '.first().json')
    pre = 'const $J = $input.first().json;\n' if usa_json else ''
    return (LIB + '\n' if con_lib else '') + pre + src


class Flujo:
    def __init__(self, nombre, clave):
        self.nombre = nombre
        self.clave = clave
        self.nodos = []
        self.con = {}

    def nodo(self, nombre, tipo, version, params, pos, **extra):
        n = {'parameters': params, 'id': _id(nombre, self.clave), 'name': nombre,
             'type': tipo, 'typeVersion': version, 'position': list(pos)}
        n.update(extra)
        self.nodos.append(n)
        return nombre

    def unir(self, a, b, salida=0, entrada=0):
        outs = self.con.setdefault(a, {'main': []})['main']
        while len(outs) <= salida:
            outs.append([])
        outs[salida].append({'node': b, 'type': 'main', 'index': entrada})

    # --- atajos de nodos ---
    def code(self, nombre, fichero, pos, con_lib=True, carpeta=SRC):
        return self.nodo(nombre, 'n8n-nodes-base.code', 2, {'jsCode': codigo(fichero, con_lib, carpeta)}, pos)

    def pg(self, nombre, sql, repl, pos, **extra):
        return self.nodo(nombre, 'n8n-nodes-base.postgres', 2.5, {
            'operation': 'executeQuery', 'query': sql,
            'options': {'queryReplacement': repl},
        }, pos, credentials=CRED_PG, **extra)

    def si(self, nombre, expr, pos):
        return self.nodo(nombre, 'n8n-nodes-base.if', 2.2, {
            'conditions': {
                'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                'conditions': [{'id': _id(nombre + '/c', self.clave), 'leftValue': expr, 'rightValue': '',
                                'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
                'combinator': 'and'},
            'options': {}}, pos)

    def switch(self, nombre, campo, valores, pos, resto=True):
        reglas = [{
            'conditions': {
                'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                'conditions': [{'id': _id(f'{nombre}/{v}', self.clave), 'leftValue': f'={{{{ {campo} }}}}', 'rightValue': v,
                                'operator': {'type': 'string', 'operation': 'equals'}}],
                'combinator': 'and'},
            'renameOutput': True, 'outputKey': v} for v in valores]
        return self.nodo(nombre, 'n8n-nodes-base.switch', 3.2, {
            'rules': {'values': reglas},
            'options': {'fallbackOutput': 'extra', 'renameFallbackOutput': 'resto'} if resto else {}}, pos)

    def http(self, nombre, params, pos, cred=None, **extra):
        p = {'options': {'timeout': 30000}}
        p.update(params)
        if cred is None:
            p.setdefault('authentication', 'none')
        extra.setdefault('onError', 'continueRegularOutput')
        kw = {'credentials': cred} if cred else {}
        return self.nodo(nombre, 'n8n-nodes-base.httpRequest', 4.2, p, pos, **kw, **extra)

    def json(self, settings):
        return {'name': self.nombre, 'nodes': self.nodos, 'connections': self.con, 'settings': settings}


G_EXPR = "$('G').first().json"
TG_API = {
    'method': 'POST',
    'url': f"={{{{ {G_EXPR}.tg_base }}}}/bot{{{{ {G_EXPR}.tg_token }}}}/{{{{ $json.tg.method }}}}",
    'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ JSON.stringify($json.tg.body) }}',
}


def flujo_bot():
    f = Flujo('RESPIRO · Bot Telegram', 'bot')
    X = lambda c: c * 240
    Y = lambda r: r * 180

    f.nodo('Nota', 'n8n-nodes-base.stickyNote', 1, {'width': 760, 'height': 300, 'content': (
        '# RESPIRO · Bot general de Telegram\n'
        'Un solo bot para todos los clientes. Cada mensaje: **Norm** (verifica la cabecera secreta de Telegram) → '
        '**Dedupe** (`processed_events`) → **Auth** (chat_id → cliente y rol) → **Ruta**.\n\n'
        '- Texto y voz → IA (catálogo cerrado, JSON validado) → **Plan** (comprueba huecos, nombres, móvil) → '
        'resumen con **Sí / No** → **Ejecutar** en Google Calendar (fuente de verdad).\n'
        '- Nada se escribe sin pulsar Sí. Los logs no llevan datos personales.\n\n'
        '🔑 Credenciales: `RESPIRO Supabase` (Postgres), `Google Calendar account`, `RESPIRO Anthropic` (cabecera x-api-key).\n'
        'Generado por `n8n/build.py`: no editar a mano, editar `n8n/src/` y volver a desplegar.')},
        (X(-1), Y(-3)))

    f.nodo('Telegram · Entrada', 'n8n-nodes-base.webhook', 2, {
        'httpMethod': 'POST', 'path': 'respiro-bot-__TG_PATH__', 'responseMode': 'responseNode', 'options': {}},
        (X(0), Y(0)), webhookId=_id('webhook', 'bot'))
    f.nodo('Responder 200', 'n8n-nodes-base.respondToWebhook', 1.1, {
        'respondWith': 'json', 'responseBody': '={"ok":true}', 'options': {}}, (X(1), Y(0)))
    f.code('G', 'g.js', (X(2), Y(0)), con_lib=False)
    # Segunda entrada: el chat de la Mini App (lo llama el Worker, firmado). Responde por HTTP.
    f.nodo('Mini App · Chat', 'n8n-nodes-base.webhook', 2, {
        'httpMethod': 'POST', 'path': 'respiro-chat', 'responseMode': 'responseNode', 'options': {}},
        (X(0), Y(-1.5)), webhookId=_id('webhook-chat', 'bot'))
    f.si('¿Desde la Mini App?', "={{ $('Mini App · Chat').isExecuted }}", (X(2.5), Y(-0.75)))
    f.nodo('Firma chat', 'n8n-nodes-base.crypto', 1, {
        'action': 'hmac', 'type': 'SHA256',
        'value': "={{ $('Mini App · Chat').first().json.body.ts + '.' + $('Mini App · Chat').first().json.body.nonce + '.' + $('Mini App · Chat').first().json.body.payload }}",
        'dataPropertyName': 'firma_calc', 'secret': "={{ $('G').first().json.miniapp_secreto }}", 'encoding': 'hex'},
        (X(3), Y(-1.5)))
    f.code('Norm', 'norm.js', (X(3.5), Y(0)))
    f.si('¿Entrada válida?', '={{ !$json.rechazado }}', (X(4), Y(0)))
    f.pg('Dedupe', "select respiro.dedupe($1, $3) as nuevo, $2::jsonb as m",
         "={{ [ $json.dedupe, JSON.stringify($json), $json.canal ] }}", (X(4.5), Y(0)))
    f.si('¿Nuevo?', '={{ $json.nuevo }}', (X(5), Y(0)))
    f.si('¿Repetida en la Mini App?', "={{ ($json.m || {}).canal === 'miniapp' }}", (X(5.5), Y(-1.5)))
    f.nodo('Chat · Rechazo', 'n8n-nodes-base.code', 2, {'jsCode': (
        "const j = $input.first().json;\n"
        "const motivo = j.rechazado || 'repetida';\n"
        "return [{ json: { status: motivo === 'repetida' ? 409 : (motivo === 'firma' || motivo === 'caducada' ? 401 : 400), respuesta: { ok: false, error: motivo } } }];")},
        (X(6), Y(-1.5)))
    f.pg('Auth', 'select respiro.auth_chat($1::bigint) as cfg, $2::jsonb as m',
         '={{ [ $json.m.chat_id, JSON.stringify($json.m) ] }}', (X(6), Y(0)))
    f.code('Ruta', 'ruta.js', (X(7), Y(0)))
    f.switch('Ruta · ¿Qué es?', '$json.ruta', ['start', 'comando', 'callback', 'voz', 'texto', 'admin'], (X(8), Y(0)))
    for a, b in [('Telegram · Entrada', 'Responder 200'), ('Responder 200', 'G'), ('Mini App · Chat', 'G'),
                 ('G', '¿Desde la Mini App?'), ('Firma chat', 'Norm'), ('Norm', '¿Entrada válida?'),
                 ('Dedupe', '¿Nuevo?'), ('Auth', 'Ruta'), ('Ruta', 'Ruta · ¿Qué es?')]:
        f.unir(a, b)
    f.unir('¿Desde la Mini App?', 'Firma chat', 0)
    f.unir('¿Desde la Mini App?', 'Norm', 1)
    f.unir('¿Entrada válida?', 'Dedupe', 0)
    f.unir('¿Entrada válida?', 'Chat · Rechazo', 1)
    f.unir('¿Nuevo?', 'Auth', 0)
    f.unir('¿Nuevo?', '¿Repetida en la Mini App?', 1)
    f.unir('¿Repetida en la Mini App?', 'Chat · Rechazo', 0)

    # start (invitación)
    f.pg('Canjear invitación', 'select respiro.canjear_invitacion($1, $2::bigint, $3::bigint, $4) as r, $5::jsonb as x',
         '={{ [ $json.codigo, $json.m.chat_id, $json.m.user_id, $json.m.nombre_tg || "", JSON.stringify({ m: $json.m }) ] }}',
         (X(9), Y(-2)))
    f.code('Bienvenida', 'bienvenida.js', (X(10), Y(-2)))
    f.unir('Ruta · ¿Qué es?', 'Canjear invitación', 0)
    f.unir('Canjear invitación', 'Bienvenida')

    # comandos
    f.code('Comando', 'comando.js', (X(9), Y(-1)))
    f.nodo('Comando · ¿Qué hace?', 'n8n-nodes-base.switch', 3.2, {
        'rules': {'values': [
            {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                            'conditions': [{'id': _id('cmd/sql', 'bot'), 'leftValue': '={{ !!$json.sql }}', 'rightValue': '',
                                            'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
                            'combinator': 'and'}, 'renameOutput': True, 'outputKey': 'sql'},
            {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                            'conditions': [{'id': _id('cmd/agenda', 'bot'), 'leftValue': "={{ $json.siguiente === 'consulta' }}", 'rightValue': '',
                                            'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
                            'combinator': 'and'}, 'renameOutput': True, 'outputKey': 'agenda'},
            {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                            'conditions': [{'id': _id('cmd/admin', 'bot'), 'leftValue': "={{ $json.siguiente === 'admin' }}", 'rightValue': '',
                                            'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
                            'combinator': 'and'}, 'renameOutput': True, 'outputKey': 'admin'}]},
        'options': {'fallbackOutput': 'extra', 'renameFallbackOutput': 'responder'}}, (X(10), Y(-1)))
    f.pg('Comando · SQL', '={{ $json.sql.q }}', '={{ $json.sql.p }}', (X(11), Y(-1)))
    f.code('Comando · Respuesta', 'comando_resp.js', (X(12), Y(-1)))
    f.unir('Ruta · ¿Qué es?', 'Comando', 1)
    f.unir('Comando', 'Comando · ¿Qué hace?')
    f.unir('Comando · ¿Qué hace?', 'Comando · SQL', 0)
    f.unir('Comando · SQL', 'Comando · Respuesta')

    # botones
    f.code('Callback · Leer', 'callback_leer.js', (X(9), Y(0)))
    f.si('Callback · ¿Válido?', '={{ !$json.salida }}', (X(10), Y(0)))
    f.pg('Tomar pendiente', 'select respiro.tomar_pendiente($1::uuid, $2::bigint, $3) as p, $4::jsonb as x',
         '={{ [ $json.pid, $json.m.chat_id, $json.op, JSON.stringify($json) ] }}', (X(11), Y(0)))
    f.code('Callback · Ruta', 'callback_ruta.js', (X(12), Y(0)))
    f.unir('Ruta · ¿Qué es?', 'Callback · Leer', 2)
    f.unir('Callback · Leer', 'Callback · ¿Válido?')
    f.unir('Callback · ¿Válido?', 'Tomar pendiente', 0)
    f.unir('Tomar pendiente', 'Callback · Ruta')

    # voz
    f.code('Voz · Preparar', 'voz_preparar.js', (X(9), Y(1)))
    f.si('¿Transcribir?', '={{ !$json.salida }}', (X(10), Y(1)))
    f.nodo('Transcribir audio', 'n8n-nodes-base.executeWorkflow', 1.2, {
        'workflowId': {'__rl': True, 'value': '__WF_TRANSCRIPCION__', 'mode': 'id'},
        'options': {'waitForSubWorkflow': True}}, (X(11), Y(1)))
    f.code('Voz · Resultado', 'voz_resultado.js', (X(12), Y(1)))
    f.si('¿Audio entendido?', '={{ !$json.salida }}', (X(13), Y(1)))
    f.unir('Ruta · ¿Qué es?', 'Voz · Preparar', 3)
    f.unir('Voz · Preparar', '¿Transcribir?')
    f.unir('¿Transcribir?', 'Transcribir audio', 0)
    f.unir('Transcribir audio', 'Voz · Resultado')
    f.unir('Voz · Resultado', '¿Audio entendido?')

    # texto
    f.pg('¿Esperando dato?',
         'select respiro.pendiente_esperando($1::bigint) as p, respiro.lista_espera_cliente($2::uuid) as espera, $3::jsonb as x',
         '={{ [ $json.m.chat_id, $json.cfg.cliente_id, JSON.stringify({ m: $json.m, cfg: $json.cfg }) ] }}', (X(14), Y(2)))
    f.code('Texto · Ruta', 'texto_ruta.js', (X(15), Y(2)))
    f.unir('Ruta · ¿Qué es?', '¿Esperando dato?', 4)
    f.unir('¿Audio entendido?', '¿Esperando dato?', 0)
    f.unir('¿Esperando dato?', 'Texto · Ruta')

    # respuestas fijas
    f.code('Respuestas fijas', 'fijas.js', (X(9), Y(3)))
    f.unir('Ruta · ¿Qué es?', 'Respuestas fijas', 6)

    # agenda común
    f.code('Pedir agenda', 'pedir_agenda.js', (X(16), Y(0)))
    f.si('¿Leer agenda?', '={{ !$json.salida }}', (X(17), Y(0)))
    f.http('🔑 Leer agenda', {
        'url': f"={{{{ {G_EXPR}.gcal_base }}}}/calendars/{{{{ encodeURIComponent($json.cfg.calendario_id) }}}}/events",
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'googleCalendarOAuth2Api',
        'sendQuery': True, 'queryParameters': {'parameters': [
            {'name': 'timeMin', 'value': '={{ $json.rango.min }}'},
            {'name': 'timeMax', 'value': '={{ $json.rango.max }}'},
            {'name': 'singleEvents', 'value': 'true'},
            {'name': 'orderBy', 'value': 'startTime'},
            {'name': 'maxResults', 'value': '2500'},
            {'name': 'fields', 'value': 'items(id,summary,status,transparency,start,end,extendedProperties)'},
        ]}}, (X(18), Y(0)), cred=CRED_GCAL)
    f.code('Con agenda', 'con_agenda.js', (X(19), Y(0)))
    f.switch('Siguiente', '$json.siguiente', ['ia', 'plan', 'ejecutar', 'consulta'], (X(20), Y(0)))
    for origen in ['Texto · Ruta', 'Callback · Ruta']:
        f.unir(origen, 'Pedir agenda')
    f.unir('Comando · ¿Qué hace?', 'Pedir agenda', 1)
    f.unir('Pedir agenda', '¿Leer agenda?')
    f.unir('¿Leer agenda?', '🔑 Leer agenda', 0)
    f.unir('🔑 Leer agenda', 'Con agenda')
    f.unir('Con agenda', 'Siguiente')

    # IA
    f.code('IA · Preparar', 'ia_preparar.js', (X(21), Y(-2)))
    f.http('🔑 IA · Claude', {
        'method': 'POST', 'url': f"={{{{ {G_EXPR}.anthropic_base }}}}/v1/messages",
        'authentication': 'genericCredentialType', 'genericAuthType': 'httpHeaderAuth',
        'sendHeaders': True, 'headerParameters': {'parameters': [{'name': 'anthropic-version', 'value': '2023-06-01'}]},
        'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ JSON.stringify($json.ia_body) }}',
        'options': {'timeout': 45000}}, (X(22), Y(-2)), cred=CRED_ANTHROPIC)
    f.code('IA · Validar', 'ia_validar.js', (X(23), Y(-2)))
    f.si('¿Reintentar IA?', '={{ $json.reintentar === true }}', (X(24), Y(-2)))
    f.unir('Siguiente', 'IA · Preparar', 0)
    f.unir('IA · Preparar', '🔑 IA · Claude')
    f.unir('🔑 IA · Claude', 'IA · Validar')
    f.unir('IA · Validar', '¿Reintentar IA?')
    f.unir('¿Reintentar IA?', 'IA · Preparar', 0)

    # Plan y resumen
    f.code('Plan', 'plan.js', (X(25), Y(-1)))
    f.si('¿Guardar?', '={{ !!$json.guardar }}', (X(26), Y(-1)))
    f.pg('Guardar pendiente',
         'with g as (select respiro.guardar_pendiente($1::uuid, $2::uuid, $3::bigint, $4::jsonb, $5, $6::jsonb) as id)\n'
         'select g.id, respiro.caducar_pendientes($3::bigint, g.id) as caducados from g',
         '={{ [ $json.guardar.id || null, $json.cfg.cliente_id, $json.m.chat_id, JSON.stringify($json.guardar.acciones), '
         '$json.guardar.estado, $json.guardar.pregunta ? JSON.stringify($json.guardar.pregunta) : null ] }}', (X(27), Y(-1)))
    f.code('Resumen', 'resumen.js', (X(28), Y(-1)))
    f.unir('¿Reintentar IA?', 'Plan', 1)
    f.unir('Siguiente', 'Plan', 1)
    f.unir('Plan', '¿Guardar?')
    f.unir('¿Guardar?', 'Guardar pendiente', 0)
    f.unir('¿Guardar?', 'Resumen', 1)
    f.unir('Guardar pendiente', 'Resumen')

    # Ejecutar en Google Calendar
    f.code('Ejecutar · Preparar', 'ejecutar_prep.js', (X(21), Y(1)))
    f.http('🔑 Calendar · Escribir', {
        'method': '={{ $json.req.method }}', 'url': '={{ $json.req.url }}',
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'googleCalendarOAuth2Api',
        'sendQuery': True, 'specifyQuery': 'json', 'jsonQuery': '={{ JSON.stringify($json.req.qs || {}) }}',
        'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ JSON.stringify($json.req.body || {}) }}',
    }, (X(22), Y(1)), cred=CRED_GCAL)
    # Se ejecuta una sola vez y solo cuando han terminado todas las escrituras.
    f.http('🔑 Calendar · Verificar', {
        'url': "={{ $('Ejecutar · Preparar').first().json.ctx.verif.url }}",
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'googleCalendarOAuth2Api',
        'sendQuery': True, 'specifyQuery': 'json', 'jsonQuery': "={{ JSON.stringify($('Ejecutar · Preparar').first().json.ctx.verif.qs) }}",
    }, (X(23), Y(1)), cred=CRED_GCAL, executeOnce=True)
    f.code('Ejecutar · Resultado', 'ejecutar_res.js', (X(24), Y(1)))
    f.unir('Siguiente', 'Ejecutar · Preparar', 2)
    f.unir('Ejecutar · Preparar', '🔑 Calendar · Escribir')
    f.unir('🔑 Calendar · Escribir', '🔑 Calendar · Verificar')
    f.unir('🔑 Calendar · Verificar', 'Ejecutar · Resultado')

    # Consultas de comandos
    f.code('Consulta', 'consulta.js', (X(21), Y(2)))
    f.unir('Siguiente', 'Consulta', 3)

    # Modo RESPIRO (solo admins sin cliente elegido): pregunta → SQL de solo lectura → respuesta
    f.pg('Admin · Historial', 'select respiro.admin_historial_de($1::bigint) as historial, $2::jsonb as x',
         '={{ [ $json.m.chat_id, JSON.stringify({ m: $json.m, cfg: $json.cfg }) ] }}', (X(9), Y(4)))
    f.nodo('Admin · Contexto', 'n8n-nodes-base.code', 2, {'jsCode': 'const j = $input.first().json;\nreturn [{ json: { ...j.x, historial: j.historial || [] } }];'}, (X(10), Y(4)))
    f.code('Admin · Preparar', 'admin_preparar.js', (X(11), Y(4)), carpeta=SRC_A)
    f.http('🔑 Admin · Claude SQL', {
        'method': 'POST', 'url': f"={{{{ {G_EXPR}.anthropic_base }}}}/v1/messages",
        'authentication': 'genericCredentialType', 'genericAuthType': 'httpHeaderAuth',
        'sendHeaders': True, 'headerParameters': {'parameters': [{'name': 'anthropic-version', 'value': '2023-06-01'}]},
        'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ JSON.stringify($json.admin_body) }}',
        'options': {'timeout': 60000}}, (X(12), Y(4)), cred=CRED_ANTHROPIC)
    f.code('Admin · Validar', 'admin_validar.js', (X(13), Y(4)), carpeta=SRC_A)
    f.si('¿Consultar datos?', '={{ !!$json.sql }}', (X(14), Y(4)))
    f.pg('Admin · Consultar', 'select respiro_admin.consultar($1) as filas', '={{ [ $json.sql ] }}', (X(15), Y(3.5)),
         onError='continueRegularOutput')
    f.code('Admin · Tras SQL', 'admin_tras_sql.js', (X(16), Y(3.5)), carpeta=SRC_A)
    f.si('¿Reintentar consulta?', '={{ $json.reintentar === true }}', (X(17), Y(3.5)))
    f.code('Admin · Redactar', 'admin_redactar.js', (X(18), Y(4)), carpeta=SRC_A)
    f.si('¿Redactar con IA?', '={{ !!$json.redactar_body }}', (X(19), Y(4)))
    f.http('🔑 Admin · Claude respuesta', {
        'method': 'POST', 'url': f"={{{{ {G_EXPR}.anthropic_base }}}}/v1/messages",
        'authentication': 'genericCredentialType', 'genericAuthType': 'httpHeaderAuth',
        'sendHeaders': True, 'headerParameters': {'parameters': [{'name': 'anthropic-version', 'value': '2023-06-01'}]},
        'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ JSON.stringify($json.redactar_body) }}',
        'options': {'timeout': 60000}}, (X(20), Y(3.5)), cred=CRED_ANTHROPIC)
    f.code('Admin · Respuesta', 'admin_respuesta.js', (X(21), Y(4)), carpeta=SRC_A)
    f.pg('Admin · Recordar', 'select respiro.admin_recordar($1::bigint, $2, $3) as n, $4::jsonb as salida',
         '={{ [ $json.recordar.chat_id, $json.recordar.pregunta, $json.recordar.sql, JSON.stringify($json.salida) ] }}', (X(22), Y(4)))
    f.unir('Ruta · ¿Qué es?', 'Admin · Historial', 5)
    f.unir('Comando · ¿Qué hace?', 'Admin · Historial', 2)
    for a, b in [('Admin · Historial', 'Admin · Contexto'), ('Admin · Contexto', 'Admin · Preparar'),
                 ('Admin · Preparar', '🔑 Admin · Claude SQL'), ('🔑 Admin · Claude SQL', 'Admin · Validar'),
                 ('Admin · Validar', '¿Consultar datos?'), ('Admin · Consultar', 'Admin · Tras SQL'),
                 ('Admin · Tras SQL', '¿Reintentar consulta?'), ('Admin · Redactar', '¿Redactar con IA?'),
                 ('🔑 Admin · Claude respuesta', 'Admin · Respuesta'), ('Admin · Respuesta', 'Admin · Recordar'),
                 ('Admin · Recordar', 'Log y salida')]:
        f.unir(a, b)
    f.unir('¿Consultar datos?', 'Admin · Consultar', 0)
    f.unir('¿Consultar datos?', 'Admin · Redactar', 1)
    f.unir('¿Reintentar consulta?', 'Admin · Preparar', 0)
    f.unir('¿Reintentar consulta?', 'Admin · Redactar', 1)
    f.unir('¿Redactar con IA?', '🔑 Admin · Claude respuesta', 0)
    f.unir('¿Redactar con IA?', 'Admin · Respuesta', 1)

    # Salida común: log (sin datos personales) + consumo de IA + mensajes
    f.pg('Log y salida',
         "select respiro.log_eventos($1::jsonb) as n,\n"
         "  case when jsonb_typeof($3::jsonb) = 'object' then respiro.registrar_consumo_ia(($3::jsonb->>'cliente_id')::uuid, $3::jsonb->>'modelo',\n"
         "    ($3::jsonb->>'entrada')::int, ($3::jsonb->>'salida')::int, ($3::jsonb->>'cache_lect')::int, ($3::jsonb->>'cache_escr')::int,\n"
         "    coalesce($3::jsonb->>'uso', 'acciones')) end as coste,\n"
         "  $2::jsonb as tg, $4::text as admin_txt,\n"
         "  case when length($4::text) > 0 then respiro.admins() else '[]'::jsonb end as admins",
         '={{ [ JSON.stringify($json.salida.logs || []), JSON.stringify($json.salida.tg || []), '
         'JSON.stringify($json.salida.consumo || null), $json.salida.admin || "" ] }}', (X(30), Y(0)))
    f.code('Salida', 'salida.js', (X(31), Y(0)))
    f.si('¿Respuesta a la Mini App?', '={{ !!$json.respuesta }}', (X(31.5), Y(-1)))
    f.nodo('Responder chat', 'n8n-nodes-base.respondToWebhook', 1.1, {
        'respondWith': 'json', 'responseBody': '={{ JSON.stringify($json.respuesta) }}',
        'options': {'responseCode': '={{ $json.status || 200 }}'}}, (X(32), Y(-2)))
    f.http('TG · API', TG_API, (X(32), Y(0)))
    for origen, salida in [('Bienvenida', 0), ('Respuestas fijas', 0), ('Comando · Respuesta', 0), ('Resumen', 0),
                           ('Ejecutar · Resultado', 0), ('Consulta', 0), ('Callback · ¿Válido?', 1), ('¿Transcribir?', 1),
                           ('¿Audio entendido?', 1), ('¿Leer agenda?', 1), ('Siguiente', 4), ('Comando · ¿Qué hace?', 3)]:
        f.unir(origen, 'Log y salida', salida)
    f.unir('Log y salida', 'Salida')
    f.unir('Salida', '¿Respuesta a la Mini App?')
    f.unir('¿Respuesta a la Mini App?', 'Responder chat', 0)
    f.unir('¿Respuesta a la Mini App?', 'TG · API', 1)
    f.unir('Chat · Rechazo', 'Responder chat')
    # Si Telegram rechaza un mensaje (HTML mal formado, chat bloqueado…) no se calla: aviso a los admins.
    f.nodo('TG · ¿Rechazado?', 'n8n-nodes-base.code', 2, {'jsCode': (
        "// Telegram responde ok:false o error HTTP → aviso a admins (sin el texto del mensaje).\n"
        "const env = $('Salida').all().filter((x) => x.json.tg);\n"
        "const fallos = $input.all().map((r, i) => ({ r: r.json || {}, m: (env[i] && env[i].json.tg) || {} }))\n"
        "  .filter((x) => x.r.ok !== true && x.m.method !== 'answerCallbackQuery' && !/message is not modified/i.test(JSON.stringify(x.r)));\n"
        "if (!fallos.length) return [];\n"
        "const motivo = fallos.map((x) => `${x.m.method}: ${String((x.r.error && (x.r.error.description || x.r.error.message)) || x.r.description || 'error').slice(0, 160)}`).join('\\n');\n"
        "return [{ json: { motivo } }];")}, (33 * 240, 180))
    f.pg('Admins (aviso)', 'select respiro.admins() as admins, $1::text as motivo', '={{ [ $json.motivo ] }}', (34 * 240, 180))
    f.nodo('Aviso a admins', 'n8n-nodes-base.code', 2, {'jsCode': (
        "const { admins, motivo } = $input.first().json;\n"
        "return (admins || []).map((chat) => ({ json: { tg: { method: 'sendMessage', body: { chat_id: chat, text: '⚠️ Telegram ha rechazado un mensaje del bot:\\n' + motivo } } } }));")},
        (35 * 240, 180))
    f.http('TG · API (aviso)', TG_API, (36 * 240, 180))
    f.unir('TG · API', 'TG · ¿Rechazado?')
    f.unir('TG · ¿Rechazado?', 'Admins (aviso)')
    f.unir('Admins (aviso)', 'Aviso a admins')
    f.unir('Aviso a admins', 'TG · API (aviso)')

    return f.json({
        'executionOrder': 'v1', 'timezone': 'Europe/Madrid', 'errorWorkflow': '__WF_ERRORES__',
        # Privacidad: las ejecuciones correctas no se guardan (llevan nombres y móviles).
        'saveDataSuccessExecution': 'none', 'saveDataErrorExecution': 'all', 'saveManualExecutions': False,
        'callerPolicy': 'workflowsFromSameOwner',
    })


def flujo_transcripcion():
    f = Flujo('RESPIRO · Bot Transcripción', 'transcripcion')
    X = lambda c: c * 240
    f.nodo('Nota', 'n8n-nodes-base.stickyNote', 1, {'width': 560, 'height': 220, 'content': (
        '# Transcripción de notas de voz\n'
        'Telegram → descarga → **Mistral Voxtral (UE)** → solo devuelve el texto.\n'
        'Este flujo **no guarda ejecuciones** (ni correctas ni con error): el audio no queda almacenado en n8n.\n'
        '🔑 `RESPIRO Mistral` (cabecera Authorization: Bearer …) y `RESPIRO Supabase`.')}, (0, -300))
    f.nodo('Inicio', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, {'inputSource': 'passthrough'}, (X(0), 0))
    f.code('G', 'g.js', (X(1), 0), con_lib=False, carpeta=SRC_T)
    f.code('Transcripción · Entrada', 't_entrada.js', (X(2), 0), con_lib=False, carpeta=SRC_T)
    f.http('TG · Ruta del audio', {
        'url': f"={{{{ {G_EXPR}.tg_base }}}}/bot{{{{ {G_EXPR}.tg_token }}}}/getFile",
        'sendQuery': True, 'queryParameters': {'parameters': [{'name': 'file_id', 'value': '={{ $json.file_id }}'}]}},
        (X(3), 0))
    f.http('TG · Descargar audio', {
        'url': f"={{{{ {G_EXPR}.tg_base }}}}/file/bot{{{{ {G_EXPR}.tg_token }}}}/{{{{ $json.result.file_path }}}}",
        'options': {'timeout': 30000, 'response': {'response': {'responseFormat': 'file', 'outputPropertyName': 'audio'}}}},
        (X(4), 0))
    f.http('🔑 Mistral · Transcribir', {
        'method': 'POST', 'url': f"={{{{ {G_EXPR}.mistral_base }}}}/v1/audio/transcriptions",
        'authentication': 'genericCredentialType', 'genericAuthType': 'httpHeaderAuth',
        'sendBody': True, 'contentType': 'multipart-form-data', 'bodyParameters': {'parameters': [
            {'parameterType': 'formBinaryData', 'name': 'file', 'inputDataFieldName': 'audio'},
            {'name': 'model', 'value': 'voxtral-mini-latest'},
            {'name': 'language', 'value': 'es'},
        ]}, 'options': {'timeout': 60000}}, (X(5), 0), cred=CRED_MISTRAL)
    f.code('Transcripción · Salida', 't_salida.js', (X(6), 0), con_lib=False, carpeta=SRC_T)
    f.pg('Consumo audio',
         "select case when length($1) = 36 then respiro.registrar_consumo_audio($1::uuid, $2, $3::int) end as coste, $4::jsonb as r",
         '={{ [ $json.consumo.cliente_id || "", $json.consumo.modelo, $json.consumo.segundos, JSON.stringify({ texto: $json.texto, error: $json.error }) ] }}',
         (X(7), 0))
    f.nodo('Devolver texto', 'n8n-nodes-base.code', 2, {'jsCode': 'return [{ json: $input.first().json.r }];'}, (X(8), 0))
    for a, b in [('Inicio', 'G'), ('G', 'Transcripción · Entrada'), ('Transcripción · Entrada', 'TG · Ruta del audio'),
                 ('TG · Ruta del audio', 'TG · Descargar audio'), ('TG · Descargar audio', '🔑 Mistral · Transcribir'),
                 ('🔑 Mistral · Transcribir', 'Transcripción · Salida'), ('Transcripción · Salida', 'Consumo audio'),
                 ('Consumo audio', 'Devolver texto')]:
        f.unir(a, b)
    return f.json({'executionOrder': 'v1', 'timezone': 'Europe/Madrid', 'errorWorkflow': '__WF_ERRORES__',
                   'saveDataSuccessExecution': 'none', 'saveDataErrorExecution': 'none', 'saveManualExecutions': False,
                   'callerPolicy': 'workflowsFromSameOwner'})


def flujo_errores():
    f = Flujo('RESPIRO · Bot Errores', 'errores')
    f.nodo('Error', 'n8n-nodes-base.errorTrigger', 1, {}, (0, 0))
    f.code('G', 'g.js', (240, 0), con_lib=False)
    f.pg('Admins', 'select respiro.admins() as admins', '={{ [] }}', (480, 0))
    f.nodo('Aviso', 'n8n-nodes-base.code', 2, {'jsCode': (
        "// Aviso a los admins. Solo nombre del flujo, nodo y mensaje (recortado): sin datos de pacientes.\n"
        "const e = $('Error').first().json;\n"
        "const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');\n"
        "const msg = String((e.execution && e.execution.error && e.execution.error.message) || 'Error desconocido').slice(0, 200);\n"
        "const nodo = (e.execution && e.execution.lastNodeExecuted) || '?';\n"
        "const texto = `🚨 <b>${esc(e.workflow && e.workflow.name)}</b>\\nNodo: ${esc(nodo)}\\n${esc(msg)}`;\n"
        "return ($input.first().json.admins || []).map((chat) => ({ json: { tg: { method: 'sendMessage', body: { chat_id: chat, text: texto, parse_mode: 'HTML' } } } }));")},
        (720, 0))
    f.http('TG · API', TG_API, (960, 0))
    for a, b in [('Error', 'G'), ('G', 'Admins'), ('Admins', 'Aviso'), ('Aviso', 'TG · API')]:
        f.unir(a, b)
    return f.json({'executionOrder': 'v1', 'timezone': 'Europe/Madrid', 'saveDataSuccessExecution': 'all'})


def flujo_miniapp():
    f = Flujo('RESPIRO · Mini App API', 'miniapp')
    X = lambda c: c * 240
    f.nodo('Nota', 'n8n-nodes-base.stickyNote', 1, {'width': 620, 'height': 240, 'content': (
        '# API de la Mini App (escrituras y agenda)\n'
        'Solo la llama el Worker de Cloudflare. Cada petición va **firmada**: HMAC-SHA256(secreto, `ts.nonce.payload`), '
        'con marca de tiempo de menos de 60 s y nonce de un solo uso (`processed_events`).\n'
        'El `cliente_id` lo pone el Worker a partir del usuario de Telegram verificado.\n'
        'Crear cita → Google Calendar (fuente de verdad), así se dispara «Cita creada».\n'
        '🔑 `Google Calendar account`, `RESPIRO Supabase`.')}, (0, -320))
    f.nodo('Mini App · Entrada', 'n8n-nodes-base.webhook', 2, {
        'httpMethod': 'POST', 'path': 'respiro-miniapp', 'responseMode': 'responseNode', 'options': {}},
        (X(0), 0), webhookId=_id('webhook', 'miniapp'))
    f.code('G', 'g.js', (X(1), 0), con_lib=False)
    f.nodo('Firma', 'n8n-nodes-base.crypto', 1, {
        'action': 'hmac', 'type': 'SHA256',
        'value': "={{ $('Mini App · Entrada').first().json.body.ts + '.' + $('Mini App · Entrada').first().json.body.nonce + '.' + $('Mini App · Entrada').first().json.body.payload }}",
        'dataPropertyName': 'firma_calc', 'secret': "={{ $('G').first().json.miniapp_secreto }}", 'encoding': 'hex'}, (X(2), 0))
    f.code('Verificar', 'verificar.js', (X(3), 0), con_lib=False, carpeta=SRC_M)
    f.si('¿Firma válida?', '={{ $json.ok === true }}', (X(4), 0))
    f.pg('Cliente y nonce',
         "select respiro.dedupe('mini:' || $1, 'miniapp', $2::uuid) as nuevo, respiro.cfg_cliente($2::uuid) as cfg, $3::jsonb as req",
         '={{ [ $json.nonce, $json.req.cliente_id, JSON.stringify($json.req) ] }}', (X(5), 0))
    f.code('Mini App · Preparar', 'preparar.js', (X(6), 0), carpeta=SRC_M)
    f.si('¿Leer calendario?', '={{ !$json.respuesta }}', (X(7), 0))
    f.http('🔑 Leer agenda', {
        'url': f"={{{{ {G_EXPR}.gcal_base }}}}/calendars/{{{{ encodeURIComponent($json.cfg.calendario_id) }}}}/events",
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'googleCalendarOAuth2Api',
        'sendQuery': True, 'queryParameters': {'parameters': [
            {'name': 'timeMin', 'value': '={{ $json.rango.min }}'},
            {'name': 'timeMax', 'value': '={{ $json.rango.max }}'},
            {'name': 'singleEvents', 'value': 'true'},
            {'name': 'orderBy', 'value': 'startTime'},
            {'name': 'maxResults', 'value': '2500'},
            {'name': 'fields', 'value': 'items(id,summary,status,transparency,start,end,extendedProperties)'},
        ]}}, (X(8), 0), cred=CRED_GCAL)
    f.code('Mini App · Operar', 'operar.js', (X(9), 0), carpeta=SRC_M)
    f.si('¿Crear evento?', '={{ $json.escribir === true }}', (X(10), 0))
    f.http('🔑 Calendar · Crear', {
        'method': 'POST', 'url': '={{ $json.req.url }}',
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'googleCalendarOAuth2Api',
        'sendQuery': True, 'queryParameters': {'parameters': [{'name': 'sendUpdates', 'value': 'none'}]},
        'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ JSON.stringify($json.req.body) }}'}, (X(11), -1 * 180), cred=CRED_GCAL)
    f.code('Mini App · Creado', 'creado.js', (X(12), -180), carpeta=SRC_M)
    f.pg('Log', 'select respiro.log_eventos($1::jsonb) as n, $2::jsonb as respuesta, $3::int as status',
         '={{ [ JSON.stringify($json.logs), JSON.stringify($json.respuesta), $json.status ] }}', (X(13), -180))
    f.nodo('Responder', 'n8n-nodes-base.respondToWebhook', 1.1, {
        'respondWith': 'json', 'responseBody': '={{ JSON.stringify($json.respuesta) }}',
        'options': {'responseCode': '={{ $json.status || 200 }}'}}, (X(14), 0))
    for a, b in [('Mini App · Entrada', 'G'), ('G', 'Firma'), ('Firma', 'Verificar'), ('Verificar', '¿Firma válida?'),
                 ('Cliente y nonce', 'Mini App · Preparar'), ('Mini App · Preparar', '¿Leer calendario?'),
                 ('🔑 Leer agenda', 'Mini App · Operar'), ('Mini App · Operar', '¿Crear evento?'),
                 ('🔑 Calendar · Crear', 'Mini App · Creado'), ('Mini App · Creado', 'Log'), ('Log', 'Responder')]:
        f.unir(a, b)
    f.unir('¿Firma válida?', 'Cliente y nonce', 0)
    f.unir('¿Firma válida?', 'Responder', 1)
    f.unir('¿Leer calendario?', '🔑 Leer agenda', 0)
    f.unir('¿Leer calendario?', 'Responder', 1)
    f.unir('¿Crear evento?', '🔑 Calendar · Crear', 0)
    f.unir('¿Crear evento?', 'Responder', 1)
    return f.json({'executionOrder': 'v1', 'timezone': 'Europe/Madrid', 'errorWorkflow': '__WF_ERRORES__',
                   'saveDataSuccessExecution': 'none', 'saveDataErrorExecution': 'all', 'saveManualExecutions': False})


def flujo_semanal():
    f = Flujo('RESPIRO · Informe semanal y mantenimiento', 'semanal')
    X = lambda c: c * 240
    f.nodo('Nota', 'n8n-nodes-base.stickyNote', 1, {'width': 600, 'height': 220, 'content': (
        '# Informe semanal (lunes 9:30) y limpieza diaria (3:15)\n'
        'Cada dueño con la automatización `informe_semanal` activa recibe un resumen **agregado** '
        '(sin pacientes) con el robot y un botón a Informes. 9:30 queda fuera del horario de silencio por defecto.\n'
        'La limpieza borra pendientes de más de 24 h, dedupes de más de 30 días e invitaciones viejas.\n'
        '🔑 `RESPIRO Supabase`.')}, (0, -300))
    f.nodo('Lunes 9:30', 'n8n-nodes-base.scheduleTrigger', 1.2,
           {'rule': {'interval': [{'field': 'cronExpression', 'expression': '30 9 * * 1'}]}}, (X(0), 0))
    f.nodo('Lanzar a mano', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, {'inputSource': 'passthrough'}, (X(0), -160))
    f.code('G', 'g.js', (X(1), 0), con_lib=False)
    f.pg('Destinatarios', 'select * from respiro.destinatarios_informe_semanal()', '={{ [] }}', (X(2), 0))
    f.code('Preparar informe', 'informe.js', (X(3), 0), carpeta=SRC_S)
    f.http('TG · API', TG_API, (X(4), 0))
    f.nodo('Resultado', 'n8n-nodes-base.code', 2, {'jsCode': (
        "// Solo cuenta como enviado si Telegram respondió bien.\n"
        "const envios = $('Preparar informe').all();\n"
        "const logs = $input.all().map((r, i) => ({ ...envios[i].json.log, resultado: r.json && r.json.ok ? 'ok' : 'error' }));\n"
        "return [{ json: { logs } }];")}, (X(5), 0))
    f.pg('Log', 'select respiro.log_eventos($1::jsonb) as n', '={{ [ JSON.stringify($json.logs) ] }}', (X(6), 0))
    f.nodo('Cada noche 3:15', 'n8n-nodes-base.scheduleTrigger', 1.2,
           {'rule': {'interval': [{'field': 'cronExpression', 'expression': '15 3 * * *'}]}}, (X(0), 240))
    f.pg('Limpieza', 'select respiro.limpieza() as resultado', '={{ [] }}', (X(1), 240))
    for a, b in [('Lunes 9:30', 'G'), ('Lanzar a mano', 'G'), ('G', 'Destinatarios'), ('Destinatarios', 'Preparar informe'),
                 ('Preparar informe', 'TG · API'), ('TG · API', 'Resultado'), ('Resultado', 'Log'),
                 ('Cada noche 3:15', 'Limpieza')]:
        f.unir(a, b)
    return f.json({'executionOrder': 'v1', 'timezone': 'Europe/Madrid', 'errorWorkflow': '__WF_ERRORES__',
                   'saveDataSuccessExecution': 'all', 'saveDataErrorExecution': 'all'})


def main():
    SALIDA.mkdir(exist_ok=True)
    flujos = {'bot_telegram': flujo_bot(), 'bot_transcripcion': flujo_transcripcion(), 'bot_errores': flujo_errores(),
              'miniapp': flujo_miniapp(), 'semanal': flujo_semanal()}
    for clave, wf in flujos.items():
        p = SALIDA / f'{clave}.json'
        p.write_text(json.dumps(wf, ensure_ascii=False, indent=2))
        nombres = {n['name'] for n in wf['nodes']}
        for a, c in wf['connections'].items():
            assert a in nombres, (clave, a)
            for salida in c['main']:
                for d in salida:
                    assert d['node'] in nombres, (clave, d['node'])
        print(f'{p.relative_to(RAIZ.parent)}: {len(wf["nodes"])} nodos')
    # Ningún secreto real en lo generado
    for p in SALIDA.glob('*.json'):
        t = p.read_text()
        assert not re.search(r'sk-ant-|\d{8,10}:[A-Za-z0-9_-]{30,}', t), f'posible secreto en {p}'


if __name__ == '__main__':
    main()
