#!/usr/bin/env python3
"""
merge_estados.py — Fusiona data/estados.json con data/remates.json.

Uso:
    python3 scripts/merge_estados.py

Lee  : data/remates.json  (fuente principal, regenerada por el extractor)
       data/estados.json  (mantenida a mano con cambios de estado)
Escribe: data/remates.json  (in-place, con campo 'estado' añadido donde corresponde)

Campos que agrega a cada remate cuando hay un registro en estados.json:
  estado  : "adjudicado" | "desierto" | "suspendido"
  vuelta  : número de vuelta en que ocurrió (int, opcional)
  adjFecha: fecha en formato YYYY-MM-DD (string, opcional)
  adjNota : nota libre (string, opcional)

Los remates sin registro en estados.json no se tocan.
El script es idempotente: se puede correr N veces sin problema.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
REMATES_PATH = ROOT / 'data' / 'remates.json'
ESTADOS_PATH = ROOT / 'data' / 'estados.json'


def main():
    # Leer remates
    with open(REMATES_PATH, encoding='utf-8') as f:
        remates = json.load(f)
    print(f'  Remates cargados: {len(remates)}')

    # Leer estados — filtrar el objeto _comentario/ejemplo si existe
    with open(ESTADOS_PATH, encoding='utf-8') as f:
        raw_estados = json.load(f)

    estados = {}
    skipped = 0
    for entry in raw_estados:
        # Ignorar entradas de ejemplo/comentario (sin campo 'estado' real)
        if '_comentario' in entry or '_ejemplo' in entry:
            skipped += 1
            continue
        ref = str(entry.get('ref', '')).strip()
        if not ref:
            print(f'  AVISO: entrada sin ref ignorada: {entry}', file=sys.stderr)
            skipped += 1
            continue
        estados[ref] = entry

    print(f'  Estados a aplicar: {len(estados)}  (entradas ignoradas: {skipped})')

    # Aplicar estados
    aplicados = 0
    no_encontrados = []
    refs_en_remates = {str(r.get('ref', '')): i for i, r in enumerate(remates)}

    if not estados:
        print('  Sin estados a aplicar.')

    for ref, e in estados.items():
        idx = refs_en_remates.get(ref)
        if idx is None:
            no_encontrados.append(ref)
            continue
        r = remates[idx]
        r['estado'] = e['estado']
        if 'vuelta' in e:
            r['vuelta'] = int(e['vuelta'])
        if 'fecha' in e:
            r['adjFecha'] = e['fecha']
        if 'nota' in e:
            r['adjNota'] = e['nota']
        aplicados += 1
        print(f'  ✓ {ref} → {e["estado"]}' + (f' (vuelta {e["vuelta"]})' if 'vuelta' in e else ''))

    if no_encontrados:
        print(f'\n  AVISO: {len(no_encontrados)} ref(s) en estados.json no encontradas en remates.json:')
        for r in no_encontrados:
            print(f'    - {r}')

    # Limpiar campo 'estado' de remates que ya no están en estados.json
    # (por si se corrigió un error en estados.json)
    limpiados = 0
    for r in remates:
        ref = str(r.get('ref', ''))
        if 'estado' in r and ref not in estados:
            del r['estado']
            r.pop('vuelta', None)
            r.pop('adjFecha', None)
            r.pop('adjNota', None)
            limpiados += 1

    if limpiados:
        print(f'  Limpiados {limpiados} remate(s) cuyo estado fue removido de estados.json')

    # Escribir resultado
    with open(REMATES_PATH, 'w', encoding='utf-8') as f:
        json.dump(remates, f, ensure_ascii=False, separators=(',', ':'))

    print(f'\n  OK — {aplicados} estado(s) fusionado(s) en {REMATES_PATH.name}')


if __name__ == '__main__':
    print('merge_estados.py')
    main()
