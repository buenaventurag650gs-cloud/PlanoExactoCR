/* Prueba del tablero (muni/index.html + app.js) en un navegador simulado (jsdom), con
   Leaflet y turf sustituidos por dobles de prueba y fetch leyendo los archivos locales.
   Verifica: construcción del panel, ojito exclusivo, casilla de impresión independiente,
   grupos colapsables, leyenda y tamaño de papel. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Necesita jsdom:  npm install jsdom
// Correr desde la raíz del repo:  node scripts/probar_tablero.mjs
const MUNI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'muni');
const lee = (f) => fs.readFileSync(path.join(MUNI, f), 'utf8');

const fallos = [];
const ok = [];
function afirmar(cond, msg) { (cond ? ok : fallos).push(msg); }

// --- doble de Leaflet: registra capas añadidas sin dibujar nada ---
const capasAgregadas = new Set();
function capaFalsa(nombre) {
  return { _nombre: nombre, addTo(m) { if (m && m._principal && nombre) capasAgregadas.add(nombre); return this; },
           remove() { }, getBounds: () => ({}) };
}
const L = {
  map: () => ({ _principal: true, createPane: () => ({ style: {} }), getPane: () => ({ style: {} }),
                setView() { return this; }, addTo() { return this; }, fitBounds() {}, removeLayer(l) { if (l && l._nombre) capasAgregadas.delete(l._nombre); },
                invalidateSize() {}, remove() {} }),
  tileLayer: () => ({ addTo() { return this; } }),
  control: { layers: () => ({ addTo() { return this; } }), scale: () => ({ addTo() { return this; } }) },
  geoJSON: (fc, o) => capaFalsa(o && o.__nombre),
  svg: () => ({}), circleMarker: () => ({}), marker: () => ({ addTo() { return this; } }), divIcon: () => ({})
};
// capaGeoJSON de app.js llama L.geoJSON sin nombre; se parchea para rastrear por el estilo.
const turf = { booleanIntersects: () => true, bboxPolygon: () => ({}), centroid: () => ({ geometry: { coordinates: [0, 0] } }) };

const dom = new JSDOM(lee('index.html'), { runScripts: 'outside-only', url: 'https://atlas.planoexactocr.com/' });
const { window } = dom;

// Datos locales + un cantón de prueba para el geojson remoto.
const cantones = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { k: 'Acosta' }, geometry: { type: 'Polygon', coordinates: [[[-84.3, 9.7], [-84.0, 9.7], [-84.0, 9.95], [-84.3, 9.95], [-84.3, 9.7]]] } },
  { type: 'Feature', properties: { k: 'Mora' }, geometry: { type: 'Polygon', coordinates: [[[-84.4, 9.9], [-84.2, 9.9], [-84.2, 10.1], [-84.4, 10.1], [-84.4, 9.9]]] } }
] };
const capaDemo = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-84.2, 9.8], [-84.1, 9.9]] } }
] };
// Forma real de asadas.json en el sitio público, para probar el adaptador.
const asadasCrudas = { fuente: 'ARESEP', n: 2, asadas: [
  { id: '1', n: 'ASADA UNO', tipo: 'Bombeo', ll: [-84.2, 9.8] },
  { id: '2', n: 'ASADA DOS', tipo: 'Gravedad', ll: [-84.15, 9.85] }] };
const pedidos = [];
window.fetch = async (url) => {
  pedidos.push(url);
  const local = ['capas.json', 'mapas_oficiales.json', 'escudos.json', 'simbologia.json'].find((f) => url.endsWith(f));
  if (local) return { ok: true, json: async () => JSON.parse(lee(local)) };
  if (url.includes('cantones.geojson')) return { ok: true, json: async () => cantones };
  // asadas.json no es GeoJSON: es una lista de registros con las coordenadas en "ll".
  if (url.includes('asadas.json')) return { ok: true, json: async () => asadasCrudas };
  return { ok: true, json: async () => capaDemo };
};
window.L = L; window.turf = turf;
window.Image = class { set src(v) { this._src = v; setTimeout(() => this.onerror && this.onerror(), 0); } };
window.print = () => { window.__imprimio = true; };

// capaGeoJSON construye con L.geoJSON(fc, opts); se envuelve para saber qué capa es.
const origGeo = L.geoJSON;
let nombreEnCurso = null;
L.geoJSON = (fc, o) => capaFalsa(nombreEnCurso);

const codigo = lee('app.js');
// Marca el nombre de la capa justo antes de construirla, para poder rastrearla.
const codigoInstrumentado = codigo.replace(
  'return L.geoJSON(fc, Object.assign({',
  'globalThis.__marcar(nombre);\n    return L.geoJSON(fc, Object.assign({');
globalThis.__marcar = (n) => { nombreEnCurso = n; };
window.__marcar = globalThis.__marcar;

window.eval(codigoInstrumentado.replace('globalThis.__marcar(nombre);', 'window.__marcar(nombre);'));

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => window.document.getElementById(id);
const todos = (s) => [...window.document.querySelectorAll(s)];

await esperar(300);

// ---------- 1. El panel se construye ----------
const grupos = todos('#catalogo .grupo');
afirmar(grupos.length === 8, `catálogo con 8 ejes (hay ${grupos.length})`);
const basGr = todos('#capasBase .grupo');
afirmar(basGr.length === 1, `grupo de capas base creado (hay ${basGr.length})`);
const filasBase = todos('#capasBase .fila');
afirmar(filasBase.length === 7, `7 capas base listadas (hay ${filasBase.length})`);

// ---------- 2. Los ejes del IFA no se pueden ver, solo imprimir ----------
const geo = grupos[0];
const ojosGeo = [...geo.querySelectorAll('.fila .ojo')];
afirmar(ojosGeo.every((b) => b.disabled), 'ejes IFA: todos los ojitos deshabilitados (solo PDF)');
afirmar(geo.querySelectorAll('.badge.pdf').length === 6, 'eje 1 marca sus 6 mapas como "solo PDF"');
const fisico = grupos[5];
const ojosFis = [...fisico.querySelectorAll('.fila .ojo')];
afirmar(ojosFis.filter((b) => !b.disabled).length >= 4, `eje 6: hay mapas con ojito activo (${ojosFis.filter((b) => !b.disabled).length})`);

// ---------- 3. Colapsar ----------
afirmar(!geo.classList.contains('abierto'), 'los ejes arrancan colapsados');
afirmar(fisico.classList.contains('abierto'), 'el eje 6 (físico-espacial) arranca abierto');
geo.querySelector('.grupo-cab').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
afirmar(geo.classList.contains('abierto'), 'clic en el encabezado abre el grupo');

// ---------- 4. Botón de impresora del eje = mapa integrado ----------
const btnEjeGeo = geo.querySelector('.grupo-cab .ctrl.eje');
afirmar(!!btnEjeGeo, 'el eje 1 tiene botón de impresora en el encabezado');
btnEjeGeo.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
afirmar(btnEjeGeo.classList.contains('on'), 'el botón del eje queda marcado');
afirmar($('resumen').textContent.includes('1 mapa'), `resumen cuenta 1 mapa (dice: "${$('resumen').textContent}")`);
afirmar(!geo.classList.contains('abierto') === false, 'el clic en el botón del eje no cierra el grupo');

// ---------- 5. Elegir cantón ----------
const sel = $('selCanton');
afirmar(sel.options.length === 3, `el selector trae los cantones (${sel.options.length - 1})`);
sel.value = 'Acosta';
sel.dispatchEvent(new window.Event('change'));
await esperar(400);
afirmar(!$('catalogo').classList.contains('bloqueado'), 'al elegir cantón se desbloquea el catálogo');
const basePrendidas = todos('#capasBase .ojo.on').length;
afirmar(basePrendidas === 3, `se prenden 3 capas base por defecto (hay ${basePrendidas})`);
afirmar(capasAgregadas.size === 3, `3 capas dibujadas en el mapa (hay ${capasAgregadas.size}: ${[...capasAgregadas]})`);

// ---------- 6. Ojito exclusivo entre mapas ----------
const filasFis = [...fisico.querySelectorAll('.fila')];
const usoSuelo = filasFis[1];      // 6.2 Uso actual del suelo
const amenazas = filasFis[2];      // 6.3 Amenazas y condicionantes
usoSuelo.querySelector('.ojo').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await esperar(300);
afirmar(usoSuelo.classList.contains('viendo'), '6.2 queda marcado como "viendo"');
const conUso = new Set(capasAgregadas);
afirmar(conUso.has('Uso urbano 1:5mil'), `se dibujan las capas de 6.2 (${[...conUso]})`);

amenazas.querySelector('.ojo').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await esperar(300);
afirmar(!usoSuelo.classList.contains('viendo'), 'al ver 6.3, el 6.2 anterior se apaga solo');
afirmar(amenazas.classList.contains('viendo'), '6.3 queda marcado como "viendo"');
afirmar(!capasAgregadas.has('Uso urbano 1:5mil'), 'las capas del mapa anterior se quitan del mapa');
afirmar(capasAgregadas.has('Deslizamientos'), `se dibujan las capas de 6.3 (${[...capasAgregadas]})`);
afirmar(todos('.fila.viendo .ojo.on').length === 4, 'solo un mapa temático visible a la vez (3 base + 1 mapa)');

// ---------- 7. Ver e imprimir son independientes ----------
afirmar(!amenazas.querySelector('.imp').classList.contains('on'), 'ver un mapa NO lo marca para imprimir');
amenazas.querySelector('.imp').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
afirmar($('resumen').textContent.includes('2 mapas'), `ahora hay 2 mapas marcados ("${$('resumen').textContent}")`);
amenazas.querySelector('.ojo').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await esperar(200);
afirmar($('resumen').textContent.includes('2 mapas'), 'apagar el ojito no desmarca la impresión');

// ---------- 8. Leyenda ----------
const ley = $('leyenda').textContent;
afirmar(ley.includes('Límite cantonal'), 'la leyenda muestra el límite cantonal');
afirmar(ley.includes('Red vial cantonal'), 'la leyenda muestra las capas base visibles');
afirmar(ley.includes('Índice de Fragilidad Ambiental') && ley.includes('Muy Alta') && ley.includes('Muy Baja'),
  'la leyenda muestra la rampa IFA al haber mapas IFA marcados');
// La rampa del tablero tiene que ser la misma que la del PDF (scripts/integracion_ifa.py).
const rampaPy = fs.readFileSync('/home/claude/planoexactocr/scripts/integracion_ifa.py', 'utf8');
const coloresPy = [...rampaPy.matchAll(/^\s*\d: "(#[0-9a-f]{6})",/gm)].map((m) => m[1]);
const coloresJs = [...fs.readFileSync(path.join(MUNI, 'app.js'), 'utf8')
  .matchAll(/\['(?:Muy Alta|Alta|Moderada|Baja|Muy Baja)', '(#[0-9a-f]{6})'\]/g)].map((m) => m[1]);
afirmar(coloresPy.length === 5 && JSON.stringify(coloresPy) === JSON.stringify(coloresJs),
  `la rampa del tablero coincide con la del PDF (py ${coloresPy} / js ${coloresJs})`);
const swatches = todos('#leyenda .sw');
afirmar(swatches.some((s) => s.classList.contains('linea')), 'la leyenda usa cuadrito de línea para capas lineales');

// ---------- 9. Tamaño de papel ----------
const lam = $('laminas');
afirmar(lam.style.getPropertyValue('--pw') === '16.54in', `papel por defecto A2 (--pw = ${lam.style.getPropertyValue('--pw')})`);
afirmar($('estiloPapel').textContent.includes('size: A2'), '@page queda en A2');
$('selPapel').value = 'Carta';
$('selPapel').dispatchEvent(new window.Event('change'));
afirmar(lam.style.getPropertyValue('--pw') === '8.5in', 'al cambiar a Carta, la lámina mide 8.5in');
afirmar(Math.abs(parseFloat(lam.style.getPropertyValue('--k')) - 1) < 0.001, 'k vuelve a 1 en Carta');
$('selPapel').value = 'A2';
$('selPapel').dispatchEvent(new window.Event('change'));
afirmar(Math.abs(parseFloat(lam.style.getPropertyValue('--k')) - 1.9459) < 0.01, `k ≈ 1.95 en A2 (es ${lam.style.getPropertyValue('--k')})`);

// ---------- 10. Botones de exportar ----------
afirmar(!$('btnAtlas').disabled, 'el botón de imprimir se habilita con cantón + mapas');

// ---------- 11. Láminas de impresión en SVG ----------
// Se marcan dos mapas que sí se pueden dibujar y se manda a imprimir.
filasFis[0].querySelector('.imp').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));  // 6.1 base
await $('btnAtlas').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await esperar(600);
const laminas = todos('#laminas .lamina');
afirmar(laminas.length === 3, `se arma una lámina por mapa marcado (hay ${laminas.length})`);
afirmar(window.__imprimio === true, 'se dispara la impresión');
const svgs = todos('#laminas .lam-mapa-wrap > svg.lam-svg');
afirmar(svgs.length === 3, `cada lámina tiene su mapa en SVG (hay ${svgs.length})`);
afirmar(todos('#laminas .leaflet-container').length === 0, 'las láminas ya no usan mapas de Leaflet');

const svg0 = svgs[0];
afirmar(/^0 0 10000 /.test(svg0.getAttribute('viewBox')), `viewBox correcto (${svg0.getAttribute('viewBox')})`);
const paths = [...svg0.querySelectorAll('path')];
afirmar(paths.length >= 3, `el SVG trae capas, máscara y límite (${paths.length} trazos)`);
// Lo importante: las coordenadas conservan decimales (Leaflet las redondeaba al píxel).
const conDecimales = paths.filter((p) => /\d+\.\d{1,2}[ L]/.test(p.getAttribute('d') || '')).length;
afirmar(conDecimales >= 2, `las coordenadas conservan decimales, no se redondean (${conDecimales} trazos)`);
const mascara = paths.find((p) => p.getAttribute('fill') === '#ececec');
afirmar(!!mascara && mascara.getAttribute('fill-rule') === 'evenodd', 'la máscara deja el cantón como hueco');
afirmar(paths.every((p) => !p.getAttribute('stroke') || p.getAttribute('stroke') === 'none'
        || p.getAttribute('vector-effect') === 'non-scaling-stroke'),
        'los grosores se miden en el papel (non-scaling-stroke)');
afirmar(!!laminas[0].querySelector('.lam-escala .barra'), 'la lámina trae barra de escala');
afirmar(!!laminas[0].querySelector('.lam-inset svg'), 'la lámina trae el recuadro de ubicación');
afirmar(laminas[0].querySelectorAll('.caj-leyenda .ley-item').length >= 4, 'el cajetín trae la simbología');

// ---------- 12. Capas compartidas con el mundo público de PlanoExactoCR ----------
const capasDoc = JSON.parse(lee('capas.json'));
const todasCapas = capasDoc.grupos.flatMap((g) => g.capas);
const copiasLocales = todasCapas.filter((c) => String(c.archivo || '').startsWith('data/'));
afirmar(copiasLocales.length === 0,
  `capas: ninguna es copia local, todas se leen del sitio público (${copiasLocales.map((c) => c.nombre)})`);
const compartidas = todasCapas.filter((c) => String(c.archivo || '').includes('planoexactocr.com/data/'));
afirmar(compartidas.length >= 12,
  `capas: ${compartidas.length} capas se leen de planoexactocr.com/data (la misma infraestructura del visor)`);
const conFormato = todasCapas.filter((c) => c.formato === 'puntos_ll');
afirmar(conFormato.length >= 3,
  `capas: las que no son GeoJSON declaran su formato (${conFormato.map((c) => c.nombre)})`);
// Toda capa con simbología declarada y viceversa.
const simbDoc = JSON.parse(lee('simbologia.json'));
const sinSimb = todasCapas.filter((c) => c.archivo && !String(c.archivo).startsWith('api:')
  && !simbDoc.capas[c.nombre]).map((c) => c.nombre);
afirmar(sinSimb.length === 0, `capas: todas tienen simbología declarada (faltan: ${sinSimb})`);

// El adaptador de listas "ll" tiene que producir puntos dibujables.
const filaServicios = [...window.document.querySelectorAll('#catalogo .fila')]
  .find((f) => f.textContent.includes('Infraestructura y servicios'));
afirmar(!!filaServicios, 'capas: el mapa de servicios está en el catálogo');
afirmar(filaServicios.textContent.includes('disponible'),
  'capas: el mapa de servicios quedó disponible al sumarle las capas de cobertura');
filaServicios.querySelector('.ojo').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await esperar(400);
afirmar(capasAgregadas.has('ASADAS y abastecimiento de agua'),
  `capas: una lista con coordenadas "ll" se convierte y se dibuja (${[...capasAgregadas]})`);
afirmar(capasAgregadas.has('Cobertura del tendido eléctrico (100 m)'),
  'capas: las coberturas nuevas se dibujan en el mapa de servicios');

// ---------- resultado ----------
console.log('\n=== PRUEBAS DEL TABLERO ===');
ok.forEach((m) => console.log('  ok  ' + m));
if (fallos.length) { console.log('\nFALLOS:'); fallos.forEach((m) => console.log('  XX  ' + m)); }
console.log(`\n${ok.length} ok, ${fallos.length} fallos`);
process.exit(fallos.length ? 1 : 0);
