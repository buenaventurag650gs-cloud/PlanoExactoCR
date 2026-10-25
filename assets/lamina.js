/* PlanoExactoCR — lámina cartográfica del expediente (primera hoja, carta horizontal).
   Mapa completo del sitio (satélite con nombres, vías, ríos, curvas, catastro, límite distrital, radios, salud y escuela),
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
    v.push(['Normativa', e.pr && e.pr.si ? `Plan regulador${e.pr.anno ? ' ' + e.pr.anno : ''}` : 'Nacional INVU (sin plan)', !(e.pr && e.pr.si)]);
    const dm = PX.pro.dims(r); if (dm) v.push(['Dimensiones', `≈ ${fnum(dm.corto, 1)} × ${fnum(dm.largo, 1)} m`, dm.corto < 6]);
    if (e.cob) v.push(['Uso del suelo 2020', e.cob, e.cob === 'Cobertura forestal']);
    if (e.agua !== undefined) v.push(['Cauce más cercano', e.agua == null ? 'Ninguno a menos de 400 m' : PX.dist(e.agua), e.agua != null && e.agua <= 50]);
    if (e.via) v.push(['Vía más cercana', e.via.d <= 10 ? `${e.via.t}, al frente` : `${e.via.t} a ${PX.dist(e.via.d)}`]);
    if (e.elev != null || e.pend != null || e.suave) v.push(['Relieve', [e.elev != null ? `${fnum(Math.round(e.elev))} m s. n. m.` : null, e.pend != null ? `pendiente ${e.pend} %` : e.suave ? 'pendiente suave' : null].filter(Boolean).join(' · '), e.pend >= 30]);
    if (e.salud) v.push(['Salud', `${e.salud.c} a ${PX.dist(e.salud.d)}`]);
    if (e.esc != null) v.push(['Escuela', `a ${PX.dist(e.esc)}`]);
    if (e.costa != null && e.costa < 3000) v.push(['Costa', `a ${PX.dist(e.costa)}`, e.costa <= 250]);
    if (e.zv) v.push(['Zona de vida', e.zv]);
    if (e.cu) v.push(['Cuenca', e.cu]);
    return v.slice(0, 12);
  }

  L_.html = (r, s, meta) => {
    const a = PX.prof(r), e = r.ent || {};
    const pot = PX.pro.potencialidades(r).slice(0, 4), rie = PX.pro.riesgos(r).slice(0, 4);
    const all = PX.pro.riesgos(r), alto = all.filter(x => x.n === 3).length, med = all.filter(x => x.n === 2).length;
    const datos = r.isPlano
      ? [['Área según catastro', `<span class="num">${fnum(a)}</span> m²`], ['En remate', r.remate ? 'Sí' : 'No'], ['Finca', esc(r.fincaTxt)], ['Plano', esc(r.plano || '—')]]
      : [['Base vigente · ' + PX.ETAPA[r.st], PX.duo(r.bv, r.mon), 'w'], ['Fecha del remate', PX.fdate(r.next, true)], ['Área', a ? `<span class="num">${fnum(a)}</span> m²` : '—'], ['Precio por m²', r.usdm2 ? PX.duo(r.usdm2, 'USD') : '—'], ['Finca', esc(r.fincaTxt)], ['Plano', esc(r.plano || (r.planoCat ? PX.planoTxt(r.planoCat) : '—'))]];
    return `<section class="lamina page" aria-label="Lámina del lote">
      <header class="ph"><div class="lbrand"><span class="mark"><img src="assets/img/logo-mark.webp" alt="" width="40" height="28"></span><span class="wm"><span class="w1">PLANO</span><span class="w2">EXACTO</span><span class="w3">CR</span></span></div>
        <div class="pt"><b>${esc(r.nom)}</b><span>${esc(r.lugar || '')}</span></div><div class="pm"><b class="num">${meta.folio}</b><span>${PX.fdate(new Date())}</span></div></header>
      <div class="lbody">
        <div class="lmapcol">
          <div class="lmapwrap"><div id="lmap" class="lmap"></div>
            <div class="nflecha" aria-hidden="true"><svg viewBox="0 0 24 34" width="18" height="26"><path d="M12 2 L20 24 L12 19 L4 24 Z" fill="#15302A"/><text x="12" y="33" text-anchor="middle" font-size="9" font-weight="700" fill="#15302A">N</text></svg></div>
            <div class="inset det"><div id="ldet" class="lmap"></div><span class="ilab">Detalle del predio${a ? ` · <span class="num">${fnum(a)}</span> m²` : ''}</span></div>
            <div class="inset loc"><div id="lloc" class="lmap"></div><span class="ilab">${esc(r.cn || '')}, ${esc(r.pn || '')}</span></div>
            <div class="lleg">
              <span><i class="sw" style="background:${TERRA}88;border:2px solid ${TERRA_D}"></i>Predio${r.exact || r.isPlano ? '' : ' (aproximado)'}</span>
              <span><i class="ln" style="border-top:2px dashed #fff"></i>Radios 100, 250 y 500 m</span>
              <span><i class="ln" style="border-top:2.5px solid ${HIDRO}"></i>Ríos y quebradas</span>
              <span><i class="ln" style="border-top:2px solid ${VIA}"></i>Vías públicas</span>
              <span><i class="ln" style="border-top:1px solid ${CURV}"></i>Curvas cada 10 m</span>
              <span><i class="ln" style="border-top:1.5px dashed #F4F1EA"></i>Límite distrital</span>
              <span><i class="nb">1</i>Salud${e.salud ? ' · ' + esc(e.salud.n) : ''}</span>
              <span><i class="nb">2</i>Escuela${e.escP ? ' · ' + esc(titleCase(e.escP.t)) : ''}</span>
            </div>
          </div>
          <div class="lvars">${variables(r).map(([k, v, w]) => `<div class="${w ? 'w' : ''}"><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>
        </div>
        <div class="lside">
          <div class="ldatos">${datos.map(([k, v, w]) => `<div class="${w || ''}"><small>${k}</small><b>${v}</b></div>`).join('')}</div>
          <div class="lidx"><div class="lscore"><span class="score big" style="--p:${s.total || 0}" data-v="${s.total ?? '–'}"></span><b>${PX.scoreLabel(s.total)}</b><small>Índice PlanoExacto</small></div>${radar(s)}</div>
          <div class="lpot"><h3>Potencialidades</h3>${pot.length ? pot.map(x => `<div><i>+</i><span><b>${esc(x.t)}.</b> ${esc(x.d)}</span></div>`).join('') : '<div><span>Sin ventajas destacadas en los datos disponibles.</span></div>'}</div>
          <div class="lrie"><h3>Riesgos posibles <small>${alto} altos · ${med} medios</small></h3>${rie.length ? rie.map(x => `<div class="n${x.n}"><i>${x.n === 1 ? 'i' : '!'}</i><span><b>${esc(x.t)}.</b> ${esc(x.d.split('. ')[0].replace(/\.$/, ''))}.</span></div>`).join('') : '<div><span>Sin riesgos detectados en los datos disponibles.</span></div>'}</div>
        </div>
      </div>
      <footer class="pf">Compendio de información pública y análisis orientativo: no es certificado de uso de suelo, certificación registral o catastral, avalúo ni estudio de título. Mapas © Esri, Maxar · Registro Inmobiliario · IGN.<span class="num">1</span></footer>
    </section>`;
  };

  // ---------- mapas ----------
  const sldLine = (name, c, w, op) => `<?xml version="1.0" encoding="UTF-8"?><StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"><NamedLayer><Name>${name}</Name><UserStyle><FeatureTypeStyle><Rule><LineSymbolizer><Stroke><CssParameter name="stroke">${c}</CssParameter><CssParameter name="stroke-width">${w}</CssParameter><CssParameter name="stroke-opacity">${op}</CssParameter></Stroke></LineSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
  const wms = (url, layers, o) => L.tileLayer.wms(url, Object.assign({ layers, version: '1.1.1', format: 'image/png', transparent: true, maxZoom: 20 }, o));
  const esri = (svc, o) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, Object.assign({ maxZoom: 20, maxNativeZoom: 19 }, o));
  const ringsLL = r => r.poly.map(p => p.map(ring => ring.map(([x, y]) => [y, x])));
  const num = (n, cls) => L.divIcon({ className: 'lnum ' + (cls || ''), html: n, iconSize: [22, 22], iconAnchor: [11, 11] });
  const SNIT = {
    cat: () => wms('https://siri.snitcr.go.cr/Geoservicios/wms', 'catastro,catastro_aldia', { opacity: 0.8 }),
    vias: () => wms('https://siri.snitcr.go.cr/Geoservicios/wms', 'vias_publicas', { opacity: 0.85 }),
    hidro: () => wms('https://geos.snitcr.go.cr/be/IGN_5/wms', 'IGN_5:hidrografia_5000', { sld_body: sldLine('IGN_5:hidrografia_5000', HIDRO, 2.4, 1) }),
    curvas: () => wms('https://geos.snitcr.go.cr/be/IGN_5/wms', 'IGN_5:curvas_5000', { sld_body: sldLine('IGN_5:curvas_5000', CURV, 0.9, 0.85) })
  };
  const tip = (mk, t) => mk.bindTooltip(t, { permanent: true, direction: 'right', offset: [12, 0], className: 'ltip' });

  L_.maps = [];
  window.addEventListener('beforeprint', () => L_.maps.forEach(([mp, f]) => { mp.invalidateSize(false); f(); }));
  L_.init = async r => {
    L_.maps.forEach(([mp]) => mp.remove()); L_.maps = [];
    if (!window.L || !r.ll) return;
    const c = [r.ll[1], r.ll[0]], e = r.ent || {};
    const opt = { zoomControl: false, attributionControl: false, scrollWheelZoom: false, zoomSnap: 0.25 };
    const pg = r.poly ? L.polygon(ringsLL(r), { color: TERRA_D, weight: 3, fillColor: TERRA, fillOpacity: 0.4 }) : null;

    // Mapa principal: el sitio y su entorno inmediato
    const m = L.map('lmap', opt).setView(c, 16);
    esri('World_Imagery').addTo(m);
    SNIT.curvas().addTo(m); SNIT.cat().addTo(m); SNIT.vias().addTo(m); SNIT.hidro().addTo(m);
    esri('Reference/World_Transportation', { opacity: 0.7 }).addTo(m);
    esri('Reference/World_Boundaries_and_Places').addTo(m);
    [100, 250, 500].forEach(rad => {
      L.circle(c, { radius: rad, color: '#fff', weight: 1.4, dashArray: '5 6', fill: false, interactive: false, opacity: 0.9 }).addTo(m);
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
    esri('World_Imagery').addTo(d); SNIT.curvas().addTo(d); SNIT.cat().addTo(d); SNIT.hidro().addTo(d);
    if (r.poly) L.polygon(ringsLL(r), { color: TERRA_D, weight: 3, fillColor: TERRA, fillOpacity: 0.3 }).addTo(d);
    else L.circle(c, { radius: 600, color: TERRA_D, weight: 2, dashArray: '6 5', fill: false }).addTo(d);
    const dfit = () => pg ? d.fitBounds(pg.getBounds(), { padding: [16, 16], maxZoom: 20 }) : d.setView(c, 14);
    dfit(); L_.maps.push([d, dfit]);

    // Recuadro: ubicación en el país
    try {
      const cant = await PX.get('data/cantones.geojson');
      const lo = L.map('lloc', Object.assign({}, opt, { dragging: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false }));
      const lfit = () => lo.fitBounds([[8.03, -85.95], [11.22, -82.55]]); lfit();
      L.geoJSON(cant, { style: f => { const mine = r.cn && f.properties.k === r.cn && Math.floor(f.properties.c / 100) === r.prov; return { color: '#B9B4A7', weight: 0.4, fillColor: mine ? TERRA_D : '#ECE8DE', fillOpacity: 1 }; }, interactive: false }).addTo(lo);
      L.circleMarker(c, { radius: 3.5, color: '#fff', weight: 1.2, fillColor: '#15302A', fillOpacity: 1 }).addTo(lo);
      L_.maps.push([lo, lfit]);
    } catch (err) {}
  };
})();
