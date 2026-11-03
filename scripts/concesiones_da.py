#!/usr/bin/env python3
"""Normaliza las concesiones de agua de la Direccion de Agua (MINAE) a data/aprovechamientos.json.

Fuente: capa Aguas:DA_Concesiones del GeoServer de la Direccion de Agua.
Como el servicio WFS esta deshabilitado, los datos se obtienen via WMS
GetFeatureInfo sobre una imagen de 1x1 px que cubre todo el pais:

  http://mapas.da.go.cr/geopc.php?service=WMS&version=1.1.1&request=GetFeatureInfo
    &layers=Aguas:DA_Concesiones&query_layers=Aguas:DA_Concesiones
    &srs=EPSG:4326&bbox=-86.5,7.6,-82.3,11.5&width=1&height=1&x=0&y=0
    &info_format=application/json&feature_count=200000

El resultado es GeoJSON con geometria ya en WGS84.

Por defecto filtra a concesiones de ACUEDUCTO RURAL (expediente tipo "R"),
que son las fuentes que abastecen a las ASADAS, y solo en estados vigentes.
No se publica RAZON_SOCIAL (nombre del concesionario: dato personal).

Uso:
  python3 scripts/concesiones_da.py <geojson_entrada> [--todas] [--salida data/aprovechamientos.json]
"""
import argparse
import json
import sys

# Estados que consideramos vigentes / relevantes (la concesion sigue en pie)
ESTADOS_VIGENTES = {
    'OTORGADO', 'INSCRITO', 'INSCRITO-ARTESANAL', 'RESUELTO', 'MOROSO PAGO DE CANON',
}

# Caudal desglosado por uso (l/s)
CAMPOS_CAUDAL = [
    ('CAUDAL_CONSUMO_HUMANO', 'consumo humano'),
    ('CAUDAL_ACUEDUCTO_RURAL', 'acueducto rural'),
    ('CAUDAL_RIEGO', 'riego'),
    ('CAUDAL_AGROPECUARIO', 'agropecuario'),
    ('CAUDAL_AGROINDUSTRIAL', 'agroindustrial'),
    ('CAUDAL_INDUSTRIAL', 'industrial'),
    ('CAUDAL_COMERCIAL', 'comercial'),
    ('CAUDAL_TURISTICO', 'turistico'),
    ('CAUDAL_FUERZA_HIDRAULICA', 'fuerza hidraulica'),
]

# Clasificacion de la fuente: subterranea vs superficial
SUBTERRANEA = {'ACUIFERO', 'POZO'}


def clasificar(tipo_fuente):
    t = (tipo_fuente or '').strip().upper()
    if t in SUBTERRANEA:
        return 'Subterranea'
    if t in ('', 'OTROS'):
        return 'Otra'
    return 'Superficial'


def caudal_total(props):
    return sum(props.get(c) or 0 for c, _ in CAMPOS_CAUDAL)


def uso_dominante(props):
    mejor, mejorv = '', 0
    for campo, etiqueta in CAMPOS_CAUDAL:
        v = props.get(campo) or 0
        if v > mejorv:
            mejor, mejorv = etiqueta, v
    return mejor


def normalizar(features, solo_rural=True):
    salida = []
    for f in features:
        p = f.get('properties', {})
        estado = (p.get('ESTADO_DEL_EXPEDIENTE') or '').strip()
        if estado not in ESTADOS_VIGENTES:
            continue
        if solo_rural and not (p.get('TIPO_DE_EXPEDIENTE') or '').startswith('R '):
            continue
        geom = f.get('geometry') or {}
        coords = geom.get('coordinates')
        if not coords or len(coords) < 2:
            continue
        lon, lat = coords[0], coords[1]
        if not (-87 < lon < -82 and 7 < lat < 12):
            continue
        q = caudal_total(p)
        nombre = (p.get('NOMBRE_DE_LA_FUENTE') or '').strip()
        if nombre.upper() in ('', 'SIN NOMBRE'):
            nombre = ''
        rec = {
            'n': nombre,
            'f': clasificar(p.get('TIPO_DE_FUENTE')),
            't': (p.get('TIPO_DE_FUENTE') or '').strip().capitalize(),
            'q': round(q, 3),
            'u': uso_dominante(p) if q > 0 else '',
            'll': [round(lon, 5), round(lat, 5)],
        }
        salida.append(rec)
    return salida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('entrada', help='GeoJSON de GetFeatureInfo (DA_Concesiones)')
    ap.add_argument('--todas', action='store_true',
                    help='incluir todas las concesiones vigentes, no solo acueducto rural')
    ap.add_argument('--salida', default='data/aprovechamientos.json')
    args = ap.parse_args()

    with open(args.entrada, encoding='utf-8') as fh:
        d = json.load(fh)
    feats = d.get('features', [])
    recs = normalizar(feats, solo_rural=not args.todas)

    con_caudal = sum(1 for r in recs if r['q'] > 0)
    doc = {
        'fuente': 'Direccion de Agua, MINAE (DA_Concesiones)',
        'nota': 'concesiones de agua vigentes' + ('' if args.todas else ' para acueducto rural (ASADAS)'),
        'n': len(recs),
        'con_caudal': con_caudal,
        'aprovech': recs,
    }
    with open(args.salida, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(recs)} concesiones -> {args.salida} ({con_caudal} con caudal)', file=sys.stderr)


if __name__ == '__main__':
    main()
