/* PlanoExactoCR — lámina cartográfica del expediente (primera hoja, carta horizontal).
   Mapa completo del sitio (satélite con nombres, vías, ríos, curvas, límite distrital, radios, salud y escuela),
   recuadros de detalle del predio y de ubicación en el país, variables medidas, índice, potencialidades y riesgos. */
(function () {
  'use strict';
  const { esc, fnum } = PX;
  const L_ = PX.lamina = {};
  const TERRA = '#E8956F', TERRA_D = '#C8553D', HIDRO = '#4FA3F0', CURV = '#F1D3B3', VIA = '#FFD166';
  const titleCase = s => String(s || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());

  function radar(s) {
    const D = PX.DIMS, cy = 74, cx = 110, R = 52, ang = i => -Math.PI / 2 + i * 2 * Math.PI / D.length;
    const pt = (i, v) => [cx + Math.cos(ang(i)) * R * v, cy + Math.sin(ang(i)) * R * v];
    const ring = f => D.map((_, i) => pt(i, f).join(',')).join(' ');
    const poly = D.map((d, i) => pt(i, (s[d.k] == null ? 0 : s[d.k]) / 100).join(',')).join(' ');
    const lab = ['Jurídica', 'Precio/m²', 'Servicios', 'Restricciones'];
    return `<svg viewBox="0 0 220 150" class="radar" role="img" aria-label="Radar del índice">
      ${[0.25, 0.5, 0.75, 1].map(f => `<polygon points="${ring(f)}" class="rg"/>`).join('')}
      ${D.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" class="rg"/>`).join('')}
      <polygon points="${poly}" class="rv"/>
      ${D.map((d, i) => { const [x, y] = pt(i, 1.2); const anc = i === 1 ? 'start' : i === 3 ? 'end' : 'middle'; return `<text x="${x}" y="${y + (i === 0 ? -2 : i === 2 ? 8 : 3)}" text-anchor="${anc}" class="rl">${lab[i]} <tspan class="rn">${s[d.k] ?? '–'}</tspan></text>`; }).join('')}
    </svg>`;
  }

  function variables(r) {
    const e = r.ent || {}, v = [];
    const z = e.zh, pc = PX.pecr(r), tp = PX.topo(r);
    if (z) v.push(['Zona homogénea', `${z.c} · ${PX.mt(z.v, 'CRC')}/m²`]);
    if (pc) v.push(['Escala PECR (PlanoExactoCR)', `Nivel ${pc[0]} de ${PX.PECR_N}`]);
    v.push(['Agua potable', e.aguaS ? e.aguaS.join(', ') : 'Sin cobertura registrada', !e.aguaS]);
    if (tp) v.push(['Topografía', tp.clase + (e.pend != null ? ` (${e.pend} %)` : ''), tp.clase.includes('quebrada')]);
    v.push(['Normativa', e.pr && e.pr.si ? `Plan regulador${e.pr.anno ? ' ' + e.pr.anno : ''}` : 'Nacional INVU (sin plan)', !(e.pr && e.pr.si)]);
    const dm = PX.pro.dims(r); if (dm) v.push(['Dimensiones', `≈ ${fnum(dm.corto, 1)} × ${fnum(dm.largo, 1)} m`, dm.corto < 6]);
    if (e.cob) v.push(['Uso del suelo 2020', e.cob, e.cob === 'Cobertura forestal']);
    if (e.agua !== undefined) v.push(['Cauce más cercano', e.agua == null ? 'Ninguno a menos de 400 m' : PX.dist(e.agua), e.agua != null && e.agua <= 50]);
    if (e.via) v.push(['Vía más cercana', e.via.d <= 10 ? `${e.via.t}, al frente` : `${e.via.t} a ${PX.dist(e.via.d)}`]);
    if (false) v.push(['Relieve', [e.elev != null ? `${fnum(Math.round(e.elev))} m s. n. m.` : null, e.pend != null ? `pendiente ${e.pend} %` : e.suave ? 'pendiente suave' : null].filter(Boolean).join(' · '), e.pend >= 30]);

    if (e.costa != null && e.costa < 3000) v.push(['Costa', `a ${PX.dist(e.costa)}`, e.costa <= 250]);
    if (e.zv) v.push(['Zona de vida', e.zv]);
    return v.slice(0, 12);
  }

  L_.html = (r, s, meta) => {
    const a = PX.prof(r), e = r.ent || {};
    const pot = PX.pro.potencialidades(r).slice(0, 4), rie = PX.pro.riesgos(r).slice(0, 4);
    const all = PX.pro.riesgos(r), alto = all.filter(x => x.n === 3).length, med = all.filter(x => x.n === 2).length;
    const datos = r.isPlano
      ? [['Área según catastro', `<span class="num">${fnum(a)}</span> m²`], ['En remate', r.remate ? 'Sí' : 'No'], ['Finca', esc(r.fincaTxt)], ['Plano', esc(r.plano || '—')]]
      : [['Base vigente · ' + PX.ETAPA[r.st], PX.duo(r.bv, r.mon), 'w'], ['Fecha del remate', PX.fdate(r.next, true)], ['Área', a ? `<span class="num">${fnum(a)}</span> m²` : '—'], ['Precio por m²', r.usdm2 ? PX.duo(r.usdm2, 'USD') : '—'], ['Finca', esc(r.fincaTxt)], ['Plano', esc(r.plano || (r.planoCat ? PX.planoTxt(r.planoCat) : '—'))]];
    const fichaURL = location.origin + '/mapa#' + r.key;
    const pmQR = PX.qrSVG ? `<a class="pmqr" href="${esc(fichaURL)}" target="_blank" rel="noopener" title="Ver esta ficha actualizada en línea">${PX.qrSVG(fichaURL, { nivel: 'M', quiet: 1 })}</a>` : '';
    return `<section class="lamina page" aria-label="Lámina del lote">
      <header class="ph"><div class="lbrand"><span class="mark"><img src="assets/img/logo-mark.svg" alt="" width="40" height="32"></span><span class="wmcol"><span class="wm"><span class="w1">PLANO</span><span class="w2">EXACTO</span><span class="w3">CR</span></span><span class="lsub">${esc(PX.CONTACTO.web)} · @${esc(PX.CONTACTO.ig)}</span></span></div>
        <div class="pt"><span class="colkick">Resumen orientativo</span><b>${esc(r.nom)}</b><span>${esc(r.lugar || '')}</span></div><div class="pm">${pmQR}<span class="pmtxt"><b class="num">${meta.folio}</b><span>${PX.fdate(new Date())}</span><small>Ficha en línea ↗</small></span></div></header>
      <div class="lbody">
        <div class="lmapcol">
          <div class="lmapwrap"><div id="lmap" class="lmap"></div>
            <div class="nflecha" aria-hidden="true"><svg viewBox="0 0 24 34" width="18" height="26"><path d="M12 2 L20 24 L12 19 L4 24 Z" fill="#073B32"/><text x="12" y="33" text-anchor="middle" font-size="9" font-weight="700" fill="#073B32">N</text></svg></div>
            <div class="inset det"><div id="ldet" class="lmap"></div><span class="ilab">Detalle del predio${a ? ` · <span class="num">${fnum(a)}</span> m²` : ''}</span></div>
            <div class="inset loc"><div id="lloc" class="lmap"></div><span class="ilab">${esc(r.cn || '')}, ${esc(r.pn || '')}</span></div>
            <div class="lleg lt">
              <span><i class="sw" style="background:${TERRA}88;border:2px solid ${TERRA_D}"></i>Predio${r.exact || r.isPlano ? '' : ' (aproximado)'}</span>
              <span><i class="ln" style="border-top:2px dashed #fff"></i>Radios 100, 250 y 500 m</span>
              <span><i class="ln" style="border-top:2.5px solid ${HIDRO}"></i>Ríos y quebradas</span>
              <span><i class="sw" style="background:#E6E3DC;border:1px solid #C9C6BB"></i>Vías públicas (Registro)</span>
              <span><i class="ln" style="border-top:1px solid ${CURV}"></i>Curvas cada 10 m</span>
              <span><i class="ln" style="border-top:1.5px dashed #F4F1EA"></i>Límite distrital</span>
              <span><i class="nb">1</i>Salud${e.salud ? ' · ' + esc(e.salud.n) : ''}</span>
              <span><i class="nb">2</i>Escuela${e.escP ? ' · ' + esc(titleCase(e.escP.t)) : ''}</span>
              <span><i class="sw" style="background:rgba(106,153,78,.3);border:1px solid rgba(106,153,78,.8)"></i>Cobertura de agua (AyA/ASADA, implícita)</span>
              <span><i class="sw" style="background:rgba(218,139,55,.3);border:1px solid rgba(218,139,55,.8)"></i>Postes y tendido eléctrico (ARESEP)</span>
              <span>Zona eléctrica por operador, si existe (ARESEP)</span>
            </div>
          </div>
          <div class="lvars">${variables(r).map(([k, v, w]) => `<div class="${w ? 'w' : ''}"><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>
        </div>
        <div class="lside">
          <div class="ldatos">${datos.map(([k, v, w]) => `<div class="${w || ''}"><small>${k}</small><b>${v}</b></div>`).join('')}</div>
          <div class="lidx"><div class="lscore"><span class="score big" style="--p:${s.total || 0}" data-v="${s.total ?? '–'}"></span><b>${PX.scoreLabel(s.total)}</b><small>Índice PlanoExacto</small></div>${radar(s)}</div>
          <div class="lpot"><h3>Potencialidades</h3>${pot.length ? pot.map(x => `<div><i>+</i><span><b>${esc(x.t)}.</b> ${esc(x.d)}</span></div>`).join('') : '<p>Sin ventajas destacadas en los datos disponibles.</p>'}</div>
          <div class="lrie"><h3>Riesgos posibles <small>${alto} altos · ${med} medios</small></h3>${rie.length ? rie.map(x => `<div class="n${x.n}"><i>${x.n === 1 ? 'i' : '!'}</i><span><b>${esc(x.t)}.</b> ${esc(x.d.split('. ')[0].replace(/\.$/, ''))}.</span></div>`).join('') : '<p>Sin riesgos detectados en los datos disponibles.</p>'}</div>
        </div>
      </div>
      <footer class="pf">Compendio de información pública y análisis orientativo: no es certificado de uso de suelo, certificación registral o catastral, avalúo ni estudio de título. Mapas © Esri, Maxar · Registro Inmobiliario · IGN.<span class="num">1</span></footer>
    </section>`;
  };

  // ---------- mapas ----------
  const sldLine = (name, c, w, op) => `<?xml version="1.0" encoding="UTF-8"?><StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"><NamedLayer><Name>${name}</Name><UserStyle><FeatureTypeStyle><Rule><LineSymbolizer><Stroke><CssParameter name="stroke">${c}</CssParameter><CssParameter name="stroke-width">${w}</CssParameter><CssParameter name="stroke-opacity">${op}</CssParameter></Stroke></LineSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
  // Los geoservicios públicos (SNIT, Wayback) a veces fallan una vez por lentitud o límite de
  // concurrencia, no porque falte la imagen: reintenta cada baldosa fallida un par de veces antes
  // de darla por perdida, para no dejar recuadros oscuros por un simple tropiezo de red.
  const conReintento = (capa) => {
    const intentos = new WeakMap();
    capa.on('tileerror', (e) => {
      const n = (intentos.get(e.tile) || 0) + 1;
      if (n > 2 || !e.tile) return;
      intentos.set(e.tile, n);
      setTimeout(() => { const src = e.tile.src; e.tile.src = ''; e.tile.src = src; }, 500 * n);
    });
    return capa;
  };
  const wms = (url, layers, o) => conReintento(L.tileLayer.wms(url, Object.assign({ layers, version: '1.1.1', format: 'image/png', transparent: true, maxZoom: 20 }, o)));
  const esri = (svc, o) => conReintento(L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, Object.assign({ maxZoom: 20, maxNativeZoom: 19 }, o)));
  const ringsLL = r => r.poly.map(p => p.map(ring => ring.map(([x, y]) => [y, x])));
  const num = (n, cls) => L.divIcon({ className: 'lnum ' + (cls || ''), html: n, iconSize: [22, 22], iconAnchor: [11, 11] });
  const sldText = name => `<?xml version="1.0" encoding="UTF-8"?><StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"><NamedLayer><Name>${name}</Name><UserStyle><FeatureTypeStyle><Rule><TextSymbolizer><Label><ogc:PropertyName>nom_ofi</ogc:PropertyName></Label><Font><CssParameter name="font-family">SansSerif</CssParameter><CssParameter name="font-size">11</CssParameter><CssParameter name="font-style">italic</CssParameter></Font><Halo><Radius>1.5</Radius><Fill><CssParameter name="fill">#FFFFFF</CssParameter></Fill></Halo><Fill><CssParameter name="fill">#2E6FB0</CssParameter></Fill></TextSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
  const SNIT = {
    cat: () => wms('https://siri.snitcr.go.cr/Geoservicios/wms', 'catastro,catastro_aldia', { crs: L.CRS.EPSG4326, className: 'tl-cat' }),
    vias: () => wms('https://siri.snitcr.go.cr/Geoservicios/wms', 'vias_publicas', { crs: L.CRS.EPSG4326, className: 'tl-vias' }),
    hidro: () => wms('https://geos.snitcr.go.cr/be/IGN_5/wms', 'IGN_5:hidrografia_5000', { sld_body: sldLine('IGN_5:hidrografia_5000', HIDRO, 2.4, 1) }),
    curvas: () => wms('https://geos.snitcr.go.cr/be/IGN_5/wms', 'IGN_5:curvas_5000', { sld_body: sldLine('IGN_5:curvas_5000', CURV, 0.9, 0.85) })
  };
  const tip = (mk, t) => mk.bindTooltip(t, { permanent: true, direction: 'right', offset: [12, 0], className: 'ltip' });

  // Color por operador eléctrico: misma paleta oficial que usa el mapa principal (app.js),
  // repetida aquí porque la lámina del expediente no carga app.js.
  const EL_COL = { ICE: 'rgb(252,190,182)', CNFL: 'rgb(252,215,242)', ESPH: 'rgb(249,184,252)', JASEC: 'rgb(184,215,252)',
    COOPELESCA: 'rgb(252,239,204)', 'COOPEGUANACASTE R.L.': 'rgb(184,248,252)', COOPESANTOS: 'rgb(179,179,252)', COOPEALFARORUIZ: 'rgb(179,252,182)' };
  const elCol = o => EL_COL[o] || '#C9CED1';
  // ¿Esta geometría (Polygon/MultiPolygon) toca el recuadro [lonMin,latMin,lonMax,latMax]?
  function bboxToca(geom, bb) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (function walk(a) { if (typeof a[0] === 'number') { const [x, y] = a; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } else a.forEach(walk); })(geom.coordinates);
    return !(x1 < bb[0] || x0 > bb[2] || y1 < bb[1] || y0 > bb[3]);
  }

  // Servicios e infraestructura en la lámina: agua, electricidad por operador, postes
  // del tendido y cobertura móvil. Carga perezosa y NO bloqueante — cada capa se agrega
  // sola cuando llega, sin esperar a las demás ni retrasar el resto del mapa. Todas se
  // mandan al fondo (bringToBack) para que el predio siempre quede encima y visible.
  function cargarServicios(m, c) {
    const pad = 0.015, bb = [c[1] - pad, c[0] - pad, c[1] + pad, c[0] + pad]; // c = [lat, lon]
    PX.get('data/cobertura_concesiones.geojson').then(d => {
      const f = (d.features || []).filter(x => bboxToca(x.geometry, bb));
      if (!f.length) return;
      L.geoJSON({ type: 'FeatureCollection', features: f }, { interactive: false,
        style: { color: 'rgb(106,153,78)', weight: 1, opacity: 0.6, dashArray: '4,3', fillColor: 'rgb(106,153,78)', fillOpacity: 0.16 }
      }).addTo(m).bringToBack();
    }).catch(() => {});
    PX.get('data/electricidad.geojson').then(d => {
      const f = (d.features || []).filter(x => bboxToca(x.geometry, bb));
      if (!f.length) return;
      L.geoJSON({ type: 'FeatureCollection', features: f }, { interactive: false,
        style: x => ({ color: '#6E6E6E', weight: 0.5, opacity: 0.5, fillColor: elCol(x.properties.OPERADOR), fillOpacity: 0.22 })
      }).addTo(m).bringToBack();
    }).catch(() => {});
    PX.get('data/postes_cov.geojson').then(d => {
      const f = (d.features || []).filter(x => bboxToca(x.geometry, bb));
      if (!f.length) return;
      L.geoJSON({ type: 'FeatureCollection', features: f }, { interactive: false,
        style: { color: 'rgb(218,139,55)', weight: 0.8, opacity: 0.55, dashArray: '3,3', fillColor: 'rgb(218,139,55)', fillOpacity: 0.14 }
      }).addTo(m).bringToBack();
    }).catch(() => {});
    PX.cargarPostes().then(p => {
      if (!p || !p.ll) return;
      const pts = [];
      for (const [lon, lat] of p.ll) { if (lon >= bb[0] && lon <= bb[2] && lat >= bb[1] && lat <= bb[3]) { pts.push([lat, lon]); if (pts.length >= 400) break; } }
      if (!pts.length) return;
      const g = L.layerGroup(pts.map(ll => L.circleMarker(ll, { radius: 2.6, color: '#fff', weight: 0.8, fillColor: 'rgb(218,139,55)', fillOpacity: 0.95, interactive: false })));
      g.addTo(m);
    }).catch(() => {});
  }

  L_.maps = [];
  window.addEventListener('beforeprint', () => L_.maps.forEach(([mp, f]) => { mp.invalidateSize(false); f(); }));
  // ---------- Hoja satélite histórica ----------
  // Tres vistas del mismo punto en distintos años para mostrar cambio de uso del suelo.
  // Wayback de Esri provee tiles de fechas pasadas; ortofoto IGN 2017 cubre todo CR.
  // Se llama con await desde expediente.js justo después de L_.init.
  L_.WAYBACK_VERSIONS = [
    // { año, título, tileURL }
    // El release de Wayback más antiguo (10 = 2014-02-20) resultó ser, para buena parte del país
    // fuera del GAM, una baldosa "sin imagen" (resolución muy baja, no una foto real del sitio):
    // se verificó pidiendo esa baldosa directamente y comparando su tamaño con releases más
    // recientes. El release 4756 (2019-12-12) es el más antiguo que ya trae cobertura real y
    // nítida en todo el territorio, así que es el que usamos como "histórico".
    { y: 2024, t: 'Actual (~2024)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 19 },
    { y: 2017, t: 'Ortofoto IGN 2017', url: null, wms: true },   // WMS del SNIT
    // OJO con esta capa: los releases de Wayback NO tienen la misma resolución nativa que el mapa
    // actual. Fuera de ese máximo (variable según la zona; 17 es el que se comprobó disponible en
    // todo el país para este release) el servidor responde 404 baldosa por baldosa — eso, y no un
    // problema de red, era lo que dejaba el recuadro "Histórico" en blanco cuando el predio (por
    // tener polígono exacto) hacía zoom más allá de ese límite. maxNativeZoom evita pedir tiles
    // que no existen: Leaflet reutiliza la última baldosa real y la amplía en vez de pedir z18/19.
    { y: 2019, t: 'Histórico (~2019)', url: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/4756/{z}/{y}/{x}', maxNativeZoom: 17 },
  ];

  L_.initHistorial = async r => {
    if (!window.L || !r.ll) return;
    const c = [r.ll[1], r.ll[0]];
    const opt = { zoomControl: false, attributionControl: false, scrollWheelZoom: false, zoomSnap: 0.5, dragging: false, doubleClickZoom: false, keyboard: false, touchZoom: false };
    const pg = r.poly ? L.polygon(ringsLL(r), { color: TERRA_D, weight: 2.5, fillColor: TERRA, fillOpacity: 0.3 }) : null;
    for (const v of L_.WAYBACK_VERSIONS) {
      const el = document.getElementById('hmap-' + v.y);
      if (!el) continue;
      const m = L.map(el, opt);
      if (v.wms) {
        // Ortofoto IGN 2017 (SNIT WMS)
        conReintento(L.tileLayer.wms('https://geos1.snitcr.go.cr/Ortofoto2017/wms', {
          layers: 'Ortofoto2017:ortofoto2017_5000_altaresolucion', format: 'image/jpeg',
          version: '1.1.1', maxZoom: 20, maxNativeZoom: 20
        })).addTo(m);
      } else {
        conReintento(L.tileLayer(v.url, { maxZoom: 20, maxNativeZoom: v.maxNativeZoom || 19 })).addTo(m);
      }
      // Superponer catastro semitransparente
      wms('https://siri.snitcr.go.cr/Geoservicios/wms', 'catastro,catastro_aldia', {
        crs: L.CRS.EPSG4326, opacity: 0.5, className: 'tl-cat'
      }).addTo(m);
      if (pg) pg.addTo(m); else L.circleMarker(c, { radius: 10, color: TERRA_D, weight: 2.5, fill: false }).addTo(m);
      const fit = pg
        ? () => m.fitBounds(pg.getBounds(), { padding: [12, 12], maxZoom: 18 })
        : () => m.setView(c, 17);
      fit();
      L_.maps.push([m, fit]);
    }
  };

  L_.init = async r => {
    L_.maps.forEach(([mp]) => mp.remove()); L_.maps = [];
    if (!window.L || !r.ll) return;
    const c = [r.ll[1], r.ll[0]], e = r.ent || {};
    const opt = { zoomControl: false, attributionControl: false, scrollWheelZoom: false, zoomSnap: 0.25 };
    const pg = r.poly ? L.polygon(ringsLL(r), { color: TERRA_D, weight: 3, fillColor: TERRA, fillOpacity: 0.4 }) : null;

    // Mapa principal: el sitio y su entorno inmediato
    // Mapa principal sutil: fondo claro con relieve sombreado, predios y vías atenuados, ríos y nombres
    const m = L.map('lmap', opt).setView(c, 16);
    m.createPane('lbl').style.zIndex = 450;
    // Base clara de Esri (CARTO exige llave de API desde 2026)
    const esriC = v => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${v}/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 20, maxNativeZoom: 16 });
    esriC('World_Light_Gray_Base').addTo(m);
    esri('Elevation/World_Hillshade', { opacity: 0.22, className: 'tl-hill' }).addTo(m);
    SNIT.vias().addTo(m); SNIT.curvas().addTo(m); SNIT.hidro().addTo(m);   // mapa limpio: sin la malla del catastro
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 16, pane: 'lbl' }).addTo(m);
    wms('https://geos.snitcr.go.cr/be/IGN_NG/wms', 'IGN_NG:hidronimos_25k', { pane: 'lbl', sld_body: sldText('IGN_NG:hidronimos_25k') }).addTo(m);
    cargarServicios(m, c);
    [100, 250, 500].forEach(rad => {
      L.circle(c, { radius: rad, color: '#55635D', weight: 1, dashArray: '4 6', fill: false, interactive: false, opacity: 0.7 }).addTo(m);
      L.marker([c[0] + rad / 111320, c[1]], { icon: L.divIcon({ className: 'lrad', html: rad + ' m', iconSize: [48, 14], iconAnchor: [24, 7] }), interactive: false }).addTo(m);
    });
    if (pg) pg.addTo(m); else L.circle(c, { radius: 600, color: TERRA_D, weight: 2, dashArray: '6 5', fillColor: TERRA, fillOpacity: 0.12 }).addTo(m);
    if (pg) pg.bindTooltip('Predio', { permanent: true, direction: 'right', offset: [14, 0], className: 'ltip' }); else tip(L.marker(c, { icon: num('P', 'p') }), 'Predio (aproximado)').addTo(m);
    const b0 = L.latLng(c).toBounds(1100), pts = [b0.getNorthEast(), b0.getSouthWest()];
    if (e.salud && e.salud.ll) { const p = L.latLng(e.salud.ll[1], e.salud.ll[0]); tip(L.marker(p, { icon: num('1') }), `${esc(e.salud.n)} · ${PX.dist(e.salud.d)}`).addTo(m); if (e.salud.d <= 1600) pts.push(p); }
    if (e.escP) { const p = L.latLng(e.escP.ll[1], e.escP.ll[0]); tip(L.marker(p, { icon: num('2') }), `${esc(titleCase(e.escP.t))} · ${PX.dist(e.esc)}`).addTo(m); if (e.esc <= 1600) pts.push(p); }
    const fit = () => m.fitBounds(L.latLngBounds(pts).pad(0.06), { paddingTopLeft: [10, 10], paddingBottomRight: [10, 10], maxZoom: 17 });
    fit();
    L.control.scale({ position: 'topleft', metric: true, imperial: false, maxWidth: 130 }).addTo(m);
    L_.maps.push([m, fit]);
    PX.get('data/distritos.geojson').then(D => {
      const f = D.features.filter(x => r.dc ? x.properties.c === r.dc : PX.inGeom(r.ll[0], r.ll[1], x.geometry));
      L.geoJSON({ type: 'FeatureCollection', features: f }, { style: { color: '#F4F1EA', weight: 2, dashArray: '8 6', fill: false, opacity: 0.9 }, interactive: false }).addTo(m);
    }).catch(() => {});

    // Recuadro: detalle del predio
    const d = L.map('ldet', opt).setView(c, 18);
    d.getContainer().classList.add('on-sat');
    esri('World_Imagery', { maxNativeZoom: 18 }).addTo(d); SNIT.curvas().addTo(d); SNIT.hidro().addTo(d);
    if (r.poly) L.polygon(ringsLL(r), { color: TERRA_D, weight: 3, fillColor: TERRA, fillOpacity: 0.3 }).addTo(d);
    else L.circle(c, { radius: 600, color: TERRA_D, weight: 2, dashArray: '6 5', fill: false }).addTo(d);
    // Sin polígono exacto, un acercamiento fijo (17) mantiene el recuadro realmente "de detalle"
    // en vez de alejarse hasta verse como el mapa principal (antes caía a zoom 14).
    const dfit = () => pg ? d.fitBounds(pg.getBounds(), { padding: [16, 16], maxZoom: 18 }) : d.setView(c, 17);
    dfit(); L_.maps.push([d, dfit]);

    // Recuadro: ubicación en el país
    try {
      const cant = await PX.get('data/cantones.geojson');
      const lo = L.map('lloc', Object.assign({}, opt, { dragging: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false }));
      const lfit = () => lo.fitBounds([[8.03, -85.95], [11.22, -82.55]]); lfit();
      L.geoJSON(cant, { style: f => { const mine = r.cn && f.properties.k === r.cn && Math.floor(f.properties.c / 100) === r.prov; return { color: '#B9B4A7', weight: 0.4, fillColor: mine ? TERRA_D : '#ECE8DE', fillOpacity: 1 }; }, interactive: false }).addTo(lo);
      L.circleMarker(c, { radius: 3.5, color: '#fff', weight: 1.2, fillColor: '#073B32', fillOpacity: 1 }).addTo(lo);
      L_.maps.push([lo, lfit]);
    } catch (err) {}
  };
})();
