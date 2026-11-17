# Atlas municipal (clon privado)

Visor interno para el equipo, aparte del sitio público de remates. Mismo repositorio,
Worker distinto, sin cuentas, sin pagos, sin datos de remates.

## Qué es hoy (MVP)

- `index.html` + `app.js`: mapa Leaflet con el catálogo de `capas.json`. Las capas
  marcadas `disponible` se leen o bien en vivo de `planoexactocr.com/data/…` (capas
  realmente públicas: límites, red eléctrica, ASADAS), o de una copia propia dentro de
  `muni/data/` para las que exigen cuenta (ver la sección de abajo). Nada de esto es
  información de remates.
- Selector de cantón + botón **Generar atlas**: por ahora recorta visualmente el mapa
  al cantón elegido e imprime a PDF con el diálogo del navegador. Sirve para probar el
  flujo con un cantón piloto antes de automatizar el recorte real.

## Qué falta (ver capas.json, estado `pendiente`)

- Capas IFA: geoaptitud (amenazas CNE, geología, pendientes), edafoaptitud (MAG/INTA),
  antropoaptitud (uso de suelo detallado).
- Patrimonio arqueológico (gestionar acceso con el Museo Nacional).
- Red vial cantonal (MOPT / municipalidad).

## Áreas silvestres protegidas y corredores biológicos (SINAC)

Estas dos capas de bioaptitud ya están `disponible`. Vienen directo del geoservidor
oficial del SINAC publicado en el SNIT (el catálogo nacional de mapas del gobierno,
`snitcr.go.cr`), no de una copia nuestra: `archivo` apunta a una URL de tipo WFS
(`https://geos1pne.sirefor.go.cr/wfs?...`) que entrega el GeoJSON directo, en el mismo
sistema de coordenadas que el resto del catálogo. Son capas oficiales y de uso libre
(sin cuenta, sin permiso que pedir).

Un detalle a vigilar: ese servidor es del gobierno, no nuestro, y no sabemos todavía si
permite que el navegador lo consulte directamente desde atlas.planoexactocr.com (un
tema técnico llamado CORS). Si al probar el visor esa capa no carga (sale el aviso
amarillo de "No se pudo cargar"), no es un error nuestro — simplemente ese servidor no
deja que paginas de otros sitios le pidan datos directamente. `scripts/build_atlas.py`
no tiene ese problema (ahí quien pide los datos es el script, no el navegador), así que
el atlas en PDF/GeoPackage por cantón de todas formas va a incluir estas dos capas sin
problema. Si el visor en vivo falla, la solución sería una copia propia como la que ya
se usa para las capas que exigen cuenta (ver sección siguiente), pero no hay que
adelantarse: hay que probarlo primero.

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
