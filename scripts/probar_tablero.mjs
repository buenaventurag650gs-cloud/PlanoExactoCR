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
// La estructura del Plan Regulador vive en el mundo público y la comparten atlas y
// calibrador, así que se lee de data/, no de muni/.
const leeRaiz = (f) => fs.readFileSync(path.join(MUNI, '..', f), 'utf8');

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

// capaGeoJSON construye con L.geoJSON(fc, opts); se envuelve para saber qué capa es.
let nombreEnCurso = null;
L.geoJSON = (fc, o) => capaFalsa(nombreEnCurso);

const codigo = lee('app.js');
// Marca el nombre de la capa justo antes de construirla, para poder rastrearla.
const codigoInstrumentado = codigo.replace(
  'return L.geoJSON(fc, Object.assign({',
  'globalThis.__marcar(nombre);\n    return L.geoJSON(fc, Object.assign({');
globalThis.__marcar = (n) => { nombreEnCurso = n; };

/* Monta el tablero en una ventana simulada. Se usa dos veces: una con la estructura del
   Plan Regulador disponible y otra sin ella, para probar que el atlas no se cae cuando el
   mundo público no responde. */
function montar({ sinEstructura = false, busqueda = '' } = {}) {
  const dom = new JSDOM(lee('index.html'),
    { runScripts: 'outside-only', url: 'https://atlas.planoexactocr.com/' + busqueda });
  const w = dom.window;
  w.fetch = async (url) => {
    pedidos.push(url);
    const local = ['capas.json', 'mapas_oficiales.json', 'escudos.json', 'simbologia.json']
      .find((f) => url.endsWith(f));
    if (local) return { ok: true, json: async () => JSON.parse(lee(local)) };
    if (url.endsWith('estructura_pr.json')) {
      if (sinEstructura) return { ok: false, json: async () => null };
      return { ok: true, json: async () => JSON.parse(leeRaiz('data/estructura_pr.json')) };
    }
    if (url.includes('cantones.geojson')) return { ok: true, json: async () => cantones };
    // asadas.json no es GeoJSON: es una lista de registros con las coordenadas en "ll".
    if (url.includes('asadas.json')) return { ok: true, json: async () => asadasCrudas };
    return { ok: true, json: async () => capaDemo };
  };
  w.L = L; w.turf = turf;
  w.Image = class { set src(v) { this._src = v; setTimeout(() => this.onerror && this.onerror(), 0); } };
  w.print = () => { w.__imprimio = true; };
  w.__marcar = globalThis.__marcar;
  w.eval(codigoInstrumentado.replace('globalThis.__marcar(nombre);', 'window.__marcar(nombre);'));
  return w;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const window = montar();
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
// La regla @page de CSS solo conoce nombres de papel hasta A3: "size: A2" no existe y el
// navegador la ignora, se va a Carta y recorta la lámina. Por eso tiene que salir la medida
// exacta en milímetros, nunca el nombre.
const lam = $('laminas');
afirmar(lam.style.getPropertyValue('--pw') === '594mm', `papel por defecto A2 apaisado (--pw = ${lam.style.getPropertyValue('--pw')})`);
afirmar(lam.style.getPropertyValue('--ph') === '420mm', `alto de A2 apaisado (--ph = ${lam.style.getPropertyValue('--ph')})`);
const reglaPagina = $('estiloPapel').textContent;
afirmar(reglaPagina.includes('size: 594mm 420mm'), `@page lleva la medida exacta (${reglaPagina.trim()})`);
afirmar(!/size:\s*A\d/.test(reglaPagina), '@page no usa el nombre del papel, que el navegador ignoraría');
afirmar(reglaPagina.includes('margin: 0'), '@page va sin márgenes');
$('selPapel').value = 'A1';
$('selPapel').dispatchEvent(new window.Event('change'));
afirmar(lam.style.getPropertyValue('--pw') === '841mm' && $('estiloPapel').textContent.includes('841mm 594mm'),
  `se puede imprimir en A1 (${lam.style.getPropertyValue('--pw')})`);
$('selPapel').value = 'Carta';
$('selPapel').dispatchEvent(new window.Event('change'));
afirmar(lam.style.getPropertyValue('--pw') === '279.4mm', `al cambiar a Carta, la hoja mide 279,4 mm (${lam.style.getPropertyValue('--pw')})`);
afirmar(Math.abs(parseFloat(lam.style.getPropertyValue('--k')) - 1) < 0.001, 'k vuelve a 1 en Carta apaisada');
$('selPapel').value = 'A2';
$('selPapel').dispatchEvent(new window.Event('change'));
afirmar(Math.abs(parseFloat(lam.style.getPropertyValue('--k')) - 2.126) < 0.01, `k ≈ 2.13 en A2 (es ${lam.style.getPropertyValue('--k')})`);
// Orientación: forzada vertical, la hoja se para; en automático la decide la forma del cantón.
$('selOrient').value = 'vertical';
$('selOrient').dispatchEvent(new window.Event('change'));
afirmar(lam.style.getPropertyValue('--pw') === '420mm' && lam.style.getPropertyValue('--ph') === '594mm',
  'la orientación vertical para la hoja');
$('selOrient').value = 'auto';
$('selOrient').dispatchEvent(new window.Event('change'));
afirmar(lam.style.getPropertyValue('--pw') === '594mm', 'en automático vuelve a apaisada para este cantón');

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

// ---------- 11b. La lámina sigue la cartografía de un Plan Regulador ----------
// Cajetín en columna a la derecha, no una franja abajo.
const hoja0 = laminas[0].querySelector('.lam-hoja');
afirmar(!!hoja0 && !!hoja0.querySelector(':scope > .lam-izq') && !!hoja0.querySelector(':scope > .lam-caj'),
  'la hoja se parte en mapa (izquierda) y cajetín (columna derecha)');
afirmar(hoja0.querySelector('.lam-caj').contains(laminas[0].querySelector('.lam-inset')),
  'el recuadro de ubicación vive dentro del cajetín');
const cajTexto = hoja0.querySelector('.lam-caj').textContent;
afirmar(cajTexto.includes('Plan Regulador Territorial'), 'el cajetín encabeza con el Plan Regulador Territorial');
afirmar(cajTexto.includes('CRTM05'), 'el cajetín declara el sistema de coordenadas');
afirmar(cajTexto.includes('Fuentes:'), 'el cajetín declara las fuentes');
afirmar(cajTexto.includes('Fecha de elaboración'), 'el cajetín trae la fecha de elaboración');
afirmar(/Lámina 1 \/ 3/.test(cajTexto), `el cajetín numera la lámina (${(cajTexto.match(/Lámina[^·]*/) || [''])[0].trim()})`);

// Escala numérica: redonda, para que se pueda medir sobre el papel impreso.
const escTxt = (laminas[0].querySelector('[id^="esc-"]') || {}).textContent || '';
const escNum = parseInt((escTxt.match(/1:\s*([\d ]+)/) || [0, ''])[1].replace(/\s/g, ''), 10);
afirmar(escNum > 0, `la lámina declara su escala numérica (${escTxt.replace(/\s+/g, ' ').trim()})`);
const redonda = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10]
  .some((b) => [100, 1000, 10000, 100000].some((e) => Math.abs(escNum - b * e) < 1));
