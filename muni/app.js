/* Tablero de mapas — configura los mapas oficiales (SETENA 44710 / INVU MAPRIOT) de un
   cantón y los imprime, cada uno en su lámina con título y cajetín.

   Flujo: 1) elegir cantón → 2) prender las capas base que se quieren ver → 3) marcar los
   mapas (ojito = verlo en pantalla, impresora = incluirlo en el PDF) → 4) exportar.

   Dos ideas importantes:
   - Solo se ve UN mapa temático a la vez. Al prender el ojito de otro, el anterior se apaga,
     para que la leyenda de abajo corresponda siempre a lo que se está viendo.
   - Los mapas del IFA (ejes 1 a 5) son resultados calculados: no se dibujan en pantalla,
     solo salen en el PDF. En el catálogo tienen el ojito apagado y la etiqueta "solo PDF".

   Archivos que lee:
   - capas.json            de dónde se baja cada capa (insumo)
   - mapas_oficiales.json  catálogo numerado de mapas, por eje
   - simbologia.json       color, trazo, grosor y relleno de cada capa (misma que usa el PDF)
   - escudos.json          escudo de cada municipalidad

   Las capas del SNIT/CNE/SINAC se piden por /geoproxy (mismo origen) porque esos servidores
   no habilitan CORS y algunos son solo http. Ver geoproxy.js. */
