"""Une remates + predios del catastro + distritos IGN en un solo dataset compacto para el visor."""
import json, re, sys
from pyproj import Transformer
from shapely.geometry import shape, Point, Polygon, MultiPolygon, mapping
from shapely.ops import transform as stransform

UP = '/mnt/user-data/uploads/Downloads/'
REM = sys.argv[1] if len(sys.argv) > 1 else UP + 'remates_activos.json'
GEO = sys.argv[2] if len(sys.argv) > 2 else UP + 'predios_catastro.json'
rem = json.load(open(REM))
geo = json.load(open(GEO))
dist_raw = json.load(open(UP + 'distritos_ign.json'))

# EPSG:8908 (CR-SIRGAS / CRTM05) -> WGS84 lon/lat
tr = Transformer.from_crs('EPSG:8908', 'EPSG:4326', always_xy=True)

# Distritos: decodificar (grados*1000, deltas) a polígonos shapely
def dec(ring):
    pts = [(ring[0], ring[1])]
    for i in range(2, len(ring), 2):
        pts.append((pts[-1][0] + ring[i], pts[-1][1] + ring[i + 1]))
    return [(x / 1000, y / 1000) for x, y in pts]

dists = []
for d in dist_raw:
    polys = []
    for pl in d['g']:
        rings = [dec(r) for r in pl]
        try:
            p = Polygon(rings[0], rings[1:]).buffer(0)
            if not p.is_empty: polys.append(p)
        except Exception:
            pass
    if polys:
        g = MultiPolygon([q for p in polys for q in (p.geoms if p.geom_type == 'MultiPolygon' else [p])])
        dists.append({'c': d['c'], 'd': d['d'], 'k': d['k'], 'geom': g})
print('distritos', len(dists))

def norm(s):
    import unicodedata
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z ]', '', s).strip()

PROV_NAME = {1: 'San José', 2: 'Alajuela', 3: 'Cartago', 4: 'Heredia', 5: 'Guanacaste', 6: 'Puntarenas', 7: 'Limón'}

def find_dist_by_point(pt):
    for d in dists:
        if d['geom'].contains(pt):
            return d
    return None

def find_dist_by_name(prov, dtxt, ktxt):
    if not dtxt: return None
    cands = [d for d in dists if str(d['c'])[0] == str(prov)]
    nd, nk = norm(dtxt), norm(ktxt)
    exact = [d for d in cands if norm(d['d']) == nd and (not nk or norm(d['k']) == nk)]
    if exact: return exact[0]
    exact = [d for d in cands if norm(d['d']) == nd]
    if len(exact) == 1: return exact[0]
    loose = [d for d in cands if nd and (nd in norm(d['d']) or norm(d['d']) in nd) and (not nk or norm(d['k']) == nk)]
    return loose[0] if loose else None

def clean_nat(s):
    if not s: return None
    s = re.sub(r'\s+', ' ', s).strip(' ,.-')
    s = s[0].upper() + s[1:].lower() if s.isupper() or s[:7].lower() == 'terreno' else s
    return s[:120]

def tipo(nat, filial, area):
    n = norm(nat or '')
    if filial or 'filial' in n or 'condominio' in n: return 'Filial'
    if any(w in n for w in ['casa', 'habitacion', 'vivienda', 'edificacion', 'local', 'bodega', 'edificio']): return 'Con construcción'
    if any(w in n for w in ['agric', 'potrero', 'pasto', 'cafe', 'charral', 'tacotal', 'montana', 'bosque', 'cultivo', 'repasto', 'ganad', 'frutal', 'citric', 'palma', 'cana']): return 'Agrícola'
    if area and area >= 5000 and 'construir' not in n: return 'Agrícola'
    return 'Lote'

def redact(t):
    """Quita del texto mostrado el nombre del deudor (\"contra …\"), cédulas y la firma del juez; recorta notas de trámite."""
    if not t: return t
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'(\bcontra\b)\s+.*?(?=\s*(EXP\b|Exp\b|EXPEDIENTE|Expediente|exp\.|\.\s|$))', r'\1 [deudor omitido]', t, flags=re.S)
    t = re.sub(r'\b\d-\d{3,4}-\d{3,4}\b', '[cédula omitida]', t)
    t = re.sub(r'\b(c[ée]dula( de identidad)?( n[úu]mero)?:?)\s*[\d\-\s]{9,14}', r'\1 [omitida]', t, flags=re.I)
    t = re.sub(r'NOTAS:.*?(?=Se remata|$)', '', t, flags=re.S)
    t = re.sub(r'\s*Hora y fecha de emisi[óo]n.*$', '', t, flags=re.S | re.I)
    t = re.sub(r'(JUDICIAL[^.]{0,80}\.)\s.*$', r'\1', t) if 'Se remata' in t else t
    return t.strip()[:3000]

