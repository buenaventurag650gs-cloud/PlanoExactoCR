"""Actualización diaria de PlanoExactoCR.

1. Busca en Nexus (Poder Judicial) los Boletines Judiciales publicados después del último procesado.
2. Extrae los edictos de remate de fincas (scripts/extractor.js) y los une con data/remates.json:
   - remate nuevo: se agrega, ubicado por distrito mientras no haya resultado del catastro;
   - remate republicado o reprogramado: se actualizan fechas, base y gravámenes;
   - remate vencido (pasó su última fecha): se elimina.
3. Aplica los resultados del catastro (data/catastro_resultados.json), que se obtienen desde una
   conexión en Costa Rica porque el SNIT no responde a servidores de otros países.
4. Completa el entorno de los lotes nuevos o reubicados: plan regulador, salud, escuela, costa,
   zona de vida, cuenca, zona homogénea de Hacienda, agua potable (AyA), uso del suelo (MINAE),
   nombre corto, atributos, escala PECR e índice.
5. Escribe data/pendientes.json (lotes que faltan en el catastro), data/estado.json y data/meta.json.

Uso:  python3 scripts/actualizar.py              (en GitHub Actions)
      python3 scripts/actualizar.py --sin-red    (sin consultas externas; para pruebas)
      python3 scripts/actualizar.py --nexus archivo.json   (boletín ya descargado)
"""
import argparse, datetime as dt, html as htmlmod, json, os, re, subprocess, sys, unicodedata
from html.parser import HTMLParser

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
DATA = os.path.join(RAIZ, 'data')
REF = os.path.join(AQUI, 'ref')
NEXUS = 'https://nexuspj.poder-judicial.go.cr'
UA = {'user-agent': 'PlanoExactoCR/1.0 (actualizacion diaria)'}
MES = {'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'ago': 8, 'set': 9, 'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12,
       'jan': 1, 'apr': 4, 'aug': 8, 'dec': 12}
PROV_NAME = {1: 'San José', 2: 'Alajuela', 3: 'Cartago', 4: 'Heredia', 5: 'Guanacaste', 6: 'Puntarenas', 7: 'Limón'}


def leer(nombre, defecto=None):
    p = os.path.join(DATA, nombre)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else defecto


def escribir(nombre, obj):
    json.dump(obj, open(os.path.join(DATA, nombre), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))


def norm(s):
    return unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().lower()


def fecha_iso(s):
    d, m, y = s.split('-')
    return dt.date(int(y), MES[m.lower()[:3]], int(d)).isoformat()


# ---------------------------------------------------------------- 1. Boletines desde Nexus
class Parrafos(HTMLParser):
    def __init__(self):
        super().__init__(); self.ps, self.cur, self.dentro = [], [], 0
    def handle_starttag(self, tag, attrs):
        if tag == 'p': self.dentro += 1; self.cur = []
    def handle_endtag(self, tag):
        if tag == 'p' and self.dentro:
            self.dentro -= 1
            t = re.sub(r'\s+', ' ', ''.join(self.cur)).strip()
            if t: self.ps.append(t)
    def handle_data(self, data):
        if self.dentro: self.cur.append(data)


def texto_de_html(h):
    p = Parrafos(); p.feed(h)
    return '\n'.join(p.ps)


def boletines_nuevos(ultimo, http):
    """Lista de boletines posteriores a `ultimo`: [{n, date, id}] en orden ascendente."""
    body = {'q': 'tipoInformacion:(Boletín AND Judicial) ', 'advanced': True, 'facets': '', 'size': 15, 'page': 1,
            'sort': {'field': 'fechaPublicacion', 'order': 'desc'}, 'exp': '', 'isFav': False, 'isCart': False}
    j = http.post(NEXUS + '/api/search', json=body, headers=UA, timeout=60).json()
    out = [{'n': int(h['numeroDocumento']), 'date': h['date'], 'id': h['idDocument']} for h in j.get('hits', [])
           if str(h.get('numeroDocumento', '')).isdigit()]
    # El número reinicia cada año (n.º 1 en diciembre); se procesan solo los mayores al último.
    return sorted([b for b in out if b['n'] > ultimo], key=lambda b: b['n'])