afirmar(redonda, `la escala es una escala redonda de plano, no un número cualquiera (1:${escNum})`);

// Grilla de coordenadas CRTM05, con rótulos por fuera del marco en los cuatro lados.
const rej = laminas[0].querySelector('.lam-rej');
afirmar(!!rej, 'la lámina trae la capa de rótulos de la grilla');
const lados = ['sup', 'inf', 'izq', 'der'].filter((c) => rej.querySelector('.rej.' + c));
afirmar(lados.length === 4, `la grilla se rotula en los cuatro lados (${lados.join(', ')})`);
const esteTxt = [...rej.querySelectorAll('.rej.sup')].map((e) => +e.textContent);
const norteTxt = [...rej.querySelectorAll('.rej.izq')].map((e) => +e.textContent);
// Costa Rica entera cae entre ~300 000 y ~660 000 de este, y ~880 000 a ~1 250 000 de norte.
afirmar(esteTxt.length >= 2 && esteTxt.every((v) => v > 300000 && v < 660000),
  `los rótulos de este son metros CRTM05 creíbles (${esteTxt.join(', ')})`);
afirmar(norteTxt.length >= 2 && norteTxt.every((v) => v > 880000 && v < 1250000),
  `los rótulos de norte son metros CRTM05 creíbles (${norteTxt.join(', ')})`);
const pasoE = esteTxt.length > 1 ? Math.abs(esteTxt[1] - esteTxt[0]) : 0;
afirmar(pasoE > 0 && /^[125]0*$|^25 *0*$/.test(String(pasoE).replace(/0+$/, (c) => '0'.repeat(c.length))) || pasoE > 0,
  `la grilla avanza a paso constante (${pasoE} m)`);
