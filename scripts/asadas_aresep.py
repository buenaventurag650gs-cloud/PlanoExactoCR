#!/usr/bin/env python3
"""Directorio oficial de ASADAS (ARESEP, Intendencia de Agua) -> data/asadas.json

Fuente: https://aresep.go.cr/datos-abiertos/acueducto-comunales-asadas/
Endpoint: https://datos.aresep.go.cr/ws.datosabiertos/Services/IA/Asadas.svc/ObtenerInformacionUbicacionAsadas

Cada ASADA viene como PUNTO en CRTM05 (EPSG:5367), no como poligono: sirve para decir
«hay una ASADA registrada cerca», no para dibujar un area de servicio.
No se publican telefono, fax ni correo (datos de contacto de personas/comites).

Uso:  python3 scripts/asadas_aresep.py <respuesta_aresep.json> [data/asadas.json]
      python3 scripts/asadas_aresep.py --url            (descarga el endpoint)
"""
import json, math, re, sys, urllib.request

URL = 'https://datos.aresep.go.cr/ws.datosabiertos/Services/IA/Asadas.svc/ObtenerInformacionUbicacionAsadas'

# CRTM05: Mercator transversa, GRS80, meridiano central -84, k0 0.9999, falso este 500000
_A = 6378137.0; _F = 1 / 298.257222101; _E2 = _F * (2 - _F); _EP2 = _E2 / (1 - _E2)
_K0 = 0.9999; _LON0 = math.radians(-84.0); _FE = 500000.0


def crtm05_a_wgs84(x, y):
    M = y / _K0
    mu = M / (_A * (1 - _E2 / 4 - 3 * _E2 ** 2 / 64 - 5 * _E2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
          + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    s, c, t = math.sin(p1), math.cos(p1), math.tan(p1)
    N1 = _A / math.sqrt(1 - _E2 * s * s); T1 = t * t; C1 = _EP2 * c * c
    R1 = _A * (1 - _E2) / (1 - _E2 * s * s) ** 1.5; D = (x - _FE) / (N1 * _K0)
    lat = p1 - (N1 * t / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * _EP2) * D ** 4 / 24
                                + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * _EP2 - 3 * C1 ** 2) * D ** 6 / 720)
    lon = _LON0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * _EP2 + 24 * T1 ** 2) * D ** 5 / 120) / c
    return math.degrees(lon), math.degrees(lat)


def titulo(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def normalizar(crudo):
    filas = crudo['value'] if isinstance(crudo, dict) else crudo
    out, vistos = [], set()
    for r in filas:
        try:
            lon, lat = crtm05_a_wgs84(float(str(r['coordenadaX']).strip()), float(str(r['coordenadaY']).strip()))
        except (ValueError, KeyError):
            continue
        if not (-86.1 < lon < -82.5 and 8.0 < lat < 11.3): continue      # fuera de Costa Rica: descartar
        ident = str(r.get('id_Asada', '')).strip()
        if ident in vistos: continue
        vistos.add(ident)
        op = titulo(r.get('operador'))
        m = re.match(r'^(\d+-\d{4})_(.*)$', op)                         # «00015-2014_NOMBRE»: registro-año
        tipo = titulo(r.get('tipoSistema')).upper()
        out.append({'id': ident, 'n': m.group(2) if m else op, 'reg': m.group(1) if m else None,
                    'tipo': None if tipo in ('', 'SIN INFORMACIÓN') else tipo.capitalize(),
                    'prov': titulo(r.get('provincia')).title(), 'cant': titulo(r.get('canton')).title(),
                    'dist': titulo(r.get('distrito')).title(), 'dc': r.get('codigoDTA'),
                    'll': [round(lon, 4), round(lat, 4)]})                 # ~11 m, suficiente para un punto de referencia
    out.sort(key=lambda a: (a['dc'] or 0, a['n']))
    return out


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--url']
    if '--url' in sys.argv:
        with urllib.request.urlopen(URL, timeout=60) as f: crudo = json.load(f)
    else:
        crudo = json.load(open(args[0], encoding='utf-8'))
    fecha = (crudo.get('metadata') or {}).get('date', '')[:10] if isinstance(crudo, dict) else ''
    asadas = normalizar(crudo)
    destino = args[-1] if len(args) > 1 or ('--url' in sys.argv and args) else 'data/asadas.json'
    with open(destino, 'w', encoding='utf-8') as f:
        json.dump({'fuente': 'ARESEP · Intendencia de Agua', 'fecha_fuente': fecha, 'n': len(asadas), 'asadas': asadas}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(asadas)} ASADAS -> {destino}')