def descargar_boletin(b, http):
    j = http.post(NEXUS + '/api/document', json={'id': b['id']}, headers=UA, timeout=120).json()
    return texto_de_html(j['hits']['html'])


def extraer(boletines):
    """Ejecuta el extractor (Node) sobre [{n, date, texto}]."""
    if not boletines: return []
    r = subprocess.run(['node', os.path.join(AQUI, 'extraer_boletin.js')], input=json.dumps(boletines), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


# ---------------------------------------------------------------- 2. Unión con remates.json
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
    """Quita del texto el nombre del deudor, cédulas y la firma; recorta notas de trámite."""
    if not t: return t
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'(\bcontra\b)\s+.*?(?=\s*(EXP\b|Exp\b|EXPEDIENTE|Expediente|exp\.|\.\s|$))', r'\1 [deudor omitido]', t, flags=re.S)
    t = re.sub(r'\b\d-\d{3,4}-\d{3,4}\b', '[cédula omitida]', t)
    t = re.sub(r'\b(c[ée]dula( de identidad)?( n[úu]mero)?:?)\s*[\d\-\s]{9,14}', r'\1 [omitida]', t, flags=re.I)
    t = re.sub(r'NOTAS:.*?(?=Se remata|$)', '', t, flags=re.S)
    t = re.sub(r'\s*Hora y fecha de emisi[óo]n.*$', '', t, flags=re.S | re.I)
    t = re.sub(r'(JUDICIAL[^.]{0,80}\.)\s.*$', r'\1', t) if 'Se remata' in t else t
    return t.strip()[:3000]


def clave(prov, finca, der):
    return f"{prov or ''}|{finca}|{der or ''}"


def campos_edicto(x):
    return {
        'base': x.get('base'), 'mon': x.get('moneda') or 'CRC', 'f': x.get('fechas') or [], 'area': x.get('area') or None,
        'nat': clean_nat(x.get('naturaleza')), 'grav': (x.get('gravamenes') or '')[:400] or None, 'serv': x.get('servidumbres') or [],
        'proc': x.get('proceso'), 'exp': x.get('expediente'), 'juz': x.get('juzgado'), 'bol': x['boletin'], 'ref': x.get('referencia'),
        'txt': redact(x.get('texto')), 'plano': x.get('plano'),
    }


def unir(R, recs, fechas_bol):
    por_clave = {clave(r.get('prov'), r.get('finca'), r.get('der')): r for r in R}
    sig_id = max([r['id'] for r in R] + [0]) + 1
    nuevos, actualizados = [], 0
    for x in sorted(recs, key=lambda x: x['boletin']):
        k = clave(x.get('provincia'), x['finca'], x.get('derecho'))
        r = por_clave.get(k)
        if r:
            r['bols'] = sorted(set((r.get('bols') or [r.get('bol')]) + [x['boletin']]))
            if x['boletin'] > (r.get('bol') or 0) and x.get('fechas'):
                for c, v in campos_edicto(x).items():
                    if v not in (None, [], ''): r[c] = v
                actualizados += 1
            continue
        if not x.get('fechas'): continue
        r = {'id': sig_id, 'prov': x.get('provincia'), 'finca': x['finca'], 'der': x.get('derecho'), 'filial': bool(x.get('filial')),
             'multi': bool(x.get('multiple')), 'bols': [x['boletin']], 'pubF': fechas_bol.get(x['boletin'])}
        r.update(campos_edicto(x))
        r['tipo'] = tipo(r['nat'], r['filial'], r['area'])
        r['_dtxt'], r['_ktxt'], r['_planoSnit'] = x.get('distritoTxt'), x.get('cantonTxt'), x.get('planoSnit')
        sig_id += 1
        R.append(r); por_clave[k] = r; nuevos.append(r)
    return nuevos, actualizados


# ---------------------------------------------------------------- 3. Geometría y catastro
from shapely.geometry import Point, Polygon, MultiPolygon, LineString, MultiLineString, shape
from shapely.ops import transform as stransform
from shapely.strtree import STRtree
from pyproj import Transformer

