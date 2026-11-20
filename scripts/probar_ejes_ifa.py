"""Prueba los cuatro ejes del IFA con datos inventados, para no tener que bajar capas reales.

Arma un cantón cuadrado de 10 x 10 km en CRTM05 con polígonos conocidos encima (una mancha
urbana, un cultivo, un área protegida, un deslizamiento, una vía...) y comprueba que cada eje
le ponga a cada sitio el valor IFA que corresponde según las tablas de calificacion_ifa.py.

Sirve de red de seguridad: si alguien cambia una tabla de calificación o el orden en que se
pintan las capas, esto lo avisa.

Uso:  python3 scripts/probar_ejes_ifa.py
"""

from __future__ import annotations

import pathlib
import sys

import geopandas as gpd
import numpy as np
from shapely.geometry import LineString, Polygon

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import antropoaptitud  # noqa: E402
import bioaptitud  # noqa: E402
import calificacion_ifa as C  # noqa: E402
import edafoaptitud  # noqa: E402
import geoaptitud  # noqa: E402

CRS = "EPSG:5367"
X0, Y0, LADO = 480000, 1090000, 10000
RES = 100.0

fallos: list[str] = []
oks: list[str] = []


def afirmar(cond: bool, msg: str) -> None:
    (oks if cond else fallos).append(msg)


def cuadro(x, y, lado):
    return Polygon([(x, y), (x + lado, y), (x + lado, y + lado), (x, y + lado)])


def capa(geoms, **cols):
    return gpd.GeoDataFrame(cols, geometry=list(geoms), crs=CRS)


CANTON = capa([cuadro(X0, Y0, LADO)])


def valor(cat, transform, x, y) -> int:
    """Valor IFA del píxel que contiene el punto (x, y) en metros CRTM05."""
    col = int((x - transform.c) / transform.a)
    fil = int((y - transform.f) / transform.e)
    return int(cat[fil, col])


# ------------------------------------------------------------------ Bioaptitud
def probar_bioaptitud():
    asp = capa([cuadro(X0 + 1000, Y0 + 1000, 2000)], categoria=["Parque Nacional"])
    maf = capa([cuadro(X0 + 5000, Y0 + 1000, 2000), cuadro(X0 + 5000, Y0 + 5000, 2000)],
               CATEGORIA=["Bosque", "Pasto"])
    hum = capa([cuadro(X0 + 1000, Y0 + 7000, 1000)])
    subs = bioaptitud.submapas({"Áreas silvestres protegidas": asp, "Cobertura MAF2020": maf,
                                "Registro Nacional de Humedales": hum}, CANTON, RES)
    ids = [s["id"] for s in subs]
    afirmar(ids == ["bio_categorias_manejo", "bio_cobertura_vegetal", "bio_biotopos"],
            f"bio: arma los tres sub-mapas ({ids})")
    por_id = {s["id"]: s for s in subs}
    s = por_id["bio_categorias_manejo"]
    afirmar(valor(s["cat"], s["transform"], X0 + 2000, Y0 + 2000) == 1,
            "bio: un Parque Nacional califica 1 (muy alta fragilidad)")
    s = por_id["bio_cobertura_vegetal"]
    afirmar(valor(s["cat"], s["transform"], X0 + 6000, Y0 + 2000) == C.COBERTURA_MAF_IFA["Bosque"],
            "bio: el bosque del MAF califica 1")
    afirmar(valor(s["cat"], s["transform"], X0 + 6000, Y0 + 6000) == C.COBERTURA_MAF_IFA["Pasto"],
            "bio: el pasto del MAF califica 4")
    s = por_id["bio_biotopos"]
    afirmar(valor(s["cat"], s["transform"], X0 + 1500, Y0 + 7500) == 1,
            "bio: un humedal califica 1")
    cat, _ = bioaptitud.integrado(subs)
    afirmar(cat is not None and cat.max() <= 5 and cat.min() >= 0,
            "bio: el integrado queda dentro de 0-5")


# ------------------------------------------------------------------ Geoaptitud
def probar_geoaptitud():
    desl = capa([cuadro(X0 + 2000, Y0 + 2000, 1000)])
    inund = capa([cuadro(X0 + 6000, Y0 + 6000, 1000)])
    _, tr = bioaptitud.rasterizar(
        capa([cuadro(X0, Y0, LADO)]).assign(ifa=1), CANTON, RES)
    forma = (int(LADO / RES), int(LADO / RES))
    am = geoaptitud.factor_amenazas({"Deslizamientos": desl,
                                     "Áreas con potencial a inundación": inund}, CANTON, tr, forma)
    afirmar(valor(am, tr, X0 + 2500, Y0 + 2500) == geoaptitud.AMENAZA_IFA["Deslizamientos"],
            "geo: dentro de un deslizamiento califica 1")
    afirmar(valor(am, tr, X0 + 6500, Y0 + 6500) == geoaptitud.AMENAZA_IFA["Áreas con potencial a inundación"],
            "geo: dentro de un área inundable califica 2")
    afirmar(valor(am, tr, X0 + 9000, Y0 + 500) == geoaptitud.AMENAZA_BASE,
            "geo: sin amenaza mapeada queda en el valor base")
    # Geodinámica y estabilidad salen de la pendiente (categorías 1-7 del decreto 23214).
    cat_pend = np.full(forma, 6, dtype="uint8")
    afirmar(int(geoaptitud.factor_estabilidad(cat_pend)[0, 0]) == geoaptitud.ESTABILIDAD_CAT_IFA[6],
            "geo: una pendiente categoría 6 da estabilidad 1")


