"""Atlas de cantón — recorta las capas del catálogo municipal al polígono de un
cantón y exporta un GeoPackage (para abrir en QGIS) más un PDF de láminas rápidas.

Uso:
    python3 scripts/build_atlas.py --canton "Pérez Zeledón" --salida salida/perez_zeledon

    # Para probar con los archivos de datos del repo en vez de bajarlos de internet
    # (útil en este entorno, donde no hay salida a planoexactocr.com):
    python3 scripts/build_atlas.py --canton "Pérez Zeledón" --salida salida/perez_zeledon --local .

Capas que exigen cuenta gratis:
    Varias capas (zmt, planes_reguladores, zonasvida, infra, salud) exigen una
    sesión de cuenta gratis en planoexactocr.com (así está hecho el sitio
    público: SOLO_CUENTA_DATOS en worker.js). En vez de iniciar sesión cada
    vez, usamos una copia propia: scripts/sync_cuenta.py las baja una sola
    vez y las guarda en muni/data/, y actualiza capas.json para que apunten
    ahí ("archivo": "data/zonasvida.geojson" en vez de la URL del sitio
    público). Este script lee esas copias igual que cualquier otra capa —
    no necesita cookie para ellas.

    Si alguna capa todavía no se ha sincronizado (sigue con "requiere_cuenta"
    en capas.json), este script la salta con un aviso. Para incluirla sin
    sincronizarla primero, puede pasar --cookie "pecr_u=<valor>" (o la
    variable de entorno PX_COOKIE) y la baja directo del sitio público, solo
    para esta corrida.

Qué hace:
  1. Lee muni/capas.json y toma las capas marcadas "disponible".
  2. Cada capa puede venir en tres formas (las tres existen hoy en el sitio):
       - GeoJSON (FeatureCollection) normal.
       - una lista de registros con coordenadas en la clave "ll": [lon, lat]
         (p. ej. data/salud.json).
       - un objeto con una lista de registros adentro, con la misma clave "ll"
         (p. ej. data/asadas.json → clave "asadas").
     Las capas marcadas como "api:/..." se saltan: esas se consultan una por
     una (plano o finca), no se descargan completas.
  3. Recorta cada capa al polígono del cantón elegido (de cantones.geojson).
  4. Escribe todo en un GeoPackage, una capa por tabla, nombrada por el eje
     IFA al que pertenece.
  5. Genera un PDF con una portada (cantón, fecha, fuentes) y una lámina por
     capa recortada, para repasar rápido sin abrir QGIS.

Falta para la versión completa (lo que no hace todavía):
  - Las capas IFA marcadas "pendiente" en capas.json (no hay de dónde
    bajarlas todavía: ver ese archivo para el detalle por eje).
  - Leyenda y escala gráfica cartográficamente correctas en el PDF (hoy es
    una vista rápida, no una lámina para imprimir y presentar).
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import unicodedata

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import requests
from shapely.geometry import Point

MUNI_DIR = pathlib.Path(__file__).resolve().parent.parent / "muni"
CRS_GEOGRAFICO = "EPSG:4326"
CRS_METRICO = "EPSG:5367"  # CRTM05, el oficial de Costa Rica — para áreas/recortes correctos


def normalizar(texto: str) -> str:
    """Quita acentos y pasa a minúsculas, para comparar nombres de cantón sin pelear con tildes."""
    sin_acentos = "".join(
        c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c)
    )
    return sin_acentos.strip().lower()


def cargar_catalogo() -> dict:
    return json.loads((MUNI_DIR / "capas.json").read_text(encoding="utf-8"))


def capas_descargables(catalogo: dict) -> list[dict]:
    """Capas 'disponible' que son un archivo: URL absoluta del sitio público, o ruta
    relativa (copia propia en muni/, p. ej. "data/zonasvida.geojson"). Las 'api:/...'
    se consultan por lote, no se descargan completas, así que se excluyen aquí."""
    vistas = set()
    resultado = []
    for grupo in catalogo["grupos"]:
        for capa in grupo["capas"]:
            if capa["estado"] != "disponible":
                continue
            archivo = capa.get("archivo")
            if not archivo or archivo.startswith("api:"):
                continue
            if capa["nombre"] in vistas:
                continue
            vistas.add(capa["nombre"])
            resultado.append({**capa, "eje": grupo["eje"]})
    return resultado


def leer_json(archivo: str, local_root: pathlib.Path | None, cookie: str | None) -> dict | list:
    if not archivo.startswith("http"):
        # Ruta relativa: copia propia dentro de muni/ (ver scripts/sync_cuenta.py).
        return json.loads((MUNI_DIR / archivo).read_text(encoding="utf-8"))
    if local_root is not None:
        nombre_archivo = archivo.rsplit("/", 1)[-1]
        ruta = local_root / "data" / nombre_archivo
        return json.loads(ruta.read_text(encoding="utf-8"))
    headers = {"Cookie": cookie} if cookie else {}
    resp = requests.get(archivo, timeout=30, headers=headers)
    resp.raise_for_status()
    return resp.json()


def a_geodataframe(data: dict | list, nombre_capa: str) -> gpd.GeoDataFrame | None:
    """Convierte lo que venga (FeatureCollection, lista de puntos, o dict con una lista
    de puntos adentro) a un GeoDataFrame en WGS84. Devuelve None si no reconoce la forma."""
    if isinstance(data, dict) and data.get("type") == "FeatureCollection":
        gdf = gpd.GeoDataFrame.from_features(data["features"])
        gdf = gdf.set_crs(CRS_GEOGRAFICO, allow_override=True)
        return gdf

    registros = None
    if isinstance(data, list):
        registros = data
    elif isinstance(data, dict):
        # Objetos tipo asadas.json: la lista de puntos vive bajo alguna clave.
        for valor in data.values():
            if isinstance(valor, list) and valor and isinstance(valor[0], dict) and "ll" in valor[0]:
                registros = valor
                break

    if registros is None:
        print(f"  (!) no reconozco la forma de '{nombre_capa}', se omite", file=sys.stderr)
        return None

    filas = [r for r in registros if isinstance(r, dict) and "ll" in r and r["ll"]]
    if not filas:
        print(f"  (!) '{nombre_capa}' no trae coordenadas 'll', se omite", file=sys.stderr)
        return None

    geometria = [Point(r["ll"][0], r["ll"][1]) for r in filas]
    df = pd.DataFrame(filas)
    return gpd.GeoDataFrame(df, geometry=geometria, crs=CRS_GEOGRAFICO)


def nombre_tabla(nombre_capa: str) -> str:
    """Nombre de tabla válido para GeoPackage: sin acentos, sin espacios raros, máx 63 car."""
    base = normalizar(nombre_capa).replace(" ", "_")
    limpio = "".join(c if c.isalnum() or c == "_" else "" for c in base)
    return limpio[:63] or "capa"


def sanear_geometrias(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Algunas capas (sobre todo la de zona marítimo terrestre) traen polígonos
    con auto-intersecciones; buffer(0) los repara sin cambiar la forma visible."""
    invalidas = ~gdf.geometry.is_valid
    if invalidas.any():
        gdf = gdf.copy()
        gdf.loc[invalidas, "geometry"] = gdf.loc[invalidas, "geometry"].buffer(0)
    return gdf


