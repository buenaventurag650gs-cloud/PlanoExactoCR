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
  let cantonesTodos = null;          // todos los cantones, para dibujar los vecinos

  // Capas base que se muestran al elegir cantón (del mapa base del INVU).
  const INFO_BASE = ['Límites distritales', 'Red vial cantonal', 'Zona marítimo terrestre'];

  // Paleta tomada de la lámina de referencia de Liberia (forma y colores del POT).
  const COLORES = {
    'Límites cantonales': '#8b949e', 'Límites distritales': '#222222',
    'Zona marítimo terrestre': '#6fb1e0', 'Estado del plan regulador por cantón': '#f0883e',
    'Zonas de vida': '#8fcf9a', 'Infraestructura general': '#d29922', 'Red eléctrica': '#db6d28',
    'ASADAS y abastecimiento de agua': '#39c5cf', 'Sedes de salud': '#e03131',
    'Red vial cantonal': '#a07850',           // vialidad cantonal: café
    'Curvas de nivel 10m': '#c79a6b',          // curvas: tierra/café (como la referencia)
    'Uso urbano 1:5mil': '#f2a7c4',            // áreas urbanas: rosado
    'Cultivos 1:5mil': '#cfe3b0',              // cultivos: verde claro
    'Hidrografía': '#3b82c4', 'Cuerpos de agua': '#9ec9e8',
    'Áreas silvestres protegidas': '#1b5e20', 'Corredores biológicos': '#7cc47f',
    'Patrimonio Natural del Estado': '#388e3c', 'Registro Nacional de Humedales': '#4fc3f7',
    'Áreas de Conservación': '#b2dfdb', 'Cobertura forestal 2020': '#2d6a4f',
    'Coronas de deslizamientos': '#e03131', 'Deslizamientos': '#f0883e',
    'Fallas del cuaternario': '#8e44ad', 'Áreas con potencial a inundación': '#5a9fd4',
    'Capacidad de uso de la tierra': '#c79a6b'
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

  function capaGeoJSON(nombre, fc, opts) {
    const color = colorDe(nombre);
    const esPol = fc.features && fc.features[0]?.geometry?.type?.includes('Polygon');
    return L.geoJSON(fc, Object.assign({
      style: () => ({ color, weight: 1.2, fillOpacity: esPol ? 0.12 : 0 }),
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 3, color, weight: 1, fillOpacity: 0.85 })
    }, opts || {}));
  }

  // ---------- identidad municipal ----------
  let muniEditado = false;   // si el usuario escribió el nombre a mano, no lo pisamos
  let escudoManual = false;  // si subió un logo a mano, no lo pisamos con el del cantón

  function slug(txt) {
    return txt.normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim().replace(/\s+/g, '-');
  }

  $('muniNombre').addEventListener('input', () => { muniEditado = true; actualizarExport(); actualizarCajetinPreview(); });
  $('logoBox').addEventListener('click', () => $('logoFile').click());
  $('logoFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      muniLogo = lector.result; escudoManual = true;
      $('logoBox').innerHTML = `<img src="${muniLogo}" alt="logo">`;
      actualizarCajetinPreview();
    };
    lector.readAsDataURL(f);
  });

  // Al elegir cantón: nombre "Municipalidad de X" y escudo escudos/<x>.png si existe.
  function aplicarIdentidadCanton(canton) {
    if (!muniEditado) $('muniNombre').value = 'Municipalidad de ' + canton;
    if (!escudoManual) {
      const img = new Image();
      img.onload = () => {
        // Pasa la imagen a data URL para que entre en el PDF y la vista.
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          muniLogo = c.toDataURL('image/png');
        } catch (e) { muniLogo = img.src; }
        $('logoBox').innerHTML = `<img src="${muniLogo}" alt="escudo">`;
        actualizarCajetinPreview();
      };
      img.onerror = () => { muniLogo = null; $('logoBox').innerHTML = '<span id="logoTxt">logo</span>'; actualizarCajetinPreview(); };
      img.src = `escudos/${slug(canton)}.png`;
    }
    actualizarCajetinPreview();
  }

  // Muestra el cajetín (escudo + muni + cantón) sobre el mapa, como se verá en las láminas.
  function actualizarCajetinPreview() {
    const canton = $('selCanton').value;
    const cp = $('cajetinPreview');
    if (!canton) { cp.hidden = true; return; }
    cp.hidden = false;
    $('cpEscudo').innerHTML = muniLogo ? `<img src="${muniLogo}">` : '<div class="ph">escudo</div>';
    $('cpMuni').textContent = $('muniNombre').value.trim() || ('Municipalidad de ' + canton);
    $('cpCanton').textContent = 'Cantón de ' + canton;
  }

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
  cantonesTodos = baseCantones;
  if (baseCantones) {
    const nombres = [...new Set(baseCantones.features.map((f) => f.properties.k))].sort();
    const sel = $('selCanton');
    nombres.forEach((n) => sel.insertAdjacentHTML('beforeend', `<option value="${n}">${n}</option>`));
    sel.addEventListener('change', () => {
      if (!sel.value) { cantonSel = null; habilitarCatalogo(false); actualizarExport(); return; }
      cantonSel = baseCantones.features.find((f) => f.properties.k === sel.value) || null;
      if (!cantonSel) return;
      aplicarIdentidadCanton(sel.value);       // nombre + escudo de la muni, visibles en el mapa
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
  let laminasInsets = [];
  async function construirLaminas() {
    const cont = $('laminas');
    cont.innerHTML = '';
    laminasMapas.forEach((m) => m.remove());
    laminasInsets.forEach((m) => m.remove());
    laminasMapas = []; laminasInsets = [];

    const muni = $('muniNombre').value.trim() || ('Municipalidad de ' + $('selCanton').value);
    const canton = $('selCanton').value;
    const hoy = new Date().toLocaleDateString('es-CR');
    const ids = [...seleccion];
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
            <div class="lam-titulo">${m.nombre}</div>
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
              <div class="caj-canton">Cantón de ${canton}</div>
              <div class="caj-mapa">${m.nombre}</div>
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
          </div>
        </div>`;
      cont.appendChild(lam);

      const lm = L.map(idMapa, { zoomControl: false, attributionControl: false, dragging: false,
                                 scrollWheelZoom: false, doubleClickZoom: false });
      laminasMapas.push(lm);
      // Sin tiles: fondo blanco, solo las capas vectoriales (cartografía de plan regulador).
      // Cantones vecinos de contexto (gris + rótulo), como en la lámina de referencia.
      vecinosDe(cantonSel).forEach((v) => {
        L.geoJSON(v, { style: { color: '#c2c2c2', weight: 0.6, fillColor: '#ececec', fillOpacity: 0.75 },
                       interactive: false }).addTo(lm);
        try {
          const ctr = turf.centroid(v).geometry.coordinates;
          L.marker([ctr[1], ctr[0]], { interactive: false, icon: L.divIcon({
            className: 'rot-vecino', html: String(v.properties.k).toUpperCase(),
            iconSize: [80, 12], iconAnchor: [40, 6] }) }).addTo(lm);
        } catch (e) { /* sin rótulo */ }
      });
      cantonLayer && L.geoJSON(cantonSel, { style: { color: '#222', weight: 1.5, fill: false }, interactive: false }).addTo(lm);
      const leyenda = [['Límite cantonal', '#222']];
      const nombres = insumosReales(ids[i]);
      for (const nombre of nombres) {
        const fc = await obtenerDatos(nombre);
        if (fc && fc.features && fc.features.length) {
          capaGeoJSON(nombre, fc).addTo(lm);
          leyenda.push([nombre, colorDe(nombre)]);
        }
      }
      // Dibuja la leyenda (simbología) de este mapa.
      $(`ley-${i}`).innerHTML = leyenda.map(([n, c]) =>
        `<div class="ley-item"><span class="ley-color" style="background:${c}"></span>${n}</div>`).join('');
      L.control.scale({ imperial: false, position: 'bottomright', maxWidth: 140 }).addTo(lm);
      const b = L.geoJSON(cantonSel).getBounds();
      lm.fitBounds(b, { padding: [10, 10] });

      // Recuadro de ubicación: el país en gris con el cantón en rojo.
      if (cantonesTodos) {
        const ins = L.map(`ins-${i}`, { zoomControl: false, attributionControl: false, dragging: false,
                                        scrollWheelZoom: false, doubleClickZoom: false, keyboard: false, boxZoom: false });
        laminasInsets.push(ins);
        L.geoJSON(cantonesTodos, { style: { color: '#c4c4c4', weight: 0.3, fillColor: '#ededed', fillOpacity: 1 }, interactive: false }).addTo(ins);
        L.geoJSON(cantonSel, { style: { color: '#d11a1a', weight: 0.6, fillColor: '#d11a1a', fillOpacity: 1 }, interactive: false }).addTo(ins);
      }
    }
    // Deja que los mapas tomen tamaño antes de imprimir.
    await new Promise((res) => setTimeout(res, 350));
    laminasMapas.forEach((lm) => { lm.invalidateSize(); lm.fitBounds(L.geoJSON(cantonSel).getBounds(), { padding: [10, 10] }); });
    const boundsPais = cantonesTodos ? L.geoJSON(cantonesTodos).getBounds() : null;
    laminasInsets.forEach((ins) => { ins.invalidateSize(); if (boundsPais) ins.fitBounds(boundsPais, { padding: [3, 3] }); });
    await new Promise((res) => setTimeout(res, 300));
  }

  function limpiarLaminas() {
    laminasMapas.forEach((m) => m.remove());
    laminasInsets.forEach((m) => m.remove());
    laminasMapas = []; laminasInsets = [];
    $('laminas').innerHTML = '';
    document.body.classList.remove('imprimiendo');
  }
  window.addEventListener('afterprint', limpiarLaminas);

  $('btnAtlas').addEventListener('click', async () => {
    if (!cantonSel || !seleccion.size) { avisar('Elegí un cantón y al menos un mapa.'); return; }
    // Nombre del archivo PDF (sale como título del documento en el diálogo de impresión).
    const canton = $('selCanton').value;
    if (seleccion.size === 1) {
      const m = defMapa([...seleccion][0]);
      document.title = `1. Mapa ${m ? m.nombre : 'canton'} ${canton} Carta`;
    } else {
      document.title = `Atlas ${canton} — ${seleccion.size} mapas Carta`;
    }
    $('btnAtlas').disabled = true;
    avisar('Preparando las láminas…');
    await construirLaminas();
    document.body.classList.add('imprimiendo');
    window.print();
    $('btnAtlas').disabled = false;
  });
})();
