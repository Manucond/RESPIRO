#!/usr/bin/env python3
"""Monta el entorno local de pruebas: Postgres 17 + simulador + n8n 2.39.10.
Uso: python3 tests/n8n/entorno.py [arrancar|parar]"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
RED = 'respiro-test'
N8N_IMG = 'docker.n8n.io/n8nio/n8n:2.39.10'
PG_PASS = 'pass-n8n-prueba'
IDS = {'bot_telegram': 'rspBotTelegram01', 'bot_transcripcion': 'rspBotTranscr001', 'bot_errores': 'rspBotErrores001',
       'miniapp': 'rspMiniAppApi001', 'semanal': 'rspSemanal000001'}
VALORES = {
    '__TG_BASE__': 'http://mock:8080', '__TG_TOKEN__': '123456:TOKENPRUEBA', '__TG_SECRET__': 'secreto-prueba',
    '__TG_PATH__': 'prueba', '__BOT_USUARIO__': 'RespiroPruebaBot',
    '__GCAL_BASE__': 'http://mock:8080/calendar/v3', '__ANTHROPIC_BASE__': 'http://mock:8080',
    '__MISTRAL_BASE__': 'http://mock:8080', '__MINIAPP_URL__': 'https://www.respiroai.es/app/',
    '__MINIAPP_SECRETO__': 'secreto-miniapp-prueba',
    '__CRED_PG__': 'credPgPrueba0001', '__CRED_GCAL__': 'credGcalPrueba01', '__CRED_ANTHROPIC__': 'credAnthPrueba01',
    '__CRED_MISTRAL__': 'credMistPrueba01',
    '__WF_TRANSCRIPCION__': IDS['bot_transcripcion'], '__WF_ERRORES__': IDS['bot_errores'],
}


def sh(cmd, check=True, **kw):
    r = subprocess.run(cmd, shell=True, text=True, capture_output=True, **kw)
    if check and r.returncode != 0:
        raise SystemExit(f'Falló: {cmd}\n{r.stdout}\n{r.stderr}')
    return r.stdout


def parar():
    sh('docker rm -f respiro-pg respiro-mock respiro-n8n', check=False)
    sh(f'docker network rm {RED}', check=False)


def preparar_flujo(clave):
    t = (RAIZ / 'n8n' / 'flujos' / f'{clave}.json').read_text()
    for k, v in VALORES.items():
        t = t.replace(k, v)
    wf = json.loads(t)
    wf['id'] = IDS[clave]
    for n in wf['nodes']:
        # En pruebas, Google Calendar usa una cabecera fija en vez de OAuth2.
        if n['parameters'].get('nodeCredentialType') == 'googleCalendarOAuth2Api':
            n['parameters']['authentication'] = 'genericCredentialType'
            n['parameters']['genericAuthType'] = 'httpHeaderAuth'
            n['parameters'].pop('nodeCredentialType')
            n['credentials'] = {'httpHeaderAuth': {'id': VALORES['__CRED_GCAL__'], 'name': 'Google Calendar (prueba)'}}
    wf.setdefault('active', False)
    return wf


def arrancar():
    parar()
    sh(f'docker network create {RED}')
    sh(f'docker run -d --name respiro-pg --network {RED} -e POSTGRES_PASSWORD=x postgres:17')
    sh(f'docker run -d --name respiro-mock --network {RED} --network-alias mock -p 8080:8080 '
       f'-v {RAIZ}/tests/n8n/mock.py:/mock.py:ro python:3.12-slim python -u /mock.py 8080')
    while sh('docker exec respiro-pg pg_isready -U postgres -h localhost', check=False).find('accepting') < 0:
        time.sleep(1)
    time.sleep(2)
    sql = (RAIZ / 'tests/sql/00_stub_supabase.sql').read_text()
    for m in sorted((RAIZ / 'supabase/migrations').glob('*.sql')):
        sql += '\n' + m.read_text()
    sql += f"\nalter role respiro_n8n login password '{PG_PASS}';\n"
    subprocess.run('docker exec -i respiro-pg psql -U postgres -v ON_ERROR_STOP=1 -q', shell=True, input=sql, text=True, check=True,
                   capture_output=True)

    creds = [
        {'id': VALORES['__CRED_PG__'], 'name': 'RESPIRO Supabase', 'type': 'postgres',
         'data': {'host': 'respiro-pg', 'port': 5432, 'database': 'postgres', 'user': 'respiro_n8n', 'password': PG_PASS,
                  'ssl': 'disable', 'allowUnauthorizedCerts': False, 'sshTunnel': False}},
        {'id': VALORES['__CRED_GCAL__'], 'name': 'Google Calendar (prueba)', 'type': 'httpHeaderAuth',
         'data': {'name': 'Authorization', 'value': 'Bearer token-google-prueba'}},
        {'id': VALORES['__CRED_ANTHROPIC__'], 'name': 'RESPIRO Anthropic', 'type': 'httpHeaderAuth',
         'data': {'name': 'x-api-key', 'value': 'clave-anthropic-prueba'}},
        {'id': VALORES['__CRED_MISTRAL__'], 'name': 'RESPIRO Mistral', 'type': 'httpHeaderAuth',
         'data': {'name': 'Authorization', 'value': 'Bearer clave-mistral-prueba'}},
    ]
    tmp = RAIZ / 'tests/n8n/.tmp'
    tmp.mkdir(exist_ok=True)
    (tmp / 'creds.json').write_text(json.dumps(creds))
    for c in IDS:
        wf = preparar_flujo(c)
        (tmp / f'{c}.json').write_text(json.dumps(wf, ensure_ascii=False))

    env = ('-e N8N_ENCRYPTION_KEY=clave-cifrado-prueba -e GENERIC_TIMEZONE=Europe/Madrid -e TZ=Europe/Madrid '
           '-e N8N_DIAGNOSTICS_ENABLED=false -e N8N_PERSONALIZATION_ENABLED=false -e N8N_SECURE_COOKIE=false '
           '-e WEBHOOK_URL=http://localhost:5678/ -e N8N_LOG_LEVEL=warn')
    sh(f'docker run -d --name respiro-n8n --network {RED} -p 5678:5678 {env} -v {tmp}:/datos:ro {N8N_IMG}')
    for _ in range(90):
        try:
            urllib.request.urlopen('http://localhost:5678/healthz', timeout=2)
            break
        except Exception:
            time.sleep(1)
    # n8n responde a /healthz antes de terminar de preparar su base: se reintenta hasta confirmar.
    def importar(cmd, esperado):
        for _ in range(20):
            out = sh(f'docker exec -e N8N_LOG_LEVEL=info respiro-n8n n8n {cmd}', check=False)
            if esperado in out:
                return
            time.sleep(3)
        raise SystemExit(f'No se pudo importar: {cmd}\n{out[-500:]}')
    importar('import:credentials --input=/datos/creds.json', 'Successfully imported 4 credentials')
    for c in IDS:
        importar(f'import:workflow --input=/datos/{c}.json', 'Successfully imported 1 workflow')
    for c in IDS:
        out = sh(f'docker exec -e N8N_LOG_LEVEL=info respiro-n8n n8n publish:workflow --id={IDS[c]}', check=False)
        print('publicar', c, out[-300:])
    sh('docker restart respiro-n8n')
    for _ in range(90):
        try:
            urllib.request.urlopen('http://localhost:5678/healthz', timeout=2)
            break
        except Exception:
            time.sleep(1)
    # Esperar a que los webhooks estén registrados (n8n responde a /healthz antes).
    for _ in range(60):
        try:
            urllib.request.urlopen(urllib.request.Request('http://localhost:5678/webhook/respiro-bot-prueba', data=b'{}',
                                                          headers={'content-type': 'application/json'}), timeout=5)
            break
        except urllib.error.HTTPError as e:
            if e.code != 404:
                break
            time.sleep(1)
        except Exception:
            time.sleep(1)
    print('Entorno listo')


if __name__ == '__main__':
    (parar if (sys.argv[1:] or ['arrancar'])[0] == 'parar' else arrancar)()
