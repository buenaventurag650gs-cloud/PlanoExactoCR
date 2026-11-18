"""Lámina cartográfica profesional (una plancha tamaño Carta por mapa), al estilo de las
láminas de un Plan de Ordenamiento Territorial: mapa con grilla de coordenadas CRTM05,
cantones vecinos rotulados, mapa de ubicación en el país, escala gráfica, flecha norte,
simbología y un cajetín con la identidad municipal, fuente, proyección y tabla escala/fecha/lámina.

Todo se dibuja en EPSG:5367 (CRTM05), el sistema oficial de Costa Rica, para que la grilla
quede en metros y la escala en kilómetros. La usa build_atlas.py cuando genera la salida final.
"""

from __future__ import annotations

import json
import pathlib

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch, Rectangle

CRS_METRICO = "EPSG:5367"

# La simbología (color, trazo, grosor, relleno) sale de muni/simbologia.json, el mismo
# archivo que usa el tablero web, para que la pantalla y el PDF salgan idénticos.
_SIMB_JSON = pathlib.Path(__file__).resolve().parent.parent / "muni" / "simbologia.json"
_simb = json.loads(_SIMB_JSON.read_text(encoding="utf-8"))
SIMBOLOGIA = _simb["capas"]
ESTILO_DEF = {"color": "#1971c2", "trazo": "solido", "peso": 0.7, "relleno": 0.4, "geom": "poligono"}
# Tamaños de papel: la plancha se diseña en proporción Carta y todo (tipografías, líneas,
# cajetín) se multiplica por k, así A3/A2 salen iguales pero con mucho más detalle.
PAPELES = {"Carta": (8.5, 11.0), "A3": (11.69, 16.54), "A2": (16.54, 23.39)}


def estilo_de(nombre: str) -> dict:
    """Estilo declarado de una capa, completado con los valores por defecto."""
    e = dict(ESTILO_DEF)
    e.update(SIMBOLOGIA.get(nombre, {}))
    return e


def _guion(trazo: str, k: float = 1.0):
    """Patrón de línea de matplotlib según el trazo declarado."""
    if trazo == "guion":
        return (0, (5 * k, 3 * k))
    if trazo == "punteado":
        return (0, (1.4 * k, 2.4 * k))
    return "solid"


COLOR_CANTON = "#d11a1a"   # límite cantonal, rojo como en la referencia
COLOR_VECINO = "#d9d9d9"   # relleno de cantones vecinos


def _paso_bonito(span: float, objetivo: int = 5) -> float:
    """Un paso de grilla 'redondo' (1,2,2.5,5 ×10^k) cercano a span/objetivo."""
    crudo = span / max(objetivo, 1)
    exp = np.floor(np.log10(crudo))
    base = crudo / (10 ** exp)
    bonito = 1 if base < 1.5 else 2 if base < 3 else 2.5 if base < 4 else 5 if base < 7.5 else 10
    return bonito * (10 ** exp)


def _barra_escala(ax, x0, y0, largo_m, texto_km, k=1.0):
    """Dibuja una barra de escala gráfica (dos segmentos) en coordenadas de datos (metros)."""
    h = largo_m * 0.022
    mitad = largo_m / 2
    ax.add_patch(Rectangle((x0, y0), mitad, h, facecolor="black", edgecolor="black", zorder=20))
    ax.add_patch(Rectangle((x0 + mitad, y0), mitad, h, facecolor="white", edgecolor="black", zorder=20))
    ax.text(x0, y0 + h * 1.3, "0", ha="center", va="bottom", fontsize=6 * k, zorder=20)
    ax.text(x0 + mitad, y0 + h * 1.3, f"{texto_km/2:g}", ha="center", va="bottom", fontsize=6 * k, zorder=20)
    ax.text(x0 + largo_m, y0 + h * 1.3, f"{texto_km:g} km", ha="center", va="bottom", fontsize=6 * k, zorder=20)


