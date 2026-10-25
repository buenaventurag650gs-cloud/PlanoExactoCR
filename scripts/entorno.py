"""Agrega a cada remate un resumen del entorno ('ent').
Capas locales: planes reguladores (INVU), centros de salud (CCSS), escuelas (IGN), línea de costa (IGN).
Capas consultadas por predio en el navegador (archivo opcional ctx_predios.json): hidrografía, vías y curvas (IGN 1:5000),
cobertura 2020, PSA 2025, franjas de protección, zonas de vida y cuencas (MINAE)."""
import json, math, os, sys
from pyproj import Transformer
from shapely.geometry import shape, Point, LineString, MultiLineString, Polygon, MultiPolygon
from shapely.ops import transform as stransform
from shapely.strtree import STRtree

UP = '/mnt/user-data/uploads/Downloads/'
R = json.load(open('remates.json'))
planes = json.load(open(UP + 'planes_reguladores_invu.json'))
salud = json.load(open(UP + 'salud_ccss.json'))
ign = json.load(open(UP + 'ign_puntos_costa.json'))
ctxp = json.load(open('ctx_predios.json')) if os.path.exists('ctx_predios.json') else {}
zc = json.load(open(UP + 'zonasvida_cuencas.json'))
def polys(lst):
    gs, ns = [], []
    for x in lst:
        try:
            g = MultiPolygon([Polygon(pl[0], pl[1:]) for pl in x['g']]).buffer(0)
            gs.append(g); ns.append(x['n'])
        except Exception:
            pass
    return gs, ns, STRtree(gs)
zv_g, zv_n, zv_t = polys(zc['zv'])
cu_g, cu_n, cu_t = polys(zc['cu'])
def at(gs, ns, t, pt):
    for i in t.query(pt):
        if gs[i].contains(pt): return ns[i]
    return None

# Proyección métrica: CRTM05
to_m = Transformer.from_crs('EPSG:4326', 'EPSG:5367', always_xy=True).transform
P = lambda g: stransform(to_m, g)

# Planes reguladores
pr_geoms, pr_props = [], []
for f in planes['features']:
    try:
        g = shape(f['geometry']).buffer(0)
        pr_geoms.append(g); pr_props.append(f['properties'])
    except Exception:
        pass
pr_tree = STRtree(pr_geoms)

def pr_at(lon, lat):
    pt = Point(lon, lat)
    for i in pr_tree.query(pt):
        if pr_geoms[i].contains(pt):
            p = pr_props[i]
            si = (p.get('tiene') == 'Si') or p['cat'].startswith('PR Vigente') or p['cat'].startswith('Vigente')
            return {'si': bool(si), 'anno': p.get('anno') or None, 'escala': p.get('escala'), 'pub': (p.get('pub') or '').strip(' -') or None, 'cat': p['cat'], 'canton': p['canton']}
    return None

# Puntos: salud y escuelas (proyectados)
sal_pts = [P(Point(*s['ll'])) for s in salud]
sal_tree = STRtree(sal_pts)
esc_raw = [p for p in ign['pts'] if p[0].lower().startswith(('escuela', 'colegio', 'liceo'))]
esc_pts = [P(Point(p[1], p[2])) for p in esc_raw]
esc_tree = STRtree(esc_pts)
costa = P(MultiLineString([LineString(l) for l in ign['costa'] if len(l) > 1]))

def nearest(tree, pts, geom):
    i = tree.nearest(geom)
    return i, geom.distance(pts[i])

out_stats = {'pr': 0, 'agua': 0, 'cob': 0, 'via': 0, 'pend': 0}
for r in R:
    if not r.get('ll'):
        continue
    lon, lat = r['ll']
    ent = {}
    pr = pr_at(lon, lat)
    if pr:
        ent['pr'] = pr; out_stats['pr'] += 1
    exact = r.get('loc') in ('plano', 'finca') and r.get('poly')
    if exact:
        g = MultiPolygon([Polygon(p[0]) for p in r['poly']]).buffer(0)
    else:
        g = Point(lon, lat)
    gm = P(g)
    i, d = nearest(sal_tree, sal_pts, gm)
    ent['salud'] = {'n': salud[i]['n'], 'c': salud[i]['c'], 'd': round(d)}
    i, d = nearest(esc_tree, esc_pts, gm)
    ent['esc'] = round(d)
    if exact:
        dc = gm.distance(costa)
        if dc < 5000: ent['costa'] = round(dc)
        c = ctxp.get(str(r['id']))
        if c:
            # Hidrografía: distancia mínima del borde del predio a un cauce
            hl = [P(LineString(l)) for l in c.get('hidro', []) if len(l) > 1]
            cubierto = bool(hl or c.get('curvas'))  # sin curvas ni cauces: zona sin cartografía 1:5000
            if cubierto:
                ent['agua'] = round(min(gm.distance(h) for h in hl)) if hl else None
                if hl: out_stats['agua'] += 1
            vl = [(t, P(LineString(l))) for t, l in c.get('vias', []) if len(l) > 1]
            if vl:
                t, v = min(vl, key=lambda tv: gm.distance(tv[1]))
                ent['via'] = {'t': (t or 'Vía')[:1].upper() + (t or 'Vía')[1:], 'd': round(gm.distance(v))}; out_stats['via'] += 1
            # Relieve: curvas que cruzan un círculo de 60 m alrededor del centro del predio
            cv = [(e, P(LineString(l))) for e, l in c.get('curvas', []) if len(l) > 1]
            if cv:
                ctr = gm.representative_point()
                ds = sorted(((ctr.distance(line), e) for e, line in cv))
                ent['elev'] = ds[0][1]
                # pendiente: diferencia de cota entre las dos curvas distintas más cercanas / suma de distancias
                e0, d0 = ds[0][1], ds[0][0]
                otra = next(((d, e) for d, e in ds if e != e0), None)
                if otra:
                    dist = d0 + otra[0]
                    if dist > 1: ent['pend'] = min(150, abs(otra[1] - e0) / dist * 100); out_stats['pend'] += 1
                else:
                    ent['suave'] = True  # una sola cota de 10 m en ~120 m alrededor: pendiente baja
            if c.get('cob'): ent['cob'] = c['cob']; out_stats['cob'] += 1
            ent['pend'] = round(ent['pend']) if ent.get('pend') is not None else ent.get('pend')
            if ent.get('pend') is None: ent.pop('pend', None)
            if c.get('psa'): ent['psa'] = True
            if c.get('prot'): ent['prot'] = True
    zv = at(zv_g, zv_n, zv_t, Point(lon, lat))
    if zv: ent['zv'] = zv.capitalize()
    cu = at(cu_g, cu_n, cu_t, Point(lon, lat))
    if cu: ent['cu'] = cu
    r['ent'] = ent

print(out_stats, 'total', len(R))
json.dump(R, open('remates.json', 'w'), ensure_ascii=False, separators=(',', ':'))

# Capas para el mapa
pf = [{'type': 'Feature', 'properties': {'canton': p['canton'], 'cat': p['cat'], 'si': (p.get('tiene') == 'Si') or p['cat'].startswith(('PR Vigente', 'Vigente')), 'anno': p.get('anno') or None, 'escala': p.get('escala'), 'pub': (p.get('pub') or '').strip(' -') or None}, 'geometry': f['geometry']} for f, p in zip(planes['features'], [f['properties'] for f in planes['features']])]
json.dump({'type': 'FeatureCollection', 'features': pf}, open('planes_reguladores.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(salud, open('salud.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('ok')
