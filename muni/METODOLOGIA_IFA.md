# Metodología IFA — especificación para implementar los mapas

Base para la parte analítica de la herramienta: cómo se califican las variables y se
arman los mapas de fragilidad ambiental (IFA) que pide SETENA bajo el decreto 44710.

ADVERTENCIA: la estructura de abajo viene del Procedimiento Técnico del IFA (el que
acompañaba al decreto 32967, "Manual de Instrumentos Técnicos"). El decreto 44710
(vigente desde ago-2025) lo sustituye con su "Metodología 1 (IFA)" en su Anexo 1, que
mantiene la misma estructura de cuatro ejes y calificación 1-5. Antes de entregar mapas
oficiales hay que confirmar las tablas finales de calificación contra el Anexo 1 del
44710 (las tablas exactas de rangos no se pudieron extraer aún).

## Escala de calificación (todas las variables)

Cinco niveles, contraintuitivos: **1 = Muy Alta fragilidad / más limitaciones técnicas /
menos potencialidades; 5 = Muy Baja**.
Colores de mapa: 1 verde oscuro, 2 verde claro, 3 amarillo, 4 naranja, 5 rojo oscuro.

## IFA integrado

`IFA integrado = Geoaptitud + Edafoaptitud + Bioaptitud + Antropoaptitud`
(suma algebraica de los mapas de cada eje; resultado zonificado en 5 categorías,
Zona I Muy alto … Zona V Muy bajo, con sus tablas de limitantes y potencialidades técnicas).

## Eje Geoaptitud = L + GE + H + AD + AN

Suma algebraica de cinco factores, cada uno con sus variables calificadas 1-5:

- **Litopetrofísico (L)**: dureza, consistencia, lineación/fracturamiento, meteorización,
  espesor de suelo, contenido de arcilla, porosidad/permeabilidad.
- **Geodinámico externo (GE)**: categoría de pendiente, relieve relativo, densidad de
  drenaje, erosión activa, sedimentación activa.
- **Hidrogeológico (H)**: densidad de drenaje, índice de perfil hidrogeológico, potencial
  de infiltración, nacientes/pozos, precipitación media anual.
- **Estabilidad de laderas (AD)**: solo aplica a pendientes > 15%; espesor de suelo,
  lluvia de los tres meses más húmedos, categoría de pendiente, sismicidad, cobertura
  vegetal, fallas activas, erosión/sedimentación, zonas hidrogeológicas, orientación de ladera.
- **Amenazas naturales (AN)**: sismicidad regional y local, licuefacción, ruptura
  superficial por fallas, amenaza volcánica, tsunami, inundación.

Zonificación de geoaptitud (Tabla N°3, pendiente de confirmar los conteos exactos): la
categoría de cada zona depende del número de factores en categoría "Muy Baja" y su nivel.

### Pendiente (clave para el primer mapa)

La categoría de pendiente sigue los rangos del método de capacidad de uso de la tierra
del MAG/MINAE (Decreto 23214). Umbral citado explícitamente: **15%** dispara el factor de
estabilidad de laderas. Los rangos de porcentaje exactos y su puntaje hay que tomarlos
del Decreto 23214 / metodología MAG antes de calcular el mapa de pendientes.
Insumo de datos: curvas de nivel del IGN (`curvas_5000`, `curvas_1000`, 1:25mil) o el DEM
descargable del IGN (ver FUENTES_SNIT.md).

## Eje Edafoaptitud

Dos variables: tipo de suelo y **capacidad de uso de la tierra** (método oficial del MAG,
Decreto 23214, clases I a VIII — las clases bajas = tierras aptas para agricultura,
las altas = solo protección). Insumo: INTA (capacidad de uso) donde hay cobertura; uso
actual del IGN como complemento.

## Eje Bioaptitud

Variables: cobertura de la tierra, áreas silvestres protegidas, corredores biológicos,
cuerpos de agua y sus áreas de protección, biotopos sensibles (manglares, bosque ripario,
humedales) y zonas de vida. Las variables de clima y biología se mapean como información,
no se califican en el IFA. Insumo: capas del SINAC + zonas de vida (ya disponibles).

## Eje Antropoaptitud

Variables: áreas de desarrollo urbano, infraestructura vial, áreas de administración
especial, uso antrópico del suelo (residencial, comercial, industrial, mixto, agrícola,
uso especial), sitios culturales y arqueológicos, áreas de desarrollo a corto y mediano
plazo, y categorías de paisaje. Insumo: uso urbano del IGN, planes reguladores (INVU),
sitios arqueológicos (Museo, pendiente).

## Orden de construcción propuesto

1. Mapa de pendientes (de curvas/DEM del IGN) → insumo de geoaptitud (GE + AD).
2. Mapa de uso actual del suelo (IGN cobertura + urbano) → pedido directo del MAPRIOT.
3. IFA Bioaptitud (datos del SINAC completos) → primer eje IFA calificado de punta a punta.
4. Resto de ejes y el IFA integrado, una vez confirmadas las tablas del Anexo 1 del 44710.
