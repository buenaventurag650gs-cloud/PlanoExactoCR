"""Construcción del eje Bioaptitud del IFA (IFA Biológico).

Arma los sub-mapas de bioaptitud (categorías de manejo, cobertura vegetal, biotopos sensibles),
cada uno clasificado 1-5 con la rampa oficial del IFA, los rasteriza sobre una grilla común
recortada al cantón, y los integra en el IFA Bioaptitud. Todo en EPSG:5367 (CRTM05).

Lo usa build_atlas.py. Las tablas de calificación están en calificacion_ifa.py (editable).
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
from rasterio import features
from rasterio.transform import from_bounds

import calificacion_ifa as C

CRS_METRICO = "EPSG:5367"


def _columna(gdf: gpd.GeoDataFrame, candidatos: list[str]):
    """Busca en el GeoDataFrame la primera columna cuyo nombre coincida (sin importar
    mayúsculas) con alguno de los candidatos. Devuelve el nombre real o None."""
    cols = {c.lower(): c for c in gdf.columns}
    for cand in candidatos:
        if cand.lower() in cols:
            return cols[cand.lower()]
    return None


def clasificar(gdf: gpd.GeoDataFrame, tabla: dict, candidatos: list[str], default: int) -> gpd.GeoDataFrame:
    """Agrega una columna 'ifa' (1-5) a partir de la categoría del dato. Si no encuentra la
    columna de categoría, asigna el valor por defecto a todo."""
    g = gdf.copy()
    col = _columna(g, candidatos)
    if col is None:
        g["ifa"] = default
    else:
        g["ifa"] = g[col].map(lambda v: tabla.get(str(v).strip(), default)).fillna(default).astype(int)
    return g


def rasterizar(gdf_ifa: gpd.GeoDataFrame, canton_m: gpd.GeoDataFrame, res: float = 100.0):
    """Quema la columna 'ifa' en una grilla (res en metros) sobre el bbox del cantón, recortada
    al polígono del cantón. Devuelve (arreglo uint8 con 1-5, transform). 0 = sin dato."""
    minx, miny, maxx, maxy = canton_m.total_bounds
    w = max(1, int(np.ceil((maxx - minx) / res)))
    h = max(1, int(np.ceil((maxy - miny) / res)))
    transform = from_bounds(minx, miny, maxx, maxy, w, h)

    g = gdf_ifa.to_crs(CRS_METRICO)
    formas = [(geom, int(ifa)) for geom, ifa in zip(g.geometry, g["ifa"])
              if geom is not None and not geom.is_empty and ifa]
    if not formas:
        return np.zeros((h, w), dtype="uint8"), transform
    arr = features.rasterize(formas, out_shape=(h, w), transform=transform, fill=0,
                             dtype="uint8", all_touched=False)
    # Recorte al cantón.
    mascara = features.rasterize([(canton_m.union_all(), 1)], out_shape=(h, w),
                                 transform=transform, fill=0, dtype="uint8")
    arr[mascara == 0] = 0
    return arr, transform


def integrar(rasters: list[np.ndarray]) -> np.ndarray:
    """Integra varios sub-mapas (mismo tamaño) en el IFA Bioaptitud: promedio de los sub-mapas
    presentes en cada píxel (ignora 0), redondeado a 1-5. 0 donde no hay ninguno."""
    if not rasters:
        return np.zeros((1, 1), dtype="uint8")
    import warnings
    pila = np.stack(rasters).astype("float32")
    pila[pila == 0] = np.nan
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        prom = np.nanmean(pila, axis=0)
    salida = np.zeros(prom.shape, dtype="uint8")
    valido = ~np.isnan(prom)
    salida[valido] = np.clip(np.round(prom[valido]), 1, 5).astype("uint8")
    return salida


def submapas(capas_por_nombre: dict, canton_m: gpd.GeoDataFrame, res: float = 100.0) -> list[dict]:
    """Construye los sub-mapas de bioaptitud a partir de las capas disponibles. Devuelve una
    lista de dicts {id, titulo, cat, transform} listos para dibujar como lámina ráster."""
    salidas = []

    # 1. Categorías de manejo: de las áreas silvestres protegidas (clasificadas por su categoría).
    asp = capas_por_nombre.get("Áreas silvestres protegidas")
    if asp is not None and not asp.empty:
        g = clasificar(asp, C.CATEGORIA_MANEJO_IFA,
                       ["categoria", "categoría", "tipo", "cat_manejo", "descripcio", "nombre_cat"],
                       C.BIO_DEFAULT["manejo"])
        cat, tr = rasterizar(g, canton_m, res)
        salidas.append({"id": "bio_categorias_manejo", "titulo": "IFA Categorías de manejo",
                        "cat": cat, "transform": tr})

    # 2. Cobertura vegetal: de la cobertura MAF2020 (clasificada por categoría de cobertura).
    cob = capas_por_nombre.get("Cobertura MAF2020") or capas_por_nombre.get("Cobertura forestal 2020")
    if cob is not None and not cob.empty:
        g = clasificar(cob, C.COBERTURA_MAF_IFA,
                       ["categoria", "categoría", "cobertura", "clase", "tipo", "descripcio"],
                       C.BIO_DEFAULT["cobertura"])
        cat, tr = rasterizar(g, canton_m, res)
        salidas.append({"id": "bio_cobertura_vegetal", "titulo": "IFA Cobertura vegetal",
                        "cat": cat, "transform": tr})

    # 3. Biotopos sensibles: humedales (y otros biotopos si hubiera).
    hum = capas_por_nombre.get("Registro Nacional de Humedales")
    if hum is not None and not hum.empty:
        g = hum.copy(); g["ifa"] = C.BIO_DEFAULT["biotopo"]  # todo humedal = muy alta fragilidad
        cat, tr = rasterizar(g, canton_m, res)
        salidas.append({"id": "bio_biotopos", "titulo": "IFA Biotopos sensibles",
                        "cat": cat, "transform": tr})

    return salidas


def integrado(submapas_lista: list[dict]):
    """Integra los sub-mapas en el IFA Bioaptitud. Devuelve (cat, transform) o (None, None)."""
    if not submapas_lista:
        return None, None
    # Todos comparten la misma grilla (se rasterizan con el mismo bbox/res).
    formas = {s["cat"].shape for s in submapas_lista}
    if len(formas) != 1:
        # Por seguridad, si no coinciden, usa el primero solo.
        s = submapas_lista[0]
        return s["cat"], s["transform"]
    cat = integrar([s["cat"] for s in submapas_lista])
    return cat, submapas_lista[0]["transform"]
