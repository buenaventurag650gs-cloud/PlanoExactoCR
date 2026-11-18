"""Tablas de calificación del IFA — Índice de Fragilidad Ambiental (escala 1-5).

Fuente única de las reglas de calificación para armar los mapas de fragilidad que pide
SETENA bajo el decreto 44710-MINAE (Metodología 1 / IFA). Cada variable del territorio
se califica de 1 a 5, con una convención CONTRAINTUITIVA que viene del método oficial:

    1 = Muy Alta fragilidad   (más limitaciones, menos apto para desarrollar)
    2 = Alta
    3 = Moderada
    4 = Baja
    5 = Muy Baja fragilidad   (menos limitaciones, más apto)

Colores oficiales (Manual de Instrumentos Técnicos, §5.3.5 — ojo, también al revés de lo
que uno esperaría): 1 verde oscuro, 2 verde claro, 3 amarillo, 4 naranja, 5 rojo oscuro.

------------------------------------------------------------------------------------------
PROCEDENCIA DE LAS TABLAS
------------------------------------------------------------------------------------------
Las tablas marcadas [CONFIRMADO] se tomaron textualmente de informes IFA municipales reales
aprobados bajo esta metodología y del Manual oficial:
  - Pendiente, relieve relativo, densidad de drenaje, erosión y los rangos de sumatoria de
    geodinámica externa: informe de geoaptitud del Plan Regulador de Heredia, 2024
    (Tablas 8, 10, 11, 12, 13), que aplica el Decreto 32967 / Decreto 23214.
  - Estructura de ejes, factores y fórmulas: Manual de Instrumentos Técnicos del proceso de
    EIA (faolex cos77515), §5.3 a §5.12.

Las marcadas [VERIFICAR] usan el criterio de esos mismos estudios, pero sus números exactos
hay que confirmarlos contra el Anexo 1 del decreto 44710 antes de entregar mapas oficiales
(ese anexo está tras la sesión del SCIJ y no se pudo extraer completo todavía). Todas las
tablas viven acá para que confirmarlas sea editar un solo archivo.
"""

from __future__ import annotations

import numpy as np

# ------------------------------------------------------------------------------------------
# Escala y colores comunes a todas las variables
# ------------------------------------------------------------------------------------------

NIVELES_IFA = {
    1: "Muy Alta",
    2: "Alta",
    3: "Moderada",
    4: "Baja",
    5: "Muy Baja",
}

# Colores oficiales del método (§5.3.5). 1 = más frágil = verde oscuro; 5 = menos frágil = rojo.
COLORES_IFA = {
    1: "#1a5e1a",  # verde oscuro  — Muy Alta fragilidad
    2: "#7fbf4d",  # verde claro   — Alta
    3: "#f2d64b",  # amarillo      — Moderada
    4: "#e8963f",  # naranja       — Baja
    5: "#a01818",  # rojo oscuro   — Muy Baja fragilidad
}


def etiqueta_ifa(valor: int) -> str:
    """'1 — Muy Alta fragilidad', etc. Para leyendas."""
    return f"{valor} — {NIVELES_IFA.get(valor, '?')} fragilidad"


# ------------------------------------------------------------------------------------------
# GEOAPTITUD — Factor geodinámico externo
# ------------------------------------------------------------------------------------------

# [CONFIRMADO] Tabla 8 (Heredia 2024): pendiente en % → valor IFA.
# (límite inferior inclusive, límite superior exclusivo, valor IFA)
PENDIENTE_IFA = [
    (0.0, 8.0, 5),      # 0–8 %   → Muy Baja fragilidad
    (8.0, 15.0, 4),     # 8–15 %  → Baja
    (15.0, 30.0, 3),    # 15–30 % → Moderada
    (30.0, 60.0, 2),    # 30–60 % → Alta
    (60.0, float("inf"), 1),  # > 60 % → Muy Alta fragilidad
]

# [CONFIRMADO] Puente entre las 7 categorías de pendiente del Decreto 23214 (scripts/pendientes.py)
# y el valor IFA de la Tabla 8. Permite calificar la pendiente a partir del mapa ya clasificado.
CAT_23214_A_IFA = {
    1: 5,  # Plano 0–3 %          → Muy Baja
    2: 5,  # Lig. ondulado 3–8 %  → Muy Baja
    3: 4,  # Mod. ondulado 8–15 % → Baja
    4: 3,  # Ondulado 15–30 %     → Moderada
    5: 2,  # Fuert. ondulado 30–60%→ Alta
    6: 1,  # Escarpado 60–75 %    → Muy Alta
    7: 1,  # Fuert. escarpado >75%→ Muy Alta
}

# [CONFIRMADO] Tabla 11 (Heredia 2024): relieve relativo según pendiente % → IFA (igual que pendiente).
RELIEVE_RELATIVO_IFA = PENDIENTE_IFA

# [CONFIRMADO] Tabla 12 (Heredia 2024): densidad de drenaje km/km² → IFA.
DENSIDAD_DRENAJE_IFA = [
    (0.0, 2.0, 5),
    (2.0, 6.0, 4),
    (6.0, 10.0, 3),
    (10.0, 14.0, 2),
    (14.0, float("inf"), 1),
]

# [CONFIRMADO] Tabla 13 (Heredia 2024): rangos de la SUMATORIA del factor geodinámica externa → IFA.
GEODINAMICA_SUMATORIA = [
    (5.0, 9.0, 1),
    (9.1, 13.0, 2),
    (13.1, 17.0, 3),
    (17.1, 21.0, 4),
    (21.1, 25.0, 5),
]

