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
    'mapas.cne.go.cr', 'geoserver.mag.go.cr', 'www.snitcr.go.cr', 'snitcr.go.cr'
  ]);
  function viaProxy(url) {
    try {
      const h = new URL(url).hostname;
      if (HOSTS_PROXY.has(h)) return '/geoproxy?url=' + encodeURIComponent(url);
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

  const [cap, catalogo, escudosDoc, simbDoc] = await Promise.all([
    fetch('capas.json').then((r) => r.json()),
    fetch('mapas_oficiales.json').then((r) => r.json()),
    fetch('escudos.json').then((r) => r.json()).catch(() => ({ escudos: {} })),
    fetch('simbologia.json').then((r) => r.json())
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

  // Escala de fragilidad del IFA (decreto 44710), para mostrarla en la leyenda.
  const RAMPA_IFA = [
    ['1 · Muy alta fragilidad', '#f09cba'], ['2 · Alta', '#f5a623'], ['3 · Moderada', '#eedb5d'],
    ['4 · Baja', '#aecf8a'], ['5 · Muy baja', '#5e9150']
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

  // ---------- datos de una capa, recortados al cantón (con cache) ----------
  async function obtenerDatos(nombre) {
    if (datosCapa.has(nombre)) return datosCapa.get(nombre);
    const c = capaPorNombre[nombre];
    let fc = null;
    if (c && c.archivo && !c.archivo.startsWith('api:')) {
      let url, recortar;
      if (c.filtrar_canton) { url = urlConBbox(c.archivo, bboxDe(cantonSel)); recortar = false; }
      else { url = c.archivo; recortar = true; }
      try {
        const data = await fetch(viaProxy(url)).then((r) => { if (!r.ok) throw 0; return r.json(); });
        fc = recortar ? soloCanton(data) : data;
      } catch (e) { fc = null; }
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
  // Capas de insumo de un mapa que existen de verdad en capas.json y se pueden dibujar.
  function insumosReales(id) {
    const m = defMapa(id);
    return (m?.insumos || []).filter((n) => {
      const c = capaPorNombre[n];
      return c && c.archivo && !String(c.archivo).startsWith('api:');
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
      const tieneIntegrado = inst.integrado && sePuedeImprimir(defMapa(inst.integrado) || {});
      g.innerHTML = `
        <div class="grupo-cab">
          <span class="chev">▶</span><span class="emoji">${inst.icono || '🗺'}</span>
          <span class="nom">${inst.nombre}</span>
          <span class="cuenta"></span>
          ${tieneIntegrado ? `<button class="ctrl imp eje" title="Marcar el mapa integrado de este eje para imprimir">${ICO.imp}</button>` : ''}
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
          <button class="ctrl imp" ${impOk ? '' : 'disabled'} title="${impOk ? 'Incluir en el PDF' : 'Todavía no se puede generar'}">${ICO.imp}</button>
          <div class="cuerpo">
            <div class="titulo"><b>${m.numero || ''}</b> ${m.nombre}
              <span class="badge ${m.estado}">${m.estado}</span>
              ${m.solo_pdf ? '<span class="badge pdf">solo PDF</span>' : ''}</div>
            <div class="desc">${m.descripcion}</div>
            ${m.faltante ? `<div class="falta">Falta: ${m.faltante}</div>` : ''}
          </div>`;
        const btnOjo = fila.querySelector('.ojo');
        const btnImp = fila.querySelector('.imp');
        if (verOk) btnOjo.addEventListener('click', () => verMapa(m.id));
        if (impOk) btnImp.addEventListener('click', () => marcarImprimir(m.id));
        refFilasMapa[m.id] = { fila, btnOjo, btnImp };
        cuerpo.appendChild(fila);
      });

      const btnEje = g.querySelector('.ctrl.eje');
      if (btnEje) {
        btnEje.addEventListener('click', (ev) => {
          ev.stopPropagation();           // no abre ni cierra el grupo
          marcarImprimir(inst.integrado);
        });
      }
      refGrupos.push({ inst, el: g, cuenta: g.querySelector('.cuenta'), btnEje });
      catEl.appendChild(g);
    });
  }

  // ---------- ver / imprimir ----------
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
    const r = refFilasMapa[id];
    if (r) r.btnImp.classList.toggle('on', on);
    // El botón del encabezado del eje marca el mismo mapa integrado: se mantienen sincronizados.
    refGrupos.forEach((g) => { if (g.btnEje && g.inst.integrado === id) g.btnEje.classList.toggle('on', on); });
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
    const n = seleccion.size;
    $('resumen').innerHTML = n ? `<b>${n}</b> mapa${n === 1 ? '' : 's'} marcado${n === 1 ? '' : 's'} para imprimir` : '';
    refGrupos.forEach(({ inst, cuenta }) => {
      const m = inst.mapas.filter((x) => seleccion.has(x.id)).length;
      cuenta.textContent = m ? `${m} 🖨` : '';
    });
    const cb = $('cuentaBase');
    if (cb) cb.textContent = baseVisibles.size ? `${baseVisibles.size} visibles` : '';
  }
  function actualizarExport() {
    const listo = cantonSel && seleccion.size > 0;
    $('btnConfig').disabled = !listo;
    $('btnAtlas').disabled = !listo;
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
    });
    if (mapaVisto) {
      const m = defMapa(mapaVisto);
      h += `<div class="tit-mapa">${m.numero} ${m.nombre}</div>`;
      insumosReales(mapaVisto).forEach((n) => {
        const cargada = !!layerLookup[n];
        h += `<div class="lg">${muestraHTML(n)}<span${cargada ? '' : ' class="vacia"'}>${n}${cargada ? '' : ' (cargando…)'}</span></div>`;
      });
    }
    const hayIFA = [...seleccion].some((id) => (defMapa(id) || {}).solo_pdf);
    if (hayIFA) {
      h += '<div class="tit-mapa">Fragilidad ambiental (en el PDF)</div>';
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
    const nombres = [...new Set(baseCantones.features.map((f) => f.properties.k))].sort();
    const sel = $('selCanton');
    nombres.forEach((n) => sel.insertAdjacentHTML('beforeend', `<option value="${n}">${n}</option>`));
    sel.addEventListener('change', () => {
      if (!sel.value) { cantonSel = null; habilitarCatalogo(false); actualizarExport(); actualizarLeyenda(); return; }
      cantonSel = baseCantones.features.find((f) => f.properties.k === sel.value) || null;
      if (!cantonSel) return;
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
    });
  }

  // ---------- tamaño de papel ----------
  // Carta 8.5×11in; A3 297×420mm; A2 420×594mm. k = ancho / ancho de Carta: con él crecen
  // tipografías, cajetín y grosores de línea, y el mapa se dibuja más grande (más nitidez).
  const PAPELES = {
    'Carta': { w: 8.5, h: 11, css: 'letter' },
    'A3': { w: 11.69, h: 16.54, css: 'A3' },
    'A2': { w: 16.54, h: 23.39, css: 'A2' }
  };
  function papelActual() {
    const nombre = $('selPapel').value;
    const p = PAPELES[nombre] || PAPELES['Carta'];
    return Object.assign({ nombre, k: p.w / 8.5 }, p);
  }
  function aplicarPapel() {
    const p = papelActual();
    const l = $('laminas');
    l.style.setProperty('--pw', p.w + 'in');
    l.style.setProperty('--ph', p.h + 'in');
    l.style.setProperty('--k', p.k.toFixed(4));
    $('estiloPapel').textContent = `@page { size: ${p.css}; margin: 0; }`;
  }
  $('selPapel').addEventListener('change', aplicarPapel);
  aplicarPapel();

  // ---------- exportar configuración ----------
  function configActual() {
    return {
      municipalidad: muniNombreVal || null,
      logo: muniLogo,
      canton: $('selCanton').value || null,
      proyeccion: catalogo.proyeccion,
      papel: papelActual().nombre,
      capas_base: [...baseVisibles],
      mapas: [...seleccion],
      generado: new Date().toISOString().slice(0, 10)
    };
  }
  $('btnReset').addEventListener('click', () => location.reload());

  $('btnConfig').addEventListener('click', () => {
    const cfg = configActual();
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `atlas_${(cfg.canton || 'canton').toLowerCase().replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    avisar('Configuración descargada. Usala con: python3 scripts/build_atlas.py --config <archivo>');
  });

  // ---------- imprimir: una lámina por mapa marcado ----------
  let laminasMapas = [];
  let laminasInsets = [];
  async function construirLaminas() {
    const cont = $('laminas');
    cont.innerHTML = '';
    laminasMapas.forEach((m) => m.remove());
    laminasInsets.forEach((m) => m.remove());
    laminasMapas = []; laminasInsets = [];

    const papel = papelActual();
    const k = papel.k;
    const muni = muniNombreVal || ('Municipalidad de ' + $('selCanton').value);
    const canton = $('selCanton').value;
    const hoy = new Date().toLocaleDateString('es-CR');
    // En el orden del catálogo, no en el orden en que se fueron marcando.
    const ids = [];
    catalogo.instituciones.forEach((inst) => inst.mapas.forEach((m) => { if (seleccion.has(m.id)) ids.push(m.id); }));
    const total = ids.length;

    for (let i = 0; i < ids.length; i++) {
      const m = defMapa(ids[i]);
      if (!m) continue;
      const lam = document.createElement('div');
      lam.className = 'lamina';
      const idMapa = `lam-mapa-${i}`;
      lam.innerHTML = `
        <div class="lam-cab">
          <div class="lam-tit-wrap">
            <div class="lam-titulo">${m.numero ? m.numero + ' ' : ''}${m.nombre}</div>
            <div class="lam-subtit">Plan de Ordenamiento Territorial del cantón de ${canton}</div>
          </div>
          <span class="lam-inst">${m.institucion}</span>
        </div>
        <div class="lam-mapa-wrap">
          <div class="lam-mapa" id="${idMapa}"></div>
          <div class="lam-inset" id="ins-${i}"><div class="lam-inset-tit">Ubicación del cantón</div></div>
        </div>
        <div class="lam-caj">
          <div class="caj-simb">
            <div class="caj-rot">Simbología</div>
            <div class="caj-leyenda" id="ley-${i}"></div>
          </div>
          <div class="caj-ident">
            <div class="caj-escudo">${muniLogo ? `<img src="${muniLogo}">` : ''}</div>
            <div>
              <div class="caj-muni">${muni}</div>
              <div class="caj-mapa">${m.nombre}</div>
              <div class="caj-elab"><span>Elaborado por</span><img src="planoexacto.png" class="caj-pe"></div>
            </div>
          </div>
          <div class="caj-norte"><div class="flecha">▲</div><div>N</div></div>
          <div class="caj-tabla">
            <div><b>Proyección</b><br>CRTM05 (EPSG:5367)</div>
            <div><b>Fuente</b><br>SNIT · CNE · SINAC · IGN</div>
            <div class="caj-fila">
              <span><b>Escala</b><br><span class="caj-escala" id="esc-${i}">gráfica</span></span>
              <span><b>Fecha</b><br>${hoy}</span>
              <span><b>Lámina</b><br>${i + 1} / ${total}</span>
            </div>
            <div><b>Papel</b> ${papel.nombre}</div>
          </div>
        </div>`;
      cont.appendChild(lam);

      // renderer SVG explícito: vectorial puro, que es lo que da nitidez en el PDF.
      const lm = L.map(idMapa, { zoomControl: false, attributionControl: false, dragging: false,
                                 scrollWheelZoom: false, doubleClickZoom: false,
                                 preferCanvas: false, renderer: L.svg({ padding: 0.5 }) });
      laminasMapas.push(lm);
      configurarPanes(lm);

      // Capas: las base prendidas + las del mapa, con la misma simbología de la pantalla.
      const leyenda = [['Límite cantonal', 'Límites cantonales']];
      const nombres = [];
      baseVisibles.forEach((n) => { if (capaPorNombre[n]) nombres.push(n); });
      insumosReales(ids[i]).forEach((n) => { if (!nombres.includes(n)) nombres.push(n); });
      for (const nombre of nombres) {
        const fc = await obtenerDatos(nombre);
        if (fc && fc.features && fc.features.length) {
          capaGeoJSON(nombre, fc, { escala: k }).addTo(lm);
          leyenda.push([nombre, nombre]);
        }
      }
      // Máscara: tapa en gris lo que se sale del cantón.
      ponerMascara(lm, cantonSel, '#ececec');
      // Cantones vecinos: solo el contorno y el rótulo, sobre el gris.
      vecinosDe(cantonSel).forEach((v) => {
        L.geoJSON(v, { pane: 'encima', interactive: false,
                       style: { color: '#bcbcbc', weight: 0.5 * k, fill: false } }).addTo(lm);
        try {
          const ctr = turf.centroid(v).geometry.coordinates;
          L.marker([ctr[1], ctr[0]], { interactive: false, icon: L.divIcon({
            className: 'rot-vecino', html: String(v.properties.k).toUpperCase(),
            iconSize: [80 * k, 12 * k], iconAnchor: [40 * k, 6 * k] }) }).addTo(lm);
        } catch (e) { /* sin rótulo */ }
      });
      // Límite cantonal rojo punteado, encima de todo.
      L.geoJSON(cantonSel, { pane: 'encima', interactive: false,
        style: { color: '#d11a1a', weight: 1.5 * k, dashArray: `${6 * k} ${3 * k}`, fill: false } }).addTo(lm);
      // Simbología del cajetín, con la forma de cada geometría.
      $(`ley-${i}`).innerHTML = leyenda.map(([etiqueta, capa]) =>
        `<div class="ley-item">${muestraHTML(capa, 'ley-color')}${etiqueta}</div>`).join('');
      L.control.scale({ imperial: false, position: 'bottomright', maxWidth: 140 * k }).addTo(lm);
      lm.fitBounds(L.geoJSON(cantonSel).getBounds(), { padding: [10 * k, 10 * k] });

      // Recuadro de ubicación: el país en gris con el cantón en rojo.
      if (cantonesTodos) {
        const ins = L.map(`ins-${i}`, { zoomControl: false, attributionControl: false, dragging: false,
                                        scrollWheelZoom: false, doubleClickZoom: false, keyboard: false,
                                        boxZoom: false, renderer: L.svg({ padding: 0.5 }) });
        laminasInsets.push(ins);
        L.geoJSON(cantonesTodos, { style: { color: '#c4c4c4', weight: 0.3 * k, fillColor: '#ededed', fillOpacity: 1 }, interactive: false }).addTo(ins);
        L.geoJSON(cantonSel, { style: { color: '#d11a1a', weight: 0.6 * k, fillColor: '#d11a1a', fillOpacity: 1 }, interactive: false }).addTo(ins);
      }
    }
    // Deja que los mapas tomen tamaño antes de imprimir.
    await new Promise((res) => setTimeout(res, 400));
    laminasMapas.forEach((lm) => { lm.invalidateSize(); lm.fitBounds(L.geoJSON(cantonSel).getBounds(), { padding: [10 * k, 10 * k] }); });
    const boundsPais = cantonesTodos ? L.geoJSON(cantonesTodos).getBounds() : null;
    laminasInsets.forEach((ins) => { ins.invalidateSize(); if (boundsPais) ins.fitBounds(boundsPais, { padding: [3, 3] }); });
    await new Promise((res) => setTimeout(res, 350));
  }

  function limpiarLaminas() {
    laminasMapas.forEach((m) => m.remove());
    laminasInsets.forEach((m) => m.remove());
    laminasMapas = []; laminasInsets = [];
    $('laminas').innerHTML = '';
  }
  window.addEventListener('afterprint', limpiarLaminas);

  $('btnAtlas').addEventListener('click', async () => {
    if (!cantonSel || !seleccion.size) { avisar('Elegí un cantón y marcá al menos un mapa con 🖨.'); return; }
    const canton = $('selCanton').value;
    const papel = papelActual().nombre;
    if (seleccion.size === 1) {
      const m = defMapa([...seleccion][0]);
      const nom = m ? (/^mapa/i.test(m.nombre) ? m.nombre : 'Mapa ' + m.nombre) : 'Mapa';
      document.title = `${m && m.numero ? m.numero + '. ' : ''}${nom} ${canton} ${papel}`;
    } else {
      document.title = `Atlas ${canton} — ${seleccion.size} mapas ${papel}`;
    }
    $('btnAtlas').disabled = true;
    avisar(`Preparando ${seleccion.size} lámina(s) en ${papel}…`);
    await construirLaminas();
    window.print();
    $('btnAtlas').disabled = false;
  });
})();
