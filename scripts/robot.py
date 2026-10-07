#!/usr/bin/env python3
"""Genera la mascota de RESPIRO (robot amarillo original) en SVG.

Salida: app/robot/{normal,pensando,contento,confundido,durmiendo}.svg y perfil.svg
Para los PNG (Telegram no acepta SVG): python3 scripts/robot_png.py
"""
from pathlib import Path

DESTINO = Path(__file__).resolve().parents[1] / 'app' / 'robot'

AMARILLO = '#F6C445'
AMARILLO_SOMBRA = '#E3A92B'
MARINO = '#16213E'
BRILLO = '#FFF1BF'
MEJILLA = '#F29C7E'
ACENTO = '#E8743B'


def cuerpo(cara, extra='', antena=ACENTO):
    """Cuerpo común. `cara` va dentro de la pantalla (x 58..142, y 60..114)."""
    return f'''
  <!-- antena -->
  <line x1="100" y1="40" x2="100" y2="22" stroke="{MARINO}" stroke-width="5" stroke-linecap="round"/>
  <circle cx="100" cy="17" r="8" fill="{antena}" stroke="{MARINO}" stroke-width="4"/>
  <!-- orejas -->
  <rect x="27" y="70" width="17" height="34" rx="7" fill="{AMARILLO_SOMBRA}" stroke="{MARINO}" stroke-width="5"/>
  <rect x="156" y="70" width="17" height="34" rx="7" fill="{AMARILLO_SOMBRA}" stroke="{MARINO}" stroke-width="5"/>
  <!-- cuerpo -->
  <path d="M70 140 h60 a16 16 0 0 1 16 16 v20 a16 16 0 0 1 -16 16 h-60 a16 16 0 0 1 -16 -16 v-20 a16 16 0 0 1 16 -16z"
        fill="{AMARILLO}" stroke="{MARINO}" stroke-width="5"/>
  <!-- onda de respiración en el pecho -->
  <path d="M72 168 q7 -9 14 0 t14 0 t14 0 t14 0" fill="none" stroke="{MARINO}" stroke-width="4.5" stroke-linecap="round"/>
  <!-- brazos -->
  <path d="M55 158 q-14 2 -17 14" fill="none" stroke="{MARINO}" stroke-width="6" stroke-linecap="round"/>
  <path d="M145 158 q14 2 17 14" fill="none" stroke="{MARINO}" stroke-width="6" stroke-linecap="round"/>
  <!-- cabeza -->
  <rect x="40" y="40" width="120" height="96" rx="32" fill="{AMARILLO}" stroke="{MARINO}" stroke-width="5"/>
  <path d="M52 64 q4 -14 22 -16" fill="none" stroke="{BRILLO}" stroke-width="5" stroke-linecap="round"/>
  <!-- pantalla -->
  <rect x="56" y="58" width="88" height="60" rx="22" fill="{MARINO}"/>
  {cara}
  {extra}'''


def svg(contenido, titulo, fondo=None, vb='0 0 200 200'):
    f = f'<rect width="200" height="200" fill="{fondo}"/>' if fondo else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="{titulo}">'
            f'<title>{titulo}</title>{f}{contenido}\n</svg>\n')


OJO = lambda x, y, h=18: f'<rect x="{x - 6}" y="{y - h / 2}" width="12" height="{h}" rx="6" fill="{BRILLO}"/>'

CARAS = {
    'normal': (
        OJO(83, 84) + OJO(117, 84) +
        f'<path d="M89 102 q11 8 22 0" fill="none" stroke="{BRILLO}" stroke-width="4.5" stroke-linecap="round"/>',
        '', 'Asistente de RESPIRO'),
    'pensando': (
        f'<rect x="83" y="74" width="12" height="16" rx="6" fill="{BRILLO}"/>'
        f'<rect x="117" y="74" width="12" height="16" rx="6" fill="{BRILLO}"/>'
        f'<path d="M92 104 h16" stroke="{BRILLO}" stroke-width="4.5" stroke-linecap="round"/>',
        f'<circle cx="160" cy="34" r="5" fill="{MARINO}"/><circle cx="174" cy="22" r="6.5" fill="{MARINO}"/>'
        f'<circle cx="190" cy="9" r="8" fill="{MARINO}"/>',
        'Asistente de RESPIRO pensando'),
    'contento': (
        f'<path d="M76 88 q7 -11 14 0" fill="none" stroke="{BRILLO}" stroke-width="5" stroke-linecap="round"/>'
        f'<path d="M110 88 q7 -11 14 0" fill="none" stroke="{BRILLO}" stroke-width="5" stroke-linecap="round"/>'
        f'<path d="M86 98 h28 a14 14 0 0 1 -28 0z" fill="{BRILLO}"/>'
        f'<circle cx="69" cy="101" r="5" fill="{MEJILLA}" opacity=".9"/><circle cx="131" cy="101" r="5" fill="{MEJILLA}" opacity=".9"/>',
        f'<path d="M172 40 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="{ACENTO}"/>'
        f'<path d="M22 34 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="{ACENTO}"/>',
        'Asistente de RESPIRO contento'),
    'confundido': (
        f'<circle cx="83" cy="84" r="7.5" fill="none" stroke="{BRILLO}" stroke-width="4.5"/>'
        f'<path d="M111 84 h13" stroke="{BRILLO}" stroke-width="5" stroke-linecap="round"/>'
        f'<path d="M86 104 q6 -6 12 0 t12 0" fill="none" stroke="{BRILLO}" stroke-width="4.5" stroke-linecap="round"/>',
        f'<text x="168" y="44" font-family="Georgia, serif" font-size="40" font-weight="700" fill="{ACENTO}" stroke="{MARINO}" stroke-width="2">?</text>',
        'Asistente de RESPIRO confundido'),
    'durmiendo': (
        f'<path d="M76 84 q7 7 14 0" fill="none" stroke="{BRILLO}" stroke-width="5" stroke-linecap="round"/>'
        f'<path d="M110 84 q7 7 14 0" fill="none" stroke="{BRILLO}" stroke-width="5" stroke-linecap="round"/>'
        f'<ellipse cx="100" cy="103" rx="5" ry="4" fill="{BRILLO}"/>',
        f'<text x="160" y="40" font-family="Georgia, serif" font-size="20" font-weight="700" fill="{MARINO}">z</text>'
        f'<text x="173" y="24" font-family="Georgia, serif" font-size="28" font-weight="700" fill="{MARINO}">Z</text>',
        'Asistente de RESPIRO durmiendo'),
}


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    for nombre, (cara, extra, titulo) in CARAS.items():
        antena = '#9AA3B5' if nombre == 'durmiendo' else ACENTO
        (DESTINO / f'{nombre}.svg').write_text(svg(cuerpo(cara, extra, antena), titulo))
    # Foto de perfil: solo cabeza, grande y centrada (Telegram la recorta en círculo).
    cara, _, _ = CARAS['normal']
    cabeza = cuerpo(cara).split('<!-- cuerpo -->')[0] + '<!-- cabeza -->' + cuerpo(cara).split('<!-- cabeza -->')[1]
    perfil = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="RESPIRO">'
              f'<title>RESPIRO</title><rect width="200" height="200" fill="#F5E6BF"/>'
              f'<g transform="translate(100 104) scale(1.2) translate(-100 -78)">{cabeza}</g>\n</svg>\n')
    (DESTINO / 'perfil.svg').write_text(perfil)
    print('SVG generados en', DESTINO)


if __name__ == '__main__':
    main()
