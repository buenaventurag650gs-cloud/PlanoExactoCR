import json
from shapely.geometry import shape, LineString, MultiLineString, mapping
from shapely.ops import unary_union, transform
from pyproj import Transformer
SITE='/home/claude/remates-catastro/data/'; UP='/mnt/user-data/uploads/Downloads/'
f=Transformer.from_crs(4326,5367,always_xy=True).transform; b=Transformer.from_crs(5367,4326,always_xy=True).transform
costa=MultiLineString([LineString(l) for l in json.load(open(UP+'ign_puntos_costa.json'))['costa'] if len(l)>1])
cm=transform(f,costa)
land=unary_union([shape(x['geometry']).buffer(0) for x in json.load(open(SITE+'cantones.geojson'))['features']])
lm=transform(f,land).buffer(30)  # tolerancia por simplificacion de cantones
L50=[];L200=[];lm0=transform(f,land)
for ln in cm.geoms:
    if ln.length<5: continue
    a=ln.buffer(200,single_sided=True); c=ln.buffer(-200,single_sided=True)
    side=200 if a.intersection(lm0).area>=c.intersection(lm0).area else -200
    s50=50 if side>0 else -50
    L50.append(ln.buffer(s50,single_sided=True)); L200.append(ln.buffer(side,single_sided=True))
b50=unary_union(L50); b200=unary_union(L200).difference(b50)
def out(g,t):
    g=transform(b,g.simplify(4))
    gs=[g] if g.geom_type=='Polygon' else [p for p in getattr(g,'geoms',[]) if p.geom_type=='Polygon']
    return {'type':'Feature','properties':{'t':t},'geometry':{'type':'MultiPolygon','coordinates':[[[[round(x,5),round(y,5)] for x,y in p.exterior.coords]]+[[[round(x,5),round(y,5)] for x,y in h.coords] for h in p.interiors] for p in gs if p.area>0]}}
fc={'type':'FeatureCollection','features':[out(b50,'publica'),out(b200,'restringida')]}
json.dump(fc,open(SITE+'zmt.geojson','w'),separators=(',',':'))
inf=json.load(open(UP+'infra_ign.json'))
F=[]
for k,t in (('aeropuertos','Aeropuerto internacional'),('aerodromos','Aeródromo'),('muelles','Puerto')):
    for p in inf[k]:
        if not p.get('n'): continue
        F.append({'type':'Feature','properties':{'n':p['n'],'t':t},'geometry':{'type':'Point','coordinates':p['ll'][:2]}})
json.dump({'type':'FeatureCollection','features':F},open(SITE+'infra.geojson','w'),ensure_ascii=False,separators=(',',':'))
import os; print(os.path.getsize(SITE+'zmt.geojson'), len(F))
