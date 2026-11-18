"""Integración y categorización del IFA — una sola fuente para los cuatro ejes.

Todo mapa integrado del IFA (Geoaptitud, Bioaptitud, Edafoaptitud, Antropoaptitud, y el
IFA Integrado final) se arma igual, y ese es justamente el punto de este archivo: que los
cuatro salgan con la MISMA categorización, la misma escala y los mismos colores.

QUÉ DICE LA NORMA

- Decreto 32967-MINAE, apartado 5.8.2: el IFA Geoaptitud integrado "se obtiene por la suma
  algebraica simple de los cinco factores de geoaptitud previamente elaborados".
- Decreto 32967-MINAE, apartado 5.12.2: "La forma de calcular el Índice de Fragilidad
  Ambiental (IFA) de un espacio geográfico dado, se obtiene de la suma de todos los puntos,
  por medio de la ecuación: IFA integrado = IFA Bioaptitud + IFA Edafoaptitud +
  IFA Geoaptitud + IFA Antropoaptitud".
- O sea: SUMAR y luego RECLASIFICAR, y eso se hace en los dos niveles — al agrupar las
  variables dentro de un eje, y al agrupar los cuatro ejes en el IFA integrado.
- La escala es de 5 niveles, donde 1 (Zona I) es la fragilidad MÁS ALTA y 5 (Zona V) la más
  baja. Un valor bajo = terreno con más limitantes técnicas = más frágil.
- El decreto 44710-MINAE (vigente desde agosto de 2025) derogó el 32967 y mantiene la
  metodología IFA como su Anexo 1 ("Metodología de los IFA para elaborar EsIVA").

CÓMO SE RECLASIFICA LA SUMA

El único rango numérico que trae el 32967 es la Tabla Nº 3, "Criterio de Calificación para
IFA - Geoaptitud integrado", sobre una escala de 0 a 75 puntos (5 factores × 15 puntos):

    Muy Alta   0 - 25      Alta   25 - 35      Moderada   35 - 50
    Baja      50 - 65      Muy Baja  65 - 75

Esos cortes, llevados a proporción del máximo posible (25/75, 35/75, 50/75, 65/75), son los
UMBRALES de abajo. Usarlos como proporción, y no como puntos absolutos, deja que la misma
tabla sirva para un eje con tres sub-mapas o con cinco, que es lo que pasa en la práctica
mientras no estén todas las capas.

[VERIFICAR] La Tabla Nº 3 además pide condiciones cualitativas para las dos categorías más
frágiles ("mínimo tres factores de categoría MB" para Muy Alta, "mínimo dos" para Alta). Acá
se aplica solo el criterio numérico; la condición cualitativa queda por confirmar contra el
anexo del 44710 antes de meterla, porque interpretarla mal produce mapas difíciles de
defender ante SETENA.
"""

from __future__ import annotations

import numpy as np

# Los cinco niveles, como los rotula la lámina oficial.
NIVELES = {1: "Muy Alta", 2: "Alta", 3: "Moderada", 4: "Baja", 5: "Muy Baja"}

# Zona I..V del decreto, que es como se nombran en el texto normativo.
ZONAS = {1: "Zona I", 2: "Zona II", 3: "Zona III", 4: "Zona IV", 5: "Zona V"}

# Rampa de colores tomada píxel a píxel de una lámina IFA real aprobada
# (Ecoplan, "Índices de Fragilidad Ambiental Cantón Liberia", lámina 53, 2025).
# 1 = más frágil = rojo; 5 = menos frágil = verde oscuro.
COLORES = {
    1: "#e41a1c",  # rojo          — Muy Alta
    2: "#ff7f00",  # naranja       — Alta
    3: "#ffff33",  # amarillo      — Moderada
    4: "#94d180",  # verde claro   — Baja
    5: "#3d983a",  # verde oscuro  — Muy Baja
}

