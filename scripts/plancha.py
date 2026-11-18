"""Lámina cartográfica profesional (una plancha tamaño Carta por mapa), al estilo de las
láminas de un Plan de Ordenamiento Territorial: mapa con grilla de coordenadas CRTM05,
cantones vecinos rotulados, mapa de ubicación en el país, escala gráfica, flecha norte,
simbología y un cajetín con la identidad municipal, fuente, proyección y tabla escala/fecha/lámina.

Todo se dibuja en EPSG:5367 (CRTM05), el sistema oficial de Costa Rica, para que la grilla
quede en metros y la escala en kilómetros. La usa build_atlas.py cuando genera la salida final.
"""

from __future__ import annotations

import pathlib

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch, Rectangle

CRS_METRICO = "EPSG:5367"

# Colores por capa (coherentes con el tablero web).
COLORES = {
    "Límites distritales": "#444444", "Zona marítimo terrestre": "#3b82c4",
    "Estado del plan regulador por cantón": "#f0883e", "Zonas de vida": "#3fb950",
    "Red eléctrica": "#db6d28", "ASADAS y abastecimiento de agua": "#39c5cf",
    "Sedes de salud": "#e03131", "Infraestructura general": "#d29922",
    "Red vial cantonal": "#8a8f98", "Uso urbano 1:5mil": "#d9534f", "Cultivos 1:5mil": "#8fbc8f",
    "Áreas silvestres protegidas": "#1b5e20", "Corredores biológicos": "#66bb6a",
    "Patrimonio Natural del Estado": "#388e3c", "Registro Nacional de Humedales": "#4fc3f7",
    "Áreas de Conservación": "#80cbc4", "Cobertura forestal 2020": "#2d6a4f",
    "Coronas de deslizamientos": "#e03131", "Deslizamientos": "#f08c00",
    "Fallas del cuaternario": "#862e9c", "Áreas con potencial a inundación": "#1971c2",
    "Capacidad de uso de la tierra": "#a9742f",
}
COLOR_CANTON = "#d11a1a"   # límite cantonal, rojo como en la referencia
COLOR_VECINO = "#d9d9d9"   # relleno de cantones vecinos


def _paso_bonito(span: float, objetivo: int = 5) -> float:
    """Un paso de grilla 'redondo' (1,2,2.5,5 ×10^k) cercano a span/objetivo."""
    crudo = span / max(objetivo, 1)
    exp = np.floor(np.log10(crudo))
    base = crudo / (10 ** exp)
    bonito = 1 if base < 1.5 else 2 if base < 3 else 2.5 if base < 4 else 5 if base < 7.5 else 10
    return bonito * (10 ** exp)


def _barra_escala(ax, x0, y0, largo_m, texto_km):
    """Dibuja una barra de escala gráfica (dos segmentos) en coordenadas de datos (metros)."""
    h = largo_m * 0.022
    mitad = largo_m / 2
    ax.add_patch(Rectangle((x0, y0), mitad, h, facecolor="black", edgecolor="black", zorder=20))
    ax.add_patch(Rectangle((x0 + mitad, y0), mitad, h, facecolor="white", edgecolor="black", zorder=20))
    ax.text(x0, y0 + h * 1.3, "0", ha="center", va="bottom", fontsize=6, zorder=20)
    ax.text(x0 + mitad, y0 + h * 1.3, f"{texto_km/2:g}", ha="center", va="bottom", fontsize=6, zorder=20)
    ax.text(x0 + largo_m, y0 + h * 1.3, f"{texto_km:g} km", ha="center", va="bottom", fontsize=6, zorder=20)


def _flecha_norte(ax, x, y):
    ax.annotate("N", xy=(x, y), xytext=(x, y - 0.055), textcoords=ax.transAxes,
                xycoords=ax.transAxes, ha="center", va="center", fontsize=9, fontweight="bold",
                arrowprops=dict(arrowstyle="-|>", color="black", lw=1.3))


