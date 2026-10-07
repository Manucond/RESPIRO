#!/usr/bin/env python3
"""Pruebas de extremo a extremo del bot con APIs simuladas.

Requiere el entorno de tests/n8n/entorno.py arrancado.
Uso: python3 tests/n8n/e2e.py
"""
import json
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

N8N = 'http://localhost:5678/webhook/respiro-bot-prueba'
MOCK = 'http://localhost:8080'
TZ = ZoneInfo('Europe/Madrid')
SECRETO = 'secreto-prueba'
A, B = 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'
DUENO_A, PERSONAL_A, DUENO_B, ADMIN = 101, 102, 201, 900

resultados = []
_upd = [int(time.time())]


# ------------------------------------------------------------------ utilidades
def http(url, datos=None, cab=None, metodo=None):
    req = urllib.request.Request(url, data=json.dumps(datos).encode() if datos is not None else None,
                                 headers={'content-type': 'application/json', **(cab or {})}, method=metodo)
    with urllib.request.urlopen(req, timeout=20) as r:
        b = r.read()
        return json.loads(b) if b else None


def sql(q):
    r = subprocess.run(['docker', 'exec', '-i', 'respiro-pg', 'psql', '-U', 'postgres', '-At', '-q', '-c', q],
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def llamadas(servicio=None):
    l = http(MOCK + '/_mock/llamadas')
    return [x for x in l if not servicio or x['servicio'] == servicio]


def esperar(n_antes, minimo=1, timeout=20):
    """Espera a que lleguen nuevas llamadas a Telegram y se estabilicen."""
    t0 = time.time()
    ultimo, estable = -1, 0
    while time.time() - t0 < timeout:
        n = len(llamadas('telegram'))
        if n - n_antes >= minimo and n == ultimo:
            estable += 1
            if estable >= 3:
                break
        else:
            estable = 0
        ultimo = n
        time.sleep(0.5)
    return llamadas('telegram')[n_antes:]


def enviar(update, minimo=1, secreto=SECRETO):
    n = len(llamadas('telegram'))
    http(N8N, update, {'x-telegram-bot-api-secret-token': secreto})
    return esperar(n, minimo) if minimo else (time.sleep(4) or llamadas('telegram')[n:])


def nuevo_upd():
    _upd[0] += 1
    return _upd[0]


def msg(chat, texto, upd=None):
    return {'update_id': upd or nuevo_upd(), 'message': {'message_id': 1, 'chat': {'id': chat, 'type': 'private'},
                                                          'from': {'id': chat, 'first_name': 'Prueba', 'last_name': str(chat)}, 'text': texto}}


def voz(chat, dur=8):
    return {'update_id': nuevo_upd(), 'message': {'message_id': 2, 'chat': {'id': chat, 'type': 'private'},
                                                  'from': {'id': chat, 'first_name': 'Prueba'},
                                                  'voice': {'file_id': 'AwACAgQAAx', 'duration': dur, 'file_size': 12000}}}


def boton(chat, data, msg_id=5000):
    return {'update_id': nuevo_upd(), 'callback_query': {'id': f'cb{nuevo_upd()}', 'from': {'id': chat, 'first_name': 'Prueba'},
                                                         'data': data, 'message': {'message_id': msg_id, 'chat': {'id': chat, 'type': 'private'}}}}


def ia(*acciones, raw=None, status=None):
    http(MOCK + '/_mock/anthropic', {'status': status} if status else ({'raw': raw} if raw else {'acciones': list(acciones)}))


def texto_de(ll):
    return '\n'.join((c['json'] or {}).get('text') or (c['json'] or {}).get('caption') or '' for c in ll)


def botones_de(ll):
    out = []
    for c in ll:
        for fila in ((c['json'] or {}).get('reply_markup') or {}).get('inline_keyboard', []):
            out += fila
    return out


def cb(ll, contiene):
    for b in botones_de(ll):
        if contiene in b.get('text', '') or contiene in b.get('callback_data', ''):
            return b.get('callback_data')
    return None


def comprobar(nombre, cond, detalle=''):
    resultados.append((nombre, bool(cond)))
    print(('OK   ' if cond else 'FALLO ') + nombre + ('' if cond else f'\n      {detalle}'[:900]))


def cal(cid):
    return http(f'{MOCK}/_mock/calendario/{cid}')


def ev(nombre, movil, tipo, ini, mins=30, extra=''):
    return {'id': f'e{abs(hash((nombre, ini.isoformat()))) % 10**9}', 'status': 'confirmed',
            'summary': f'{nombre} · +{movil} · {tipo}{extra}',
            'start': {'dateTime': ini.isoformat()}, 'end': {'dateTime': (ini + timedelta(minutes=mins)).isoformat()}}


def a_las(dia, h, m=0):
    return datetime(dia.year, dia.month, dia.day, h, m, tzinfo=TZ)


# ------------------------------------------------------------------ datos
hoy = datetime.now(TZ).date()
manana = hoy + timedelta(days=1)
pasado = hoy + timedelta(days=2)
jueves = hoy + timedelta(days=(3 - hoy.weekday()) % 7 or 7)       # próximo jueves (nunca hoy)
if jueves in (manana, pasado):
    jueves = jueves + timedelta(days=7)
viernes = jueves + timedelta(days=1)


def preparar():
    http(MOCK + '/_mock/reset', {})
    horario = json.dumps({str(d): [['09:00', '21:00']] for d in range(1, 8)})
    sql(f"""
truncate respiro.clientes, respiro.processed_events, respiro.codigos_invitacion cascade;
delete from respiro.usuarios_bot;
insert into respiro.clientes (id, nombre, calendario_id, horario) values
  ('{A}', 'Clínica A', 'cal-a', '{horario}'), ('{B}', 'Clínica B', 'cal-b', '{horario}');
insert into respiro.clientes_automatizaciones (cliente_id, clave)
  select id, k from respiro.clientes, unnest(array['bot_agenda','recordatorio','informe_semanal']) k;
insert into respiro.usuarios_bot (chat_id, telegram_user_id, cliente_id, rol, nombre) values
  ({PERSONAL_A}, {PERSONAL_A}, '{A}', 'personal', 'Pepa'),
  ({DUENO_B}, {DUENO_B}, '{B}', 'dueno', 'Bea'),
  ({ADMIN}, {ADMIN}, null, 'admin', 'Conde');
insert into respiro.codigos_invitacion (codigo, cliente_id, rol) values ('{'a' * 32}', '{A}', 'dueno');
""")
    hace10 = hoy - timedelta(days=10)
    http(MOCK + '/_mock/calendario/cal-a', [
        ev('Quique Pérez', '34600111222', 'LIMPIEZA', a_las(hace10, 10)),
        ev('Pepe Gil', '34600000001', 'REVISION', a_las(hace10, 11)),
        ev('Pepe Sanz', '34600000002', 'REVISION', a_las(hace10, 12)),
        ev('Marta López', '34611222333', 'REVISION', a_las(jueves, 10)),
        ev('Marta Ruiz', '34622333444', 'REVISION', a_las(jueves, 17)),
        ev('Ana Vidal', '34633444555', 'OTRO', a_las(manana, 10)),
        ev('Rosa Mar', '34644555666', 'REVISION', a_las(hace10, 9), extra=' NOVINO'),
    ])
    http(MOCK + '/_mock/calendario/cal-b', [ev('Bruno B', '34655666777', 'REVISION', a_las(manana, 11))])


def nulo(**kw):
    base = {k: None for k in ['nombre', 'fecha', 'hora', 'tipo_cita', 'movil', 'ref_fecha', 'ref_hora', 'consulta', 'franja', 'tema']}
    base.update(kw)
    return base


# ------------------------------------------------------------------ pruebas
def pruebas():
    preparar()

    # Acceso
    comprobar('Sin la cabecera secreta de Telegram no se responde', len(enviar(msg(DUENO_A, 'hola'), minimo=0, secreto='mal')) == 0)
    r = enviar(msg(DUENO_A, 'hola'))
    comprobar('Chat no registrado: "No tienes acceso"', 'No tienes acceso' in texto_de(r), texto_de(r))
    r = enviar(msg(DUENO_A, '/hoy'))
    comprobar('Chat no registrado tampoco puede usar comandos', 'No tienes acceso' in texto_de(r), texto_de(r))
    r = enviar(msg(DUENO_A, '/start ' + 'b' * 32))
    comprobar('Invitación inexistente rechazada', 'no es válido' in texto_de(r), texto_de(r))
    r = enviar(msg(DUENO_A, '/start ' + 'a' * 32))
    comprobar('Registro con invitación: bienvenida con el robot', r and r[0]['ruta'].endswith('/sendPhoto') and 'Clínica A' in texto_de(r)
              and 'robot/contento.png' in json.dumps(r[0]['json']), json.dumps(r)[:400])
    comprobar('Registro crea usuario dueño', sql(f'select rol from respiro.usuarios_bot where chat_id={DUENO_A}') == 'dueno')
    r = enviar(msg(999, '/start ' + 'a' * 32))
    comprobar('Invitación de un solo uso', 'ya se ha usado' in texto_de(r), texto_de(r))
    u = nuevo_upd()
    enviar(msg(DUENO_A, '/ayuda', upd=u))
    r = enviar(msg(DUENO_A, '/ayuda', upd=u), minimo=0)
    comprobar('Update repetido (mismo update_id) no se procesa dos veces', len(r) == 0, texto_de(r))

    # Comandos
    r = enviar(msg(DUENO_A, '/manana'))
    comprobar('/manana muestra la agenda de mañana', 'Ana Vidal' in texto_de(r) and 'Libre' in texto_de(r), texto_de(r))
    comprobar('/manana no muestra datos del otro cliente', 'Bruno' not in texto_de(r))
    r = enviar(msg(DUENO_B, '/manana'))
    comprobar('Cliente B ve solo su calendario', 'Bruno B' in texto_de(r) and 'Ana Vidal' not in texto_de(r), texto_de(r))
    cal_llamadas = [c['ruta'] for c in llamadas('calendar')]
    comprobar('Cliente B lee cal-b y nunca cal-a en su consulta', any('cal-b' in x for x in cal_llamadas))
    r = enviar(msg(DUENO_A, '/huecos'))
    comprobar('/huecos lista huecos libres', 'Huecos libres' in texto_de(r), texto_de(r))
    r = enviar(msg(DUENO_A, '/noshows'))
    comprobar('/noshows cuenta los NOVINO', 'Rosa Mar' in texto_de(r), texto_de(r))

    # Mensaje con varias acciones (crear + cancelar ambiguo + consultar)
    n_ia = len(llamadas('anthropic'))
    ia(nulo(accion='crear', nombre='Kike', fecha=manana.isoformat(), hora='19:00'),
       nulo(accion='cancelar', nombre='Marta', ref_fecha=jueves.isoformat()),
       nulo(accion='consultar', consulta='dia', fecha=viernes.isoformat(), franja='tarde'))
    # Primero, "Kike" tal cual (no está en habituales): el bot no debe inventar
    r = enviar(msg(DUENO_A, 'Quique mañana a las 7, cancela a Marta del jueves y dime qué tengo el viernes por la tarde'))
    pet = llamadas('anthropic')[n_ia]['json']
    comprobar('Petición a Claude: modelo Haiku 4.5, salida JSON con esquema y caché en instrucciones',
              pet['model'] == 'claude-haiku-4-5' and pet['output_config']['format']['type'] == 'json_schema'
              and pet['system'][0]['cache_control']['type'] == 'ephemeral', json.dumps(pet)[:300])
    comprobar('A Claude se le pasan fecha actual, horario y habituales (solo nombres)',
              'Quique Pérez' in pet['messages'][0]['content'] and 'Horario de apertura' in pet['messages'][0]['content']
              and '600111222' not in pet['messages'][0]['content'], pet['messages'][0]['content'][:500])
    t = texto_de(r)
    comprobar('Un solo mensaje de resumen', len([c for c in r if c['ruta'].endswith('/sendMessage')]) == 1, json.dumps(r)[:300])
    comprobar('"Kike" no coincide con nadie → pregunta el móvil (no inventa)', '¿Qué móvil tiene' in t and 'Kike' in t, t)
    # descartamos este resumen con "Quitar" y probamos con Quique
    r = enviar(boton(DUENO_A, cb(r, '|no')))
    ia(nulo(accion='crear', nombre='Quique', fecha=manana.isoformat(), hora='19:00'),
       nulo(accion='cancelar', nombre='Marta', ref_fecha=jueves.isoformat()),
       nulo(accion='consultar', consulta='dia', fecha=viernes.isoformat(), franja='tarde'))
    r = enviar(msg(DUENO_A, 'Quique mañana a las 7, cancela a Marta del jueves y dime qué tengo el viernes por la tarde'))
    t = texto_de(r)
    comprobar('Quique se identifica con su móvil de citas anteriores', 'Quique Pérez' in t and '+34600111222' in t, t)
    comprobar('Dos Martas el jueves → pregunta cuál', 'varias citas de «Marta»' in t and cb(r, 'Marta López'), t)
    comprobar('La consulta del viernes por la tarde va en el mismo resumen', 'tarde' in t.lower(), t)
    r = enviar(boton(DUENO_A, cb(r, 'Marta López')))
    t = texto_de(r)
    comprobar('Tras elegir, resumen con Sí / No', '¿Lo hago?' in t and cb(r, '|si'), t)
    antes = len(cal('cal-a'))
    si = cb(r, '|si')
    r = enviar(boton(DUENO_A, si), minimo=2)
    t = texto_de(r)
    eventos = cal('cal-a')
    nuevo = [e for e in eventos if e['summary'].startswith('Quique')]
    nuevo_m = [e for e in nuevo if e['start']['dateTime'].startswith(manana.isoformat() + 'T19:00')]
    comprobar('Al confirmar: evento en Calendar con formato "Nombre · móvil · TIPO"',
              nuevo_m and nuevo_m[0]['summary'] == 'Quique Pérez · +34600111222 · OTRO', json.dumps(nuevo)[:400])
    comprobar('Al confirmar: Marta López cancelada y Marta Ruiz intacta',
              not any('Marta López' in e['summary'] for e in eventos) and any('Marta Ruiz' in e['summary'] for e in eventos))
    comprobar('Mensaje final "Hecho"', '✅ <b>Hecho</b>' in t, t)
    r = enviar(boton(DUENO_A, si))
    comprobar('Pulsar Sí otra vez no duplica', 'ya no está activo' in json.dumps(r, ensure_ascii=False) and len(cal('cal-a')) == len(eventos), json.dumps(r)[:300])
    logs = sql(f"select string_agg(automatizacion||':'||tipo||':'||resultado, ',' order by id) from respiro.eventos_automatizacion where cliente_id='{A}'")
    comprobar('Log: crear y cancelar registrados como ok', 'bot_agenda:crear:ok' in logs and 'bot_agenda:cancelar:ok' in logs, logs)
    meta = sql("select string_agg(metadatos::text, ' ') from respiro.eventos_automatizacion")
    comprobar('Log sin nombres ni móviles', not any(x in meta for x in ['Quique', 'Marta', '600111222']), meta)
    consumo = sql(f"select count(*), sum(tokens_entrada), sum(coste_estimado_usd) from respiro.consumo_ia where cliente_id='{A}' and uso='acciones'")
    comprobar('Consumo de IA registrado con coste', consumo.split('|')[0] != '0' and float(consumo.split('|')[2]) > 0, consumo)

    # Hueco ocupado → alternativas
    ia(nulo(accion='crear', nombre='Luis Mora', fecha=manana.isoformat(), hora='10:00', movil='600 222 333', tipo_cita='REVISION'))
    r = enviar(msg(DUENO_A, 'Luis Mora mañana a las 10, revisión, 600 222 333'))
    t = texto_de(r)
    comprobar('Hueco ocupado se detecta y se proponen alternativas', 'está ocupado' in t and len(botones_de(r)) >= 3, t)
    elegido = botones_de(r)[0]
    r = enviar(boton(DUENO_A, elegido['callback_data']))
    r = enviar(boton(DUENO_A, cb(r, '|si')), minimo=2)
    luis = [e for e in cal('cal-a') if e['summary'].startswith('Luis Mora')]
    comprobar('Se reserva en la alternativa elegida', luis and luis[0]['summary'] == 'Luis Mora · +34600222333 · REVISION'
              and not luis[0]['start']['dateTime'].startswith(manana.isoformat() + 'T10:00'), json.dumps(luis))

    # Falta el móvil → se pide y se responde por texto
    ia(nulo(accion='crear', nombre='Nora Paz', fecha=pasado.isoformat(), hora='12:00'))
    r = enviar(msg(DUENO_A, 'Nora Paz pasado mañana a las 12'))
    comprobar('Móvil ausente → lo pide', '¿Qué móvil tiene' in texto_de(r) and cb(r, 'Sin móvil'), texto_de(r))
    r = enviar(msg(DUENO_A, '600 999 888'))
    comprobar('Responder con el móvil continúa el mismo resumen', '+34600999888' in texto_de(r) and cb(r, '|si'), texto_de(r))
    enviar(boton(DUENO_A, cb(r, '|si')), minimo=2)
    comprobar('Cita con el móvil dado', any(e['summary'] == 'Nora Paz · +34600999888 · OTRO' for e in cal('cal-a')))

    # Sin móvil
    ia(nulo(accion='crear', nombre='Olga Ruiz', fecha=pasado.isoformat(), hora='13:00'))
    r = enviar(msg(DUENO_A, 'Olga Ruiz pasado mañana a las 13'))
    r = enviar(boton(DUENO_A, cb(r, 'Sin móvil')))
    enviar(boton(DUENO_A, cb(r, '|si')), minimo=2)
    comprobar('"Sin móvil" se marca en el título', any(e['summary'] == 'Olga Ruiz · sin móvil · OTRO' for e in cal('cal-a')))

    # Nombre repetido al crear
    ia(nulo(accion='crear', nombre='Pepe', fecha=pasado.isoformat(), hora='16:00'))
    r = enviar(msg(DUENO_A, 'Pepe pasado mañana a las 4'))
    comprobar('Dos "Pepe" → pregunta cuál', 'varias personas llamadas «Pepe»' in texto_de(r) and cb(r, 'Pepe Sanz'), texto_de(r))
    r = enviar(boton(DUENO_A, cb(r, 'Pepe Sanz')))
    enviar(boton(DUENO_A, cb(r, '|si')), minimo=2)
    comprobar('Se apunta al Pepe elegido', any(e['summary'] == 'Pepe Sanz · +34600000002 · OTRO' for e in cal('cal-a')))

    # Lenguaje natural: falta el nombre → lo pregunta y sigue
    ia(nulo(accion='crear', fecha=pasado.isoformat(), hora='17:00'))
    r = enviar(msg(DUENO_A, 'apúntame una cita pasado a las 5'))
    comprobar('Cita sin nombre → pregunta solo el nombre', '¿Para quién es la cita?' in texto_de(r), texto_de(r))
    r = enviar(msg(DUENO_A, 'Lucía Fraga'))
    comprobar('Responder el nombre continúa el mismo resumen', 'Lucía Fraga' in texto_de(r) and '¿Qué móvil tiene' in texto_de(r), texto_de(r))
    r = enviar(msg(DUENO_A, '611 222 444'))
    enviar(boton(DUENO_A, cb(r, '|si')), minimo=2)
    comprobar('Cita creada tras preguntar nombre y móvil', any(e['summary'] == 'Lucía Fraga · +34611222444 · OTRO' for e in cal('cal-a')))

    # Cancelar sin nombre, por día y hora
    ia(nulo(accion='cancelar', ref_fecha=pasado.isoformat(), ref_hora='17:00'))
    r = enviar(msg(DUENO_A, 'la de pasado a las 5 no viene'))
    comprobar('Cancelar por día y hora sin decir el nombre', 'Cancelar a <b>Lucía Fraga</b>' in texto_de(r), texto_de(r))
    enviar(boton(DUENO_A, cb(r, '|si')), minimo=2)
    comprobar('…y se cancela en Calendar', not any(e['summary'].startswith('Lucía Fraga') for e in cal('cal-a')))

    # Saludo y consulta por persona
    ia(nulo(accion='saludo'))
    r = enviar(msg(DUENO_A, 'gracias!!'))
    comprobar('Un "gracias" se contesta con amabilidad, sin pedir formato', '¡' in texto_de(r) and 'pillado' not in texto_de(r), texto_de(r))
    ia(nulo(accion='consultar', consulta='persona', nombre='Marta'))
    r = enviar(msg(DUENO_A, 'cuándo le toca a Marta?'))
    comprobar('"¿Cuándo le toca a Marta?" lista sus citas', 'Citas de Marta' in texto_de(r) and 'Marta Ruiz' in texto_de(r), texto_de(r))
    ia(raw='{"acciones": []}')
    r = enviar(msg(DUENO_A, 'mmm'))
    comprobar('Respuesta vacía de la IA → pregunta amable sin repetir la llamada', 'no lo he pillado' in texto_de(r), texto_de(r))

    # Mover
    ia(nulo(accion='mover', nombre='Ana', ref_fecha=manana.isoformat(), fecha=pasado.isoformat(), hora='11:00'))
    r = enviar(msg(DUENO_A, 'Mueve a Ana de mañana a pasado a las 11'))
    comprobar('Mover: resumen con hora antigua y nueva', '🔁 Mover a <b>Ana Vidal</b>' in texto_de(r), texto_de(r))
    enviar(boton(DUENO_A, cb(r, '|si')), minimo=2)
    ana = [e for e in cal('cal-a') if e['summary'].startswith('Ana Vidal')]
    comprobar('Mover: el evento cambia de hora en Calendar', ana and ana[0]['start']['dateTime'].startswith(pasado.isoformat() + 'T11:00'), json.dumps(ana))

    # Tipo concreto (dato de salud) → genérico
    ia(nulo(accion='crear', nombre='Quique', fecha=pasado.isoformat(), hora='18:00', tipo_cita='EMPASTE'))
    r = enviar(msg(DUENO_A, 'Quique pasado mañana a las 6 para un empaste'))
    pend = sql(f'select acciones::text from respiro.bot_pendientes where chat_id={DUENO_A} order by creado_en desc limit 1')
    comprobar('Tratamiento concreto → tipo genérico (no se guarda "empaste")', 'EMPASTE' not in pend.upper() and '"OTRO"' in pend, pend)
    enviar(boton(DUENO_A, cb(r, '|no')))

    # "No" → nada cambia
    ia(nulo(accion='cancelar', nombre='Marta Ruiz'))
    r = enviar(msg(DUENO_A, 'Cancela a Marta Ruiz'))
    n = len(cal('cal-a'))
    r = enviar(boton(DUENO_A, cb(r, '|no')))
    comprobar('"No" no toca el calendario', len(cal('cal-a')) == n and 'no he cambiado nada' in texto_de(r), texto_de(r))

    # IA: JSON inválido una vez → reintento; dos veces → no_entendido
    n_ia = len(llamadas('anthropic'))
    ia(raw='esto no es json')
    ia(nulo(accion='consultar', consulta='dia', fecha=manana.isoformat()))
    r = enviar(msg(DUENO_A, 'qué tengo mañana'))
    comprobar('JSON inválido → un reintento y sigue', len(llamadas('anthropic')) - n_ia == 2 and 'Mañana' in texto_de(r), texto_de(r))
    ia(raw='{"acciones": "mal"}')
    ia(raw='tampoco')
    r = enviar(msg(DUENO_A, 'blablabla'))
    comprobar('Dos JSON inválidos → pregunta qué quiere hacer', 'no lo he pillado' in texto_de(r), texto_de(r))
    ia(nulo(accion='consultar', consulta='dia'), *[nulo(accion='consultar', consulta='huecos')] * 5)
    r = enviar(msg(DUENO_A, 'seis cosas'))
    comprobar('Más de 5 acciones → avisa del límite', 'Solo puedo hacer 5' in texto_de(r), texto_de(r))

    # IA caída → aviso al usuario y al admin
    ia(status=500)
    r = enviar(msg(DUENO_A, 'algo'), minimo=2)
    comprobar('API de IA caída → mensaje claro y aviso a admin', 'no consigo entender' in texto_de(r)
              and any(c['json']['chat_id'] == ADMIN for c in r), json.dumps(r, ensure_ascii=False)[:500])

    # Voz
    http(MOCK + '/_mock/mistral', {'text': '¿Qué tengo mañana?'})
    ia(nulo(accion='consultar', consulta='dia', fecha=manana.isoformat()))
    r = enviar(voz(DUENO_A))
    mis = llamadas('mistral')
    comprobar('Voz: se descarga y se transcribe en Mistral (multipart)', mis and mis[-1]['multipart'], json.dumps(mis)[:300])
    comprobar('Voz: el texto sigue el mismo camino y se muestra lo entendido', '🎧' in texto_de(r) and 'Mañana' in texto_de(r), texto_de(r))
    comprobar('Voz: gasto de transcripción registrado',
              sql("select count(*) from respiro.consumo_ia where uso='transcripcion'") == '1')
    r = enviar(voz(DUENO_A, dur=300))
    comprobar('Voz de más de 2 minutos se rechaza', 'menos de 2 minutos' in texto_de(r), texto_de(r))
    http(MOCK + '/_mock/mistral', {'status': 500})
    r = enviar(voz(DUENO_A), minimo=2)
    comprobar('Transcripción caída → pide escribirlo', 'No he podido escuchar' in texto_de(r), texto_de(r))
    ex = subprocess.run("docker exec respiro-n8n sh -c 'ls -R /home/node/.n8n 2>/dev/null | grep -ci oga'", shell=True, capture_output=True, text=True).stdout.strip()
    comprobar('Voz: no queda ningún audio guardado en n8n', ex in ('0', ''), ex)

    # Errores de Calendar al escribir
    http(MOCK + '/_mock/fallar_calendario', {'metodo': 'POST', 'veces': 1})
    ia(nulo(accion='crear', nombre='Quique', fecha=pasado.isoformat(), hora='19:30'))
    r = enviar(msg(DUENO_A, 'Quique pasado a las 19:30'))
    r = enviar(boton(DUENO_A, cb(r, '|si')), minimo=3)
    comprobar('Fallo de Calendar → "Hecho a medias", log error y aviso al admin',
              'Hecho a medias' in texto_de(r) and any(c['json'].get('chat_id') == ADMIN for c in r)
              and 'bot_agenda:crear:error' in sql("select string_agg(automatizacion||':'||tipo||':'||resultado, ',') from respiro.eventos_automatizacion"),
              texto_de(r))

    # Invitaciones y admin
    r = enviar(msg(DUENO_A, '/invitar'))
    comprobar('Dueño genera invitación para su equipo', 't.me/RespiroPruebaBot?start=' in texto_de(r), texto_de(r))
    r = enviar(msg(PERSONAL_A, '/invitar'))
    comprobar('Personal no puede invitar', 'Solo el dueño' in texto_de(r), texto_de(r))
    r = enviar(msg(ADMIN, '/hoy'))
    comprobar('Admin sin cliente elegido no ve agendas', 'modo RESPIRO' in texto_de(r), texto_de(r))
    r = enviar(msg(ADMIN, '/clientes'))
    comprobar('Admin lista clientes', 'Clínica A' in texto_de(r) and 'Clínica B' in texto_de(r), texto_de(r))
    r = enviar(msg(ADMIN, '/cliente'))
    comprobar('Admin: "/cliente" sin nombre explica el uso (HTML válido)', 'Uso: /cliente' in texto_de(r) and '&lt;nombre&gt;' in texto_de(r), texto_de(r))
    r = enviar(msg(ADMIN, '/cliente Clínica B'))
    r = enviar(msg(ADMIN, '/manana'))
    comprobar('Admin cambia de cliente para depurar', 'Bruno B' in texto_de(r), texto_de(r))
    r = enviar(msg(ADMIN, '/invitar Clínica A personal'))
    comprobar('Admin: /invitar <cliente> <rol>', 'Clínica A' in texto_de(r) and 'start=' in texto_de(r), texto_de(r))
    r = enviar(msg(DUENO_A, '/cliente Clínica B'))
    comprobar('Un dueño no puede cambiar de cliente', 'solo para RESPIRO' in texto_de(r), texto_de(r))

    # Modo RESPIRO: el admin pregunta datos en lenguaje natural
    r = enviar(msg(ADMIN, '/respiro'))
    comprobar('/respiro vuelve al modo RESPIRO', 'Modo RESPIRO' in texto_de(r), texto_de(r))
    n_ia = len(llamadas('anthropic'))
    ia(raw=json.dumps({'sql': "select cliente, round(sum(coste_usd), 4) as usd from consumo_ia group by 1 order by 1", 'respuesta': None}))
    ia(raw='Este mes llevamos:\n• Clínica A: 0,0200 $\n• Total: 0,0200 $')
    r = enviar(msg(ADMIN, 'cuánto llevamos gastado este mes?'))
    t = texto_de(r)
    pets = [c['json'] for c in llamadas('anthropic')[n_ia:]]
    comprobar('Modo RESPIRO: responde con los datos y la consulta plegada', 'Clínica A' in t and '<blockquote expandable>' in t, t)
    comprobar('Modo RESPIRO: usa Claude Sonnet 5.5 y le pasa los resultados reales',
              len(pets) == 2 and pets[0]['model'] == 'claude-sonnet-5-5' and 'Clínica A' in pets[1]['messages'][0]['content'],
              json.dumps(pets, ensure_ascii=False)[:500])
    comprobar('Modo RESPIRO: su gasto queda apuntado como "admin"',
              sql("select count(*) from respiro.consumo_ia where uso = 'admin' and cliente_id is null") != '0')
    n_ia = len(llamadas('anthropic'))
    ia(raw=json.dumps({'sql': 'select * from tabla_que_no_existe', 'respuesta': None}))
    ia(raw=json.dumps({'sql': 'select count(*) as clientes from clientes', 'respuesta': None}))
    ia(raw='Tenéis 2 clientes.')
    r = enviar(msg(ADMIN, 'y cuántos clientes tenemos'))
    pets = [c['json'] for c in llamadas('anthropic')[n_ia:]]
    comprobar('Modo RESPIRO: si la consulta falla, se corrige sola con el error',
              '2 clientes' in texto_de(r) and len(pets) == 3 and 'tabla_que_no_existe' in pets[1]['messages'][0]['content'],
              texto_de(r))
    comprobar('Modo RESPIRO: recuerda la pregunta anterior', 'cuánto llevamos gastado' in pets[0]['messages'][0]['content'],
              pets[0]['messages'][0]['content'][:300])
    n_ia = len(llamadas('anthropic'))
    ia(raw=json.dumps({'sql': None, 'respuesta': 'Puedo consultar clientes, uso, gastos, errores e invitaciones.'}))
    r = enviar(msg(ADMIN, 'hola'))
    comprobar('Modo RESPIRO: sin datos que buscar contesta directamente (una sola llamada)',
              'Puedo consultar' in texto_de(r) and len(llamadas('anthropic')) - n_ia == 1, texto_de(r))
    ia(raw=json.dumps({'sql': "select round(sum(coste_usd), 4) as total from consumo_ia", 'respuesta': None}))
    ia(raw='Total del mes: 0,0300 $')
    r = enviar(msg(ADMIN, '/gasto'))
    comprobar('/gasto pregunta el gasto del mes', 'Total del mes' in texto_de(r), texto_de(r))
    r = enviar(msg(DUENO_A, '/gasto'))
    comprobar('/gasto es solo para admins', 'solo para RESPIRO' in texto_de(r), texto_de(r))
    r = enviar(msg(ADMIN, '/cliente Clínica B'))

    # Informe
    r = enviar(msg(DUENO_A, '/informe'))
    t = texto_de(r)
    comprobar('/informe cuenta las citas del asistente y marca la estimación', 'Citas con el asistente: <b>' in t and 'estimación' in t, t)

    # Límite de gasto de IA
    sql(f"update respiro.clientes set limite_ia_mensual_usd = 0 where id = '{A}'")
    r = enviar(msg(DUENO_A, 'Quique mañana'))
    comprobar('Límite mensual de IA respetado', 'cupo' in texto_de(r), texto_de(r))
    sql(f"update respiro.clientes set limite_ia_mensual_usd = 5 where id = '{A}'")

    # Calendario sin conectar
    sql(f"update respiro.clientes set calendario_id = null where id = '{B}'")
    r = enviar(msg(DUENO_B, '/hoy'))
    comprobar('Calendario sin conectar → aviso claro', 'no está conectado' in texto_de(r), texto_de(r))

    # Mensajes no soportados
    r = enviar({'update_id': nuevo_upd(), 'message': {'message_id': 9, 'chat': {'id': DUENO_A, 'type': 'private'},
                                                      'from': {'id': DUENO_A, 'first_name': 'X'}, 'sticker': {'file_id': 'x'}}})
    comprobar('Sticker u otros → mensaje de ayuda', 'texto y notas de voz' in texto_de(r), texto_de(r))
    r = enviar({'update_id': nuevo_upd(), 'message': {'message_id': 9, 'chat': {'id': -100, 'type': 'group'},
                                                      'from': {'id': DUENO_A, 'first_name': 'X'}, 'text': '/hoy'}}, minimo=0)
    comprobar('Grupos ignorados (solo chat privado)', len(r) == 0)

    # Informe semanal (se lanza a mano el flujo programado)
    sql(f"update respiro.usuarios_bot set rol='dueno' where chat_id={DUENO_A}")
    n = len(llamadas('telegram'))
    subprocess.run('docker exec -e N8N_LOG_LEVEL=warn -e N8N_RUNNERS_BROKER_PORT=5690 -e N8N_PORT=5691 respiro-n8n n8n execute --id=rspSemanal000001', shell=True, capture_output=True, text=True, timeout=180)
    r = esperar(n, 2)
    fotos = {int(c['json']['chat_id']): c['json'] for c in r if c['ruta'].endswith('/sendPhoto')}
    comprobar('Informe semanal: llega a cada dueño con el robot y botón a Informes',
              DUENO_A in fotos and DUENO_B in fotos and '?s=informes' in json.dumps(fotos[DUENO_A]) and 'robot/' in fotos[DUENO_A]['photo'],
              json.dumps(r, ensure_ascii=False)[:600])
    comprobar('Informe semanal: cada dueño ve solo sus cifras y el ahorro marcado como estimación',
              'citas con el asistente' in fotos.get(DUENO_A, {}).get('caption', '') and 'citas con el asistente' not in fotos.get(DUENO_B, {}).get('caption', '')
              and 'estimación' in fotos.get(DUENO_A, {}).get('caption', ''), json.dumps(fotos, ensure_ascii=False)[:600])
    comprobar('Informe semanal registrado en el log',
              sql("select count(*) from respiro.eventos_automatizacion where automatizacion='informe_semanal' and resultado='ok'") == '2')
    comprobar('Personal no recibe el informe semanal', PERSONAL_A not in fotos)

    # Ningún mensaje del bot rechazado por Telegram (HTML válido en todos)
    rechazados = [c for c in llamadas('telegram') if c['ruta'].endswith(('/sendMessage', '/editMessageText', '/sendPhoto'))
                  and any(t.lower() not in {'b', 'i', 'u', 's', 'a', 'code', 'pre', 'em', 'strong', 'blockquote'}
                          for t in __import__('re').findall(r'</?([A-Za-z][\w-]*)', (c['json'] or {}).get('text') or (c['json'] or {}).get('caption') or ''))]
    comprobar('Todos los mensajes llevan HTML que Telegram acepta', not rechazados, json.dumps(rechazados[:2], ensure_ascii=False)[:400])

    # Errores de ejecución de n8n
    errores = subprocess.run("docker logs respiro-n8n 2>&1 | grep -ciE 'problem in node|ERROR'", shell=True, capture_output=True, text=True).stdout.strip()
    comprobar('n8n sin errores de ejecución en el log', errores == '0', subprocess.run("docker logs respiro-n8n 2>&1 | grep -iE 'problem in node|ERROR' | tail -5", shell=True, capture_output=True, text=True).stdout)


if __name__ == '__main__':
    try:
        pruebas()
    except Exception as e:
        import traceback
        traceback.print_exc()
        resultados.append(('excepción en las pruebas', False))
    ok = sum(1 for _, x in resultados if x)
    print(f'\n{ok}/{len(resultados)} comprobaciones correctas')
    sys.exit(0 if ok == len(resultados) else 1)