a_wgs = Transformer.from_crs('EPSG:8908', 'EPSG:4326', always_xy=True).transform
a_m = Transformer.from_crs('EPSG:4326', 'EPSG:5367', always_xy=True).transform
P = lambda g: stransform(a_m, g)


def dec(ring):
    pts = [(ring[0], ring[1])]
    for i in range(2, len(ring), 2): pts.append((pts[-1][0] + ring[i], pts[-1][1] + ring[i + 1]))
    return [(x / 1000, y / 1000) for x, y in pts]


DIST = []
for d in json.load(open(os.path.join(REF, 'distritos_ign.json'))):
    polys = []
    for pl in d['g']:
        rings = [dec(r) for r in pl]
        try:
            p = Polygon(rings[0], rings[1:]).buffer(0)
            if not p.is_empty: polys.extend(p.geoms if p.geom_type == 'MultiPolygon' else [p])
        except Exception:
            pass
    if polys: DIST.append({'c': d['c'], 'd': d['d'], 'k': d['k'], 'geom': MultiPolygon(polys)})


def dist_por_punto(pt):
    return next((d for d in DIST if d['geom'].contains(pt)), None)


def dist_por_nombre(prov, dtxt, ktxt):
    if not dtxt: return None
    nn = lambda s: re.sub(r'[^a-z ]', '', norm(s)).strip()
    cands = [d for d in DIST if str(d['c'])[0] == str(prov)]
    nd, nk = nn(dtxt), nn(ktxt)
    ex = [d for d in cands if nn(d['d']) == nd and (not nk or nn(d['k']) == nk)] or [d for d in cands if nn(d['d']) == nd]
    if len(ex) >= 1 and (nk or len(ex) == 1): return ex[0]
    loose = [d for d in cands if nd and (nd in nn(d['d']) or nn(d['d']) in nd) and (not nk or nn(d['k']) == nk)]
    return loose[0] if loose else None


def ubicar_por_distrito(r):
    d = dist_por_nombre(r.get('prov'), r.get('_dtxt'), r.get('_ktxt'))
    if d:
        c = d['geom'].representative_point()
        r['ll'] = [round(c.x, 5), round(c.y, 5)]; r['loc'] = 'distrito'
        r['dc'], r['dn'], r['cn'] = d['c'], d['d'], d['k']
    else:
        r['loc'] = None
        r['dn'] = (r.get('_dtxt') or '').title() or None; r['cn'] = (r.get('_ktxt') or '').title() or None
    r['pn'] = PROV_NAME.get(r.get('prov'))


def aplicar_catastro(r, res):
    """res: {via: 'plano'|'finca', feats: [features GeoJSON del SNIT en CRTM05]}. Devuelve True si quedó exacta."""
    feats = [f for f in (res or {}).get('feats') or [] if f.get('geometry')]
    if not feats: return False
    f = max(feats, key=lambda f: (f.get('properties') or {}).get('shape_area') or 0)
    try:
        gw = stransform(a_wgs, shape(f['geometry']).buffer(0))
    except Exception:
        return False
    c = gw.representative_point()
    d = dist_por_punto(Point(c.x, c.y))
    kt, kc = re.sub(r'[^a-z]', '', norm(r.get('_ktxt') or r.get('cn'))), re.sub(r'[^a-z]', '', norm(d['k'] if d else ''))
    coherente = (not kt) or (not kc) or kt in kc or kc in kt or (kt == 'grecia' and kc == 'riocuarto') or kt.replace('s', 'z') == kc.replace('s', 'z')
    if not coherente or (res['via'] == 'finca' and r.get('filial')):
        r['rev'] = ('El catastro devolvió un predio en %s, que no coincide con el edicto.' % (d['k'] if d else 'otro cantón')) if not coherente \
            else 'Filial de condominio: se ubica por distrito hasta verificar la matrícula.'
        return False
    polys = gw.geoms if gw.geom_type == 'MultiPolygon' else [gw]
    r['ll'] = [round(c.x, 6), round(c.y, 6)]
    r['poly'] = [[[[round(x, 6), round(y, 6)] for x, y in p.exterior.coords]] for p in polys]
    pr = f.get('properties') or {}
    r['areaCat'] = round(pr['shape_area'], 2) if pr.get('shape_area') else None
    r['planoCat'] = pr.get('plano'); r['loc'] = res['via']; r['nMatch'] = len(feats)
    if d: r['dc'], r['dn'], r['cn'] = d['c'], d['d'], d['k']
    r['pn'] = PROV_NAME.get(r.get('prov')); r.pop('rev', None)
    return True


