#!/usr/bin/env python3
"""Genera un polígono de cobertura implícita a partir de las concesiones de agua.

Metodología:
  1. Proyectar cada toma de WGS84 a CRTM05 (metros).
  2. Rasterizar un disco de radio uniforme (parámetro --radio-m) sobre una
     grilla a 100 m que cubre todo el país.
  3. Vectorizar la grilla con marching squares (skimage.measure.find_contours).
  4. Simplificar cada contorno (Douglas-Peucker vía approximate_polygon).
  5. Convertir los contornos de píxeles a WGS84 (CRTM05 inverso).
  6. Guardar como FeatureCollection de polígonos.

El resultado es visualmente comparable con el polígono «Coberturas AyA ASADAS Muni»:
cada contorno representa un cluster de tomas, no una toma individual. Pensado
como capa complementaria a la cobertura oficial de AyA para detectar
diferencias (áreas con tomas pero sin cobertura declarada, y viceversa).

Uso:
  python3 scripts/cobertura_concesiones.py data/aprovechamientos.json \
      [--radio-m 1200] [--res-m 100] [--salida data/cobertura_concesiones.geojson]
"""
import argparse
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw
from skimage import measure

# CRTM05: Mercator transversa, GRS80, meridiano central -84, k0 0.9999, falso este 500000
_A = 6378137.0
_F = 1 / 298.257222101
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)
_K0 = 0.9999
_LON0 = math.radians(-84.0)
_FE = 500000.0


def wgs84_a_crtm05(lon_deg, lat_deg):
    """Proyección directa WGS84 → CRTM05 (Transverse Mercator)."""
    phi = math.radians(lat_deg)
    lam = math.radians(lon_deg)
    s, c, t = math.sin(phi), math.cos(phi), math.tan(phi)
    N = _A / math.sqrt(1 - _E2 * s * s)
    T = t * t
    C = _EP2 * c * c
    A = (lam - _LON0) * c
    M = _A * (
        (1 - _E2 / 4 - 3 * _E2 ** 2 / 64 - 5 * _E2 ** 3 / 256) * phi
        - (3 * _E2 / 8 + 3 * _E2 ** 2 / 32 + 45 * _E2 ** 3 / 1024) * math.sin(2 * phi)
        + (15 * _E2 ** 2 / 256 + 45 * _E2 ** 3 / 1024) * math.sin(4 * phi)
        - (35 * _E2 ** 3 / 3072) * math.sin(6 * phi)
    )
    x = _FE + _K0 * N * (A + (1 - T + C) * A ** 3 / 6
                         + (5 - 18 * T + T * T + 72 * C - 58 * _EP2) * A ** 5 / 120)
    y = _K0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
                            + (61 - 58 * T + T * T + 600 * C - 330 * _EP2) * A ** 6 / 720))
    return x, y


