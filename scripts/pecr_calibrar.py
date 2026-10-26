"""Recalcula la escala PECR (10 niveles) de data/remates.json con rangos contiguos (sin traslape, desde 0).
Nivel = rango donde cae el valor de zona homogénea de Hacienda (US$/m²); las reglas del sitio (pecrA)
lo mueven un nivel solo si difieren en 3 o más. Debe coincidir con PX.pecrCalc en assets/core.js."""
import json, bisect, sys
DATA = sys.argv[1] if len(sys.argv) > 1 else 'data/remates.json'
META = json.load(open('data/meta.json'))
TC = META['tc']['venta']
LIMITES = [4, 8, 15, 25, 40, 70, 120, 200, 350]   # inicio de los niveles 2 a 10 (US$/m²)

def nivel_valor(usd): return bisect.bisect_right(LIMITES, usd) + 1

R = json.load(open(DATA))
N = len(LIMITES) + 1
dist, dentro, n = [0] * N, 0, 0
for r in R:
    z = (r.get('ent') or {}).get('zh') or {}
    a = r.get('pecrA')
    if not z.get('v'):
        # Sin valor de Hacienda (lote sin ubicar en el catastro): no se asigna nivel para no mostrar uno engañoso
        for k in ('pecr', 'pecrV'): r.pop(k, None)
        continue
    usd = z['v'] / TC
    v = nivel_valor(usd)
    a10 = 9 if a == 8 else a          # reglas en escala de 8: su 8 (urbano consolidado) es el 9 de la escala de 10
    f = v if not a else max(1, min(N, v + (1 if a10 - v >= 3 else -1 if v - a10 >= 3 else 0)))
    r['pecrV'], r['pecr'] = v, f
    dist[f - 1] += 1; n += 1
    lo = ([0] + LIMITES)[f - 1]; hi = (LIMITES + [float('inf')])[f - 1]
    dentro += lo <= usd < hi
json.dump(R, open(DATA, 'w'), ensure_ascii=False, separators=(',', ':'))
print('lotes por nivel', dist, '| valor de Hacienda dentro del rango de su nivel: %d %%' % round(dentro / n * 100))