# ---------------------------------------------------------------- Edafoaptitud
def probar_edafoaptitud():
    cap_uso = capa([cuadro(X0 + 1000, Y0 + 1000, 2000), cuadro(X0 + 5000, Y0 + 5000, 2000)],
                   CLASE=["II", "VII-e"])
    subs = edafoaptitud.submapas({"Capacidad de uso de la tierra": cap_uso}, CANTON, RES)
    afirmar(len(subs) == 1, f"edafo: arma el sub-mapa de capacidad de uso ({len(subs)})")
    s = subs[0]
    afirmar(valor(s["cat"], s["transform"], X0 + 2000, Y0 + 2000) == C.CAPACIDAD_USO_IFA["II"],
            "edafo: la clase II califica 5 (muy baja fragilidad)")
    afirmar(valor(s["cat"], s["transform"], X0 + 6000, Y0 + 6000) == C.CAPACIDAD_USO_IFA["VII"],
            "edafo: la clase VII-e se lee como VII y califica 2")


# -------------------------------------------------------------- Antropoaptitud
def probar_antropoaptitud():
    urbano = capa([cuadro(X0 + 1000, Y0 + 1000, 2000)])
    cultivos = capa([cuadro(X0 + 4000, Y0 + 1000, 3000)])
    asp = capa([cuadro(X0 + 1500, Y0 + 1500, 500)])          # encima de lo urbano
    maf = capa([cuadro(X0 + 7000, Y0 + 5000, 3000), cuadro(X0, Y0 + 5000, 4000)],
               CATEGORIA=["Bosque", "Pasto"])
    vias = capa([LineString([(X0, Y0 + 2000), (X0 + LADO, Y0 + 2500)])])
    capas = {"Uso urbano 1:5mil": urbano, "Cultivos 1:5mil": cultivos,
             "Áreas silvestres protegidas": asp, "Cobertura MAF2020": maf,
             "Red vial cantonal": vias}

    uso, tr = antropoaptitud.submapa_uso(capas, CANTON, RES)
    afirmar(valor(uso, tr, X0 + 2500, Y0 + 2500) == 5,
            "antropo: lo ya urbano califica 5 (muy baja fragilidad para desarrollar)")
    afirmar(valor(uso, tr, X0 + 1700, Y0 + 1700) == C.ANTROPO_RESTRICCION_IFA,
            "antropo: un área protegida manda sobre lo urbano y califica 1")
    afirmar(valor(uso, tr, X0 + 5500, Y0 + 2500) == C.ANTROPOAPTITUD_IFA["Cultivos 1:5mil"],
            "antropo: los cultivos califican 4")
    afirmar(valor(uso, tr, X0 + 8500, Y0 + 7000) == C.USO_ANTROPICO_MAF_IFA["Bosque"],
            "antropo: el bosque sin intervenir califica 1")
    afirmar(valor(uso, tr, X0 + 2000, Y0 + 7000) == C.USO_ANTROPICO_MAF_IFA["Pasto"],
            "antropo: el pasto califica 4")
    afirmar(valor(uso, tr, X0 + 6000, Y0 + 9000) == C.ANTROPO_BASE["uso"],
            "antropo: donde no hay dato queda el fondo (2)")

    vial, trv = antropoaptitud.submapa_vial(capas, CANTON, RES)
    cerca = valor(vial, trv, X0 + 5000, Y0 + 2250)
    lejos = valor(vial, trv, X0 + 5000, Y0 + 8000)
    afirmar(cerca == 5, f"antropo: pegado a la vía califica 5 (dio {cerca})")
    afirmar(lejos == C.ANTROPO_BASE["vial"], f"antropo: lejos de toda vía queda en el fondo (dio {lejos})")
    afirmar(cerca > lejos, "antropo: la accesibilidad baja con la distancia a la vía")

    subs = antropoaptitud.submapas(capas, CANTON, RES)
    afirmar([s["id"] for s in subs] == ["ant_uso_antropico", "ant_vialidad"],
            "antropo: arma los dos sub-mapas disponibles")
    cat, _ = antropoaptitud.integrado(subs)
    afirmar(cat is not None and 1 <= int(cat.max()) <= 5, "antropo: el integrado queda dentro de 1-5")
    afirmar(int((cat == 0).sum()) == 0, "antropo: el integrado cubre todo el cantón, sin huecos")

    # Sin ninguna capa no debe reventar, solo devolver vacío.
    afirmar(antropoaptitud.submapas({}, CANTON, RES) == [],
            "antropo: sin insumos devuelve lista vacía sin fallar")