out = []
stats ={'plano': 0, 'finca': 0, 'distrito': 0, 'sin': 0, 'areaDiff': 0}
for r in rem:
    g = geo.get(str(r['id'])) or {}
    rec = {
        'id': r['id'], 'prov': r.get('provincia'), 'finca': r.get('finca'), 'der': r.get('derecho'),
        'filial': bool(r.get('filial')), 'multi': bool(r.get('multiple')),
        'plano': r.get('plano'), 'base': r.get('base'), 'mon': r.get('moneda') or 'CRC',
        'f': r.get('fechas') or [], 'area': r.get('area') or None,
        'nat': clean_nat(r.get('naturaleza')), 'grav': (r.get('gravamenes') or '')[:400] or None,
        'serv': r.get('servidumbres') or [], 'proc': r.get('proceso'), 'exp': r.get('expediente'),
        'juz': r.get('juzgado'), 'bol': r.get('boletin'), 'bols': sorted(set(r.get('boletines') or [r.get('boletin')])),
        'ref': r.get('referencia'), 'txt': redact(r.get('texto')),
    }
    rec['tipo'] = tipo(rec['nat'], rec['filial'], rec['area'])
    via = g.get('via')
    d = None
    if via and g.get('geom'):
        try:
            gs = shape(g['geom']).buffer(0)
            gw = stransform(lambda x, y, z=None: tr.transform(x, y), gs)
            c = gw.representative_point()
            rec['ll'] = [round(c.x, 6), round(c.y, 6)]
            # polígono WGS84 con 6 decimales
            polys = gw.geoms if gw.geom_type == 'MultiPolygon' else [gw]
            rec['poly'] = [[[[round(x, 6), round(y, 6)] for x, y in p.exterior.coords]] for p in polys]
            rec['areaCat'] = (g.get('p') or {}).get('area')
            rec['loc'] = via
            rec['nMatch'] = g.get('nMatch')
            rec['planoCat'] = (g.get('p') or {}).get('plano')
            d = find_dist_by_point(Point(c.x, c.y))
            # Control de coherencia: el predio debe caer en el cantón que declara el edicto
            # (Río Cuarto se segregó de Grecia; se acepta). Las filiales halladas solo por finca no son confiables:
            # su matrícula es una serie distinta a la de fincas madre.
            kt = norm(r.get('cantonTxt')).replace(' ', '')
            kc = norm(d['k'] if d else '').replace(' ', '')
            coh = (not kt) or (not kc) or kt in kc or kc in kt or (kt == 'grecia' and kc == 'riocuarto') or kt.replace('s', 'z') == kc.replace('s', 'z')
            if not coh or (via == 'finca' and rec['filial']):
                rec.pop('ll'); rec.pop('poly'); rec.pop('areaCat', None); rec.pop('planoCat', None)
                rec['rev'] = 'El catastro devolvió un predio en %s, que no coincide con el edicto.' % (d['k'] if d else 'otro cantón') if not coh else 'Filial de condominio: se ubica por distrito hasta verificar la matrícula.'
                stats['revisar'] = stats.get('revisar', 0) + 1
                d = None
                raise ValueError('incoherente')
            stats[via] += 1
            if rec['area'] and rec['areaCat'] and abs(rec['areaCat'] - rec['area']) / rec['area'] > 0.1:
                stats['areaDiff'] += 1
        except Exception as e:
            if str(e) != 'incoherente': print('geom error', r['id'], e, file=sys.stderr)
            for k in ('ll', 'poly', 'loc', 'nMatch'): rec.pop(k, None)
    if 'll' not in rec:
        d = find_dist_by_name(rec['prov'], r.get('distritoTxt'), r.get('cantonTxt'))
        if d:
            c = d['geom'].representative_point()
            rec['ll'] = [round(c.x, 5), round(c.y, 5)]
            rec['loc'] = 'distrito'
            stats['distrito'] += 1
        else:
            rec['loc'] = None
            stats['sin'] += 1
    if d:
        rec['dc'] = d['c']; rec['dn'] = d['d']; rec['cn'] = d['k']
    else:
        rec['dn'] = (r.get('distritoTxt') or '').title() or None
        rec['cn'] = (r.get('cantonTxt') or '').title() or None
    rec['pn'] = PROV_NAME.get(rec['prov'])
    out.append({k: v for k, v in rec.items() if v not in (None, [], '')})

print(stats, 'total', len(out))
json.dump(out, open('remates.json', 'w'), ensure_ascii=False, separators=(',', ':'))

# Distritos simplificados para el fondo (solo contorno, ~100 m de tolerancia), GeoJSON compacto
feats = []
for d in dists:
    g = d['geom'].simplify(0.0012, preserve_topology=True)
    polys = g.geoms if g.geom_type == 'MultiPolygon' else [g]
    coords = [[[[round(x, 4), round(y, 4)] for x, y in p.exterior.coords]] for p in polys if p.area > 1e-6]
    if coords:
        feats.append({'type': 'Feature', 'properties': {'c': d['c'], 'd': d['d'], 'k': d['k']}, 'geometry': {'type': 'MultiPolygon', 'coordinates': coords}})
json.dump({'type': 'FeatureCollection', 'features': feats}, open('distritos.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
import os
print('remates.json', os.path.getsize('remates.json'), 'distritos.geojson', os.path.getsize('distritos.geojson'))