# ---------------------------------------------------------------- 4. Entorno
SALUD = leer('salud.json', [])
IGN = json.load(open(os.path.join(REF, 'ign_puntos_costa.json')))
ZC = json.load(open(os.path.join(REF, 'zonasvida_cuencas.json')))
PLANES = leer('planes_reguladores.geojson', {'features': []})
sal_pts = [P(Point(*s['ll'])) for s in SALUD]; sal_t = STRtree(sal_pts)
esc_raw = [p for p in IGN['pts'] if p[0].lower().startswith(('escuela', 'colegio', 'liceo'))]
esc_pts = [P(Point(p[1], p[2])) for p in esc_raw]; esc_t = STRtree(esc_pts)
COSTA = P(MultiLineString([LineString(l) for l in IGN['costa'] if len(l) > 1]))


def capas(lst):
    gs, ns = [], []
    for x in lst:
        try:
            gs.append(MultiPolygon([Polygon(pl[0], pl[1:]) for pl in x['g']]).buffer(0)); ns.append(x['n'])
        except Exception:
            pass
    return gs, ns, STRtree(gs)


ZV, CU = capas(ZC['zv']), capas(ZC['cu'])
PR_G = [shape(f['geometry']).buffer(0) for f in PLANES['features']]; PR_P = [f['properties'] for f in PLANES['features']]
PR_T = STRtree(PR_G) if PR_G else None


def en_capa(c, pt):
    gs, ns, t = c
    return next((ns[i] for i in t.query(pt) if gs[i].contains(pt)), None)


def consultar(http, url, params, timeout=40):
    try:
        r = http.get(url, params=params, headers=UA, timeout=timeout)
        return r.json() if r.ok else None
    except Exception:
        return None


def zona_homogenea(http, lon, lat):
    j = consultar(http, 'https://sig.hacienda.go.cr/server/rest/services/Zonas_Homogeneas_ONT/MapServer/0/query',
                  {'geometry': f'{lon},{lat}', 'geometryType': 'esriGeometryPoint', 'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects',
                   'outFields': 'VALOR,COD_ZONAH,NOMBRE_ZONAH,TIPO_DE_USO,CATEGORIZADA', 'returnGeometry': 'false', 'f': 'json'})
    f = j and j.get('features') and j['features'][0]['attributes']
    if not f or not f.get('VALOR'): return None
    return {'v': f['VALOR'], 'c': f.get('COD_ZONAH'), 'n': f.get('NOMBRE_ZONAH'), 'u': f.get('TIPO_DE_USO'), 'k': f.get('CATEGORIZADA')}


AGUA_T = {0: 'AyA', 1: 'ESPH', 2: 'ASADA', 3: 'Municipal'}


def agua(http, lon, lat):
    e = 0.002
    j = consultar(http, 'https://gis.aya.go.cr/server/rest/services/Web/Coberturas_AyA_ASADAS_Muni/MapServer/identify',
                  {'geometry': f'{lon},{lat}', 'geometryType': 'esriGeometryPoint', 'sr': 4326, 'layers': 'all:0,1,2,3', 'tolerance': 0,
                   'mapExtent': f'{lon - e},{lat - e},{lon + e},{lat + e}', 'imageDisplay': '400,400,96', 'returnGeometry': 'false', 'f': 'json'})
    if j is None: return None
    return sorted({AGUA_T.get(x.get('layerId')) for x in j.get('results', []) if x.get('layerId') in AGUA_T})


