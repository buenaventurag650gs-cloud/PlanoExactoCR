/* Atlas municipal — visor mínimo. Lee las capas públicas de planoexactocr.com/data
   (son capas base, no remates) y el catálogo local capas.json. */
(async function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const map = L.map('map', { zoomControl: true }).setView([9.9, -84.1], 8);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CARTO', maxZoom: 19
  }).addTo(map);

  const cap = await fetch('capas.json').then((r) => r.json());
  const layerLookup = {}; // nombre -> { leafletLayer, meta }
  let cantonesFC = null;
  let cantonLayer = null;

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
      const notaCuenta = c.requiere_cuenta
        ? ' — exige cuenta en planoexactocr.com; hoy no carga aquí (ver muni/README.md)'
        : '';
      lbl.innerHTML = `<input type="checkbox" ${disponible ? '' : 'disabled'} data-nombre="${c.nombre}">
        <span>${c.nombre}<br><small style="color:var(--muted)">${c.fuente}${c.nota ? ' — ' + c.nota : ''}${notaCuenta}</small></span>
        <span class="tag ${c.requiere_cuenta ? 'pendiente' : c.estado}">${c.requiere_cuenta ? 'requiere cuenta' : (c.estado === 'disponible' ? 'lista' : 'pendiente')}</span>`;
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

  async function toggleCapa(c, on) {
    if (!on) {
      if (layerLookup[c.nombre]) { map.removeLayer(layerLookup[c.nombre]); delete layerLookup[c.nombre]; }
      return;
    }
    marcarFuente(c);
    if (c.archivo && c.archivo.startsWith('http')) {
      const data = await fetch(c.archivo)
        .then((r) => {
          if (r.status === 401) throw new Error('cuenta');
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .catch((err) => {
          avisar(err && err.message === 'cuenta'
            ? `"${c.nombre}" exige una cuenta en planoexactocr.com y esta página no comparte esa sesión. Use scripts/build_atlas.py con --cookie para incluirla en el PDF/GeoPackage.`
            : `No se pudo cargar "${c.nombre}".`);
          return null;
        });
      if (!data) return;
      if (c.nombre === 'Límites cantonales') cantonesFC = data;
      const color = COLORES[c.nombre] || '#4f8cff';
      const layer = L.geoJSON(data, {
        style: () => ({ color, weight: 1.2, fillOpacity: data.features[0]?.geometry?.type?.includes('Polygon') ? 0.06 : 0 }),
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 3, color, weight: 1, fillOpacity: 0.8 })
      }).addTo(map);
      layerLookup[c.nombre] = layer;
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
      if (cantonLayer) map.removeLayer(cantonLayer);
      cantonLayer = L.geoJSON(feat, { style: { color: '#4f8cff', weight: 2, fillOpacity: 0.04 } }).addTo(map);
      map.fitBounds(cantonLayer.getBounds(), { padding: [20, 20] });
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
