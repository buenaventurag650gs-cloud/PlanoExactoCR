/* Previsualiza una lámina del atlas como imagen, sin abrir el navegador a mano.

   Sirve para revisar la maqueta de la lámina —dónde cae el cajetín, si la grilla de
   coordenadas respira, si el título estorba, cómo queda el relieve de fondo— cada vez que se
   le mete mano al diseño. Levanta el tablero en un Chrome sin ventana, le pone el cantón que
   se le pida, manda a armar las láminas y guarda un PNG de la primera.

   Uso:
       node scripts/previsualizar_lamina.mjs
       node scripts/previsualizar_lamina.mjs --canton Abangares --papel A2 --mapa base --salida /tmp/lamina.png

   Qué es de verdad y qué es de mentira:
     - La geometría del cantón y los distritos salen de data/, o sea que son las de verdad.
     - Las capas del SNIT no se piden (acá no hay salida a esos servidores): salen vacías.
     - El relieve sombreado es SIMULADO. El servicio real tampoco se alcanza desde acá, así
       que se generan teselas con un terreno inventado, continuo entre teselas, solo para
       comprobar que la imagen cae en el lugar y la escala correctos. En el sitio publicado
       el relieve es el de verdad (Esri World Hillshade).

   Necesita playwright:  pip install playwright && playwright install chromium
*/
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const CANTON = arg('canton', 'Abangares');
const PAPEL = arg('papel', 'A2');
const MAPA = arg('mapa', '');          // parte del nombre del mapa, p. ej. "base"
const SALIDA = arg('salida', path.join(RAIZ, 'salida', 'lamina_previa.png'));

// ---------- un PNG mínimo, para fabricar las teselas de relieve simulado ----------
const tablaCRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = tablaCRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function png(w, h, rgb) {
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
    const t = Buffer.from(tipo, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, datos])));
    return Buffer.concat([largo, t, datos, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;                        // 8 bits por canal, color RGB
  const crudo = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    crudo[y * (1 + w * 3)] = 0;                    // filtro "ninguno" en cada fila
    rgb.copy(crudo, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}

/* Terreno inventado: una suma de ondas, igual en todo el mundo, así que dos teselas vecinas
   calzan sin costura. De ahí se saca la sombra como lo haría un hillshade: qué tanto se
   inclina el terreno hacia el noroeste. */
function alturaEn(u, v) {
  return 70 * Math.sin(u * 0.0016) * Math.cos(v * 0.0013)
       + 34 * Math.sin(u * 0.0051 + 1.3) * Math.cos(v * 0.0047 + 0.4)
       + 15 * Math.sin(u * 0.0137 + 2.1) * Math.cos(v * 0.0121 + 1.9)
       + 6 * Math.sin(u * 0.041 + 0.7) * Math.cos(v * 0.037 + 2.6);
}
function teselaRelieve(z, x, y) {
  const N = 256, rgb = Buffer.alloc(N * N * 3);
  const u0 = x * N, v0 = y * N;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = u0 + i, v = v0 + j;
      const dx = alturaEn(u + 1, v) - alturaEn(u - 1, v);
      const dy = alturaEn(u, v + 1) - alturaEn(u, v - 1);
      const luz = Math.max(0, Math.min(1, 0.5 + (dx + dy) * 0.055));
      const g = Math.round(118 + luz * 118);
      const p = (j * N + i) * 3;
      rgb[p] = g; rgb[p + 1] = g; rgb[p + 2] = g;
    }
  }
  return png(N, N, rgb);
}

// ---------- dobles de Leaflet y turf (acá no hay unpkg) ----------
const LEAFLET_FALSO = `
  window.L = (function () {
    const capa = () => ({ addTo() { return this; }, remove() {}, getBounds: () => ({}) });
    const mapa = { createPane: () => ({ style: {} }), getPane: () => ({ style: {} }),
      setView() { return this; }, addTo() { return this; }, fitBounds() {}, removeLayer() {},
      invalidateSize() {}, remove() {}, on() { return this; }, off() { return this; } };
    return { map: () => mapa, tileLayer: capa, geoJSON: capa, svg: () => ({}),
      circleMarker: capa, marker: capa, divIcon: () => ({}),
      control: { layers: capa, scale: capa } };
  })();`;
const TURF_FALSO = `
  window.turf = (function () {
    const puntos = (g) => {
      const out = [];
      const ver = (c, p) => { if (typeof c[0] === 'number') out.push(c); else c.forEach((q) => ver(q, p)); };
      if (g) ver(g.coordinates); return out;
    };
    const caja = (f) => {
      const p = puntos(f.geometry || f);
      return [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])),
              Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
    };
    return {
      bboxPolygon: (b) => ({ type: 'Feature', bbox: b, geometry: { type: 'Polygon',
        coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } }),
      booleanIntersects: (a, b) => { const x = caja(a), y = caja(b);
        return x[0] <= y[2] && y[0] <= x[2] && x[1] <= y[3] && y[1] <= x[3]; },
      centroid: (f) => { const p = puntos(f.geometry || f);
        return { geometry: { coordinates: [p.reduce((s, q) => s + q[0], 0) / p.length,
                                           p.reduce((s, q) => s + q[1], 0) / p.length] } }; }
    };
  })();`;

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.geojson': 'application/json', '.png': 'image/png', '.css': 'text/css' };

