#!/usr/bin/env python3
"""Convierte data/postes_raw.json en dos entregables para el sitio:

1. data/postes.json          — formato compacto para el navegador. Solo las
                                125 906 coordenadas [lon, lat], sin wrapper.
                                Se usa en el expediente para calcular la
                                distancia al poste más cercano del predio.

2. data/postes_cov.geojson   — polígono de cobertura implícita del tendido
                                eléctrico: raster + marching squares con la
                                misma técnica de cobertura_concesiones.py.
                                Pensado para ver «dónde hay tendido» a
                                escala nacional.

El cálculo es el mismo que cobertura_concesiones: proyectar a CRTM05,
rasterizar un disco de radio uniforme (parámetro --radio-m), vectorizar y
simplificar. Para postes se usa un radio pequeño (150 m por defecto)
porque la densidad es mucho mayor y cualquier radio grande cubriría todo
el país plano.

Uso:
    python3 scripts/postes_procesar.py data/postes_raw.json \
        [--radio-m 150] [--res-m 50] [--min-area-km2 0.25]
"""
import argparse
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter
from skimage import measure

# Reutilizamos las fórmulas CRTM05 de scripts/cobertura_concesiones.py
_A = 6378137.0
_F = 1 / 298.257222101
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)
_K0 = 0.9999
_LON0 = math.radians(-84.0)
_FE = 500000.0


