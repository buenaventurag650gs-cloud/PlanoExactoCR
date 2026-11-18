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


def cargar_mapas_oficiales() -> dict[str, dict]:
    """Devuelve {id_mapa: definición} del catálogo de mapas oficiales (INVU + SETENA)."""
    ruta = MUNI_DIR / "mapas_oficiales.json"
    if not ruta.exists():
        return {}
    data = json.loads(ruta.read_text(encoding="utf-8"))
    por_id = {}
    for inst in data.get("instituciones", []):
        for m in inst.get("mapas", []):
            por_id[m["id"]] = {**m, "institucion": inst["nombre"]}
    return por_id


def leer_config(ruta: str) -> dict:
    """Lee la configuración que exporta el tablero web (cantón, municipalidad, logo, mapas)."""
    return json.loads(pathlib.Path(ruta).read_text(encoding="utf-8"))


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


def lamina_uso_suelo(pdf, canton, poligono_canton, capas_por_nombre: dict) -> bool:
    """Lámina compuesta de uso actual del suelo: urbano + cultivos + cobertura.
    Devuelve True si dibujó algo."""
    # Mapeo nombre → (color, etiqueta corta, zorder)
    CAPAS_USO = {
        "Cultivos 1:5mil":          ("#8fbc8f", "Cultivos",    2),
        "Uso urbano 1:5mil":        ("#d9534f", "Urbano",      3),
        "Cobertura forestal 2020":  ("#2d6a4f", "Cobertura forestal", 1),
        "Zonas de vida":            ("#e8e8cc", "Zonas de vida (fondo)", 0),
    }
    presentes = []
    for nombre, (color, etiq, z) in CAPAS_USO.items():
        if nombre in capas_por_nombre and not capas_por_nombre[nombre].empty:
            presentes.append((nombre, color, etiq, z))
    if not presentes:
        return False

    presentes.sort(key=lambda x: x[3])  # por zorder
    fig, ax = plt.subplots(figsize=(8.5, 11))
    poligono_canton.boundary.plot(ax=ax, color="black", linewidth=1.2, zorder=10)

    for nombre, color, etiq, z in presentes:
        gdf = capas_por_nombre[nombre]
        es_punto = gdf.geometry.geom_type.isin(["Point", "MultiPoint"]).all()
        if es_punto:
            gdf.plot(ax=ax, markersize=6, color=color, label=etiq, zorder=z)
        else:
            gdf.plot(ax=ax, color=color, alpha=0.6, edgecolor=color,
                     linewidth=0.3, label=etiq, zorder=z)

    ax.set_title(f"{canton} — Uso actual del suelo", fontsize=13)
    ax.set_axis_off()
    ax.legend(loc="lower left", fontsize=7, framealpha=0.9)
    ax.text(0.99, 0.01, "Fuente: IGN / MINAE (SNIT)", transform=ax.transAxes,
            fontsize=7, ha="right")
    pdf.savefig(fig)
    plt.close(fig)
    return True