def crtm05_a_wgs84(x, y):
    """Proyección inversa CRTM05 → WGS84."""
    M = y / _K0
    mu = M / (_A * (1 - _E2 / 4 - 3 * _E2 ** 2 / 64 - 5 * _E2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
          + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
          + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
          + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    s, c, t = math.sin(p1), math.cos(p1), math.tan(p1)
    N1 = _A / math.sqrt(1 - _E2 * s * s)
    T1 = t * t
    C1 = _EP2 * c * c
    R1 = _A * (1 - _E2) / (1 - _E2 * s * s) ** 1.5
    D = (x - _FE) / (N1 * _K0)
    lat = p1 - (N1 * t / R1) * (
        D ** 2 / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * _EP2) * D ** 4 / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * _EP2 - 3 * C1 ** 2) * D ** 6 / 720
    )
    lon = _LON0 + (
        D - (1 + 2 * T1 + C1) * D ** 3 / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * _EP2 + 24 * T1 ** 2) * D ** 5 / 120
    ) / c
    return math.degrees(lon), math.degrees(lat)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('entrada', help='data/aprovechamientos.json')
    ap.add_argument('--radio-m', type=float, default=1200.0,
                    help='radio de cobertura por toma en metros (default 1200)')
    ap.add_argument('--res-m', type=float, default=100.0,
                    help='resolución del raster en metros (default 100)')
    ap.add_argument('--tol-m', type=float, default=200.0,
                    help='tolerancia de simplificación de contornos en metros (default 200)')
    ap.add_argument('--min-area-km2', type=float, default=0.5,
                    help='descartar polígonos con área menor a esto en km² (default 0.5)')
    ap.add_argument('--salida', default='data/cobertura_concesiones.geojson')
    args = ap.parse_args()

    with open(args.entrada, encoding='utf-8') as fh:
        doc = json.load(fh)
    pts = doc.get('aprovech', [])
    if not pts:
        print('entrada vacía', file=sys.stderr)
        sys.exit(1)

    # Proyectar a CRTM05 y acumular bbox
    xy = []
    xmin = ymin = float('inf')
    xmax = ymax = float('-inf')
    for p in pts:
        lon, lat = p['ll']
        x, y = wgs84_a_crtm05(lon, lat)
        xy.append((x, y))
        if x < xmin: xmin = x
        if x > xmax: xmax = x
        if y < ymin: ymin = y
        if y > ymax: ymax = y

    # Agregar un borde del radio para que los discos no se corten
    pad = args.radio_m + 2 * args.res_m
    xmin -= pad; ymin -= pad; xmax += pad; ymax += pad
    W = int(math.ceil((xmax - xmin) / args.res_m))
    H = int(math.ceil((ymax - ymin) / args.res_m))
    r_px = max(1, int(round(args.radio_m / args.res_m)))

    print(f'{len(xy)} tomas · raster {W}×{H} px ({args.res_m:g} m) · radio {r_px} px ({args.radio_m:g} m)',
          file=sys.stderr)

    # Rasterizar discos con PIL (más rápido que numpy puro para N grande)
    img = Image.new('L', (W, H), 0)
    draw = ImageDraw.Draw(img)
    for x, y in xy:
        cx = (x - xmin) / args.res_m
        # En raster, el eje Y va hacia abajo; invertimos para que norte sea arriba
        cy = H - (y - ymin) / args.res_m
        draw.ellipse([cx - r_px, cy - r_px, cx + r_px, cy + r_px], fill=255)

    arr = np.asarray(img, dtype=np.uint8)
    # Marching squares: contornos al nivel 128 (borde del disco binario)
    contours = measure.find_contours(arr, 128)
    print(f'{len(contours)} contornos crudos', file=sys.stderr)

    tol_px = max(1.0, args.tol_m / args.res_m)
    min_area_px = (args.min_area_km2 * 1_000_000) / (args.res_m ** 2)

    features = []
    for cnt in contours:
        # cnt es (N, 2) con (row, col). Simplificar.
        poly = measure.approximate_polygon(cnt, tol_px)
        if len(poly) < 4:
            continue
        # Convertir (row, col) → (x_m, y_m) → (lon, lat)
        coords_m = []
        for row, col in poly:
            xm = xmin + col * args.res_m
            ym = ymin + (H - row) * args.res_m
            coords_m.append((xm, ym))
        # Filtro de área (shoelace sobre coords en metros)
        n = len(coords_m)
        s = 0.0
        for i in range(n):
            x0, y0 = coords_m[i]
            x1, y1 = coords_m[(i + 1) % n]
            s += x0 * y1 - x1 * y0
        area_px = abs(s) / (args.res_m ** 2) / 2
        if area_px < min_area_px:
            continue
        # Proyectar a WGS84 (con la cantidad de decimales mínima útil para 100 m)
        ring = []
        for xm, ym in coords_m:
            lon, lat = crtm05_a_wgs84(xm, ym)
            ring.append([round(lon, 5), round(lat, 5)])
        # Asegurar cerrado
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        features.append({
            'type': 'Feature',
            'properties': {'area_km2': round(abs(s) / 2 / 1_000_000, 2)},
            'geometry': {'type': 'Polygon', 'coordinates': [ring]},
        })

    features.sort(key=lambda f: f['properties']['area_km2'], reverse=True)
    out = {
        'type': 'FeatureCollection',
        'nota': (f'Cobertura implícita derivada de las concesiones de agua '
                 f'(radio {args.radio_m:g} m por toma). No es la cobertura oficial.'),
        'fuente': 'Dirección de Agua, MINAE (DA_Concesiones) — procesado para PlanoExactoCR',
        'features': features,
    }
    with open(args.salida, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    total_km2 = sum(f['properties']['area_km2'] for f in features)
    print(f'{len(features)} polígonos · {total_km2:.0f} km² totales → {args.salida}',
          file=sys.stderr)


if __name__ == '__main__':
    main()
