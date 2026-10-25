"""Nombre corto, barrio y atributos de cada lote; capas de cantones y zonas de vida para el sitio."""
import json, re, unicodedata
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
from shapely.ops import unary_union

SITE = '/home/claude/remates-catastro/data/'
R = json.load(open('remates.json'))

def norm(s): return unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().lower()
def title(s):
    small = {'de', 'del', 'la', 'las', 'los', 'el', 'y', 'en'}
    w = re.sub(r'\s+', ' ', s.strip()).lower().split(' ')
    return ' '.join(x if (i and x in small) else x[:1].upper() + x[1:] for i, x in enumerate(w))

BARRIO = re.compile(r'\b(urbanizaci[oó]n|residencial|condominio|barrio|caser[ií]o|lotificaci[oó]n|proyecto habitacional|ciudadela)\s+(?:denominad[oa]\s+|llamad[oa]\s+)?["“]?([A-ZÁÉÍÓÚÑ0-9][A-Za-zÁÉÍÓÚÑáéíóúñ0-9 \-]{2,40})', re.I)
CORTE = re.compile(r'\s+(situad|ubicad|lote|distrito|cant[oó]n|provincia|finca|filial|n[uú]mero|mide|linder|colind|con un|de la|que|segun|según)\b.*$', re.I)

def barrio(txt):
    m = BARRIO.search(txt or '')
    if not m: return None
    tipo, nombre = m.group(1), CORTE.sub('', m.group(2)).strip(' -"”')
    if len(nombre) < 3 or nombre.lower() in ('sin nombre', 'numero', 'número'): return None
    pref = {'urbanizacion': 'Urb.', 'urbanización': 'Urb.', 'residencial': 'Res.', 'condominio': 'Cond.', 'barrio': 'B°', 'caserio': 'Caserío', 'caserío': 'Caserío'}.get(tipo.lower(), title(tipo))
    return f'{pref} {title(nombre)}'[:44]

def base_nom(r):
    n = norm(r.get('nat'))
    m = re.search(r'\blote\s+(?:n[°o.]*\s*|numero\s+)?([0-9]{1,4}[a-z]?(?:-[a-z0-9]{1,3})?)\b', n)
    f = re.search(r'filial\s+(?:n[°o.]*\s*|numero\s+|primaria\s+individualizada\s+(?:numero\s+)?)?([0-9]{1,4})', n)
    if r.get('tipo') == 'Filial' or f:
        return f'Filial {f.group(1)}' if f else 'Filial'
    if 'local comercial' in n: return 'Local comercial'
    if 'bodega' in n: return 'Bodega'
    if re.search(r'\bcasa|habitaci', n): return f'Casa, lote {m.group(1).upper()}' if m else 'Casa'
    if r.get('tipo') == 'Agrícola': return 'Finca agrícola'
    return f'Lote {m.group(1).upper()}' if m else 'Lote'

stats = {'barrio': 0, 'frente': 0, 'plano': 0}
for r in R:
    txt = r.get('txt') or ''
    b = barrio(txt)
    if b: r['bar'] = b; stats['barrio'] += 1
    lugar = b or r.get('dn') or r.get('cn') or r.get('pn') or ''
    r['nom'] = f"{base_nom(r)} · {lugar}" if lugar else base_nom(r)
    e = r.get('ent') or {}
    t = []
    nt = norm(txt)
    if re.search(r'calle publica|camino publico|via publica|servidumbre de paso', nt) and 'calle publica' in nt or (e.get('via') and e['via']['d'] <= 10):
        t.append('frente'); stats['frente'] += 1
    if e.get('suave') or (e.get('pend') is not None and e['pend'] < 10):
        t.append('plano'); stats['plano'] += 1
    if r.get('tipo') == 'Con construcción': t.append('constr')
    if e.get('cob') == 'Zona urbana': t.append('urbano')
    if r.get('area') and r['area'] >= 1000: t.append('grande')
    if not r.get('serv'): t.append('sinserv')
    if e.get('agua') is not None and e['agua'] <= 50: t.append('agua')
    if e.get('cob') == 'Cobertura forestal': t.append('bosque')
    r['tg'] = t

print(stats, len(R))
for r in R[:12]: print(r['id'], '|', r['nom'], '|', r['tg'])
json.dump(R, open(SITE + 'remates.json', 'w'), ensure_ascii=False, separators=(',', ':'))

# Cantones a partir de distritos (código distrito = provincia*10000 + cantón*100 + distrito)
D = json.load(open(SITE + 'distritos.geojson'))
groups = {}
for f in D['features']:
    c = f['properties']['c'] // 100
    groups.setdefault(c, {'k': f['properties']['k'], 'g': []})['g'].append(shape(f['geometry']).buffer(0))
feats = []
for c, v in groups.items():
    u = unary_union(v['g']).buffer(0.0004).buffer(-0.0004).simplify(0.0012, preserve_topology=True)
    polys = u.geoms if u.geom_type == 'MultiPolygon' else [u]
    feats.append({'type': 'Feature', 'properties': {'c': c, 'k': v['k']}, 'geometry': {'type': 'MultiPolygon', 'coordinates': [[[[round(x, 4), round(y, 4)] for x, y in p.exterior.coords]] for p in polys if p.area > 1e-6]}})
json.dump({'type': 'FeatureCollection', 'features': feats}, open(SITE + 'cantones.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
print('cantones', len(feats))

# Zonas de vida
zc = json.load(open('/mnt/user-data/uploads/Downloads/zonasvida_cuencas.json'))
zf = []
for x in zc['zv']:
    try:
        g = MultiPolygon([Polygon(pl[0], pl[1:]) for pl in x['g']]).buffer(0).simplify(0.002, preserve_topology=True)
    except Exception:
        continue
    if g.is_empty: continue
    polys = g.geoms if g.geom_type == 'MultiPolygon' else [g]
    zf.append({'type': 'Feature', 'properties': {'n': x['n'].capitalize()}, 'geometry': {'type': 'MultiPolygon', 'coordinates': [[[[round(a, 4), round(b, 4)] for a, b in p.exterior.coords]] for p in polys if p.area > 2e-6]}})
zf = [f for f in zf if f['geometry']['coordinates']]
json.dump({'type': 'FeatureCollection', 'features': zf}, open(SITE + 'zonasvida.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
import os
print('zonas de vida', len(zf), sorted({f['properties']['n'] for f in zf}), os.path.getsize(SITE + 'zonasvida.geojson'), os.path.getsize(SITE + 'cantones.geojson'))
