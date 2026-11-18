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
(suma algebraica de los mapas de cada eje; resultado zonificado en 5 categorías de
fragilidad muy baja a muy alta, con sus tablas de limitantes y potencialidades técnicas.
Sobre el numeral de cada zona, ver «Escala» más abajo).

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

### Tablas de calificación confirmadas (de informes IFA municipales reales)

Todas las tablas de calificación viven en `scripts/calificacion_ifa.py` (fuente única,
editable). Las siguientes se tomaron textualmente del **informe de geoaptitud del Plan
Regulador de Heredia, 2024** (Tablas 8, 10-13), que aplica esta misma metodología, y del
Manual oficial de Instrumentos Técnicos. Marcadas `[CONFIRMADO]` en el código.

**Pendiente → IFA (Tabla 8):**

| Pendiente % | IFA | Nivel |
|-------------|-----|-------|
| 0–8 | 5 | Muy Baja |
| 8–15 | 4 | Baja |
| 15–30 | 3 | Moderada |
| 30–60 | 2 | Alta |
| > 60 | 1 | Muy Alta |

**Densidad de drenaje → IFA (Tabla 12, km/km²):** 0–2→5, 2–6→4, 6–10→3, 10–14→2, >14→1.
**Relieve relativo (Tabla 11):** igual que pendiente.
**Sumatoria geodinámica externa (Tabla 13):** 5–9→1, 9.1–13→2, 13.1–17→3, 17.1–21→4, 21.1–25→5.

El método general: cada factor suma las calificaciones 1-5 de sus variables y divide el rango
total de la suma en 5 clases iguales (amplitud / 5). Lo mismo se repite por eje y para el IFA
integrado. Convención contraintuitiva: **1 = Muy Alta fragilidad, 5 = Muy Baja**. Colores
oficiales (§5.3.5): 1 verde oscuro → 5 rojo oscuro.

Las tablas de edafoaptitud (capacidad de uso I-VIII), bioaptitud (por protección) y
antropoaptitud (por uso) están en `calificacion_ifa.py` marcadas `[VERIFICAR]`: usan el
criterio de los estudios aprobados, pero sus cortes exactos hay que confirmarlos contra el
Anexo 1 del 44710 (ese anexo está tras la sesión del SCIJ y no se pudo extraer completo).

### Pendiente (primer mapa — ya implementado)

Categorías de pendiente del Decreto 23214 (sección 6.1.1.1), ya codificadas en
`scripts/pendientes.py`:

| Cat | Nombre | Rango |
|-----|--------|-------|
| 1 | Plano o casi plano | 0–3 % |
| 2 | Ligeramente ondulado | 3–8 % |
| 3 | Moderadamente ondulado | 8–15 % |
| 4 | Ondulado | 15–30 % |
| 5 | Fuertemente ondulado | 30–60 % |
| 6 | Escarpado | 60–75 % |
| 7 | Fuertemente escarpado | > 75 % |

Pendiente máxima por clase de capacidad de uso (Cuadro 1): I <3%, II <8%, III <15%,
IV <30%, VI <50%, VII <75%, VIII cualquiera. Umbral 15% = dispara el factor de
estabilidad de laderas. (Conviene verificar los valores contra el PDF oficial de La Gaceta.)

Insumo de datos: el DEM del IGN (descargable por hoja 1:25mil desde el SNIT, ver
FUENTES_SNIT.md) en CRS métrico. Se calcula con:
`python3 scripts/build_atlas.py --canton "<cantón>" --salida salida/<x> --dem ruta/al/dem.tif`
→ agrega un GeoTIFF de categorías 1-7 recortado al cantón y una lámina al PDF.

## Eje Edafoaptitud

Dos variables: tipo de suelo y **capacidad de uso de la tierra** (método oficial del MAG,
Decreto 23214, clases I a VIII — las clases bajas = tierras aptas para agricultura,
las altas = solo protección). Insumo: INTA (capacidad de uso) donde hay cobertura; uso
actual del IGN como complemento.

## Rampa de colores del IFA (medida sobre una lámina real)

Tomada píxel a píxel de **"Índices de Fragilidad Ambiental Cantón Liberia", lámina 53
(IFA Bioaptitud), Ecoplan, abril 2025**:

| Clase | Color |
|-------|-------|
| Muy Alta | rojo `#e41a1c` |
| Alta | naranja `#ff7f00` |
| Moderada | amarillo `#ffff33` |
| Baja | verde claro `#94d180` |
| Muy Baja | verde oscuro `#3d983a` |

Está codificada en `scripts/integracion_ifa.py`, que es el **único** lugar donde se define
la categorización del IFA; `calificacion_ifa.py` y el tablero la toman de ahí.

Ojo con el texto del decreto: el §5.3.5 del 32967 asigna los colores al revés (verde oscuro
para Muy Alta, rojo oscuro para Muy Baja). Todas las láminas que se están aprobando hoy usan
la rampa de arriba, así que se sigue la práctica, no la letra.

## Cómo se integra y se categoriza (lo que pide SETENA)

El procedimiento es el mismo en los dos niveles: **sumar y reclasificar**.

- **Dentro de un eje**: decreto 32967, §5.8.2 — el IFA Geoaptitud integrado "se obtiene por
  la suma algebraica simple de los cinco factores de geoaptitud previamente elaborados".
  Bioaptitud, Edafoaptitud y Antropoaptitud siguen el mismo procedimiento (§5.9.5, §5.10.6,
  §5.11.3, todos remiten al §5.3).
- **Entre los ejes**: §5.12.2 — `IFA integrado = IFA Bioaptitud + IFA Edafoaptitud +
  IFA Geoaptitud + IFA Antropoaptitud`.