def lamina_bioaptitud(pdf, canton, poligono_canton, capas_por_nombre: dict) -> bool:
    """Lámina compuesta de bioaptitud: zonas de vida + ASP + corredores + PNE + humedales.
    Devuelve True si dibujó algo."""
    # Capas ordenadas de fondo a frente (zorder bajo = se dibuja primero)
    CAPAS_BIO = {
        "Zonas de vida":                 ("#d4edda", "Zonas de vida (fondo)",     1, 0.4),
        "Áreas de Conservación":         ("#b2dfdb", "Áreas de conservación",     2, 0.3),
        "Corredores biológicos":         ("#81c784", "Corredores biológicos",     3, 0.5),
        "Patrimonio Natural del Estado": ("#388e3c", "Patrimonio Natural",        4, 0.5),
        "Áreas silvestres protegidas":   ("#1b5e20", "Áreas silvestres proteg.",  5, 0.6),
        "Registro Nacional de Humedales":("#4fc3f7", "Humedales",                 6, 0.6),
        "Cobertura forestal 2020":       ("#2d6a4f", "Cobertura forestal",        2, 0.35),
    }
    presentes = []
    for nombre, (color, etiq, z, alpha) in CAPAS_BIO.items():
        if nombre in capas_por_nombre and not capas_por_nombre[nombre].empty:
            presentes.append((nombre, color, etiq, z, alpha))
    if not presentes:
        return False

    presentes.sort(key=lambda x: x[3])
    fig, ax = plt.subplots(figsize=(8.5, 11))
    poligono_canton.boundary.plot(ax=ax, color="black", linewidth=1.2, zorder=10)

    for nombre, color, etiq, z, alpha in presentes:
        gdf = capas_por_nombre[nombre]
        es_punto = gdf.geometry.geom_type.isin(["Point", "MultiPoint"]).all()
        if es_punto:
            gdf.plot(ax=ax, markersize=6, color=color, label=etiq, zorder=z)
        else:
            gdf.plot(ax=ax, color=color, alpha=alpha, edgecolor=color,
                     linewidth=0.3, label=etiq, zorder=z)

    ax.set_title(f"{canton} — IFA Bioaptitud", fontsize=13)
    ax.set_axis_off()
    ax.legend(loc="lower left", fontsize=7, framealpha=0.9)
    ax.text(0.99, 0.01, "Fuente: SINAC / MINAE-CENIGA (SNIT)", transform=ax.transAxes,
            fontsize=7, ha="right")
    pdf.savefig(fig)
    plt.close(fig)
    return True


def lamina_bioaptitud_calificada(pdf, canton, poligono_canton, capas_por_nombre: dict) -> bool:
    """Bioaptitud calificada: cada capa del SINAC coloreada por su valor de fragilidad IFA
    (1-5), no por su tipo. Las áreas sin capa de protección quedan en blanco (menor fragilidad
    biológica). Devuelve True si dibujó algo."""
    import calificacion_ifa as C
    from matplotlib.patches import Patch

    # Qué valor IFA tiene cada capa presente (las informativas devuelven 0 y se omiten).
    presentes = []
    for nombre, gdf in capas_por_nombre.items():
        v = C.calificar_bioaptitud(nombre)
        if v and not gdf.empty:
            presentes.append((nombre, v, gdf))
    if not presentes:
        return False

    # Dibuja de menor a mayor fragilidad, para que lo más frágil (IFA 1) quede encima.
    presentes.sort(key=lambda x: -x[1])
    fig, ax = plt.subplots(figsize=(8.5, 11))
    poligono_canton.boundary.plot(ax=ax, color="black", linewidth=1.2, zorder=10)

    niveles_usados = set()
    for nombre, v, gdf in presentes:
        color = C.COLORES_IFA[v]
        niveles_usados.add(v)
        es_punto = gdf.geometry.geom_type.isin(["Point", "MultiPoint"]).all()
        if es_punto:
            gdf.plot(ax=ax, markersize=7, color=color, zorder=v)
        else:
            gdf.plot(ax=ax, color=color, alpha=0.65, edgecolor=color, linewidth=0.3, zorder=v)

    ax.set_title(f"{canton} — IFA Bioaptitud (calificada 1-5)", fontsize=13)
    ax.set_axis_off()
    # Leyenda por nivel de fragilidad.
    handles = [Patch(facecolor=C.COLORES_IFA[v], label=C.etiqueta_ifa(v))
               for v in sorted(niveles_usados)]
    ax.legend(handles=handles, loc="lower left", fontsize=7, framealpha=0.9)
    ax.text(0.99, 0.015, "Fuente: SINAC (SNIT)", transform=ax.transAxes, fontsize=7, ha="right")
    ax.text(0.99, 0.0, "Calificación [VERIFICAR] contra Anexo 1 del 44710",
            transform=ax.transAxes, fontsize=5, style="italic", ha="right")
    pdf.savefig(fig)
    plt.close(fig)
    return True


