# PlanoExactoCR

PlanoExactoCR: visor de remates judiciales de fincas en Costa Rica, ubicados por número de plano o de finca sobre el catastro del Registro Inmobiliario.

## Estructura
- `index.html` — el visor (Leaflet).
- `data/remates.json` — remates vigentes extraídos del Boletín Judicial, con polígono del predio cuando se encontró.
- `data/distritos.geojson` — límites distritales del IGN (SNIT).
- `data/meta.json` — tipo de cambio de referencia del BCCR y fecha de los datos.
- `data/planes_reguladores.geojson` — estado del plan regulador por cantón (INVU vía SNIT).
- `data/salud.json` — sedes de salud de la CCSS.
- `netlify/edge-functions/auth.ts` — contraseña de la etapa de prueba (variable `SITE_PASSWORD` en Netlify).
- `scripts/` — extractor de edictos y armado de datos (base del robot diario, fase siguiente).

## Fuentes
Boletín Judicial (Nexus, Poder Judicial) · Catastro y vías públicas, Registro Inmobiliario (SNIT) · Límites, hidrografía, curvas, vías y nomenclátor, IGN (SNIT) · Planes reguladores, INVU · Cobertura 2020, zonas de vida y cuencas, MINAE-CENIGA · PSA, FONAFIFO · Sedes de salud, CCSS · Tipo de cambio, BCCR.
Mapas base: © OpenStreetMap, © CARTO; imágenes © Esri.

Información orientativa. No sustituye la certificación del Registro Nacional ni la revisión del expediente.
