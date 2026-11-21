"""Mapa de pendientes del terreno, clasificado según el Decreto 23214-MAG-MIRENEM.

Es el primer insumo analítico del IFA (factores geodinámico externo y estabilidad de
laderas de la geoaptitud; ver muni/METODOLOGIA_IFA.md). Toma un Modelo de Elevación
Digital (DEM) — p. ej. el que publica el IGN, descargable por hoja 1:25mil desde el SNIT
(ver muni/FUENTES_SNIT.md) — calcula la pendiente en porcentaje y la reclasifica en las
siete categorías de relieve del Decreto 23214.

Rangos oficiales (sección 6.1.1.1 del Decreto 23214):
    1 Plano o casi plano        0 a 3 %
    2 Ligeramente ondulado      3 a 8 %
    3 Moderadamente ondulado    8 a 15 %
    4 Ondulado                  15 a 30 %
    5 Fuertemente ondulado      30 a 60 %
    6 Escarpado                 60 a 75 %
    7 Fuertemente escarpado     más de 75 %

El DEM debe venir en un sistema de coordenadas MÉTRICO (p. ej. CRTM05 / EPSG:5367), para
que el tamaño de píxel esté en metros y la pendiente salga correcta. Si viene en grados
(EPSG:4326), hay que reproyectarlo antes.
"""

from __future__ import annotations

import numpy as np

# (límite inferior inclusive, límite superior exclusivo, categoría, etiqueta)
CATEGORIAS_23214 = [
    (0.0, 3.0, 1, "Plano o casi plano"),
    (3.0, 8.0, 2, "Ligeramente ondulado"),
    (8.0, 15.0, 3, "Moderadamente ondulado"),
    (15.0, 30.0, 4, "Ondulado"),
    (30.0, 60.0, 5, "Fuertemente ondulado"),
    (60.0, 75.0, 6, "Escarpado"),
    (75.0, float("inf"), 7, "Fuertemente escarpado"),
]

# Colores para las láminas (verde llano → rojo escarpado).
COLORES_PENDIENTE = {
    1: "#1a9850", 2: "#91cf60", 3: "#d9ef8b",
    4: "#fee08b", 5: "#fc8d59", 6: "#d73027", 7: "#7f0000",
}


def clasificar_pendiente(pct: np.ndarray) -> np.ndarray:
    """Reclasifica un arreglo de pendiente (en %) a las 7 categorías del Decreto 23214.
    Devuelve un arreglo uint8 con valores 1..7 (0 = sin dato / NaN)."""
    pct = np.asarray(pct, dtype="float64")
    cat = np.zeros(pct.shape, dtype="uint8")
    valido = np.isfinite(pct)
    for lo, hi, c, _ in CATEGORIAS_23214:
        cat[valido & (pct >= lo) & (pct < hi)] = c
    return cat


def pendiente_porcentaje(dem: np.ndarray, px_x: float, px_y: float) -> np.ndarray:
    """Pendiente en % a partir de una matriz de elevaciones y el tamaño de píxel en metros.
    pendiente% = 100 * sqrt((dz/dx)^2 + (dz/dy)^2)."""
    dem = np.asarray(dem, dtype="float64")
    # np.gradient devuelve (d/fila, d/columna) = (d/y, d/x); el espaciado es el tamaño de píxel.
    dz_dy, dz_dx = np.gradient(dem, abs(px_y), abs(px_x))
    return 100.0 * np.sqrt(dz_dx ** 2 + dz_dy ** 2)


def pendiente_desde_dem(dem_path: str):
    """Lee un DEM (GeoTIFF), calcula la pendiente en % y la reclasifica.
    Devuelve (pct, categorias, perfil_rasterio). Requiere rasterio."""
    import rasterio

    with rasterio.open(dem_path) as src:
        dem = src.read(1, masked=True).astype("float64").filled(np.nan)
        px_x = src.transform.a            # ancho de píxel (m si el CRS es métrico)
        px_y = src.transform.e            # alto de píxel (negativo normalmente)
        perfil = src.profile
        if src.crs is not None and src.crs.is_geographic:
            raise ValueError(
                "El DEM está en grados (CRS geográfico). Reproyectalo a un CRS métrico "
                "como CRTM05 (EPSG:5367) antes de calcular la pendiente."
            )
    pct = pendiente_porcentaje(dem, px_x, px_y)
    pct[~np.isfinite(dem)] = np.nan       # no inventar pendiente donde no hay dato
    cat = clasificar_pendiente(pct)
    return pct, cat, perfil


def resumen_categorias(cat: np.ndarray) -> dict[int, int]:
    """Cuenta de píxeles por categoría 1..7 (ignora 0)."""
    return {c: int(np.count_nonzero(cat == c)) for _, _, c, _ in CATEGORIAS_23214}