(async function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // Servidores que hay que pedir por el proxy del Worker (los demás se piden directo).
  const HOSTS_PROXY = new Set([
    'geos.snitcr.go.cr', 'geos1.snitcr.go.cr', 'geos1pne.sirefor.go.cr',
    'mapas.cne.go.cr', 'geoserver.mag.go.cr', 'www.snitcr.go.cr', 'snitcr.go.cr',
    // Dirección de Agua (MINAE) y geoportal SARACC de la CNE.
    'visor.da.go.cr', 'mapas.da.go.cr', 'geoportal-saracc.cne.go.cr',
    // COSEVI, CICG geología, LANAMME puentes.
    'mapas.csv.go.cr', 'cicg.ucr.ac.cr', 'gis.lanamme.ucr.ac.cr',
    // Copernicus DEM GLO-30 (el bucket no manda cabeceras CORS).
    'copernicus-dem-30m.s3.amazonaws.com'
  ]);
  // Los servicios de ArcGIS (los de ArcGIS Hub y de varias instituciones) también van por
  // el proxy: son muchos subdominios (services1, services3, services7…), así que se
  // reconocen por el final del nombre en vez de listarlos uno por uno.
  const esArcGIS = (h) => /(^|\.)arcgis\.com$/.test(h) || /(^|\.)arcgisonline\.com$/.test(h);
  function viaProxy(url) {
    try {
      const h = new URL(url).hostname;
      if (HOSTS_PROXY.has(h) || esArcGIS(h)) return '/geoproxy?url=' + encodeURIComponent(url);
    } catch (e) { /* url relativa */ }
    return url;
  }

  // ---------- iconografía ----------
  const ICO = {
    ojo: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1.5 12S5.5 5.5 12 5.5 22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    ojoNo: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.9 17.9A10.5 10.5 0 0 1 12 19.5C5.5 19.5 1.5 12 1.5 12a19 19 0 0 1 5-6M9.9 4.8A10.5 10.5 0 0 1 12 4.5c6.5 0 10.5 7.5 10.5 7.5a19 19 0 0 1-2.3 3.3M2 2l20 20"/></svg>',
    imp: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6.5 9.5V2.5h11v7"/><rect x="2.5" y="9.5" width="19" height="8" rx="2"/><rect x="6.5" y="14" width="11" height="7.5"/></svg>'
  };

  // Paneles para controlar qué se dibuja encima de qué: datos < máscara < encima.
  function configurarPanes(m) {
    m.createPane('datos'); m.getPane('datos').style.zIndex = 400;
    m.createPane('mascara'); m.getPane('mascara').style.zIndex = 450;
    m.createPane('encima'); m.getPane('encima').style.zIndex = 500;
  }

  const map = L.map('map', { zoomControl: true }).setView([9.9, -84.1], 8);
  configurarPanes(map);
  // Mapas base elegibles (Esri), como en PlanoExactoCR.
  const esriBase = (s, o) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`,
    Object.assign({ maxZoom: 21, maxNativeZoom: 19 }, o));
  const mapasBase = {
    'Satélite': esriBase('World_Imagery', { attribution: 'Imagen © Esri, Maxar' }),
    'Claro (B/N)': esriBase('Canvas/World_Light_Gray_Base', { maxNativeZoom: 16, attribution: '© Esri' }),
    'Calles': esriBase('World_Street_Map', { attribution: '© Esri' }),
    'Oscuro': esriBase('Canvas/World_Dark_Gray_Base', { maxNativeZoom: 16, attribution: '© Esri' })
  };
  mapasBase['Satélite'].addTo(map);
  L.control.layers(mapasBase, null, { position: 'topright', collapsed: false }).addTo(map);

  /* La estructura del Plan Regulador (etapas, entregables y el índice maestro de mapas con
     sus códigos M) vive una sola vez, en el mundo público, y la leen tanto el atlas como el
     calibrador. Así los códigos de mapa son los mismos en los dos sitios y en el expediente
     que llega al INVU. Ver scripts/construir_estructura_pr.py.
     Si no se puede leer, el atlas sigue funcionando con su propio catálogo. */
  const ESTRUCTURA_URL = 'https://planoexactocr.com/data/estructura_pr.json';

  const [cap, catalogo, escudosDoc, simbDoc, estructura] = await Promise.all([
    fetch('capas.json').then((r) => r.json()),
    fetch('mapas_oficiales.json').then((r) => r.json()),
    fetch('escudos.json').then((r) => r.json()).catch(() => ({ escudos: {} })),
    fetch('simbologia.json').then((r) => r.json()),
    fetch(ESTRUCTURA_URL).then((r) => { if (!r.ok) throw 0; return r.json(); }).catch(() => null)
  ]);
  const escudosDB = (escudosDoc && escudosDoc.escudos) || {};
  const SIMB = simbDoc.capas || {};
  const BASE_UI = simbDoc.base_visible_siempre || [];

  const capaPorNombre = {};
  cap.grupos.forEach((g) => g.capas.forEach((c) => { capaPorNombre[c.nombre] = c; }));

  // ---------- estado ----------
  const seleccion = new Set();          // ids de mapas marcados para imprimir
  const baseVisibles = new Set();       // nombres de capas base prendidas
  let mapaVisto = null;                 // id del único mapa temático visible (o null)
  const layerLookup = {};               // nombre de capa -> leaflet layer en el mapa principal
  const datosCapa = new Map();          // nombre -> FeatureCollection recortada (cache por cantón)
  let cantonSel = null;
  let cantonLayer = null;
  let maskPreview = null;
  let muniLogo = null;
  let cantonesTodos = null;

  // Capas base prendidas al elegir cantón (las livianas; las densas quedan apagadas).
  const BASE_POR_DEFECTO = ['Límites distritales', 'Red vial cantonal', 'Red hídrica'];

  // Escala de fragilidad del IFA (decretos 32967 / 44710). Misma rampa que usan las láminas
  // en PDF; se define en scripts/integracion_ifa.py y se repite acá solo para la vista previa.
  const RAMPA_IFA = [
    ['Muy Alta', '#e41a1c'], ['Alta', '#ff7f00'], ['Moderada', '#ffff33'],
    ['Baja', '#94d180'], ['Muy Baja', '#3d983a']
  ];

  // ---------- simbología ----------
  const ESTILO_DEF = { color: '#4f8cff', trazo: 'solido', peso: 0.7, relleno: 0.1, geom: 'poligono' };
  const estiloDe = (n) => Object.assign({}, ESTILO_DEF, SIMB[n] || {});
  const colorDe = (n) => estiloDe(n).color;
  function dashDe(trazo, k) {
    if (trazo === 'guion') return `${(5 * k).toFixed(2)} ${(3 * k).toFixed(2)}`;
    if (trazo === 'punteado') return `${(1.4 * k).toFixed(2)} ${(2.4 * k).toFixed(2)}`;
    return null;
  }
  // Cuadrito de muestra, con la forma de la geometría (línea, polígono o punto).
  function muestraHTML(nombre, clase) {
    const e = estiloDe(nombre);
    const c = clase || 'sw';
    const tipo = e.trazo === 'guion' ? 'dashed' : e.trazo === 'punteado' ? 'dotted' : 'solid';
    if (e.geom === 'linea') return `<span class="${c} linea" style="border-top-color:${e.color};border-top-style:${tipo}"></span>`;
    if (e.geom === 'punto') return `<span class="${c} punto" style="background:${e.color}"></span>`;
    return `<span class="${c}" style="background:${e.color}99;border-color:${e.color}"></span>`;
  }

  // ---------- geometría ----------
  function bboxDe(feat) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    (function walk(co) {
      if (typeof co[0] === 'number') {
        if (co[0] < a) a = co[0]; if (co[1] < b) b = co[1];
        if (co[0] > c) c = co[0]; if (co[1] > d) d = co[1];
      } else co.forEach(walk);
    })(feat.geometry.coordinates);
    return [a, b, c, d];
  }
  function urlConBbox(url, bbox) {
    /* Un servicio ArcGIS no se consulta como un WFS: en vez de `bbox` lleva una geometría
       de sobre, y hay que pedirle explícitamente la respuesta en GeoJSON. Se reconoce por
       terminar en /FeatureServer/<n> o /MapServer/<n>. */
    const limpia = url.split('?')[0].replace(/\/$/, '');
    if (/\/(Feature|Map)Server\/\d+$/i.test(limpia)) {
      const p = new URLSearchParams({
        where: '1=1', outFields: '*', f: 'geojson', outSR: '4326', inSR: '4326',
        geometryType: 'esriGeometryEnvelope', spatialRel: 'esriSpatialRelIntersects',
        geometry: bbox.join(','), returnGeometry: 'true', resultRecordCount: '20000'
      });
      return `${limpia}/query?${p}`;
    }
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}bbox=${bbox.join(',')},EPSG:4326&count=150000`;
  }
  function soloCanton(fc) {
    if (!cantonSel || !fc || !Array.isArray(fc.features)) return fc;
    const dentro = fc.features.filter((f) => {
      if (!f || !f.geometry) return false;
      try { return turf.booleanIntersects(f, cantonSel); } catch (e) { return true; }
    });
    return Object.assign({}, fc, { features: dentro });
  }

  // Máscara: polígono que cubre todo MENOS el cantón, para recortar visualmente las capas al
  // límite cantonal (lo de afuera queda tapado en gris). Se arma a mano (anillo del mundo con
  // el cantón como hueco) para no depender de turf.mask, que a veces no está en el bundle.
  function geoMascara(feat) {
    try {
      const mundo = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
      const g = feat.geometry;
      let huecos = [];
      if (g.type === 'Polygon') huecos = [g.coordinates[0]];
      else if (g.type === 'MultiPolygon') huecos = g.coordinates.map((p) => p[0]);
      else return null;
      return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [mundo, ...huecos] } };
    } catch (e) { return null; }
  }

  // Cantones vecinos: los que tocan el recuadro ampliado del cantón elegido (menos él mismo).
  function vecinosDe(feat) {
    if (!cantonesTodos || !feat) return [];
    const [a, b, c, d] = bboxDe(feat);
    const mx = (c - a) * 0.15, my = (d - b) * 0.15;
    const caja = turf.bboxPolygon([a - mx, b - my, c + mx, d + my]);
    const propio = feat.properties.k;
    return cantonesTodos.features.filter((f) => {
      if (!f.properties || f.properties.k === propio) return false;
      try { return turf.booleanIntersects(f, caja); } catch (e) { return false; }
    });
  }
  function avisar(mensaje) {
    const el = $('avisos');
    if (!el) return;
    const d = document.createElement('div');
    d.className = 'aviso'; d.textContent = mensaje;
    el.appendChild(d);
    setTimeout(() => d.remove(), 7000);
  }

  /* Algunas capas del mundo público de PlanoExactoCR no vienen como GeoJSON sino como una
     lista de registros con las coordenadas en la clave "ll" ([lon, lat]) — asadas.json,
     salud.json, aprovechamientos.json. Se convierten a FeatureCollection para poder
     dibujarlas igual que el resto. Es la misma conversión que hace a_geodataframe() en
     scripts/build_atlas.py, para que el navegador y el PDF vean exactamente lo mismo. */
  function aFeatureCollection(data) {
    if (!data) return null;
    if (data.type === 'FeatureCollection') return data;
    let registros = Array.isArray(data) ? data : null;
    if (!registros && typeof data === 'object') {
      // Objetos tipo asadas.json: la lista vive bajo alguna clave ("asadas", "aprovech"...).
      for (const v of Object.values(data)) {
        if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && 'll' in v[0]) {
          registros = v; break;
        }
      }
    }
    if (!registros) return null;
    const features = [];
    for (const r of registros) {
      if (!r || !Array.isArray(r.ll) || r.ll.length < 2) continue;
      const props = Object.assign({}, r);
      delete props.ll;
      features.push({ type: 'Feature', properties: props,
                      geometry: { type: 'Point', coordinates: [Number(r.ll[0]), Number(r.ll[1])] } });
    }
    return { type: 'FeatureCollection', features };
  }

  // ---------- datos de una capa, recortados al cantón (con cache) ----------
  async function obtenerDatos(nombre) {
    if (datosCapa.has(nombre)) return datosCapa.get(nombre);
    const c = capaPorNombre[nombre];
    let fc = null;
    if (c && c.archivo && !c.archivo.startsWith('api:')) {
      let url, recortar;
      if (c.filtrar_canton) { url = urlConBbox(c.archivo, bboxDe(cantonSel)); recortar = false; }
      else { url = c.archivo; recortar = true; }
      const final = viaProxy(url);
      try {
        const r = await fetch(final);
        if (!r.ok) {
          // No tapar el error: con esto en consola se sabe si fue 403 (host no permitido
          // en el proxy), 404 (la capa ya no existe en el servidor de origen), 5xx, etc.
          const cuerpo = await r.text().catch(() => '');
          console.error(`[capa] ${nombre}: HTTP ${r.status} en ${final}`, cuerpo.slice(0, 300));
          throw new Error(`HTTP ${r.status}`);
        }
        const data = await r.json();
        const bruto = aFeatureCollection(data);
        fc = recortar ? soloCanton(bruto) : bruto;
        if (!fc || !fc.features || !fc.features.length) {
          console.warn(`[capa] ${nombre}: la respuesta no trajo features (bbox sin datos o capa vacía)`, final);
        }
      } catch (e) {
        console.error(`[capa] ${nombre}: fallo al traer datos —`, e, final);
        fc = null;
      }
    } else {
      console.warn(`[capa] ${nombre}: sin "archivo" utilizable en capas.json (¿capa calculada o fuente retirada?)`);
    }
    datosCapa.set(nombre, fc);
    return fc;
  }

  /* Capa dibujada con la simbología del archivo. `escala` (k) multiplica grosores y guiones:
     en una lámina A2 el papel es ~1.95 veces más ancho que Carta, así que las líneas se
     engrosan igual para que se vean del mismo grueso físico, y el mapa se dibuja con mucho
     más detalle (de ahí la mejora de nitidez). */
  function capaGeoJSON(nombre, fc, opts) {
    const e = estiloDe(nombre);
    const o = opts || {};
    const k = o.escala || 1;
    const pane = o.pane || 'datos';
    const dash = dashDe(e.trazo, k);
    return L.geoJSON(fc, Object.assign({
      pane,
      style: () => ({
        color: e.color, weight: Math.max(e.peso * k, 0.08), dashArray: dash,
        fill: e.relleno > 0, fillColor: e.color, fillOpacity: e.relleno, lineJoin: 'round'
      }),
      pointToLayer: (f, ll) => L.circleMarker(ll, {
        pane, radius: Math.max(1.8 * k, 1.5), color: e.color, weight: 0.6 * k,
        fillColor: e.color, fillOpacity: e.relleno || 0.85
      })
    }, o.leaflet || {}));
  }

  // Dibuja la máscara gris (todo menos el cantón) en el panel 'mascara' del mapa dado.
  function ponerMascara(m, feat, relleno) {
    const g = geoMascara(feat);
    if (!g) return null;
    return L.geoJSON(g, { pane: 'mascara', interactive: false,
      style: { stroke: false, fillColor: relleno, fillOpacity: 1 } }).addTo(m);
  }

  // ---------- identidad municipal (se deriva del cantón) ----------
  let muniNombreVal = '';

  function slug(txt) {
    return txt.normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim().replace(/\s+/g, '-');
  }

  function aplicarIdentidadCanton(canton) {
    muniNombreVal = 'Municipalidad de ' + canton;
    // Primero un archivo local escudos/<cantón>.png (para poder actualizar un escudo viejo),
    // y si no existe, la base de datos de munis.cr. Se prueban en orden.
    const fuentes = [`escudos/${slug(canton)}.png`, escudosDB[canton]].filter(Boolean);
    cargarEscudo(fuentes);
    actualizarCajetinPreview();
  }

  function cargarEscudo(fuentes) {
    if (!fuentes.length) { muniLogo = null; actualizarCajetinPreview(); return; }
    const raw = fuentes[0];
    // Los escudos del CDN se piden por el proxy (evita bloqueo por hotlink/CORS y entran al PDF).
    const url = /^https?:/.test(raw) ? '/geoproxy?url=' + encodeURIComponent(raw) : raw;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        muniLogo = c.toDataURL('image/png');
      } catch (e) { muniLogo = url; }
      actualizarCajetinPreview();
    };
    img.onerror = () => cargarEscudo(fuentes.slice(1));
    img.src = url;
  }

  function actualizarCajetinPreview() {
    const canton = $('selCanton').value;
    const cp = $('cajetinPreview');
    if (!canton) { cp.hidden = true; return; }
    cp.hidden = false;
    $('cpEscudo').innerHTML = muniLogo ? `<img src="${muniLogo}">` : '<div class="ph">escudo</div>';
    $('cpMuni').textContent = muniNombreVal || ('Municipalidad de ' + canton);
    $('cpCanton').textContent = 'Cantón de ' + canton;
  }

  // ---------- helpers del catálogo ----------
  function defMapa(id) {
    for (const inst of catalogo.instituciones) {
      const m = inst.mapas.find((x) => x.id === id);
      if (m) return Object.assign({ institucion: inst.nombre, solo_pdf: !!inst.solo_pdf }, m);
    }
    return null;
  }

  /* Código oficial de cada lámina. El índice maestro manda: la guía pide citar los mapas
     por su código (M1.1.90) y que ese código sea el mismo en el EsIVA, el Diagnóstico, la
     Propuesta y el expediente del INVU. Cuando varios códigos apuntan al mismo mapa del
     atlas —porque el atlas resuelve con una sola lámina lo que el índice separa— se rotula
     con el primero. Sin estructura compartida se cae a la numeración propia del atlas. */
  const CODIGO_DE = {};
  if (estructura && Array.isArray(estructura.mapas)) {
    estructura.mapas.forEach((mp) => {
      if (mp.atlas && !CODIGO_DE[mp.atlas]) CODIGO_DE[mp.atlas] = mp.codigo;
    });
  }
  function codigoDe(m) {
    if (!m) return '';
    return CODIGO_DE[m.id] || m.numero || '';
  }
  // Capas de insumo de un mapa que existen de verdad en capas.json y se pueden dibujar.
  function insumosReales(id) {
    const m = defMapa(id);
    return (m?.insumos || []).filter((n) => {
      const c = capaPorNombre[n];
      // Una capa calculada (pendientes) no tiene archivo, pero sí se puede dibujar.
      return c && (c.calculada || (c.archivo && !String(c.archivo).startsWith('api:')));
    });
  }
  const sePuedeVer = (m) => !m.solo_pdf && m.estado !== 'pendiente' && insumosReales(m.id).length > 0;
  const sePuedeImprimir = (m) => m.estado !== 'pendiente';

  // ---------- panel: capas base ----------
  const refFilasBase = {};
  function construirCapasBase() {
    const cont = $('capasBase');
    const disponibles = BASE_UI.filter((n) => capaPorNombre[n]);
    const g = document.createElement('div');
    g.className = 'grupo abierto';
    g.innerHTML = `
      <div class="grupo-cab">
        <span class="chev">▶</span><span class="emoji">🧱</span>
        <span class="nom">Cartografía base</span>
        <span class="cuenta" id="cuentaBase"></span>
      </div>
      <div class="grupo-cuerpo">
        <div class="grupo-desc">Se dibujan siempre debajo del mapa temático. Las densas (curvas, edificaciones) tardan más en cargar.</div>
      </div>`;
    g.querySelector('.grupo-cab').addEventListener('click', () => g.classList.toggle('abierto'));
    const cuerpo = g.querySelector('.grupo-cuerpo');
    disponibles.forEach((nombre) => {
      const fila = document.createElement('div');
      fila.className = 'fila';
      fila.innerHTML = `
        <button class="ctrl ojo" title="Ver / ocultar en el mapa">${ICO.ojoNo}</button>
        ${muestraHTML(nombre, 'swatch')}
        <div class="cuerpo"><div class="titulo">${nombre}</div></div>`;
      const btn = fila.querySelector('.ojo');
      btn.addEventListener('click', () => {
        const on = !baseVisibles.has(nombre);
        if (on) baseVisibles.add(nombre); else baseVisibles.delete(nombre);
        pintarBtnOjo(btn, on);
        fila.classList.toggle('viendo', on);
        refrescarVista();
      });
      refFilasBase[nombre] = { fila, btn };
      cuerpo.appendChild(fila);
    });
    cont.appendChild(g);
  }
  function pintarBtnOjo(btn, on) {
    btn.classList.toggle('on', on);
    btn.innerHTML = on ? ICO.ojo : ICO.ojoNo;
  }

  // ---------- panel: catálogo de mapas ----------
  const refFilasMapa = {};     // id -> {fila, btnOjo, btnImp}
  const refGrupos = [];        // {inst, el, cuenta}
  function construirCatalogo() {
    const catEl = $('catalogo');
    catalogo.instituciones.forEach((inst) => {
      const g = document.createElement('div');
      g.className = 'grupo' + (inst.id === 'fisico_espacial' ? ' abierto' : '');
      g.innerHTML = `
        <div class="grupo-cab">
          <span class="chev">▶</span><span class="emoji">${inst.icono || '🗺'}</span>
          <span class="nom">${inst.nombre}</span>
          <span class="cuenta"></span>
        </div>
        <div class="grupo-cuerpo">
          <div class="grupo-desc">${inst.descripcion}${inst.solo_pdf ? ' <b>Son resultados calculados: salen solo en el PDF.</b>' : ''}</div>
        </div>`;
      const cab = g.querySelector('.grupo-cab');
      cab.addEventListener('click', () => g.classList.toggle('abierto'));
      const cuerpo = g.querySelector('.grupo-cuerpo');

      inst.mapas.forEach((raw) => {
        const m = Object.assign({ institucion: inst.nombre, solo_pdf: !!inst.solo_pdf }, raw);
        const verOk = sePuedeVer(m);
        const impOk = sePuedeImprimir(m);
        const fila = document.createElement('div');
        fila.className = 'fila';
        fila.innerHTML = `
          <button class="ctrl ojo" ${verOk ? '' : 'disabled'} title="${verOk ? 'Ver este mapa en pantalla (apaga el anterior)' : m.solo_pdf ? 'Se calcula al exportar; no se dibuja en pantalla' : 'Sin datos para dibujar'}">${ICO.ojoNo}</button>
          <div class="cuerpo">
            <div class="titulo"><b>${codigoDe(m)}</b> ${m.nombre}
              <span class="badge ${m.estado}">${m.estado}</span>
              ${m.solo_pdf ? '<span class="badge pdf">solo PDF</span>' : ''}</div>
            <div class="desc">${m.descripcion}</div>
            ${m.faltante ? `<div class="falta">Falta: ${m.faltante}</div>` : ''}
          </div>`;
        const btnOjo = fila.querySelector('.ojo');
        if (verOk) btnOjo.addEventListener('click', () => verMapa(m.id));
        refFilasMapa[m.id] = { fila, btnOjo };
        cuerpo.appendChild(fila);
      });

      refGrupos.push({ inst, el: g, cuenta: g.querySelector('.cuenta') });
      catEl.appendChild(g);
    });
  }

  // ---------- ver ----------
  function verMapa(id) {
    mapaVisto = (mapaVisto === id) ? null : id;
    Object.entries(refFilasMapa).forEach(([k, r]) => {
      const on = k === mapaVisto;
      if (!r.btnOjo.disabled) pintarBtnOjo(r.btnOjo, on);
      r.fila.classList.toggle('viendo', on);
    });
    refrescarVista();
  }
  function marcarImprimir(id) {
    const on = !seleccion.has(id);
    if (on) seleccion.add(id); else seleccion.delete(id);
    actualizarResumen();
    actualizarExport();
    actualizarLeyenda();
  }
  function habilitarCatalogo(on) {
    $('catalogo').classList.toggle('bloqueado', !on);
    $('capasBase').classList.toggle('bloqueado', !on);
    $('hintCanton').style.display = on ? 'none' : '';
  }
  function actualizarResumen() {
    const cb = $('cuentaBase');
    if (cb) cb.textContent = baseVisibles.size ? `${baseVisibles.size} visibles` : '';
  }
  function actualizarExport() {
    $('btnAtlas').disabled = !cantonSel;
  }

  // ---------- vista del mapa principal ----------
  function capasVisibles() {
    const n = new Set();
    baseVisibles.forEach((x) => { if (capaPorNombre[x]) n.add(x); });
    if (mapaVisto) insumosReales(mapaVisto).forEach((x) => n.add(x));
    return n;
  }
  let cargando = false;
  let repetir = false;
  // Reparto por clase de pendiente del último cálculo; lo usa la leyenda.
  let repartoPendiente = null;
  async function refrescarVista() {
    if (!cantonSel) return;
    actualizarResumen();
    actualizarLeyenda();
    // Quita lo que ya no se ve (esto es inmediato, no espera descargas).
    const necesarias = capasVisibles();
    Object.keys(layerLookup).forEach((n) => {
      if (!necesarias.has(n)) { map.removeLayer(layerLookup[n]); delete layerLookup[n]; }
    });
    // Si ya hay una carga en curso, se marca para repetir al terminar (clics rápidos).
    if (cargando) { repetir = true; return; }
    cargando = true;
    const fallidas = [];
    for (const nombre of necesarias) {
      if (layerLookup[nombre]) continue;
      const c = capaPorNombre[nombre];
      // Capas que no se descargan sino que se calculan acá mismo (pendientes desde el
      // modelo de elevación). Se dibujan como imagen, no como geometría.
      if (c && c.calculada === 'pendientes') {
        const elev = await elevacionDe(bboxDe(cantonSel), 64);
        if (!capasVisibles().has(nombre)) continue;
        const r = elev && pendientesDesdeElevacion(elev);
        if (!r) { fallidas.push(nombre); continue; }
        repartoPendiente = r.reparto;
        layerLookup[nombre] = L.imageOverlay(r.url,
          [[r.caja[1], r.caja[0]], [r.caja[3], r.caja[2]]], { opacity: 0.75, interactive: false }).addTo(map);
        continue;
      }
      const fc = await obtenerDatos(nombre);
      if (!capasVisibles().has(nombre)) continue;     // se apagó mientras cargaba
      if (!fc || !fc.features || !fc.features.length) { fallidas.push(nombre); continue; }
      layerLookup[nombre] = capaGeoJSON(nombre, fc).addTo(map);
    }
    cargando = false;
    if (fallidas.length) avisar('No se pudo cargar: ' + fallidas.join(', '));
    actualizarLeyenda();
    if (repetir) { repetir = false; refrescarVista(); }
  }

  // Leyenda de lo que se está viendo ahora mismo (y de la rampa IFA si hay mapas IFA marcados).
  function actualizarLeyenda() {
    const el = $('leyenda');
    if (!cantonSel) { el.innerHTML = '<h3>Simbología</h3><div class="vacia">Elegí un cantón para empezar.</div>'; return; }
    let h = '<h3>Simbología</h3>';
    h += `<div class="lg"><span class="sw linea" style="border-top-color:#d11a1a;border-top-style:dashed"></span>Límite cantonal</div>`;
    [...baseVisibles].forEach((n) => {
      const cargada = !!layerLookup[n];
      h += `<div class="lg">${muestraHTML(n)}<span${cargada ? '' : ' class="vacia"'}>${n}${cargada ? '' : ' (cargando…)'}</span></div>`;
      // La pendiente no se explica con un cuadrito de color: lo que sirve es saber cuánto
      // del cantón cae en cada clase, porque eso es lo que condiciona dónde se puede urbanizar.
      const c = capaPorNombre[n];
      if (cargada && c && c.calculada === 'pendientes' && repartoPendiente) {
        repartoPendiente.forEach((r) => {
          h += `<div class="lg" style="padding-left:14px">` +
               `<span class="sw" style="background:${r.color};border-color:#0004"></span>` +
               `${r.clase} · ${r.etiqueta} <b>${r.pct.toFixed(1)} %</b></div>`;
        });
      }
    });
    if (mapaVisto) {
      const m = defMapa(mapaVisto);
      h += `<div class="tit-mapa">${codigoDe(m)} ${m.nombre}</div>`;
      insumosReales(mapaVisto).forEach((n) => {
        const cargada = !!layerLookup[n];
        h += `<div class="lg">${muestraHTML(n)}<span${cargada ? '' : ' class="vacia"'}>${n}${cargada ? '' : ' (cargando…)'}</span></div>`;
      });
    }
    const hayIFA = [...seleccion].some((id) => (defMapa(id) || {}).solo_pdf);
    if (hayIFA) {
      h += '<div class="tit-mapa">Índice de Fragilidad Ambiental (sale en el PDF)</div>';
      RAMPA_IFA.forEach(([t, c]) => { h += `<div class="lg"><span class="sw" style="background:${c};border-color:#0004"></span>${t}</div>`; });
    }
    el.innerHTML = h;
  }

  // ---------- selector de cantón ----------
  construirCapasBase();
  construirCatalogo();

  const baseCantones = await fetch('https://planoexactocr.com/data/cantones.geojson').then((r) => r.json()).catch(() => null);
  cantonesTodos = baseCantones;
  if (baseCantones) {
    const sel = $('selCanton');
    // Agrupar cantones por provincia según código político-administrativo (c: 1xx=SJ, 2xx=Alajuela, …)
    const PROVINCIAS = { 1:'San José', 2:'Alajuela', 3:'Cartago', 4:'Heredia', 5:'Guanacaste', 6:'Puntarenas', 7:'Limón' };
    const porProvincia = {};
    baseCantones.features.forEach((f) => {
      const prov = Math.floor(f.properties.c / 100);
      if (!porProvincia[prov]) porProvincia[prov] = [];
      porProvincia[prov].push({ c: f.properties.c, k: f.properties.k });
    });
    Object.keys(porProvincia).sort((a, b) => a - b).forEach((prov) => {
      const grupo = document.createElement('optgroup');
      grupo.label = PROVINCIAS[prov] || `Provincia ${prov}`;
      porProvincia[prov].sort((a, b) => a.c - b.c).forEach(({ k }) => {
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = k;
        grupo.appendChild(opt);
      });
      sel.appendChild(grupo);
    });
    sel.addEventListener('change', () => {
      if (!sel.value) { cantonSel = null; habilitarCatalogo(false); actualizarExport(); actualizarLeyenda(); return; }
      cantonSel = baseCantones.features.find((f) => f.properties.k === sel.value) || null;
      if (!cantonSel) return;
      aplicarPapel();                          // la hoja se acuesta o se para según el cantón
      aplicarIdentidadCanton(sel.value);
      datosCapa.clear();                       // el cache es por cantón
      Object.keys(layerLookup).forEach((n) => { map.removeLayer(layerLookup[n]); delete layerLookup[n]; });
      // Capas base por defecto, la primera vez.
      if (!baseVisibles.size) {
        BASE_POR_DEFECTO.forEach((n) => {
          if (!capaPorNombre[n] || !refFilasBase[n]) return;
          baseVisibles.add(n);
          pintarBtnOjo(refFilasBase[n].btn, true);
          refFilasBase[n].fila.classList.add('viendo');
        });
      }
      habilitarCatalogo(true);
      if (cantonLayer) map.removeLayer(cantonLayer);
      if (maskPreview) { map.removeLayer(maskPreview); maskPreview = null; }
      // Máscara: tapa en gris claro todo lo que esté fuera del cantón.
      maskPreview = ponerMascara(map, cantonSel, '#dfe3e8');
      cantonLayer = L.geoJSON(cantonSel, { pane: 'encima', interactive: false,
        style: { color: '#d11a1a', weight: 2, dashArray: '6 3', fill: false } }).addTo(map);
      map.fitBounds(L.geoJSON(cantonSel).getBounds(), { padding: [20, 20] });
      actualizarExport();
      refrescarVista();
      if (!$('estructura').hidden) construirEstructura();   // quita el aviso de "elegí cantón"
      if (!$('datosInec').hidden) construirDatosInec();     // refresca datos INEC si esa pestaña está visible
    });

    /* ---------- llegar desde el calibrador a un mapa concreto ----------
       El calibrador enlaza cada mapa del índice maestro con
       atlas.planoexactocr.com/?canton=<cantón>&mapa=<id>. Acá se lee ese enlace: se elige el
       cantón, y si el mapa se puede dibujar se prende solo; si todavía no se puede, se abre
       la pestaña de estructura en ese mapa, que es donde se ve qué le falta. */
    const entrada = new URLSearchParams(location.search);
    const cantonPedido = (entrada.get('canton') || '').trim();
    const mapaPedido = (entrada.get('mapa') || '').trim();
    if (cantonPedido) {
      // Se busca sin tildes ni mayúsculas, porque el nombre viaja escrito a mano.
      const plano = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const calce = nombres.find((n) => plano(n) === plano(cantonPedido));
      if (calce) {
        sel.value = calce;
        sel.dispatchEvent(new Event('change'));
        // El cambio de cantón carga capas; se espera un respiro antes de ir al mapa.
        if (mapaPedido) setTimeout(() => irAlMapa(mapaPedido), 400);
      } else {
        avisar(`No encontré el cantón "${cantonPedido}" en la lista.`);
      }
    } else if (mapaPedido) {
      irAlMapa(mapaPedido);
    }
  }

  // Lleva la vista al mapa pedido: lo prende si se puede ver, y si no lo muestra en la
  // estructura, resaltado, que es donde se explica qué insumo le falta.
  function irAlMapa(id) {
    const m = defMapa(id);
    if (!m) { avisar(`No encontré el mapa "${id}" en el catálogo del atlas.`); return; }
    const ref = refFilasMapa[id];
    if (ref && ref.btnOjo && !ref.btnOjo.disabled) {
      const grupo = ref.fila.closest('.grupo');
      if (grupo) grupo.classList.add('abierto');     // si venía plegado, se abre
      verMapa(id);
      mostrarVista('visor');
      ref.fila.scrollIntoView({ block: 'center' });
      resaltar(ref.fila);
      avisar(`Mostrando «${m.nombre}».`);
      return;
    }
    // Todavía no se puede dibujar: se abre la estructura, que es donde se dice qué le falta.
    mostrarVista('estructura');
    const caja = document.querySelector(`#estCuerpo [data-mapa="${CSS.escape(id)}"]`);
    if (caja) { caja.scrollIntoView({ block: 'center' }); resaltar(caja); }
    avisar(`«${m.nombre}» todavía no se puede dibujar; acá se ve qué le falta.`);
  }

  function resaltar(el) {
    el.classList.add('resaltado');
    setTimeout(() => el.classList.remove('resaltado'), 6000);
  }

  // ---------- tamaño de papel ----------
  // Las medidas van en milímetros y en apaisado (ancho × alto), que es como se arma una
  // lámina de Plan Regulador.
  //
  // OJO, acá estaba el error que recortaba el PDF: la regla @page de CSS solo entiende los
  // nombres de papel hasta A3. "size: A2" no existe en el estándar, el navegador la ignora,
  // se va al tamaño por omisión (Carta) y la lámina sale cortada —o encogida, si el diálogo
  // trae puesto "ajustar a la página", que es lo que se veía como mala resolución—. Por eso
  // ahora se escribe la medida exacta ("size: 594mm 420mm"), que sí respeta en cualquier
  // tamaño, A1 incluido.
  const PAPELES = {
    'A1': { w: 841, h: 594 },
    'A2': { w: 594, h: 420 },
    'A3': { w: 420, h: 297 },
    'Carta': { w: 279.4, h: 215.9 }
  };
  const ANCHO_BASE = 279.4;   // ancho de una Carta apaisada; es la referencia de --k

  // Proporción ancho/alto del cantón elegido. Sirve para acostar o parar la hoja sola.
  function formaCanton() {
    if (!cantonSel) return 1.3;
    try {
      const b = cajaMerc([cantonSel]);
      const alto = b[3] - b[1];
      return alto > 0 ? (b[2] - b[0]) / alto : 1.3;
    } catch (e) { return 1.3; }
  }

  function papelActual() {
    const nombre = $('selPapel').value;
    const p = PAPELES[nombre] || PAPELES['A2'];
    const modo = ($('selOrient') && $('selOrient').value) || 'auto';
    // El mapa ocupa ~78 % del ancho de la hoja (el resto es el cajetín), así que la hoja
    // acostada le queda bien a un cantón ancho y la parada a uno alargado.
    const vertical = modo === 'vertical' || (modo === 'auto' && formaCanton() < 0.82);
    const w = vertical ? p.h : p.w;
    const h = vertical ? p.w : p.h;
    return { nombre, w, h, vertical, k: w / ANCHO_BASE };
  }

  function aplicarPapel() {
    const p = papelActual();
    const l = $('laminas');
    l.style.setProperty('--pw', p.w + 'mm');
    l.style.setProperty('--ph', p.h + 'mm');
    l.style.setProperty('--k', p.k.toFixed(4));
    $('estiloPapel').textContent = `@page { size: ${p.w}mm ${p.h}mm; margin: 0; }`;
  }
  $('selPapel').addEventListener('change', aplicarPapel);
  $('selOrient').addEventListener('change', aplicarPapel);
  aplicarPapel();

  // ---------- firma de la lámina (quién la elaboró y quién la firma) ----------
  // Se guardan en el navegador para no volver a escribirlas en cada sesión.
  const FIRMA = { elabora: 'inpElabora', profesional: 'inpProfesional' };
  Object.entries(FIRMA).forEach(([clave, id]) => {
    const campo = $(id);
    if (!campo) return;
    try { campo.value = localStorage.getItem('px_' + clave) || ''; } catch (e) { /* sin memoria */ }
    campo.addEventListener('input', () => {
      try { localStorage.setItem('px_' + clave, campo.value); } catch (e) { /* sin memoria */ }
    });
  });
  const firmaDe = (clave) => (($(FIRMA[clave]) || {}).value || '').trim();

  // ---------- exportar configuración ----------
  function configActual() {
    return {
      municipalidad: muniNombreVal || null,
      logo: muniLogo,
      canton: $('selCanton').value || null,
      proyeccion: catalogo.proyeccion,
      papel: papelActual().nombre,
      orientacion: papelActual().vertical ? 'vertical' : 'apaisado',
      elaborado_por: firmaDe('elabora') || null,
      profesional_responsable: firmaDe('profesional') || null,
      capas_base: [...baseVisibles],
      mapas: [...seleccion],
      generado: new Date().toISOString().slice(0, 10)
    };
  }
  $('btnReset').addEventListener('click', () => location.reload());

  /* ---------- dibujo vectorial de las láminas ----------
     Antes las láminas eran mapas de Leaflet. El problema: Leaflet redondea cada coordenada
     al píxel entero del contenedor (latLngToLayerPoint hace _round), así que al acercarse en
     el PDF las edificaciones se veían como triángulos y manchas, y las vías como churros.
     Acá se dibuja un SVG propio con las coordenadas completas: el PDF queda vectorial de
     verdad y aguanta cualquier zoom. Los grosores van con vector-effect="non-scaling-stroke",
     o sea que se miden en el papel y no se deforman con el tamaño del dibujo. */

  const UV = 10000;                       // ancho del viewBox, en unidades internas
  const R2D = 180 / Math.PI;

  function mercator(lon, lat) {
    const l = Math.max(-85, Math.min(85, lat));
    return [lon, Math.log(Math.tan((90 + l) * Math.PI / 360)) * R2D];
  }

  // Separa una geometría GeoJSON en anillos (polígonos), líneas y puntos.
  function partesDe(geom, acum) {
    const r = acum || { anillos: [], lineas: [], puntos: [] };
    if (!geom) return r;
    const c = geom.coordinates;
    switch (geom.type) {
      case 'Point': r.puntos.push(c); break;
      case 'MultiPoint': c.forEach((p) => r.puntos.push(p)); break;
      case 'LineString': r.lineas.push(c); break;
      case 'MultiLineString': c.forEach((l) => r.lineas.push(l)); break;
      case 'Polygon': c.forEach((a) => r.anillos.push(a)); break;
      case 'MultiPolygon': c.forEach((p) => p.forEach((a) => r.anillos.push(a))); break;
      case 'GeometryCollection': (geom.geometries || []).forEach((g) => partesDe(g, r)); break;
    }
    return r;
  }

  // Recuadro [x0,y0,x1,y1] en coordenadas Mercator de una lista de features.
  function cajaMerc(features) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const ver = (pt) => {
      const m = mercator(pt[0], pt[1]);
      if (m[0] < a) a = m[0]; if (m[1] < b) b = m[1];
      if (m[0] > c) c = m[0]; if (m[1] > d) d = m[1];
    };
    features.forEach((f) => {
      const p = partesDe(f.geometry);
      p.anillos.forEach((l) => l.forEach(ver));
      p.lineas.forEach((l) => l.forEach(ver));
      p.puntos.forEach(ver);
    });
    return [a, b, c, d];
  }

  // Estira el recuadro para que calce con la proporción del contenedor (sin deformar).
  function ajustarCaja(bb, aspecto) {
    let [x0, y0, x1, y1] = bb;
    const w = x1 - x0, h = y1 - y0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let nw = w, nh = h;
    if (w / h > aspecto) nh = w / aspecto; else nw = h * aspecto;
    return [cx - nw / 2, cy - nh / 2, cx + nw / 2, cy + nh / 2];
  }

  // Función que convierte [lon,lat] a coordenadas del viewBox.
  function proyector(bb, W, H) {
    const sx = W / (bb[2] - bb[0]), sy = H / (bb[3] - bb[1]);
    return (pt) => {
      const m = mercator(pt[0], pt[1]);
      return [(m[0] - bb[0]) * sx, (bb[3] - m[1]) * sy];
    };
  }

  function dDe(listas, px, cerrar) {
    let d = '';
    for (const pts of listas) {
      if (!pts || pts.length < 2) continue;
      for (let i = 0; i < pts.length; i++) {
        const q = px(pts[i]);
        d += (i ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2);
      }
      if (cerrar) d += 'Z';
    }
    return d;
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Dibuja una capa completa (polígonos + líneas + puntos) con su simbología.
  function capaSVG(nombre, fc, px, k) {
    const e = estiloDe(nombre);
    const peso = Math.max(e.peso * k, 0.05);
    const dash = dashDe(e.trazo, k);
    const atrDash = dash ? ` stroke-dasharray="${dash}"` : '';
    const anillos = [], lineas = [], puntos = [];
    (fc.features || []).forEach((f) => {
      const p = partesDe(f.geometry);
      anillos.push(...p.anillos); lineas.push(...p.lineas); puntos.push(...p.puntos);
    });
    let s = '';
    // Los polígonos muy pequeños (edificaciones) se dibujan sin borde: un borde tan ancho
    // como la figura la convierte en una mancha.
    if (anillos.length) {
      const borde = e.relleno > 0.8 ? 0 : peso;
      s += `<path d="${dDe(anillos, px, true)}" fill="${e.color}" fill-opacity="${e.relleno || 0.1}"` +
           ` fill-rule="evenodd" stroke="${borde ? e.color : 'none'}" stroke-width="${borde}"` +
           `${borde ? atrDash : ''} vector-effect="non-scaling-stroke" stroke-linejoin="miter"/>`;
    }
    if (lineas.length) {
      s += `<path d="${dDe(lineas, px, false)}" fill="none" stroke="${e.color}" stroke-width="${peso}"` +
           `${atrDash} vector-effect="non-scaling-stroke" stroke-linecap="butt" stroke-linejoin="miter"/>`;
    }
    puntos.forEach((p) => {
      const q = px(p);
      s += `<circle cx="${q[0].toFixed(2)}" cy="${q[1].toFixed(2)}" r="${(UV / 900) * k}" fill="${e.color}"` +
           ` stroke="#fff" stroke-width="${0.3 * k}" vector-effect="non-scaling-stroke"/>`;
    });
    return s;
  }

  // Barra de escala: largo "redondo" en km y qué porcentaje del ancho ocupa.
  function calcularEscala(bb, latMedia) {
    const metros = (bb[2] - bb[0]) * 111320 * Math.cos(latMedia * Math.PI / 180);
    const crudo = metros * 0.25;
    const exp = Math.floor(Math.log10(crudo));
    const base = crudo / Math.pow(10, exp);
    const bonito = (base < 1.5 ? 1 : base < 3 ? 2 : base < 7 ? 5 : 10) * Math.pow(10, exp);
    const km = bonito / 1000;
    return { pct: (bonito / metros) * 100, etiqueta: km >= 1 ? `${+km.toFixed(1)} km` : `${Math.round(bonito)} m` };
  }

  /* ---------- CRTM05 (EPSG:5367): el sistema de coordenadas oficial de Costa Rica ----------
     Es una Transversa de Mercator sobre el elipsoide GRS80, con meridiano central en -84°,
     factor de escala 0,9999, falso este 500 000 m y falso norte 0. Va escrita acá, y no con
     una biblioteca, porque son dos fórmulas y así la lámina no depende de nada más.
     Sirve para dibujar la grilla de coordenadas con sus rótulos en metros, como manda la
     cartografía de un Plan Regulador. */
  const CR05 = { a: 6378137.0, f: 1 / 298.257222101, lon0: -84 * Math.PI / 180, k0: 0.9999, FE: 500000, FN: 0 };

  function aCRTM05(lon, lat) {
    const { a, f, lon0, k0, FE, FN } = CR05;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
    const sp = Math.sin(p), cp = Math.cos(p), tp = Math.tan(p);
    const N = a / Math.sqrt(1 - e2 * sp * sp);
    const T = tp * tp, C = ep2 * cp * cp, A = (l - lon0) * cp;
    const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * p
      - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p)
      + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p)
      - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
    const E = FE + k0 * N * (A + (1 - T + C) * A ** 3 / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
    const Nn = FN + k0 * (M + N * tp * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    return [E, Nn];
  }

  function deCRTM05(E, Nn) {
    const { a, f, lon0, k0, FE, FN } = CR05;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const raiz = Math.sqrt(1 - e2), e1 = (1 - raiz) / (1 + raiz);
    const M = (Nn - FN) / k0;
    const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
      + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const sp1 = Math.sin(p1), cp1 = Math.cos(p1), tp1 = Math.tan(p1);
    const C1 = ep2 * cp1 * cp1, T1 = tp1 * tp1;
    const N1 = a / Math.sqrt(1 - e2 * sp1 * sp1);
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * sp1 * sp1, 1.5);
    const D = (E - FE) / (N1 * k0);
    const lat = p1 - (N1 * tp1 / R1) * (D * D / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / cp1;
    return [lon * 180 / Math.PI, lat * 180 / Math.PI];
  }

  // Un paso de grilla "redondo" (1, 2, 2.5 o 5 × 10^n) cercano a span/objetivo.
  function pasoBonito(span, objetivo) {
    const crudo = span / Math.max(objetivo, 1);
    const exp = Math.floor(Math.log10(crudo));
    const base = crudo / Math.pow(10, exp);
    const b = base < 1.5 ? 1 : base < 3 ? 2 : base < 4 ? 2.5 : base < 7.5 ? 5 : 10;
    return b * Math.pow(10, exp);
  }

  /* Grilla de coordenadas CRTM05 sobre el recuadro del mapa.
     Devuelve las líneas (SVG) y los rótulos (HTML) para los cuatro lados del marco.
     Las líneas de E y N constantes en CRTM05 salen apenas curvas en Mercator, pero en el
     ancho de un cantón la diferencia es menor que el grosor del trazo, así que se dibujan
     rectas tomando la posición en el centro del mapa. */
  function grillaCRTM05(bb, UV, H, k) {
    const desMerc = (my) => (Math.atan(Math.exp(my * Math.PI / 180)) * 360 / Math.PI) - 90;
    const esquinas = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]]
      .map(([x, y]) => aCRTM05(x, desMerc(y)));
    const Es = esquinas.map((c) => c[0]), Ns = esquinas.map((c) => c[1]);
    const E0 = Math.min(...Es), E1 = Math.max(...Es);
    const N0 = Math.min(...Ns), N1 = Math.max(...Ns);
    const paso = pasoBonito(Math.max(E1 - E0, N1 - N0), 5);
    const Ec = (E0 + E1) / 2, Nc = (N0 + N1) / 2;
    const px = proyector(bb, UV, H);
    let lineas = '', rotulos = '';
    const trazo = `stroke="#8d8d8d" stroke-width="${0.35 * k}" vector-effect="non-scaling-stroke"`;
    for (let E = Math.ceil(E0 / paso) * paso; E < E1; E += paso) {
      const q = px(deCRTM05(E, Nc));
      if (q[0] < 1 || q[0] > UV - 1) continue;
      const pct = (q[0] / UV * 100).toFixed(3);
      lineas += `<path d="M${q[0].toFixed(2)} 0L${q[0].toFixed(2)} ${H.toFixed(2)}" ${trazo}/>`;
      rotulos += `<span class="rej sup" style="left:${pct}%">${Math.round(E)}</span>` +
                 `<span class="rej inf" style="left:${pct}%">${Math.round(E)}</span>`;
    }
    for (let N = Math.ceil(N0 / paso) * paso; N < N1; N += paso) {
      const q = px(deCRTM05(Ec, N));
      if (q[1] < 1 || q[1] > H - 1) continue;
      const pct = (q[1] / H * 100).toFixed(3);
      lineas += `<path d="M0 ${q[1].toFixed(2)}L${UV} ${q[1].toFixed(2)}" ${trazo}/>`;
      rotulos += `<span class="rej izq" style="top:${pct}%">${Math.round(N)}</span>` +
                 `<span class="rej der" style="top:${pct}%">${Math.round(N)}</span>`;
    }
    return { lineas, rotulos, paso };
  }

  /* ---------- relieve sombreado de fondo ----------
     El mapa base se arma con la topografía por debajo, para que se vean las sombras del
     terreno. El relieve viene en teselas (las mismas que usa QGIS con el "World Hillshade"),
     se pegan en un lienzo y el resultado se mete como una sola imagen dentro del SVG de la
     lámina. Van por /geoproxy porque el servidor de teselas no habilita CORS y, sin eso, el
     lienzo queda "manchado" y no se puede exportar.

     Las teselas están en Mercator, igual que la lámina, así que calzan sin reproyectar: en
     este espacio la coordenada de tesela es una cuenta lineal.

     Si no se pueden traer (sin red, servicio caído), la lámina sale igual, sin sombras. */
  const RELIEVE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile';
  const relieveCache = new Map();

  function cargarTesela(z, x, y) {
    return new Promise((resolve) => {
      const img = new Image();
      // Siempre se responde, pase lo que pase: una tesela que no llega no puede dejar
      // colgada la exportación de la lámina.
      const reloj = setTimeout(() => resolve(null), 8000);
      const listo = (v) => { clearTimeout(reloj); resolve(v); };
      img.onload = () => listo(img);
      img.onerror = () => listo(null);
      // El orden del ArcGIS es /z/y/x, no /z/x/y.
      img.src = '/geoproxy?url=' + encodeURIComponent(`${RELIEVE_URL}/${z}/${y}/${x}`);
    });
  }

  async function relieveDe(bb, maxTeselas) {
    const clave = bb.map((v) => v.toFixed(4)).join(',') + '|' + maxTeselas;
    if (relieveCache.has(clave)) return relieveCache.get(clave);
    const tarea = (async () => {
      // Se elige el zoom más alto que quepa en el presupuesto de teselas.
      const aTx = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
      const aTy = (my, z) => (1 - my / 180) / 2 * Math.pow(2, z);
      let z = 0;
      for (let pruebe = 16; pruebe >= 6; pruebe--) {
        const nx = Math.ceil(aTx(bb[2], pruebe)) - Math.floor(aTx(bb[0], pruebe));
        const ny = Math.ceil(aTy(bb[1], pruebe)) - Math.floor(aTy(bb[3], pruebe));
        if (nx * ny <= maxTeselas) { z = pruebe; break; }
      }
      if (!z) return null;
      const x0 = Math.floor(aTx(bb[0], z)), x1 = Math.ceil(aTx(bb[2], z));
      const y0 = Math.floor(aTy(bb[3], z)), y1 = Math.ceil(aTy(bb[1], z));
      const nx = x1 - x0, ny = y1 - y0;
      const lienzo = document.createElement('canvas');
      lienzo.width = nx * 256; lienzo.height = ny * 256;
      const ctx = lienzo.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      // De a ocho para no abrir cien conexiones de golpe.
      const pedidos = [];
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) pedidos.push([x, y]);
      let trajo = 0;
      for (let i = 0; i < pedidos.length; i += 8) {
        const lote = await Promise.all(pedidos.slice(i, i + 8).map(([x, y]) => cargarTesela(z, x, y)));
        lote.forEach((img, j) => {
          if (!img) return;
          const [x, y] = pedidos[i + j];
          ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256, 256, 256);
          trajo++;
        });
        // Si el primer lote no trajo nada, el servicio no está: no se piden cien más.
        if (i === 0 && !trajo) return null;
      }
      if (!trajo) return null;
      // El recuadro que cubre el lienzo, en las mismas unidades Mercator de la lámina.
      const lonDe = (tx) => tx / Math.pow(2, z) * 360 - 180;
      const myDe = (ty) => (1 - 2 * ty / Math.pow(2, z)) * 180;
      try {
        return { url: lienzo.toDataURL('image/jpeg', 0.86), z, teselas: trajo,
                 caja: [lonDe(x0), myDe(y1), lonDe(x1), myDe(y0)] };
      } catch (e) {
        return null;      // lienzo manchado: se sigue sin relieve
      }
    })();
    relieveCache.set(clave, tarea);
    return tarea;
  }

  /* ---------- modelo de elevación y pendientes ----------
     El IFA pide el mapa de pendientes (M1.1.03) en cinco clases, y para eso hace falta un
     modelo de elevación. El DEM fino del IGN (5 m) no está publicado como servicio, así que
     se usan teselas de elevación: imágenes PNG donde cada píxel guarda la altura codificada
     en sus tres canales de color, con la fórmula del formato "terrarium":

         altura_en_metros = (R * 256 + G + B / 256) - 32768

     Ese servidor sí manda cabeceras CORS, así que las teselas se piden directo, sin pasar
     por el Worker, y el lienzo no queda "manchado" (se puede exportar al PDF).

     Qué resolución es esta: las teselas vienen de SRTM y fuentes equivalentes, o sea unos
     30 m de paso. Sirve para la lectura cantonal y para una primera clasificación, pero NO
     reemplaza el levantamiento fino: para el detalle urbano el desglose pide 5 m, que sale
     de interpolar las curvas del IGN o de un vuelo de dron. El Copernicus DEM GLO-30 (30 m
     también) se puede traer por el Worker, que sí llega al bucket; queda para el paso
     siguiente porque son GeoTIFF y hay que leerlos por rango. */
  const TERRENO_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
  const elevCache = new Map();

  function cargarTeselaElev(z, x, y) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';     // el servidor sí lo permite; sin esto el lienzo se mancha
      const reloj = setTimeout(() => resolve(null), 8000);
      const listo = (v) => { clearTimeout(reloj); resolve(v); };
      img.onload = () => listo(img);
      img.onerror = () => listo(null);
      img.src = `${TERRENO_URL}/${z}/${x}/${y}.png`;
    });
  }

  /* Arma el mosaico de elevación que cubre `bb` y devuelve las alturas ya decodificadas.
     Devuelve null si no se pudo traer nada, para que el mapa siga funcionando sin esto. */
  async function elevacionDe(bb, maxTeselas) {
    const clave = bb.map((v) => v.toFixed(4)).join(',') + '|' + maxTeselas;
    if (elevCache.has(clave)) return elevCache.get(clave);
    const tarea = (async () => {
      // Las teselas de elevación son Web Mercator estándar (z/x/y), no el orden de ArcGIS.
      const aTx = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
      const aTy = (lat, z) => {
        const r = lat * Math.PI / 180;
        return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
      };
      let z = 0;
      for (let pruebe = 14; pruebe >= 8; pruebe--) {
        const nx = Math.ceil(aTx(bb[2], pruebe)) - Math.floor(aTx(bb[0], pruebe));
        const ny = Math.ceil(aTy(bb[1], pruebe)) - Math.floor(aTy(bb[3], pruebe));
        if (nx * ny <= maxTeselas) { z = pruebe; break; }
      }
      if (!z) return null;
      const x0 = Math.floor(aTx(bb[0], z)), x1 = Math.ceil(aTx(bb[2], z));
      const y0 = Math.floor(aTy(bb[3], z)), y1 = Math.ceil(aTy(bb[1], z));
      const nx = x1 - x0, ny = y1 - y0;
      const lienzo = document.createElement('canvas');
      lienzo.width = nx * 256; lienzo.height = ny * 256;
      const ctx = lienzo.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      const pedidos = [];
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) pedidos.push([x, y]);
      let trajo = 0;
      for (let i = 0; i < pedidos.length; i += 8) {
        const lote = await Promise.all(pedidos.slice(i, i + 8).map(([x, y]) => cargarTeselaElev(z, x, y)));
        lote.forEach((img, j) => {
          if (!img) return;
          const [x, y] = pedidos[i + j];
          ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256, 256, 256);
          trajo++;
        });
        if (i === 0 && !trajo) return null;   // el servicio no responde: no se piden cien más
      }
      if (!trajo) return null;

      let px;
      try { px = ctx.getImageData(0, 0, lienzo.width, lienzo.height).data; }
      catch (e) { return null; }              // lienzo manchado

      const alturas = new Float32Array(lienzo.width * lienzo.height);
      for (let i = 0, p = 0; i < alturas.length; i++, p += 4) {
        // Un píxel sin tesela queda transparente: se marca como hueco, no como altura 0,
        // porque el mar y un hueco de datos no son lo mismo.
        alturas[i] = px[p + 3] === 0 ? NaN : (px[p] * 256 + px[p + 1] + px[p + 2] / 256) - 32768;
      }
      // Caja real del mosaico en grados, para colocar la imagen en el mapa.
      const lonDe = (tx) => tx / Math.pow(2, z) * 360 - 180;
      const latDe = (ty) => {
        const n = Math.PI - 2 * Math.PI * ty / Math.pow(2, z);
        return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
      };
      return { alturas, ancho: lienzo.width, alto: lienzo.height, z, teselas: trajo,
               caja: [lonDe(x0), latDe(y1), lonDe(x1), latDe(y0)] };
    })();
    elevCache.set(clave, tarea);
    return tarea;
  }

  /* Las cinco clases de pendiente del IFA, con los cortes del Anexo 1 del DE 44710.
     Los colores siguen la rampa de fragilidad: verde (apto) a rojo (muy frágil). */
  const CLASES_PENDIENTE = [
    { max: 5,        etiqueta: '0 – 5 %',    clase: 'I',   color: [ 26, 152,  80] },
    { max: 15,       etiqueta: '5 – 15 %',   clase: 'II',  color: [166, 217, 106] },
    { max: 30,       etiqueta: '15 – 30 %',  clase: 'III', color: [254, 224, 139] },
    { max: 60,       etiqueta: '30 – 60 %',  clase: 'IV',  color: [244, 109,  67] },
    { max: Infinity, etiqueta: 'más de 60 %', clase: 'V',  color: [165,   0,  38] },
  ];

  /* Calcula la pendiente por el método de Horn (la ventana de 3×3 que usan QGIS y ArcGIS)
     y pinta cada píxel con el color de su clase. Devuelve también el histograma, que es
     lo que de verdad sirve para planificar: cuánto del cantón está en cada clase. */
  function pendientesDesdeElevacion(elev) {
    const { alturas, ancho, alto, caja, z } = elev;
    // Tamaño del píxel en metros. En Mercator depende de la latitud, así que se toma la
    // del centro del mosaico: dentro de un cantón la variación es despreciable.
    const latMedia = (caja[1] + caja[3]) / 2;
    const metrosPorPixel = 156543.03392 * Math.cos(latMedia * Math.PI / 180) / Math.pow(2, z);

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho; lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(ancho, alto);
    const out = img.data;
    const histograma = new Array(CLASES_PENDIENTE.length).fill(0);
    let validos = 0;

    const h = (x, y) => alturas[y * ancho + x];
    for (let y = 1; y < alto - 1; y++) {
      for (let x = 1; x < ancho - 1; x++) {
        const i = y * ancho + x;
        const a = h(x - 1, y - 1), b = h(x, y - 1), c = h(x + 1, y - 1);
        const d = h(x - 1, y),                      f = h(x + 1, y);
        const g = h(x - 1, y + 1), hh = h(x, y + 1), k = h(x + 1, y + 1);
        if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d) ||
            Number.isNaN(f) || Number.isNaN(g) || Number.isNaN(hh) || Number.isNaN(k)) continue;
        const dzdx = ((c + 2 * f + k) - (a + 2 * d + g)) / (8 * metrosPorPixel);
        const dzdy = ((g + 2 * hh + k) - (a + 2 * b + c)) / (8 * metrosPorPixel);
        const pct = Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100;
        let ci = 0;
        while (ci < CLASES_PENDIENTE.length - 1 && pct > CLASES_PENDIENTE[ci].max) ci++;
        histograma[ci]++; validos++;
        const col = CLASES_PENDIENTE[ci].color;
        const p = i * 4;
        out[p] = col[0]; out[p + 1] = col[1]; out[p + 2] = col[2]; out[p + 3] = 150;
      }
    }
    if (!validos) return null;
    ctx.putImageData(img, 0, 0);
    let url;
    try { url = lienzo.toDataURL('image/png'); } catch (e) { return null; }
    return {
      url, caja, z, metrosPorPixel,
      reparto: CLASES_PENDIENTE.map((c, i) => ({
        clase: c.clase, etiqueta: c.etiqueta, color: `rgb(${c.color.join(',')})`,
        pct: validos ? (histograma[i] / validos * 100) : 0,
      })),
    };
  }

  // Escalas "de plano": se sube a la siguiente escala redonda, nunca se baja, para que la
  // escala numérica que se imprime sea exacta y no un número cualquiera.
  function escalaBonita(minima) {
    const pasos = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
    const exp = Math.floor(Math.log10(Math.max(minima, 1)));
    for (let e = exp; e <= exp + 2; e++) {
      for (const p of pasos) {
        const v = p * Math.pow(10, e);
        if (v >= minima) return v;
      }
    }
    return Math.ceil(minima);
  }
  const milesCon = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // Cuántas teselas de relieve se piden según la hoja: más papel, más detalle.
  const TESELAS_POR_PAPEL = { 'Carta': 60, 'A3': 100, 'A2': 160, 'A1': 260 };

  // ---------- imprimir: una lámina por mapa marcado ----------
  async function construirLaminas(soloEstos, prog) {
    const cont = $('laminas');
    cont.innerHTML = '';

    const papel = papelActual();
    const k = papel.k;
    const muni = muniNombreVal || ('Municipalidad de ' + $('selCanton').value);
    const canton = $('selCanton').value;
    const hoy = new Date().toLocaleDateString('es-CR');
    const mesAnio = new Date().toLocaleDateString('es-CR', { month: 'long', year: 'numeric' });
    // En el orden del catálogo, no en el orden en que se fueron marcando.
    // `soloEstos` lo usa el botón "Descargar" de la estructura, para una lámina sola.
    const pedidos = soloEstos ? new Set(soloEstos) : seleccion;
    const ids = [];
    catalogo.instituciones.forEach((inst) => inst.mapas.forEach((m) => { if (pedidos.has(m.id)) ids.push(m.id); }));

    const partesCanton = partesDe(cantonSel.geometry);
    const cajaCanton = cajaMerc([cantonSel]);
    const [, latMin, , latMax] = bboxDe(cantonSel);
    const latMedia = (latMin + latMax) / 2;
    const vecinos = vecinosDe(cantonSel);
    const elabora = firmaDe('elabora');
    const profesional = firmaDe('profesional');
    const conRelieve = !$('chkRelieve') || $('chkRelieve').checked;

    // 0) Portada/índice del atlas (solo si es el atlas completo, no una lámina suelta).
    if (!soloEstos) {
      const indiceHTML = (() => {
        let filas = '';
        let num = 0;
        catalogo.instituciones.forEach((inst) => {
          const mapasInst = inst.mapas.filter((m) => pedidos.has(m.id));
          if (!mapasInst.length) return;
          filas += `<tr class="idx-grupo"><td colspan="3">${esc(inst.icono || '🗺')} ${esc(inst.nombre)}</td></tr>`;
          mapasInst.forEach((m) => {
            num++;
            const cod = codigoDe(m);
            filas += `<tr><td class="idx-num">${num}</td><td class="idx-cod">${cod ? esc(cod) : ''}</td><td>${esc(m.nombre)}</td></tr>`;
          });
        });
        return filas;
      })();
      const portada = document.createElement('div');
      portada.className = 'lamina';
      portada.innerHTML = `
        <div class="lam-hoja lam-portada">
          <div class="portada-contenido">
            <div class="portada-logos">
              ${muniLogo ? `<img src="${muniLogo}" class="portada-escudo" alt="">` : ''}
            </div>
            <h1 class="portada-tit">Atlas Cartográfico</h1>
            <h2 class="portada-subtit">Plan Regulador Territorial</h2>
            <h2 class="portada-canton">Cantón ${esc(canton)}</h2>
            <div class="portada-meta">
              ${elabora ? `<div>Elaborado por: <b>${esc(elabora)}</b></div>` : ''}
              ${profesional ? `<div>Profesional responsable: <b>${esc(profesional)}</b></div>` : ''}
              <div>${esc(mesAnio)}</div>
            </div>
            <table class="portada-indice">
              <thead><tr><th>#</th><th>Código</th><th>Mapa</th></tr></thead>
              <tbody>${indiceHTML}</tbody>
            </table>
            <div class="portada-pie">
              ${esc(muni)} · Sistema CRSIRGAS / CRTM05 (EPSG:5367)<br>
              Generado con PlanoExactoCR · atlas.planoexactocr.com
            </div>
          </div>
        </div>`;
      cont.appendChild(portada);
    }

    // 1) Se arma el esqueleto de todas las láminas, para poder medir el recuadro del mapa.
    const hojas = [];
    for (let i = 0; i < ids.length; i++) {
      const m = defMapa(ids[i]);
      if (!m) continue;
      hojas.push({ i, m });
    }
    const total = hojas.length;
    hojas.forEach(({ i, m }, n) => {
      const lam = document.createElement('div');
      lam.className = 'lamina';
      lam.innerHTML = `
        <div class="lam-hoja">
          <div class="lam-izq">
            <div class="lam-cab">
              <div class="lam-titulo">${esc(m.nombre)}</div>
              <div class="lam-subtit">${codigoDe(m) ? esc(codigoDe(m)) + ' · ' : ''}${esc(m.institucion)}</div>
            </div>
            <div class="lam-mapa-zona" id="zona-${i}">
              <div class="lam-mapa-wrap" id="wrap-${i}">
                <div class="lam-norte"><div class="flecha">▲</div>N</div>
              </div>
            </div>
          </div>
          <div class="lam-caj">
            <div class="caj-tit"><span>Plan Regulador Territorial</span><b>Cantón ${esc(canton)}</b></div>
            <div class="caj-logos">
              <div class="caj-escudo">${muniLogo ? `<img src="${muniLogo}" alt="">` : ''}</div>
              <div class="caj-elab">Elaborado por:${elabora
                ? `<div class="firma">${esc(elabora)}</div>`
                : '<img src="planoexacto.png" alt="">'}</div>
            </div>
            <div class="caj-simb">
              <div class="caj-rot">Simbología</div>
              <div class="caj-leyenda" id="ley-${i}"></div>
            </div>
            <div class="caj-datos">
              <div id="esc-${i}"><b>Escala numérica</b></div>
              ${profesional ? `<div>Profesional responsable:<br>${esc(profesional)}</div>` : ''}
              <div>Sistema de coordenadas<br>CRSIRGAS / CRTM05 (EPSG:5367)</div>
              <div class="fuentes" id="fuentes-${i}"><b>Fuentes:</b> Sistema Nacional de
                Información Territorial (SNIT).</div>
              <div>Fecha de elaboración:<br>${esc(mesAnio)}</div>
              <div>${esc(muni)}<br>Lámina ${n + 1} / ${total} · ${papel.nombre} ${papel.vertical ? 'vertical' : 'apaisado'} · ${hoy}</div>
            </div>
            <div class="lam-inset" id="ins-${i}"><div class="lam-inset-tit">Área de estudio</div></div>
          </div>
        </div>`;
      cont.appendChild(lam);
      hojas[n].lam = lam;
    });

    // 2) Se dibuja el mapa de cada lámina, ya sabiendo su tamaño real en el papel.
    for (const { i, lam } of hojas) {
      const wrap = $(`wrap-${i}`);
      const zona = $(`zona-${i}`);
      if (!wrap) continue;

      /* Tamaño impreso del recuadro del mapa, en milímetros. La proporción entre el recuadro
         y la hoja es la misma en píxeles que en milímetros, así que basta una regla de tres
         contra el ancho de la hoja (que sí se conoce en mm). Si el navegador todavía no midió
         nada, se usa una estimación a partir de la propia maqueta. */
      const anchoLam = lam.offsetWidth || 0, altoLam = lam.offsetHeight || 0;
      const wPx = wrap.offsetWidth || 0, hPx = wrap.offsetHeight || 0;
      const medido = anchoLam > 0 && altoLam > 0 && wPx > 0 && hPx > 0;
      const mapaW = medido ? papel.w * wPx / anchoLam : papel.w * 0.72;
      const mapaH = medido ? papel.h * hPx / altoLam : papel.h * 0.78;
      const aspecto = mapaW / mapaH;

      /* Escala exacta: se calcula la escala mínima que hace caber el cantón con un respiro,
         se sube a la siguiente escala redonda y el recuadro del mapa se arma a esa escala.
         Así la lámina se imprime a 1:10 000 o 1:25 000 de verdad, y se puede medir encima. */
      const mPorGrado = 111320 * Math.cos(latMedia * Math.PI / 180);
      const anchoM = (cajaCanton[2] - cajaCanton[0]) * mPorGrado * 1.08;
      const altoM = (cajaCanton[3] - cajaCanton[1]) * mPorGrado * 1.08;
      const escala = escalaBonita(Math.max(anchoM / (mapaW / 1000), altoM / (mapaH / 1000)));
      const gW = (mapaW / 1000) * escala / mPorGrado;
      const gH = (mapaH / 1000) * escala / mPorGrado;
      const cx = (cajaCanton[0] + cajaCanton[2]) / 2, cy = (cajaCanton[1] + cajaCanton[3]) / 2;
      const bb = [cx - gW / 2, cy - gH / 2, cx + gW / 2, cy + gH / 2];
      const H = UV / aspecto;
      const px = proyector(bb, UV, H);
      const escEl = $(`esc-${i}`);
      if (escEl) escEl.innerHTML = `<b>Escala numérica</b><br>1: ${milesCon(escala)}`;

      // Relieve sombreado de fondo (si se pudo traer).
      if (prog) { prog.paso('Cargando relieve sombreado…', '🏔️'); prog.porcentaje(15); await new Promise(r => setTimeout(r, 30)); }
      const relieve = conRelieve ? await relieveDe(bb, TESELAS_POR_PAPEL[papel.nombre] || 120) : null;
      let fondo = '';
      if (relieve) {
        const sx = UV / (bb[2] - bb[0]), sy = H / (bb[3] - bb[1]);
        const x = (relieve.caja[0] - bb[0]) * sx, y = (bb[3] - relieve.caja[3]) * sy;
        const w = (relieve.caja[2] - relieve.caja[0]) * sx;
        const h = (relieve.caja[3] - relieve.caja[1]) * sy;
        fondo = `<image href="${relieve.url}" xlink:href="${relieve.url}" x="${x.toFixed(2)}" ` +
                `y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" ` +
                `preserveAspectRatio="none"/>`;
      }

      // Capas: SOLO las del mapa (insumos), nada más.
      // Cada lámina muestra únicamente lo que indica su título;
      // las capas base visibles en pantalla NO se agregan.
      if (prog) { prog.paso('Relieve listo. Preparando capas…', '🗺️'); prog.porcentaje(30); }
      const leyenda = [['Límite cantonal', 'Límites cantonales']];
      const nombres = [];
      insumosReales(ids[i]).forEach((n) => { if (!nombres.includes(n)) nombres.push(n); });
      let capasSVG = '';
      const fuentes = new Set();
      for (let ci = 0; ci < nombres.length; ci++) {
        const nombre = nombres[ci];
        if (prog) {
          const pct = 30 + Math.round((ci / nombres.length) * 50);
          prog.paso(`${iconoCapa(nombre)} Dibujando: ${nombre}`, '');
          prog.porcentaje(pct);
          await new Promise(r => setTimeout(r, 20));
        }
        const fc = await obtenerDatos(nombre);
        if (fc && fc.features && fc.features.length) {
          capasSVG += capaSVG(nombre, fc, px, k);
          leyenda.push([nombre, nombre]);
          const f = (capaPorNombre[nombre] || {}).fuente;
          if (f) fuentes.add(String(f).trim().replace(/\.$/, ''));
        }
      }
      // Las fuentes del cajetín son las de las capas que se dibujaron de verdad, no una
      // lista fija: así la lámina declara exactamente de dónde salió lo que muestra.
      const fuenteEl = $(`fuentes-${i}`);
      if (fuenteEl) {
        fuenteEl.innerHTML = '<b>Fuentes:</b> ' +
          ([...fuentes].sort().join('. ') || 'Sistema Nacional de Información Territorial (SNIT)') +
          '.' + (relieve ? ' Relieve sombreado: Esri World Hillshade.' : '') +
          ' Elaboración propia con PlanoExactoCR.';
      }

      /* Velos: adentro del cantón uno blanco, para que el relieve quede de fondo suave y las
         capas se lean; afuera uno gris, que apaga el relieve y deja claro dónde termina el
         área de planificación. Sin relieve, el de afuera es gris liso como antes. */
      const dCanton = dDe(partesCanton.anillos, px, true);
      const veloDentro = relieve
        ? `<path d="${dCanton}" fill="#ffffff" fill-opacity="0.55" fill-rule="evenodd"/>` : '';
      const marco = `M0 0L${UV} 0L${UV} ${H.toFixed(2)}L0 ${H.toFixed(2)}Z`;
      const mascara = relieve
        ? `<path d="${marco}${dCanton}" fill="#8d8d8d" fill-opacity="0.33" fill-rule="evenodd"/>`
        : `<path d="${marco}${dCanton}" fill="#ececec" fill-rule="evenodd"/>`;
      // Las capas se recortan al cantón: el área de planificación es la que se analiza, y
      // dejar que las vías o los distritos sigan de largo por fuera confunde la lectura.
      const recorte = `recorte-${i}`;
      const capasRecortadas = capasSVG
        ? `<clipPath id="${recorte}"><path d="${dCanton}" clip-rule="evenodd"/></clipPath>` +
          `<g clip-path="url(#${recorte})">${capasSVG}</g>`
        : '';
      // Vecinos: solo el contorno, sobre el gris.
      let svgVecinos = '';
      vecinos.forEach((v) => {
        const pv = partesDe(v.geometry);
        svgVecinos += `<path d="${dDe(pv.anillos, px, true)}" fill="none" stroke="#9a9a9a" ` +
                      `stroke-width="${0.5 * k}" vector-effect="non-scaling-stroke"/>`;
      });
      const eC = estiloDe('Límites cantonales');
      const limite = `<path d="${dCanton}" fill="none" stroke="${eC.color}" stroke-width="${1.5 * k}" ` +
                     `stroke-dasharray="${dashDe('guion', k)}" vector-effect="non-scaling-stroke"/>`;
      const grilla = grillaCRTM05(bb, UV, H, k);

      const svg = `<svg class="lam-svg" viewBox="0 0 ${UV} ${H.toFixed(2)}" preserveAspectRatio="none" ` +
                  `xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
                  `shape-rendering="geometricPrecision">` +
                  fondo + veloDentro + capasRecortadas + mascara + svgVecinos + grilla.lineas + limite + '</svg>';

      // Rótulos de los cantones vecinos, como HTML (así la letra no se deforma).
      let rotulos = '';
      vecinos.forEach((v) => {
        try {
          const ctr = turf.centroid(v).geometry.coordinates;
          const q = px(ctr);
          if (q[0] < 0 || q[0] > UV || q[1] < 0 || q[1] > H) return;
          rotulos += `<span class="rot-vecino" style="left:${(q[0] / UV * 100).toFixed(2)}%;` +
                     `top:${(q[1] / H * 100).toFixed(2)}%">${esc(String(v.properties.k).toUpperCase())}</span>`;
        } catch (e) { /* sin rótulo */ }
      });

      // Barra de escala: el largo "redondo" en km, medido sobre el ancho real del mapa.
      const metrosMapa = (mapaW / 1000) * escala;
      const largo = pasoBonito(metrosMapa * 0.3, 1);
      const rotula = (m) => (largo >= 1000 ? +(m / 1000).toFixed(1) : Math.round(m));
      const unidad = largo >= 1000 ? ' km' : ' m';
      const escalaHTML = `<div class="lam-escala" style="width:${(largo / metrosMapa * 100).toFixed(2)}%">` +
                         '<div class="barra"><i></i><i></i></div>' +
                         `<div class="rot"><span>0</span><span>${rotula(largo / 2)}</span>` +
                         `<span>${rotula(largo)}${unidad}</span></div></div>`;

      wrap.insertAdjacentHTML('afterbegin', svg + '<div class="lam-rotulos">' + rotulos + '</div>');
      wrap.insertAdjacentHTML('beforeend', escalaHTML);
      // Los rótulos de la grilla van por fuera del marco, en una capa calcada sobre él.
      if (zona) zona.insertAdjacentHTML('beforeend', `<div class="lam-rej">${grilla.rotulos}</div>`);

      // Simbología del cajetín, en dos columnas.
      if (prog) { prog.paso('Armando simbología y cajetín…', '🎨'); prog.porcentaje(85); }
      $(`ley-${i}`).innerHTML = leyenda.slice(0, 24).map(([etiqueta, capa]) =>
        `<div class="ley-item">${muestraHTML(capa, 'ley-color')}<em>${esc(etiqueta)}</em></div>`).join('');

      // Recuadro de ubicación: el país en gris con el cantón en rojo.
      const ins = $(`ins-${i}`);
      if (cantonesTodos && ins) {
        const aIns = (ins.offsetWidth || 150) / (ins.offsetHeight || 115);
        const Hi = UV / aIns;
        // Solo el país continental: el cantón de Puntarenas incluye la Isla del Coco, a 500 km
        // mar adentro, y si entra en la cuenta Costa Rica queda del tamaño de una estampilla.
        const dentro = cantonesTodos.features.filter((f) => {
          const b = bboxDe(f);
          return b[0] > -86.5 && b[1] > 7.9;
        });
        const bbi = ajustarCaja(cajaMerc(dentro.length ? dentro : cantonesTodos.features), aIns);
        const pxi = proyector(bbi, UV, Hi);
        let dPais = '';
        (dentro.length ? dentro : cantonesTodos.features).forEach((f) => {
          dPais += dDe(partesDe(f.geometry).anillos, pxi, true);
        });
        ins.insertAdjacentHTML('afterbegin',
          `<svg class="lam-svg" viewBox="0 0 ${UV} ${Hi.toFixed(2)}" preserveAspectRatio="none" ` +
          `xmlns="http://www.w3.org/2000/svg"><path d="${dPais}" fill="#ededed" stroke="#c4c4c4" ` +
          `stroke-width="0.3" vector-effect="non-scaling-stroke"/><path d="${dDe(partesCanton.anillos, pxi, true)}" ` +
          `fill="${eC.color}" stroke="${eC.color}" stroke-width="0.5" vector-effect="non-scaling-stroke"/></svg>`);
      }
    }
  }

  /* ---------- pestaña de estructura cartográfica ----------
     El atlas no es solo un visor: acá se ve toda la obra cartográfica de un vistazo —cada
     mapa que pide la normativa, qué capas necesita, de dónde sale cada una y si está— y se
     genera el que se quiera en el momento, con las capas que ese mapa necesite. */

  // Estado de un insumo: si existe como capa, de dónde viene y si se puede dibujar.
  function estadoInsumo(nombre) {
    const c = capaPorNombre[nombre];
    if (!c) return { nivel: 'falta', origen: 'no identificada' };
    const a = String(c.archivo || '');
    // Las calculadas no se descargan: se derivan acá mismo de otra fuente.
    if (c.calculada) return { nivel: c.estado === 'disponible' ? 'ok' : 'parcial', origen: c.fuente || 'calculada' };
    if (!a) return { nivel: 'falta', origen: c.fuente || 'sin fuente' };
    if (a.startsWith('api:')) return { nivel: 'parcial', origen: 'consulta por plano' };
    if (a.includes('planoexactocr.com/data/')) return { nivel: 'ok', origen: 'PlanoExacto', propio: true };
    if (c.estado && c.estado !== 'disponible') return { nivel: 'parcial', origen: c.fuente || 'servicio nacional' };
    return { nivel: 'ok', origen: c.fuente || 'servicio nacional' };
  }

  // Icono SVG representativo de cada capa, para reconocerla de un vistazo.
  // Son SVG inline monocloro, estilo cartográfico limpio — como en remates.planoexactocr.
  const _s = (d, color = 'currentColor') =>
    `<svg viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" class="ic">${d}</svg>`;
  const _sf = (d, color = 'currentColor') =>
    `<svg viewBox="0 0 16 16" fill="${color}" class="ic">${d}</svg>`;
  const IC = {
    limite:    _s('<rect x="2" y="2" width="12" height="12" rx="1.5" stroke-dasharray="2 2"/>'),
    curva:     _s('<path d="M2 12c2-4 4-8 6-8s4 3 6 4"/>'),
    agua:      _s('<path d="M8 2c-2 3-4 5-4 7a4 4 0 008 0c0-2-2-4-4-7z"/>', '#58a6ff'),
    rio:       _s('<path d="M4 2c2 2 0 5 2 7s0 5 2 5"/><path d="M8 2c2 2 0 5 2 7s0 5 2 5"/>', '#58a6ff'),
    via:       _s('<path d="M2 14L14 2"/><circle cx="4" cy="12" r="1.2"/><circle cx="12" cy="4" r="1.2"/>'),
    edif:      _s('<rect x="3" y="6" width="10" height="8" rx="1"/><path d="M3 6l5-4 5 4"/>'),
    bosque:    _sf('<path d="M8 1L4 6h2L3 11h3v3h4v-3h3l-3-5h2z"/>', '#3fb950'),
    area:      _s('<circle cx="8" cy="8" r="5.5" stroke-dasharray="3 2"/><path d="M6 8l1.5 2 3-4"/>', '#3fb950'),
    mar:       _s('<path d="M2 7c1.5-1.5 3-1.5 4 0s3 1.5 4 0 3-1.5 4 0"/><path d="M2 11c1.5-1.5 3-1.5 4 0s3 1.5 4 0 3-1.5 4 0"/>', '#58a6ff'),
    geo:       _s('<path d="M3 13l3-5 2 3 2-6 3 8"/>'),
    suelo:     _s('<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M2 7h12"/><path d="M2 11h12"/>'),
    rayo:      _s('<path d="M9 2L5 9h3l-1 5 5-7H9z"/>', '#e3b341'),
    salud:     _s('<path d="M6 3h4v4h3v4h-3v4H6v-4H3V7h3z"/>', '#f85149'),
    urbano:    _s('<rect x="1" y="8" width="4" height="6"/><rect x="6" y="4" width="4" height="10"/><rect x="11" y="6" width="4" height="8"/>'),
    cultivo:   _s('<path d="M8 14V5"/><path d="M5 7c0-3 3-5 3-5s3 2 3 5"/>'),
    peligro:   _s('<path d="M8 2L1.5 13h13z"/><path d="M8 7v3"/><circle cx="8" cy="12" r=".7" fill="currentColor"/>','#e3b341'),
    falla:     _s('<path d="M3 3l4 5-4 5"/><path d="M13 3l-4 5 4 5"/>'),
    inunda:    _s('<path d="M2 6c1.5-1.5 3-1.5 4 0s3 1.5 4 0 3-1.5 4 0"/><path d="M4 10l1 4h6l1-4"/>', '#58a6ff'),
    arq:       _sf('<path d="M4 3h8l-1 2H5zM3 6h10v1H3zM4 8h2v5H4zM10 8h2v5h-2zM3 13h10v1H3z"/>'),
    puente:    _s('<path d="M1 6h14"/><path d="M3 6v5a5 5 0 005 0V6"/><path d="M8 6v5a5 5 0 005 0V6"/>'),
    bus:       _s('<rect x="3" y="2" width="10" height="11" rx="2"/><path d="M3 9h10"/><circle cx="5.5" cy="14" r="1"/><circle cx="10.5" cy="14" r="1"/>'),
    tren:      _s('<rect x="4" y="2" width="8" height="9" rx="2"/><path d="M4 7h8"/><circle cx="6" cy="13" r="1"/><circle cx="10" cy="13" r="1"/><path d="M5 14l-1 1"/><path d="M11 14l1 1"/>'),
    avion:     _s('<path d="M8 1v14M4 6l4-2 4 2M5 12l3-1 3 1"/>'),
    pend:      _s('<path d="M2 14h12"/><path d="M2 14L14 4"/><path d="M6 14v-4"/><path d="M10 14v-8"/>'),
    pozo:      _s('<circle cx="8" cy="6" r="3"/><path d="M8 9v5"/><path d="M5 12h6"/>'),
    cuenca:    _s('<path d="M2 3c3 2 5 5 6 10"/><path d="M14 3c-3 2-5 5-6 10"/>'),
    escudo:    _s('<path d="M8 1C5 1 3 2 3 4v3c0 4 5 7 5 7s5-3 5-7V4c0-2-2-3-5-3z"/>'),
    restricc:  _s('<circle cx="8" cy="8" r="6"/><path d="M4 4l8 8"/>', '#f85149'),
    sol:       _s('<circle cx="8" cy="8" r="3"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2M4 4l1.5 1.5M10.5 10.5L12 12M12 4l-1.5 1.5M5.5 10.5L4 12"/>'),
    catastro:  _s('<rect x="2" y="2" width="12" height="12"/><path d="M7 2v12"/><path d="M2 7h12"/>'),
    plan:      _s('<rect x="3" y="1" width="10" height="14" rx="1.5"/><path d="M6 5h4"/><path d="M6 8h4"/><path d="M6 11h3"/>'),
    estadist:  _s('<rect x="2" y="9" width="3" height="5"/><rect x="6.5" y="5" width="3" height="9"/><rect x="11" y="2" width="3" height="12"/>'),
    gente:     _s('<circle cx="8" cy="5" r="2.5"/><path d="M3 14c0-3 2.5-5 5-5s5 2 5 5"/>'),
    defecto:   _s('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1" fill="currentColor"/>'),
  };
  const ICONO_CAPA = {
    'Límites cantonales': IC.limite, 'Límites distritales': IC.limite,
    'Zona marítimo terrestre': IC.mar, 'Curvas de nivel 10m': IC.curva,
    'Red hídrica': IC.rio, 'Red vial cantonal': IC.via, 'Red vial nacional (MOPT)': IC.via,
    'Edificaciones': IC.edif, 'Infraestructura general': IC.edif,
    'Áreas silvestres protegidas': IC.area, 'Corredores biológicos': IC.bosque,
    'Patrimonio Natural del Estado': IC.bosque, 'Registro Nacional de Humedales': IC.agua,
    'Áreas de Conservación': IC.area, 'Cobertura MAF2020': IC.bosque, 'Cobertura forestal 2020': IC.bosque,
    'Zonas de vida': IC.bosque,
    'Uso urbano 1:5mil': IC.urbano, 'Cultivos 1:5mil': IC.cultivo,
    'Grado de urbanización por UGM (DEGURBA)': IC.urbano,
    'Densidad de viviendas — cuadrícula 500 m': IC.estadist, 'Densidad de viviendas — cuadrícula 1 km': IC.estadist,
    'Coronas de deslizamientos': IC.peligro, 'Deslizamientos': IC.peligro,
    'Fallas del cuaternario': IC.falla, 'Áreas con potencial a inundación': IC.inunda,
    'Inundaciones LiDAR (ZMT)': IC.inunda,
    'Geología': IC.geo, 'Geología general (Dirección de Agua)': IC.geo,
    'Capacidad de uso de la tierra': IC.suelo, 'Suelos de Costa Rica (tipo y orden)': IC.suelo,
    'Red eléctrica': IC.rayo, 'Cobertura del tendido eléctrico (100 m)': IC.rayo,
    'Cobertura del tendido eléctrico (40 m)': IC.rayo,
    'ASADAS y abastecimiento de agua': IC.agua, 'Tomas de agua registradas': IC.agua,
    'Cobertura implícita de agua (concesiones)': IC.agua,
    'Organismos comunitarios de agua (OCAS)': IC.agua,
    'Sedes de salud': IC.salud, 'Centros de salud (INEC)': IC.salud,
    'Sitios arqueológicos registrados': IC.arq,
    'Siniestralidad vial 2021–2025': IC.peligro, 'Estaciones de conteo vehicular (TPD)': IC.via,
    'Inventario de puentes (Red Vial Nacional)': IC.puente,
    'Superficies limitadoras de obstáculos (aviación)': IC.avion,
    'Rutas de autobús': IC.bus, 'Recorrido del tren': IC.tren,
    'Pendientes (5 clases IFA)': IC.pend,
    'Pozos de monitoreo de aguas subterráneas': IC.pozo, 'Concesiones de agua (técnico)': IC.agua,
    'Zonas de protección de captaciones': IC.escudo, 'Acuífero Barva (SENARA)': IC.agua,
    'Obras en cauce': IC.rio, 'Cuencas hidrográficas': IC.cuenca, 'Unidades hidrológicas': IC.cuenca,
    'Zona de restricción absoluta (SENARA)': IC.restricc, 'Zona de restricción con estudio (SENARA)': IC.peligro,
    'Amenaza por eventos secos (IMN)': IC.sol,
    'DEM del IGN': IC.pend, 'Catastro (plano y finca)': IC.catastro,
    'Estado del plan regulador por cantón': IC.plan,
    'Unidades Geoestadísticas Mínimas (UGM) 2025': IC.estadist,
    'Estimaciones 2022 por distrito (con geometría)': IC.gente,
  };
  function iconoCapa(nombre) { return ICONO_CAPA[nombre] || IC.defecto; }

  // Insumos de un mapa del catálogo, con el estado de cada capa.
  function insumosHTML(m, vistas, cuenta) {
    if (!m || !m.insumos || !m.insumos.length) {
      return m && m.solo_pdf
        ? '<div class="est-calc">Se calcula sumando los sub-mapas de este eje.</div>'
        : '<div class="est-calc">Sin insumos definidos todavía.</div>';
    }
    return '<div class="est-insumos">' + m.insumos.map((n) => {
      const e = estadoInsumo(n);
      if (!vistas.has(n)) {
        vistas.add(n);
        if (e.propio) cuenta.propias++; else if (e.nivel === 'ok') cuenta.nacionales++;
      }
      return `<div class="est-ins"><span class="punto ${e.nivel}"></span>` +
             `<span class="icono-capa">${iconoCapa(n)}</span>` +
             `<span>${n}</span><span class="origen${e.propio ? ' propio' : ''}">${e.origen}</span></div>`;
    }).join('') + '</div>';
  }

  // Botón de un mapa que el atlas sí puede componer.
  function accionesHTML(id, estado) {
    if (!id || estado === 'pendiente') return '';
    return `<button data-descargar="${id}" title="Compone este mapa y abre el diálogo de impresión">Descargar lámina</button>`;
  }

  /* Vista principal: el índice maestro del Plan Regulador, con los códigos M que comparten
     el atlas y el calibrador. Cada fila dice quién resuelve ese mapa —el atlas, el
     calibrador, o el equipo consultor a mano— y, cuando lo resuelve el atlas, en qué estado
     está y con qué capas. */
  function construirIndiceMaestro() {
    const cuenta = { propias: 0, nacionales: 0 };
    const vistas = new Set();
    let listos = 0, parciales = 0, porDatos = 0;
    let conAtlas = 0, deCalibrador = 0, deEquipo = 0;

    const porComponente = {};
    estructura.mapas.forEach((mp) => {
      (porComponente[mp.componente] = porComponente[mp.componente] || []).push(mp);
    });
    const nombreComp = {};
    estructura.componentes.forEach((c) => { nombreComp[c.codigo] = c.nombre; });

    let h = '';
    estructura.bloques.forEach((blo) => {
      const comps = estructura.componentes.filter((c) => c.bloque === blo.codigo
        && (porComponente[c.codigo] || []).length);
      if (!comps.length) return;
      const etapa = (estructura.etapas.find((e) => e.numero === blo.etapa) || {}).nombre || '';

      h += `<div class="est-eje"><h3><span>${blo.icono}</span> Bloque ${blo.codigo} · ${blo.nombre}` +
           `<span class="badge etapa">Etapa ${blo.etapa}: ${etapa}</span></h3>` +
           `<p class="desc">${blo.descripcion}</p>`;

      comps.forEach((c) => {
        const lista = porComponente[c.codigo];
        h += `<div class="est-comp"><h4>${c.codigo} · ${nombreComp[c.codigo]}</h4>` +
             '<table class="est-tabla"><thead><tr><th style="width:74px">Código</th><th>Mapa</th>' +
             '<th style="width:36%">Insumos y de dónde salen</th>' +
             '<th style="width:120px"></th></tr></thead><tbody>';

        lista.forEach((mp) => {
          const m = mp.atlas ? defMapa(mp.atlas) : null;
          const estado = m ? m.estado : null;
          if (mp.resuelve === 'atlas') {
            if (estado === 'disponible') listos++;
            else if (estado === 'parcial') parciales++;
            else porDatos++;
          }
          if (mp.atlas) conAtlas++;
          if (mp.resuelve === 'calibrador') deCalibrador++;
          else if (mp.resuelve === 'equipo') deEquipo++;

          const quien = mp.resuelve === 'atlas'
            ? (mp.atlas ? '<span class="badge quien atlas">atlas</span>'
                        : '<span class="badge quien espera">atlas, falta armarlo</span>')
            : mp.resuelve === 'calibrador'
              ? '<span class="badge quien calib">calibrador</span>'
              : '<span class="badge quien equipo">equipo</span>';

          const marcas = (mp.guia_invu ? '<span class="badge guia">Guía INVU</span>' : '')
            + (mp.condicion ? `<span class="badge cond">${mp.condicion}</span>` : '')
            + (mp.sintesis ? '<span class="badge sint">síntesis</span>' : '')
            + (estado ? `<span class="badge ${estado}">${estado}</span>` : '');

          // `data-mapa` y `data-situacion` permiten llegar directo desde el calibrador y
          // filtrar la lista por lo que ya sale y lo que falta.
          const situacion = mp.resuelve !== 'atlas' ? 'otro'
            : estado === 'disponible' ? 'listo' : estado === 'parcial' ? 'parcial' : 'falta';
          h += `<tr${mp.atlas ? ` data-mapa="${mp.atlas}"` : ''} data-situacion="${situacion}">` +
               `<td class="est-cod">${mp.codigo}</td>` +
               `<td><div class="est-nom">${mp.nombre} ${quien} ${marcas}</div>` +
               `${m && m.descripcion ? `<div class="est-desc">${m.descripcion}</div>` : ''}` +
               `${mp.observacion ? `<div class="est-obs">${mp.observacion}</div>` : ''}` +
               `${m && m.faltante ? `<div class="est-falta">Falta: ${m.faltante}</div>` : ''}</td>` +
               `<td>${mp.resuelve === 'atlas' ? insumosHTML(m, vistas, cuenta)
                 : '<div class="est-calc">Lo resuelve ' +
                   (mp.resuelve === 'calibrador' ? 'el calibrador' : 'el equipo consultor') +
                   '.</div>'}</td>` +
               `<td class="est-acc">${accionesHTML(mp.atlas, estado)}</td></tr>`;
        });
        h += '</tbody></table></div>';
      });
      h += '</div>';
    });

    /* Los tres primeros chips filtran la lista. Repasar 87 mapas de corrido no se puede;
       lo útil es poder quedarse solo con los que faltan y trabajar sobre esos. */
    $('estResumen').innerHTML =
      `<span class="est-chip"><b>${estructura.mapas.length}</b> mapas en la obra</span>` +
      `<span class="est-chip"><b>${conAtlas}</b> con lámina en el atlas</span>` +
      `<span class="est-chip filtro" data-filtro="listo"><b>${listos}</b> ya salen</span>` +
      `<span class="est-chip filtro" data-filtro="parcial"><b>${parciales}</b> a medias</span>` +
      `<span class="est-chip filtro" data-filtro="falta"><b>${porDatos}</b> les falta un insumo</span>` +
      `<span class="est-chip"><b>${deCalibrador}</b> los resuelve el calibrador</span>` +
      `<span class="est-chip"><b>${deEquipo}</b> el equipo consultor</span>` +
      `<span class="est-chip"><b>${cuenta.propias}</b> capas propias de PlanoExacto</span>` +
      `<span class="est-chip"><b>${cuenta.nacionales}</b> capas de servicios nacionales</span>`;
    return h;
  }

  // Respaldo: si no se pudo leer la estructura compartida, se muestra el catálogo del atlas.
  function construirCatalogoPropio() {
    const cuenta = { propias: 0, nacionales: 0 };
    const vistas = new Set();
    let listos = 0, parciales = 0, pendientes = 0, totalMapas = 0;

    let h = '';
    catalogo.instituciones.forEach((inst) => {
      h += `<div class="est-eje"><h3><span>${inst.icono || '🗺'}</span> ${inst.nombre}` +
           `${inst.solo_pdf ? ' <span class="badge pdf">solo PDF</span>' : ''}</h3>` +
           `<p class="desc">${inst.descripcion}</p>` +
           '<table class="est-tabla"><thead><tr><th style="width:46px">#</th><th>Mapa</th>' +
           '<th style="width:40%">Insumos y de dónde salen</th><th style="width:120px"></th></tr></thead><tbody>';
      inst.mapas.forEach((raw) => {
        const m = Object.assign({ institucion: inst.nombre, solo_pdf: !!inst.solo_pdf }, raw);
        totalMapas++;
        if (m.estado === 'disponible') listos++;
        else if (m.estado === 'parcial') parciales++;
        else pendientes++;

        h += `<tr><td class="est-num">${m.numero || ''}</td>` +
             `<td><div class="est-nom">${m.nombre} <span class="badge ${m.estado}">${m.estado}</span></div>` +
             `<div class="est-desc">${m.descripcion}</div>` +
             `${m.faltante ? `<div class="est-falta">Falta: ${m.faltante}</div>` : ''}</td>` +
             `<td>${insumosHTML(m, vistas, cuenta)}</td>` +
             `<td class="est-acc">${accionesHTML(m.id, m.estado)}</td></tr>`;
      });
      h += '</tbody></table></div>';
    });

    $('estResumen').innerHTML =
      `<span class="est-chip"><b>${totalMapas}</b> mapas en la obra</span>` +
      `<span class="est-chip"><b>${listos}</b> listos</span>` +
      `<span class="est-chip"><b>${parciales}</b> parciales</span>` +
      `<span class="est-chip"><b>${pendientes}</b> por datos</span>` +
      `<span class="est-chip"><b>${cuenta.propias}</b> capas propias de PlanoExacto</span>` +
      `<span class="est-chip"><b>${cuenta.nacionales}</b> capas de servicios nacionales</span>`;
    return h;
  }

  function construirEstructura() {
    const cuerpo = $('estCuerpo');
    const hayEstructura = estructura && Array.isArray(estructura.mapas) && estructura.mapas.length;
    const h = hayEstructura ? construirIndiceMaestro() : construirCatalogoPropio();

    const avisos = (cantonSel ? '' :
      '<div class="est-aviso">Elegí un cantón en el panel de la izquierda para poder descargar mapas. ' +
      'La estructura se puede revisar sin cantón.</div>')
      + (hayEstructura ? '' :
      '<div class="est-aviso">No se pudo leer la estructura compartida del Plan Regulador, ' +
      'así que se muestra el catálogo propio del atlas. Los códigos de mapa pueden no ' +
      'coincidir con los del calibrador.</div>');

    cuerpo.innerHTML = avisos + h;

    cuerpo.querySelectorAll('[data-descargar]').forEach((b) => {
      b.addEventListener('click', () => descargarMapa(b.dataset.descargar));
    });

    /* Filtro por situación: al tocar un chip la lista se queda solo con esos mapas, y las
       tablas y componentes que quedan vacíos se esconden para no dejar títulos huérfanos.
       Tocar el chip otra vez vuelve a mostrar todo. */
    $('estResumen').querySelectorAll('.est-chip.filtro').forEach((chip) => {
      chip.addEventListener('click', () => {
        const quiero = chip.classList.contains('activo') ? null : chip.dataset.filtro;
        $('estResumen').querySelectorAll('.est-chip.filtro')
          .forEach((c) => c.classList.toggle('activo', c.dataset.filtro === quiero));
        cuerpo.querySelectorAll('tr[data-situacion]').forEach((fila) => {
          fila.hidden = !!quiero && fila.dataset.situacion !== quiero;
        });
        cuerpo.querySelectorAll('.est-comp').forEach((comp) => {
          comp.hidden = !comp.querySelector('tr[data-situacion]:not([hidden])');
        });
        cuerpo.querySelectorAll('.est-eje').forEach((eje) => {
          eje.hidden = !eje.querySelector('.est-comp:not([hidden])');
        });
      });
    });
  }

  // Panel de progreso mientras se compone un mapa.
  function mostrarProgreso(titulo) {
    let panel = $('progresoMapa');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'progresoMapa';
      panel.innerHTML = '<div class="prog-caja"><div class="prog-titulo"></div>' +
        '<div class="prog-pasos"></div><div class="prog-barra"><div class="prog-relleno"></div></div></div>';
      document.body.appendChild(panel);
    }
    panel.hidden = false;
    panel.querySelector('.prog-titulo').textContent = titulo;
    panel.querySelector('.prog-pasos').innerHTML = '';
    panel.querySelector('.prog-relleno').style.width = '0%';
    return {
      paso(texto, icono) {
        const p = document.createElement('div');
        p.className = 'prog-paso';
        p.innerHTML = `<span class="prog-ico">${icono || '⏳'}</span> ${texto}`;
        panel.querySelector('.prog-pasos').appendChild(p);
        // Auto-scroll al último paso.
        const cont = panel.querySelector('.prog-pasos');
        cont.scrollTop = cont.scrollHeight;
      },
      porcentaje(pct) {
        panel.querySelector('.prog-relleno').style.width = pct + '%';
      },
      cerrar() { panel.hidden = true; }
    };
  }

  // Genera un solo mapa, en el momento, con las capas que ese mapa necesita.
  async function descargarMapa(id) {
    if (!cantonSel) { avisar('Elegí primero un cantón en el panel de la izquierda.'); return; }
    const m = defMapa(id);
    if (!m) return;
    const canton = $('selCanton').value;
    const papel = papelActual().nombre;
    const nom = /^mapa/i.test(m.nombre) ? m.nombre : 'Mapa ' + m.nombre;
    document.title = `${codigoDe(m) ? codigoDe(m) + '. ' : ''}${nom} ${canton} ${papel}`;
    const prog = mostrarProgreso(`Componiendo: ${m.nombre}`);
    prog.paso('Preparando la lámina…', '📐');
    prog.porcentaje(5);
    await new Promise(r => setTimeout(r, 80)); // para que se pinte el panel
    await construirLaminas([id], prog);
    prog.porcentaje(100);
    prog.paso('¡Listo! Abriendo impresión…', '✅');
    await new Promise(r => setTimeout(r, 400));
    prog.cerrar();
    window.print();
  }

  // Cambio de pestaña. El mapa necesita que le avisen cuando vuelve a estar visible.
  function mostrarVista(cual) {
    $('map').hidden = cual !== 'visor';
    $('estructura').hidden = cual !== 'estructura';
    $('datosInec').hidden = cual !== 'datosInec';
    $('matrizPr').hidden = cual !== 'matrizPr';
    // El panel lateral (tablero) solo se muestra en el visor cartográfico.
    const esVisor = cual === 'visor';
    $('panel').hidden = !esVisor;
    $('app').style.gridTemplateColumns = esVisor ? '380px 1fr' : '1fr';
    document.querySelectorAll('.pest').forEach((b) => b.classList.toggle('activa', b.dataset.vista === cual));
    if (cual === 'visor') setTimeout(() => map.invalidateSize(), 60);
    else if (cual === 'estructura') construirEstructura();
    else if (cual === 'datosInec') construirDatosInec();
    else if (cual === 'matrizPr') construirMatrizPr();
    $('pestNota').textContent = cual === 'estructura'
      ? 'Los mapas se generan al momento, no están pre-hechos.'
      : cual === 'matrizPr' ? 'Inventario normativo: es igual para todos los cantones.' : '';
  }
  document.querySelectorAll('.pest').forEach((b) => {
    b.addEventListener('click', () => mostrarVista(b.dataset.vista));
  });

  function limpiarLaminas() { $('laminas').innerHTML = ''; }
  window.addEventListener('afterprint', limpiarLaminas);

  // ---------- datos INEC 2022 + CCSS serie + CCSS pirámides ----------
  let datosInec = null;
  let datosCCSS = null;
  let datosCCSSPir = null; // pirámides completas (1.6 MB, se carga al abrir la pestaña)
  fetch('datos/inec_2022.json').then(r => r.json()).then(d => { datosInec = d; }).catch(() => {});
  fetch('datos/ccss_pob_serie.json').then(r => r.json()).then(d => { datosCCSS = d; }).catch(() => {});

  function construirDatosInec() {
    const cuerpo = $('inecCuerpo');
    if (!cuerpo) return;
    const nombre = $('selCanton') ? $('selCanton').value : '';
    if (!nombre || !datosInec) {
      cuerpo.innerHTML = '<div class="vacia">Elegí un cantón para ver sus datos.</div>';
      return;
    }
    const regs = datosInec.registros;
    const canton = regs.find(r => r.nivel === 'canton' && r.canton === nombre);
    const distritos = regs.filter(r => r.nivel === 'distrito' && r.canton === nombre);
    if (!canton) {
      cuerpo.innerHTML = '<div class="vacia">No hay datos INEC para este cantón.</div>';
      return;
    }

    // helpers
    const fmt = (v, dec) => v == null ? '—' : Number(v).toLocaleString('es-CR', { maximumFractionDigits: dec ?? 0 });
    const pct = (v) => v == null ? '—' : v.toFixed(1) + ' %';
    const barra = (v, max) => {
      const w = max ? Math.min(100, (v / max) * 100) : 0;
      return `<div class="inec-bar"><div style="width:${w.toFixed(0)}%"></div></div>`;
    };

    // ── Tarjetas resumen del cantón ──
    const p = canton.poblacion || {};
    const e = canton.empleo || {};
    const n = canton.nbi || {};
    const v = canton.vivienda || {};
    const ind = canton.indicadores || {};
    const def = canton.deficit || {};

    let html = `<h3 class="inec-seccion">Resumen del cantón: ${nombre}</h3>`;
    html += `<div class="inec-grid">`;

    // Población
    html += `<div class="inec-card">
      <div class="inec-val">${fmt(p.pob_total)}</div><div class="inec-label">Población total</div>
      <div style="font-size:.85em;color:var(--txt2,#666);margin-top:4px">
        ♂ ${fmt(p.hombres)} · ♀ ${fmt(p.mujeres)}
      </div>
    </div>`;

    // Grupos etarios
    html += `<div class="inec-card">
      <div class="inec-val" style="font-size:1.2em">0-14: ${fmt(p.pob_0_14)} · 15-64: ${fmt(p.pob_15_64)} · 65+: ${fmt(p.pob_65_mas)}</div>
      <div class="inec-label">Grupos de edad</div>
    </div>`;

    // NBI
    html += `<div class="inec-card">
      <div class="inec-val" style="color:#c0392b">${pct(n.pct_1mas_carencia)}</div>
      <div class="inec-label">Con al menos 1 carencia (NBI)</div>
      ${barra(n.pct_1mas_carencia, 60)}
    </div>`;

    // Empleo
    html += `<div class="inec-card">
      <div class="inec-val">${pct(e.pct_ocupada)}</div>
      <div class="inec-label">Población ocupada</div>
      <div style="font-size:.85em;color:var(--txt2,#666);margin-top:4px">
        Desocupada: ${pct(e.pct_desocupada)} · Fuera fuerza: ${pct(e.pct_fuera_fuerza)}
      </div>
    </div>`;

    // Vivienda
    html += `<div class="inec-card">
      <div class="inec-val">${fmt(v.viv_total)}</div>
      <div class="inec-label">Viviendas totales</div>
      <div style="font-size:.85em;color:var(--txt2,#666);margin-top:4px">
        Ocupadas: ${fmt(v.viv_ocupadas)} · Desocupadas: ${fmt(v.viv_desocupadas)} · Prom. ocupantes: ${fmt(v.prom_ocupantes, 2)}
      </div>
    </div>`;

    // Indicadores
    html += `<div class="inec-card">
      <div class="inec-val">${pct(ind.pct_extranjeros)}</div>
      <div class="inec-label">Población extranjera</div>
      <div style="font-size:.85em;color:var(--txt2,#666);margin-top:4px">
        Asegurados: ${pct(ind.pct_asegurados)} · Dep. demográfica: ${fmt(ind.dep_demografica, 1)}
      </div>
    </div>`;

    html += `</div>`; // cierra .inec-grid

    // ── Tabla comparativa de distritos ──
    if (distritos.length) {
      const maxPob = Math.max(...distritos.map(d => (d.poblacion || {}).pob_total || 0));

      html += `<h3 class="inec-seccion">Distritos de ${nombre} — comparativa</h3>`;
      html += `<div style="overflow-x:auto">`;
      html += `<table class="inec-tabla">
        <thead><tr>
          <th>Distrito</th>
          <th>Población</th>
          <th></th>
          <th>NBI %</th>
          <th>Ocupada %</th>
          <th>Desocup. %</th>
          <th>Terciario %</th>
          <th>Viviendas</th>
          <th>Déficit</th>
        </tr></thead><tbody>`;

      distritos.sort((a, b) => ((b.poblacion || {}).pob_total || 0) - ((a.poblacion || {}).pob_total || 0));
      for (const d of distritos) {
        const dp = d.poblacion || {};
        const de = d.empleo || {};
        const dn = d.nbi || {};
        const dv = d.vivienda || {};
        const dd = d.deficit || {};
        const barW = maxPob ? ((dp.pob_total || 0) / maxPob * 100).toFixed(0) : 0;
        html += `<tr>
          <td><strong>${d.distrito}</strong></td>
          <td style="text-align:right">${fmt(dp.pob_total)}</td>
          <td style="width:80px"><div class="inec-bar"><div style="width:${barW}%"></div></div></td>
          <td style="text-align:right;color:${(dn.pct_1mas_carencia || 0) > 25 ? '#c0392b' : 'inherit'}">${pct(dn.pct_1mas_carencia)}</td>
          <td style="text-align:right">${pct(de.pct_ocupada)}</td>
          <td style="text-align:right">${pct(de.pct_desocupada)}</td>
          <td style="text-align:right">${pct(de.pct_terciario)}</td>
          <td style="text-align:right">${fmt(dv.viv_total)}</td>
          <td style="text-align:right">${fmt(dd.deficit_cualitativo)}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;

      // ── Densidad habitacional y territorio ──
      const distsConTerritorio = distritos.filter(d => d.territorio);
      if (distsConTerritorio.length) {
        html += `<h3 class="inec-seccion">🗺️ Densidad habitacional y uso del territorio — ${nombre}</h3>`;
        html += `<div style="font-size:.85em;color:var(--txt2,#666);margin-bottom:.8em">
          Área, densidad y tasas de crecimiento según INEC Estimaciones 2022 (Cuadro 12).
        </div>`;

        const maxDens = Math.max(...distsConTerritorio.map(d => d.territorio.densidad || 0));
        html += `<div style="overflow-x:auto"><table class="inec-tabla">
          <thead><tr>
            <th>Distrito</th>
            <th style="text-align:right">Área km²</th>
            <th style="text-align:right">Hab/km²</th>
            <th style="width:80px"></th>
            <th style="text-align:right">Crec. pob. anual</th>
            <th style="text-align:right">Crec. viv. anual</th>
          </tr></thead><tbody>`;
        distsConTerritorio.sort((a, b) => (b.territorio.densidad || 0) - (a.territorio.densidad || 0));
        let areaTotal = 0;
        for (const d of distsConTerritorio) {
          const t = d.territorio;
          areaTotal += t.area_km2 || 0;
          const densW = maxDens ? ((t.densidad || 0) / maxDens * 100).toFixed(0) : 0;
          const crecColor = (t.tasa_crec_pob || 0) < 0 ? '#c0392b' : (t.tasa_crec_pob || 0) > 1.5 ? '#27ae60' : 'inherit';
          html += `<tr>
            <td><strong>${d.distrito}</strong></td>
            <td style="text-align:right">${fmt(t.area_km2, 1)}</td>
            <td style="text-align:right"><strong>${fmt(t.densidad, 0)}</strong></td>
            <td><div class="inec-bar"><div style="width:${densW}%"></div></div></td>
            <td style="text-align:right;color:${crecColor}">${t.tasa_crec_pob != null ? (t.tasa_crec_pob > 0 ? '+' : '') + t.tasa_crec_pob.toFixed(2) + ' %' : '—'}</td>
            <td style="text-align:right">${t.tasa_crec_viv != null ? (t.tasa_crec_viv > 0 ? '+' : '') + t.tasa_crec_viv.toFixed(2) + ' %' : '—'}</td>
          </tr>`;
        }
        // Fila total cantón
        const densCantonProm = p.pob_total && areaTotal ? (p.pob_total / areaTotal) : null;
        html += `<tr style="font-weight:700;border-top:2px solid var(--borde,#ccc)">
          <td>${nombre} (total)</td>
          <td style="text-align:right">${fmt(areaTotal, 1)}</td>
          <td style="text-align:right">${densCantonProm ? fmt(densCantonProm, 0) : '—'}</td>
          <td></td><td></td><td></td>
        </tr>`;
        html += `</tbody></table></div>`;
      }

      // ── NBI por tipo de carencia ──
      html += `<h3 class="inec-seccion">NBI por tipo de carencia — ${nombre}</h3>`;
      html += `<div style="overflow-x:auto">`;
      html += `<table class="inec-tabla">
        <thead><tr>
          <th>Distrito</th>
          <th>1+ carencia</th>
          <th>Albergue digno</th>
          <th>Vida saludable</th>
          <th>Conocimiento</th>
          <th>Otros bienes</th>
        </tr></thead><tbody>`;
      for (const d of distritos) {
        const dn = d.nbi || {};
        html += `<tr>
          <td><strong>${d.distrito}</strong></td>
          <td style="text-align:right">${pct(dn.pct_1mas_carencia)}</td>
          <td style="text-align:right">${pct(dn.carencia_albergue)}</td>
          <td style="text-align:right">${pct(dn.carencia_salud)}</td>
          <td style="text-align:right">${pct(dn.carencia_conocimiento)}</td>
          <td style="text-align:right">${pct(dn.carencia_otros)}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;

      // ── Estructura económica ──
      html += `<h3 class="inec-seccion">Estructura económica — ${nombre}</h3>`;
      html += `<div style="overflow-x:auto">`;
      html += `<table class="inec-tabla">
        <thead><tr>
          <th>Distrito</th>
          <th>% Primario</th>
          <th>% Secundario</th>
          <th>% Terciario</th>
          <th>% Ocupada</th>
          <th>% Desocupada</th>
          <th>% Fuera fuerza</th>
        </tr></thead><tbody>`;
      for (const d of distritos) {
        const de = d.empleo || {};
        html += `<tr>
          <td><strong>${d.distrito}</strong></td>
          <td style="text-align:right">${pct(de.pct_primario)}</td>
          <td style="text-align:right">${pct(de.pct_secundario)}</td>
          <td style="text-align:right">${pct(de.pct_terciario)}</td>
          <td style="text-align:right">${pct(de.pct_ocupada)}</td>
          <td style="text-align:right">${pct(de.pct_desocupada)}</td>
          <td style="text-align:right">${pct(de.pct_fuera_fuerza)}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }

    // ── Serie histórica y proyección CCSS ──
    if (datosCCSS) {
      const distsCCSS = datosCCSS.distritos.filter(d => d.c === nombre);
      if (distsCCSS.length) {
        const anios = datosCCSS.anios;
        const hoy = new Date().getFullYear();
        // Totales del cantón por año (sumar distritos)
        const totCanton = {};
        for (const yr of anios) {
          totCanton[yr] = distsCCSS.reduce((s, d) => s + (d.s[yr] || 0), 0);
        }

        html += `<h3 class="inec-seccion">Población adscrita CCSS · ${nombre} (2019 – 2050)</h3>`;

        // Tarjetas años clave
        const clave = [2019, 2022, 2025, 2030, 2035, 2040, 2045, 2050];
        html += `<div class="inec-grid">`;
        for (const yr of clave) {
          const v = totCanton[yr];
          if (v == null) continue;
          const esProyeccion = yr > hoy;
          html += `<div class="inec-card" style="${esProyeccion ? 'border-left:3px solid #3498db' : ''}">
            <div class="inec-val" style="font-size:1.3em">${fmt(Math.round(v))}</div>
            <div class="inec-label">${yr}${esProyeccion ? ' (proy.)' : ''}</div>
          </div>`;
        }
        html += `</div>`;

        // Tasas de crecimiento
        const tasa = (a, b, n) => n > 0 && a > 0 ? ((Math.pow(b / a, 1 / n) - 1) * 100).toFixed(2) : '—';
        const t19 = totCanton[2019], t25 = totCanton[2025], t30 = totCanton[2030], t50 = totCanton[2050];
        if (t19 && t25 && t30 && t50) {
          html += `<div style="margin:10px 0;font-size:.9em;color:var(--txt2,#555)">
            Tasa de crecimiento anual: 2019→2025: <strong>${tasa(t19, t25, 6)}%</strong> ·
            2025→2030: <strong>${tasa(t25, t30, 5)}%</strong> ·
            2030→2050: <strong>${tasa(t30, t50, 20)}%</strong>
          </div>`;
        }

        // Tabla distritos CCSS
        html += `<div style="overflow-x:auto"><table class="inec-tabla"><thead><tr><th>Distrito</th>`;
        for (const yr of clave) html += `<th style="text-align:right">${yr}</th>`;
        html += `<th style="text-align:right">Cambio 2019–2050</th></tr></thead><tbody>`;

        distsCCSS.sort((a, b) => (b.s[2025] || 0) - (a.s[2025] || 0));
        for (const d of distsCCSS) {
          html += `<tr><td><strong>${d.d}</strong></td>`;
          for (const yr of clave) {
            const v = d.s[yr];
            html += `<td style="text-align:right">${v != null ? fmt(Math.round(v)) : '—'}</td>`;
          }
          const v19 = d.s[2019], v50 = d.s[2050];
          if (v19 && v50) {
            const cambio = ((v50 - v19) / v19 * 100).toFixed(1);
            const color = cambio >= 0 ? '#27ae60' : '#c0392b';
            html += `<td style="text-align:right;color:${color};font-weight:600">${cambio > 0 ? '+' : ''}${cambio}%</td>`;
          } else {
            html += `<td style="text-align:right">—</td>`;
          }
          html += `</tr>`;
        }
        // Fila total cantón
        html += `<tr style="font-weight:700;border-top:2px solid var(--borde,#ccc)"><td>${nombre}</td>`;
        for (const yr of clave) html += `<td style="text-align:right">${fmt(Math.round(totCanton[yr] || 0))}</td>`;
        if (t19 && t50) {
          const cambio = ((t50 - t19) / t19 * 100).toFixed(1);
          html += `<td style="text-align:right">${cambio > 0 ? '+' : ''}${cambio}%</td>`;
        }
        html += `</tr></tbody></table></div>`;
      }
    }

    // ── Proyecciones de demanda para planificación (requiere pirámides CCSS) ──
    if (!datosCCSSPir) {
      // Ofrecer cargar pirámides si no están cargadas aún
      html += `<h3 class="inec-seccion">📐 Proyecciones de demanda para planificación</h3>`;
      html += `<div style="padding:1em;background:var(--fondo2,#f5f5f5);border-radius:8px;margin:.5em 0">
        <p style="margin:0 0 .8em">
          Esta sección muestra demanda proyectada de servicios según la pirámide de edad: escuelas, centros de salud,
          vivienda nueva y ratio de dependencia. Requiere cargar datos adicionales (~1.6 MB).
        </p>
        <button onclick="cargarPiramidesYRender('${nombre.replace(/'/g, "\\'")}')"
          style="background:#2980b9;color:#fff;border:none;padding:.5em 1.2em;border-radius:5px;cursor:pointer;font-size:.95em">
          📊 Cargar proyecciones de demanda
        </button>
      </div>`;
    }

    html += `<p style="margin-top:1.5em;font-size:.8em;color:var(--txt2,#888)">
      Fuentes: INEC — Estimaciones y Proyecciones 2022 (Cuadro 1, 3, 7, 10, 11, 12); CCSS — Dashboard Población Adscrita 2019–2050.
    </p>`;

    cuerpo.innerHTML = html;

    // Si ya hay pirámides cargadas, renderizar demanda
    if (datosCCSSPir) {
      _renderDemandaFutura(nombre);
    }
  }

  // Carga las pirámides completas y vuelve a renderizar la sección de demanda
  window.cargarPiramidesYRender = function(nombreCanton) {
    const btn = document.querySelector('button[onclick^="cargarPiramidesYRender"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Cargando…'; }
    if (datosCCSSPir) {
      construirDatosInec();
      return;
    }
    fetch('datos/ccss_2019_2050.json')
      .then(r => r.json())
      .then(d => {
        datosCCSSPir = d;
        construirDatosInec(); // re-renderiza todo con pirámides disponibles
      })
      .catch(() => {
        if (btn) { btn.disabled = false; btn.textContent = '⚠️ Error al cargar. Reintentar'; }
      });
  };

  // Renderiza la sección de proyecciones de demanda directamente en el DOM
  function _renderDemandaFutura(nombreCanton) {
    if (!datosCCSSPir) return;

    // Grupos de la pirámide: ['0-4','5-9','10-14',...,'90+'] → índices 0-18
    // Niños 0-14: índices 0,1,2  |  Jóvenes 15-24: índices 3,4
    // Adultos formación hogar 25-39: índices 5,6,7  |  Adultos mayores 65+: índices 13-18
    const GRP = datosCCSSPir.grupos; // ['0-4','5-9',...]
    const idx014 = [0, 1, 2];
    const idx1524 = [3, 4];
    const idx2539 = [5, 6, 7];
    const idx65p = GRP.reduce((acc, g, i) => { const a = parseInt(g); if (a >= 65) acc.push(i); return acc; }, []);
    const idxActivo = GRP.reduce((acc, g, i) => { const a = parseInt(g); if (a >= 15 && a < 65) acc.push(i); return acc; }, []);

    const distsCCSSPir = datosCCSSPir.distritos.filter(d => d.canton === nombreCanton);
    if (!distsCCSSPir.length) return;

    // Sumar pirámide del cantón para años clave
    const aniosDem = [2025, 2030, 2035, 2040, 2045, 2050];
    const pirCanton = {}; // { 2025: [sum0, sum1, ...sum18], ... }
    const totalesAnio = {};
    for (const yr of aniosDem) {
      const yrStr = String(yr);
      const sumGrupos = new Array(GRP.length).fill(0);
      let tot = 0;
      for (const d of distsCCSSPir) {
        const serie = d.series && d.series[yrStr];
        if (!serie || !serie.pir) continue;
        for (let i = 0; i < GRP.length; i++) sumGrupos[i] += (serie.pir[i] || 0);
        tot += serie.pob || 0;
      }
      pirCanton[yr] = sumGrupos;
      totalesAnio[yr] = tot || sumGrupos.reduce((s, x) => s + x, 0);
    }

    // Calcular indicadores por año
    const sumIdx = (arr, idxList) => idxList.reduce((s, i) => s + (arr[i] || 0), 0);
    const demanda = {};
    for (const yr of aniosDem) {
      const pir = pirCanton[yr];
      const tot = totalesAnio[yr] || 1;
      const ninos = sumIdx(pir, idx014);
      const jovenes = sumIdx(pir, idx1524);
      const form = sumIdx(pir, idx2539);     // cohorte formación de hogar
      const adultosMay = sumIdx(pir, idx65p);
      const activos = sumIdx(pir, idxActivo);
      const dependientes = ninos + adultosMay;
      demanda[yr] = {
        pob: tot,
        ninos,         // demanda educación + cuido
        jovenes,       // demanda educación superior + empleo inicial
        form,          // demanda vivienda nueva
        adultosMay,    // demanda servicios salud + vivienda asistida
        activos,
        dependientes,
        ratio_dep: activos > 0 ? (dependientes / activos * 100) : 0,
        pct_014: tot > 0 ? (ninos / tot * 100) : 0,
        pct_65p: tot > 0 ? (adultosMay / tot * 100) : 0,
        pct_form: tot > 0 ? (form / tot * 100) : 0,
      };
    }

    const hoy = new Date().getFullYear();
    const fmt2 = (v, dec) => v == null ? '—' : Number(v).toLocaleString('es-CR', { maximumFractionDigits: dec ?? 0 });

    let bloque = `<h3 class="inec-seccion">📐 Proyecciones de demanda para planificación · ${nombreCanton}</h3>`;
    bloque += `<div style="font-size:.85em;color:var(--txt2,#666);margin-bottom:.8em">
      Calculado a partir de la pirámide de edad CCSS 2019–2050.
      <strong>Años con borde azul</strong> = proyección.
    </div>`;

    // Tarjetas explicativas del ratio de dependencia
    bloque += `<div class="inec-grid">`;
    for (const yr of aniosDem) {
      const d = demanda[yr];
      if (!d) continue;
      const esProy = yr > hoy;
      const ratioColor = d.ratio_dep > 55 ? '#c0392b' : d.ratio_dep > 42 ? '#e67e22' : '#27ae60';
      bloque += `<div class="inec-card" style="${esProy ? 'border-left:3px solid #3498db' : ''}">
        <div class="inec-val" style="font-size:1.4em;color:${ratioColor}">${d.ratio_dep.toFixed(1)}</div>
        <div class="inec-label">Ratio depend. ${yr}${esProy ? ' (proy.)' : ''}</div>
        <div style="font-size:.8em;color:var(--txt2,#666);margin-top:3px">
          Dependientes por cada 100 activos
        </div>
      </div>`;
    }
    bloque += `</div>`;
    bloque += `<div style="font-size:.8em;color:var(--txt2,#666);margin:.4em 0 1em">
      🟢 &lt;42 sostenible · 🟡 42–55 en transición · 🔴 &gt;55 presión alta sobre servicios públicos
    </div>`;

    // Tabla principal de indicadores
    bloque += `<div style="overflow-x:auto"><table class="inec-tabla">
      <thead><tr>
        <th>Indicador</th>`;
    for (const yr of aniosDem) bloque += `<th style="text-align:right">${yr}${yr > hoy ? ' ★' : ''}</th>`;
    bloque += `</tr></thead><tbody>`;

    const filas = [
      { label: '👶 Niños 0–14 (demanda cuido y escuela)', key: 'ninos' },
      { label: '   % de la población', key: 'pct_014', pct: true },
      { label: '🎓 Jóvenes 15–24 (empleo + ed. superior)', key: 'jovenes' },
      { label: '🏘️ Cohorte formación hogar 25–39 (vivienda nueva)', key: 'form' },
      { label: '   % de la población', key: 'pct_form', pct: true },
      { label: '🧓 Adultos mayores 65+ (salud + vivienda asistida)', key: 'adultosMay' },
      { label: '   % de la población', key: 'pct_65p', pct: true },
      { label: '⚖️ Ratio de dependencia (depend/activos × 100)', key: 'ratio_dep', dec: 1 },
    ];

    for (const fila of filas) {
      bloque += `<tr><td>${fila.label}</td>`;
      let prev = null;
      for (const yr of aniosDem) {
        const val = demanda[yr] ? demanda[yr][fila.key] : null;
        let arrow = '';
        if (prev != null && val != null) {
          arrow = val > prev * 1.02 ? ' <span style="color:#27ae60">↑</span>' :
                  val < prev * 0.98 ? ' <span style="color:#c0392b">↓</span>' : '';
        }
        const str = val == null ? '—' : fila.pct ? val.toFixed(1) + ' %' : fmt2(Math.round(val), fila.dec || 0);
        bloque += `<td style="text-align:right">${str}${arrow}</td>`;
        prev = val;
      }
      bloque += `</tr>`;
    }
    bloque += `</tbody></table></div>`;
    bloque += `<div style="font-size:.8em;color:var(--txt2,#666);margin-top:.5em">★ = año proyectado por CCSS</div>`;

    // Interpretación automática
    const d25 = demanda[2025], d50 = demanda[2050];
    if (d25 && d50) {
      const cambNinos = ((d50.ninos - d25.ninos) / d25.ninos * 100).toFixed(1);
      const cambMay   = ((d50.adultosMay - d25.adultosMay) / d25.adultosMay * 100).toFixed(1);
      const cambForm  = ((d50.form - d25.form) / d25.form * 100).toFixed(1);
      bloque += `<div style="background:var(--fondo2,#f5f5f5);border-radius:8px;padding:1em;margin-top:1em;font-size:.9em">
        <strong>🔍 Lectura para planificación territorial (2025 → 2050):</strong>
        <ul style="margin:.5em 0 0 1.2em;padding:0;line-height:1.8">
          <li>Niños 0–14: <strong>${d25.ninos.toLocaleString('es-CR')} → ${d50.ninos.toLocaleString('es-CR')}</strong> (${cambNinos > 0 ? '+' : ''}${cambNinos}%) —
            ${parseFloat(cambNinos) < -15 ? 'se libera capacidad en escuelas; oportunidad de reconvertir instalaciones educativas' :
              parseFloat(cambNinos) > 15 ? 'crecimiento de demanda escolar; prever nuevos centros y cuido' : 'demanda escolar relativamente estable'}.
          </li>
          <li>Adultos mayores 65+: <strong>${d25.adultosMay.toLocaleString('es-CR')} → ${d50.adultosMay.toLocaleString('es-CR')}</strong> (${cambMay > 0 ? '+' : ''}${cambMay}%) —
            ${parseFloat(cambMay) > 50 ? 'envejecimiento acelerado; prever EBAIS reforzados, hogares diurnos y vivienda accesible' :
              parseFloat(cambMay) > 20 ? 'crecimiento moderado de adultos mayores; reforzar servicios de salud preventiva' : 'presión baja sobre servicios para adultos mayores'}.
          </li>
          <li>Cohorte de vivienda 25–39: <strong>${d25.form.toLocaleString('es-CR')} → ${d50.form.toLocaleString('es-CR')}</strong> (${cambForm > 0 ? '+' : ''}${cambForm}%) —
            ${parseFloat(cambForm) < -20 ? 'contracción fuerte de la demanda de vivienda nueva; revisar cuotas de densificación' :
              parseFloat(cambForm) > 10 ? 'presión sostenida sobre mercado de vivienda nueva' : 'demanda de vivienda relativamente estable'}.
          </li>
          <li>Ratio de dependencia: <strong>${d25.ratio_dep.toFixed(1)} → ${d50.ratio_dep.toFixed(1)}</strong> —
            ${d50.ratio_dep > 55 ? 'presión fiscal alta; más personas dependientes por cada contribuyente activo' :
              d50.ratio_dep > d25.ratio_dep ? 'tendencia al envejecimiento, aunque manejable' : 'estructura demográfica mejora en el período'}.
          </li>
        </ul>
      </div>`;
    }

    // Insertar bloque en el DOM después del último hijo del cuerpo
    const cuerpo = $('inecCuerpo');
    if (cuerpo) {
      const temp = document.createElement('div');
      temp.innerHTML = bloque;
      while (temp.firstChild) cuerpo.appendChild(temp.firstChild);
    }
  }

  $('btnAtlas').addEventListener('click', async () => {
    if (!cantonSel) { avisar('Elegí un cantón primero.'); return; }
    // Seleccionar automáticamente TODOS los mapas imprimibles
    seleccion.clear();
    catalogo.instituciones.forEach((inst) => inst.mapas.forEach((m) => {
      if (sePuedeImprimir(m)) seleccion.add(m.id);
    }));
    if (!seleccion.size) { avisar('No hay mapas disponibles para generar.'); return; }
    const canton = $('selCanton').value;
    const papel = papelActual().nombre;
    document.title = `Atlas Cartográfico — Plan Regulador ${canton} ${papel}`;
    $('btnAtlas').disabled = true;
    avisar(`Preparando atlas completo: ${seleccion.size} láminas en ${papel}…`);
    await construirLaminas();
    window.print();
    $('btnAtlas').disabled = false;
  });

  /* ---------- matriz del Plan Regulador ----------
     Inventario de todo lo que pide la normativa (87 mapas, 32 insumos) contra lo que
     realmente tenemos cargado. No depende del cantón: es el marco normativo, igual
     para los 82. Tres vistas: mapas por eje, insumos y geoservicios por conectar. */
  let datosMatriz = null;
  let mprVista = 'mapas';

  function construirMatrizPr() {
    const cuerpo = $('mprCuerpo');
    if (!cuerpo) return;
    if (!datosMatriz) {
      cuerpo.innerHTML = '<div class="vacia">Cargando matriz…</div>';
      fetch('datos/matriz_pr.json')
        .then((r) => r.json())
        .then((d) => { datosMatriz = d; construirMatrizPr(); })
        .catch(() => { cuerpo.innerHTML = '<div class="vacia">No se pudo cargar la matriz.</div>'; });
      return;
    }
    pintarResumenMatriz();
    if (mprVista === 'mapas') cuerpo.innerHTML = vistaMatrizMapas();
    else if (mprVista === 'insumos') cuerpo.innerHTML = vistaMatrizInsumos();
    else cuerpo.innerHTML = vistaMatrizVisores();
  }

  // Los chips de arriba cuentan los mapas por estado y sirven de leyenda.
  function pintarResumenMatriz() {
    const cont = $('mprResumen');
    if (!cont || !datosMatriz) return;
    const cuenta = {};
    let total = 0;
    for (const b of datosMatriz.bloques)
      for (const c of b.componentes)
        for (const m of c.mapas) { cuenta[m.estado] = (cuenta[m.estado] || 0) + 1; total++; }
    const ordenados = Object.entries(datosMatriz.estados).sort((a, b) => a[1].orden - b[1].orden);
    let h = `<span class="est-chip"><b>${total}</b> mapas</span>`;
    for (const [clave, def] of ordenados) {
      if (!cuenta[clave]) continue;
      h += `<span class="est-chip" style="color:${def.color}">${def.icono} <b>${cuenta[clave]}</b> ${def.label}</span>`;
    }
    cont.innerHTML = h;
  }

  function mprEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function mprPill(clave) {
    const def = datosMatriz.estados[clave];
    if (!def) return '';
    return `<span class="mpr-estado" style="color:${def.color}">${def.icono} ${mprEsc(def.label)}</span>`;
  }

  // Vista 1 — los 87 mapas agrupados por bloque (etapa) y componente (eje).
  function vistaMatrizMapas() {
    const criticos = new Set(datosMatriz.insumos.filter((i) => i.critico).map((i) => i.cod));
    const nombreIns = {};
    datosMatriz.insumos.forEach((i) => { nombreIns[i.cod] = i.nombre; });
    let h = '';
    for (const b of datosMatriz.bloques) {
      h += `<div class="mpr-bloque">
        <div class="mpr-bloque-cab">
          <h3>${b.icono} Bloque ${mprEsc(b.cod)} · ${mprEsc(b.nombre)}
            <span class="mpr-etapa">${mprEsc(b.etapa)}</span></h3>
          <p>${mprEsc(b.desc)}</p>
        </div>`;
      for (const c of b.componentes) {
        h += `<div class="mpr-comp"><div class="mpr-comp-tit">${mprEsc(c.nombre)}</div>`;
        for (const m of c.mapas) {
          const ins = (m.insumos || []).map((cod) =>
            `<span class="${criticos.has(cod) ? 'crit' : ''}" title="${mprEsc(cod + ' — ' + (nombreIns[cod] || ''))}">${cod}</span>`).join('');
          h += `<div class="mpr-fila">
            <div class="mpr-cod">${mprEsc(m.cod)}</div>
            <div>
              <div class="mpr-nom">${mprEsc(m.nombre)}${m.guia_invu ? '<span class="mpr-guia">Guía INVU</span>' : ''}</div>
              ${m.nota ? `<div class="mpr-nota">${mprEsc(m.nota)}</div>` : ''}
              ${ins ? `<div class="mpr-ins">${ins}</div>` : ''}
            </div>
            <div>${mprPill(m.estado)}</div>
          </div>`;
        }
        h += `</div>`;
      }
      h += `</div>`;
    }
    return h;
  }

  // Vista 2 — los 32 insumos: qué tenemos de cada uno y cómo conseguir el resto.
  function vistaMatrizInsumos() {
    // Cuántos mapas dependen de cada insumo: así se ve cuál destraba más trabajo.
    const usos = {};
    for (const b of datosMatriz.bloques)
      for (const c of b.componentes)
        for (const m of c.mapas)
          for (const cod of (m.insumos || [])) usos[cod] = (usos[cod] || 0) + 1;

    let h = `<p style="font-size:12px;color:var(--muted);margin:0 0 14px;max-width:80ch">
      Los cinco insumos marcados <span class="mpr-badge-crit">crítico</span> son los que el desglose
      señala como cuello de botella: no existen a escala de plan regulador o están repartidos entre
      instituciones. El número de mapas indica cuánto trabajo destraba cada uno.</p>`;

    for (const i of datosMatriz.insumos) {
      h += `<div class="mpr-ficha ${i.critico ? 'critico' : ''}">
        <h4><span class="mpr-cod">${mprEsc(i.cod)}</span> ${mprEsc(i.nombre)}
          ${i.critico ? '<span class="mpr-badge-crit">crítico</span>' : ''}
          ${mprPill(i.estado)}
          ${usos[i.cod] ? `<span class="est-chip" style="font-size:10px;padding:1px 7px">alimenta ${usos[i.cod]} mapa${usos[i.cod] > 1 ? 's' : ''}</span>` : ''}
        </h4>
        <p class="fuente">${mprEsc(i.fuente)} · vía ${mprEsc(i.via)} · dificultad ${mprEsc(i.dificultad)}</p>
        <div class="mpr-dato"><b>Qué tenemos:</b> ${mprEsc(i.tenemos)}</div>
        <div class="mpr-dato"><b>Cómo obtenerlo:</b> ${mprEsc(i.como)}</div>
        ${i.endpoint ? `<div class="mpr-dato"><a class="mpr-link" href="${mprEsc(i.endpoint)}" target="_blank" rel="noopener">${mprEsc(i.endpoint)}</a></div>` : ''}
      </div>`;
    }
    return h;
  }

  // Vista 3 — los visores y geoservicios revisados, ordenados por lo que destraban.
  function vistaMatrizVisores() {
    const nombreIns = {};
    datosMatriz.insumos.forEach((i) => { nombreIns[i.cod] = i.nombre; });
    let h = `<p style="font-size:12px;color:var(--muted);margin:0 0 14px;max-width:80ch">
      Visores y geoservicios revisados, en orden de lo que resuelven. Los primeros cuatro cierran
      vacíos que el desglose daba por difíciles; los dos últimos son municipalidades que ya publican
      su plan regulador como servicios y sirven de referencia.</p>`;
    for (const v of datosMatriz.visores) {
      const aporta = (v.aporta || []).map((cod) =>
        `<span title="${mprEsc(nombreIns[cod] || '')}">${cod}</span>`).join('');
      h += `<div class="mpr-ficha">
        <h4>${mprEsc(v.nombre)}
          <span class="est-chip" style="font-size:10px;padding:1px 7px">${mprEsc(v.tipo)}</span>
        </h4>
        <div class="mpr-dato">${mprEsc(v.detalle)}</div>
        ${aporta ? `<div class="mpr-dato"><b>Insumos que aporta:</b> <span class="mpr-ins" style="display:inline-flex">${aporta}</span></div>` : ''}
        <div class="mpr-dato" style="color:var(--muted)">${mprEsc(v.nota)}</div>
        ${(v.endpoints || []).map((e) => {
          // Los endpoints vienen como "WMS: http://…". Se quita la etiqueta solo si hay
          // un espacio después de los dos puntos, para no mutilar el "https://" de la URL.
          const url = e.replace(/^[A-Za-z]+:[ \t]+/, '');
          return `<div class="mpr-dato"><a class="mpr-link" href="${mprEsc(url)}" target="_blank" rel="noopener">${mprEsc(e)}</a></div>`;
        }).join('')}
      </div>`;
    }
    return h;
  }

  document.querySelectorAll('.mpr-tab').forEach((b) => {
    b.addEventListener('click', () => {
      mprVista = b.dataset.mpr;
      document.querySelectorAll('.mpr-tab').forEach((o) => o.classList.toggle('activa', o === b));
      construirMatrizPr();
    });
  });
})();
