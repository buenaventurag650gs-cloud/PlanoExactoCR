# Atlas municipal (clon privado)

Visor interno para el equipo, aparte del sitio público de remates. Mismo repositorio,
Worker distinto, sin cuentas, sin pagos, sin datos de remates.

## Qué es hoy (MVP)

- `index.html` + `app.js`: mapa Leaflet con el catálogo de `capas.json`. Las capas
  marcadas `disponible` se leen o bien en vivo de `planoexactocr.com/data/…` (capas
  realmente públicas: límites, red eléctrica, ASADAS), o de una copia propia dentro de
  `muni/data/` para las que exigen cuenta (ver la sección de abajo). Nada de esto es
  información de remates.
- Flujo de dos pasos: **(1) elegir cantón → (2) activar capas**. Hasta que no se elige un
  cantón, las capas están deshabilitadas. Al elegir el cantón, el mapa se centra en él y
  cada capa que se enciende se carga **recortada a ese cantón**: las nacionales (IGN, INTA)
  se piden al servidor por `bbox` del cantón; las locales/públicas se filtran al polígono
  del cantón en el navegador (con turf). Así nunca se baja todo el país.
- Botón **Generar atlas**: por ahora imprime a PDF el mapa visible del cantón. El recorte
  real por capa y la exportación a GeoPackage/PDF de láminas están en `scripts/build_atlas.py`.

## Para qué sirve: los mapas del decreto 44710 (IFA) y del MAPRIOT

El objetivo de la herramienta es preparar la cartografía que piden **SETENA** (variable
ambiental) e **INVU** (plan regulador), según el marco vigente:

- **Decreto 44710-MINAE** (vigente desde ago-2025, derogó el 32967): "Reglamento para la
  incorporación de la variable ambiental en los planes de ordenamiento territorial". Habilita
  dos metodologías; la modalidad **IFA** mantiene los cuatro ejes y su suma:
  `IFA integrado = Geoaptitud + Edafoaptitud + Bioaptitud + Antropoaptitud` (escala 1-5,
  donde 1 = fragilidad muy alta). Cada eje es un mapa, y de la suma sale el mapa de IFA
  integrado → zonificación de fragilidad / limitantes técnicas.