def cobertura(http, lon, lat):
    e = 0.0005
    j = consultar(http, 'https://geodatos.sinia.go.cr/geoserver/MAF2020/wms',
                  {'service': 'WMS', 'version': '1.1.1', 'request': 'GetFeatureInfo', 'layers': 'MAF2020', 'query_layers': 'MAF2020', 'srs': 'EPSG:4326',
                   'bbox': f'{lon - e},{lat - e},{lon + e},{lat + e}', 'width': 11, 'height': 11, 'x': 5, 'y': 5, 'info_format': 'application/json', 'feature_count': 1})
    f = j and j.get('features') and j['features'][0]
    return f['properties'].get('CATEGORIA') if f else None


def entorno(r, http):
    lon, lat = r['ll']
    pt = Point(lon, lat)
    exacta = r.get('loc') in ('plano', 'finca') and r.get('poly')
    g = MultiPolygon([Polygon(p[0]) for p in r['poly']]).buffer(0) if exacta else pt
    gm = P(g)
    e = {}
    if PR_T is not None:
        for i in PR_T.query(pt):
            if PR_G[i].contains(pt):
                p = PR_P[i]
                e['pr'] = {k: v for k, v in {'si': bool(p.get('si')), 'anno': p.get('anno'), 'escala': p.get('escala'), 'pub': p.get('pub'),
                                             'cat': p.get('cat'), 'canton': p.get('canton')}.items() if v not in (None, '')}
                break
    if SALUD:
        i = sal_t.nearest(gm); s = SALUD[i]
        e['salud'] = {'n': s['n'], 'c': s['c'], 'd': round(gm.distance(sal_pts[i])), 'll': s['ll']}
    i = esc_t.nearest(gm)
    e['esc'] = round(gm.distance(esc_pts[i])); e['escP'] = {'t': esc_raw[i][0].capitalize(), 'll': [esc_raw[i][1], esc_raw[i][2]]}
    zv = en_capa(ZV, pt)
    if zv: e['zv'] = zv.capitalize()
    cu = en_capa(CU, pt)
    if cu: e['cu'] = cu
    if exacta:
        dc = gm.distance(COSTA)
        if dc < 5000: e['costa'] = round(dc)
        if http:
            z = zona_homogenea(http, lon, lat)
            if z: e['zh'] = z
            a = agua(http, lon, lat)
            if a: e['aguaS'] = a
            c = cobertura(http, lon, lat)
            if c: e['cob'] = c
    r['ent'] = e


# ---------------------------------------------------------------- 5. Nombre, atributos y escalas
BARRIO = re.compile(r'\b(urbanizaci[oó]n|residencial|condominio|barrio|caser[ií]o|lotificaci[oó]n|proyecto habitacional|ciudadela)\s+(?:denominad[oa]\s+|llamad[oa]\s+)?["“]?([A-ZÁÉÍÓÚÑ0-9][A-Za-zÁÉÍÓÚÑáéíóúñ0-9 \-]{2,40})', re.I)
CORTE = re.compile(r'\s+(situad|ubicad|lote|distrito|cant[oó]n|provincia|finca|filial|n[uú]mero|mide|linder|colind|con un|de la|que|segun|según)\b.*$', re.I)


def titulo(s):
    small = {'de', 'del', 'la', 'las', 'los', 'el', 'y', 'en'}
    w = re.sub(r'\s+', ' ', s.strip()).lower().split(' ')
    return ' '.join(x if (i and x in small) else x[:1].upper() + x[1:] for i, x in enumerate(w))


def barrio(txt):
    m = BARRIO.search(txt or '')
    if not m: return None
    t, nombre = m.group(1), CORTE.sub('', m.group(2)).strip(' -"”')
    if len(nombre) < 3 or nombre.lower() in ('sin nombre', 'numero', 'número'): return None
    pref = {'urbanizacion': 'Urb.', 'urbanización': 'Urb.', 'residencial': 'Res.', 'condominio': 'Cond.', 'barrio': 'B°', 'caserio': 'Caserío', 'caserío': 'Caserío'}.get(t.lower(), titulo(t))
    return f'{pref} {titulo(nombre)}'[:44]


