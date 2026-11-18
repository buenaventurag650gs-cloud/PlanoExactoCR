"""Construcción del eje Antropoaptitud del IFA (decreto 44710, eje 4).

Califica qué tan intervenido está ya el territorio. El criterio va al revés que el de
bioaptitud: lo que ya está urbanizado o servido por vías tiene BAJA fragilidad para recibir
desarrollo nuevo (IFA 5), y lo que está sin intervenir o tiene una restricción legal encima
(área silvestre protegida, patrimonio) tiene ALTA fragilidad (IFA 1).

Sub-mapas que arma con los datos que hay hoy:
  4.1 Uso antrópico      — uso del suelo (urbano, cultivos, cobertura MAF) + áreas protegidas
                           y sitios arqueológicos como restricción.
  4.2 Accesibilidad vial — distancia a la red vial existente, por anillos.
  4.3 Paisajismo         — pendiente: faltan tipologías de paisaje, calidad visual e hitos.
  4.4 Integrado          — promedio de los sub-mapas disponibles.

Todo en EPSG:5367 (CRTM05). Lo usa build_atlas.py. Las tablas de calificación están en
calificacion_ifa.py (editables, marcadas [VERIFICAR] mientras no se confirmen contra el anexo
del decreto).
"""

from __future__ import annotations

import geopandas as gpd
import pandas as pd

import bioaptitud
import calificacion_ifa as C

CRS_METRICO = bioaptitud.CRS_METRICO

# Columnas donde suele venir la categoría de cobertura en las capas del MAF/IGN.
_COLS_CATEGORIA = ["categoria", "categoría", "cobertura", "clase", "tipo", "descripcio", "uso"]


def _trozo(gdf: gpd.GeoDataFrame, ifa: int) -> gpd.GeoDataFrame | None:
    """Copia la capa en CRTM05 con un valor IFA fijo. None si la capa viene vacía."""
    if gdf is None or gdf.empty:
        return None
    g = gdf.to_crs(CRS_METRICO)[["geometry"]].copy()
    g["ifa"] = int(ifa)
    return g


def _fondo(canton_m: gpd.GeoDataFrame, ifa: int) -> gpd.GeoDataFrame:
    """Todo el cantón con un valor de fondo, para que no queden huecos sin calificar."""
    g = gpd.GeoDataFrame(geometry=[canton_m.union_all()], crs=CRS_METRICO)
    g["ifa"] = int(ifa)
    return g


def _apilar(trozos: list[gpd.GeoDataFrame]) -> gpd.GeoDataFrame:
    """Une los trozos en una sola capa. El ORDEN IMPORTA: al rasterizar, lo que va después
    se pinta encima, así que la lista va de lo más general a lo más restrictivo."""
    utiles = [t for t in trozos if t is not None and not t.empty]
    if not utiles:
        return gpd.GeoDataFrame(geometry=[], crs=CRS_METRICO)
    return gpd.GeoDataFrame(pd.concat(utiles, ignore_index=True), crs=CRS_METRICO)


def submapa_uso(capas_por_nombre: dict, canton_m: gpd.GeoDataFrame, res: float = 100.0):
    """4.1 Uso antrópico: cuánto está intervenido el suelo, con las restricciones encima.
    Devuelve (cat, transform) o (None, None) si no hay ningún insumo."""
    cob = capas_por_nombre.get("Cobertura MAF2020")
    urbano = capas_por_nombre.get("Uso urbano 1:5mil")
    cultivos = capas_por_nombre.get("Cultivos 1:5mil")
    asp = capas_por_nombre.get("Áreas silvestres protegidas")
    arqueo = capas_por_nombre.get("Sitios arqueológicos registrados")
    if all(x is None or x.empty for x in (cob, urbano, cultivos, asp, arqueo)):
        return None, None

    trozos = [_fondo(canton_m, C.ANTROPO_BASE["uso"])]
    # Cobertura general del MAF, clasificada por qué tan intervenida está.
    if cob is not None and not cob.empty:
        g = bioaptitud.clasificar(cob.to_crs(CRS_METRICO), C.USO_ANTROPICO_MAF_IFA,
                                  _COLS_CATEGORIA, C.ANTROPO_BASE["uso"])
        trozos.append(g[["geometry", "ifa"]])
    # Usos concretos del IGN, que mandan sobre la cobertura general.
    trozos.append(_trozo(cultivos, C.ANTROPOAPTITUD_IFA["Cultivos 1:5mil"]))
    trozos.append(_trozo(urbano, C.ANTROPOAPTITUD_IFA["Uso urbano 1:5mil"]))
    # Restricciones legales: mandan sobre todo lo demás.
    trozos.append(_trozo(asp, C.ANTROPO_RESTRICCION_IFA))
    trozos.append(_trozo(arqueo, C.ANTROPO_RESTRICCION_IFA))

    capa = _apilar(trozos)
    if capa.empty:
        return None, None
    return bioaptitud.rasterizar(capa, canton_m, res)


def submapa_vial(capas_por_nombre: dict, canton_m: gpd.GeoDataFrame, res: float = 100.0):
    """4.2 Accesibilidad vial: anillos de distancia a la red vial existente.
    Devuelve (cat, transform) o (None, None) si no hay red vial."""
    vias = capas_por_nombre.get("Red vial cantonal")
    if vias is None or vias.empty:
        return None, None
    union = vias.to_crs(CRS_METRICO).union_all()

    trozos = [_fondo(canton_m, C.ANTROPO_BASE["vial"])]
    # De la distancia mayor a la menor, para que el anillo más cercano quede encima.
    for dist, ifa in sorted(C.VIAL_DISTANCIA_IFA, key=lambda t: -t[0]):
        anillo = gpd.GeoDataFrame(geometry=[union.buffer(dist)], crs=CRS_METRICO)
        anillo["ifa"] = int(ifa)
        trozos.append(anillo)

    return bioaptitud.rasterizar(_apilar(trozos), canton_m, res)


def submapas(capas_por_nombre: dict, canton_m: gpd.GeoDataFrame, res: float = 100.0) -> list[dict]:
    """Sub-mapas de antropoaptitud disponibles, listos para dibujar como lámina ráster."""
    salidas = []
    cat, tr = submapa_uso(capas_por_nombre, canton_m, res)
    if cat is not None:
        salidas.append({"id": "ant_uso_antropico", "titulo": "IFA Uso antrópico",
                        "cat": cat, "transform": tr})
    cat, tr = submapa_vial(capas_por_nombre, canton_m, res)
    if cat is not None:
        salidas.append({"id": "ant_vialidad", "titulo": "IFA Accesibilidad vial",
                        "cat": cat, "transform": tr})
    return salidas


def integrado(submapas_lista: list[dict]):
    """Integra los sub-mapas en el IFA Antropoaptitud. Devuelve (cat, transform)."""
    return bioaptitud.integrado(submapas_lista)
