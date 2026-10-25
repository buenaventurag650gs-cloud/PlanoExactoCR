/* PlanoExactoCR — lámina cartográfica del expediente (primera página, horizontal).
   Reúne en un mapa las variables del lote: predio, catastro, cauces, curvas, radios de distancia, salud y escuela cercanos,
   ubicación en el país, el índice PlanoExacto y las principales potencialidades y riesgos. */
(function () {
  'use strict';
  const { esc, fnum } = PX;
  const L_ = PX.lamina = {};
  const TERRA = '#D9906E', TERRA_D = '#B5603D', HIDRO = '#3B8BD9', CURV = '#A0826D';
  const titleCase = s => String(s || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());

  // Radar de las cuatro dimensiones del índice
  function radar(s) {
    const D = PX.DIMS, c = 78, cx = 110, R = 54, ang = i => -Math.PI / 2 + i * 2 * Math.PI / D.length;
    const pt = (i, v) => [cx + Math.cos(ang(i)) * R * v, c + Math.sin(ang(i)) * R * v];
    const ring = f => D.map((_, i) => pt(i, f).join(',')).join(' ');
    const poly = D.map((d, i) => pt(i, (s[d.k] == null ? 0 : s[d.k]) / 100).join(',')).join(' ');
    const lab = ['Jurídica', 'Precio/m²', 'Servicios', 'Restricciones'];
    return `<svg viewBox="0 0 220 156" class="radar" role="img" aria-label="Radar del índice PlanoExacto">
      ${[0.25, 0.5, 0.75, 1].map(f => `<polygon points="${ring(f)}" class="rg"/>`).join('')}
      ${D.map((_, i) => `<line x1="${cx}" y1="${c}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" class="rg"/>`).join('')}
      <polygon points="${poly}" class="rv"/>
      ${D.map((d, i) => { const [x, y] = pt(i, 1.24); return `<text x="${x}" y="${y + 3}" text-anchor="middle" class="rl">${lab[i]} <tspan class="rn">${s[d.k] ?? '–'}</tspan></text>`; }).join('')}
    </svg>`;
  }

  // Variables medidas que acompañan al mapa
  function variables(r) {
    const e = r.ent || {}, v = [];
    if (e.agua !== undefined) v.push(['Cauce más cercano', e.agua == null ? 'ninguno a < 400 m' : PX.dist(e.agua), e.agua != null && e.agua <= 50]);
    if (e.via) v.push(['Vía más cercana', e.via.d <= 10 ? `${e.via.t}, al frente` : `${e.via.t} a ${PX.dist(e.via.d)}`]);
    if (e.elev != null) v.push(['Elevación', `≈ ${fnum(Math.round(e.elev))} m s. n. m.`]);
    if (e.pend != null || e.suave) v.push(['Pendiente', e.pend != null ? `≈ ${e.pend} %` : 'suave', e.pend >= 30]);
    if (e.cob) v.push(['Cobertura 2020', e.cob, e.cob === 'Cobertura forestal']);
    if (e.costa != null && e.costa < 3000) v.push(['Costa', PX.dist(e.costa), e.costa <= 250]);
    if (e.zv) v.push(['Zona de vida', e.zv]);
    if (e.cu) v.push(['Cuenca', e.cu]);
    v.push(['Plan regulador', e.pr ? (e.pr.si ? `vigente${e.pr.anno ? ' (' + e.pr.anno + ')' : ''}` : 'sin plan vigente') : 'sin dato', e.pr && !e.pr.si]);
    return v;
  }

  L_.html = (r, s, meta) => {
    const a = PX.prof(r), m2 = r.bv && a ? PX.conv(r.bv, r.mon, PX.cur) / a : null;
    const pot = PX.pro.potencialidades(r).slice(0, 4), rie = PX.pro.riesgos(r).slice(0, 4);
    const rieAll = PX.pro.riesgos(r), alto = rieAll.filter(x => x.n === 3).length, med = rieAll.filter(x => x.n === 2).length;
    const e = r.ent || {};
    const datos = r.isPlano
      ? [['Área catastro', `${fnum(a)} m²`], ['Finca', r.fincaTxt], ['Plano', r.plano || '—'], ['En remate', r.remate ? 'Sí' : 'No']]
      : [['Base vigente', PX.money(r.bv, r.mon)], [PX.ETAPA[r.st], PX.fdate(r.next, true)], ['Área', a ? `${fnum(a)} m²` : '—'], ['Precio por m²', m2 ? PX.mh(m2, PX.cur) : '—'], ['Finca', esc(r.fincaTxt)], ['Plano', esc(r.plano || (r.planoCat ? PX.planoTxt(r.planoCat) : '—'))]];
    const ctxItems = [];
    if (e.salud && e.salud.ll) ctxItems.push(['1', `${esc(e.salud.n)}`, PX.dist(e.salud.d)]);
    if (e.escP) ctxItems.push(['2', esc(titleCase(e.escP.t)), PX.dist(e.esc)]);
    return `<section class="lamina" aria-label="Lámina del lote">
      <header class="lh">
        <div class="lbrand"><span class="mark"><img src="assets/img/logo-mark.webp" alt="" width="44" height="31"></span><span class="wm"><span class="w1">PLANO</span><span class="w2">EXACTO</span><span class="w3">CR</span></span></div>
        <div class="lt"><h1>${esc(r.nom)}</h1><span>${esc(r.lugar || '')}${r.bar && !r.nom.includes(r.bar) ? ' · ' + esc(r.bar) : ''}</span></div>
        <div class="lmeta"><b class="num">${meta.folio}</b><span>${PX.fdate(new Date())}</span></div>
      </header>
      <div class="lbody">
        <div class="lmapcol">
          <div class="lmapwrap"><div id="lmap" class="lmap"></div>
            <div class="nflecha" aria-hidden="true"><svg viewBox="0 0 24 34" width="20" height="28"><path d="M12 2 L20 24 L12 19 L4 24 Z" fill="#15302A"/><text x="12" y="33" text-anchor="middle" font-size="9" font-weight="700" fill="#15302A">N</text></svg></div>
            <div class="lvars"><b>Variables del sitio</b>${variables(r).map(([k, v, w]) => `<div class="${w ? 'w' : ''}"><span>${k}</span><em>${esc(v)}</em></div>`).join('')}</div>
            <div class="lleg">
              <span><i class="sw" style="background:${TERRA}66;border:2px solid ${TERRA_D}"></i>Predio${r.exact || r.isPlano ? '' : ' (aprox.)'}</span>
              <span><i class="ln" style="border-top:2px dashed #fff"></i>Radios 50 y 100 m</span>
              <span><i class="ln" style="border-top:2px solid ${HIDRO}"></i>Ríos y quebradas</span>
              <span><i class="ln" style="border-top:1px solid ${CURV}"></i>Curvas cada 10 m</span>
              <span><i class="sw" style="border:1px solid #fff;background:transparent"></i>Predios vecinos</span>
            </div>
          </div>
          <div class="lsmall">
            <div class="lmini"><div id="lctx" class="lmap"></div><div class="lcap"><b>Contexto</b>${ctxItems.map(([n, t, d]) => `<span><i class="nb">${n}</i>${t} · ${d}</span>`).join('') || '<span>Sin equipamientos cercanos registrados</span>'}</div></div>
            <div class="lmini"><div id="lloc" class="lloc"></div><div class="lcap"><b>Ubicación en Costa Rica</b><span>${esc([r.cn, r.pn].filter(Boolean).join(', '))}</span></div></div>
          </div>
        </div>
        <div class="lside">
          <div class="ldatos">${datos.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>
          <div class="lidx">
            <div class="lscore"><span class="score big" style="--p:${s.total || 0}" data-v="${s.total ?? '–'}"></span><b>${PX.scoreLabel(s.total)}</b><small>Índice PlanoExacto</small></div>
            ${radar(s)}
          </div>
          <div class="lpot"><h3>Potencialidades</h3>${pot.length ? pot.map(x => `<div><i>+</i><span><b>${esc(x.t)}.</b> ${esc(x.d)}</span></div>`).join('') : '<div><span>Sin ventajas destacadas en los datos disponibles.</span></div>'}</div>
          <div class="lrie"><h3>Riesgos posibles <small>${alto} altos · ${med} medios</small></h3>${rie.length ? rie.map(x => `<div class="n${x.n}"><i>${x.n === 1 ? 'i' : '!'}</i><span><b>${esc(x.t)}.</b> ${esc(x.d.split('. ')[0].replace(/\.$/, ''))}.</span></div>`).join('') : '<div><span>Sin riesgos detectados en los datos disponibles.</span></div>'}</div>
        </div>
      </div>
      <footer class="lf">Compendio de información pública y análisis orientativo. No es certificado de uso de suelo, certificación registral o catastral ni avalúo. Fuentes: Boletín Judicial, Registro Inmobiliario, IGN, INVU, MINAE, CCSS. Mapas © Esri, © OpenStreetMap, © CARTO.</footer>
    </section>`;
  };

  // ---------- mapas de la lámina ----------
  const sld = (name, rule) => `<?xml version="1.0" encoding="UTF-8"?><StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"><NamedLayer><Name>${name}</Name><UserStyle><FeatureTypeStyle><Rule><LineSymbolizer><Stroke><CssParameter name="stroke">${rule[0]}</CssParameter><CssParameter name="stroke-width">${rule[1]}</CssParameter><CssParameter name="stroke-opacity">${rule[2]}</CssParameter></Stroke></LineSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
  const wms = (url, layers, o) => L.tileLayer.wms(url, Object.assign({ layers, version: '1.1.1', format: 'image/png', transparent: true, maxZoom: 19 }, o));
  const esri = svc => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19 });
  const ringsLL = r => r.poly.map(p => p.map(ring => ring.map(([x, y]) => [y, x])));
  const num = (n, cls) => L.divIcon({ className: 'lnum ' + (cls || ''), html: n, iconSize: [22, 22], iconAnchor: [11, 11] });

  L_.maps = [];
  window.addEventListener('beforeprint', () => L_.maps.forEach(([mp, f]) => { mp.invalidateSize(false); f(); }));
  L_.init = async r => {
    L_.maps.forEach(([mp]) => mp.remove()); L_.maps = [];
    if (!window.L || !r.ll) return;
    const c = [r.ll[1], r.ll[0]], e = r.ent || {};
    const opt = { zoomControl: false, attributionControl: false, scrollWheelZoom: false, dragging: true, zoomSnap: 0.25 };
    // Detalle del predio
    const m = L.map('lmap', opt); m.setView(c, 17);
    esri('World_Imagery').addTo(m);
    wms('https://siri.snitcr.go.cr/Geoservicios/wms', 'catastro,catastro_aldia', { opacity: 0.75 }).addTo(m);
    wms('https://geos.snitcr.go.cr/be/IGN_5/wms', 'IGN_5:curvas_5000', { sld_body: sld('IGN_5:curvas_5000', ['#E9C9A8', 0.9, 0.8]) }).addTo(m);
    wms('https://geos.snitcr.go.cr/be/IGN_5/wms', 'IGN_5:hidrografia_5000', { sld_body: sld('IGN_5:hidrografia_5000', [HIDRO, 2.2, 1]) }).addTo(m);
    [50, 100].forEach(rad => {
      L.circle(c, { radius: rad, color: '#fff', weight: 1.5, dashArray: '5 5', fill: false, interactive: false }).addTo(m);
      L.marker([c[0] + rad / 111320, c[1]], { icon: L.divIcon({ className: 'lrad', html: rad + ' m', iconSize: [44, 14], iconAnchor: [22, 7] }), interactive: false }).addTo(m);
    });
    let bounds;
    if (r.poly) { const pg = L.polygon(ringsLL(r), { color: TERRA_D, weight: 3, fillColor: TERRA, fillOpacity: 0.35 }).addTo(m); bounds = pg.getBounds(); }
    else { L.circle(c, { radius: 600, color: TERRA_D, weight: 2, dashArray: '6 5', fillColor: TERRA, fillOpacity: 0.12 }).addTo(m); }
    const b100 = L.latLng(c).toBounds(250);
    const fit = () => m.fitBounds(bounds ? L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast()).extend(b100) : L.latLng(c).toBounds(2400), { padding: [10, 10] });
    fit();
    L.control.scale({ position: 'bottomright', metric: true, imperial: false, maxWidth: 120 }).addTo(m);

    // Contexto: predio, salud y escuela más cercanos
    const k = L.map('lctx', opt); k.setView(c, 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(k);
    const pts = [c];
    L.marker(c, { icon: num('P', 'p') }).addTo(k);
    if (e.salud && e.salud.ll) { const p = [e.salud.ll[1], e.salud.ll[0]]; pts.push(p); L.polyline([c, p], { color: '#15302A', weight: 1.2, dashArray: '3 4', opacity: 0.7 }).addTo(k); L.marker(p, { icon: num('1') }).addTo(k); }
    if (e.escP) { const p = [e.escP.ll[1], e.escP.ll[0]]; pts.push(p); L.polyline([c, p], { color: '#15302A', weight: 1.2, dashArray: '3 4', opacity: 0.7 }).addTo(k); L.marker(p, { icon: num('2') }).addTo(k); }
    const kfit = () => pts.length > 1 ? k.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 16 }) : k.setView(c, 14);
    kfit();
    L_.maps.push([m, fit], [k, kfit]);

    // Ubicación en el país (vector, sin teselas)
    try {
      const cant = await PX.get('data/cantones.geojson');
      const lo = L.map('lloc', Object.assign({}, opt, { dragging: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false }));
      lo.fitBounds([[8.0, -85.95], [11.25, -82.55]]);
      L_.maps.push([lo, () => lo.fitBounds([[8.0, -85.95], [11.25, -82.55]])]);
      L.geoJSON(cant, { style: f => { const mine = r.cn && f.properties.k === r.cn && Math.floor(f.properties.c / 100) === r.prov; return { color: '#9AA79F', weight: 0.5, fillColor: mine ? TERRA : '#E8E4DA', fillOpacity: 1 }; }, interactive: false }).addTo(lo);
      L.circleMarker(c, { radius: 4, color: '#fff', weight: 1.5, fillColor: '#15302A', fillOpacity: 1 }).addTo(lo);
    } catch (err) {}
  };
})();