def recortar_al_canton(gdf: gpd.GeoDataFrame, poligono_canton: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    gdf_m = sanear_geometrias(gdf.to_crs(CRS_METRICO))
    poligono_m = sanear_geometrias(poligono_canton.to_crs(CRS_METRICO))
    recortado = gpd.clip(gdf_m, poligono_m)
    return recortado.to_crs(CRS_GEOGRAFICO)


def generar_pendientes(dem_path: str, poligono_canton: gpd.GeoDataFrame, salida_base: pathlib.Path):
    """Calcula el mapa de pendientes (Decreto 23214) desde un DEM, recortado al cantón.
    Escribe un GeoTIFF de categorías 1..7 y devuelve (categorias, transform, ruta_tif, modulo)."""
    import rasterio
    from rasterio.features import rasterize

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import pendientes as P

    _, cat, perfil = P.pendiente_desde_dem(dem_path)
    with rasterio.open(dem_path) as src:
        crs, transform, shape = src.crs, src.transform, (src.height, src.width)
    # Deja la pendiente solo dentro del cantón.
    poly = poligono_canton.to_crs(crs)
    mascara = rasterize([(g, 1) for g in poly.geometry], out_shape=shape,
                        transform=transform, fill=0, dtype="uint8")
    cat = np.where(mascara == 1, cat, 0).astype("uint8")

    perfil.update(dtype="uint8", count=1, nodata=0)
    ruta_tif = pathlib.Path(str(salida_base) + "_pendientes.tif")
    with rasterio.open(ruta_tif, "w", **perfil) as dst:
        dst.write(cat, 1)
    return cat, transform, ruta_tif, P


def lamina_pendientes(pdf, canton, poligono_canton, cat, transform, P) -> None:
    from matplotlib.colors import BoundaryNorm, ListedColormap

    colores = [P.COLORES_PENDIENTE[c] for _, _, c, _ in P.CATEGORIAS_23214]
    cmap = ListedColormap(colores)
    norm = BoundaryNorm(list(range(1, 9)), cmap.N)
    h, w = cat.shape
    izq, arr = transform.c, transform.f
    extent = [izq, izq + w * transform.a, arr + h * transform.e, arr]

    fig, ax = plt.subplots(figsize=(8.5, 11))
    datos = np.ma.masked_where(cat == 0, cat)
    ax.imshow(datos, extent=extent, cmap=cmap, norm=norm, interpolation="nearest")
    try:
        poligono_canton.to_crs("EPSG:5367").boundary.plot(ax=ax, color="black", linewidth=1)
    except Exception:
        pass
    ax.set_title(f"{canton} — Pendientes (Decreto 23214)", fontsize=13)
    ax.set_axis_off()
    etiquetas = [f"{c}: {lbl} ({lo:g}-{'∞' if hi == float('inf') else int(hi)}%)"
                 for lo, hi, c, lbl in P.CATEGORIAS_23214]
    ax.text(0.01, 0.01, "  |  ".join(etiquetas), transform=ax.transAxes, fontsize=6, wrap=True)
    pdf.savefig(fig)
    plt.close(fig)


def armar_pdf(ruta_pdf: pathlib.Path, canton: str, poligono_canton: gpd.GeoDataFrame,
              capas_recortadas: list[tuple[dict, gpd.GeoDataFrame]], generado: str,
              pendientes=None) -> None:
    from matplotlib.backends.backend_pdf import PdfPages

    with PdfPages(ruta_pdf) as pdf:
        # Portada: cantón, fecha, y de dónde sale cada capa.
        fig, ax = plt.subplots(figsize=(8.5, 11))
        ax.axis("off")
        lineas = [f"Atlas municipal — {canton}", f"Generado: {generado}", "", "Capas incluidas:"]
        for capa, gdf in capas_recortadas:
            lineas.append(f"  • {capa['nombre']} — {capa['fuente']} ({len(gdf)} elementos en el cantón)")
        if pendientes is not None:
            lineas.append("  • Pendientes del terreno — DEM / IGN (Decreto 23214)")
        if not capas_recortadas and pendientes is None:
            lineas.append("  (ninguna capa tenía elementos dentro de este cantón)")
        ax.text(0.05, 0.95, "\n".join(lineas), va="top", ha="left", fontsize=11, wrap=True)
        pdf.savefig(fig)
        plt.close(fig)

        # Una lámina por capa, con el límite del cantón de fondo.
        for capa, gdf in capas_recortadas:
            fig, ax = plt.subplots(figsize=(8.5, 11))
            poligono_canton.boundary.plot(ax=ax, color="black", linewidth=1)
            if not gdf.empty:
                es_punto = gdf.geometry.geom_type.isin(["Point", "MultiPoint"]).all()
                if es_punto:
                    gdf.plot(ax=ax, markersize=8, color="#d9480f")
                else:
                    gdf.plot(ax=ax, color="#1971c2", alpha=0.5, edgecolor="#1971c2")
            ax.set_title(f"{canton} — {capa['nombre']}", fontsize=13)
            ax.set_axis_off()
            ax.text(0.01, 0.01, f"Fuente: {capa['fuente']}", transform=ax.transAxes, fontsize=8)
            pdf.savefig(fig)
            plt.close(fig)

        # Lámina de pendientes (si se pasó un DEM con --dem).
        if pendientes is not None:
            cat, transform, _, P = pendientes
            lamina_pendientes(pdf, canton, poligono_canton, cat, transform, P)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--canton", required=True, help="Nombre del cantón, como aparece en data/cantones.geojson")
    parser.add_argument("--salida", required=True, help="Ruta de salida sin extensión (se escriben .gpkg y .pdf)")
    parser.add_argument("--local", type=pathlib.Path, default=None,
                         help="Carpeta raíz del repo con datos locales en data/, en vez de bajarlos de internet")
    parser.add_argument("--cookie", default=os.environ.get("PX_COOKIE"),
                         help='Cookie de sesión de una cuenta gratis en planoexactocr.com (p. ej. "pecr_u=..."), '
                              "para incluir las capas que exigen cuenta. También se puede dar con PX_COOKIE.")
    parser.add_argument("--dem", default=None,
                         help="Ruta a un DEM (GeoTIFF, en CRS métrico como EPSG:5367) que cubra el cantón. "
                              "Si se da, agrega el mapa de pendientes clasificado según el Decreto 23214.")
    args = parser.parse_args()

    catalogo = cargar_catalogo()
    descargables = capas_descargables(catalogo)
    sin_cookie_omitidas = [c for c in descargables if c.get("requiere_cuenta") and not args.cookie and not args.local]
    if sin_cookie_omitidas:
        print("Se omiten por requerir cuenta (sin --cookie / PX_COOKIE):")
        for c in sin_cookie_omitidas:
            print(f"  - {c['nombre']}")
        descargables = [c for c in descargables if c not in sin_cookie_omitidas]

    print(f"Cantón: {args.canton}")
    print(f"Capas disponibles para recortar: {len(descargables)}")

    url_cantones = "https://planoexactocr.com/data/cantones.geojson"
    cantones = a_geodataframe(leer_json(url_cantones, args.local, args.cookie), "Límites cantonales")
    if cantones is None:
        raise SystemExit("No pude leer cantones.geojson")

    columna_nombre = "k" if "k" in cantones.columns else None
    if columna_nombre is None:
        raise SystemExit("cantones.geojson no tiene la columna de nombre esperada ('k')")

    objetivo = normalizar(args.canton)
    coincidencias = cantones[cantones[columna_nombre].apply(lambda v: normalizar(str(v)) == objetivo)]
    if coincidencias.empty:
        opciones = ", ".join(sorted(cantones[columna_nombre].unique())[:15])
        raise SystemExit(f"No encontré el cantón '{args.canton}'. Algunos nombres válidos: {opciones}, …")
    poligono_canton = coincidencias

    # Recuadro del cantón en lon/lat, para pedir las capas nacionales (IGN, INTA) ya
    # recortadas por bbox y no bajar cientos de miles de geometrías de todo el país.
    minx, miny, maxx, maxy = poligono_canton.to_crs(CRS_GEOGRAFICO).total_bounds
    bbox_canton = f"{minx},{miny},{maxx},{maxy},EPSG:4326"  # GeoServer: forma corta = orden lon,lat

    salida = pathlib.Path(args.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    ruta_gpkg = salida.with_suffix(".gpkg")
    ruta_pdf = salida.with_suffix(".pdf")
    if ruta_gpkg.exists():
        ruta_gpkg.unlink()

    capas_recortadas: list[tuple[dict, gpd.GeoDataFrame]] = []
    for capa in descargables:
        print(f"  - {capa['nombre']} ({capa['fuente']})", end=" ")
        try:
            if capa.get("filtrar_canton") and str(capa["archivo"]).startswith("http"):
                # Capa nacional: se pide en vivo con el bbox del cantón (no hay copia local).
                sep = "&" if "?" in capa["archivo"] else "?"
                url = f"{capa['archivo']}{sep}bbox={bbox_canton}&count=200000"
                data = leer_json(url, None, args.cookie)
            else:
                data = leer_json(capa["archivo"], args.local, args.cookie)
        except Exception as e:
            print(f"ERROR al leer: {e}", file=sys.stderr)
            continue
        gdf = a_geodataframe(data, capa["nombre"])
        if gdf is None:
            continue
        recortado = recortar_al_canton(gdf, poligono_canton)
        print(f"→ {len(recortado)} elementos en el cantón")
        if recortado.empty:
            continue
        tabla = nombre_tabla(capa["nombre"])
        recortado.to_file(ruta_gpkg, layer=tabla, driver="GPKG")
        capas_recortadas.append((capa, recortado))

    # El polígono del cantón también va en el GeoPackage, de referencia.
    poligono_canton.to_file(ruta_gpkg, layer="limite_canton", driver="GPKG")

    # Mapa de pendientes (Decreto 23214) si se pasó un DEM.
    pendientes = None
    if args.dem:
        print(f"  - Pendientes del terreno (DEM: {args.dem})", end=" ")
        try:
            cat, transform, ruta_tif, Pmod = generar_pendientes(args.dem, poligono_canton, salida)
            pendientes = (cat, transform, ruta_tif, Pmod)
            print(f"→ {ruta_tif.name}")
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            pendientes = None

    generado = pd.Timestamp.now().strftime("%Y-%m-%d %H:%M")
    armar_pdf(ruta_pdf, args.canton, poligono_canton, capas_recortadas, generado, pendientes)

    print(f"\nListo: {ruta_gpkg}")
    print(f"       {ruta_pdf}")
    if pendientes is not None:
        print(f"       {pendientes[2]}")


if __name__ == "__main__":
    main()
