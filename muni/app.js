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
      try {
        const data = await fetch(viaProxy(url)).then((r) => { if (!r.ok) throw 0; return r.json(); });
        const bruto = aFeatureCollection(data);
        fc = recortar ? soloCanton(bruto) : bruto;
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

  // ---------- imprimir: una lámina por mapa marcado ----------
  async function construirLaminas() {
    const cont = $('laminas');
    cont.innerHTML = '';

    const papel = papelActual();
    const k = papel.k;
    const muni = muniNombreVal || ('Municipalidad de ' + $('selCanton').value);
    const canton = $('selCanton').value;
    const hoy = new Date().toLocaleDateString('es-CR');
    // En el orden del catálogo, no en el orden en que se fueron marcando.
    const ids = [];
    catalogo.instituciones.forEach((inst) => inst.mapas.forEach((m) => { if (seleccion.has(m.id)) ids.push(m.id); }));
    const total = ids.length;

    const partesCanton = partesDe(cantonSel.geometry);
    const cajaCanton = cajaMerc([cantonSel]);
    const [, latMin, , latMax] = bboxDe(cantonSel);
    const latMedia = (latMin + latMax) / 2;
    const vecinos = vecinosDe(cantonSel);

    // 1) Se arma el esqueleto de todas las láminas, para poder medir el área del mapa.
    for (let i = 0; i < ids.length; i++) {
      const m = defMapa(ids[i]);
      if (!m) continue;
      const lam = document.createElement('div');
      lam.className = 'lamina';
      lam.innerHTML = `
        <div class="lam-cab">
          <div class="lam-tit-wrap">
            <div class="lam-titulo">${m.numero ? m.numero + ' ' : ''}${esc(m.nombre)}</div>
            <div class="lam-subtit">Plan de Ordenamiento Territorial del cantón de ${esc(canton)}</div>
          </div>
          <span class="lam-inst">${esc(m.institucion)}</span>
        </div>
        <div class="lam-mapa-wrap" id="wrap-${i}">
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
              <div class="caj-muni">${esc(muni)}</div>
              <div class="caj-mapa">${esc(m.nombre)}</div>
              <div class="caj-elab"><span>Elaborado por</span><img src="planoexacto.png" class="caj-pe"></div>
            </div>
          </div>
          <div class="caj-norte"><div class="flecha">▲</div><div>N</div></div>
          <div class="caj-tabla">
            <div><b>Proyección</b><br>CRTM05 (EPSG:5367)</div>
            <div><b>Fuente</b><br>SNIT · CNE · SINAC · IGN</div>
            <div class="caj-fila">
              <span><b>Escala</b><br>gráfica</span>
              <span><b>Fecha</b><br>${hoy}</span>
              <span><b>Lámina</b><br>${i + 1} / ${total}</span>
            </div>
            <div><b>Papel</b> ${papel.nombre}</div>
          </div>
        </div>`;
      cont.appendChild(lam);
    }

    // 2) Se dibuja el mapa de cada lámina, ya sabiendo su tamaño real.
    for (let i = 0; i < ids.length; i++) {
      const wrap = $(`wrap-${i}`);
      if (!wrap) continue;
      const aspecto = (wrap.offsetWidth || 800) / (wrap.offsetHeight || 1000);
      const H = UV / aspecto;
      const bb = ajustarCaja([
        cajaCanton[0] - (cajaCanton[2] - cajaCanton[0]) * 0.04,
        cajaCanton[1] - (cajaCanton[3] - cajaCanton[1]) * 0.04,
        cajaCanton[2] + (cajaCanton[2] - cajaCanton[0]) * 0.04,
        cajaCanton[3] + (cajaCanton[3] - cajaCanton[1]) * 0.04
      ], aspecto);
      const px = proyector(bb, UV, H);

      // Capas: las base prendidas + las del mapa, con la misma simbología de la pantalla.
      const leyenda = [['Límite cantonal', 'Límites cantonales']];
      const nombres = [];
      baseVisibles.forEach((n) => { if (capaPorNombre[n]) nombres.push(n); });
      insumosReales(ids[i]).forEach((n) => { if (!nombres.includes(n)) nombres.push(n); });
      let capasSVG = '';
      for (const nombre of nombres) {
        const fc = await obtenerDatos(nombre);
        if (fc && fc.features && fc.features.length) {
          capasSVG += capaSVG(nombre, fc, px, k);
          leyenda.push([nombre, nombre]);
        }
      }

      // Máscara: rectángulo del viewBox con el cantón como hueco (regla par-impar).
      const dCanton = dDe(partesCanton.anillos, px, true);
      const mascara = `<path d="M0 0L${UV} 0L${UV} ${H.toFixed(2)}L0 ${H.toFixed(2)}Z${dCanton}" ` +
                      `fill="#ececec" fill-rule="evenodd"/>`;
      // Vecinos: solo el contorno, sobre el gris.
      let svgVecinos = '';
      vecinos.forEach((v) => {
        const pv = partesDe(v.geometry);
        svgVecinos += `<path d="${dDe(pv.anillos, px, true)}" fill="none" stroke="#bcbcbc" ` +
                      `stroke-width="${0.5 * k}" vector-effect="non-scaling-stroke"/>`;
      });
      const eC = estiloDe('Límites cantonales');
      const limite = `<path d="${dCanton}" fill="none" stroke="${eC.color}" stroke-width="${1.5 * k}" ` +
                     `stroke-dasharray="${dashDe('guion', k)}" vector-effect="non-scaling-stroke"/>`;

      const svg = `<svg class="lam-svg" viewBox="0 0 ${UV} ${H.toFixed(2)}" preserveAspectRatio="none" ` +
                  `xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">` +
                  capasSVG + mascara + svgVecinos + limite + '</svg>';

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

      const e = calcularEscala(bb, latMedia);
      const escala = `<div class="lam-escala" style="width:${e.pct.toFixed(2)}%">` +
                     `<div class="barra"><i></i><i></i></div>` +
                     `<div class="rot"><span>0</span><span>${e.etiqueta}</span></div></div>`;

      wrap.insertAdjacentHTML('afterbegin', svg + '<div class="lam-rotulos">' + rotulos + '</div>' + escala);

      // Simbología del cajetín, con la forma de cada geometría.
      $(`ley-${i}`).innerHTML = leyenda.map(([etiqueta, capa]) =>
        `<div class="ley-item">${muestraHTML(capa, 'ley-color')}${esc(etiqueta)}</div>`).join('');

      // Recuadro de ubicación: el país en gris con el cantón en rojo.
      const ins = $(`ins-${i}`);
      if (cantonesTodos && ins) {
        const aIns = (ins.offsetWidth || 150) / (ins.offsetHeight || 115);
        const Hi = UV / aIns;
        const bbi = ajustarCaja(cajaMerc(cantonesTodos.features), aIns);
        const pxi = proyector(bbi, UV, Hi);
        let dPais = '';
        cantonesTodos.features.forEach((f) => { dPais += dDe(partesDe(f.geometry).anillos, pxi, true); });
        ins.insertAdjacentHTML('afterbegin',
          `<svg class="lam-svg" viewBox="0 0 ${UV} ${Hi.toFixed(2)}" preserveAspectRatio="none" ` +
          `xmlns="http://www.w3.org/2000/svg"><path d="${dPais}" fill="#ededed" stroke="#c4c4c4" ` +
          `stroke-width="0.3" vector-effect="non-scaling-stroke"/><path d="${dDe(partesCanton.anillos, pxi, true)}" ` +
          `fill="${eC.color}" stroke="${eC.color}" stroke-width="0.5" vector-effect="non-scaling-stroke"/></svg>`);
      }
    }
  }

  function limpiarLaminas() { $('laminas').innerHTML = ''; }
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
