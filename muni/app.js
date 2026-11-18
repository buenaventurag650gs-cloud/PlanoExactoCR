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
            <div class="titulo"><b>${codigoDe(m)}</b> ${m.nombre}
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
    const nombres = [...new Set(baseCantones.features.map((f) => f.properties.k))].sort();
    const sel = $('selCanton');
    nombres.forEach((n) => sel.insertAdjacentHTML('beforeend', `<option value="${n}">${n}</option>`));
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
    });
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
  async function construirLaminas(soloEstos) {
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

      // Capas: las base prendidas + las del mapa, con la misma simbología de la pantalla.
      const leyenda = [['Límite cantonal', 'Límites cantonales']];
      const nombres = [];
      baseVisibles.forEach((n) => { if (capaPorNombre[n]) nombres.push(n); });
      insumosReales(ids[i]).forEach((n) => { if (!nombres.includes(n)) nombres.push(n); });
      let capasSVG = '';
      const fuentes = new Set();
      for (const nombre of nombres) {
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
    if (!a) return { nivel: 'falta', origen: c.fuente || 'sin fuente' };
    if (a.startsWith('api:')) return { nivel: 'parcial', origen: 'consulta por plano' };
    if (a.includes('planoexactocr.com/data/')) return { nivel: 'ok', origen: 'PlanoExacto', propio: true };
    if (c.estado && c.estado !== 'disponible') return { nivel: 'parcial', origen: c.fuente || 'servicio nacional' };
    return { nivel: 'ok', origen: c.fuente || 'servicio nacional' };
  }

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
             `<span>${n}</span><span class="origen${e.propio ? ' propio' : ''}">${e.origen}</span></div>`;
    }).join('') + '</div>';
  }

  // Botones de un mapa que el atlas sí puede componer.
  function accionesHTML(id, estado) {
    if (!id || estado === 'pendiente') return '';
    return `<button data-descargar="${id}" title="Compone este mapa y abre el diálogo de impresión">Descargar</button>` +
           `<button class="sec" data-marcar="${id}" title="Agregarlo a la lista que se exporta junta">Marcar 🖨</button>`;
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

          h += `<tr><td class="est-cod">${mp.codigo}</td>` +
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

    $('estResumen').innerHTML =
      `<span class="est-chip"><b>${estructura.mapas.length}</b> mapas en la obra</span>` +
      `<span class="est-chip"><b>${conAtlas}</b> con lámina en el atlas</span>` +
      `<span class="est-chip"><b>${listos}</b> listos</span>` +
      `<span class="est-chip"><b>${parciales}</b> parciales</span>` +
      `<span class="est-chip"><b>${porDatos}</b> por datos</span>` +
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
    cuerpo.querySelectorAll('[data-marcar]').forEach((b) => {
      b.addEventListener('click', () => {
        marcarImprimir(b.dataset.marcar);
        b.textContent = seleccion.has(b.dataset.marcar) ? 'Marcado 🖨' : 'Marcar 🖨';
      });
    });
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
    avisar(`Componiendo "${m.nombre}"…`);
    await construirLaminas([id]);
    window.print();
  }

  // Cambio de pestaña. El mapa necesita que le avisen cuando vuelve a estar visible.
  function mostrarVista(cual) {
    $('map').hidden = cual !== 'visor';
    $('estructura').hidden = cual !== 'estructura';
    document.querySelectorAll('.pest').forEach((b) => b.classList.toggle('activa', b.dataset.vista === cual));
    if (cual === 'visor') setTimeout(() => map.invalidateSize(), 60);
    else construirEstructura();
    $('pestNota').textContent = cual === 'estructura'
      ? 'Los mapas se generan al momento, no están pre-hechos.' : '';
  }
  document.querySelectorAll('.pest').forEach((b) => {
    b.addEventListener('click', () => mostrarVista(b.dataset.vista));
  });

  function limpiarLaminas() { $('laminas').innerHTML = ''; }
  window.addEventListener('afterprint', limpiarLaminas);

  $('btnAtlas').addEventListener('click', async () => {
    if (!cantonSel || !seleccion.size) { avisar('Elegí un cantón y marcá al menos un mapa con 🖨.'); return; }
    const canton = $('selCanton').value;
    const papel = papelActual().nombre;
    if (seleccion.size === 1) {
      const m = defMapa([...seleccion][0]);
      const nom = m ? (/^mapa/i.test(m.nombre) ? m.nombre : 'Mapa ' + m.nombre) : 'Mapa';
      document.title = `${codigoDe(m) ? codigoDe(m) + '. ' : ''}${nom} ${canton} ${papel}`;
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