def lamina_mapa_generico(pdf, canton, poligono_canton, mapa_def: dict,
                         capas_por_nombre: dict) -> bool:
    """Arma un mapa oficial a partir de sus capas de insumo (las que existan recortadas al
    cantón), cada una de un color, con leyenda y el nombre del mapa de título. Sirve para los
    mapas del INVU (base, amenazas, vialidad, servicios) y otros compuestos. True si dibujó."""
    from matplotlib.patches import Patch

    paleta = ["#1971c2", "#d9480f", "#2f9e44", "#e8963f", "#9c36b5", "#0c8599",
              "#e03131", "#5c940d", "#1098ad", "#862e9c"]
    insumos = [n for n in mapa_def.get("insumos", [])
               if n in capas_por_nombre and not capas_por_nombre[n].empty]
    if not insumos:
        return False

    fig, ax = plt.subplots(figsize=(8.5, 11))
    poligono_canton.boundary.plot(ax=ax, color="black", linewidth=1.2, zorder=10)
    handles = []
    for i, nombre in enumerate(insumos):
        color = paleta[i % len(paleta)]
        gdf = capas_por_nombre[nombre]
        es_punto = gdf.geometry.geom_type.isin(["Point", "MultiPoint"]).all()
        if es_punto:
            gdf.plot(ax=ax, markersize=6, color=color, zorder=i + 1)
        else:
            gdf.plot(ax=ax, color=color, alpha=0.5, edgecolor=color, linewidth=0.3, zorder=i + 1)
        handles.append(Patch(facecolor=color, label=nombre))

    ax.set_title(f"{canton} — {mapa_def['nombre']}", fontsize=13)
    ax.set_axis_off()
    ax.legend(handles=handles, loc="lower left", fontsize=7, framealpha=0.9)
    ax.text(0.99, 0.01, mapa_def.get("institucion", ""), transform=ax.transAxes,
            fontsize=7, ha="right", style="italic")
    pdf.savefig(fig)
    plt.close(fig)
    return True


def _logo_desde_data_url(logo: str):
    """Convierte un data URL (data:image/...;base64,XXXX) en un arreglo de imagen, o None."""
    if not logo or not isinstance(logo, str) or "," not in logo:
        return None
    try:
        import base64
        import io
        cabecera, b64 = logo.split(",", 1)
        datos = base64.b64decode(b64)
        return plt.imread(io.BytesIO(datos))
    except Exception:
        return None


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


def lamina_ifa_pendiente(pdf, canton, poligono_canton, cat, transform) -> None:
    """Primer mapa IFA calificado: geoaptitud por pendiente, reclasificada a la escala
    oficial 1-5 (Tabla 8). Usa las categorías 23214 ya calculadas."""
    from matplotlib.colors import BoundaryNorm, ListedColormap
    import calificacion_ifa as C

    ifa = C.calificar_cat_pendiente_ifa(cat)  # 1..5 (0 = sin dato)
    colores = [C.COLORES_IFA[v] for v in range(1, 6)]
    cmap = ListedColormap(colores)
    norm = BoundaryNorm(list(range(1, 7)), cmap.N)
    h, w = ifa.shape
    izq, arr = transform.c, transform.f
    extent = [izq, izq + w * transform.a, arr + h * transform.e, arr]

    fig, ax = plt.subplots(figsize=(8.5, 11))
    datos = np.ma.masked_where(ifa == 0, ifa)
    ax.imshow(datos, extent=extent, cmap=cmap, norm=norm, interpolation="nearest")
    try:
        poligono_canton.to_crs("EPSG:5367").boundary.plot(ax=ax, color="black", linewidth=1)
    except Exception:
        pass
    ax.set_title(f"{canton} — IFA Geoaptitud por pendiente", fontsize=13)
    ax.set_axis_off()
    etiquetas = [C.etiqueta_ifa(v) for v in range(1, 6)]
    ax.text(0.01, 0.015, "  |  ".join(etiquetas), transform=ax.transAxes, fontsize=6, wrap=True)
    ax.text(0.01, 0.0, "Calificación Tabla 8 (Decreto 32967/23214) — verificar contra Anexo 1 del 44710",
            transform=ax.transAxes, fontsize=5, style="italic")
    pdf.savefig(fig)
    plt.close(fig)


