#!/usr/bin/env python3
"""Descarga los ~125 906 postes del tendido eléctrico desde el ArcGIS de ARESEP.

El servicio tiene un tope de 2 000 features por respuesta, así que iteramos
con resultOffset/resultRecordCount hasta cubrir todo.

Salida: data/postes_raw.json con { n, ll: [[lon, lat], ...] } redondeado a
5 decimales (~1 m). Pensado para que después scripts/postes_procesar.py lo
convierta en el polígono de cobertura y la grilla espacial.

Uso:
    python3 scripts/postes_descargar.py                     # a data/postes_raw.json
    python3 scripts/postes_descargar.py --salida otro.json  # a otro.json
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

URL = ('https://mapas.aresep.go.cr/server/rest/services/'
       'I_Energia_Externo/Infraestructura_vertical_energia_electrica/MapServer/0/query')
PAGE = 2000


def descargar_pagina(offset):
    q = urllib.parse.urlencode({
        'where': '1=1',
        'outFields': 'OBJECTID',
        'returnGeometry': 'true',
        'outSR': '4326',
        'f': 'geojson',
        'resultOffset': offset,
        'resultRecordCount': PAGE,
        'orderByFields': 'OBJECTID ASC',
    })
    url = URL + '?' + q
    req = urllib.request.Request(url, headers={'User-Agent': 'planoexactocr/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='data/postes_raw.json')
    ap.add_argument('--pausa', type=float, default=0.3, help='segundos entre páginas (amable con el servidor)')
    args = ap.parse_args()

    puntos = []
    offset = 0
    pagina = 0
    while True:
        pagina += 1
        try:
            doc = descargar_pagina(offset)
        except Exception as e:
            print(f'página {pagina} falló: {e}. reintento en 2 s…', file=sys.stderr)
            time.sleep(2)
            doc = descargar_pagina(offset)
        feats = doc.get('features', [])
        for f in feats:
            geom = f.get('geometry') or {}
            c = geom.get('coordinates')
            if c and len(c) >= 2:
                puntos.append([round(c[0], 5), round(c[1], 5)])
        print(f'página {pagina:>3d}  offset {offset:>6d}  +{len(feats):>4d}  total {len(puntos):>6d}',
              file=sys.stderr)
        if len(feats) < PAGE:
            break
        offset += PAGE
        time.sleep(args.pausa)

    doc = {'fuente': 'ARESEP — Infraestructura_vertical_energia_electrica (capa 0: Postes)',
           'n': len(puntos), 'll': puntos}
    with open(args.salida, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, separators=(',', ':'))
    print(f'listo: {len(puntos):,} postes → {args.salida}', file=sys.stderr)


if __name__ == '__main__':
    main()
