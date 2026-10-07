#!/usr/bin/env python3
"""Despliega el bot de RESPIRO en el n8n de producción y configura Telegram.

Uso:
  python3 n8n/deploy.py secretos     -> genera los secretos que falten en .dev.vars
  python3 n8n/deploy.py scram        -> imprime el verificador SCRAM de la contraseña de n8n (para Postgres)
  python3 n8n/deploy.py n8n          -> credenciales + flujos + activación en n8n
  python3 n8n/deploy.py telegram     -> webhook, comandos, botón de menú y descripción del bot
  python3 n8n/deploy.py comprobar    -> estado del webhook y de los flujos

Lee todo de .dev.vars (nunca imprime secretos).
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
DEV = RAIZ / '.dev.vars'
N8N = 'https://n8n.respiroai.es'
MINIAPP_URL = 'https://www.respiroai.es/app/'
PROYECTO = 'ookbxfjqvbbqmjaoimkp'
PG_HOST = os.environ.get('PG_HOST', 'aws-1-eu-west-1.pooler.supabase.com')
ORDEN = ['bot_errores', 'bot_transcripcion', 'miniapp', 'semanal', 'bot_telegram']


def leer_vars():
    v = {}
    for linea in DEV.read_text().splitlines():
        if '=' in linea and not linea.strip().startswith('#'):
            k, _, x = linea.partition('=')
            v[k.strip()] = x.strip()
    return v


def secretos():
    v = leer_vars()
    nuevos = {
        'TG_WEBHOOK_SECRETO': lambda: secrets.token_urlsafe(32),
        'TG_RUTA': lambda: secrets.token_hex(12),
        'MINIAPP_SECRETO': lambda: secrets.token_hex(32),
        'N8N_PG_PASSWORD': lambda: secrets.token_urlsafe(30),
    }
    añadir = [f'{k}={f()}' for k, f in nuevos.items() if not v.get(k)]
    if añadir:
        with DEV.open('a') as fh:
            fh.write('\n# Generados por n8n/deploy.py\n' + '\n'.join(añadir) + '\n')
    print('Secretos generados:', [a.split('=')[0] for a in añadir] or 'ninguno (ya existían)')


def scram():
    pw = leer_vars()['N8N_PG_PASSWORD'].encode()
    sal = secrets.token_bytes(16)
    it = 4096
    salted = hashlib.pbkdf2_hmac('sha256', pw, sal, it)
    ck = hmac.new(salted, b'Client Key', 'sha256').digest()
    sk = hmac.new(salted, b'Server Key', 'sha256').digest()
    b = lambda x: base64.b64encode(x).decode()
    print(f'SCRAM-SHA-256${it}:{b(sal)}${b(hashlib.sha256(ck).digest())}:{b(sk)}')


def api(metodo, ruta, cuerpo=None):
    v = leer_vars()
    req = urllib.request.Request(N8N + '/api/v1' + ruta, method=metodo,
                                 data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                                 headers={'X-N8N-API-KEY': v['N8N_API_KEY'], 'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f'n8n {metodo} {ruta} → {e.code}: {e.read().decode()[:400]}')


def credenciales():
    v = leer_vars()
    existentes = {c['name']: c for c in api('GET', '/credentials?limit=100')['data']}
    quiero = {
        'RESPIRO Anthropic': ('httpHeaderAuth', {'name': 'x-api-key', 'value': v['ANTHROPIC_API_KEY']}),
        'RESPIRO Mistral': ('httpHeaderAuth', {'name': 'Authorization', 'value': 'Bearer ' + v['MISTRAL_API_KEY']}),
        # Supabase vía pooler (IPv4). El certificado es de la CA de Supabase, por eso no se valida la cadena
        # (la conexión sí va cifrada).
        'RESPIRO Supabase': ('postgres', {'host': PG_HOST, 'port': 5432, 'database': 'postgres',
                                           'user': f'respiro_n8n.{PROYECTO}', 'password': v['N8N_PG_PASSWORD'],
                                           'ssl': 'require', 'allowUnauthorizedCerts': True, 'sshTunnel': False,
                                           'maxConnections': 5}),
    }
    ids = {}
    for nombre, (tipo, datos) in quiero.items():
        if nombre in existentes:
            ids[nombre] = existentes[nombre]['id']
            api('PATCH', f'/credentials/{ids[nombre]}', {'name': nombre, 'type': tipo, 'data': datos})
            print('Credencial actualizada:', nombre)
        else:
            ids[nombre] = api('POST', '/credentials', {'name': nombre, 'type': tipo, 'data': datos})['id']
            print('Credencial creada:', nombre)
    gcal = existentes.get('Google Calendar account')
    if not gcal:
        raise SystemExit('Falta la credencial "Google Calendar account" en n8n')
    ids['Google Calendar account'] = gcal['id']
    return ids


def flujos(cred):
    v = leer_vars()
    existentes = {w['name']: w for w in api('GET', '/workflows?limit=200')['data']}
    valores = {
        '__TG_BASE__': 'https://api.telegram.org', '__TG_TOKEN__': v['TELEGRAM_BOT_TOKEN'],
        '__TG_SECRET__': v['TG_WEBHOOK_SECRETO'], '__TG_PATH__': v['TG_RUTA'], '__BOT_USUARIO__': 'RespiroAsistenteBot',
        '__GCAL_BASE__': 'https://www.googleapis.com/calendar/v3', '__ANTHROPIC_BASE__': 'https://api.anthropic.com',
        '__MISTRAL_BASE__': 'https://api.mistral.ai', '__MINIAPP_URL__': MINIAPP_URL, '__MINIAPP_SECRETO__': v['MINIAPP_SECRETO'],
        '__CRED_PG__': cred['RESPIRO Supabase'], '__CRED_GCAL__': cred['Google Calendar account'],
        '__CRED_ANTHROPIC__': cred['RESPIRO Anthropic'], '__CRED_MISTRAL__': cred['RESPIRO Mistral'],
    }
    ids = {}
    for clave in ORDEN:
        t = (RAIZ / 'n8n' / 'flujos' / f'{clave}.json').read_text()
        if ids:
            valores['__WF_ERRORES__'] = ids.get('bot_errores', '')
            valores['__WF_TRANSCRIPCION__'] = ids.get('bot_transcripcion', '')
        for k, x in valores.items():
            t = t.replace(k, x)
        wf = json.loads(t)
        if clave == 'bot_errores':
            wf['settings'].pop('errorWorkflow', None)
        restos = [m for m in ['__WF_', '__CRED_', '__TG_', '__MINIAPP'] if m in t]
        if restos and clave != 'bot_errores':
            raise SystemExit(f'Quedan marcadores sin rellenar en {clave}: {restos}')
        cuerpo = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'], 'settings': wf['settings']}
        if wf['name'] in existentes:
            ids[clave] = existentes[wf['name']]['id']
            api('PUT', f'/workflows/{ids[clave]}', cuerpo)
            print('Flujo actualizado:', wf['name'], ids[clave])
        else:
            ids[clave] = api('POST', '/workflows', cuerpo)['id']
            print('Flujo creado:', wf['name'], ids[clave])
    # Segunda pasada: el flujo de errores necesitaba su propio id para el resto.
    for clave in ORDEN:
        api('POST', f'/workflows/{ids[clave]}/activate')
        print('Activado:', clave)
    (RAIZ / 'n8n' / 'privado').mkdir(exist_ok=True)
    (RAIZ / 'n8n' / 'privado' / 'ids_produccion.json').write_text(json.dumps(ids, indent=2))
    return ids


def tg(metodo, cuerpo):
    v = leer_vars()
    req = urllib.request.Request(f"https://api.telegram.org/bot{v['TELEGRAM_BOT_TOKEN']}/{metodo}", method='POST',
                                 data=json.dumps(cuerpo).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            j = json.loads(r.read())
    except urllib.error.HTTPError as e:
        j = json.loads(e.read())
    print(f'{metodo}: {"ok" if j.get("ok") else j}')
    return j


def telegram():
    v = leer_vars()
    tg('setWebhook', {'url': f"{N8N}/webhook/respiro-bot-{v['TG_RUTA']}", 'secret_token': v['TG_WEBHOOK_SECRETO'],
                      'allowed_updates': ['message', 'callback_query'], 'drop_pending_updates': True, 'max_connections': 10})
    comandos = [
        ('hoy', 'Tu agenda de hoy'), ('manana', 'Tu agenda de mañana'), ('huecos', 'Huecos libres'),
        ('nueva', 'Apuntar una cita'), ('cancelar', 'Cancelar una cita'), ('informe', 'Tus automatizaciones este mes'),
        ('invitar', 'Invitar a alguien de tu equipo'), ('ayuda', 'Cómo funciona'),
    ]
    tg('setMyCommands', {'commands': [{'command': c, 'description': d} for c, d in comandos], 'language_code': 'es'})
    tg('setMyCommands', {'commands': [{'command': c, 'description': d} for c, d in comandos]})
    tg('setChatMenuButton', {'menu_button': {'type': 'web_app', 'text': 'Mi agenda', 'web_app': {'url': MINIAPP_URL}}})
    tg('setMyShortDescription', {'short_description': 'Tu asistente de agenda de RESPIRO: apunta, mueve y cancela citas hablando.'})
    tg('setMyDescription', {'description': (
        'Soy el asistente de agenda de RESPIRO 🤖\n\n'
        'Escríbeme o mándame un audio como se lo dirías a tu recepcionista: «Quique mañana a las 7», '
        '«cancela a Marta del jueves». Te enseño un resumen y solo lo apunto en tu calendario si pulsas Sí.\n\n'
        'Solo para clientes de RESPIRO: necesitas un enlace de invitación.')})


def comprobar():
    v = leer_vars()
    with urllib.request.urlopen(f"https://api.telegram.org/bot{v['TELEGRAM_BOT_TOKEN']}/getWebhookInfo", timeout=30) as r:
        w = json.loads(r.read())['result']
    print('Webhook:', w.get('url', '').replace(v.get('TG_RUTA', '~'), '<ruta>'), '| pendientes:', w.get('pending_update_count'),
          '| último error:', w.get('last_error_message', 'ninguno'))
    for wf in api('GET', '/workflows?limit=200')['data']:
        if wf['name'].startswith('RESPIRO · ') and wf['name'] != 'RESPIRO · Errores':
            print(f"  {wf['name']}: {'activo' if wf['active'] else 'INACTIVO'}")


if __name__ == '__main__':
    accion = (sys.argv[1:] or ['comprobar'])[0]
    if accion == 'secretos':
        secretos()
    elif accion == 'scram':
        scram()
    elif accion == 'n8n':
        flujos(credenciales())
    elif accion == 'telegram':
        telegram()
    else:
        comprobar()
