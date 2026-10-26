"""Zonas homogeneas (Hacienda), cobertura de agua (AyA/ASADAS/ESPH/municipal), fecha de publicacion y nivel PECR."""
import json, statistics as st, datetime as dt, collections
SITE='/home/claude/remates-catastro/data/'; UP='/mnt/user-data/uploads/Downloads/'
R=json.load(open(SITE+'remates.json')); ZH=json.load(open(UP+'zh_remates.json')); AG=json.load(open(UP+'agua_remates.json'))
E=json.load(open(UP+'edictos_fincas_2026.json')); M={'ene':1,'feb':2,'mar':3,'abr':4,'may':5,'jun':6,'jul':7,'ago':8,'set':9,'sep':9,'oct':10,'nov':11,'dic':12,'jan':1,'apr':4,'aug':8,'dec':12}
def pd(s):
    d,m,y=s.split('-'); return dt.date(int(y),M[m.lower()[:3]],int(d)).isoformat()
BD={b['n']: pd(b['date']) for b in E}
TC=456.32
def nivel(r):
    e=r.get('ent') or {}; z=e.get('zh') or {}; k=z.get('k',''); tg=r.get('tg',[])
    urb = e.get('cob')=='Zona urbana' or 'urbano' in tg
    frente = 'frente' in tg or (e.get('via') and e['via']['d']<=10)
    agua = bool(e.get('aguaS'))
    sal = (e.get('salud') or {}).get('d', 99999); esc = e.get('esc') or 99999
    via = e.get('via'); vt = (via or {}).get('t','').lower(); vd=(via or {}).get('d', 9999)
    serv = any('paso' in s.lower() for s in (r.get('serv') or []))
    if k=='U' and urb and frente and agua: return 8
    if (k=='U' or urb) and (sal<=3000 or esc<=1000): return 7
    if agua and frente and (r.get('area') or 0) <= 5000: return 6
    if agua and frente: return 5
    if frente and sal<=6000: return 4
    if frente: return 3
    if serv or 'vereda' in vt or 'lastre' in vt or vd<=200: return 2
    return 1
RANGOS={1:(1,5),2:(3,10),3:(8,20),4:(12,30),5:(20,50),6:(35,85),7:(50,150),8:(80,500)}
for r in R:
    e=r.setdefault('ent',{}); i=str(r['id'])
    if ZH.get(i): e['zh']=ZH[i]
    if AG.get(i): e['aguaS']=sorted({a['t'] for a in AG[i]})
    b=min(r.get('bols') or [r.get('bol')]); 
    if b in BD: r['pubF']=BD[b]
import math
def nivel_valor(usd):
    return min(RANGOS, key=lambda n: abs(math.log(usd/math.sqrt(RANGOS[n][0]*RANGOS[n][1]))))
for r in R:
    if not r.get('ll'): continue
    a=nivel(r); z=(r.get('ent') or {}).get('zh')
    if z and z.get('v'):
        b=nivel_valor(z['v']/TC); f=round(0.4*a+0.6*b)
        r['pecr']=max(1,min(8,f)); r['pecrA']=a; r['pecrV']=b
    else: r['pecr']=a
# calibracion: valor de Hacienda en US$/m2 por nivel
by=collections.defaultdict(list)
for r in R:
    z=(r.get('ent') or {}).get('zh')
    if z and r.get('pecr'): by[r['pecr']].append(z['v']/TC)
for n in sorted(by):
    v=sorted(by[n]); lo,hi=RANGOS[n]
    inr=sum(lo<=x<=hi for x in v)/len(v)
    print(n, len(v), 'mediana US$/m2 %.1f'%st.median(v), 'p25 %.1f p75 %.1f'%(v[len(v)//4], v[3*len(v)//4]), 'en rango %d%%'%(inr*100))
print(collections.Counter(r.get('pecr') for r in R))
print('pubF', collections.Counter(r.get('pubF','')[:7] for r in R))
json.dump(R,open(SITE+'remates.json','w'),ensure_ascii=False,separators=(',',':'))