- **Escala**: 5 niveles. El **código interno del ráster** numera con **1 = fragilidad más
  alta**, porque sigue la escala de puntos de la Tabla Nº 3 (pocos puntos = más limitantes
  técnicas = más frágil). Lo que sale impreso en la lámina es el nombre y el color, no ese
  número.
- **Numeral de la zona (Zona I … Zona V)**: lo define la estructura compartida del Plan
  Regulador (`data/estructura_pr.json`), no este módulo, porque es el que citan la Matriz B,
  la matriz de compatibilidad del AAA y los reglamentos, y tiene que ser el mismo en el atlas
  y en el calibrador. Ahí **Zona I es la menos frágil y Zona V la más frágil**, o sea la
  dirección opuesta al código interno. Lo que coincide en los dos lados es el par nombre +
  color: «Muy alta» siempre es rojo.
  [VERIFICAR] Esa dirección sale del desglose de entregables y la confirman sus matrices de
  compatibilidad y de condicionantes (tratan III–V y IV–V como el extremo restrictivo).
  Conviene cotejarla contra el texto del Anexo 1 del 44710 antes de cerrar unos TdR.

Para pasar de la suma a la clase se usa la **Tabla Nº 3** del 32967 ("Criterio de
Calificación para IFA - Geoaptitud integrado"), sobre una escala de 0 a 75 puntos:

| Clase | Rango | Como proporción del máximo |
|-------|-------|----------------------------|
| Muy Alta | 0 – 25 | < 0,333 |
| Alta | 25 – 35 | < 0,467 |
| Moderada | 35 – 50 | < 0,667 |
| Baja | 50 – 65 | < 0,867 |
| Muy Baja | 65 – 75 | ≥ 0,867 |

Se aplican como **proporción** y no como puntos absolutos, para que la misma tabla sirva con
tres sub-mapas o con cinco — que es la situación real mientras falten capas. En cada píxel,
la suma se mide contra el máximo que podrían dar los sub-mapas que **sí** tienen dato ahí, de
modo que a un píxel al que le falta una capa no le sale fragilidad inflada.

**[VERIFICAR]** La Tabla Nº 3 además pide condiciones cualitativas para las dos clases más
frágiles ("mínimo tres factores de categoría MB" para Muy Alta, "mínimo dos" para Alta). Hoy
se aplica solo el criterio numérico; falta confirmar esa condición contra el anexo del 44710.

El decreto **44710-MINAE** entró en vigor el 18 de agosto de 2025 y derogó el 32967, pero
mantiene la metodología IFA como su **Anexo 1** ("Metodología de los IFA para elaborar
EsIVA"), junto a la alternativa RIVAIOT.

## Eje Bioaptitud — se arma de sub-variables (IFA Biológico)

Las láminas reales muestran que la Bioaptitud ("IFA Biológico") es la **integración de tres
sub-mapas**, cada uno calificado 1-5 con la rampa de arriba:

1. **IFA Biodiversidad** — índice de biodiversidad (riqueza/sensibilidad de especies).
2. **IFA Categorías de manejo** — según la categoría de manejo de las áreas protegidas
   (y figuras como zonas protectoras); lo más protegido = fragilidad más alta.
3. **IFA Cobertura vegetal** — según el tipo y densidad de cobertura (bosque, charral,
   pasto, cultivo, suelo desnudo); más cobertura natural = fragilidad más alta.

`IFA Biológico (Bioaptitud) = integración de Biodiversidad + Categorías de manejo + Cobertura vegetal`

Cada lámina lleva, además de la clase IFA, la red hídrica (ríos, quebradas, canales), las
localidades (cabeceras y poblados), la red vial (nacional por tipo y cantonal), la división
cantonal y distrital, el área de planificación, las áreas silvestres protegidas y los cuerpos
de agua. Insumo: capas del SINAC + cobertura MAF2020 + zonas de vida.

Variables completas del eje: cobertura de la tierra, áreas silvestres protegidas, corredores
biológicos, cuerpos de agua y sus áreas de protección, biotopos sensibles (manglares, bosque
ripario, humedales) y zonas de vida. Las variables de clima y biología se mapean como
información, no se califican.

## Eje Antropoaptitud

Variables: áreas de desarrollo urbano, infraestructura vial, áreas de administración
especial, uso antrópico del suelo (residencial, comercial, industrial, mixto, agrícola,
uso especial), sitios culturales y arqueológicos, áreas de desarrollo a corto y mediano
plazo, y categorías de paisaje. Insumo: uso urbano del IGN, planes reguladores (INVU),
sitios arqueológicos (Museo, pendiente).

## Orden de construcción

1. ✅ Mapa de pendientes (de curvas/DEM del IGN) → insumo de geoaptitud (GE + AD).
   Implementado en `scripts/pendientes.py`, integrado en `build_atlas.py --dem`.
2. ✅ Mapa de uso actual del suelo (IGN urbano + cultivos) → pedido directo del MAPRIOT.
   Implementado como `lamina_uso_suelo()` en `build_atlas.py` — combina urbano_5000,
   cultivos2017_5k y cobertura forestal en un solo mapa con leyenda.
3. ✅ IFA Bioaptitud (datos del SINAC completos) → primer eje de información ambiental.
   Implementado como `lamina_bioaptitud()` en `build_atlas.py` — combina zonas de vida,
   ASP, corredores biológicos, PNE, humedales y áreas de conservación con leyenda.
4. Pendiente: resto de ejes (calificación 1-5 por variable) y el IFA integrado, una vez
   confirmadas las tablas del Anexo 1 del 44710.