def _portada(pdf, canton, generado, municipalidad, logo, titulos_mapas) -> None:
    """Portada del atlas con identidad municipal y la lista de mapas incluidos."""
    fig, ax = plt.subplots(figsize=(8.5, 11))
    ax.axis("off")

    img = _logo_desde_data_url(logo)
    if img is not None:
        eje_logo = fig.add_axes([0.05, 0.86, 0.14, 0.10])
        eje_logo.imshow(img)
        eje_logo.axis("off")
        x_titulo = 0.22
    else:
        x_titulo = 0.05

    encabezado = municipalidad or "Atlas municipal"
    ax.text(x_titulo, 0.93, encabezado, va="top", ha="left", fontsize=16, weight="bold",
            transform=ax.transAxes)
    ax.text(x_titulo, 0.885, f"Cantón de {canton}", va="top", ha="left", fontsize=12,
            transform=ax.transAxes)

    lineas = [f"Generado: {generado}", "Decreto 44710-MINAE (IFA) / MAPRIOT (INVU)",
              "Proyección: CRTM05 (EPSG:5367)", "", "Mapas incluidos:"]
    lineas += [f"  • {t}" for t in titulos_mapas] or ["  (ninguno)"]
    ax.text(0.05, 0.78, "\n".join(lineas), va="top", ha="left", fontsize=10,
            family="monospace", transform=ax.transAxes, wrap=True)
    pdf.savefig(fig)
    plt.close(fig)


