/* Tablero de mapas — configura los mapas oficiales (SETENA 44710 / INVU MAPRIOT) de un
   cantón y los exporta. No es un visor de capas: el usuario elige MAPAS, no capas sueltas.
   - capas.json: definición de cada capa (de dónde se baja). Insumo, no se muestra directo.
   - mapas_oficiales.json: catálogo de los mapas que se pueden configurar, por institución.
   El mapa de la derecha es solo una vista previa de los insumos de los mapas elegidos. */
(async function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const map = L.map('map', { zoomControl: true }).setView([9.9, -84.1], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(map);

  const [cap, catalogo] = await Promise.all([
    fetch('capas.json').then((r) => r.json()),
    fetch('mapas_oficiales.json').then((r) => r.json())
  ]);

  // Índice capa por nombre, para resolver los insumos de cada mapa.
  const capaPorNombre = {};
  cap.grupos.forEach((g) => g.capas.forEach((c) => { capaPorNombre[c.nombre] = c; }));

  const seleccion = new Set();        // ids de mapas marcados
  const layerLookup = {};             // nombre de capa -> leaflet layer (en la vista previa)
  let cantonSel = null;               // feature del cantón elegido
  let cantonLayer = null;
  let muniLogo = null;                // data URL del logo subido

  // ---------- helpers de geometría ----------
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
    if (!el) { console.warn(mensaje); return; }
    const d = document.createElement('div');
    d.className = 'aviso'; d.textContent = mensaje;
    el.appendChild(d);
    setTimeout(() => d.remove(), 8000);
  }

  // ---------- identidad municipal ----------
  $('muniNombre').addEventListener('input', actualizarExport);
  $('logoBox').addEventListener('click', () => $('logoFile').click());
  $('logoFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      muniLogo = lector.result;
      $('logoBox').innerHTML = `<img src="${muniLogo}" alt="logo">`;
    };
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
      if (seleccionable) {
        inp.addEventListener('change', () => onToggleMapa(m, inp.checked, card));
      }
      catEl.appendChild(card);
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
    $('resumen').innerHTML = n
      ? `<b>${n}</b> mapa${n === 1 ? '' : 's'} seleccionado${n === 1 ? '' : 's'}`
      : '';
  }

  function actualizarExport() {
    const listo = cantonSel && seleccion.size > 0;
    $('btnConfig').disabled = !listo;
    $('btnAtlas').disabled = !listo;
  }

  // ---------- vista previa de insumos ----------
  // Junta los nombres de capa que necesitan los mapas elegidos (los insumos que son capas reales).
  function capasNecesarias() {
    const nombres = new Set();
    catalogo.instituciones.forEach((inst) => inst.mapas.forEach((m) => {
      if (!seleccion.has(m.id)) return;
      (m.insumos || []).forEach((n) => { if (capaPorNombre[n]) nombres.add(n); });
    }));
    return nombres;
  }

  const COLORES = {
    'Límites cantonales': '#8b949e', 'Límites distritales': '#30363d',
    'Zona marítimo terrestre': '#58a6ff', 'Estado del plan regulador por cantón': '#f0883e',
    'Zonas de vida': '#3fb950', 'Infraestructura general': '#d29922', 'Red eléctrica': '#db6d28',
    'ASADAS y abastecimiento de agua': '#39c5cf', 'Sedes de salud': '#f85149'
  };

  async function cargarCapa(c) {
    let url, recortar;
    if (c.filtrar_canton) { url = urlConBbox(c.archivo, bboxDe(cantonSel)); recortar = false; }
    else if (c.archivo && !c.archivo.startsWith('api:')) { url = c.archivo; recortar = true; }
    else return; // capas api:/... no se previsualizan
    let data = await fetch(url).then((r) => { if (!r.ok) throw 0; return r.json(); })
      .catch(() => { avisar(`No se pudo cargar "${c.nombre}" en la vista previa.`); return null; });
    if (!data) return;
    if (recortar) data = soloCanton(data);
    const color = COLORES[c.nombre] || '#4f8cff';
    const esPol = data.features && data.features[0]?.geometry?.type?.includes('Polygon');
    if (layerLookup[c.nombre]) map.removeLayer(layerLookup[c.nombre]);
    layerLookup[c.nombre] = L.geoJSON(data, {
      style: () => ({ color, weight: 1.2, fillOpacity: esPol ? 0.06 : 0 }),
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 3, color, weight: 1, fillOpacity: 0.8 })
    }).addTo(map);
  }

  async function refrescarPreview() {
    if (!cantonSel) return;
    const necesarias = capasNecesarias();
    // Quita las que ya no hacen falta.
    Object.keys(layerLookup).forEach((nombre) => {
      if (!necesarias.has(nombre)) { map.removeLayer(layerLookup[nombre]); delete layerLookup[nombre]; }
    });
    // Carga las que faltan.
    for (const nombre of necesarias) {
      if (!layerLookup[nombre]) await cargarCapa(capaPorNombre[nombre]);
    }
    const n = necesarias.size;
    $('vistaPrevia').textContent = n
      ? `Vista previa — ${n} capa${n === 1 ? '' : 's'} de insumo`
      : 'Vista previa — los mapas elegidos se arman en el PDF';
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
      habilitarCatalogo(true);
      if (cantonLayer) map.removeLayer(cantonLayer);
      cantonLayer = L.geoJSON(cantonSel, { style: { color: '#4f8cff', weight: 2, fillOpacity: 0.04 } }).addTo(map);
      map.fitBounds(cantonLayer.getBounds(), { padding: [20, 20] });
      actualizarExport();
      refrescarPreview();
    });
  }

  // ---------- exportar ----------
  function configActual() {
    return {
      municipalidad: $('muniNombre').value.trim() || null,
      logo: muniLogo,                         // data URL (o null)
      canton: $('selCanton').value || null,
      proyeccion: catalogo.proyeccion,
      mapas: [...seleccion],                  // ids de los mapas elegidos
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

  $('btnAtlas').addEventListener('click', () => {
    if (!cantonSel) { avisar('Elegí un cantón primero (paso 2).'); return; }
    document.title = `Atlas — ${$('selCanton').value}`;
    if (cantonLayer) map.fitBounds(cantonLayer.getBounds(), { padding: [20, 20] });
    setTimeout(() => window.print(), 450);
  });
})();