def wgs84_a_crtm05(lon_deg, lat_deg):
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
    ap.add_argument('entrada', help='data/postes_raw.json')
    ap.add_argument('--radio-m', type=float, default=150.0,
                    help='radio del disco por poste al rasterizar (default 150)')
    ap.add_argument('--res-m', type=float, default=50.0,
                    help='resolución del raster en metros (default 50)')
    ap.add_argument('--tol-m', type=float, default=100.0,
                    help='tolerancia de simplificación (default 100)')
    ap.add_argument('--min-area-km2', type=float, default=0.25,
                    help='descartar polígonos chicos (default 0.25)')
    ap.add_argument('--suavizar-m', type=float, default=0.0,
                    help='sigma del gaussian blur en metros antes de vectorizar '
                         '(0 lo desactiva). Con 40–60 m produce curvas tipo burbuja '
                         'y recorta protuberancias angulosas de marching squares.')
    ap.add_argument('--chaikin', type=int, default=0,
                    help='iteraciones del suavizado de Chaikin sobre cada polígono '
                         '(0 lo desactiva). 2 iteraciones producen curvas tipo '
                         'burbuja; cada iteración duplica los vértices.')
    ap.add_argument('--salida-cov', default='data/postes_cov.geojson')
    ap.add_argument('--salida-pts', default='data/postes.json')
    args = ap.parse_args()

    doc = json.load(open(args.entrada, encoding='utf-8'))
    ll = doc.get('ll') or doc.get('aprovech') or []
    if not ll:
        print('entrada sin coordenadas', file=sys.stderr)
        sys.exit(1)
    print(f'{len(ll):,} postes', file=sys.stderr)

    # Export compacto para el navegador: coordenadas listas, 5 decimales
    pts_doc = {'fuente': doc.get('fuente', 'ARESEP'), 'n': len(ll), 'll': ll}
    with open(args.salida_pts, 'w', encoding='utf-8') as fh:
        json.dump(pts_doc, fh, separators=(',', ':'))
    print(f'postes → {args.salida_pts}', file=sys.stderr)

    # Rasterizar discos
    xy = []
    xmin = ymin = float('inf'); xmax = ymax = float('-inf')
    for lon, lat in ll:
        x, y = wgs84_a_crtm05(lon, lat)
        xy.append((x, y))
        xmin = min(xmin, x); xmax = max(xmax, x)
        ymin = min(ymin, y); ymax = max(ymax, y)

    pad = args.radio_m + 2 * args.res_m
    xmin -= pad; ymin -= pad; xmax += pad; ymax += pad
    W = int(math.ceil((xmax - xmin) / args.res_m))
    H = int(math.ceil((ymax - ymin) / args.res_m))
    r_px = max(1, int(round(args.radio_m / args.res_m)))
    print(f'raster {W}×{H} px ({args.res_m:g} m) · radio {r_px} px ({args.radio_m:g} m)',
          file=sys.stderr)

    img = Image.new('L', (W, H), 0)
    draw = ImageDraw.Draw(img)
    for x, y in xy:
        cx = (x - xmin) / args.res_m
        cy = H - (y - ymin) / args.res_m
        draw.ellipse([cx - r_px, cy - r_px, cx + r_px, cy + r_px], fill=255)
    arr = np.asarray(img, dtype=np.uint8)
    if args.suavizar_m > 0:
        sigma_px = args.suavizar_m / args.res_m
        arr = gaussian_filter(arr.astype(np.float32), sigma=sigma_px)
        # Umbral un poco por debajo del medio: compensa la caída del blur en
        # los bordes y preserva aproximadamente el área original.
        contours = measure.find_contours(arr, 110)
    else:
        contours = measure.find_contours(arr, 128)
    print(f'{len(contours)} contornos crudos', file=sys.stderr)
    tol_px = max(1.0, args.tol_m / args.res_m)
    min_area_px = (args.min_area_km2 * 1_000_000) / (args.res_m ** 2)

    def chaikin(pts, iters):
        # Corner-cutting: cada arista se reemplaza por dos puntos al 1/4 y 3/4
        # del camino original. Convierte esquinas en arcos suaves y mantiene el
        # perímetro cerrado. Preserva ~95 % del área por iteración.
        for _ in range(iters):
            out = []
            n = len(pts)
            for i in range(n - 1):  # pts viene cerrado; iteramos sin repetir
                a, b = pts[i], pts[(i + 1) % (n - 1)]
                out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
                out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
            out.append(out[0])  # cerrar
            pts = out
        return pts

    features = []
    for cnt in contours:
        poly = measure.approximate_polygon(cnt, tol_px)
        if len(poly) < 4:
            continue
        coords_m = []
        for row, col in poly:
            xm = xmin + col * args.res_m
            ym = ymin + (H - row) * args.res_m
            coords_m.append((xm, ym))
        # Antes del área y de proyectar: suavizado opcional de Chaikin para
        # convertir las esquinas rectas de marching squares en arcos. Después,
        # un segundo pase de simplificación con tolerancia menor recorta
        # vértices redundantes manteniendo la curvatura.
        if args.chaikin > 0:
            if coords_m[0] != coords_m[-1]:
                coords_m = coords_m + [coords_m[0]]
            coords_m = chaikin(coords_m, args.chaikin)
            # Re-simplificar al 25 % de la tolerancia original (preserva curvas)
            arr_ch = np.array(coords_m)
            tol_post = (args.tol_m * 0.25) / args.res_m  # en px-equivalente
            simp = measure.approximate_polygon(arr_ch / args.res_m, tol_post) * args.res_m
            coords_m = [tuple(p) for p in simp]
        n = len(coords_m)
        s = 0.0
        for i in range(n):
            x0, y0 = coords_m[i]; x1, y1 = coords_m[(i + 1) % n]
            s += x0 * y1 - x1 * y0
        area_px = abs(s) / (args.res_m ** 2) / 2
        if area_px < min_area_px:
            continue
        ring = []
        for xm, ym in coords_m:
            lon, lat = crtm05_a_wgs84(xm, ym)
            ring.append([round(lon, 5), round(lat, 5)])
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        features.append({'type': 'Feature',
                         'properties': {'area_km2': round(abs(s) / 2 / 1_000_000, 2)},
                         'geometry': {'type': 'Polygon', 'coordinates': [ring]}})

    features.sort(key=lambda f: f['properties']['area_km2'], reverse=True)
    out = {'type': 'FeatureCollection',
           'nota': (f'Cobertura del tendido eléctrico derivada de los '
                    f'{len(ll):,} postes (radio {args.radio_m:g} m).'),
           'fuente': 'ARESEP — procesado para PlanoExactoCR',
           'features': features}
    with open(args.salida_cov, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    total_km2 = sum(f['properties']['area_km2'] for f in features)
    print(f'{len(features):,} polígonos · {total_km2:,.0f} km² → {args.salida_cov}',
          file=sys.stderr)


if __name__ == '__main__':
    main()
