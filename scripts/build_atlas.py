"""Atlas de cantón — stub.

Recorta las capas del catálogo municipal al polígono de un cantón y exporta:
- un GeoPackage (una capa por tabla) para abrir en QGIS
- una serie de láminas PDF con leyenda y escala uniforme (CRTM05)

No implementado todavía: requiere geopandas (no está en el entorno de este repo).
Instalar con `pip install geopandas` antes de completar las funciones.

Uso previsto:
    python scripts/build_atlas.py --canton "Pérez Zeledón" --salida salida/perez_zeledon

Pendiente:
- Cargar capas.json y resolver cada capa `disponible` a su GeoDataFrame.
- Recortar con geopandas.clip() al polígono del cantón (data/cantones.geojson).
- Escribir el GeoPackage con una capa por grupo de capas.json.
- Armar las láminas PDF (matplotlib o QGIS en modo batch) con leyenda y escala.
"""

import argparse
import json
import pathlib

MUNI_DIR = pathlib.Path(__file__).resolve().parent.parent / "muni"


def cargar_catalogo() -> dict:
    return json.loads((MUNI_DIR / "capas.json").read_text(encoding="utf-8"))


def capas_disponibles(catalogo: dict) -> list[dict]:
    return [
        capa
        for grupo in catalogo["grupos"]
        for capa in grupo["capas"]
        if capa["estado"] == "disponible" and capa.get("archivo", "").startswith("http")
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canton", required=True, help="Nombre del cantón, como aparece en data/cantones.geojson")
    parser.add_argument("--salida", required=True, help="Carpeta de salida (sin extensión)")
    args = parser.parse_args()

    catalogo = cargar_catalogo()
    disponibles = capas_disponibles(catalogo)
    print(f"Cantón: {args.canton}")
    print(f"Capas disponibles para recortar: {len(disponibles)}")
    for c in disponibles:
        print(f"  - {c['nombre']} ({c['fuente']})")

    raise SystemExit(
        "Pendiente de implementar: recorte con geopandas y exportación a "
        f"{args.salida}.gpkg + láminas PDF. Por ahora, usa el botón "
        "'Generar atlas' del visor (muni/) para un PDF rápido del mapa visible."
    )


if __name__ == "__main__":
    main()