async function main() {
  // Servidor local: el tablero necesita un origen http para poder pedir sus archivos.
  const servidor = http.createServer((pedido, resp) => {
    const limpio = decodeURIComponent(pedido.url.split('?')[0]);
    const archivo = path.join(RAIZ, limpio);
    if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      resp.writeHead(404); resp.end('no está'); return;
    }
    resp.writeHead(200, { 'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    resp.end(fs.readFileSync(archivo));
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 1400, height: 1000 } });
  let teselas = 0;

  await pagina.route('**/*', async (ruta) => {
    const url = ruta.request().url();
    const cumplir = (cuerpo, tipo) => ruta.fulfill({ status: 200, contentType: tipo, body: cuerpo });
    if (url.includes('unpkg.com/leaflet')) return cumplir(LEAFLET_FALSO, 'text/javascript');
    if (url.includes('unpkg.com/@turf')) return cumplir(TURF_FALSO, 'text/javascript');
    if (url.includes('leaflet.css')) return cumplir('', 'text/css');
    // El relieve: se fabrica la tesela que pida, con terreno inventado.
    const rel = /geoproxy\?url=.*(?:MapServer%2Ftile%2F|MapServer\/tile\/)(\d+)%2F(\d+)%2F(\d+)/.exec(url)
             || /geoproxy\?url=.*tile\/(\d+)\/(\d+)\/(\d+)/.exec(decodeURIComponent(url));
    if (rel) {
      teselas++;
      return ruta.fulfill({ status: 200, contentType: 'image/png', body: teselaRelieve(+rel[1], +rel[3], +rel[2]) });
    }
    // Las capas que viven en el mundo público se leen del repo.
    const propia = /planoexactocr\.com\/(data\/[^?]+)/.exec(url);
    if (propia) {
      const f = path.join(RAIZ, propia[1]);
      if (fs.existsSync(f)) return cumplir(fs.readFileSync(f, 'utf8'), 'application/json');
    }
    if (url.startsWith(base)) return ruta.continue();
    // Todo lo demás (SNIT, CNE, escudos): sin datos, la lámina se arma igual.
    return cumplir('{"type":"FeatureCollection","features":[]}', 'application/json');
  });

  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));
  await pagina.goto(`${base}/muni/index.html`, { waitUntil: 'networkidle' });

  await pagina.selectOption('#selPapel', PAPEL);
  await pagina.selectOption('#selCanton', CANTON);
  await pagina.waitForTimeout(1500);
  // Se marca para impresión el primer mapa que el atlas sepa dibujar.
  const marcados = await pagina.evaluate((busca) => {
    const filas = [...document.querySelectorAll('#catalogo .ctrl.imp')].filter((x) => !x.disabled);
    const calza = (b) => !busca || (b.closest('.fila') || b.parentElement.parentElement)
      .textContent.toLowerCase().includes(busca.toLowerCase());
    const b = filas.find(calza) || filas[0];
    if (b) b.click();
    return filas.length;
  }, MAPA);
  // Se arman las láminas sin abrir el diálogo de impresión.
  await pagina.evaluate(() => { window.print = () => {}; });
  await pagina.click('#btnAtlas');
  await pagina.waitForSelector('#laminas .lamina .lam-svg', { timeout: 30000 });
  await pagina.waitForTimeout(2500);

  // Para fotografiarla hay que sacarla de su escondite fuera de pantalla.
  await pagina.evaluate(() => {
    const l = document.getElementById('laminas');
    l.style.position = 'static'; l.style.left = '0';
    document.getElementById('app').style.display = 'none';
  });
  const lamina = await pagina.$('#laminas .lamina');
  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  await lamina.screenshot({ path: SALIDA, scale: 'css' });

  const resumen = await pagina.evaluate(() => {
    const l = document.querySelector('#laminas .lamina');
    return {
      titulo: (l.querySelector('.lam-titulo') || {}).textContent,
      escala: (l.querySelector('[id^="esc-"]') || {}).textContent,
      rotulosGrilla: l.querySelectorAll('.rej').length,
      conRelieve: l.querySelectorAll('.lam-svg image').length > 0,
      simbolos: l.querySelectorAll('.ley-item').length,
      hoja: getComputedStyle(l).width + ' × ' + getComputedStyle(l).height
    };
  });

  await navegador.close();
  servidor.close();
  console.log(`Lámina: ${resumen.titulo}`);
  console.log(`Hoja:   ${resumen.hoja} (${PAPEL})`);
  console.log(`Escala: ${(resumen.escala || '').replace(/\s+/g, ' ').trim()}`);
  console.log(`Grilla: ${resumen.rotulosGrilla} rótulos · relieve: ${resumen.conRelieve ? `sí (${teselas} teselas)` : 'no'} · simbología: ${resumen.simbolos}`);
  console.log(`Mapas que el atlas sabe dibujar: ${marcados}`);
  if (errores.length) console.log('Errores de la página:\n  ' + errores.join('\n  '));
  console.log(`\nGuardada en ${SALIDA}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