def _flecha_norte(ax, x, y, k=1.0):
    ax.annotate("N", xy=(x, y), xytext=(x, y - 0.055), textcoords=ax.transAxes,
                xycoords=ax.transAxes, ha="center", va="center", fontsize=9 * k, fontweight="bold",
                arrowprops=dict(arrowstyle="-|>", color="black", lw=1.3 * k))


def dibujar_plancha(ruta_pdf: pathlib.Path, canton: str, poligono_canton: gpd.GeoDataFrame,
                    capas: list[tuple[str, gpd.GeoDataFrame]], titulo_mapa: str, institucion: str,
                    *, municipalidad: str | None = None, escudo=None, fecha: str = "",
                    lamina_num: int = 1, total: int = 1, numero: str = "",
                    cantones_full: gpd.GeoDataFrame | None = None, raster=None,
                    papel: str = "Carta") -> None:
    """raster (opcional): dict con cat (arreglo de categorías 1..N en EPSG:5367), transform
    (Affine), colores ({valor: hex}) y leyenda ([(etiqueta, hex), ...]). Se usa para los mapas
    IFA que son ráster, como la pendiente clasificada."""
    municipalidad = municipalidad or f"Municipalidad de {canton}"
    ancho_in, alto_in = PAPELES.get(papel, PAPELES["Carta"])
    k = ancho_in / 8.5          # factor de escala respecto a Carta

    # Todo a CRTM05 (metros).
    canton_m = poligono_canton.to_crs(CRS_METRICO)
    minx, miny, maxx, maxy = canton_m.total_bounds
    margen = max(maxx - minx, maxy - miny) * 0.08
    ext = (minx - margen, miny - margen, maxx + margen, maxy + margen)

    fig = plt.figure(figsize=(ancho_in, alto_in))
    # Título grande y visible arriba (número + nombre), como en la lámina de referencia.
    titulo_grande = (f"{numero}  {titulo_mapa}" if numero else titulo_mapa).upper()
    fig.text(0.5, 0.965, titulo_grande, ha="center", va="top", fontsize=17 * k, fontweight="bold")
    # Mapa principal (más grande), cajetín abajo.
    ax = fig.add_axes([0.06, 0.27, 0.90, 0.66])
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
                ax=ax, color=COLOR_VECINO, edgecolor="#b5b5b5", linewidth=0.4 * k, zorder=1)
            try:
                p = fila.geometry.representative_point()
                if ext[0] < p.x < ext[2] and ext[1] < p.y < ext[3]:
                    ax.text(p.x, p.y, str(fila[col]).upper(), fontsize=6.5 * k, color="#8a8a8a",
                            ha="center", va="center", zorder=2)
            except Exception:
                pass

    # Ráster (p. ej. pendiente clasificada IFA), de fondo bajo las capas vectoriales.
    handles = [plt.Line2D([], [], color=COLOR_CANTON, linestyle=(0, (6, 3)), label="Límite cantonal")]
    # (etiqueta, color, forma, trazo) para dibujar los cuadritos del cajetín.
    simbolos = [("Límite cantonal", COLOR_CANTON, "linea", "guion")]
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
        if raster.get("titulo_leyenda"):
            simbolos.append((raster["titulo_leyenda"], None, "titulo", None))
        for etiqueta, color in raster.get("leyenda", []):
            handles.append(Patch(facecolor=color, label=etiqueta))
            simbolos.append((etiqueta, color, "poligono", "solido"))

    # Capas del mapa, con el color, trazo, grosor y relleno declarados en simbologia.json
    # (el mismo archivo que usa el tablero, así la pantalla y el PDF coinciden).
    for nombre, gdf in capas:
        if gdf is None or gdf.empty:
            continue
        g = gdf.to_crs(CRS_METRICO)
        e = estilo_de(nombre)
        color, peso, relleno = e["color"], e["peso"] * k, e["relleno"]
        guion = _guion(e["trazo"], k)
        es_punto = g.geometry.geom_type.isin(["Point", "MultiPoint"]).all()
        es_linea = g.geometry.geom_type.isin(["LineString", "MultiLineString"]).all()
        if es_punto:
            g.plot(ax=ax, markersize=7 * k, color=color, zorder=5)
            handles.append(plt.Line2D([], [], marker="o", color="none", markerfacecolor=color,
                                      markersize=6 * k, label=nombre))
        elif es_linea:
            g.plot(ax=ax, color=color, linewidth=max(peso, 0.08), linestyle=guion, zorder=4)
            handles.append(plt.Line2D([], [], color=color, linestyle=guion, label=nombre))
        else:
            g.plot(ax=ax, color=color, alpha=max(relleno, 0.05), edgecolor=color,
                   linewidth=max(peso, 0.08), linestyle=guion, zorder=3)
            handles.append(Patch(facecolor=color, alpha=max(relleno, 0.05), edgecolor=color, label=nombre))
        simbolos.append((nombre, color, e["geom"], e["trazo"]))

    # Límite cantonal (rojo punteado, como la referencia), encima.
    canton_m.boundary.plot(ax=ax, color=COLOR_CANTON, linewidth=1.4 * k, linestyle=(0, (6, 3)), zorder=6)

    # Grilla de coordenadas CRTM05.
    paso = _paso_bonito(max(ext[2] - ext[0], ext[3] - ext[1]), 5)
    xticks = np.arange(np.ceil(ext[0] / paso) * paso, ext[2], paso)
    yticks = np.arange(np.ceil(ext[1] / paso) * paso, ext[3], paso)
    ax.set_xticks(xticks); ax.set_yticks(yticks)
    ax.set_xticklabels([f"{int(t)}" for t in xticks], fontsize=6 * k)
    ax.set_yticklabels([f"{int(t)}" for t in yticks], fontsize=6 * k, rotation=90, va="center")
    ax.tick_params(top=True, right=True, labeltop=True, labelright=True, labelsize=6, length=3)
    ax.grid(True, color="#cccccc", linewidth=0.4 * k, zorder=0)
    ax.set_xlabel(""); ax.set_ylabel("")   # geopandas añade "Easting/Northing [metre]"; se quitan
    for lado in ax.spines.values():
        lado.set_linewidth(1.0)

    # Escala gráfica y flecha norte.
    span_x = ext[2] - ext[0]
    largo = _paso_bonito(span_x * 0.35, 1)
    _barra_escala(ax, ext[0] + span_x * 0.03, ext[1] + (ext[3] - ext[1]) * 0.03, largo, largo / 1000, k)
    _flecha_norte(ax, 0.96, 0.96, k)

    # Mapa de ubicación (cantón en el país), dentro del marco, arriba a la izquierda.
    if cantones_full is not None:
        ins = fig.add_axes([0.095, 0.745, 0.185, 0.155], zorder=12)
        ins.set_facecolor("white")
        pais = cantones_full.to_crs(CRS_METRICO)
        try:
            pais.plot(ax=ins, color="#ededed", edgecolor="#b8b8b8", linewidth=0.2 * k)
        except Exception:
            pass
        canton_m.plot(ax=ins, color=COLOR_CANTON, edgecolor=COLOR_CANTON, linewidth=0.3 * k)
        ins.set_xticks([]); ins.set_yticks([])
        ins.set_xlabel(""); ins.set_ylabel("")
        ins.set_title("Ubicación del cantón", fontsize=6 * k, pad=2)
        for lado in ins.spines.values():
            lado.set_linewidth(0.8); lado.set_edgecolor("#333")

    # ---------------- Cajetín ----------------
    caj = fig.add_axes([0.07, 0.04, 0.88, 0.22]); caj.axis("off")
    caj.set_xlim(0, 1); caj.set_ylim(0, 1)
    caj.add_patch(Rectangle((0, 0), 1, 1, fill=False, edgecolor="black", linewidth=1.2 * k))
    # Columnas del cajetín.
    cols = [0.0, 0.40, 0.66, 0.84, 1.0]
    for x in cols[1:-1]:
        caj.plot([x, x], [0, 1], color="black", linewidth=0.8 * k)

    # Celda 1: título POT + simbología.
    caj.text(0.02, 0.92, f"Plan de Ordenamiento Territorial\ndel cantón de {canton}",
             fontsize=9 * k, fontweight="bold", va="top")
    caj.text(0.02, 0.60, "Simbología", fontsize=8 * k, fontweight="bold", va="top")
    y = 0.50
    for etiqueta, c, forma, trazo in simbolos[:10]:
        if forma == "titulo":
            caj.text(0.02, y, etiqueta, fontsize=7 * k, fontweight="bold", va="center")
            y -= 0.052
            continue
        if forma == "linea":
            caj.plot([0.02, 0.05], [y, y], color=c, linewidth=1.6 * k,
                     linestyle=_guion(trazo), solid_capstyle="butt")
        elif forma == "punto":
            caj.plot([0.035], [y], marker="o", color=c, markersize=4 * k, linestyle="none")
        else:
            caj.add_patch(Rectangle((0.02, y - 0.012), 0.03, 0.025, facecolor=c, alpha=0.65,
                                    edgecolor=c, linewidth=0.5 * k))
        caj.text(0.065, y, etiqueta, fontsize=6.5 * k, va="center")
        y -= 0.052

    # Celda 2: título del mapa + fuente.
    tit = titulo_mapa if len(titulo_mapa) <= 20 else titulo_mapa.replace(" — ", "\n", 1)
    caj.text(0.415, 0.92, tit, fontsize=11 * k, fontweight="bold", va="top")
    caj.text(0.415, 0.60, institucion, fontsize=6.5 * k, style="italic", va="top", color="#555")
    caj.text(0.415, 0.44, "Fuente:\nCoberturas cartográficas del SNIT (IGN,\nMOPT), CNE, SINAC, INTA-MAG.\n"
                          "Elaboración propia.", fontsize=6 * k, va="top")

    # Celda 3: municipalidad (ajustada) + escudo.
    muni_txt = municipalidad.replace("Municipalidad de ", "Municipalidad\nde ")
    caj.text(0.675, 0.94, muni_txt, fontsize=7.5 * k, fontweight="bold", va="top")
    img = _cargar_escudo(escudo)
    if img is not None:
        ejes_esc = fig.add_axes([0.07 + 0.88 * 0.675, 0.055, 0.10, 0.11])
        ejes_esc.imshow(img); ejes_esc.axis("off")

    # Celda 4: norte + proyección + tabla.
    caj.annotate("N", xy=(0.92, 0.80), xytext=(0.92, 0.66), xycoords="axes fraction",
                 textcoords="axes fraction", ha="center", fontsize=8 * k, fontweight="bold",
                 arrowprops=dict(arrowstyle="-|>", color="black", lw=1.1 * k))
    caj.text(0.852, 0.52, "Proyección:\nCRTM05 (EPSG:5367)\nDatum Costa Rica 2005", fontsize=6 * k, va="top")
    # Mini tabla escala/fecha/lámina.
    # La columna de FECHA es la más ancha: "18/11/2026" no cabía y se montaba sobre LÁMINA.
    caj.plot([0.84, 1.0], [0.30, 0.30], color="black", linewidth=0.6 * k)
    caj.plot([0.886, 0.886], [0.0, 0.30], color="black", linewidth=0.6 * k)
    caj.plot([0.952, 0.952], [0.0, 0.30], color="black", linewidth=0.6 * k)
    caj.text(0.863, 0.23, "ESCALA", fontsize=4.6 * k, fontweight="bold", ha="center")
    caj.text(0.919, 0.23, "FECHA", fontsize=4.6 * k, fontweight="bold", ha="center")
    caj.text(0.976, 0.23, "LÁMINA", fontsize=4.6 * k, fontweight="bold", ha="center")
    caj.text(0.863, 0.10, "gráfica", fontsize=5.2 * k, ha="center")
    caj.text(0.919, 0.10, fecha, fontsize=5.2 * k, ha="center")
    caj.text(0.976, 0.10, f"{lamina_num}/{total}", fontsize=5.2 * k, ha="center")

    fig.savefig(ruta_pdf, dpi=300)
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
