/* Atlas municipal — visor mínimo. Lee las capas públicas de planoexactocr.com/data
   (son capas base, no remates) y el catálogo local capas.json. */
(async function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const map = L.map('map', { zoomControl: true }).setView([9.9, -84.1], 8);
  // CartoDB retiró su mosaico gratis sin llave (pedía API key); usamos el de OpenStreetMap,
  // que sigue siendo gratis para uso interno de bajo volumen como este.
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(map);

  const cap = await fetch('capas.json').then((r) => r.json());
  const layerLookup = {}; // nombre -> { leafletLayer, meta }
  let cantonesFC = null;
  let cantonLayer = null;
  let cantonSel = null;              // feature del cantón elegido en el selector
  const nacionalesOn = new Map();    // capas nacionales encendidas (nombre -> c), se recargan al cambiar de cantón

  // Recuadro [minLon, minLat, maxLon, maxLat] de un feature (Polygon o MultiPolygon).
  function bboxDe(feat) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (function walk(co) {
      if (typeof co[0] === 'number') {
        if (co[0] < minX) minX = co[0];
        if (co[1] < minY) minY = co[1];
        if (co[0] > maxX) maxX = co[0];
        if (co[1] > maxY) maxY = co[1];
      } else co.forEach(walk);
    })(feat.geometry.coordinates);
    return [minX, minY, maxX, maxY];
  }

  // Las capas nacionales (IGN, INTA) son enormes; se piden recortadas al cantón con bbox.
  // GeoServer con el SRS en forma corta "EPSG:4326" usa orden lon,lat (longitud primero).
  function urlConBbox(url, bbox) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}bbox=${bbox.join(',')},EPSG:4326&count=150000`;
  }

  function avisar(mensaje) {
    const el = $('avisos');
    if (!el) { console.warn(mensaje); return; }
    const d = document.createElement('div');
    d.className = 'aviso';
    d.textContent = mensaje;
    el.appendChild(d);
    setTimeout(() => d.remove(), 8000);
  }

  // ---------- panel de capas ----------
  const gruposEl = $('grupos');
  cap.grupos.forEach((g) => {
    const fs = document.createElement('fieldset');
    fs.innerHTML = `<legend>${g.eje}</legend>`;
    g.capas.forEach((c) => {
      const disponible = c.estado === 'disponible';
      const lbl = document.createElement('label');
      lbl.className = 'capa' + (disponible ? '' : ' pendiente');
      const notaCopia = c.copia_local
        ? ` — copia propia, actualizada ${c.copia_local}`
        : '';
      lbl.innerHTML = `<input type="checkbox" ${disponible ? '' : 'disabled'} data-nombre="${c.nombre}">
        <span>${c.nombre}<br><small style="color:var(--muted)">${c.fuente}${c.nota ? ' — ' + c.nota : ''}${notaCopia}</small></span>
        <span class="tag ${c.estado}">${c.estado === 'disponible' ? 'lista' : 'pendiente'}</span>`;
      fs.appendChild(lbl);
      if (disponible) {
        lbl.querySelector('input').addEventListener('change', (e) => toggleCapa(c, e.target.checked));
      }
    });
    gruposEl.appendChild(fs);
  });

  // Registro de fuentes, para el pie del atlas (SETENA pide saber de dónde sale cada capa)
  const fuentesEl = $('fuentes');
  const vistas = new Set();
  function marcarFuente(c) {
    if (vistas.has(c.nombre)) return;
    vistas.add(c.nombre);
    const d = document.createElement('div');
    d.textContent = `${c.nombre} — ${c.fuente}`;
    fuentesEl.appendChild(d);
  }

  const COLORES = {
    'Límites cantonales': '#8b949e',
    'Límites distritales': '#30363d',
    'Zona marítimo terrestre': '#58a6ff',
    'Estado del plan regulador por cantón': '#f0883e',
    'Zonas de vida': '#3fb950',
    'Infraestructura general': '#d29922',
    'Red eléctrica': '#db6d28',
    'ASADAS y abastecimiento de agua': '#39c5cf',
    'Sedes de salud': '#f85149'
  };

  // Baja un GeoJSON de `url` y lo dibuja como la capa `c` (reemplaza la anterior si la hubiera).
  async function cargarCapaUrl(c, url) {
    const data = await fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .catch(() => {
        avisar(`No se pudo cargar "${c.nombre}".`);
        return null;
      });
    if (!data) return;
    if (c.nombre === 'Límites cantonales') cantonesFC = data;
    const color = COLORES[c.nombre] || '#4f8cff';
    const layer = L.geoJSON(data, {
      style: () => ({ color, weight: 1.2, fillOpacity: data.features && data.features[0]?.geometry?.type?.includes('Polygon') ? 0.06 : 0 }),
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 3, color, weight: 1, fillOpacity: 0.8 })
    }).addTo(map);
    if (layerLookup[c.nombre]) map.removeLayer(layerLookup[c.nombre]); // evita duplicar al recargar por cantón
    layerLookup[c.nombre] = layer;
  }

  async function toggleCapa(c, on) {
    if (!on) {
      if (layerLookup[c.nombre]) { map.removeLayer(layerLookup[c.nombre]); delete layerLookup[c.nombre]; }
      nacionalesOn.delete(c.nombre);
      return;
    }
    marcarFuente(c);
    if (c.filtrar_canton) {
      // Capa nacional (IGN/INTA): se carga solo el recorte del cantón elegido.
      nacionalesOn.set(c.nombre, c);
      if (!cantonSel) {
        avisar(`"${c.nombre}" es una capa nacional; elegí un cantón y se carga recortada a ese cantón.`);
        return;
      }
      await cargarCapaUrl(c, urlConBbox(c.archivo, bboxDe(cantonSel)));
      return;
    }
    if (c.archivo && !c.archivo.startsWith('api:')) {
      // c.archivo puede ser una URL completa (capas realmente públicas, directo del sitio
      // público) o una ruta relativa como "data/zonasvida.geojson" (copia propia que vive
      // en este mismo Worker, sincronizada aparte — ver scripts/sync_cuenta.py).
      await cargarCapaUrl(c, c.archivo);
    } else {
      // api:/api/plano, /api/finca y /api/cobertura — se consultan por lote, no se cargan de una
    }
  }

  // ---------- selector de cantón ----------
  // Carga silenciosa de límites cantonales para el selector, aunque la capa no esté encendida.
  const baseCantones = await fetch('https://planoexactocr.com/data/cantones.geojson').then((r) => r.json()).catch(() => null);
  if (baseCantones) {
    cantonesFC = baseCantones;
    const nombres = [...new Set(baseCantones.features.map((f) => f.properties.k))].sort();
    const sel = $('selCanton');
    nombres.forEach((n) => sel.insertAdjacentHTML('beforeend', `<option value="${n}">${n}</option>`));
    sel.addEventListener('change', () => {
      $('btnAtlas').disabled = !sel.value;
      if (!sel.value) return;
      const feat = baseCantones.features.find((f) => f.properties.k === sel.value);
      if (!feat) return;
      cantonSel = feat;
      if (cantonLayer) map.removeLayer(cantonLayer);
      cantonLayer = L.geoJSON(feat, { style: { color: '#4f8cff', weight: 2, fillOpacity: 0.04 } }).addTo(map);
      map.fitBounds(cantonLayer.getBounds(), { padding: [20, 20] });
      // Recarga cada capa nacional encendida, recortada al nuevo cantón.
      const bbox = bboxDe(feat);
      nacionalesOn.forEach((c) => cargarCapaUrl(c, urlConBbox(c.archivo, bbox)));
    });
  }

  // ---------- generar atlas (MVP: recorte visual + impresión del navegador a PDF) ----------
  $('btnAtlas').addEventListener('click', () => {
    const nombre = $('selCanton').value;
    if (!nombre) return;
    document.title = `Atlas — ${nombre}`;
    window.print();
    // Siguiente paso (fuera de este MVP): recorte real de cada capa al polígono del
    // cantón con turf.bboxClip / turf.intersect, y exportación a GeoPackage en el
    // servidor (scripts/build_atlas.py) en vez de solo imprimir el mapa visible.
  });
})();