- **MAPRIOT** (INVU 2025, "Manual de Planes Reguladores como Instrumento de Ordenamiento
  Territorial") y su **Guía para la Elaboración de Cartografía de Planes Reguladores**: el
  plan regulador exige, entre otros, Mapa Base, Mapa de Uso Actual del Suelo, Mapa de
  Capacidad de Uso de la Tierra, Mapa de Modalidad de Uso (conforme/subuso/sobreuso), mapas
  temáticos de diagnóstico por eje, Mapa de Resultados por Eje, Mapa Unificado, Mapa de
  Zonificación, Vialidad y Mapa Oficial, reunidos en un **Atlas Cartográfico**. La variable
  ambiental del plan se resuelve con los productos que piden SETENA (IFA) y SENARA
  (vulnerabilidad de acuíferos).

### Cómo alimentan las capas del catálogo cada eje IFA

- **Geoaptitud** (5 factores): litopetrofísico → geología (DGM); geodinámico externo y
  amenazas → deslizamientos/fallas/inundación (CNE); estabilidad de laderas → pendientes
  calculadas de curvas de nivel (IGN); hidrogeológico → acuíferos (Dirección de Agua / SENARA).
- **Edafoaptitud**: capacidad de uso de la tierra (INTA) + uso actual (IGN cultivos/pastos).
- **Bioaptitud**: cobertura forestal, ASP, corredores, humedales, áreas de conservación
  (SINAC) y zonas de vida.
- **Antropoaptitud**: uso urbano (IGN), planes reguladores vigentes (INVU), sitios
  arqueológicos (Museo, pendiente) y paisaje.

Los nombres de capa y servidores de cada fuente están en `FUENTES_SNIT.md`.

### Qué falta para producir los mapas finales (no solo las capas de entrada)

Hoy la herramienta reúne y recorta las **capas de entrada** por cantón. Falta la parte
analítica que convierte esas capas en los mapas que se entregan: calificación 1-5 de cada
variable, suma y reclasificación por eje, IFA integrado, y de ahí la zonificación. Eso es
el siguiente bloque de trabajo (metodología del decreto 44710).

## Qué falta (ver capas.json, estado `pendiente`)

- Capas IFA: geoaptitud (geología/pendientes del terreno — el SNIT no la tiene como
  capa descargable, hay que buscar otra fuente), edafoaptitud (MAG/INTA: el INTA tiene
  nodo registrado en el SNIT pero no publica ahí ninguna capa de suelos consultable),
  antropoaptitud (uso de suelo detallado — tampoco apareció en el catálogo del SNIT).
- Patrimonio arqueológico (Museo Nacional): tampoco aparece en el catálogo del SNIT
  (ni institución ni capa); habría que gestionarlo directo con el Museo.
- Red vial cantonal (MOPT/CONAVI tiene un nodo registrado en el SNIT pero no publica ahí
  ninguna capa consultable; hay que buscar otra fuente, quizás pidiéndosela directo).

Para geología/pendientes en particular, hay una alternativa que no depende de pedirle
nada a ninguna institución: un modelo de elevación del terreno internacional y gratuito
(por ejemplo de satélites de la NASA) cubre todo el país y permite calcular la pendiente
directamente, sin esperar a CONAVI/INTA/Museo. Aún no implementado.

## Despliegue automático

Desde noviembre 2026, el Worker `planoexacto-muni` está conectado a GitHub (rama
`muni-clon-privado`, carpeta `muni`), igual que PlanoExacto. Cada vez que se sube un
cambio a esa rama, Cloudflare lo despliega solo — ya no hace falta correr
`npx wrangler deploy` a mano salvo que se quiera probar algo localmente antes de subirlo.

## Capas de bioaptitud del SINAC

Cinco capas de bioaptitud ya están `disponible` directo del geoservidor oficial del
SINAC publicado en el SNIT (el catálogo nacional de mapas del gobierno, `snitcr.go.cr`),
no de una copia nuestra: Áreas silvestres protegidas, Corredores biológicos, Patrimonio
Natural del Estado, Registro Nacional de Humedales y Áreas de Conservación. `archivo`
apunta a una URL de tipo WFS (`https://geos1pne.sirefor.go.cr/wfs?...`) que entrega el
GeoJSON directo, en el mismo sistema de coordenadas que el resto del catálogo. Son
capas oficiales y de uso libre (sin cuenta, sin permiso que pedir).

El SINAC también publica ahí dos capas de Cobertura Forestal (2021 y 2023), pero esas sí
están marcadas "Derechos de autor" en su metadato — no se agregaron porque ya tenemos
Cobertura forestal 2020 de MINAE con uso libre, que cubre lo mismo sin esa restricción.

Mismo origen de datos (SNIT) para las 4 capas de amenazas de la Comisión Nacional de
Emergencias (CNE) en el eje de geoaptitud: coronas de deslizamientos, deslizamientos,
fallas del cuaternario y áreas con potencial a inundación. A diferencia de las del
SINAC, el metadato de estas dice "Derechos de autor (Copyright)" en vez de uso libre;
el uso de este atlas se revisó con abogado y es con fines científicos/no comerciales,
no reventa directa del dato — ver la nota de cada capa en `capas.json`. Además, el
servidor de la CNE (`mapas.cne.go.cr`) solo responde por `http`, no `https`, así que es
probable que el visor en vivo no pueda cargarla (un navegador en una página seguro
normalmente bloquea pedir datos a una dirección insegura). Eso no afecta el atlas en
PDF/GeoPackage, que sí las va a incluir sin problema.

Nota legal general del SNIT: su geoportal permite uso de entidades privadas con o sin
fines de lucro, pero prohíbe el uso **comercial** de la información (directa o
derivada). Ya se revisó con abogado que este proyecto no cae ahí por ser de fines
científicos, pero si el propósito del atlas cambia más adelante (por ejemplo a reventa
directa de mapas), hay que volver a revisar esto antes de seguir usando capas del SNIT.

Un detalle técnico a vigilar en general con las capas del SNIT: esos servidores son del
gobierno, no nuestros, y no sabemos de antemano si dejan que el navegador los consulte
directamente desde atlas.planoexactocr.com (un tema técnico llamado CORS). Si al probar
el visor una capa no carga (sale el aviso amarillo de "No se pudo cargar"), no es un
error nuestro — simplemente ese servidor no deja que páginas de otros sitios le pidan
datos directamente. `scripts/build_atlas.py` no tiene ese problema (ahí quien pide los
datos es el script, no el navegador), así que el atlas en PDF/GeoPackage por cantón de
todas formas va a incluir la capa sin problema. Si el visor en vivo falla, la solución
sería una copia propia como la que ya se usa para las capas que exigen cuenta (ver
sección siguiente).

## Capas que exigen cuenta: copia propia, sitios separados

Cinco capas (`zmt`, `planes_reguladores`, `zonasvida`, `infra`, `salud`) están detrás de
`SOLO_CUENTA_DATOS` en el `worker.js` del sitio público: el visitante necesita una sesión
de cuenta **gratis** en planoexactocr.com para verlas — es la táctica de registro del
sitio, no un error de nuestro lado.

Decisión de diseño: este atlas se mantiene **separado** del sitio público — no comparte
cuentas, cookies ni sesiones con él, ni se le pide a nadie que inicie sesión ahí para ver
el atlas. En vez de eso, comparten la misma información por otro lado: una copia propia.

`scripts/sync_cuenta.py` baja esas 5 capas una sola vez (con una cookie que usted pega a
mano, nunca en el navegador de quien use el atlas) y las guarda como archivos normales
dentro de `muni/data/`. Desde ahí las lee el visor y `build_atlas.py`, sin pedir cuenta a
nadie. Para refrescarlas (no hace falta seguido — no cambian a diario):

```
python3 ../scripts/sync_cuenta.py --cookie "pecr_u=<valor copiado del navegador>"
```

Cómo conseguir esa cookie: entre a planoexactocr.com con cualquier cuenta gratis, abra
las herramientas de desarrollador del navegador → Application (o Storage) → Cookies →
copie el valor de `pecr_u`. El script actualiza `capas.json` solo (le quita la marca
`requiere_cuenta` y anota la fecha de la copia); después hay que subir los archivos
nuevos de `muni/data/` y el `capas.json` actualizado con git, y volver a desplegar.

**Nota de tamaño:** `zmt.geojson` pesa cerca de 1.3 MB; las demás son más chicas. Si en
algún momento esto crece mucho, conviene revisar si conviene comprimir o filtrar antes de
subirlo al repositorio.

## Desplegar (ya probado, pasos manuales en Cloudflare)

1. `npx wrangler login` y luego `npx wrangler deploy` desde esta carpeta (`muni/`) crea
   el Worker `planoexacto-muni`. Si da el error "Cannot use assets with a binding in an
   assets-only Worker", es que `wrangler.toml` quedó con un `binding` en `[assets]` —
   este Worker no tiene script propio, así que no debe llevar ninguno.
2. Gracias a `custom_domain = true` en `routes`, el registro DNS de
   `atlas.planoexactocr.com` se crea solo al desplegar (no hace falta tocarlo a mano).
3. **Zero Trust → Access → Applications → Add an application (Self-hosted)**: dominio
   `atlas.planoexactocr.com`, política "Allow" con "Include: Emails" y la lista de
   correos del equipo. Esto reemplaza cualquier contraseña propia — no hay
   `SITE_PASSWORD` en este Worker.

## Recorte real a GeoPackage + PDF

`scripts/build_atlas.py` ya hace el recorte real (no es un stub): toma el polígono del
cantón de `cantones.geojson`, recorta cada capa `disponible` del catálogo y escribe un
`.gpkg` (una tabla por capa, para abrir en QGIS) más un `.pdf` de láminas rápidas con
portada y fuentes.

```
pip install -r ../scripts/requirements-atlas.txt
python3 ../scripts/build_atlas.py --canton "Pérez Zeledón" --salida salida/perez_zeledon
```

El nombre del cantón debe coincidir con la propiedad `k` de `cantones.geojson` (p. ej.
"Pérez Zeledón", "Escazú" — no hace falta preocuparse por mayúsculas o tildes exactas).

**Caso especial:** el cantón de Puntarenas incluye la Isla del Coco, muy lejos de la
zona continental; eso hace que el recuadro del mapa se estire y la parte continental se
vea diminuta en una esquina. No está resuelto todavía — para Puntarenas conviene revisar
el PDF a mano o ajustar el recuadro manualmente en QGIS a partir del GeoPackage.

### Qué falta para la versión final

- Leyenda y escala gráfica cartográficamente correctas en el PDF (hoy es una vista
  rápida para repasar, no una lámina lista para imprimir y presentar).
- Las capas IFA marcadas `pendiente` en `capas.json` (no se pueden recortar porque
  todavía no hay de dónde bajarlas).
