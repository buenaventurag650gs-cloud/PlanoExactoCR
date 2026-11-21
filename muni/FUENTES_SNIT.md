# Inventario de fuentes de datos (SNIT y otros) para el atlas municipal

Resultado del barrido completo de los 60 nodos del SNIT (nov 2026) y de los visores
institucionales. Es la referencia de dónde sale cada capa, con qué servidor, qué licencia
y qué cobertura. Las URLs base vienen del inventario oficial del SNIT
("Inventario de capas y Servicios OGC.xlsx", enlazado desde cada nodo).

Nota legal general: el geoportal del SNIT prohíbe el uso **comercial** de la información
(directa o derivada). Ya se revisó con abogado que este proyecto es de fines
científicos/no comerciales y no cae en esa prohibición. Donde una capa diga
"Derechos de autor (copyright)" aplica ese mismo criterio.

## Cómo se consulta un WFS

`<base>?service=WFS&version=2.0.0&request=GetFeature&typeName=<capa>&outputFormat=application/json&srsName=EPSG:4326`

- `srsName=EPSG:4326` es obligatorio (si no, devuelve coordenadas en el sistema nacional
  CRTM05, en metros, no en lon/lat).
- Para contar sin bajar todo: `&resultType=hits` (devuelve `numberMatched`).
- Para capas nacionales enormes (ej. vías), filtrar por cantón con `&bbox=minx,miny,maxx,maxy,EPSG:4326`
  o `&CQL_FILTER=...`; si no, se intentan bajar cientos de miles de geometrías.

## Capas pendientes del IFA — fuentes confirmadas

### Red vial cantonal
- **IGN 1:5mil** — base `https://geos.snitcr.go.cr/be/IGN_5/wfs` — capa `vias_5000`
  (incluye red municipal, nacional, autopistas, línea férrea, puentes). Nacional,
  989.046 tramos. Licencia: copyright. **Verificado que responde.**
- Registro Inmobiliario — capa "Vías Públicas" (calles municipales oficializadas por
  cada muni). Vía SNIT (visor siri.snitcr.go.cr).
- Munis con nodo propio publican su red vial cantonal con más detalle (Palmares, San
  Carlos, San Ramón, Carrillo, etc.).

### Uso de suelo / cobertura
- **IGN 1:5mil** (`geos.snitcr.go.cr/be/IGN_5/wfs`): `cultivos2017_5k`, `pastos2017_5k`,
  `forestal2017_5k`, `urbano_5000`, `edificaciones2017_5k`, `hidrografia_5000`. Nacional 2017.
  Licencia copyright.
- MOCUPP (CeNAT): cambio de uso por cultivo (piña/palma/pastos), nacional por año.
- PRUGAM 1:10mil 2008: usos de la tierra para la Gran Área Metropolitana.

### Suelos y capacidad de uso (edafoaptitud)
- **INTA** — base `https://geoserver.mag.go.cr/geoserver/inta/wfs` (GeoServer propio del
  MAG, https, soporta GeoJSON). Capa clave: `inta:INTA-MAG_capUso_50`
  (Capacidad de Uso de las Tierras, decreto 41960). Otras: taxonomía (orden/suborden/
  grangrupo/subgrupo/familia), pH, acidez, carbono, materia orgánica, fósforo, fertilidad.
  Cobertura REGIONAL: península de Nicoya (Nandayure, Hojancha, Nicoya, Paquera, Lepanto,
  Cóbano), Guanacaste MADITIC (Liberia, La Cruz, Abangares), Alvarado, Naranjo/Los Santos.
  CRS nativo EPSG:8908 → pedir siempre srsName=EPSG:4326.
  NOTA: el 17-nov-2026 el servidor de INTA devolvía error 500 (su base de datos no
  respondía); el GetCapabilities sí funciona. Reintentar el GetFeature más adelante.

### Geología y pendientes
- Curvas de nivel IGN (para calcular pendiente): `curvas_1000` (IGN_1), `curvas_5000`
  (IGN_5), `Curvas_de_Nivel_25k` + `RE_120101/02/03` y cotas `RE_120106` (IGN_25).