# Cortes de la Tabla Nº 3 del 32967, como proporción del máximo posible.
# (umbral, nivel): si la proporción es MENOR al umbral, cae en ese nivel.
UMBRALES = [
    (25 / 75, 1),   # 0.3333 — Muy Alta
    (35 / 75, 2),   # 0.4667 — Alta
    (50 / 75, 3),   # 0.6667 — Moderada
    (65 / 75, 4),   # 0.8667 — Baja
]                   # el resto      — Muy Baja (5)

SIN_DATO = 0


def etiqueta(valor: int) -> str:
    """'Muy Alta', 'Alta', ... como aparece en la leyenda de la lámina."""
    return NIVELES.get(int(valor), "?")


def etiqueta_larga(valor: int) -> str:
    """'Zona I — Muy Alta', para cuadros y reportes."""
    v = int(valor)
    return f"{ZONAS.get(v, '?')} — {NIVELES.get(v, '?')}"


def leyenda() -> list[tuple[str, str]]:
    """[(etiqueta, color), ...] en el orden de la lámina: de muy alta a muy baja."""
    return [(NIVELES[v], COLORES[v]) for v in range(1, 6)]


def paleta() -> dict[int, str]:
    """{1: '#e41a1c', ...} para pintar el ráster."""
    return dict(COLORES)


def sumar_y_reclasificar(rasters: list[np.ndarray]) -> np.ndarray:
    """Suma algebraica de los sub-mapas y reclasificación a 1-5 (0 = sin dato).

    Cada sub-mapa trae valores 1-5 (0 = sin dato). En cada píxel se suman los sub-mapas que
    SÍ tienen dato y la suma se mide contra el máximo que esos mismos sub-mapas podrían dar
    (n × 5); así un píxel al que le falta una capa no sale artificialmente más frágil.
    """
    if not rasters:
        return np.zeros((1, 1), dtype="uint8")

    pila = np.stack([np.asarray(r) for r in rasters]).astype("float32")
    con_dato = pila > 0
    n = con_dato.sum(axis=0)
    suma = np.where(con_dato, pila, 0).sum(axis=0)

    salida = np.zeros(suma.shape, dtype="uint8")
    hay = n > 0
    if not np.any(hay):
        return salida

    proporcion = np.zeros(suma.shape, dtype="float32")
    proporcion[hay] = suma[hay] / (n[hay] * 5.0)

    # Se parte de Muy Baja y se va bajando: cada umbral pisa al anterior.
    salida[hay] = 5
    for umbral, nivel in sorted(UMBRALES, reverse=True):
        salida[hay & (proporcion < umbral)] = nivel
    return salida


def integrar_submapas(submapas_lista: list[dict]):
    """Integra una lista de sub-mapas [{cat, transform, ...}] en (cat, transform).

    Es el paso común de los cuatro ejes: todos los sub-mapas de un eje se rasterizan sobre
    la misma grilla, así que se suman directo. Devuelve (None, None) si no hay ninguno.
    """
    if not submapas_lista:
        return None, None
    formas = {s["cat"].shape for s in submapas_lista}
    if len(formas) != 1:
        # No deberían diferir (misma grilla); si pasa, se devuelve el primero sin inventar.
        s = submapas_lista[0]
        return s["cat"], s["transform"]
    cat = sumar_y_reclasificar([s["cat"] for s in submapas_lista])
    return cat, submapas_lista[0]["transform"]


def resumen(cat: np.ndarray) -> dict[int, int]:
    """Cuenta de píxeles por nivel 1..5 (ignora el 0)."""
    cat = np.asarray(cat)
    return {v: int(np.count_nonzero(cat == v)) for v in range(1, 6)}


def reparto(cat: np.ndarray) -> dict[str, float]:
    """Porcentaje del área con dato que cae en cada nivel, para el cuadro del informe."""
    cuentas = resumen(cat)
    total = sum(cuentas.values())
    if not total:
        return {NIVELES[v]: 0.0 for v in range(1, 6)}
    return {NIVELES[v]: round(100.0 * cuentas[v] / total, 2) for v in range(1, 6)}
