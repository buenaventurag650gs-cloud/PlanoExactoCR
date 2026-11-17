# Atlas municipal (clon privado)

Visor interno para el equipo, aparte del sitio público de remates. Mismo repositorio,
Worker distinto, sin cuentas, sin pagos, sin datos de remates.

## Qué es hoy (MVP)

- `index.html` + `app.js`: mapa Leaflet con el catálogo de `capas.json`. Las capas
  marcadas `disponible` se leen en vivo de `planoexactocr.com/data/…` (son capas base
  —límites, plan regulador por cantón, zonas de vida, infraestructura, ASADAS, salud—
  que el sitio público ya expone para el visor de remates; nada de esto es información
  de remates).
- Selector de cantón + botón **Generar atlas**: por ahora recorta visualmente el mapa
  al cantón elegido e imprime a PDF con el diálogo del navegador. Sirve para probar el
  flujo con un cantón piloto antes de automatizar el recorte real.

## Qué falta (ver capas.json, estado `pendiente`)

- Capas IFA: geoaptitud (amenazas CNE, geología, pendientes), edafoaptitud (MAG/INTA),
  bioaptitud (SINAC: ASP y corredores), antropoaptitud (uso de suelo detallado).
- Patrimonio arqueológico (gestionar acceso con el Museo Nacional).
- Red vial cantonal (MOPT / municipalidad).

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
