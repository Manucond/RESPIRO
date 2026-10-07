"""Extrae el código real de los nodos IA · Preparar e IA · Validar para probarlo fuera de n8n."""
import json, sys
sys.path.insert(0, 'n8n')
import build
json.dump({'preparar': build.codigo('ia_preparar.js'), 'validar': build.codigo('ia_validar.js')},
          open('tests/ia/.codigo.json', 'w'))
