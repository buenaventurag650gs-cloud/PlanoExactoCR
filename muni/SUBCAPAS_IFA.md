# Sub-capas de cada eje del IFA (plano maestro)

Lista completa de los sub-mapas que componen cada eje del IFA, para construirlos uno por uno.
Fuente: informe completo de IFAs de ProDUS-UCR (Santo Domingo, feb 2024), que aplica la
metodología de los Decretos 32967 y 41960-MAG-MINAE. El Decreto 44710 (2025) continúa esta
estructura; **los nombres y la calificación exactos hay que confirmarlos contra el Anexo del
44710** cuando se consiga el texto.

Cada sub-mapa se califica 1-5 con la rampa oficial (Muy alta rosado → Muy baja verde oscuro,
ver METODOLOGIA_IFA.md), y los sub-mapas de un factor se integran (promedio/suma) en el mapa
integrado del factor; los factores se integran en el eje; los cuatro ejes en el IFA integrado.

Estado: 🟢 datos listos · 🟡 datos parciales · 🔴 falta la fuente de datos

---

## 1. IFA GEOAPTITUD

### 1.1 Factor litopetrofísico
- Geología 🔴 (DGM, falta nombre de capa)
- Geomorfología 🔴
- Dureza 🔴 · Grado de cohesión 🔴 · Factor de lineación 🔴
- Grado de meteorización 🔴 · Espesor de la capa de suelo 🔴
- Contenido de arcilla 🔴 · Permeabilidad 🔴
- → Factor litopetrofísico integrado

### 1.2 Factor geodinámica externa
- Pendientes 🟢 (del DEM, ya implementado)
- Relieve relativo 🟢 (del DEM) · Densidad de drenaje 🟡 (de la hidrografía)
- Erosión 🔴 · Sedimentación 🔴
- → Factor geodinámica externa integrado

### 1.3 Factor hidrogeológico
- Hidrogeología 🔴 · Índice del perfil hidrogeológico 🔴
- Potencial de infiltración 🔴 · Precipitación 🟡 (IMN)
- Índice GOD 🔴
- → Factor hidrogeológico integrado

### 1.4 Factor estabilidad de laderas (deslizamientos)
- IFA tres meses más lluviosos 🟡 · Dirección de talud 🟢 (del DEM)
- → Factor estabilidad de laderas integrado

### 1.5 Factor amenazas naturales
- Sismicidad regional 🔴 · Sismicidad local 🔴 · Fallas activas 🟡 (CNE)
- Amenaza volcánica 🟡 · Inundaciones 🟢 (CNE) · Potencial de licuefacción 🔴 · Tsunami 🔴
- → Factor amenazas naturales integrado
- Amenazas Naturales CNE (mapa de referencia, sin integrar) 🟢

### 1.6 IFA Geoaptitud integrado

---

## 2. IFA EDAFOAPTITUD
- Categorías de uso de la tierra (capacidad de uso, Decreto 23214) 🟡 (INTA, cobertura parcial)
- Potencial agrícola por fertilidad del suelo 🔴
- Tipo de suelo 🔴
- → IFA Edafoaptitud integrado

---

## 3. IFA BIOAPTITUD (IFA Biológico)
- Biotopos sensibles (manglares, bosque ripario, humedales) 🟡
- Cuerpos de agua y áreas de protección 🟢
- Zonas de vida 🟢
- Categorías de manejo de áreas protegidas (y PSA) 🟢 (SINAC)
- Tipo de cobertura biótica / cobertura vegetal 🟢 (MAF2020)
- Corredores biológicos 🟢 (SINAC)
- → IFA Bioaptitud integrado

Nota: las láminas de Ecoplan (Abangares) nombran los sub-mapas como **Biodiversidad,
Categorías de manejo y Cobertura vegetal**; es la misma familia de variables con otros
nombres. Cada consultor agrupa un poco distinto.

---

## 4. IFA ANTROPOAPTITUD

### 4.1 IFA uso antrópico
- Áreas de desarrollo futuro 🟡 (planes reguladores) · Red vial 🟢 (IGN)
- Áreas silvestres protegidas 🟢 (SINAC) · Uso del suelo antrópico 🟢 (IGN/MAF)
- Patrimonio arquitectónico y sitios arqueológicos 🔴 (Museo, falta)
- → IFA Uso antrópico

### 4.2 Paisajismo
- Tipologías del paisaje 🔴 · Calidad visual 🔴 · Hitos observables 🔴
- → IFA Paisajismo

### 4.3 IFA Antropoaptitud integrado

---

## 5. IFA INTEGRADO
`IFA integrado = Geoaptitud + Edafoaptitud + Bioaptitud + Antropoaptitud`, zonificado en 5 zonas.

---

## Qué podemos construir ya (datos 🟢/🟡 disponibles)
1. **Bioaptitud casi completo**: cuerpos de agua, zonas de vida, categorías de manejo,
   cobertura (MAF2020), corredores → IFA Bioaptitud integrado. (Es lo que piden las láminas
   de Abangares.)
2. **Geoaptitud parcial**: pendientes, relieve, dirección de talud (del DEM) + amenazas (CNE).
3. **Edafoaptitud parcial**: capacidad de uso (INTA, donde haya).
4. **Antropoaptitud parcial**: red vial, ASP, uso del suelo.

Lo 🔴 (geología litopetrofísica, hidrogeología, fertilidad, paisaje) necesita conseguir las
fuentes o un insumo técnico aparte; se deja marcado para no frenar lo que sí se puede armar.
