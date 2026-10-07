"""Simulador de Telegram, Google Calendar, Anthropic y Mistral para las pruebas.

Control (solo pruebas):
  GET  /_mock/llamadas            -> lista de llamadas recibidas
  POST /_mock/reset               -> borra llamadas, calendarios y colas
  POST /_mock/anthropic           -> encola una respuesta {"acciones":[...]} o {"raw": "..."} o {"status": 401}
  POST /_mock/mistral             -> encola {"text": "..."} o {"status": 500}
  POST /_mock/calendario/<id>     -> sustituye los eventos de un calendario
  GET  /_mock/calendario/<id>     -> eventos actuales
  POST /_mock/fallar_calendario   -> {"metodo":"POST","veces":1} hace fallar escrituras
"""
import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
from datetime import datetime

LOCK = threading.Lock()
ESTADO = {'llamadas': [], 'cal': {}, 'anthropic': [], 'mistral': [], 'fallos': [], 'msg_id': 1000}


def iso(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _cuerpo(self):
        n = int(self.headers.get('content-length') or 0)
        return self.rfile.read(n) if n else b''

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _registrar(self, servicio, cuerpo):
        try:
            j = json.loads(cuerpo) if cuerpo and cuerpo[:1] in b'{[' else None
        except Exception:
            j = None
        ESTADO['llamadas'].append({'servicio': servicio, 'metodo': self.command, 'ruta': self.path,
                                   'json': j, 'cabeceras': {k.lower(): v for k, v in self.headers.items()},
                                   'tam': len(cuerpo), 'multipart': b'filename=' in cuerpo})

    def do_GET(self):
        self._manejar(b'')

    def do_DELETE(self):
        self._manejar(self._cuerpo())

    def do_PATCH(self):
        self._manejar(self._cuerpo())

    def do_POST(self):
        self._manejar(self._cuerpo())

    def _manejar(self, cuerpo):
        u = urlparse(self.path)
        ruta = u.path
        qs = {k: v[0] for k, v in parse_qs(u.query).items()}
        with LOCK:
            # ---- control ----
            if ruta == '/_mock/llamadas':
                return self._json(200, ESTADO['llamadas'])
            if ruta == '/_mock/reset':
                ESTADO.update({'llamadas': [], 'cal': {}, 'anthropic': [], 'mistral': [], 'fallos': []})
                return self._json(200, {'ok': True})
            if ruta == '/_mock/anthropic':
                ESTADO['anthropic'].append(json.loads(cuerpo))
                return self._json(200, {'ok': True})
            if ruta == '/_mock/mistral':
                ESTADO['mistral'].append(json.loads(cuerpo))
                return self._json(200, {'ok': True})
            if ruta == '/_mock/fallar_calendario':
                ESTADO['fallos'].append(json.loads(cuerpo))
                return self._json(200, {'ok': True})
            m = re.match(r'^/_mock/calendario/(.+)$', ruta)
            if m:
                cid = unquote(m.group(1))
                if self.command == 'POST':
                    ESTADO['cal'][cid] = json.loads(cuerpo)
                return self._json(200, ESTADO['cal'].get(cid, []))

            # ---- Telegram ----
            m = re.match(r'^/bot([^/]+)/(\w+)$', ruta)
            if m:
                self._registrar('telegram', cuerpo)
                metodo = m.group(2)
                if metodo == 'getFile':
                    return self._json(200, {'ok': True, 'result': {'file_id': qs.get('file_id'), 'file_path': 'voice/nota.oga'}})
                # Como Telegram: con parse_mode HTML solo valen ciertas etiquetas.
                j = json.loads(cuerpo) if cuerpo else {}
                texto = (j.get('text') or j.get('caption') or '') if j.get('parse_mode') == 'HTML' else ''
                malas = [t for t in re.findall(r'</?([A-Za-z][\w-]*)', texto)
                         if t.lower() not in {'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'span', 'tg-spoiler', 'a', 'tg-emoji', 'code', 'pre', 'blockquote'}]
                if malas:
                    return self._json(400, {'ok': False, 'error_code': 400, 'description': f"Bad Request: can't parse entities: Unsupported start tag \"{malas[0]}\""})
                ESTADO['msg_id'] += 1
                return self._json(200, {'ok': True, 'result': {'message_id': ESTADO['msg_id']}})
            if re.match(r'^/file/bot[^/]+/voice/', ruta):
                self._registrar('telegram_fichero', cuerpo)
                b = b'OggS' + b'\x00' * 2000
                self.send_response(200)
                self.send_header('content-type', 'audio/ogg')
                self.send_header('content-length', str(len(b)))
                self.end_headers()
                self.wfile.write(b)
                return

            # ---- Anthropic ----
            if ruta == '/v1/messages':
                self._registrar('anthropic', cuerpo)
                if self.headers.get('x-api-key') != 'clave-anthropic-prueba':
                    return self._json(401, {'type': 'error', 'error': {'type': 'authentication_error', 'message': 'invalid x-api-key'}})
                r = ESTADO['anthropic'].pop(0) if ESTADO['anthropic'] else {'acciones': [{'accion': 'no_entendido'}]}
                if 'status' in r:
                    return self._json(r['status'], {'type': 'error', 'error': {'type': 'api_error', 'message': 'fallo simulado'}})
                texto = r['raw'] if 'raw' in r else json.dumps({'acciones': [{**{k: None for k in ['nombre', 'fecha', 'hora', 'tipo_cita', 'movil', 'ref_fecha', 'ref_hora', 'consulta', 'franja', 'tema']}, **a} for a in r['acciones']]})
                return self._json(200, {'id': 'msg_x', 'type': 'message', 'role': 'assistant', 'model': 'claude-haiku-4-5',
                                        'content': [{'type': 'text', 'text': texto}], 'stop_reason': 'end_turn',
                                        'usage': {'input_tokens': 1480, 'output_tokens': 140, 'cache_read_input_tokens': 0, 'cache_creation_input_tokens': 0}})

            # ---- Mistral ----
            if ruta == '/v1/audio/transcriptions':
                self._registrar('mistral', cuerpo)
                if self.headers.get('authorization') != 'Bearer clave-mistral-prueba':
                    return self._json(401, {'message': 'Unauthorized'})
                r = ESTADO['mistral'].pop(0) if ESTADO['mistral'] else {'text': ''}
                if 'status' in r:
                    return self._json(r['status'], {'message': 'fallo simulado'})
                return self._json(200, {'model': 'voxtral-mini-latest', 'text': r['text'], 'language': 'es'})

            # ---- Google Calendar ----
            m = re.match(r'^/calendar/v3/calendars/([^/]+)/events(?:/([^/]+))?$', ruta)
            if m:
                self._registrar('calendar', cuerpo)
                if self.headers.get('authorization') != 'Bearer token-google-prueba':
                    return self._json(401, {'error': {'code': 401, 'message': 'Invalid Credentials'}})
                cid = unquote(m.group(1))
                eid = unquote(m.group(2)) if m.group(2) else None
                evs = ESTADO['cal'].setdefault(cid, [])
                for f in ESTADO['fallos']:
                    if f['metodo'] == self.command and f.get('veces', 1) > 0:
                        f['veces'] = f.get('veces', 1) - 1
                        return self._json(500, {'error': {'code': 500, 'message': 'Backend Error'}})
                if self.command == 'GET' and not eid:
                    tmin = iso(qs['timeMin']) if 'timeMin' in qs else None
                    tmax = iso(qs['timeMax']) if 'timeMax' in qs else None
                    def dentro(e):
                        s = iso(e['start'].get('dateTime') or e['start']['date'] + 'T00:00:00+00:00')
                        en = iso(e['end'].get('dateTime') or e['end']['date'] + 'T00:00:00+00:00')
                        return (not tmin or en > tmin) and (not tmax or s < tmax)
                    items = sorted([e for e in evs if dentro(e)], key=lambda e: e['start'].get('dateTime') or e['start'].get('date'))
                    return self._json(200, {'kind': 'calendar#events', 'items': items})
                if self.command == 'POST':
                    # Como Google: escribir tarda; si n8n lanzara la verificación a la vez, se notaría.
                    LOCK.release()
                    time.sleep(0.6)
                    LOCK.acquire()
                    e = json.loads(cuerpo)
                    if e.get('id') and any(x['id'] == e['id'] for x in evs):
                        return self._json(409, {'error': {'code': 409, 'message': 'The requested identifier already exists.'}})
                    e.setdefault('id', f'ev{len(evs) + 1}')
                    e['status'] = 'confirmed'
                    evs.append(e)
                    return self._json(200, e)
                ev = next((x for x in evs if x['id'] == eid), None)
                if not ev:
                    return self._json(404, {'error': {'code': 404, 'message': 'Not Found'}})
                if self.command == 'PATCH':
                    ev.update(json.loads(cuerpo))
                    return self._json(200, ev)
                if self.command == 'DELETE':
                    evs.remove(ev)
                    self.send_response(204)
                    self.end_headers()
                    return
            self._json(404, {'error': 'ruta desconocida ' + ruta})


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', int(sys.argv[1]) if len(sys.argv) > 1 else 8080), H).serve_forever()