def base_nom(r):
    n = norm(r.get('nat'))
    m = re.search(r'\blote\s+(?:n[°o.]*\s*|numero\s+)?([0-9]{1,4}[a-z]?(?:-[a-z0-9]{1,3})?)\b', n)
    f = re.search(r'filial\s+(?:n[°o.]*\s*|numero\s+|primaria\s+individualizada\s+(?:numero\s+)?)?([0-9]{1,4})', n)
    if r.get('tipo') == 'Filial' or f: return f'Filial {f.group(1)}' if f else 'Filial'
    if 'local comercial' in n: return 'Local comercial'
    if 'bodega' in n: return 'Bodega'
    if re.search(r'\bcasa|habitaci', n): return f'Casa, lote {m.group(1).upper()}' if m else 'Casa'
    if r.get('tipo') == 'Agrícola': return 'Finca agrícola'
    return f'Lote {m.group(1).upper()}' if m else 'Lote'


def atributos(r):
    txt = r.get('txt') or ''
    b = barrio(txt)
    if b: r['bar'] = b
    lugar = b or r.get('dn') or r.get('cn') or r.get('pn') or ''
    r['nom'] = f"{base_nom(r)} · {lugar}" if lugar else base_nom(r)
    e, nt, t = r.get('ent') or {}, norm(txt), []
    if 'calle publica' in nt or (e.get('via') and e['via']['d'] <= 10): t.append('frente')
    if e.get('suave') or (e.get('pend') is not None and e['pend'] < 10): t.append('plano')
    if r.get('tipo') == 'Con construcción': t.append('constr')
    if e.get('cob') == 'Zona urbana': t.append('urbano')
    if r.get('area') and r['area'] >= 1000: t.append('grande')
    if not r.get('serv'): t.append('sinserv')
    if e.get('cob') == 'Cobertura forestal': t.append('bosque')
    r['tg'] = t


def nivel_reglas(r):
    """Nivel por reglas del sitio, en escala de 8 (como en enrich2.py)."""
    e = r.get('ent') or {}; z = e.get('zh') or {}; k = z.get('k', ''); tg = r.get('tg', [])
    urb = e.get('cob') == 'Zona urbana' or 'urbano' in tg
    frente = 'frente' in tg or (e.get('via') and e['via']['d'] <= 10)
    ag = bool(e.get('aguaS'))
    sal = (e.get('salud') or {}).get('d', 99999); esc = e.get('esc') or 99999
    serv = any('paso' in s.lower() for s in (r.get('serv') or []))
    if k == 'U' and urb and frente and ag: return 8
    if (k == 'U' or urb) and (sal <= 3000 or esc <= 1000): return 7
    if ag and frente and (r.get('area') or 0) <= 5000: return 6
    if ag and frente: return 5
    if frente and sal <= 6000: return 4
    if frente: return 3
    if serv: return 2
    return 1


PLANO_PROV = {'sj': 1, 'a': 2, 'c': 3, 'h': 4, 'g': 5, 'p': 6, 'l': 7}


def plano_snit(p):
    """'P-1311611-2008' -> '613116112008' (formato del catastro)."""
    m = re.match(r'\s*(sj|[achgpl])\s*-\s*(\d{1,8})\s*-\s*(\d{4})', (p or '').lower())
    return f"{PLANO_PROV[m.group(1)]}{m.group(2).lstrip('0').zfill(7)}{m.group(3)}" if m else None


