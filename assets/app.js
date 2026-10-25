/* PlanoExactoCR — mapa, filtros, búsqueda por plano, comparador, Top 10 y cuenta. */
(async function () {
  'use strict';
  const { $, esc, css, fdate, fnum, when } = PX;
  let R, DIST, CANT, ZV, META;
  try {
    [R, DIST, META] = await Promise.all([PX.get('data/remates.json'), PX.get('data/distritos.geojson'), PX.get('data/meta.json')]);
  } catch (e) { $('list').innerHTML = '<div class="empty">No se pudieron cargar los datos. Recarga la página.</div>'; return; }
  PX.tc = META.tc;
  PX.prepare(R);
  PX.ctx.dist = DIST;
  const live = R.filter(r => r.st >= 0);
  // capas secundarias: no bloquean el arranque
  const extra = Promise.all([
    PX.get('data/planes_reguladores.geojson').catch(() => null), PX.get('data/salud.json').catch(() => []),
    PX.get('data/cantones.geojson').catch(() => null), PX.get('data/zonasvida.geojson').catch(() => null)
  ]).then(([p, s, c, z]) => { Object.assign(PX.ctx, { planes: p, salud: s, ready: true }); CANT = c; ZV = z; prepZV(); drawVectors(); });

  const toast = t => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); };
  const lockMsg = (t) => { openPlanes(t); };

  // ---------- encabezado ----------
  const bmin = Math.min(...R.map(r => r.bol)), bmax = Math.max(...R.map(r => r.bol));
  $('src').textContent = `Boletín Judicial Nº ${bmin}–${bmax} · ${META.periodo}`;
  $('kpis').innerHTML = `<span><b class="num">${live.length}</b> remates de fincas vigentes</span>
    <span title="Tipo de cambio de referencia de venta del BCCR">TC BCCR ${PX.mh(PX.tc.venta, 'CRC')} · ${esc(PX.tc.fecha)}</span>`;
  function paintPlan() {
    const b = $('planBadge'); b.textContent = PX.isPro() ? 'PRO' : 'Gratis'; b.className = 'badge' + (PX.isPro() ? ' pro' : '');
    $('attrHint').hidden = PX.isPro();
  }

  // ---------- pestañas ----------
  let tab = 'rem';
  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
    ['rem', 'pla', 'cmp', 'top'].forEach(k => $('p-' + k).hidden = k !== t);
    if (t === 'cmp') renderCmp();
    if (t === 'top') renderTop();
    if (t === 'pla') renderPlaHist();
  }
  document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.t); });

  // ---------- filtros ----------
  PX.PROVS.forEach((p, i) => {
    $('fProv').insertAdjacentHTML('beforeend', `<option value="${i + 1}">${p} (${live.filter(r => r.prov === i + 1).length})</option>`);
    $('plaProv').insertAdjacentHTML('beforeend', `<option value="${i + 1}">${p}</option>`);
  });
  function fillCantones() {
    const p = +$('fProv').value, sel = $('fCanton'), keep = sel.value, cs = {};
    live.filter(r => !p || r.prov === p).forEach(r => { if (r.cn) cs[r.cn] = (cs[r.cn] || 0) + 1; });
    sel.innerHTML = '<option value="">Todos</option>' + Object.keys(cs).sort((a, b) => a.localeCompare(b, 'es')).map(c => `<option value="${esc(c)}"${c === keep ? ' selected' : ''}>${esc(c)} (${cs[c]})</option>`).join('');
  }
  fillCantones();
  const stOn = [true, true, true];
  $('stages').innerHTML = [0, 1, 2].map(i => `<button class="stg" aria-pressed="true" data-i="${i}" style="--c:var(${PX.SC[i]})"><i></i>${PX.ETAPA[i]} <span class="num">${live.filter(r => r.st === i).length}</span></button>`).join('');
  $('stages').addEventListener('click', e => { const b = e.target.closest('.stg'); if (!b) return; const i = +b.dataset.i; stOn[i] = !stOn[i]; b.setAttribute('aria-pressed', stOn[i]); apply(); });

  // Atributos del lote (suscripción)
  const ATTR = [
    ['plano', 'Terreno plano', r => r.tg.includes('plano')],
    ['constr', 'Con construcción', r => r.tg.includes('constr')],
    ['frente', 'Frente a vía pública', r => r.tg.includes('frente')],
    ['urbano', 'Zona urbana', r => r.tg.includes('urbano')],
    ['grande', 'Más de 1 000 m²', r => r.tg.includes('grande')],
    ['nobosque', 'Sin bosque', r => !r.tg.includes('bosque')],
    ['libre', 'Sin servidumbres ni hipoteca', r => !(r.serv && r.serv.length) && PX.score(r).juridica >= 85],
    ['salud', 'Salud a menos de 2 km', r => r.ent && r.ent.salud && r.ent.salud.d <= 2000]
  ];
  const attrOn = new Set();
  function paintAttrs() {
    $('attrs').innerHTML = ATTR.map(([k, n, f]) => `<button class="attr${PX.isPro() ? '' : ' locked'}" data-k="${k}" aria-pressed="${attrOn.has(k)}">${PX.isPro() ? '' : '<span class="lock"></span>'}${n} <span class="c">${live.filter(f).length}</span></button>`).join('');
  }
  $('attrs').addEventListener('click', e => {
    const b = e.target.closest('.attr'); if (!b) return;
    if (!PX.isPro()) return lockMsg('Los atributos del lote se filtran con la suscripción.');
    const k = b.dataset.k; attrOn.has(k) ? attrOn.delete(k) : attrOn.add(k); paintAttrs(); apply();
  });
  document.addEventListener('click', e => { if (e.target.closest('[data-planes]')) openPlanes(); });

  function setCurUI() {
    $('cCRC').setAttribute('aria-pressed', PX.cur === 'CRC'); $('cUSD').setAttribute('aria-pressed', PX.cur === 'USD');
    document.querySelectorAll('.amt .cu').forEach(e => e.textContent = PX.cur === 'CRC' ? '₡' : 'US$');
    document.querySelectorAll('.amt .cs').forEach(e => e.textContent = PX.cur === 'CRC' ? 'millones' : 'miles');
  }
  function setCur(c) {
    if (c !== PX.cur) { $('fMin').value = ''; $('fMax').value = ''; }
    PX.setCur(c); setCurUI(); apply(); drawVectors(); if (!$('lyrPanel').hidden) renderLyrPanel(); if (open) openFicha(open, false); if (tab === 'cmp') renderCmp(); if (tab === 'top') renderTop();
  }
  $('cCRC').onclick = () => setCur('CRC'); $('cUSD').onclick = () => setCur('USD');

  const filtState = () => ({ q: $('q').value, prov: $('fProv').value, canton: $('fCanton').value, st: stOn.slice(), min: $('fMin').value, max: $('fMax').value, cur: PX.cur,
    wk: $('fSemana').checked, tipo: $('fTipo').value, ex: $('fExact').checked, ns: $('fNoServ').checked, pr: $('fPR').checked, ag: $('fAgua').checked, attrs: [...attrOn], order: $('order').value });
  function setFilt(s) {
    $('q').value = s.q || ''; $('fProv').value = s.prov || ''; fillCantones(); $('fCanton').value = s.canton || '';
    (s.st || [true, true, true]).forEach((v, i) => { stOn[i] = v; document.querySelector(`.stg[data-i="${i}"]`).setAttribute('aria-pressed', v); });
    if (s.cur && s.cur !== PX.cur) { PX.setCur(s.cur); setCurUI(); }
    $('fMin').value = s.min || ''; $('fMax').value = s.max || ''; $('fSemana').checked = !!s.wk; $('fTipo').value = s.tipo || '';
    $('fExact').checked = !!s.ex; $('fNoServ').checked = !!s.ns; $('fPR').checked = !!s.pr; $('fAgua').checked = !!s.ag;
    attrOn.clear(); if (PX.isPro()) (s.attrs || []).forEach(a => attrOn.add(a)); $('order').value = s.order || 'fecha';
    paintAttrs(); setTab('rem'); apply(); fitShown();
  }

  let shown = [], limit = 100;
  const scoreCache = new Map();
  const sc = r => { if (!scoreCache.has(r.key)) scoreCache.set(r.key, PX.score(r)); return scoreCache.get(r.key); };
  function apply() {
    const qRaw = $('q').value.trim(), q = PX.norm(qRaw), qd = qRaw.replace(/\D/g, '');
    const p = +$('fProv').value, c = $('fCanton').value, t = $('fTipo').value;
    const mult = PX.cur === 'CRC' ? 1e6 : 1e3;
    const mn = parseFloat($('fMin').value), mx = parseFloat($('fMax').value);
    const mnV = isNaN(mn) ? null : mn * mult, mxV = isNaN(mx) ? null : mx * mult;
    const ex = $('fExact').checked, ns = $('fNoServ').checked, wk = $('fSemana').checked, pr = $('fPR').checked, ag = $('fAgua').checked;
    const af = ATTR.filter(a => attrOn.has(a[0]));
    shown = live.filter(r => {
      if (!stOn[r.st]) return false;
      if (p && r.prov !== p) return false;
      if (c && r.cn !== c) return false;
      if (t && r.tipo !== t) return false;
      if (ex && !r.exact) return false;
      if (ns && r.serv && r.serv.length) return false;
      if (wk && PX.days(r.next) > 7) return false;
      if (pr && !(r.ent && r.ent.pr && r.ent.pr.si)) return false;
      if (ag && (!r.ent || r.ent.agua == null || r.ent.agua <= 50)) return false;
      const v = PX.conv(r.bv, r.mon, PX.cur);
      if (mnV != null && v < mnV) return false;
      if (mxV != null && v > mxV) return false;
      if (af.length && !af.every(a => a[2](r))) return false;
      if (q) {
        const textHit = q.split(/\s+/).filter(Boolean).every(w => r.search.includes(w));
        const digitHit = qd.length >= 4 && r.searchDigits.includes(qd);
        if (!textHit && !digitHit) return false;
      }
      return true;
    });
    const o = $('order').value;
    const m2 = r => r.usdm2 == null ? Infinity : r.usdm2;
    shown.sort(o === 'precio' ? (a, b) => PX.usd(a.bv, a.mon) - PX.usd(b.bv, b.mon)
      : o === 'area' ? (a, b) => (PX.prof(b) || 0) - (PX.prof(a) || 0)
      : o === 'm2' ? (a, b) => m2(a) - m2(b)
      : o === 'score' ? (a, b) => (sc(b).total || 0) - (sc(a).total || 0)
      : (a, b) => a.next - b.next);
    // contadores por grupo
    const nU = (q ? 1 : 0) + (p ? 1 : 0) + (c ? 1 : 0), nR = stOn.filter(x => !x).length + (mnV != null) + (mxV != null) + wk, nC = !!t + ex + ns + pr + ag + attrOn.size;
    [['onU', nU], ['onR', nR], ['onC', nC]].forEach(([id, n]) => { $(id).hidden = !n; $(id).textContent = n + (n === 1 ? ' filtro' : ' filtros'); });
    limit = 100; renderList(); renderMarkers();
  }
  ['q', 'fMin', 'fMax'].forEach(id => $(id).addEventListener('input', apply));
  ['fCanton', 'fTipo', 'fExact', 'fNoServ', 'fSemana', 'fPR', 'fAgua', 'order'].forEach(id => $(id).addEventListener('change', apply));
  $('fProv').addEventListener('change', () => { fillCantones(); $('fCanton').value = ''; apply(); fitShown(); });
  $('fCanton').addEventListener('change', fitShown);
  $('saveSearch').onclick = () => {
    const n = prompt_('Nombre para esta búsqueda', [($('fCanton').value || PX.PROVS[+$('fProv').value - 1] || 'Todo el país'), $('fTipo').value].filter(Boolean).join(' · '));
    n.then(name => { if (!name) return; PX.acct.busquedas.unshift({ n: name, s: filtState(), t: Date.now() }); PX.saveAcct(); toast('Búsqueda guardada en Mi cuenta'); });
  };

  // ---------- lista ----------
  function itemHTML(r) {
    const tags = [r.exact ? `<span class="tag ok">Exacta por ${r.loc}</span>` : `<span class="tag warn">Aproximada</span>`, `<span class="tag">${esc(r.tipo)}</span>`];
    if (r.serv && r.serv.length) tags.push(`<span class="tag warn">Servidumbre</span>`);
    if (PX.sigo(r.key)) tags.push(`<span class="tag gold">Siguiendo</span>`);
    const a = PX.prof(r);
    return `<button class="item" role="listitem" data-k="${r.key}" style="--c:var(${PX.SC[r.st]})"${open === r.key ? ' aria-current="true"' : ''}>
      <span class="sb"></span>
      <span class="mid"><div class="t1">${esc(r.nom)}</div>
        <div class="t2">${esc([r.cn, r.pn].filter(Boolean).join(', ') || 'Ubicación por definir')} · ${a ? fnum(a) + ' m²' : 'área s/d'}</div>
        <div class="tags">${tags.join('')}</div></span>
      <span class="rt"><div class="price">${PX.money(r.bv, r.mon, true)}</div>
        <div class="when">${PX.ETAPA[r.st]}</div><div class="when">${when(r.next)}</div></span>
    </button>`;
  }
  function renderList() {
    $('count').innerHTML = `<b class="num">${shown.length}</b> de ${live.length}`;
    if (!shown.length) { $('list').innerHTML = '<div class="empty">Ningún remate cumple esos filtros. Prueba quitar alguno o ampliar el rango de precio.</div>'; return; }
    $('list').innerHTML = shown.slice(0, limit).map(itemHTML).join('') + (shown.length > limit ? `<button class="more" id="more">Mostrar ${Math.min(100, shown.length - limit)} más</button>` : '');
  }
  $('list').addEventListener('click', e => {
    if (e.target.id === 'more') { limit += 100; renderList(); return; }
    const b = e.target.closest('.item'); if (b) openFicha(b.dataset.k, true);
  });

  // ---------- mapa ----------
  const map = L.map('map', { preferCanvas: true, zoomControl: true, minZoom: 7, maxZoom: 19, zoomSnap: 0.5 }).setView([9.8, -84.2], 8);
  map.setMaxBounds([[7.5, -87.5], [11.6, -82]]);
  map.attributionControl.setPrefix(false);
  map.zoomControl.setPosition('bottomright');
  map.createPane('ctx').style.zIndex = 350;
  const ctxR = L.canvas({ pane: 'ctx' });
  const dark = () => (matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light') || document.documentElement.dataset.theme === 'dark';
  const cartoAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
  const osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const esri = (svc, o) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, Object.assign({ maxZoom: 19 }, o));
  const carto = (v, o) => L.tileLayer('https://{s}.basemaps.cartocdn.com/{v}/{z}/{x}/{y}{r}.png', Object.assign({ v, subdomains: 'abcd', maxZoom: 19, attribution: cartoAttr }, o));
  // Mapas base: Calles (CARTO Voyager, con color), OpenStreetMap estándar, topográfico, gris claro y satélite con nombres
  const voyager = carto('rastertiles/voyager');
  const base = {
    calles: L.layerGroup([voyager]),
    osm: L.layerGroup([L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: osmAttr })]),
    topo: L.layerGroup([esri('World_Topo_Map', { attribution: 'Mapa &copy; Esri, HERE, Garmin, USGS, OpenStreetMap' })]),
    gris: L.layerGroup([carto('light_all')]),
    sat: L.layerGroup([esri('World_Imagery', { attribution: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics' }),
      esri('Reference/World_Transportation', { opacity: 0.85 }), esri('Reference/World_Boundaries_and_Places', { attribution: 'Nombres &copy; Esri' })])
  };
  const BASES = [['calles', 'Calles'], ['osm', 'OpenStreetMap'], ['topo', 'Topográfico'], ['gris', 'Gris claro'], ['sat', 'Satélite con nombres']];

  // Estilos propios para los servicios WMS (SLD), en lugar de los colores originales
  const sld = (name, rules) => `<?xml version="1.0" encoding="UTF-8"?><StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"><NamedLayer><Name>${name}</Name><UserStyle><FeatureTypeStyle>${rules}</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
  const stroke = (c, w, op, dash) => `<Stroke><CssParameter name="stroke">${c}</CssParameter><CssParameter name="stroke-width">${w}</CssParameter><CssParameter name="stroke-opacity">${op}</CssParameter>${dash ? `<CssParameter name="stroke-dasharray">${dash}</CssParameter>` : ''}</Stroke>`;
  const lineRule = (c, w, op, dash) => `<Rule><LineSymbolizer>${stroke(c, w, op, dash)}</LineSymbolizer></Rule>`;
  const fill = (c, op) => `<Fill><CssParameter name="fill">${c}</CssParameter><CssParameter name="fill-opacity">${op}</CssParameter></Fill>`;
  const polyRule = (c, op, sc_, sw) => `<Rule><PolygonSymbolizer>${fill(c, op)}${sc_ ? stroke(sc_, sw || 0.8, 0.9) : ''}</PolygonSymbolizer></Rule>`;
  const MAF = [['Zona urbana', '#E07A5F'], ['Pasto', '#E9D8A6'], ['Cobertura forestal', '#2A9D8F'], ['Café', '#8D5B4C'], ['Caña', '#B5C99A'], ['Cultivo', '#F4A261'], ['Palma', '#6A994E'], ['Suelo desnudo', '#CDB4A0'], ['Red vial', '#9C9489']];
  const MAFO = '#C9CED1';
  const mafSld = sld('MAF2020', MAF.map(([n, c]) => `<Rule><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>CATEGORIA</ogc:PropertyName><ogc:Literal>${n}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter><PolygonSymbolizer>${fill(c, 0.62)}</PolygonSymbolizer></Rule>`).join('') + `<Rule><ElseFilter/><PolygonSymbolizer>${fill(MAFO, 0.4)}</PolygonSymbolizer></Rule>`);
  const wms = (url, layers, o) => L.tileLayer.wms(url, Object.assign({ layers, version: '1.1.1', format: 'image/png', transparent: true, maxZoom: 19 }, o));
  const SINIA = 'https://geodatos.sinia.go.cr/geoserver/';
  const HIDRO = '#3B8BD9', CURV = '#A0826D', PSA = '#6A994E', PROT = '#3B8BD9';

  // Zonas de vida: paleta por grupo climático
  const ZVG = [
    ['seco', 'Bosque seco tropical', '#E9C46A', n => /seco/.test(n)],
    ['paramo', 'Páramo', '#9D8DC9', n => /paramo/.test(n)],
    ['pluvial', 'Bosque pluvial', '#577590', n => /pluvial/.test(n) && !/transicion a pluvial/.test(n)],
    ['mhm', 'Muy húmedo montano', '#3C7F9E', n => /muy humedo montano/.test(n)],
    ['mhp', 'Muy húmedo premontano', '#2A9D8F', n => /muy humedo premontano/.test(n)],
    ['mht', 'Muy húmedo tropical', '#43AA8B', n => /muy humedo tropical/.test(n)],
    ['hm', 'Húmedo premontano y montano bajo', '#7CC48E', n => /humedo (premontano|montano)/.test(n)],
    ['ht', 'Húmedo tropical', '#A7C957', n => /humedo tropical/.test(n)]
  ];
  const zvGroup = name => { const n = PX.norm(name); return ZVG.find(g => g[3](n)) || ZVG[ZVG.length - 1]; };
  const PRC = [['vig', 'Plan regulador vigente', '#4C9A8A'], ['pro', 'En elaboración o revisión', '#E9C46A'], ['sin', 'Sin plan regulador', '#E76F51']];
  const prClass = c => /^PR Vigente|^Vigente/.test(c) ? PRC[0] : /elaboraci|revisi|Aprobado/.test(c) ? PRC[1] : PRC[2];

  const LY = [
    { g: 'Referencia', id: 'cantones', n: 'Límites cantonales', free: true, on: true, hover: true, lg: [['ln', 'var(--muted)', 'Cantón']] },
    { id: 'distritos', n: 'Límites distritales', free: true, on: true, lg: [['ln', 'var(--dline)', 'Distrito']] },
    { id: 'catastro', n: 'Predios del catastro', z: 15, free: true, on: true, mk: () => wms('https://siri.snitcr.go.cr/Geoservicios/wms', 'catastro,catastro_aldia', { minZoom: 15, opacity: 0.75, zIndex: 8, attribution: 'Catastro &copy; Registro Inmobiliario (SNIT)' }) },
    { id: 'planes', n: 'Estado del plan regulador', free: true, hover: true, lg: PRC.map(p => ['', p[2], p[1]]) },
    { g: 'Ambiente', id: 'zv', n: 'Zonas de vida', hover: true, lg: ZVG.map(g => ['', g[2], g[1]]) },
    { id: 'cob', n: 'Uso y cobertura del suelo 2020', hover: true, lg: MAF.filter(m => m[0] !== 'Red vial').map(([n, c]) => ['', c, n]).concat([['', MAFO, 'Otros']]), mk: () => wms(SINIA + 'MAF2020/wms', 'MAF2020', { sld_body: mafSld, opacity: 0.9, zIndex: 3, attribution: 'Mapa agropecuario y forestal 2020 &copy; MINAE' }) },
    { id: 'hidro', n: 'Ríos y quebradas', z: 13, lg: [['ln', HIDRO, 'Cauce (IGN 1:5 000)']], mk: () => wms('https://geos.snitcr.go.cr/be/IGN_5/wms', 'IGN_5:hidrografia_5000', { minZoom: 13, zIndex: 6, sld_body: sld('IGN_5:hidrografia_5000', lineRule(HIDRO, 1.6, 0.95)), attribution: 'Hidrografía &copy; IGN' }) },
    { id: 'curvas', n: 'Curvas de nivel cada 10 m', z: 15, lg: [['ln', CURV, 'Curva de nivel']], mk: () => wms('https://geos.snitcr.go.cr/be/IGN_5/wms', 'IGN_5:curvas_5000', { minZoom: 15, zIndex: 5, sld_body: sld('IGN_5:curvas_5000', lineRule(CURV, 0.7, 0.75)), attribution: 'Curvas &copy; IGN' }) },
    { id: 'prot', n: 'Franjas de protección de ríos', note: 'GAM, no oficial', z: 13, lg: [['', PROT, 'Franja de protección']], mk: () => wms(SINIA + 'PNUD_TEVU/wms', 'areas_proteccion_no_oficial', { minZoom: 13, zIndex: 4, sld_body: sld('areas_proteccion_no_oficial', polyRule(PROT, 0.22, PROT, 0.8)), attribution: 'Protección de ríos (no oficial) &copy; PNUD-TEVU' }) },
    { id: 'psa', n: 'Pago por servicios ambientales 2025', lg: [['', PSA, 'Contrato PSA']], mk: () => wms(SINIA + 'FONAFIFO/wms', 'psa2025', { zIndex: 4, sld_body: sld('psa2025', polyRule(PSA, 0.3, '#386641', 0.8)), attribution: 'PSA &copy; FONAFIFO' }) },
    { g: 'Mercado', id: 'precios', n: 'Precio por m² de remates', note: 'mediana por cantón', hover: true, lg: [] },
    { g: 'Infraestructura', id: 'vias', n: 'Vías públicas', z: 13, mk: () => wms('https://siri.snitcr.go.cr/Geoservicios/wms', 'vias_publicas', { minZoom: 13, opacity: 0.8, zIndex: 7, attribution: 'Vías públicas &copy; Registro Inmobiliario' }) },
    { id: 'salud', n: 'Centros de salud CCSS', lg: [['', 'var(--accent)', 'Hospital, clínica o EBAIS']] },
    { id: 'zmt', n: 'Zona pública costera', z: 13, mk: () => wms('https://geos.snitcr.go.cr/be/IGN/wms', 'IGN:lineas_digitales,IGN:mojones', { minZoom: 13, zIndex: 7, attribution: 'Zona pública &copy; IGN' }) }
  ];
  const lyrState = Object.assign(Object.fromEntries(LY.map(l => [l.id, !!l.on])), PX.store.get('px-layers', {}));
  let baseId = PX.store.get('px-base', 'calles'); if (!base[baseId]) baseId = 'calles';
  const vec = { precios: L.layerGroup(), cantones: L.layerGroup(), distritos: L.layerGroup(), planes: L.layerGroup(), zv: L.layerGroup(), salud: L.layerGroup() };
  for (const l of LY) l.layer = l.mk ? l.mk() : vec[l.id];
  const allowed = l => l.free || PX.isPro();
  function syncLayers() {
    for (const k in base) { if (k === baseId) base[k].addTo(map); else base[k].remove(); }
    for (const l of LY) { const on = lyrState[l.id] && allowed(l); if (on && !map.hasLayer(l.layer)) l.layer.addTo(map); if (!on && map.hasLayer(l.layer)) l.layer.remove(); }
    PX.store.set('px-layers', lyrState); PX.store.set('px-base', baseId);
  }
  function renderLyrPanel() {
    let h = `<h4>Mapa base</h4><div class="lyr" style="grid-template-columns:1fr 1fr;gap:6px 8px">${BASES.map(([k, n]) => `<label><input type="radio" name="base" value="${k}"${baseId === k ? ' checked' : ''}> ${n}</label>`).join('')}</div>`;
    for (const l of LY) {
      if (l.g) h += `<h4>${l.g}</h4>`;
      const ok = allowed(l), on = lyrState[l.id] && ok;
      h += `<label class="lyr${ok ? '' : ' locked'}" data-id="${l.id}"><input type="checkbox"${on ? ' checked' : ''}${ok ? '' : ' disabled'}>
        <span>${l.n}${l.note ? ` <small>${l.note}</small>` : ''}${l.z ? ` <small>zoom ${l.z}+</small>` : ''}</span><span>${l.free ? '' : PX.PRO}${ok && l.hover && on ? ' <small>pasa el mouse</small>' : ''}</span>
        ${on && l.lg ? `<span class="lg">${l.lg.map(([t, c, n]) => `<span><i class="${t}" style="--c:${c}"></i>${esc(n)}</span>`).join('')}</span>` : ''}</label>`;
    }
    h += `<div class="foot" style="padding:8px 14px 0">Servicios del SNIT, MINAE, INVU y CCSS con estilos propios de PlanoExactoCR. Algunos tardan unos segundos en cargar.</div>`;
    $('lyrPanel').innerHTML = h;
  }
  $('lyrBtn').onclick = () => { const p = $('lyrPanel'); p.hidden = !p.hidden; $('lyrBtn').setAttribute('aria-expanded', !p.hidden); if (!p.hidden) renderLyrPanel(); };
  $('lyrPanel').addEventListener('click', e => {
    const lk = e.target.closest('.lyr.locked'); if (lk) { e.preventDefault(); return lockMsg('Las capas ambientales y de infraestructura se incluyen en la suscripción.'); }
  });
  $('lyrPanel').addEventListener('change', e => {
    if (e.target.name === 'base') { baseId = e.target.value; syncLayers(); return; }
    const row = e.target.closest('.lyr'); if (!row) return;
    lyrState[row.dataset.id] = e.target.checked; syncLayers(); renderLyrPanel();
  });

  // Vectores locales
  function prepZV() { if (!ZV) return; for (const f of ZV.features) { const g = zvGroup(f.properties.n); f.properties.col = g[2]; f.bb = bbox(f.geometry); } if (CANT) CANT.features.forEach(f => f.bb = bbox(f.geometry)); if (PX.ctx.planes) PX.ctx.planes.features.forEach(f => f.bb = bbox(f.geometry)); }
  // Mediana de US$/m² de remates vigentes por cantón (código de cantón: provincia = primer dígito)
  const medCant = f => PX.medC[Math.floor(f.properties.c / 100) + '|' + f.properties.k];
  function priceClasses() {
    const brks = PX.cur === 'USD' ? [10, 25, 50, 100, 200] : [5000, 12000, 25000, 50000, 100000];
    const cols = ['#FFF3C4', '#F9D57E', '#F0A64A', '#D9733A', '#B04A2E', '#7A2E25'];
    const col = v => cols[brks.findIndex(b => v < b) < 0 ? brks.length : brks.findIndex(b => v < b)];
    const u = PX.cur === 'USD' ? 'US$' : '₡', f = v => v.toLocaleString('es-CR');
    const leg = cols.map((c, i) => ['', c, i === 0 ? `menos de ${u} ${f(brks[0])}/m²` : i === brks.length ? `${u} ${f(brks[i - 1])}/m² o más` : `${u} ${f(brks[i - 1])} – ${f(brks[i])}/m²`]).concat([['', 'var(--chip)', 'Menos de 3 remates con área']]);
    return { col, leg };
  }
  function bbox(g) { let a = [180, 90, -180, -90]; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; for (const p of polys) for (const [x, y] of p[0]) { if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y; } return a; }
  const hit = (fc, x, y) => fc && fc.features.find(f => (!f.bb || (x >= f.bb[0] && x <= f.bb[2] && y >= f.bb[1] && y <= f.bb[3])) && PX.inGeom(x, y, f.geometry));
  function drawVectors() {
    voyager.options.v = dark() ? 'dark_all' : 'rastertiles/voyager'; voyager.redraw();
    for (const k in vec) vec[k].clearLayers();
    const o = { renderer: ctxR, pane: 'ctx', interactive: false };
    vec.distritos.addLayer(L.geoJSON(DIST, Object.assign({ style: { color: css('--dline'), weight: 0.7, opacity: 0.9, dashArray: '2 3', fill: false }, attribution: 'Límites &copy; IGN (SNIT)' }, o)));
    if (CANT) vec.cantones.addLayer(L.geoJSON(CANT, Object.assign({ style: { color: css('--muted'), weight: 1.3, opacity: 0.7, fill: false } }, o)));
    if (PX.ctx.planes) vec.planes.addLayer(L.geoJSON(PX.ctx.planes, Object.assign({ style: f => { const c = prClass(f.properties.cat)[2]; return { color: c, weight: 1, opacity: 0.8, fillColor: c, fillOpacity: 0.2 }; }, attribution: 'Planes reguladores &copy; INVU' }, o)));
    if (CANT) {
      const PC = priceClasses();
      LY.find(l => l.id === 'precios').lg = PC.leg;
      vec.precios.addLayer(L.geoJSON(CANT, Object.assign({ style: f => { const m = medCant(f); const c = m ? PC.col(PX.conv(m.v, 'USD', PX.cur)) : null; return { color: css('--panel'), weight: 0.6, fillColor: c || css('--chip'), fillOpacity: c ? 0.62 : 0.25 }; } }, o)));
    }
    if (ZV) vec.zv.addLayer(L.geoJSON(ZV, Object.assign({ style: f => ({ color: f.properties.col, weight: 0.5, opacity: 0.6, fillColor: f.properties.col, fillOpacity: 0.38 }), attribution: 'Zonas de vida &copy; CENIGA (MINAE)' }, o)));
    for (const s of PX.ctx.salud || []) vec.salud.addLayer(L.circleMarker([s.ll[1], s.ll[0]], { renderer: ctxR, pane: 'ctx', radius: s.c === 'EBAIS' ? 3 : 5, color: css('--panel'), weight: 1, fillColor: css('--accent'), fillOpacity: 0.9, interactive: false }));
    syncLayers();
  }

  // Información al pasar el mouse por las capas temáticas
  let overMarker = false, hovT = null, cobT = null, lastCob = { k: null, v: null };
  const hb = $('hoverbox');
  map.on('mousemove', e => {
    if (hovT) return;
    hovT = requestAnimationFrame(() => { hovT = null; hover(e); });
  });
  map.on('mouseout', () => { hb.hidden = true; });
  function hover(e) {
    if (overMarker || window.innerWidth <= 900) { hb.hidden = true; return; }
    const x = e.latlng.lng, y = e.latlng.lat, rows = [];
    const on = id => lyrState[id] && allowed(LY.find(l => l.id === id));
    if (on('zv')) { const f = hit(ZV, x, y); if (f) rows.push(['Zona de vida', f.properties.n]); }
    if (on('cob')) {
      const k = x.toFixed(3) + ',' + y.toFixed(3);
      if (lastCob.k === k) rows.push(['Uso del suelo', lastCob.v || 'Sin dato']);
      else { rows.push(['Uso del suelo', '…']); clearTimeout(cobT); cobT = setTimeout(async () => { const v = await PX.cobertura(x.toFixed(5), y.toFixed(5)); lastCob = { k, v: v || 'Sin dato en este punto' }; hover(e); }, 380); }
    }
    if (on('planes')) { const f = hit(PX.ctx.planes, x, y); if (f) rows.push(['Plan regulador · ' + f.properties.canton, PX.prText(f.properties)]); }
    if (on('precios')) { const f = hit(CANT, x, y); if (f) { const m = medCant(f); rows.push(['Precio por m² · ' + f.properties.k, m ? `${PX.mt(PX.conv(m.v, 'USD', PX.cur), PX.cur)} por m² (mediana de ${m.n} remates)` : 'Menos de 3 remates con área']); } }
    if (on('cantones')) { const f = hit(CANT, x, y); const d = hit(DIST, x, y); if (f) rows.push(['Ubicación', [d && d.properties.d, f.properties.k].filter(Boolean).join(', ')]); }
    if (!rows.length) { hb.hidden = true; return; }
    hb.innerHTML = rows.map(([k, v]) => `<div><span>${esc(k)}</span><div>${esc(v)}</div></div>`).join('');
    const pt = e.containerPoint, W = map.getSize();
    hb.style.left = Math.min(pt.x + 14, W.x - 270) + 'px'; hb.style.top = Math.min(pt.y + 14, W.y - 120) + 'px';
    hb.hidden = false;
  }

  // Remates en el mapa
  const markers = L.layerGroup().addTo(map), polys = L.layerGroup().addTo(map), selLayer = L.layerGroup().addTo(map);
  function tip(r) {
    const a = PX.prof(r);
    if (r.isPlano) return `<span class="tipn">${esc(r.nom)}</span>${a ? fnum(a) + ' m²' : ''}<br><span class="tipm">${esc(r.lugar)}</span>`;
    return `<span class="tipn">${esc(r.nom)}</span>${PX.money(r.bv, r.mon, true)} · ${a ? fnum(a) + ' m²' : 'área s/d'}<br><span class="tipm">${PX.ETAPA[r.st]} · ${fdate(r.next)}${r.bar && !r.nom.includes(r.bar) ? '<br>' + esc(r.bar) : ''}</span>`;
  }
  const ringLL = r => r.poly.map(p => p.map(ring => ring.map(([x, y]) => [y, x])));
  function renderMarkers() {
    markers.clearLayers(); polys.clearLayers();
    const z = map.getZoom();
    for (const r of shown) {
      if (!r.ll) continue;
      const col = css(PX.SC[r.st]), ll = [r.ll[1], r.ll[0]];
      const on = l => { l.on('click', () => openFicha(r.key, true)); l.on('mouseover', () => { overMarker = true; hb.hidden = true; }); l.on('mouseout', () => { overMarker = false; }); };
      if (r.exact && r.poly && z >= 14) {
        const pg = L.polygon(ringLL(r), { color: col, weight: 2, fillColor: col, fillOpacity: 0.28 });
        on(pg); pg.bindTooltip(tip(r), { direction: 'top', sticky: true }); polys.addLayer(pg);
      }
      const m = r.exact
        ? L.circleMarker(ll, { radius: z >= 14 ? 4 : 6, color: css('--panel'), weight: 1.5, fillColor: col, fillOpacity: 1 })
        : L.circleMarker(ll, { radius: 9, color: col, weight: 1.5, dashArray: '3 3', fillColor: col, fillOpacity: 0.12 });
      on(m); m.bindTooltip(tip(r), { direction: 'top', offset: [0, -6] });
      markers.addLayer(m);
    }
  }
  map.on('zoomend', renderMarkers);
  function fitShown() { const pts = shown.filter(r => r.ll).map(r => [r.ll[1], r.ll[0]]); if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 }); }

  // ---------- ficha ----------
  let open = null;
  const scoreRing = v => `<span class="score" style="--p:${v || 0}" data-v="${v == null ? '–' : v}"></span>`;
  function barsHTML(s) {
    return `<div class="bars">${PX.DIMS.map(d => `<div class="bar"><span>${d.n}</span><b>${s[d.k] == null ? '–' : s[d.k]}</b><span class="track"><i style="width:${s[d.k] || 0}%"></i></span></div>`).join('')}</div>`;
  }
  function expBox(r) {
    const has = PX.tieneExp(r.key);
    const label = has ? 'Abrir expediente' : PX.isPro() ? `Generar expediente <small>(${PX.usoMes()} de ${PX.PRECIOS.cupo} este mes)</small>` : 'Generar expediente';
    return `<div class="expbox">
      <div class="p"><b>Expediente del lote</b>${has ? '<span class="tag ok">Disponible</span>' : PX.isPro() ? '<span class="tag gold">Incluido en tu suscripción</span>' : `<span>${PX.usdH(PX.PRECIOS.expediente)} por lote</span>`}</div>
      <ul><li>Texto del edicto${r.isPlano ? ' (si está en remate)' : ''}, datos registrales y despacho</li><li>Gravámenes y servidumbres explicados en lenguaje claro</li><li>Entorno: ríos, relieve, cobertura, salud, escuela y zona de vida</li><li>Análisis multidimensional y comparables de la zona</li><li>Versión imprimible con mapa del predio</li></ul>
      <div class="acts"><button class="btn primary" data-act="exp">${label}</button>${!has && !PX.isPro() ? '<button class="btn gold" data-planes>PRO: 200 al mes</button>' : ''}</div>
      <div class="foot">No es un certificado de uso de suelo ni una certificación registral: es un compendio de información pública con un análisis orientativo.</div></div>`;
  }
  function proBox(r) {
    const rs = PX.pro.riesgos(r), alto = rs.filter(x => x.n === 3).length, med = rs.filter(x => x.n === 2).length, pro = PX.isPro();
    const pot = PX.pro.potCalc(PX.pro.potDefaults(r));
    return `<div class="procard"><h3>${PX.PRO} Herramientas</h3>
      <p>${pro ? `Riesgos detectados: <b>${alto} altos</b> y <b>${med} medios</b>. Potencial aproximado: <b>${fnum(pot.total, 0)} m²</b> construibles.` : 'Potencial constructivo, prefactibilidad financiera, riesgos del proceso y alertas de este lote.'}</p>
      <div class="acts"><button class="btn sm" data-protool="potencial">Potencial constructivo</button><button class="btn sm" data-protool="prefa">Prefactibilidad</button><button class="btn sm" data-protool="riesgos">Riesgos${pro ? ` <span class="tag${alto ? ' warn' : ''}">${alto + med}</span>` : ''}</button><button class="btn sm" data-protool="alertas">Alertas</button></div></div>`;
  }
  const openPro = (r, t) => PX.pro.open(r, t, $('layer'), { changed: () => { renderList(); if (open) openFicha(open, false); } });
  function listMenu(r) {
    return `<div class="menu" id="lmenu" hidden>${PX.acct.listas.map(l => `<label><input type="checkbox" data-l="${l.id}"${l.items.some(i => i.k === r.key) ? ' checked' : ''}> ${esc(l.n)} <span class="muted">(${l.items.length})</span></label>`).join('')}
      <div class="row2"><input type="text" id="lnew" placeholder="Nueva lista" aria-label="Nombre de la nueva lista"><button class="btn sm" id="lnewb">Crear</button></div></div>`;
  }
  function actionsHTML(r) {
    const inCmp = cmp.includes(r.key);
    return `<div class="acts">
      <button class="btn sm" data-act="cmp" aria-pressed="${inCmp}">${inCmp ? 'En comparación' : 'Comparar'}</button>
      ${r.isPlano ? '' : `<button class="btn sm" data-act="sigo" aria-pressed="${PX.sigo(r.key)}">${PX.sigo(r.key) ? 'Siguiendo' : 'Seguir'}</button>`}
      <button class="btn sm" data-act="lista">Guardar en lista</button>
      ${r.ll ? `<a class="btn sm" href="https://www.google.com/maps/search/?api=1&query=${r.ll[1]},${r.ll[0]}" target="_blank" rel="noopener">Google Maps</a>` : ''}
    </div>${listMenu(r)}`;
  }
  function openFicha(key, fly) {
    const r = PX.item(key); if (!r) return;
    open = key;
    document.querySelectorAll('.item[aria-current]').forEach(e => e.removeAttribute('aria-current'));
    const li = document.querySelector(`.item[data-k="${key}"]`); if (li) li.setAttribute('aria-current', 'true');
    const f = $('ficha');
    const s = PX.score(r), pro = PX.isPro(), full = pro || PX.tieneExp(r.key);
    const a = PX.prof(r), e = r.ent || {};
    const seal = r.isPlano ? `<span class="seal ok">● Predio del catastro</span>` : r.exact ? `<span class="seal ok">● Exacta por ${r.loc}</span>` : `<span class="seal aprox">◌ Aproximada al distrito</span>`;
    let top;
    if (r.isPlano) {
      top = `<div class="pricebox"><span class="lbl">Área según catastro</span><span class="big"><span class="num">${fnum(a)}</span> <span class="u">m²</span></span>
        <span class="alt">${r.remate ? `<button class="linkbtn" data-act="rem">Está en remate: ver ficha</button>` : 'No aparece en los remates vigentes'}</span></div>`;
    } else {
      const m2 = r.bv && a ? PX.conv(r.bv, r.mon, PX.cur) / a : null;
      top = `<div class="pricebox"><span class="lbl">Base vigente · ${PX.ETAPA[r.st]} · ${fdate(r.next)}</span>
        <span class="big">${PX.money(r.bv, r.mon)}</span>
        <span class="alt"><span>≈ ${PX.other(r.bv, r.mon)}</span>${m2 ? `<span>${PX.mh(m2, PX.cur)} por m²</span>` : ''}<span>${a ? fnum(a) + ' m²' : 'área s/d'}</span></span></div>`;
    }
    const tl = (r.fd || []).map((d, k) => `<div class="tl ${k < r.st ? 'past' : ''} ${k === r.st ? 'now' : ''}" style="--c:var(${PX.SC[k]})"><i></i>
        <span class="d">${PX.ETAPA[k]}${k ? ` · ${PX.PCT[k] * 100} %` : ''}<small>${fdate(d, true)}</small></span><span class="b">${PX.money(r.bases[k], r.mon)}</span></div>`).join('');
    const attrs = ATTR.filter(x => x[2](r)).map(x => x[1]);
    const nserv = (r.serv || []).length;
    f.innerHTML = `<div class="fhead">${seal}<span class="tag">${esc(r.tipo)}</span><button class="x" id="fx" aria-label="Cerrar ficha">×</button></div>
    <div class="fbody">
      <div class="ftitle"><h2>${esc(r.nom)}</h2><div class="where">${esc(r.lugar || 'Ubicación por definir')}</div></div>
      ${top}
      ${actionsHTML(r)}
      ${r.isPlano ? '' : `<div class="sect"><h3>Fechas y bases</h3><div class="timeline">${tl || '<div class="tl">Sin fechas legibles en el edicto.</div>'}</div></div>`}
      ${r.rev ? `<div class="note">${esc(r.rev)}</div>` : ''}
      ${!r.exact && !r.rev ? `<div class="note">${r.plano ? 'El catastro no devolvió un predio para este plano ni para la finca.' : 'El edicto no cita plano y el catastro no devolvió la finca.'} El punto marca el distrito declarado.</div>` : ''}
      <div class="sect"><h3>Índice PlanoExacto</h3>
        <div class="idx">${scoreRing(s.total)}<div class="lab"><b>${PX.scoreLabel(s.total)}</b><span>Promedio ponderado de sanidad jurídica, precio por m², servicios y restricciones</span></div></div>
        <div style="margin-top:10px" class="${full ? '' : 'blur'}" aria-hidden="${!full}">${barsHTML(s)}</div>
        ${full ? '' : '<div class="prohint" style="margin-top:6px"><span>${PX.PRO} Desglose en el expediente o en PRO</span><button class="linkbtn" data-planes>Ver planes</button></div>'}</div>
      <div class="sect"><h3>Resumen</h3><dl class="kv">
        <dt>Finca</dt><dd class="num">${esc(r.fincaTxt)}${r.multi ? ' <span class="tag warn">varias fincas o derechos</span>' : ''}</dd>
        <dt>Plano</dt><dd class="num">${esc(r.plano || (r.planoCat ? PX.planoTxt(r.planoCat) + ' (catastro)' : 'No indicado'))}</dd>
        ${r.isPlano ? '' : `<dt>Área en edicto</dt><dd class="num">${r.area ? fnum(r.area) + ' m²' : '—'}</dd>`}
        ${r.areaCat && !r.isPlano ? `<dt>Área en catastro</dt><dd class="num">${fnum(r.areaCat)} m²</dd>` : ''}
        <dt>Plan regulador</dt><dd>${esc(PX.prText(e.pr))}</dd>
        ${r.isPlano ? `<dt>Uso del suelo</dt><dd id="pcob">${r.cob ? esc(r.cob) : '…'}</dd>` : ''}
        ${e.salud ? `<dt>Salud</dt><dd>${esc(e.salud.n)}<small class="sub">${PX.dist(e.salud.d)}</small></dd>` : ''}
        ${r.isPlano ? '' : `<dt>Servidumbres</dt><dd>${nserv ? `<span class="tag warn">${nserv === 1 ? 'Una citada' : nserv + ' citadas'}</span> <small class="sub">Explicadas en el expediente</small>` : 'Ninguna citada en el edicto'}</dd>`}
      </dl></div>
      ${r.isPlano ? '' : `<div class="sect"><h3>Atributos del lote ${PX.PRO}</h3>
        <div class="chips${pro ? '' : ' blur'}">${(pro ? attrs : ['Terreno plano', 'Frente a vía', 'Zona urbana']).map(t => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="chip">Sin atributos destacados</span>'}</div></div>`}
      ${proBox(r)}
      ${expBox(r)}
      <div class="foot">Información orientativa extraída de fuentes públicas. No sustituye la certificación del Registro Nacional ni la revisión del expediente judicial.</div>
    </div>`;
    f.hidden = false;
    $('fx').onclick = closeFicha;
    if (r.isPlano && !r.cob && r.ll) PX.cobertura(r.ll[0], r.ll[1]).then(v => { r.cob = v; if (r.ent) r.ent.cob = v; PX.savePlano(r); const d = $('pcob'); if (d) d.textContent = v || 'Sin dato del MINAE'; });
    selLayer.clearLayers();
    if (r.ll) {
      const col = r.isPlano ? css('--accent') : css(PX.SC[r.st]);
      if (r.poly) {
        const pg = L.polygon(ringLL(r), { color: css('--ink'), weight: 2.5, fillColor: col, fillOpacity: 0.35 });
        selLayer.addLayer(pg);
        if (fly !== false) map.fitBounds(pg.getBounds(), { maxZoom: 17, paddingTopLeft: [60, 60], paddingBottomRight: window.innerWidth > 900 ? [480, 60] : [60, 60] });
      } else {
        selLayer.addLayer(L.circleMarker([r.ll[1], r.ll[0]], { radius: 14, color: css('--ink'), weight: 2, dashArray: '4 4', fill: false }));
        if (fly !== false) map.setView([r.ll[1], r.ll[0]], 12);
      }
    }
    try { history.replaceState(null, '', '#' + key); } catch (err) {}
    if (tab === 'top') renderHub();
    f.scrollTop = 0;
  }
  function closeFicha() { $('ficha').hidden = true; open = null; if (tab === 'top') renderHub(); selLayer.clearLayers(); document.querySelectorAll('.item[aria-current]').forEach(e => e.removeAttribute('aria-current')); try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (document.querySelector('#layer > *')) closeLayer(); else if (open) closeFicha(); } });
  $('ficha').addEventListener('click', e => {
    const pt = e.target.closest('[data-protool]'); if (pt && open) { openPro(PX.item(open), pt.dataset.protool); return; }
    const b = e.target.closest('[data-act]'); if (!b || !open) return;
    const r = PX.item(open), act = b.dataset.act;
    if (act === 'exp') return goExpediente(r);
    if (act === 'cmp') { toggleCmp(r.key); openFicha(open, false); return; }
    if (act === 'sigo') { const on = PX.toggleSigo(r.key); if (on) { PX.acct.snap = PX.acct.snap || {}; PX.acct.snap[r.key] = { st: r.st, bv: r.bv }; PX.saveAcct(); } toast(on ? 'Lo verás en Mi cuenta → Seguimiento' : 'Dejaste de seguir este remate'); openFicha(open, false); renderList(); return; }
    if (act === 'lista') { $('lmenu').hidden = !$('lmenu').hidden; return; }
    if (act === 'rem') { openFicha(r.remate, true); return; }
  });
  $('ficha').addEventListener('change', e => {
    const id = e.target.dataset.l; if (!id || !open) return;
    const r = PX.item(open), l = PX.acct.listas.find(x => x.id === id);
    if (e.target.checked) { if (!l.items.some(i => i.k === r.key)) l.items.unshift({ k: r.key, n: r.nom, t: Date.now(), nota: '' }); if (r.isPlano) PX.savePlano(r); }
    else l.items = l.items.filter(i => i.k !== r.key);
    PX.saveAcct(); toast(e.target.checked ? `Guardado en «${l.n}»` : `Quitado de «${l.n}»`);
  });
  $('ficha').addEventListener('click', e => {
    if (e.target.id !== 'lnewb') return;
    const n = $('lnew').value.trim(); if (!n) return;
    const r = PX.item(open);
    PX.acct.listas.push({ id: 'l' + Date.now(), n, items: [{ k: r.key, n: r.nom, t: Date.now(), nota: '' }] });
    if (r.isPlano) PX.savePlano(r);
    PX.saveAcct(); toast(`Lista «${n}» creada`); openFicha(open, false); $('lmenu').hidden = false;
  });

  // ---------- expediente: acceso ----------
  function goExpediente(r) {
    if (r.isPlano) PX.savePlano(r);
    if (PX.tieneExp(r.key) || (PX.isPro() && PX.usoMes() < PX.PRECIOS.cupo)) { PX.registrarExp(r.key, r.nom); location.href = 'expediente.html?k=' + encodeURIComponent(r.key); return; }
    if (PX.isPro()) return modal(`<div class="hd"><h2>Llegaste al cupo del mes</h2></div><p>Tu suscripción incluye ${PX.PRECIOS.cupo} expedientes al mes y ya los usaste. Puedes comprar este expediente por separado.</p><div class="acts"><button class="btn primary" data-buy="${r.key}">Comprar por ${PX.mt(PX.PRECIOS.expediente, 'USD')}</button></div>`, true);
    modal(`<div class="hd"><h2>Expediente del lote</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
      <div><b>${esc(r.nom)}</b><div class="muted">${esc(r.lugar)}</div></div>
      <div class="plans" style="grid-template-columns:1fr 1fr">
        <div class="plan"><h3>Solo este lote</h3><div class="pr">${PX.usdH(PX.PRECIOS.expediente)}</div><ul><li>Expediente completo e imprimible</li><li>Queda disponible en Mi cuenta</li></ul><button class="btn primary" data-buy="${r.key}">Comprar expediente</button></div>
        <div class="plan hl"><h3>Suscripción ${PX.PRO}</h3><div class="pr">${PX.usdH(PX.PRECIOS.suscripcion)} <small>al mes</small></div><ul><li>Hasta ${PX.PRECIOS.cupo} expedientes al mes</li><li>Top 10 por provincia, atributos y todas las capas</li></ul><button class="btn" data-sub>Suscribirme</button></div>
      </div>
      <div class="demo">Modo demostración: el pago aún no está conectado. Al confirmar se activa el acceso en este navegador.</div>`, true);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-buy]');
    if (b) { const r = PX.item(b.dataset.buy); PX.comprar(r.key, r.nom); closeLayer(); location.href = 'expediente.html?k=' + encodeURIComponent(r.key); }
    if (e.target.closest('[data-sub]')) { PX.acct.plan = 'pro'; PX.saveAcct(); closeLayer(); toast('PRO activado (demostración)'); }
    if (e.target.closest('[data-free]')) { PX.acct.plan = 'free'; PX.saveAcct(); closeLayer(); toast('Volviste al plan gratuito'); }
    if (e.target.closest('[data-close]') || e.target.classList.contains('scrim')) closeLayer();
  });

  // ---------- ventanas ----------
  function modal(html, small) { $('layer').innerHTML = `<div class="scrim"><div class="dlg${small ? ' sm' : ''}" role="dialog" aria-modal="true">${html}</div></div>`; const f = $('layer').querySelector('button, input'); if (f) f.focus(); }
  function closeLayer() { $('layer').innerHTML = ''; }
  function prompt_(title, def) {
    return new Promise(res => {
      modal(`<div class="hd"><h2>${esc(title)}</h2></div><form id="pf" class="fld"><input id="pv" value="${esc(def || '')}" aria-label="${esc(title)}"><div class="acts"><button class="btn primary" type="submit">Guardar</button><button class="btn" type="button" data-close>Cancelar</button></div></form>`, true);
      $('pf').onsubmit = ev => { ev.preventDefault(); const v = $('pv').value.trim(); closeLayer(); res(v); };
      $('pv').select();
    });
  }
  function openPlanes(why) {
    const pro = PX.isPro();
    modal(`<div class="hd"><h2>Planes de PlanoExactoCR</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
      ${why ? `<div class="note">${esc(why)}</div>` : ''}
      <div class="plans">
        <div class="plan${pro ? '' : ' hl'}"><h3>Gratis</h3><div class="pr">${PX.usdH(0)}</div>
          <ul><li>Mapa de remates vigentes con filtros de ubicación, remate y características básicas</li><li>Búsqueda de cualquier plano o finca en el catastro</li><li>Comparar 2 lotes con el índice PlanoExacto</li><li>Capas básicas: calles, satélite, límites, catastro y estado del plan regulador</li><li>Listas y seguimiento</li></ul>
          ${pro ? '<button class="btn" data-free>Volver a Gratis</button>' : '<span class="tag ok">Tu plan actual</span>'}</div>
        <div class="plan"><h3>Expediente por lote</h3><div class="pr">${PX.usdH(PX.PRECIOS.expediente)} <small>por lote</small></div>
          <ul><li>Texto del edicto y datos registrales</li><li>Gravámenes y servidumbres explicados</li><li>Entorno completo: ríos, relieve, cobertura, salud, escuela</li><li>Análisis multidimensional y comparables</li><li>Versión imprimible con nota legal</li></ul>
          <span class="muted" style="font-size:12.5px">Se compra desde la ficha de cada lote.</span></div>
        <div class="plan${pro ? ' hl' : ''}"><h3>Suscripción ${PX.PRO}</h3><div class="pr">${PX.usdH(PX.PRECIOS.suscripcion)} <small>al mes</small></div>
          <ul><li>Hasta ${PX.PRECIOS.cupo} expedientes al mes</li><li>Top 10 del mes por provincia</li><li>Atributos del lote: plano, construcción, frente a vía, urbano…</li><li>Todas las capas: zonas de vida, uso del suelo, ríos, curvas, PSA, vías, salud</li><li>Comparar hasta 4 lotes con pesos propios</li><li>Herramientas PRO: potencial constructivo, prefactibilidad financiera, riesgos del proceso, alertas y mapa de precios</li></ul>
          ${pro ? '<span class="tag gold">Tu plan actual</span>' : '<button class="btn primary" data-sub>Suscribirme</button>'}</div>
      </div>
      <div class="foot">Los expedientes y análisis no son certificados de uso de suelo, certificaciones registrales ni avalúos. Modo demostración: los pagos aún no están conectados.</div>`);
  }
  $('bPlanes').onclick = () => openPlanes();

  // ---------- Mi cuenta ----------
  function renderCuenta() {
    const a = PX.acct, pro = PX.isPro(), uso = PX.usoMes();
    const nameOf = k => { const it = PX.item(k); return it ? it.nom : k; };
    const sig = a.sigo.map(k => PX.item(k)).filter(Boolean);
    const snap = a.snap || {};
    $('layer').innerHTML = `<div class="scrim" style="place-items:stretch end;padding:0"><aside class="drawer" role="dialog" aria-modal="true" aria-label="Mi cuenta">
      <div class="fhead"><h2 style="margin:0;font:600 19px/1.2 var(--f-display)">Mi cuenta</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
      <div class="dbody">
        <div class="demo">Modo demostración: tu cuenta se guarda solo en este navegador y los pagos no están conectados.</div>
        <section class="acc"><h3>Plan</h3>
          <div class="li"><div><b>${pro ? 'Suscripción ' + PX.PRO : 'Gratis'}</b><br><small>${pro ? `${PX.mt(PX.PRECIOS.suscripcion, 'USD')} al mes · hasta ${PX.PRECIOS.cupo} expedientes` : `Expedientes a ${PX.mt(PX.PRECIOS.expediente, 'USD')} por lote`}</small></div>
            <div>${pro ? '<button class="btn sm" data-free>Pasar a Gratis</button>' : '<button class="btn sm primary" data-sub>Suscribirme</button>'}</div></div>
          ${pro ? `<div style="display:grid;gap:4px;margin-top:6px"><small class="muted">Expedientes usados en ${PX.MESL[PX.now.getMonth()]}: <b class="num">${uso}</b> de ${PX.PRECIOS.cupo}</small><div class="meter"><i style="width:${uso / PX.PRECIOS.cupo * 100}%"></i></div></div>` : ''}
        </section>
        <section class="acc"><h3>Seguimiento <span class="tag">${sig.length}</span></h3>
          ${sig.length ? sig.map(r => { const s0 = snap[r.key]; const cambio = s0 && s0.st !== r.st ? (r.st < 0 ? 'Ya pasaron todas las fechas' : `Pasó a ${PX.ETAPA[r.st]}`) : ''; return `<div class="li"><div><button class="linkbtn" data-open="${r.key}">${esc(r.nom)}</button><br><small>${r.st >= 0 ? `${PX.ETAPA[r.st]} · ${fdate(r.next)} · ${when(r.next)}` : 'Sin fechas pendientes'}</small>${cambio ? ` <span class="tag warn">${cambio}</span>` : ''}</div><div>${r.st >= 0 ? PX.money(r.bv, r.mon, true) : ''}<br><button class="linkbtn" data-unsig="${r.key}" style="font-weight:500;font-size:12px">Dejar de seguir</button></div></div>`; }).join('') : '<small class="muted">Usa «Seguir» en la ficha de un remate para ver aquí su próxima fecha y los cambios de etapa.</small>'}
        </section>
        <section class="acc"><h3>Listas</h3>
          ${a.listas.map(l => `<details ${l.items.length ? 'open' : ''} style="border-top:1px solid var(--line);padding:6px 0"><summary style="cursor:pointer;font-weight:600">${esc(l.n)} <span class="muted">(${l.items.length})</span></summary>
            ${l.items.map(i => `<div class="li"><div><button class="linkbtn" data-open="${i.k}">${esc(nameOf(i.k) || i.n)}</button></div><div><button class="linkbtn" data-rmi="${l.id}|${i.k}" style="font-weight:500;font-size:12px">Quitar</button></div>
              <textarea data-nota="${l.id}|${i.k}" placeholder="Notas: visita, preguntas al juzgado, tope de oferta…">${esc(i.nota || '')}</textarea></div>`).join('') || '<small class="muted">Vacía. Agrega lotes con «Guardar en lista».</small>'}
            <div class="acts" style="margin-top:6px"><button class="btn sm" data-ren="${l.id}">Renombrar</button>${a.listas.length > 1 ? `<button class="btn sm" data-dell="${l.id}">Eliminar lista</button>` : ''}</div></details>`).join('')}
          <div class="acts" style="margin-top:8px"><button class="btn sm" data-newl>Nueva lista</button></div>
        </section>
        <section class="acc"><h3>Expedientes <span class="tag">${a.expedientes.length}</span></h3>
          ${a.expedientes.length ? a.expedientes.map(x => `<div class="li"><div><a href="expediente.html?k=${encodeURIComponent(x.k)}">${esc(x.n || nameOf(x.k))}</a><br><small>${x.via === 'pro' ? 'Suscripción' : 'Compra individual'} · ${fdate(new Date(x.t))}</small></div><div></div></div>`).join('') : '<small class="muted">Aún no has generado expedientes.</small>'}
        </section>
        <section class="acc"><h3>Búsquedas guardadas</h3>
          ${a.busquedas.length ? a.busquedas.map((b, i) => `<div class="li"><div><button class="linkbtn" data-bus="${i}">${esc(b.n)}</button><br><small>${fdate(new Date(b.t))}</small></div><div><button class="linkbtn" data-delb="${i}" style="font-weight:500;font-size:12px">Eliminar</button></div></div>`).join('') : '<small class="muted">Usa «Guardar» sobre la lista de remates para volver a una búsqueda.</small>'}
        </section>
      </div></aside></div>`;
  }
  $('bCuenta').onclick = renderCuenta;
  $('layer').addEventListener('click', async e => {
    const d = e.target.closest('[data-open],[data-unsig],[data-rmi],[data-ren],[data-dell],[data-newl],[data-bus],[data-delb]'); if (!d) return;
    const a = PX.acct, ds = d.dataset;
    if (ds.open) { closeLayer(); const it = PX.item(ds.open); if (it && it.isPlano) setTab('pla'); openFicha(ds.open, true); return; }
    if (ds.unsig) PX.toggleSigo(ds.unsig);
    if (ds.rmi) { const [l, k] = ds.rmi.split('|'); const L_ = a.listas.find(x => x.id === l); L_.items = L_.items.filter(i => i.k !== k); }
    if (ds.ren) { const L_ = a.listas.find(x => x.id === ds.ren); const n = await prompt_('Nuevo nombre de la lista', L_.n); if (n) L_.n = n; }
    if (ds.dell) a.listas = a.listas.filter(x => x.id !== ds.dell);
    if (ds.newl !== undefined) { const n = await prompt_('Nombre de la lista', 'Para visitar'); if (n) a.listas.push({ id: 'l' + Date.now(), n, items: [] }); }
    if (ds.bus) { closeLayer(); setFilt(a.busquedas[+ds.bus].s); return; }
    if (ds.delb) a.busquedas.splice(+ds.delb, 1);
    PX.saveAcct(); renderCuenta(); renderList();
  });
  $('layer').addEventListener('input', e => {
    const n = e.target.dataset.nota; if (!n) return;
    const [l, k] = n.split('|'); const it = PX.acct.listas.find(x => x.id === l).items.find(i => i.k === k);
    it.nota = e.target.value; PX.store.set('px-acct', PX.acct);
  });
  document.addEventListener('px-acct', () => { paintPlan(); paintAttrs(); syncLayers(); if (!$('lyrPanel').hidden) renderLyrPanel(); if (!PX.isPro()) { attrOn.clear(); } if (open) openFicha(open, false); if (tab === 'cmp') renderCmp(); if (tab === 'top') renderTop(); $('cmpN').textContent = cmp.length; });

  // ---------- buscar plano ----------
  let plaMode = 'plano';
  function setPlaMode(m) {
    plaMode = m; $('byPlano').setAttribute('aria-pressed', m === 'plano'); $('byFinca').setAttribute('aria-pressed', m === 'finca');
    $('plaL').textContent = m === 'plano' ? 'Número de plano' : 'Número de finca';
    $('plaV').placeholder = m === 'plano' ? 'P-1311611-2008' : '169321';
    $('plaHelp').textContent = m === 'plano' ? 'Escribe el plano como aparece en el documento (P-1311611-2008, SJ-0123456-2010) o elige la provincia y escribe número y año. Consulta el Registro Inmobiliario en vivo.' : 'Elige la provincia y escribe el número de finca (matrícula) sin el derecho. Consulta el Registro Inmobiliario en vivo.';
  }
  $('byPlano').onclick = () => setPlaMode('plano'); $('byFinca').onclick = () => setPlaMode('finca');
  $('plaForm').onsubmit = async ev => {
    ev.preventDefault();
    const v = $('plaV').value.trim(), pv = $('plaProv').value, out = $('plaOut');
    let tipo = plaMode, val;
    if (tipo === 'plano') { const p = PX.parsePlano(v, pv); if (!p) { out.innerHTML = '<div class="err">No reconozco ese número de plano. Ejemplos: P-1311611-2008 o, con la provincia elegida, 1311611-2008.</div>'; return; } val = p.code; }
    else { val = v.replace(/\D/g, ''); if (!val || !pv) { out.innerHTML = '<div class="err">Elige la provincia y escribe el número de finca.</div>'; return; } }
    out.innerHTML = '<div class="muted">Consultando el catastro…</div>'; $('plaGo').disabled = true;
    try {
      const res = await PX.consultar(tipo, val, pv);
      if (!res.length) { out.innerHTML = '<div class="card"><b>Sin resultados</b><span class="muted">El catastro no devolvió un predio para ese número. Revisa la provincia y el año del plano.</span></div>'; return; }
      res.forEach(PX.savePlano);
      out.innerHTML = res.map(plaCard).join('');
      if (res.length === 1) openFicha(res[0].key, true);
      renderPlaHist();
    } catch (err) { out.innerHTML = `<div class="err">${esc(err.message)}</div>`; }
    finally { $('plaGo').disabled = false; }
  };
  function plaCard(o) {
    return `<div class="card"><h3>${esc(o.nom)}</h3><dl class="kv"><dt>Área catastro</dt><dd class="num">${fnum(o.areaCat)} m²</dd><dt>Finca</dt><dd class="num">${esc(o.fincaTxt)}</dd><dt>Ubicación</dt><dd>${esc(o.lugar || '—')}</dd><dt>Plan regulador</dt><dd>${esc(PX.prText(o.ent.pr))}</dd></dl>
      ${o.remate ? '<span class="tag gold">Está en remate</span>' : ''}<div class="acts"><button class="btn sm primary" data-po="${o.key}">Ver en el mapa</button><button class="btn sm" data-pc="${o.key}">${cmp.includes(o.key) ? 'En comparación' : 'Comparar'}</button></div></div>`;
  }
  function renderPlaHist() {
    const ks = Object.keys(PX.planos).reverse().slice(0, 8);
    $('plaHist').innerHTML = ks.length ? `<div class="lbl" style="margin-top:4px">Consultados recientemente</div>` + ks.map(k => { const o = PX.planos[k]; return `<button class="item" data-po="${k}" style="--c:var(--accent)"><span class="sb"></span><span class="mid"><div class="t1">${esc(o.nom)}</div><div class="t2">${esc(o.lugar)} · ${fnum(o.areaCat)} m²</div></span><span class="rt">${o.remate ? '<span class="tag gold">En remate</span>' : ''}</span></button>`; }).join('') : '';
  }
  $('p-pla').addEventListener('click', e => {
    const o = e.target.closest('[data-po]'); if (o) { openFicha(o.dataset.po, true); return; }
    const c = e.target.closest('[data-pc]'); if (c) { toggleCmp(c.dataset.pc); c.textContent = cmp.includes(c.dataset.pc) ? 'En comparación' : 'Comparar'; }
  });

  // ---------- comparar ----------
  let cmp = PX.store.get('px-cmp', []).filter(k => PX.item(k));
  let W = Object.assign({}, PX.W0, PX.store.get('px-w', {}));
  const maxCmp = () => PX.isPro() ? 4 : 2;
  function toggleCmp(k) {
    const i = cmp.indexOf(k);
    if (i >= 0) cmp.splice(i, 1);
    else {
      if (cmp.length >= maxCmp()) { if (!PX.isPro()) { lockMsg('El plan gratuito compara 2 lotes a la vez. Con la suscripción comparas hasta 4.'); return; } cmp.shift(); }
      cmp.push(k); toast('Agregado al comparador');
    }
    PX.store.set('px-cmp', cmp); $('cmpN').textContent = cmp.length;
    if (tab === 'cmp') renderCmp();
  }
  $('cmpN').textContent = cmp.length;
  function renderCmp() {
    const its = cmp.map(PX.item).filter(Boolean), pro = PX.isPro(), Wu = pro ? W : PX.W0;
    let h = '';
    if (its.length < 2) h += `<div class="card"><h3>Compara lotes</h3><span class="muted">Agrega ${its.length ? 'otro lote' : 'dos lotes'} con el botón «Comparar» de la ficha, o desde «Buscar plano». El índice pondera sanidad jurídica, precio por m², potencial por servicios y restricciones, y declara un ganador.</span></div>`;
    if (its.length) {
      const S = its.map(r => PX.score(r, Wu));
      const n = its.length, best = (vals, hi) => { const v = vals.filter(x => x != null); if (v.length < 2) return -1; const m = hi ? Math.max(...v) : Math.min(...v); return vals.filter(x => x === m).length === 1 ? vals.indexOf(m) : -1; };
      const row = (lab, cells, bi, cls) => `<div class="r ${cls || ''}"><div>${lab}</div>${cells.map((c, i) => `<div class="${i === bi ? 'best' : ''}">${c}</div>`).join('')}</div>`;
      const m2 = its.map(r => r.usdm2 != null ? PX.conv(r.usdm2, 'USD', PX.cur) : null);
      if (its.length >= 2) {
        const tots = S.map(s => s.total), wi = best(tots, true);
        if (wi >= 0) {
          const o = S.map((s, i) => i).filter(i => i !== wi), diff = tots[wi] - Math.max(...o.map(i => tots[i] || 0));
          const wins = PX.DIMS.filter(d => best(S.map(s => s[d.k]), true) === wi).map(d => d.n.toLowerCase());
          h += `<div class="winner"><span class="lbl">Ganador</span><b>${esc(its[wi].nom)}</b><span>${diff} punto${diff === 1 ? '' : 's'} por encima${wins.length ? '; mejor en ' + wins.join(', ') : ''}.</span></div>`;
        } else h += `<div class="winner"><span class="lbl">Empate</span><b>Los lotes quedan con el mismo índice</b><span>Ajusta los pesos para desempatar.</span></div>`;
      }
      h += `<div class="cmp" style="--n:${n}">
        ${row('', its.map(r => `<b>${esc(r.nom)}</b><br><button class="rm" data-rm="${r.key}">Quitar</button>`), -1, 'h')}
        ${row('Base vigente', its.map(r => r.isPlano ? '<span class="muted">No está en remate</span>' : PX.money(r.bv, r.mon, true)), best(its.map(r => r.isPlano ? null : PX.usd(r.bv, r.mon)), false))}
        ${row('Área', its.map(r => PX.prof(r) ? fnum(PX.prof(r)) + ' m²' : '—'), best(its.map(PX.prof), true))}
        ${row('Precio por m²', m2.map(v => v == null ? '—' : PX.mh(v, PX.cur)), best(m2, false))}
        ${row('Fecha', its.map(r => r.isPlano ? '—' : `${PX.ETAPA[r.st]}<br><small class="muted">${fdate(r.next)}</small>`), -1)}
        ${row('Ubicación', its.map(r => esc(r.cn || '—')), -1)}
        ${row('Plan regulador', its.map(r => r.ent && r.ent.pr ? (r.ent.pr.si ? 'Vigente' : 'No vigente') : '—'), -1)}
        ${PX.DIMS.map(d => row(d.n, S.map(s => s[d.k] == null ? '–' : `<span class="num">${s[d.k]}</span>`), best(S.map(s => s[d.k]), true))).join('')}
        ${row('Índice', S.map(s => s.total == null ? '–' : s.total), best(S.map(s => s.total), true), 'tot')}
      </div>
      <div class="foot">Sin precio, el índice de un plano consultado se calcula con las dimensiones disponibles. Orientativo: no es un avalúo.</div>`;
    }
    h += `<div class="card"><h3>Pesos de cada parámetro ${PX.PRO}</h3><div class="wts">
      ${PX.DIMS.map(d => `<label class="wt"><span>${d.n}<br><small class="muted">${d.d}</small></span><b>${Wu[d.k]}</b><input type="range" min="0" max="100" step="5" value="${Wu[d.k]}" data-w="${d.k}"${pro ? '' : ' disabled'}></label>`).join('')}</div>
      ${pro ? '<button class="btn sm" id="wReset">Restablecer pesos</button>' : '<div class="prohint"><span>Con PRO ajustas los pesos y comparas hasta 4 lotes</span><button class="linkbtn" data-planes>Ver planes</button></div>'}</div>`;
    $('cmpOut').innerHTML = h;
  }
  $('cmpOut').addEventListener('input', e => { const k = e.target.dataset.w; if (!k) return; W[k] = +e.target.value; PX.store.set('px-w', W); renderCmp(); const el = document.querySelector(`[data-w="${k}"]`); if (el) el.focus(); });
  $('cmpOut').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]'); if (b) { toggleCmp(b.dataset.rm); return; }
    if (e.target.id === 'wReset') { W = Object.assign({}, PX.W0); PX.store.set('px-w', W); renderCmp(); }
  });

  // ---------- Top 10 del mes por provincia ----------
  const WTOP = { juridica: 40, precio: 35, servicios: 25, restricciones: 0 };
  let topProv = PX.store.get('px-topprov', 1), topMes = 0;
  function renderHub() {
    const r = open ? PX.item(open) : null, pro = PX.isPro();
    $('proHub').innerHTML = `<div class="procard"><h3>${PX.PRO} Herramientas de la versión PRO</h3>
        <p>${pro ? 'Tu suscripción PRO está activa.' : 'Puedes abrirlas como vista previa. Con la suscripción PRO las usas completas.'}</p>
        <p>${r ? `Lote abierto: <b>${esc(r.nom)}</b>` : 'Abre un lote en el mapa o busca un plano para usar las herramientas de lote.'}</p></div>
      ${PX.pro.TOOLS.map(t => `<div class="procard${t.st === 'soon' ? ' soon' : ''}"><h3>${PX.PRO} ${t.n} ${t.st === 'soon' ? '<span class="tag">Próximamente</span>' : ''}</h3><p>${t.q}</p>
        ${t.st === 'soon' ? '' : t.map ? `<div class="acts"><button class="btn sm" data-hubmap>${lyrState.precios && pro ? 'Ver en el mapa' : 'Activar en el mapa'}</button></div>` : t.list ? '' : `<div class="acts"><button class="btn sm" data-hubtool="${t.k}"${r ? '' : ' disabled'}>${r ? 'Abrir para este lote' : 'Primero abre un lote'}</button></div>`}</div>`).join('')}
      <h3 style="margin:8px 0 0;font:600 16px/1.2 var(--f-display);display:flex;gap:8px;align-items:center">${PX.PRO} Top 10 del mes</h3>`;
  }
  $('proHub').addEventListener('click', e => {
    const t = e.target.closest('[data-hubtool]'); if (t && open) { openPro(PX.item(open), t.dataset.hubtool); return; }
    if (e.target.closest('[data-hubmap]')) {
      if (!PX.isPro()) return lockMsg('El mapa de precios por m² es una herramienta PRO.');
      lyrState.precios = true; syncLayers(); map.setView([9.8, -84.2], 8); renderHub(); toast('Mapa de precios activado: pasa el mouse por un cantón');
    }
  });
  function renderTop() {
    renderHub();
    if (!PX.isPro()) {
      $('topOut').innerHTML = `<div class="teaser"><h3>Los 10 mejores remates de cada provincia</h3><span>Los 10 remates con mejor combinación de:</span>
        <ul><li><b>Sanidad jurídica</b> (${WTOP.juridica} %): servidumbres, gravámenes, derechos y certeza de ubicación</li><li><b>Precio por m²</b> (${WTOP.precio} %) frente a la mediana de la zona</li><li><b>Potencial por servicios</b> (${WTOP.servicios} %): plan regulador, acceso, salud, escuela, zona urbana</li></ul>
        <div class="acts"><button class="btn primary" data-sub>Suscribirme · ${PX.mt(PX.PRECIOS.suscripcion, 'USD')} al mes</button><button class="btn" data-planes>Ver planes</button></div></div>
        <div class="blur" aria-hidden="true">${[1, 2, 3].map(i => `<div class="item"><span></span><span class="mid"><div class="t1">Lote destacado ${i}</div><div class="t2">Cantón · 1 000 m²</div></span><span class="rt">₡ 00 M</span></div>`).join('')}</div>`;
      return;
    }
    const meses = [0, 1, 2].map(i => { const d = new Date(PX.now.getFullYear(), PX.now.getMonth() + i, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
    const M = meses[topMes];
    const cand = live.filter(r => r.prov === topProv && r.next.getFullYear() === M.y && r.next.getMonth() === M.m);
    const ranked = cand.map(r => ({ r, s: PX.score(r, WTOP) })).filter(x => x.s.total != null).sort((a, b) => b.s.total - a.s.total).slice(0, 10);
    $('topOut').innerHTML = `<div class="row"><div class="fld"><label for="tProv">Provincia</label><select id="tProv">${PX.PROVS.map((p, i) => `<option value="${i + 1}"${i + 1 === topProv ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="fld"><label for="tMes">Mes del remate</label><select id="tMes">${meses.map((x, i) => `<option value="${i}"${i === topMes ? ' selected' : ''}>${PX.MESL[x.m]} ${x.y}</option>`).join('')}</select></div></div>
      <div class="foot">Pondera sanidad jurídica ${WTOP.juridica} %, precio por m² ${WTOP.precio} % y potencial por servicios ${WTOP.servicios} %. ${cand.length} remates de ${PX.PROVS[topProv - 1]} con fecha en ${PX.MESL[M.m]}.</div>
      <div class="top">${ranked.length ? ranked.map((x, i) => `<button class="item" data-k="${x.r.key}"><span class="rk">${i + 1}</span><span class="mid"><div class="t1">${esc(x.r.nom)}</div><div class="t2">${esc(x.r.cn || '')} · ${PX.prof(x.r) ? fnum(PX.prof(x.r)) + ' m²' : 'área s/d'} · ${fdate(x.r.next)}</div>
        <div class="mini"><span>Jurídica <b>${x.s.juridica ?? '–'}</b></span><span>Precio <b>${x.s.precio ?? '–'}</b></span><span>Servicios <b>${x.s.servicios ?? '–'}</b></span></div></span>
        <span class="rt"><div class="price">${PX.money(x.r.bv, x.r.mon, true)}</div><div class="when">Índice <b class="num">${x.s.total}</b></div></span></button>`).join('') : '<div class="empty">No hay remates con fecha en ese mes para esta provincia.</div>'}</div>`;
  }
  $('topOut').addEventListener('change', e => { if (e.target.id === 'tProv') { topProv = +e.target.value; PX.store.set('px-topprov', topProv); } if (e.target.id === 'tMes') topMes = +e.target.value; renderTop(); });
  $('topOut').addEventListener('click', e => { const b = e.target.closest('.item[data-k]'); if (b) openFicha(b.dataset.k, true); });

  // ---------- tema ----------
  function retheme() { drawVectors(); renderMarkers(); if (open) openFicha(open, false); }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme); } catch (e) {}
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- arranque ----------
  paintPlan(); paintAttrs(); setCurUI(); drawVectors(); apply();
  await extra;
  const h = (location.hash || '').slice(1);
  if (/^r\d+$/.test(h) || /^p/.test(h)) openFicha(h, true);
  else if (/^r?(\d+)$/.test(h)) openFicha('r' + h.replace(/\D/g, ''), true);
})();