# ------------------------------------------------- Categorización común a los cuatro ejes
def probar_categorizacion():
    """Lo que pide SETENA: que los cuatro ejes integren y categoricen EXACTAMENTE igual."""
    import integracion_ifa as I

    # 1) La rampa es la de la lámina oficial (Ecoplan, Liberia, lámina 53).
    esperados = {1: "#e41a1c", 2: "#ff7f00", 3: "#ffff33", 4: "#94d180", 5: "#3d983a"}
    afirmar(I.COLORES == esperados, f"ifa: la rampa es la de la lámina oficial ({I.COLORES})")
    afirmar([e for e, _ in I.leyenda()] == ["Muy Alta", "Alta", "Moderada", "Baja", "Muy Baja"],
            "ifa: la leyenda va de Muy Alta a Muy Baja, como la lámina")
    afirmar(C.COLORES_IFA is I.COLORES and C.NIVELES_IFA is I.NIVELES,
            "ifa: calificacion_ifa usa la misma rampa, no una copia")

    # 2) La reclasificación sigue la Tabla Nº 3 del decreto 32967 (cortes 25/35/50/65 de 75).
    #    Con 5 sub-mapas de 1-5, el máximo es 25 y los cortes caen en 8.33 / 11.67 / 16.67 / 21.67.
    def nivel_de_suma(suma, n=5):
        """Arma n sub-mapas de un píxel que sumen 'suma' y devuelve el nivel resultante."""
        base, resto = divmod(suma, n)
        valores = [base + (1 if k < resto else 0) for k in range(n)]
        assert all(1 <= v <= 5 for v in valores), valores
        return int(I.sumar_y_reclasificar([np.full((1, 1), v, dtype="uint8") for v in valores])[0, 0])

    casos = [(5, 1), (8, 1), (9, 2), (11, 2), (12, 3), (16, 3), (17, 4), (21, 4), (22, 5), (25, 5)]
    for suma, esperado in casos:
        dio = nivel_de_suma(suma)
        afirmar(dio == esperado,
                f"ifa: suma {suma}/25 → nivel {esperado} según la Tabla Nº 3 (dio {dio})")

    # 3) Todo muy frágil da 1 y todo poco frágil da 5, con cualquier cantidad de sub-mapas.
    for n in (1, 2, 3, 4, 5):
        unos = [np.full((1, 1), 1, dtype="uint8")] * n
        cincos = [np.full((1, 1), 5, dtype="uint8")] * n
        afirmar(int(I.sumar_y_reclasificar(unos)[0, 0]) == 1, f"ifa: con {n} sub-mapas, todo 1 → Muy Alta")
        afirmar(int(I.sumar_y_reclasificar(cincos)[0, 0]) == 5, f"ifa: con {n} sub-mapas, todo 5 → Muy Baja")

    # 4) Un píxel al que le falta una capa se mide contra lo que sí tiene, no sale más frágil.
    completo = I.sumar_y_reclasificar([np.full((1, 1), 4, "uint8")] * 3)
    parcial = I.sumar_y_reclasificar([np.full((1, 1), 4, "uint8"), np.full((1, 1), 4, "uint8"),
                                      np.zeros((1, 1), "uint8")])
    afirmar(int(completo[0, 0]) == int(parcial[0, 0]),
            "ifa: faltar una capa no cambia el nivel (se normaliza por las que hay)")
    afirmar(int(I.sumar_y_reclasificar([np.zeros((2, 2), "uint8")] * 2).max()) == 0,
            "ifa: sin ningún dato queda en 0 (sin dato), no en un nivel inventado")

    # 5) LO CENTRAL: los cuatro ejes, con los mismos sub-mapas, dan el mismo resultado.
    rng = np.random.default_rng(7)
    falsos = [{"id": f"s{k}", "titulo": f"s{k}", "transform": "tr",
               "cat": rng.integers(0, 6, size=(40, 40), dtype="uint8")} for k in range(3)]
    resultados = {}
    for nombre, modulo in (("bioaptitud", bioaptitud), ("geoaptitud", geoaptitud),
                           ("edafoaptitud", edafoaptitud), ("antropoaptitud", antropoaptitud)):
        cat, _ = modulo.integrado(falsos)
        resultados[nombre] = cat
    primero = resultados["bioaptitud"]
    iguales = all(np.array_equal(primero, v) for v in resultados.values())
    afirmar(iguales, "ifa: LOS CUATRO EJES integran y categorizan idéntico con los mismos insumos")
    afirmar(set(np.unique(primero)) <= {0, 1, 2, 3, 4, 5},
            "ifa: el resultado solo trae niveles válidos 0-5")

    # 6) El reparto porcentual suma 100 (es el cuadro que va en el informe).
    rep = I.reparto(primero)
    afirmar(abs(sum(rep.values()) - 100.0) < 0.5, f"ifa: el reparto por nivel suma 100% ({rep})")


