"""Construcción del eje Edafoaptitud del IFA.

Arma el sub-mapa de capacidad de uso de la tierra (clases I-VIII, Decreto 23214), clasificado
1-5, y lo integra en el IFA Edafoaptitud. Fertilidad del suelo y tipo de suelo quedan pendientes
hasta conseguir esas fuentes. Reutiliza los helpers de rasterización de bioaptitud.py.
"""

from __future__ import annotations

import re

import geopandas as gpd

import bioaptitud
import calificacion_ifa as C

_ROMANO = re.compile(r"\b(VIII|VII|VI|IV|III|II|I|V)\b")


def _clase_romana(valor) -> str | None:
    """Extrae la clase en número romano (I..VIII) de un texto como 'IV', 'VII-e', 'Clase III'."""
    m = _ROMANO.search(str(valor).upper())
    return m.group(1) if m else None


def clasificar_capacidad(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Agrega columna 'ifa' según la clase de capacidad de uso."""
    g = gdf.copy()
    col = bioaptitud._columna(g, ["clase", "clase_capa", "cap_uso", "capacidad", "categoria",
                                  "subclase", "clase_uso", "descripcio"])
    if col is None:
        g["ifa"] = 0
    else:
        g["ifa"] = g[col].map(lambda v: C.CAPACIDAD_USO_IFA.get(_clase_romana(v), 0)).fillna(0).astype(int)
    return g


def submapas(capas_por_nombre: dict, canton_m: gpd.GeoDataFrame, res: float = 100.0) -> list[dict]:
    salidas = []
    cap = capas_por_nombre.get("Capacidad de uso de la tierra")
    if cap is not None and not cap.empty:
        g = clasificar_capacidad(cap)
        cat, tr = bioaptitud.rasterizar(g, canton_m, res)
        salidas.append({"id": "eda_capacidad_uso", "titulo": "IFA Capacidad de uso de la tierra",
                        "cat": cat, "transform": tr})
    return salidas


def integrado(submapas_lista: list[dict]):
    return bioaptitud.integrado(submapas_lista)
