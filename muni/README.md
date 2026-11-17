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

## Desplegar (pasos manuales en Cloudflare, no se pueden hacer desde aquí)

1. `npx wrangler deploy` desde esta carpeta (`muni/`) crea el Worker `planoexacto-muni`.
2. En el dashboard de Cloudflare: añadir el registro DNS para `atlas.planoexactocr.com`
   si `routes` en `wrangler.toml` no lo crea solo.
3. **Zero Trust → Access → Aplicaciones**: proteger `atlas.planoexactocr.com` con una
   política por correo (sólo las direcciones del equipo). Esto reemplaza cualquier
   contraseña propia — no hay `SITE_PASSWORD` en este Worker.

## Siguiente paso técnico

Reemplazar la impresión del navegador por un recorte real: `scripts/build_atlas.py`
(stub en este mismo commit) tomaría el polígono del cantón, recortaría cada capa
disponible con GeoPandas y exportaría un GeoPackage + una serie de láminas PDF con
leyenda y escala uniforme.