- **Modelo de elevación (DEM)**: IGN publica WMTS en `https://geos1.snitcr.go.cr/ModelosIGN/wmts`
  y GeoTIFF descargables por hoja desde la guía 1:25mil (`guia_hojas_25mil`, nodo IGN Guías).
- **Geología**: Dirección de Geología y Minas (DGM), nodo "Investigación":
  `https://tramites.geologia.go.cr/Investigacion/wfs`. Catastro minero:
  `https://tramites.geologia.go.cr/Geoservicios/wfs`. Visor: dgm.addax.cr/VisorDGM.

### Sitios arqueológicos (Museo Nacional)
- NO está en el SNIT (ni institución ni capa). Único hueco real. Camino: conseguir una
  lista de sitios con ubicación desde el registro/visor propio del Museo o publicaciones.
  Pendiente de investigar aparte.

## Capas base y extra de interés (confirmadas en el barrido)

- **IGN base cartográfica** (`geos.snitcr.go.cr/be/IGN_5/wfs`, `/IGN_25/wfs`, `/IGN/wfs`):
  curvas, edificaciones, hidrografía, urbano, vías, ZMT (mojones, líneas digitales, rías).
- **Ortofotos IGN**: 2014-2017 1:5mil alta resolución (`geos1.snitcr.go.cr/Ortofoto2017/{wms,wmts}`)
  y 2015-2018 1:1mil — mapa base aéreo moderno.
- **Cuencas hidrográficas / zonas de vida** (CENIGA/SINIA): `https://geodatos.sinia.go.cr/geoserver/CENIGA/wfs`.
- **Acuíferos y zonas de reserva** (Dirección de Agua): `https://mapas.da.go.cr/geopc.php`.
- **Unidades geoestadísticas censales** (INEC): `https://gestorgeo.inec.go.cr/geoserver/SNIT_INEC_MGN/wfs`
  (UGM, cantonal, distrital). Visor geoportal.inec.go.cr.
- **Planes reguladores** (INVU, capa oficial): WFS ArcGIS
  `https://dservices8.arcgis.com/.../Planes_Reguladores/WFSServer`. Cuadrantes urbanos:
  `http://gms.invu.go.cr/geoserver/cuadrantes/wms`. Áreas de protección de ríos (INVU-PNUD,
  piloto): `http://gms.invu.go.cr/geoserver/invu-pnud/wfs`.
- **Expedientes de viabilidad ambiental** (SETENA): `https://tramites.setena.go.cr/Geoservicios/wfs`.
  (SETENA es quien aprueba los IFA por cantón — fuente institucional clave del índice.)
- **Asentamientos informales + bonos de vivienda** (MIVAH): open data ArcGIS
  geoexplora-mivah.opendata.arcgis.com.
- **Valor de terreno por m²** (Hacienda/ONT): visor ArcGIS (ISBI, zonas homogéneas).
- **Declaratoria ZMT / aptitud turística** (ICT): capas oficiales para cantones costeros.
- **SINAC** (ya integrado): `https://geos1pne.sirefor.go.cr/wfs` — ASP, corredores,
  patrimonio natural, humedales, áreas de conservación (uso libre).
- **CNE** (ya integrado): `http://mapas.cne.go.cr/servicios/cne/wfs` — deslizamientos,
  fallas, inundación (copyright, solo http).

## Munis con nodo propio rico (datos a nivel cantonal, útiles para cantones piloto)

- San Carlos (53 capas, visor idesca.munisc.go.cr): amenazas CNE, catastro, asentamientos
  informales, acueducto, albergues.
- Carrillo (26 capas): **pendientes** (calculadas de curvas 1:5mil), mosaico predial,
  cuadrantes urbanos, uso de la tierra.
- Palmares (12): red vial cantonal, **ifa_palmares** (ya tienen capa IFA), mapa catastral.
- San Ramón (6): capacidad uso del suelo, vías públicas.

## Académicas (UCR/UNA/CeNAT) — posibles para temas específicos

- CICG-UCR (Centro de Investigación en Ciencias Geológicas): geología.
- LanammeUCR: estado/condición de la red vial.
- UNA proyectos Barva/Poás/Chiz-Maravilla: amenaza volcánica.
- CeNAT/PRIAS: cobertura arbórea, flora GAM (con Museo Nacional-Herbario).
