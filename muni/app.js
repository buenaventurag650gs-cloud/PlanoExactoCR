/* Tablero de mapas — configura los mapas oficiales (SETENA 44710 / INVU MAPRIOT) de un
   cantón y los imprime, cada uno en su lámina con título y cajetín.
   Flujo: 1) elegir cantón → se muestra la info base; 2) marcar los mapas; 3) imprimir.
   - capas.json: de dónde se baja cada capa (insumo).
   - mapas_oficiales.json: catálogo de los mapas que se pueden armar, por institución.
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

  const map = L.map('map', { zoomControl: true }).setView([9.9, -84.1], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(map);

  const [cap, catalogo] = await Promise.all([
    fetch('capas.json').then((r) => r.json()),
    fetch('mapas_oficiales.json').then((r) => r.json())
  ]);

  const capaPorNombre = {};
  cap.grupos.forEach((g) => g.capas.forEach((c) => { capaPorNombre[c.nombre] = c; }));

  const seleccion = new Set();        // ids de mapas marcados
  const layerLookup = {};             // nombre de capa -> leaflet layer (vista previa)
  const datosCapa = new Map();        // nombre -> FeatureCollection recortada al cantón (cache)
  let cantonSel = null;
  let cantonLayer = null;
  let muniLogo = null;

  // Capas base que se muestran al elegir cantón (del mapa base del INVU).
  const INFO_BASE = ['Límites distritales', 'Red vial cantonal', 'Zona marítimo terrestre'];

  const COLORES = {
    'Límites cantonales': '#8b949e', 'Límites distritales': '#30363d',
    'Zona marítimo terrestre': '#58a6ff', 'Estado del plan regulador por cantón': '#f0883e',
    'Zonas de vida': '#3fb950', 'Infraestructura general': '#d29922', 'Red eléctrica': '#db6d28',
    'ASADAS y abastecimiento de agua': '#39c5cf', 'Sedes de salud': '#f85149',
    'Red vial cantonal': '#9aa0a6', 'Uso urbano 1:5mil': '#d9534f', 'Cultivos 1:5mil': '#8fbc8f',
    'Áreas silvestres protegidas': '#1b5e20', 'Corredores biológicos': '#81c784',
    'Patrimonio Natural del Estado': '#388e3c', 'Registro Nacional de Humedales': '#4fc3f7',
    'Áreas de Conservación': '#b2dfdb', 'Cobertura forestal 2020': '#2d6a4f',
    'Coronas de deslizamientos': '#e03131', 'Deslizamientos': '#f08c00',
    'Fallas del cuaternario': '#862e9c', 'Áreas con potencial a inundación': '#1971c2',
    'Capacidad de uso de la tierra': '#a9742f'
  };
  const colorDe = (n) => COLORES[n] || '#4f8cff';

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

  function capaGeoJSON(nombre, fc, opts) {
    const color = colorDe(nombre);
    const esPol = fc.features && fc.features[0]?.geometry?.type?.includes('Polygon');
    return L.geoJSON(fc, Object.assign({
      style: () => ({ color, weight: 1.2, fillOpacity: esPol ? 0.12 : 0 }),
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 3, color, weight: 1, fillOpacity: 0.85 })
    }, opts || {}));
  }

  // ---------- identidad municipal ----------
  $('muniNombre').addEventListener('input', actualizarExport);
  $('logoBox').addEventListener('click', () => $('logoFile').click());
  $('logoFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => { muniLogo = lector.result; $('logoBox').innerHTML = `<img src="${muniLogo}" alt="logo">`; };
    lector.readAsDataURL(f);
  });

  // ---------- catálogo de mapas ----------
  const catEl = $('catalogo');
  catalogo.instituciones.forEach((inst) => {
    const div = document.createElement('div');
    div.className = 'institucion';
    div.innerHTML = `<h2>${inst.nombre}</h2><p>${inst.descripcion}</p>`;
    inst.mapas.forEach((m) => {
      const seleccionable = m.estado !== 'pendiente';
      const card = document.createElement('label');
      card.className = 'mapa' + (seleccionable ? '' : ' no-disp');
      card.innerHTML = `
        <input type="checkbox" data-id="${m.id}" ${seleccionable ? '' : 'disabled'}>
        <div class="cuerpo">
          <div class="titulo">${m.nombre} <span class="badge ${m.estado}">${m.estado}</span></div>
          <div class="desc">${m.descripcion}</div>
          ${m.faltante ? `<div class="falta">Falta: ${m.faltante}</div>` : ''}
        </div>`;
      const inp = card.querySelector('input');
      if (seleccionable) inp.addEventListener('change', () => onToggleMapa(m, inp.checked, card));
      div.appendChild(card);
    });
    catEl.appendChild(div);
  });

  function onToggleMapa(mapa, on, card) {
    if (on) seleccion.add(mapa.id); else seleccion.delete(mapa.id);
    card.classList.toggle('sel', on);
    actualizarResumen();
    actualizarExport();
    refrescarPreview();
  }
  function habilitarCatalogo(on) {
    catEl.classList.toggle('bloqueado', !on);
    $('hintCanton').style.display = on ? 'none' : '';
  }
  function actualizarResumen() {
    const n = seleccion.size;
    $('resumen').innerHTML = n ? `<b>${n}</b> mapa${n === 1 ? '' : 's'} para imprimir` : '';
  }
  function actualizarExport() {
    const listo = cantonSel && seleccion.size > 0;
    $('btnConfig').disabled = !listo;
    $('btnAtlas').disabled = !listo;
  }

  // Devuelve la definición de mapa por id.
  function defMapa(id) {
    for (const inst of catalogo.instituciones) {
      const m = inst.mapas.find((x) => x.id === id);
      if (m) return Object.assign({ institucion: inst.nombre }, m);
    }
    return null;
  }
  // Capas de insumo de un mapa que son capas reales (existen en capas.json).
  function insumosReales(id) {
    const m = defMapa(id);
    return (m?.insumos || []).filter((n) => capaPorNombre[n]);
  }

  // ---------- vista previa (mapa principal) ----------
  function capasNecesarias() {
    const nombres = new Set(INFO_BASE.filter((n) => capaPorNombre[n]));
    seleccion.forEach((id) => insumosReales(id).forEach((n) => nombres.add(n)));
    return nombres;
  }
  async function refrescarPreview() {
    if (!cantonSel) return;
    const necesarias = capasNecesarias();
    Object.keys(layerLookup).forEach((n) => {
      if (!necesarias.has(n)) { map.removeLayer(layerLookup[n]); delete layerLookup[n]; }
    });
    let fallidas = 0;
    for (const nombre of necesarias) {
      if (layerLookup[nombre]) continue;
      const fc = await obtenerDatos(nombre);
      if (!fc) { fallidas++; continue; }
      layerLookup[nombre] = capaGeoJSON(nombre, fc).addTo(map);
    }
    if (fallidas) avisar(`${fallidas} capa(s) no se pudieron cargar en la vista previa.`);
    $('vistaPrevia').textContent = `Vista previa — ${necesarias.size} capa(s); ${seleccion.size} mapa(s) para imprimir`;
  }

  // ---------- selector de cantón ----------
  const baseCantones = await fetch('https://planoexactocr.com/data/cantones.geojson').then((r) => r.json()).catch(() => null);
  if (baseCantones) {
    const nombres = [...new Set(baseCantones.features.map((f) => f.properties.k))].sort();
    const sel = $('selCanton');
    nombres.forEach((n) => sel.insertAdjacentHTML('beforeend', `<option value="${n}">${n}</option>`));
    sel.addEventListener('change', () => {
      if (!sel.value) { cantonSel = null; habilitarCatalogo(false); actualizarExport(); return; }
      cantonSel = baseCantones.features.find((f) => f.properties.k === sel.value) || null;
      if (!cantonSel) return;
      datosCapa.clear();                       // el cache es por cantón
      Object.keys(layerLookup).forEach((n) => { map.removeLayer(layerLookup[n]); delete layerLookup[n]; });
      habilitarCatalogo(true);
      if (cantonLayer) map.removeLayer(cantonLayer);
      cantonLayer = L.geoJSON(cantonSel, { style: { color: '#4f8cff', weight: 2, fillOpacity: 0.04 } }).addTo(map);
      map.fitBounds(cantonLayer.getBounds(), { padding: [20, 20] });
      actualizarExport();
      refrescarPreview();                      // muestra la info base del cantón
    });
  }

  // ---------- exportar configuración ----------
  function configActual() {
    return {
      municipalidad: $('muniNombre').value.trim() || null,
      logo: muniLogo,
      canton: $('selCanton').value || null,
      proyeccion: catalogo.proyeccion,
      mapas: [...seleccion],
      generado: new Date().toISOString().slice(0, 10)
    };
  }
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

  // ---------- imprimir: una lámina por mapa seleccionado, con título y cajetín ----------
  let laminasMapas = [];
  async function construirLaminas() {
    const cont = $('laminas');
    cont.innerHTML = '';
    laminasMapas.forEach((m) => m.remove());
    laminasMapas = [];

    const muni = $('muniNombre').value.trim() || 'Municipalidad';
    const canton = $('selCanton').value;
    const hoy = new Date().toLocaleDateString('es-CR');
    const ids = [...seleccion];

    for (let i = 0; i < ids.length; i++) {
      const m = defMapa(ids[i]);
      if (!m) continue;
      const lam = document.createElement('div');
      lam.className = 'lamina';
      const idMapa = `lam-mapa-${i}`;
      lam.innerHTML = `
        <div class="lam-cab">
          <span class="lam-titulo">${m.nombre}</span>
          <span class="lam-inst">${m.institucion}</span>
        </div>
        <div class="lam-mapa" id="${idMapa}"></div>
        <div class="lam-caj">
          <div class="caj-logo">${muniLogo ? `<img src="${muniLogo}">` : ''}</div>
          <div class="caj-ident">
            <div class="caj-muni">${muni}</div>
            <div class="caj-canton">Cantón de ${canton}</div>
            <div class="caj-mapa">${m.nombre}</div>
          </div>
          <div class="caj-norte"><div class="flecha">▲</div><div>N</div></div>
          <div class="caj-meta">
            <div><b>Fecha:</b> ${hoy}</div>
            <div><b>Proyección:</b> CRTM05 (EPSG:5367)</div>
            <div><b>Fuente:</b> SNIT, CNE, SINAC, IGN</div>
            <div class="caj-escala" id="esc-${i}"></div>
          </div>
        </div>`;
      cont.appendChild(lam);

      const lm = L.map(idMapa, { zoomControl: false, attributionControl: false, dragging: false,
                                 scrollWheelZoom: false, doubleClickZoom: false });
      laminasMapas.push(lm);
      // Sin tiles: fondo blanco, solo las capas vectoriales (cartografía de plan regulador).
      cantonLayer && L.geoJSON(cantonSel, { style: { color: '#222', weight: 1.5, fill: false } }).addTo(lm);
      const nombres = insumosReales(ids[i]);
      for (const nombre of nombres) {
        const fc = await obtenerDatos(nombre);
        if (fc && fc.features && fc.features.length) capaGeoJSON(nombre, fc).addTo(lm);
      }
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(lm);
      const b = L.geoJSON(cantonSel).getBounds();
      lm.fitBounds(b, { padding: [10, 10] });
    }
    // Deja que los mapas tomen tamaño antes de imprimir.
    await new Promise((res) => setTimeout(res, 300));
    laminasMapas.forEach((lm) => { lm.invalidateSize(); lm.fitBounds(L.geoJSON(cantonSel).getBounds(), { padding: [10, 10] }); });
    await new Promise((res) => setTimeout(res, 300));
  }

  function limpiarLaminas() {
    laminasMapas.forEach((m) => m.remove());
    laminasMapas = [];
    $('laminas').innerHTML = '';
    document.body.classList.remove('imprimiendo');
  }
  window.addEventListener('afterprint', limpiarLaminas);

  $('btnAtlas').addEventListener('click', async () => {
    if (!cantonSel || !seleccion.size) { avisar('Elegí un cantón y al menos un mapa.'); return; }
    document.title = `Atlas — ${$('selCanton').value}`;
    $('btnAtlas').disabled = true;
    avisar('Preparando las láminas…');
    await construirLaminas();
    document.body.classList.add('imprimiendo');
    window.print();
    $('btnAtlas').disabled = false;
  });
})();