# ------------------------------------------------------------------------------------------
# EDAFOAPTITUD — Capacidad de uso de la tierra (Decreto 23214, clases I–VIII)
# ------------------------------------------------------------------------------------------

# [VERIFICAR] Clase de capacidad de uso → IFA. Criterio: clases bajas (I–III) son tierras
# aptas para agricultura (poca limitación = baja fragilidad = IFA alto); las altas (VII–VIII)
# son solo para protección (mucha limitación = alta fragilidad = IFA bajo). Confirmar los
# cortes exactos contra el Anexo 1 del 44710.
CAPACIDAD_USO_IFA = {
    "I": 5, "II": 5,     # agricultura sin o con pocas limitaciones → Muy Baja
    "III": 4, "IV": 4,   # agricultura con limitaciones moderadas    → Baja
    "V": 3, "VI": 3,     # manejo con prácticas intensivas           → Moderada
    "VII": 2,            # cultivos permanentes / bosque             → Alta
    "VIII": 1,           # solo protección                           → Muy Alta
}

# ------------------------------------------------------------------------------------------
# BIOAPTITUD — por grado de protección / sensibilidad
# ------------------------------------------------------------------------------------------

# [VERIFICAR] Calificación de bioaptitud por tipo de área. Criterio: a mayor valor de
# conservación o sensibilidad biológica, mayor fragilidad (IFA más bajo). Las zonas de vida
# y la cobertura, según el Manual (§5.9.4), se muestran como INFORMACIÓN y no se califican;
# acá se usan como contexto. Confirmar contra el Anexo 1 del 44710.
BIOAPTITUD_IFA = {
    "Áreas silvestres protegidas":    1,  # máxima protección → Muy Alta fragilidad
    "Patrimonio Natural del Estado":  1,
    "Registro Nacional de Humedales": 1,  # biotopo sensible
    "Corredores biológicos":          2,  # conectividad a proteger → Alta
    "Áreas de Conservación":          3,  # figura administrativa amplia → Moderada
    # Cobertura forestal y zonas de vida: información, sin calificación directa.
}

# ------------------------------------------------------------------------------------------
# ANTROPOAPTITUD — por uso antrópico del suelo
# ------------------------------------------------------------------------------------------

# [VERIFICAR] Calificación de antropoaptitud por tipo de uso. Criterio del Manual (§5.11):
# el suelo ya intervenido/urbano tiene baja fragilidad para nuevo desarrollo (IFA alto),
# el suelo natural o de uso especial tiene alta fragilidad. Confirmar contra el 44710.
ANTROPOAPTITUD_IFA = {
    "Uso urbano 1:5mil":   5,  # ya urbano → Muy Baja fragilidad para desarrollar
    "Cultivos 1:5mil":     4,  # uso agrícola establecido → Baja
    # Sitios arqueológicos (pendiente, Museo) → 1 (Muy Alta) cuando se incorpore.
}


# ------------------------------------------------------------------------------------------
# Funciones de calificación
# ------------------------------------------------------------------------------------------

def _calificar_por_rangos(valor: float, tabla: list[tuple[float, float, int]]) -> int:
    """Devuelve el IFA (1-5) del primer rango [lo, hi) que contenga 'valor'. 0 si ninguno."""
    if not np.isfinite(valor):
        return 0
    for lo, hi, ifa in tabla:
        if lo <= valor < hi:
            return ifa
    return 0


def calificar_pendiente_ifa(pct) -> np.ndarray:
    """Reclasifica un arreglo de pendiente (en %) al valor IFA de geoaptitud (Tabla 8).
    Devuelve uint8 con 1..5 (0 = sin dato)."""
    pct = np.asarray(pct, dtype="float64")
    ifa = np.zeros(pct.shape, dtype="uint8")
    valido = np.isfinite(pct)
    for lo, hi, v in PENDIENTE_IFA:
        ifa[valido & (pct >= lo) & (pct < hi)] = v
    return ifa


def calificar_cat_pendiente_ifa(cat) -> np.ndarray:
    """Reclasifica las categorías 1-7 del Decreto 23214 (scripts/pendientes.py) al IFA 1-5
    de geoaptitud, usando CAT_23214_A_IFA. Devuelve uint8 (0 = sin dato)."""
    cat = np.asarray(cat)
    ifa = np.zeros(cat.shape, dtype="uint8")
    for c23214, v_ifa in CAT_23214_A_IFA.items():
        ifa[cat == c23214] = v_ifa
    return ifa


def calificar_capacidad_uso(clase: str) -> int:
    """Clase de capacidad de uso ('I'..'VIII') → IFA de edafoaptitud. 0 si no se reconoce."""
    return CAPACIDAD_USO_IFA.get(str(clase).strip().upper(), 0)


def calificar_bioaptitud(nombre_capa: str) -> int:
    """Nombre de capa SINAC → IFA de bioaptitud. 0 si la capa es solo informativa."""
    return BIOAPTITUD_IFA.get(nombre_capa, 0)


def calificar_antropoaptitud(nombre_capa: str) -> int:
    """Nombre de capa de uso → IFA de antropoaptitud. 0 si no aplica."""
    return ANTROPOAPTITUD_IFA.get(nombre_capa, 0)


def resumen_ifa(ifa: np.ndarray) -> dict[int, int]:
    """Cuenta de píxeles por valor IFA 1..5 (ignora 0)."""
    return {v: int(np.count_nonzero(ifa == v)) for v in range(1, 6)}
