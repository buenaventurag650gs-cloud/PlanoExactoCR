"""Agrega coordenadas del centro de salud y de la escuela más cercanos (para dibujarlos en la lámina del expediente)."""
import json
from pyproj import Transformer
from shapely.geometry import Point, Polygon, MultiPolygon
from shapely.ops import transform as T
from shapely.strtree import STRtree
UP = '/mnt/user-data/uploads/Downloads/'
SITE = '/home/claude/remates-catastro/data/'
R = json.load(open(SITE + 'remates.json'))
sal = json.load(open(SITE + 'salud.json'))
ign = json.load(open(UP + 'ign_puntos_costa.json'))
tm = Transformer.from_crs('EPSG:4326', 'EPSG:5367', always_xy=True).transform
P = lambda g: T(tm, g)
esc = [p for p in ign['pts'] if p[0].lower().startswith(('escuela', 'colegio', 'liceo'))]
ep = [P(Point(p[1], p[2])) for p in esc]; et = STRtree(ep)
byname = {s['n']: s for s in sal}
n = 0
for r in R:
    e = r.get('ent')
    if not e or not r.get('ll'): continue
    g = MultiPolygon([Polygon(p[0]) for p in r['poly']]).buffer(0) if r.get('poly') else Point(*r['ll'])
    gm = P(g)
    if e.get('salud') and e['salud']['n'] in byname: e['salud']['ll'] = byname[e['salud']['n']]['ll']
    i = et.nearest(gm); e['escP'] = {'t': esc[i][0].capitalize(), 'll': [esc[i][1], esc[i][2]]}; n += 1
json.dump(R, open(SITE + 'remates.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('ok', n, R[5]['ent'].get('salud'), R[5]['ent'].get('escP'))