def armar_pdf(ruta_pdf: pathlib.Path, canton: str, poligono_canton: gpd.GeoDataFrame,
              capas_recortadas: list[tuple[dict, gpd.GeoDataFrame]], generado: str,
              pendientes=None, seleccion: set | None = None, municipalidad: str | None = None,
              logo: str | None = None, mapas_oficiales: dict | None = None) -> None:
    """Arma el PDF del atlas. Si `seleccion` trae ids de mapa (del tablero), dibuja solo esos
    mapas oficiales; si es None, dibuja todos los mapas temáticos y una lámina por capa."""
    from matplotlib.backends.backend_pdf import PdfPages

    mapas_oficiales = mapas_oficiales or {}
    capas_por_nombre: dict[str, gpd.GeoDataFrame] = {}
    for capa, gdf in capas_recortadas:
        capas_por_nombre[capa["nombre"]] = gdf

    def quiere(id_mapa: str) -> bool:
        return seleccion is None or id_mapa in seleccion

    # Funciones dedicadas por id de mapa (las que tienen lámina propia). El resto usa la genérica.
    def dibujar_mapa(pdf, id_mapa: str) -> str | None:
        """Dibuja el mapa oficial y devuelve su título si dibujó algo, o None."""
        nombre = mapas_oficiales.get(id_mapa, {}).get("nombre", id_mapa)
        if id_mapa == "uso_actual_suelo":
            ok = lamina_uso_suelo(pdf, canton, poligono_canton, capas_por_nombre)
        elif id_mapa == "ifa_bioaptitud":
            lamina_bioaptitud(pdf, canton, poligono_canton, capas_por_nombre)
            ok = lamina_bioaptitud_calificada(pdf, canton, poligono_canton, capas_por_nombre)
        elif id_mapa == "ifa_geoaptitud_pendiente":
            if pendientes is None:
                return None
            cat, transform, _, P = pendientes
            lamina_pendientes(pdf, canton, poligono_canton, cat, transform, P)
            lamina_ifa_pendiente(pdf, canton, poligono_canton, cat, transform)
            ok = True
        elif id_mapa in mapas_oficiales:
            ok = lamina_mapa_generico(pdf, canton, poligono_canton, mapas_oficiales[id_mapa],
                                      capas_por_nombre)
        else:
            ok = False
        return nombre if ok else None

    # Qué mapas intentar: los elegidos, en el orden del catálogo; o un set por defecto.
    if seleccion is not None:
        orden = [mid for mid in mapas_oficiales if mid in seleccion]
    else:
        orden = ["uso_actual_suelo", "ifa_bioaptitud", "ifa_geoaptitud_pendiente"]

    with PdfPages(ruta_pdf) as pdf:
        pdf_titulos: list[str] = []
        # Reservamos la portada: primero dibujamos los mapas, juntando sus títulos, luego la
        # ponemos al frente reescribiendo el PDF no es trivial, así que dibujamos la portada
        # con la lista de mapas pedidos (no la de los que salieron) — es la intención del usuario.
        titulos_pedidos = [mapas_oficiales.get(mid, {}).get("nombre", mid) for mid in orden]
        _portada(pdf, canton, generado, municipalidad, logo, titulos_pedidos)

        for id_mapa in orden:
            t = dibujar_mapa(pdf, id_mapa)
            if t:
                pdf_titulos.append(t)

        # En modo completo (sin selección), agrega también una lámina por capa de referencia.
        if seleccion is None:
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default=None,
                         help="Configuración exportada por el tablero web (.json con cantón, "
                              "municipalidad, logo y los mapas elegidos). Si se da, manda sobre --canton.")
    parser.add_argument("--canton", help="Nombre del cantón, como aparece en data/cantones.geojson")
    parser.add_argument("--salida", help="Ruta de salida sin extensión (se escriben .gpkg y .pdf)")
    parser.add_argument("--local", type=pathlib.Path, default=None,
                         help="Carpeta raíz del repo con datos locales en data/, en vez de bajarlos de internet")
    parser.add_argument("--cookie", default=os.environ.get("PX_COOKIE"),
                         help='Cookie de sesión de una cuenta gratis en planoexactocr.com (p. ej. "pecr_u=..."), '
                              "para incluir las capas que exigen cuenta. También se puede dar con PX_COOKIE.")
    parser.add_argument("--dem", default=None,
                         help="Ruta a un DEM (GeoTIFF, en CRS métrico como EPSG:5367) que cubra el cantón. "
                              "Si se da, agrega el mapa de pendientes clasificado según el Decreto 23214.")
    args = parser.parse_args()

    # Asegura que los módulos hermanos (plancha, calificacion_ifa, pendientes) se importen
    # sin importar desde qué carpeta se corra el script.
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

    # Configuración del tablero: fija cantón, municipalidad, logo y los mapas a generar.
    config = leer_config(args.config) if args.config else {}
    seleccion = set(config["mapas"]) if config.get("mapas") else None
    municipalidad = config.get("municipalidad")
    logo = config.get("logo")
    canton_nombre = config.get("canton") or args.canton
    if not canton_nombre:
        raise SystemExit("Falta el cantón: pasá --canton o un --config que lo traiga.")
    args.canton = canton_nombre
    if not args.salida:
        base = normalizar(canton_nombre).replace(" ", "_")
        args.salida = f"salida/{base}"
    mapas_oficiales = cargar_mapas_oficiales()

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
    fecha_corta = pd.Timestamp.now().strftime("%d/%m/%Y")
    capas_por_nombre = {c["nombre"]: g for c, g in capas_recortadas}

    planchas_hechas = []
    if seleccion is not None and mapas_oficiales:
        # Salida final: una plancha profesional por mapa elegido (estilo POT).
        import plancha
        orden = [mid for mid in mapas_oficiales if mid in seleccion]
        total = len(orden)
        import calificacion_ifa as C

        def raster_dict(cat, transform):
            return {"cat": cat, "transform": transform,
                    "colores": {v: C.COLORES_IFA[v] for v in range(1, 6)},
                    "leyenda": [(C.NIVELES_IFA[v], C.COLORES_IFA[v]) for v in range(1, 6)]}

        for i, mid in enumerate(orden, 1):
            mdef = mapas_oficiales[mid]
            insumos = [(n, capas_por_nombre[n]) for n in mdef.get("insumos", []) if n in capas_por_nombre]

            # Eje Bioaptitud: sub-mapas clasificados + integrado (IFA Biológico).
            if mid == "ifa_bioaptitud":
                import bioaptitud
                canton_m = poligono_canton.to_crs("EPSG:5367")
                subs = bioaptitud.submapas(capas_por_nombre, canton_m)
                cat_int, tr_int = bioaptitud.integrado(subs)
                hechos = 0
                # Mapa integrado (el principal del eje).
                if cat_int is not None:
                    arch = salida.parent / f"{mdef.get('numero','')} Mapa IFA Bioaptitud {args.canton} Carta.pdf"
                    plancha.dibujar_plancha(arch, args.canton, poligono_canton, [], "IFA Bioaptitud",
                        mdef.get("institucion", ""), municipalidad=municipalidad, escudo=logo,
                        fecha=fecha_corta, lamina_num=i, total=total, numero=mdef.get("numero", ""),
                        cantones_full=cantones, raster=raster_dict(cat_int, tr_int))
                    planchas_hechas.append(arch); hechos += 1
                    print(f"  ✓ {arch.name}")
                # Sub-mapas (biotopos, categorías de manejo, cobertura vegetal).
                for s in subs:
                    num = mapas_oficiales.get(s["id"], {}).get("numero", "")
                    arch = salida.parent / f"{num} Mapa {s['titulo']} {args.canton} Carta.pdf"
                    plancha.dibujar_plancha(arch, args.canton, poligono_canton, [], s["titulo"],
                        mdef.get("institucion", ""), municipalidad=municipalidad, escudo=logo,
                        fecha=fecha_corta, lamina_num=i, total=total, numero=num,
                        cantones_full=cantones, raster=raster_dict(s["cat"], s["transform"]))
                    planchas_hechas.append(arch); hechos += 1
                    print(f"  ✓ {arch.name}")
                if hechos == 0:
                    print(f"  (sin datos de bioaptitud para {args.canton})")
                continue

            # Eje Geoaptitud: factores (geodinámica, estabilidad, amenazas) + integrado.
            if mid == "geo_integrado":
                import geoaptitud
                canton_m = poligono_canton.to_crs("EPSG:5367")
                facs = geoaptitud.factores(capas_por_nombre, canton_m, pendientes)
                cat_int, tr_int = geoaptitud.integrado(facs)
                hechos = 0
                if cat_int is not None:
                    arch = salida.parent / f"{mdef.get('numero','')} Mapa IFA Geoaptitud {args.canton} Carta.pdf"
                    plancha.dibujar_plancha(arch, args.canton, poligono_canton, [], "IFA Geoaptitud",
                        mdef.get("institucion", ""), municipalidad=municipalidad, escudo=logo,
                        fecha=fecha_corta, lamina_num=i, total=total, numero=mdef.get("numero", ""),
                        cantones_full=cantones, raster=raster_dict(cat_int, tr_int))
                    planchas_hechas.append(arch); hechos += 1
                    print(f"  ✓ {arch.name}")
                for s in facs:
                    num = mapas_oficiales.get(s["id"], {}).get("numero", "")
                    arch = salida.parent / f"{num} Mapa {s['titulo']} {args.canton} Carta.pdf"
                    plancha.dibujar_plancha(arch, args.canton, poligono_canton, [], s["titulo"],
                        mdef.get("institucion", ""), municipalidad=municipalidad, escudo=logo,
                        fecha=fecha_corta, lamina_num=i, total=total, numero=num,
                        cantones_full=cantones, raster=raster_dict(s["cat"], s["transform"]))
                    planchas_hechas.append(arch); hechos += 1
                    print(f"  ✓ {arch.name}")
                if hechos == 0:
                    print(f"  (sin datos de geoaptitud para {args.canton}; ¿pasaste --dem?)")
                continue

            # Eje Edafoaptitud: capacidad de uso + integrado.
            if mid == "eda_integrado":
                import edafoaptitud
                canton_m = poligono_canton.to_crs("EPSG:5367")
                subs = edafoaptitud.submapas(capas_por_nombre, canton_m)
                cat_int, tr_int = edafoaptitud.integrado(subs)
                hechos = 0
                if cat_int is not None:
                    arch = salida.parent / f"{mdef.get('numero','')} Mapa IFA Edafoaptitud {args.canton} Carta.pdf"
                    plancha.dibujar_plancha(arch, args.canton, poligono_canton, [], "IFA Edafoaptitud",
                        mdef.get("institucion", ""), municipalidad=municipalidad, escudo=logo,
                        fecha=fecha_corta, lamina_num=i, total=total, numero=mdef.get("numero", ""),
                        cantones_full=cantones, raster=raster_dict(cat_int, tr_int))
                    planchas_hechas.append(arch); hechos += 1
                    print(f"  ✓ {arch.name}")
                for s in subs:
                    num = mapas_oficiales.get(s["id"], {}).get("numero", "")
                    arch = salida.parent / f"{num} Mapa {s['titulo']} {args.canton} Carta.pdf"
                    plancha.dibujar_plancha(arch, args.canton, poligono_canton, [], s["titulo"],
                        mdef.get("institucion", ""), municipalidad=municipalidad, escudo=logo,
                        fecha=fecha_corta, lamina_num=i, total=total, numero=num,
                        cantones_full=cantones, raster=raster_dict(s["cat"], s["transform"]))
                    planchas_hechas.append(arch); hechos += 1
                    print(f"  ✓ {arch.name}")
                if hechos == 0:
                    print(f"  (sin datos de edafoaptitud para {args.canton}; el INTA puede no cubrirlo)")
                continue

            # Mapa IFA de pendiente: ráster clasificado 1-5 (necesita --dem).
            raster_ifa = None
            if mid == "ifa_geoaptitud_pendiente" and pendientes is not None:
                import calificacion_ifa as C
                cat, transform, _, _ = pendientes
                ifa = C.calificar_cat_pendiente_ifa(cat)
                raster_ifa = {
                    "cat": ifa, "transform": transform,
                    "colores": {v: C.COLORES_IFA[v] for v in range(1, 6)},
                    "leyenda": [(C.etiqueta_ifa(v), C.COLORES_IFA[v]) for v in range(1, 6)],
                }
                insumos = []  # el ráster domina; no mezclamos las curvas encima

            if not insumos and raster_ifa is None:
                print(f"  (sin insumos para «{mdef['nombre']}», se omite)")
                continue
            arch = salida.parent / f"{mdef.get('numero','')} Mapa {mdef['nombre']} {args.canton} Carta.pdf"
            try:
                plancha.dibujar_plancha(
                    arch, args.canton, poligono_canton, insumos, mdef["nombre"],
                    mdef.get("institucion", ""), municipalidad=municipalidad, escudo=logo,
                    fecha=fecha_corta, lamina_num=i, total=total, numero=mdef.get("numero", ""),
                    cantones_full=cantones, raster=raster_ifa)
                planchas_hechas.append(arch)
                print(f"  ✓ {arch.name}")
            except Exception as e:
                print(f"  ERROR en «{mdef['nombre']}»: {e}", file=sys.stderr)
    else:
        # Sin configuración: PDF rápido multipágina (todas las láminas temáticas).
        armar_pdf(ruta_pdf, args.canton, poligono_canton, capas_recortadas, generado, pendientes,
                  seleccion=seleccion, municipalidad=municipalidad, logo=logo,
                  mapas_oficiales=mapas_oficiales)

    print(f"\nListo: {ruta_gpkg}")
    if planchas_hechas:
        print(f"       {len(planchas_hechas)} plancha(s) en {salida.parent}/")
    else:
        print(f"       {ruta_pdf}")
    if pendientes is not None:
        print(f"       {pendientes[2]}")


if __name__ == "__main__":
    main()
