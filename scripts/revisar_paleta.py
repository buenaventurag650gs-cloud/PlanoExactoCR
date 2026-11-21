"""Revisa que los colores de muni/simbologia.json no se parezcan entre capas que se pueden
ver juntas en un mismo mapa.

Para cada mapa del catálogo arma el conjunto de capas que pueden estar visibles a la vez
(sus insumos + las capas base que el tablero deja siempre disponibles + el límite cantonal)
y mide la distancia perceptual entre cada par de colores (CIE76 en Lab). Marca como problema
cualquier pareja por debajo del umbral.

Uso:  python3 scripts/revisar_paleta.py
Sale con código 1 si hay parejas demasiado parecidas, para poder usarlo como chequeo.
"""

from __future__ import annotations

import itertools
import json
import pathlib
import sys

UMBRAL = 22.0        # CIE76: por debajo de ~22 dos colores se confunden en un mapa impreso
RAIZ = pathlib.Path(__file__).resolve().parent.parent
MUNI = RAIZ / "muni"


def hex_a_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def a_lab(hexa: str) -> tuple[float, float, float]:
    """sRGB -> Lab (D65), suficiente para comparar colores entre sí."""
    def lineal(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lineal(c) for c in hex_a_rgb(hexa))
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 1.00000
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def distancia(c1: str, c2: str) -> float:
    a, b = a_lab(c1), a_lab(c2)
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def main() -> int:
    simb = json.loads((MUNI / "simbologia.json").read_text(encoding="utf-8"))
    catalogo = json.loads((MUNI / "mapas_oficiales.json").read_text(encoding="utf-8"))
    capas_doc = json.loads((MUNI / "capas.json").read_text(encoding="utf-8"))

    estilos = simb["capas"]
    base = simb["base_visible_siempre"]
    # Solo las capas que se dibujan: las "api:" se consultan por plano/finca, no son una capa.
    reales = {c["nombre"] for g in capas_doc["grupos"] for c in g["capas"]
              if not str(c.get("archivo") or "").startswith("api:")}

    # Toda capa real debe tener simbología declarada.
    sin_estilo = sorted(n for n in reales if n not in estilos)
    if sin_estilo:
        print("Capas sin simbología declarada:")
        for n in sin_estilo:
            print("  -", n)

    problemas = []
    for inst in catalogo["instituciones"]:
        for mapa in inst["mapas"]:
            visibles = ["Límites cantonales"] + list(base)
            for n in mapa.get("insumos", []):
                if n in estilos and n not in visibles:
                    visibles.append(n)
            for a, b in itertools.combinations(visibles, 2):
                ca, cb = estilos[a]["color"], estilos[b]["color"]
                if ca == cb:
                    continue          # mismo dato con dos nombres (Red hídrica / Hidrografía)
                d = distancia(ca, cb)
                if d < UMBRAL:
                    problemas.append((d, mapa["numero"], a, ca, b, cb))

    # Una pareja puede repetirse en varios mapas; se reporta una vez.
    vistos = set()
    unicos = []
    for p in sorted(problemas):
        clave = tuple(sorted((p[2], p[4])))
        if clave in vistos:
            continue
        vistos.add(clave)
        unicos.append(p)

    if unicos:
        print(f"\nParejas demasiado parecidas (CIE76 < {UMBRAL}):")
        for d, num, a, ca, b, cb in unicos:
            print(f"  [{d:5.1f}]  mapa {num}:  {a} ({ca})  ~  {b} ({cb})")
        return 1

    total = len({e["color"] for e in estilos.values()})
    print(f"Paleta revisada: {len(estilos)} capas, {total} colores distintos.")
    print(f"Ninguna pareja visible junta queda por debajo de CIE76 {UMBRAL}. Sin problemas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