afirmar(esteTxt.every((v, n, a) => n === 0 || Math.abs((v - a[n - 1]) - pasoE) < 1),
  'todos los intervalos de la grilla miden lo mismo');
const lineasGrilla = [...svg0.querySelectorAll('path')].filter((p) => p.getAttribute('stroke') === '#8d8d8d');
afirmar(lineasGrilla.length >= 4, `la grilla también se dibuja sobre el mapa (${lineasGrilla.length} líneas)`);

// Sin relieve (acá no hay red) la lámina igual se arma: el fondo es opcional.
afirmar(svg0.querySelectorAll('image').length === 0, 'sin teselas de relieve la lámina sale igual, sin sombras');

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

// ---------- 13. Pestaña de estructura cartográfica ----------
const pestanas = todos('.pest');
afirmar(pestanas.length === 2, `estructura: hay dos pestañas (${pestanas.map((p) => p.dataset.vista)})`);
afirmar(!$('map').hidden && $('estructura').hidden, 'estructura: arranca en el visor');

pestanas[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
afirmar($('map').hidden && !$('estructura').hidden, 'estructura: la pestaña cambia de vista');

/* La estructura lista el ÍNDICE MAESTRO completo del Plan Regulador, no solo lo que el
   atlas puede dibujar: es la obra entera, con lo que falta a la vista. */
const estrucDoc = JSON.parse(leeRaiz('data/estructura_pr.json'));
const filasEst = todos('#estCuerpo .est-tabla tbody tr');
afirmar(filasEst.length === estrucDoc.mapas.length,
  `estructura: lista los ${estrucDoc.mapas.length} mapas del índice maestro (hay ${filasEst.length})`);
const bloquesConMapas = estrucDoc.bloques
  .filter((b) => estrucDoc.mapas.some((m) => m.bloque === b.codigo)).length;
afirmar(todos('#estCuerpo .est-eje').length === bloquesConMapas,
  `estructura: agrupa por los ${bloquesConMapas} bloques cartográficos`);
afirmar(todos('#estCuerpo .est-comp').length > 15,
  `estructura: subdivide en componentes (${todos('#estCuerpo .est-comp').length})`);
afirmar($('estResumen').textContent.includes('mapas en la obra'), 'estructura: muestra el resumen de avance');

// Cada fila se identifica por su código M, que es el que pide la guía para citar mapas.
const codigos = todos('#estCuerpo .est-cod').map((e) => e.textContent.trim());
afirmar(codigos.length === estrucDoc.mapas.length && codigos.includes('M1.1.90')
  && codigos.includes('M4.1.01'),
  'estructura: cada mapa se rotula con su código M del índice maestro');
afirmar(codigos.join() === estrucDoc.mapas.map((m) => m.codigo).join(),
  'estructura: los códigos salen en el orden del índice maestro');

// Dice quién resuelve cada mapa: el atlas, el calibrador o el equipo consultor.
const texto = $('estCuerpo').textContent;
['atlas', 'calibrador', 'equipo'].forEach((quien) => {
  afirmar(todos(`#estCuerpo .badge.quien.${quien === 'calibrador' ? 'calib' : quien}`).length > 0,
    `estructura: marca los mapas que resuelve ${quien === 'equipo' ? 'el equipo consultor' : 'el ' + quien}`);
});
afirmar(texto.includes('Lo resuelve el calibrador'),
  'estructura: explica que los mapas propositivos los arma el calibrador');
afirmar(todos('#estCuerpo .badge.guia').length > 0,
  'estructura: señala los mapas mínimos de la Guía de Cartografía del INVU');
afirmar(texto.includes('Etapa 3'), 'estructura: cada bloque dice a qué etapa del proceso pertenece');

// Un mapa que resuelve el calibrador no ofrece descarga acá: no es del atlas.
const filaCalib = filasEst.find((r) => r.querySelector('.badge.quien.calib'));
afirmar(filaCalib && !filaCalib.querySelector('[data-descargar]'),
  'estructura: un mapa del calibrador no ofrece descarga en el atlas');

// Cada insumo dice de dónde sale y si está.
const insumos = todos('#estCuerpo .est-ins');
afirmar(insumos.length > 20, `estructura: detalla los insumos de cada mapa (${insumos.length})`);
afirmar(insumos.some((i) => i.textContent.includes('PlanoExacto')),
  'estructura: marca cuáles capas son propias de PlanoExacto');
afirmar(todos('#estCuerpo .est-ins .punto.ok').length > 0 && todos('#estCuerpo .est-ins .punto.falta').length > 0,
  'estructura: distingue los insumos que están de los que faltan');
// Los integrados del IFA no tienen insumos sueltos: se calculan del eje.
afirmar(todos('#estCuerpo .est-calc').some((e) => e.textContent.includes('sumando los sub-mapas')),
  'estructura: explica que los integrados del IFA se calculan, no se dibujan de capas');

// Botón de descarga: compone ese mapa solo, en el momento.
const btnDescargar = todos('#estCuerpo [data-descargar]');
afirmar(btnDescargar.length > 0, `estructura: hay botón de descargar por mapa (${btnDescargar.length})`);
const pendiente = todos('#estCuerpo .est-tabla tbody tr')
  .find((r) => r.textContent.includes('pendiente'));
afirmar(pendiente && !pendiente.querySelector('[data-descargar]'),
  'estructura: un mapa pendiente no ofrece descarga');

const antes = todos('#laminas .lamina').length;
window.__imprimio = false;
const btnBase = btnDescargar.find((b) => b.dataset.descargar === 'base_cartografica');
btnBase.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await esperar(700);
afirmar(todos('#laminas .lamina').length === 1,
  `estructura: descargar genera UNA sola lámina, la de ese mapa (había ${antes}, quedó ${todos('#laminas .lamina').length})`);
afirmar(window.__imprimio === true, 'estructura: descargar abre el diálogo de impresión');
afirmar(window.document.title.includes('Mapa base cartográfico') && window.document.title.includes('Acosta'),
  `estructura: el archivo sale con el nombre del mapa y el cantón ("${window.document.title}")`);
afirmar(todos('#laminas .lam-mapa-wrap > svg.lam-svg').length === 1,
  'estructura: la lámina descargada es el SVG vectorial, igual que el export normal');

pestanas[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
afirmar(!$('map').hidden && $('estructura').hidden, 'estructura: se puede volver al visor');

/* ---------- coherencia entre la estructura compartida y el catálogo del atlas ----------
   Si la estructura apunta a un mapa que el atlas no tiene, la fila sale sin estado ni
   descarga y nadie se entera. Esto lo pesca antes. */
const idsCatalogo = new Set(JSON.parse(lee('mapas_oficiales.json')).instituciones
  .flatMap((i) => i.mapas.map((m) => m.id)));
const apuntanAlVacio = estrucDoc.mapas
  .filter((m) => m.atlas && !idsCatalogo.has(m.atlas))
  .map((m) => `${m.codigo}→${m.atlas}`);
afirmar(apuntanAlVacio.length === 0,
  `estructura: ningún código apunta a un mapa que el atlas no tenga (${apuntanAlVacio.join(', ')})`);

const sinCodigo = [...idsCatalogo]
  .filter((id) => !estrucDoc.mapas.some((m) => m.atlas === id));
afirmar(sinCodigo.length === 0,
  `estructura: todo mapa del atlas tiene su código en el índice maestro (sin código: ${sinCodigo.join(', ')})`);

// Un mapa marcado "lo resuelve el atlas" debería tener su lámina, o decir que falta armarla.
const atlasSinLamina = estrucDoc.mapas.filter((m) => m.resuelve === 'atlas' && !m.atlas).length;
afirmar(todos('#estCuerpo .badge.quien.espera').length === atlasSinLamina,
  `estructura: avisa cuáles le tocan al atlas pero aún no tienen lámina (${atlasSinLamina})`);

// La rampa del IFA del tablero y la de la estructura compartida tienen que ser la misma.
const rampaEstructura = estrucDoc.clases_ifa.map((c) => c.color.toLowerCase()).join();
const rampaTablero = (codigo.match(/RAMPA_IFA\s*=\s*\[([\s\S]*?)\]\s*;/) || [])[1] || '';
const coloresTablero = [...rampaTablero.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toLowerCase());
afirmar(coloresTablero.length === 5
  && coloresTablero.slice().sort().join() === rampaEstructura.split(',').sort().join(),
  `estructura: la rampa del IFA del tablero usa los mismos 5 colores que la estructura compartida`);

/* ---------- respaldo: sin estructura compartida el atlas no se cae ----------
   El atlas lee la estructura de otro origen. Si ese origen no responde, tiene que seguir
   sirviendo su propio catálogo y decirlo, no quedarse en blanco. */
{
  const w2 = montar({ sinEstructura: true });
  await esperar(500);
  const $2 = (id) => w2.document.getElementById(id);
  const pest2 = [...w2.document.querySelectorAll('.pest')];
  pest2[1].dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
  const filas2 = [...w2.document.querySelectorAll('#estCuerpo .est-tabla tbody tr')];
  const mapasPropios = JSON.parse(lee('mapas_oficiales.json')).instituciones
    .reduce((n, i) => n + i.mapas.length, 0);
  afirmar(filas2.length === mapasPropios,
    `respaldo: sin estructura compartida muestra el catálogo propio (${filas2.length} de ${mapasPropios})`);
  afirmar($2('estCuerpo').textContent.includes('No se pudo leer la estructura compartida'),
    'respaldo: avisa que los códigos pueden no coincidir con los del calibrador');
  afirmar(filas2.some((r) => r.querySelector('[data-descargar]')),
    'respaldo: se siguen pudiendo descargar los mapas del atlas');
}

/* ---------- llegar desde el calibrador a un mapa concreto ----------
   El calibrador enlaza cada mapa con ?canton=…&mapa=…; el atlas tiene que elegir ese cantón
   y abrir ese mapa, no la portada. */
{
  const w3 = montar({ busqueda: '?canton=acosta&mapa=base_cartografica' });
  await esperar(900);
  const $3 = (id) => w3.document.getElementById(id);
  afirmar($3('selCanton').value === 'Acosta',
    `enlace entrante: elige el cantón del enlace aunque venga sin tilde ni mayúscula (${$3('selCanton').value})`);
  const filaBase = [...w3.document.querySelectorAll('#catalogo .fila')]
    .find((f) => /Mapa base/i.test(f.textContent));
  afirmar(!!filaBase && filaBase.classList.contains('viendo'),
    'enlace entrante: deja prendido el mapa pedido, no la portada');
  afirmar(!$3('map').hidden, 'enlace entrante: se queda en el visor para que se vea el mapa');
}

/* Un mapa que todavía no se puede dibujar manda a la estructura, que es donde se explica
   qué insumo le falta. */
{
  const w4 = montar({ busqueda: '?canton=Acosta&mapa=geo_litopetrofisico' });
  await esperar(900);
  afirmar(!w4.document.getElementById('estructura').hidden,
    'enlace entrante: un mapa sin insumos abre la estructura en vez de dejar la pantalla vacía');
  const marcado = w4.document.querySelector('#estCuerpo tr[data-mapa="geo_litopetrofisico"]');
  afirmar(!!marcado, 'enlace entrante: la fila del mapa se puede ubicar por su identificador');
  afirmar(marcado && marcado.dataset.situacion === 'falta',
    `enlace entrante: la fila dice en qué situación está (${marcado && marcado.dataset.situacion})`);
}

/* ---------- filtrar la estructura por lo que falta ---------- */
{
  const chips = [...window.document.querySelectorAll('#estResumen .est-chip.filtro')];
  afirmar(chips.length === 3, `estructura: hay tres chips de situación para filtrar (${chips.length})`);
  const antes = [...window.document.querySelectorAll('#estCuerpo tr[data-situacion]')];
  const falta = chips.find((c) => c.dataset.filtro === 'falta');
  falta.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const visibles = antes.filter((r) => !r.hidden);
  afirmar(visibles.length > 0 && visibles.every((r) => r.dataset.situacion === 'falta'),
    `estructura: el filtro deja solo los mapas a los que les falta un insumo (${visibles.length})`);
  afirmar(visibles.length < antes.length, 'estructura: filtrar de verdad esconde los demás');
  afirmar([...window.document.querySelectorAll('#estCuerpo .est-comp')]
    .filter((c) => !c.hidden).every((c) => c.querySelector('tr[data-situacion]:not([hidden])')),
    'estructura: no quedan títulos de componente sin mapas debajo');
  falta.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  afirmar(antes.every((r) => !r.hidden), 'estructura: tocar el chip otra vez vuelve a mostrar todo');
}

// ---------- resultado ----------
console.log('\n=== PRUEBAS DEL TABLERO ===');
ok.forEach((m) => console.log('  ok  ' + m));
if (fallos.length) { console.log('\nFALLOS:'); fallos.forEach((m) => console.log('  XX  ' + m)); }
console.log(`\n${ok.length} ok, ${fallos.length} fallos`);
process.exit(fallos.length ? 1 : 0);
