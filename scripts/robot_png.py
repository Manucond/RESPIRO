#!/usr/bin/env python3
"""Convierte los SVG del robot a PNG con Chrome sin interfaz (Telegram necesita PNG/JPG)."""
import subprocess
import tempfile
from pathlib import Path

DIR = Path(__file__).resolve().parents[1] / 'app' / 'robot'
TAM = {'perfil': 640}


def png(svg, destino, lado):
    with tempfile.TemporaryDirectory() as tmp:
        html = Path(tmp) / 'r.html'
        fondo = 'transparent'
        html.write_text(f'<html><body style="margin:0;background:{fondo}">'
                        f'<img src="file://{svg}" style="width:{lado}px;height:{lado}px;display:block"></body></html>')
        subprocess.run(['google-chrome', '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
                        f'--window-size={lado},{lado}', '--default-background-color=00000000',
                        f'--screenshot={destino}', f'file://{html}'], check=True, capture_output=True)


for svg in sorted(DIR.glob('*.svg')):
    lado = TAM.get(svg.stem, 512)
    png(svg, DIR / f'{svg.stem}.png', lado)
    print(svg.stem, lado)