def probar_catalogo_y_exportacion():
    """Que los cuatro ejes del catálogo tengan quién los exporte, y al revés."""
    import json
    import re
    raiz = pathlib.Path(__file__).resolve().parent.parent
    catalogo = json.loads((raiz / "muni" / "mapas_oficiales.json").read_text(encoding="utf-8"))
    fuente = (raiz / "scripts" / "build_atlas.py").read_text(encoding="utf-8")

    bloque = fuente[fuente.index("EJES_IFA = {"):fuente.index("EJES_IFA = {") + 1600]
    exportables = set(re.findall(r'"(\w+)": \{"modulo"', bloque))
    esperados = {"geo_integrado", "ifa_bioaptitud", "eda_integrado", "ant_integrado"}
    afirmar(exportables == esperados,
            f"export: build_atlas exporta los cuatro ejes del IFA ({sorted(exportables)})")

    # El mapa integrado que declara cada eje del catálogo debe ser uno de los exportables.
    declarados = {}
    for inst in catalogo["instituciones"]:
        if inst.get("integrado"):
            declarados[inst["id"]] = inst["integrado"]
    for eje in ("geoaptitud", "bioaptitud", "edafoaptitud", "antropoaptitud"):
        afirmar(declarados.get(eje) in exportables,
                f"export: el eje {eje} declara un integrado que sí se exporta ({declarados.get(eje)})")
        # Y debe poder marcarse (si está "pendiente", el tablero no lo deja seleccionar).
        estado = None
        for inst in catalogo["instituciones"]:
            for m in inst["mapas"]:
                if m["id"] == declarados.get(eje):
                    estado = m["estado"]
        afirmar(estado in ("disponible", "parcial"),
                f"export: el integrado del eje {eje} se puede marcar (estado: {estado})")

    # Todos los sub-mapas que devuelven los módulos deben existir en el catálogo, para que la
    # lámina salga con su número ("2.3 Mapa IFA Cobertura vegetal ...").
    ids_catalogo = {m["id"] for inst in catalogo["instituciones"] for m in inst["mapas"]}
    generados = {"bio_categorias_manejo", "bio_cobertura_vegetal", "bio_biotopos",
                 "geo_geodinamica", "geo_estabilidad", "geo_amenazas",
                 "eda_capacidad_uso", "ant_uso_antropico", "ant_vialidad"}
    faltan = sorted(generados - ids_catalogo)
    afirmar(not faltan, f"export: todo sub-mapa generado está numerado en el catálogo (faltan: {faltan})")


def probar_geoaptitud_sin_dem():
    """El eje 1 debe producir su mapa integrado aunque no haya DEM (solo con amenazas)."""
    desl = capa([cuadro(X0 + 2000, Y0 + 2000, 2000)])
    facs = geoaptitud.factores({"Deslizamientos": desl}, CANTON, None, RES)
    afirmar(len(facs) == 1 and facs[0]["id"] == "geo_amenazas",
            f"geo: sin DEM igual sale el factor de amenazas ({[f['id'] for f in facs]})")
    cat, tr = geoaptitud.integrado(facs)
    afirmar(cat is not None, "geo: sin DEM el eje igual produce su mapa integrado")
    afirmar(valor(cat, tr, X0 + 3000, Y0 + 3000) == 1,
            "geo: sin DEM, dentro del deslizamiento sigue dando Muy Alta")


def main() -> int:
    for prueba in (probar_bioaptitud, probar_geoaptitud, probar_edafoaptitud, probar_antropoaptitud,
                   probar_categorizacion, probar_catalogo_y_exportacion, probar_geoaptitud_sin_dem):
        try:
            prueba()
        except Exception as e:  # noqa: BLE001
            fallos.append(f"{prueba.__name__} reventó: {type(e).__name__}: {e}")

    print("=== PRUEBAS DE LOS EJES DEL IFA ===")
    for m in oks:
        print("  ok  " + m)
    if fallos:
        print("\nFALLOS:")
        for m in fallos:
            print("  XX  " + m)
    print(f"\n{len(oks)} ok, {len(fallos)} fallos")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
