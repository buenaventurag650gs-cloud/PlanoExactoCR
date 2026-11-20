"""Construcción del eje Geoaptitud del IFA.

Arma los factores de geoaptitud que se pueden calcular con los datos disponibles
(geodinámica externa desde la pendiente, estabilidad de laderas desde la pendiente, amenazas
naturales desde las capas de la CNE) y los integra en el IFA Geoaptitud. Todo en EPSG:5367.

Los factores litopetrofísico e hidrogeológico quedan pendientes hasta conseguir la geología.
Lo usa build_atlas.py. Tablas de calificación en calificacion_ifa.py.
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
from rasterio import features

import calificacion_ifa as C
import integracion_ifa

CRS_METRICO = "EPSG:5367"

# Estabilidad de laderas por categoría de pendiente (Decreto 23214): más empinado = menos
# estable = más frágil.
ESTABILIDAD_CAT_IFA = {1: 5, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1, 7: 1}

# Calificación de amenaza por tipo (presencia de la amenaza = alta fragilidad).
AMENAZA_IFA = {
    "Deslizamientos": 1, "Coronas de deslizamientos": 1, "Fallas del cuaternario": 1,
    "Áreas con potencial a inundación": 2,
}
AMENAZA_BASE = 4  # el resto del cantón, sin amenaza mapeada → baja fragilidad por amenaza


def factor_geodinamica(cat_pendiente: np.ndarray) -> np.ndarray:
    """Geodinámica externa a partir de la pendiente (Tabla 8)."""
    return C.calificar_cat_pendiente_ifa(cat_pendiente)


def factor_estabilidad(cat_pendiente: np.ndarray) -> np.ndarray:
    """Estabilidad de laderas a partir de la pendiente."""
    out = np.zeros(cat_pendiente.shape, dtype="uint8")
    for c, v in ESTABILIDAD_CAT_IFA.items():
        out[cat_pendiente == c] = v
    return out


def _rasterizar(gdf: gpd.GeoDataFrame, valor: int, transform, shape) -> np.ndarray:
    g = gdf.to_crs(CRS_METRICO)
    formas = [(geom, int(valor)) for geom in g.geometry if geom is not None and not geom.is_empty]
    if not formas:
        return np.zeros(shape, dtype="uint8")
    return features.rasterize(formas, out_shape=shape, transform=transform, fill=0, dtype="uint8")


def factor_amenazas(capas_por_nombre: dict, canton_m: gpd.GeoDataFrame, transform, shape) -> np.ndarray:
    """Factor amenazas naturales sobre la grilla dada: el cantón empieza en AMENAZA_BASE y
    cada amenaza presente baja la calificación (más frágil) donde aparece."""
    base = _rasterizar(canton_m, AMENAZA_BASE, transform, shape)
    for nombre, ifa in AMENAZA_IFA.items():
        g = capas_por_nombre.get(nombre)
        if g is None or g.empty:
            continue
        r = _rasterizar(g, ifa, transform, shape)
        hay = r > 0
        # Donde hay amenaza, gana la más frágil (valor IFA más bajo).
        base = np.where(hay, np.minimum(np.where(base == 0, 99, base), r), base).astype("uint8")
    base[base == 99] = 0
    return base


def factores(capas_por_nombre: dict, canton_m: gpd.GeoDataFrame, pendientes=None,
             res: float = 100.0) -> list[dict]:
    """Construye los factores de geoaptitud disponibles.

    `pendientes` = (cat, transform, ruta_tif, Pmod) del DEM, o None. Sin DEM no se pueden
    calcular la geodinámica externa ni la estabilidad de laderas, pero el factor de amenazas
    naturales sí sale, así que el eje igual produce su mapa integrado (parcial).
    Devuelve lista de {id, titulo, cat, transform}.
    """
    salidas = []
    if pendientes is not None:
        cat_p, tr, _, _ = pendientes
        forma = cat_p.shape
        salidas.append({"id": "geo_geodinamica", "titulo": "IFA Geodinámica externa",
                        "cat": factor_geodinamica(cat_p), "transform": tr})
        salidas.append({"id": "geo_estabilidad", "titulo": "IFA Estabilidad de laderas",
                        "cat": factor_estabilidad(cat_p), "transform": tr})
    else:
        # Sin DEM: se arma una grilla propia sobre el cantón solo para el factor de amenazas.
        import bioaptitud
        vacio = canton_m.copy()
        vacio["ifa"] = 1
        _, tr = bioaptitud.rasterizar(vacio, canton_m, res)
        minx, miny, maxx, maxy = canton_m.total_bounds
        forma = (max(1, int(np.ceil((maxy - miny) / res))),
                 max(1, int(np.ceil((maxx - minx) / res))))

    salidas.append({"id": "geo_amenazas", "titulo": "IFA Amenazas naturales",
                    "cat": factor_amenazas(capas_por_nombre, canton_m, tr, forma), "transform": tr})
    return salidas


def integrado(factores_lista: list[dict]):
    """Integra los factores en el IFA Geoaptitud (suma algebraica + reclasificación).
    Devuelve (cat, transform) o (None, None)."""
    return integracion_ifa.integrar_submapas(factores_lista)