def dibujar_plancha(ruta_pdf: pathlib.Path, canton: str, poligono_canton: gpd.GeoDataFrame,
                    capas: list[tuple[str, gpd.GeoDataFrame]], titulo_mapa: str, institucion: str,
                    *, municipalidad: str | None = None, escudo=None, fecha: str = "",
                    lamina_num: int = 1, total: int = 1,
                    cantones_full: gpd.GeoDataFrame | None = None, raster=None) -> None:
    """raster (opcional): dict con cat (arreglo de categorías 1..N en EPSG:5367), transform
    (Affine), colores ({valor: hex}) y leyenda ([(etiqueta, hex), ...]). Se usa para los mapas
    IFA que son ráster, como la pendiente clasificada."""
    municipalidad = municipalidad or f"Municipalidad de {canton}"

    # Todo a CRTM05 (metros).
    canton_m = poligono_canton.to_crs(CRS_METRICO)
    minx, miny, maxx, maxy = canton_m.total_bounds
    margen = max(maxx - minx, maxy - miny) * 0.08
    ext = (minx - margen, miny - margen, maxx + margen, maxy + margen)

    fig = plt.figure(figsize=(8.5, 11))
    # Mapa principal arriba, cajetín abajo.
    ax = fig.add_axes([0.07, 0.30, 0.88, 0.64])
    ax.set_xlim(ext[0], ext[2]); ax.set_ylim(ext[1], ext[3])
    ax.set_aspect("equal")

    # Cantones vecinos (relleno gris + rótulo).
    if cantones_full is not None:
        vec = cantones_full.to_crs(CRS_METRICO)
        caja = gpd.GeoDataFrame(geometry=[gpd.GeoSeries.from_wkt(
            [f"POLYGON(({ext[0]} {ext[1]},{ext[2]} {ext[1]},{ext[2]} {ext[3]},{ext[0]} {ext[3]},{ext[0]} {ext[1]}))"]
        ).iloc[0]], crs=CRS_METRICO)
        vecinos = gpd.clip(vec, caja)
        col = "k" if "k" in vecinos.columns else vecinos.columns[0]
        for _, fila in vecinos.iterrows():
            if str(fila[col]).strip().lower() == canton.strip().lower():
                continue
            gpd.GeoSeries([fila.geometry], crs=CRS_METRICO).plot(
                ax=ax, color=COLOR_VECINO, edgecolor="#b5b5b5", linewidth=0.4, zorder=1)
            try:
                p = fila.geometry.representative_point()
                if ext[0] < p.x < ext[2] and ext[1] < p.y < ext[3]:
                    ax.text(p.x, p.y, str(fila[col]).upper(), fontsize=6.5, color="#8a8a8a",
                            ha="center", va="center", zorder=2)
            except Exception:
                pass

    # Ráster (p. ej. pendiente clasificada IFA), de fondo bajo las capas vectoriales.
    handles = [plt.Line2D([], [], color=COLOR_CANTON, linestyle=(0, (6, 3)), label="Límite cantonal")]
    if raster is not None:
        from matplotlib.colors import BoundaryNorm, ListedColormap
        cat = np.asarray(raster["cat"])
        tr = raster["transform"]
        valores = sorted(raster["colores"].keys())
        cmap = ListedColormap([raster["colores"][v] for v in valores])
        norm = BoundaryNorm(valores + [valores[-1] + 1], cmap.N)
        h, w = cat.shape
        extent_r = [tr.c, tr.c + w * tr.a, tr.f + h * tr.e, tr.f]
        datos = np.ma.masked_where(cat == 0, cat)
        ax.imshow(datos, extent=extent_r, cmap=cmap, norm=norm, interpolation="nearest", zorder=2)
        for etiqueta, color in raster.get("leyenda", []):
            handles.append(Patch(facecolor=color, label=etiqueta))

    # Capas del mapa.
    for nombre, gdf in capas:
        if gdf is None or gdf.empty:
            continue
        g = gdf.to_crs(CRS_METRICO)
        color = COLORES.get(nombre, "#1971c2")
        es_punto = g.geometry.geom_type.isin(["Point", "MultiPoint"]).all()
        es_linea = g.geometry.geom_type.isin(["LineString", "MultiLineString"]).all()
        if es_punto:
            g.plot(ax=ax, markersize=7, color=color, zorder=5)
            handles.append(plt.Line2D([], [], marker="o", color="none", markerfacecolor=color,
                                      markersize=6, label=nombre))
        elif es_linea:
            g.plot(ax=ax, color=color, linewidth=0.7, zorder=4)
            handles.append(plt.Line2D([], [], color=color, label=nombre))
        else:
            g.plot(ax=ax, color=color, alpha=0.5, edgecolor=color, linewidth=0.4, zorder=3)
            handles.append(Patch(facecolor=color, alpha=0.5, edgecolor=color, label=nombre))

    # Límite cantonal (rojo punteado, como la referencia), encima.
    canton_m.boundary.plot(ax=ax, color=COLOR_CANTON, linewidth=1.4, linestyle=(0, (6, 3)), zorder=6)

    # Grilla de coordenadas CRTM05.
    paso = _paso_bonito(max(ext[2] - ext[0], ext[3] - ext[1]), 5)
    xticks = np.arange(np.ceil(ext[0] / paso) * paso, ext[2], paso)
    yticks = np.arange(np.ceil(ext[1] / paso) * paso, ext[3], paso)
    ax.set_xticks(xticks); ax.set_yticks(yticks)
    ax.set_xticklabels([f"{int(t)}" for t in xticks], fontsize=6)
    ax.set_yticklabels([f"{int(t)}" for t in yticks], fontsize=6, rotation=90, va="center")
    ax.tick_params(top=True, right=True, labeltop=True, labelright=True, labelsize=6, length=3)
    ax.grid(True, color="#cccccc", linewidth=0.4, zorder=0)
    ax.set_xlabel(""); ax.set_ylabel("")   # geopandas añade "Easting/Northing [metre]"; se quitan
    for lado in ax.spines.values():
        lado.set_linewidth(1.0)

    # Escala gráfica y flecha norte.
    span_x = ext[2] - ext[0]
    largo = _paso_bonito(span_x * 0.35, 1)
    _barra_escala(ax, ext[0] + span_x * 0.03, ext[1] + (ext[3] - ext[1]) * 0.03, largo, largo / 1000)
    _flecha_norte(ax, 0.96, 0.96)

    # Mapa de ubicación (cantón en el país), dentro del marco, arriba a la izquierda.
    if cantones_full is not None:
        ins = fig.add_axes([0.095, 0.745, 0.185, 0.155], zorder=12)
        ins.set_facecolor("white")
        pais = cantones_full.to_crs(CRS_METRICO)
        try:
            pais.plot(ax=ins, color="#ededed", edgecolor="#b8b8b8", linewidth=0.2)
        except Exception:
            pass
        canton_m.plot(ax=ins, color=COLOR_CANTON, edgecolor=COLOR_CANTON, linewidth=0.3)
        ins.set_xticks([]); ins.set_yticks([])
        ins.set_xlabel(""); ins.set_ylabel("")
        ins.set_title("Ubicación del cantón", fontsize=6, pad=2)
        for lado in ins.spines.values():
            lado.set_linewidth(0.8); lado.set_edgecolor("#333")

    # ---------------- Cajetín ----------------
    caj = fig.add_axes([0.07, 0.04, 0.88, 0.22]); caj.axis("off")
    caj.set_xlim(0, 1); caj.set_ylim(0, 1)
    caj.add_patch(Rectangle((0, 0), 1, 1, fill=False, edgecolor="black", linewidth=1.2))
    # Columnas del cajetín.
    cols = [0.0, 0.40, 0.66, 0.84, 1.0]
    for x in cols[1:-1]:
        caj.plot([x, x], [0, 1], color="black", linewidth=0.8)

    # Celda 1: título POT + simbología.
    caj.text(0.02, 0.92, f"Plan de Ordenamiento Territorial\ndel cantón de {canton}",
             fontsize=9, fontweight="bold", va="top")
    caj.text(0.02, 0.60, "Simbología", fontsize=8, fontweight="bold", va="top")
    y = 0.50
    for h in handles[:9]:
        color = h.get_facecolor() if hasattr(h, "get_facecolor") else h.get_color()
        try:
            es_rgba = color is not None and (not isinstance(color, str))
            c = color if color != "none" and not (es_rgba and len(color) and color[-1] == 0) else h.get_edgecolor()
        except Exception:
            c = "#333"
        caj.add_patch(Rectangle((0.02, y - 0.012), 0.03, 0.025, facecolor=c, edgecolor="#777", linewidth=0.3))
        caj.text(0.065, y, h.get_label(), fontsize=6.5, va="center")
        y -= 0.052

    # Celda 2: título del mapa + fuente.
    tit = titulo_mapa if len(titulo_mapa) <= 20 else titulo_mapa.replace(" — ", "\n", 1)
    caj.text(0.415, 0.92, tit, fontsize=11, fontweight="bold", va="top")
    caj.text(0.415, 0.60, institucion, fontsize=6.5, style="italic", va="top", color="#555")
    caj.text(0.415, 0.44, "Fuente:\nCoberturas cartográficas del SNIT (IGN,\nMOPT), CNE, SINAC, INTA-MAG.\n"
                          "Elaboración propia.", fontsize=6, va="top")

    # Celda 3: municipalidad (ajustada) + escudo.
    muni_txt = municipalidad.replace("Municipalidad de ", "Municipalidad\nde ")
    caj.text(0.675, 0.94, muni_txt, fontsize=7.5, fontweight="bold", va="top")
    img = _cargar_escudo(escudo)
    if img is not None:
        ejes_esc = fig.add_axes([0.07 + 0.88 * 0.675, 0.055, 0.10, 0.11])
        ejes_esc.imshow(img); ejes_esc.axis("off")

    # Celda 4: norte + proyección + tabla.
    caj.annotate("N", xy=(0.92, 0.80), xytext=(0.92, 0.66), xycoords="axes fraction",
                 textcoords="axes fraction", ha="center", fontsize=8, fontweight="bold",
                 arrowprops=dict(arrowstyle="-|>", color="black", lw=1.1))
    caj.text(0.852, 0.52, "Proyección:\nCRTM05 (EPSG:5367)\nDatum Costa Rica 2005", fontsize=6, va="top")
    # Mini tabla escala/fecha/lámina.
    caj.plot([0.84, 1.0], [0.30, 0.30], color="black", linewidth=0.6)
    caj.plot([0.895, 0.895], [0.0, 0.30], color="black", linewidth=0.6)
    caj.plot([0.95, 0.95], [0.0, 0.30], color="black", linewidth=0.6)
    caj.text(0.852, 0.23, "ESCALA", fontsize=5, fontweight="bold")
    caj.text(0.905, 0.23, "FECHA", fontsize=5, fontweight="bold")
    caj.text(0.957, 0.23, "LÁMINA", fontsize=5, fontweight="bold")
    caj.text(0.852, 0.10, "gráfica", fontsize=5.5)
    caj.text(0.905, 0.10, fecha, fontsize=5.5)
    caj.text(0.957, 0.10, f"{lamina_num}/{total}", fontsize=5.5)

    fig.savefig(ruta_pdf, dpi=200)
    plt.close(fig)


def _cargar_escudo(escudo):
    """escudo puede ser una ruta, un data URL base64, o un arreglo de imagen ya cargado."""
    if escudo is None:
        return None
    if isinstance(escudo, np.ndarray):
        return escudo
    try:
        if isinstance(escudo, str) and escudo.startswith("data:") and "," in escudo:
            import base64, io
            return plt.imread(io.BytesIO(base64.b64decode(escudo.split(",", 1)[1])))
        return plt.imread(escudo)
    except Exception:
        return None