# ---------------------------------------------------------------- Programa principal
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--nexus', help='JSON con boletines ya descargados: [{n, date, html|texto}] o el formato {documento:{hits:{...}}}')
    ap.add_argument('--sin-red', action='store_true', help='no consultar servicios externos')
    ap.add_argument('--hoy', default=dt.datetime.now(dt.timezone(dt.timedelta(hours=-6))).strftime('%Y-%m-%dT%H:%M'))
    a = ap.parse_args()
    import requests
    http = None if a.sin_red else requests.Session()

    R = leer('remates.json', [])
    estado = leer('estado.json', {'ultimo_boletin': 201})
    cat = leer('catastro_resultados.json', {})
    resumen = {'boletines': [], 'nuevos': 0, 'actualizados': 0, 'vencidos': 0, 'ubicados_catastro': 0, 'pendientes': 0}

    # 1. Boletines
    bols = []
    if a.nexus:
        src = json.load(open(a.nexus, encoding='utf-8'))
        docs = [src['documento']['hits']] if isinstance(src, dict) and 'documento' in src else src
        for h in docs:
            n = int(h.get('numeroDocumento') or h.get('n'))
            if n <= estado['ultimo_boletin']: continue
            fecha = h.get('date') or dt.date.fromisoformat(h['fecha']).strftime('%d-%b-%Y')
            bols.append({'n': n, 'date': fecha, 'texto': h.get('texto') or texto_de_html(h['html'])})
    elif http:
        for b in boletines_nuevos(estado['ultimo_boletin'], http):
            bols.append({'n': b['n'], 'date': b['date'], 'texto': descargar_boletin(b, http)})
    fechas_bol = {}
    for b in bols:
        try: fechas_bol[b['n']] = fecha_iso(b['date'])
        except Exception: pass
    recs = extraer(bols)
    nuevos, act = unir(R, recs, fechas_bol)
    resumen.update(boletines=[b['n'] for b in bols], nuevos=len(nuevos), actualizados=act, edictos_fincas=len(recs))
    if bols: estado['ultimo_boletin'] = max(b['n'] for b in bols)

    # 2. Vencidos: la última fecha ya pasó
    vivos = [r for r in R if r.get('f') and r['f'][-1] >= a.hoy]
    resumen['vencidos'] = len(R) - len(vivos)
    R = vivos

    # 3. Ubicación: catastro si hay resultado; si no, por distrito
    tocados = list(nuevos)
    for r in R:
        k = clave(r.get('prov'), r.get('finca'), r.get('der'))
        if r.get('loc') in ('plano', 'finca'): continue
        if k in cat and aplicar_catastro(r, cat[k]):
            resumen['ubicados_catastro'] += 1
            if r not in tocados: tocados.append(r)
        elif r in nuevos:
            ubicar_por_distrito(r)

    # 4. Entorno y atributos de los lotes nuevos o reubicados
    for r in tocados:
        if r.get('ll'): entorno(r, http)
        atributos(r)
        a8 = nivel_reglas(r)
        r['pecrA'] = a8
    for r in R:
        for k in ('_dtxt', '_ktxt'): pass  # se conservan para el catastro hasta que el lote quede ubicado
        if r.get('loc') in ('plano', 'finca'):
            for k in ('_dtxt', '_ktxt', '_planoSnit'): r.pop(k, None)
    R = [{k: v for k, v in r.items() if v not in (None, [], '')} for r in R]
    escribir('remates.json', R)

    # Escala PECR con los rangos vigentes (mismo cálculo que el sitio)
    subprocess.run([sys.executable, os.path.join(AQUI, 'pecr_calibrar.py'), os.path.join(DATA, 'remates.json')], cwd=RAIZ, check=True)

    # 5. Pendientes de catastro, estado y metadatos
    pend = []
    for r in leer('remates.json', []):
        if r.get('loc') in ('plano', 'finca'): continue
        k = clave(r.get('prov'), r.get('finca'), r.get('der'))
        if k in cat and cat[k].get('sin_resultado'): continue
        plano = r.get('_planoSnit') or plano_snit(r.get('plano'))
        if r.get('filial') and not plano: continue   # filial sin plano: la matrícula de filial no sirve para buscar en el catastro
        pend.append({'k': k, 'prov': r.get('prov'), 'finca': r.get('finca'), 'der': r.get('der'), 'filial': r.get('filial', False),
                     'plano': plano})
    escribir('pendientes.json', pend)
    resumen['pendientes'] = len(pend)
    estado['actualizado'] = a.hoy
    escribir('estado.json', estado)
    meta = leer('meta.json', {})
    meta['generado'] = a.hoy[:10]
    meta['ultimoBoletin'] = estado['ultimo_boletin']
    escribir('meta.json', meta)
    print(json.dumps(resumen, ensure_ascii=False))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
            f.write('### Actualización PlanoExactoCR\n\n' + '\n'.join(f'- **{k}**: {v}' for k, v in resumen.items()) + '\n')


if __name__ == '__main__':
    main()
