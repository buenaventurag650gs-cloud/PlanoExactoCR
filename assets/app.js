/* PlanoExactoCR — mapa, filtros, búsqueda por plano, comparador, Top 10 y cuenta. */
(async function () {
  'use strict';
  const { $, esc, css, fdate, fnum, when } = PX;
  let R, DIST, CANT, ZV, META, INFRA = null, ZMT = null;
  const loadZMT = () => { ZMT = { type: 'FeatureCollection', features: [] }; PX.get('data/zmt.geojson').then(z => { ZMT = z; drawVectors(); }).catch(() => {}); };
  try {
    [R, DIST, META] = await Promise.all([PX.get('data/remates.json'), PX.get('data/distritos.geojson'), PX.get('data/meta.json')]);
  } catch (e) { $('list').innerHTML = '<div class="empty">No se pudieron cargar los datos. Recarga la página.</div>'; return; }
  PX.tc = META.tc;
  // Íconos declarados en el HTML con data-ic
  document.querySelectorAll('i[data-ic]').forEach(i => { i.outerHTML = `<span class="ic" aria-hidden="true">${PX.ICON[i.dataset.ic] || ''}</span>`; });
  PX.prepare(R);
  PX.ctx.dist = DIST;
  const live = R.filter(r => r.st >= 0);
  // capas secundarias: no bloquean el arranque
  const extra = Promise.all([
    PX.get('data/planes_reguladores.geojson').catch(() => null), PX.get('data/salud.json').catch(() => []),
    PX.get('data/cantones.geojson').catch(() => null), PX.get('data/zonasvida.geojson').catch(() => null), PX.get('data/infra.geojson').catch(() => null)
  ]).then(([p, s, c, z, inf]) => { Object.assign(PX.ctx, { planes: p, salud: s, ready: true }); CANT = c; ZV = z; INFRA = inf; prepZV(); drawVectors(); });

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
    $('vFree').setAttribute('aria-pressed', !PX.isPro()); $('vPro').setAttribute('aria-pressed', PX.isPro());
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
  $('stages').innerHTML = [0, 1, 2].map(i => `<button class="stg" aria-pressed="true" data-i="${i}">${PX.stageBadge(i)}<span class="num">${live.filter(r => r.st === i).length}</span></button>`).join('');
  $('stages').addEventListener('click', e => { const b = e.target.closest('.stg'); if (!b) return; const i = +b.dataset.i; stOn[i] = !stOn[i]; b.setAttribute('aria-pressed', stOn[i]); apply(); });

  // Tipo de propiedad (botones con ícono; Agrícola en verde)
  const TIPOS = ['Lote', 'Con construcción', 'Agrícola', 'Filial'];
  const tipoOn = new Set();
  function paintTipos() {
    $('tipos').innerHTML = TIPOS.map(t => `<button class="tipo${t === 'Agrícola' ? ' agro' : ''}" data-t="${t}" aria-pressed="${tipoOn.has(t)}">${PX.ICON[t]}<span>${t === 'Con construcción' ? 'Construcción' : t}</span><span class="num muted">${live.filter(r => r.tipo === t).length}</span></button>`).join('');
  }
  $('tipos').addEventListener('click', e => { const b = e.target.closest('.tipo'); if (!b) return; const t = b.dataset.t; tipoOn.has(t) ? tipoOn.delete(t) : tipoOn.add(t); paintTipos(); apply(); });

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

  const CHK = ['fSemana', 'fMes', 'fNoServ', 'fPR', 'fAgua', 'fAyA'];
  const filtState = () => ({ q: $('q').value, prov: $('fProv').value, canton: $('fCanton').value, st: stOn.slice(), min: $('fMin').value, max: $('fMax').value, amin: $('aMin').value, amax: $('aMax').value, cur: PX.cur,
    tipos: [...tipoOn], chk: Object.fromEntries(CHK.map(k => [k, $(k).checked])), attrs: [...attrOn], order: $('order').value, fav: onlyFav });
  function setFilt(s) {
    $('q').value = s.q || ''; $('fProv').value = s.prov || ''; fillCantones(); $('fCanton').value = s.canton || '';
    (s.st || [true, true, true]).forEach((v, i) => { stOn[i] = v; document.querySelector(`.stg[data-i="${i}"]`).setAttribute('aria-pressed', v); });
    if (s.cur && s.cur !== PX.cur) { PX.setCur(s.cur); setCurUI(); }
    $('fMin').value = s.min || ''; $('fMax').value = s.max || ''; $('aMin').value = s.amin || ''; $('aMax').value = s.amax || '';
    tipoOn.clear(); (s.tipos || (s.tipo ? [s.tipo] : [])).forEach(t => tipoOn.add(t)); paintTipos();
    CHK.forEach(k => $(k).checked = !!(s.chk ? s.chk[k] : (k === 'fSemana' ? s.wk : k === 'fNoServ' ? s.ns : k === 'fPR' ? s.pr : k === 'fAgua' ? s.ag : false)));
    onlyFav = !!s.fav; $('favOnly').setAttribute('aria-pressed', onlyFav);
    attrOn.clear(); if (PX.isPro()) (s.attrs || []).forEach(a => attrOn.add(a)); $('order').value = s.order || 'fecha';
    paintAttrs(); setTab('rem'); apply(); if (s.prov || s.canton || s.q) fitShown();
  }

  let shown = [], limit = 100;
  const scoreCache = new Map();
  const sc = r => { if (!scoreCache.has(r.key)) scoreCache.set(r.key, PX.score(r)); return scoreCache.get(r.key); };
  function apply() {
    const qRaw = $('q').value.trim(), q = PX.norm(qRaw), qd = qRaw.replace(/\D/g, '');
    const p = +$('fProv').value, c = $('fCanton').value;
    const mult = PX.cur === 'CRC' ? 1e6 : 1e3;
    const mn = parseFloat($('fMin').value), mx = parseFloat($('fMax').value);
    const mnV = isNaN(mn) ? null : mn * mult, mxV = isNaN(mx) ? null : mx * mult;
    const ns = $('fNoServ').checked, wk = $('fSemana').checked, pr = $('fPR').checked, ag = $('fAgua').checked, mes = $('fMes').checked, aya = $('fAyA').checked;
    const an = parseFloat($('aMin').value), ax = parseFloat($('aMax').value);
    const hace30 = new Date(PX.now - 30 * 864e5);
    const af = ATTR.filter(a => attrOn.has(a[0]));
    shown = live.filter(r => {
      if (onlyFav && !PX.isFav(r.key)) return false;
      if (!stOn[r.st]) return false;
      if (p && r.prov !== p) return false;
      if (c && r.cn !== c) return false;
      if (tipoOn.size && !tipoOn.has(r.tipo)) return false;
      if (mes && !(r.pub && r.pub >= hace30)) return false;
      if (aya && !(r.ent && r.ent.aguaS)) return false;
      if (!isNaN(an) && !(PX.prof(r) >= an)) return false;
      if (!isNaN(ax) && !(PX.prof(r) <= ax)) return false;
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
      : o === 'pub' ? (a, b) => (b.pub || 0) - (a.pub || 0)
      : o === 'iph' ? (a, b) => (a.iphV ?? Infinity) - (b.iphV ?? Infinity)
      : (a, b) => a.next - b.next);
    // contadores por grupo
    const nU = (q ? 1 : 0) + (p ? 1 : 0) + (c ? 1 : 0), nR = stOn.filter(x => !x).length + (mnV != null) + (mxV != null) + wk + mes, nC = tipoOn.size + !isNaN(an) + !isNaN(ax) + ns + pr + ag + aya + attrOn.size;
    [['onU', nU], ['onR', nR], ['onC', nC]].forEach(([id, n]) => { $(id).hidden = !n; $(id).textContent = n + (n === 1 ? ' filtro' : ' filtros'); });
    const nt = nU + nR + nC + onlyFav; $('nAct').textContent = nt ? nt + (nt === 1 ? ' activo' : ' activos') : ''; $('resetF').disabled = !nt;
    limit = 100; renderList(); renderMarkers();
  }
  ['q', 'fMin', 'fMax', 'aMin', 'aMax'].forEach(id => $(id).addEventListener('input', apply));
  ['fCanton', 'order'].concat(CHK).forEach(id => $(id).addEventListener('change', apply));
  $('resetF').onclick = () => { setFilt({ order: $('order').value }); calDay = null; toast('Filtros restablecidos'); };
  $('fProv').addEventListener('change', () => { fillCantones(); $('fCanton').value = ''; apply(); fitShown(); });
  $('fCanton').addEventListener('change', fitShown);
  $('saveSearch').onclick = () => {
    const n = prompt_('Nombre para esta búsqueda', [($('fCanton').value || PX.PROVS[+$('fProv').value - 1] || 'Todo el país'), [...tipoOn].join(', ')].filter(Boolean).join(' · '));
    n.then(name => { if (!name) return; PX.acct.busquedas.unshift({ n: name, s: filtState(), t: Date.now() }); PX.saveAcct(); toast('Búsqueda guardada en Mi cuenta'); });
  };

  // ---------- lista ----------
  function itemHTML(r) {
    const tags = [`<span class="tag${r.tipo === 'Agrícola' ? ' agro' : ''}">${esc(r.tipo)}</span>`];
    if (r.serv && r.serv.length) tags.push(`<span class="tag warn">Servidumbre</span>`);
    if (r.pub && PX.now - r.pub < 7 * 864e5) tags.push(`<span class="tag ok">Nuevo</span>`);
    if (PX.sigo(r.key)) tags.push(`<span class="tag gold">Siguiendo</span>`);
    if (r.iphV != null) { const b = PX.iphBand(r.iphV); tags.push(`<span class="tag iphtag" style="--c:${b[2]}" title="Índice Puja/Hacienda: ${esc(b[1])}">IPH ${Math.round(r.iphV)}</span>`); }
    const a = PX.prof(r), dd = PX.days(r.next);
    return `<button class="item${dd != null && dd <= 1 ? ' tomorrow' : ''}" role="listitem" data-k="${r.key}"${open === r.key ? ' aria-current="true"' : ''}>
      ${PX.tipoIcon(r)}
      <span class="mid"><div class="t1">${esc(r.nom)}</div>
        <div class="t2">${esc([r.cn, r.pn].filter(Boolean).join(', ') || 'Ubicación por definir')} · ${a ? fnum(a) + ' m²' : 'área s/d'}</div>
        <div class="tags">${tags.join('')}</div></span>
      <span class="rt"><div class="price">${PX.duo(r.bv, r.mon)}</div>
        <span>${PX.stageBadge(r.st, true)} ${PX.whenTag(r.next)}</span>
        <span class="fav" data-fav="${r.key}" role="button" aria-label="${PX.isFav(r.key) ? 'Quitar de favoritos' : 'Agregar a favoritos'}" aria-pressed="${PX.isFav(r.key)}" title="${PX.isFav(r.key) ? 'En favoritos' : 'Agregar a favoritos'}">${PX.HEART}</span></span>
    </button>`;
  }
  function favToggle(key) {
    const r = PX.item(key); if (!r) return;
    if (r.isPlano) PX.savePlano(r);
    const on = PX.toggleFav(key, r.nom);
    toast(on ? 'Agregado a favoritos' : 'Quitado de favoritos');
    if (onlyFav) apply(); else renderList();
    if (open === key) openFicha(open, false);
  }
  let onlyFav = false;
  $('favOnly').onclick = () => { onlyFav = !onlyFav; $('favOnly').setAttribute('aria-pressed', onlyFav); apply(); };
  // Vista lista (agrupada por fecha cuando se ordena por fecha) o calendario
  let view = 'list', calDay = null, calMonth = null;
  const dayKey = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  function renderList() {
    const src = view === 'cal' && calDay ? shown.filter(r => dayKey(r.next) === calDay) : shown;
    $('count').innerHTML = `<b class="num">${src.length}</b> de ${live.length}`;
    if (view === 'cal') renderCal();
    if (!src.length) { $('list').innerHTML = `<div class="empty">${view === 'cal' && !calDay ? 'Elige un día del calendario para ver sus remates.' : 'Ningún remate cumple esos filtros. Prueba quitar alguno o usa «Restablecer».'}</div>`; return; }
    const page = src.slice(0, limit);
    let h = '';
    if ($('order').value === 'fecha' && !(view === 'cal' && calDay)) {
      let last = '';
      const cnt = {}; src.forEach(r => { const k = dayKey(r.next); cnt[k] = (cnt[k] || 0) + 1; });
      for (const r of page) { const k = dayKey(r.next); if (k !== last) { last = k; const n = PX.days(r.next); h += `<div class="dayh${n <= 0 ? ' hoy' : n === 1 ? ' manana' : ''}">${n <= 0 ? 'Hoy' : n === 1 ? 'Mañana' : ''}${n <= 1 ? ' · ' : ''}${fdate(r.next)} <b>${cnt[k]}</b></div>`; } h += itemHTML(r); }
    } else h = page.map(itemHTML).join('');
    $('list').innerHTML = h + (src.length > limit ? `<button class="more" id="more">Mostrar ${Math.min(100, src.length - limit)} más</button>` : '');
  }
  function renderCal() {
    const byDay = {}; shown.forEach(r => { const k = dayKey(r.next); byDay[k] = (byDay[k] || 0) + 1; });
    if (!calMonth) calMonth = new Date(PX.now.getFullYear(), PX.now.getMonth(), 1);
    const y = calMonth.getFullYear(), m = calMonth.getMonth(), first = (new Date(y, m, 1).getDay() + 6) % 7, nd = new Date(y, m + 1, 0).getDate();
    const today = dayKey(PX.now), tom = dayKey(new Date(PX.now.getTime() + 864e5));
    let g = ['L', 'K', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="dw">${d}</span>`).join('') + '<span></span>'.repeat(first);
    for (let d = 1; d <= nd; d++) { const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, n = byDay[k] || 0; g += `<button data-day="${k}" class="${n ? 'has' : ''}${k === today ? ' today' : ''}${k === tom ? ' tom' : ''}" aria-pressed="${calDay === k}"${n ? '' : ' disabled'} title="${n} remate${n === 1 ? '' : 's'}">${d}${n ? `<i>${n}</i>` : ''}</button>`; }
    $('cal').innerHTML = `<div class="calw"><div class="calh"><button data-cm="-1" aria-label="Mes anterior">‹</button><span>${PX.MESL[m].charAt(0).toUpperCase() + PX.MESL[m].slice(1)} ${y}</span><button data-cm="1" aria-label="Mes siguiente">›</button></div><div class="calg">${g}</div><div class="foot">El número indica cuántos remates hay ese día con los filtros activos. El borde naranja marca mañana.</div></div>`;
  }
  $('cal').addEventListener('click', e => {
    const d = e.target.closest('[data-day]'); if (d) { calDay = calDay === d.dataset.day ? null : d.dataset.day; limit = 100; renderList(); return; }
    const cm = e.target.closest('[data-cm]'); if (cm) { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + +cm.dataset.cm, 1); renderCal(); }
  });
  function setView(v) { view = v; $('vwList').setAttribute('aria-pressed', v === 'list'); $('vwCal').setAttribute('aria-pressed', v === 'cal'); $('cal').hidden = v !== 'cal'; if (v === 'cal' && !calDay) { const nx = shown.filter(r => r.next).sort((a, b) => a.next - b.next)[0]; calDay = nx ? dayKey(nx.next) : null; if (nx) calMonth = new Date(nx.next.getFullYear(), nx.next.getMonth(), 1); } limit = 100; renderList(); }
  $('vwList').onclick = () => setView('list'); $('vwCal').onclick = () => setView('cal');
  $('list').addEventListener('click', e => {
    if (e.target.id === 'more') { limit += 100; renderList(); return; }
    const fv = e.target.closest('[data-fav]'); if (fv) { e.stopPropagation(); favToggle(fv.dataset.fav); return; }
    const b = e.target.closest('.item'); if (b) openFicha(b.dataset.k, true);
  });

  // ---------- mapa ----------
  const map = L.map('map', { preferCanvas: true, zoomControl: true, minZoom: 7, maxZoom: 19, zoomSnap: 0.5 }).fitBounds([[8.03, -85.95], [11.22, -82.55]], { paddingTopLeft: [10, 10], paddingBottomRight: [10, 10] });
  map.setMaxBounds([[7.5, -87.5], [11.6, -82]]);
  map.attributionControl.setPrefix('<span class="attrb"><img src="assets/img/logo-mark.webp" alt="" width="18" height="12"><b>PlanoExacto</b>CR</span>');
  map.zoomControl.setPosition('topright');
  PX.map = map;
  // Indicador del nivel de zoom entre + y −
  const zc = map.zoomControl.getContainer();
  const zr = L.DomUtil.create('div', 'zread');
  zr.title = 'Nivel de zoom'; zr.setAttribute('aria-live', 'polite');
  zc.insertBefore(zr, zc.querySelector('.leaflet-control-zoom-out'));
  const paintZ = () => { const z = map.getZoom(); zr.textContent = Number.isInteger(z) ? z : z.toFixed(1).replace('.', ','); };
  map.on('zoomend', paintZ); paintZ();
  map.on('zoomend', () => { if (typeof syncLayers === 'function') syncLayers(); });
  map.createPane('ctx').style.zIndex = 350;
  const ctxR = L.canvas({ pane: 'ctx' });
  const dark = () => (matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light') || document.documentElement.dataset.theme === 'dark';
  const osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const esri = (svc, o) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, Object.assign({ maxZoom: 19 }, o));
  // Mapas base sin llave de API (CARTO pasó a exigir llave en 2026): Esri, OpenStreetMap y OpenTopoMap
  // Los nombres (calles, poblados, ríos) van en una capa superior para que no los tapen las capas temáticas
  map.createPane('lbl').style.zIndex = 450; map.getPane('lbl').style.pointerEvents = 'none';
  const lblOpt = { pane: 'lbl', zIndex: 5 };
  const EA = 'Mapa &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, OpenStreetMap', SA = 'Imágenes &copy; Esri, Maxar, Earthstar Geographics';
  const canvas = (v, o) => esri('Canvas/' + v, Object.assign({ maxNativeZoom: 16 }, o));
  const base = {
    claro: L.layerGroup([canvas('World_Light_Gray_Base', { attribution: EA }), canvas('World_Light_Gray_Reference', lblOpt)]),
    calles: L.layerGroup([esri('World_Street_Map', { attribution: EA })]),
    sat: L.layerGroup([esri('World_Imagery', { attribution: SA, maxNativeZoom: 19 }),
      esri('Reference/World_Transportation', Object.assign({ opacity: 0.85 }, lblOpt)), esri('Reference/World_Boundaries_and_Places', Object.assign({ attribution: 'Nombres &copy; Esri' }, lblOpt))]),
    topo: L.layerGroup([L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19, maxNativeZoom: 17, attribution: 'Mapa &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), SRTM, OpenStreetMap' })]),
    relieve: L.layerGroup([esri('World_Topo_Map', { attribution: EA + ', USGS' })]),
    osm: L.layerGroup([L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: osmAttr })]),
    oscuro: L.layerGroup([canvas('World_Dark_Gray_Base', { attribution: EA }), canvas('World_Dark_Gray_Reference', lblOpt)])
  };
  // Servicios ArcGIS (Hacienda, AyA): teselas desde «export», con estilo propio (dynamicLayers)
  const AGS = L.TileLayer.extend({
    getTileUrl(c) {
      const b = this._tileCoordsToBounds(c), sw = L.CRS.EPSG3857.project(b.getSouthWest()), ne = L.CRS.EPSG3857.project(b.getNorthEast());
      const q = new URLSearchParams({ bbox: [sw.x, sw.y, ne.x, ne.y].join(','), bboxSR: 3857, imageSR: 3857, size: '256,256', format: 'png32', transparent: 'true', f: 'image' });
      if (this.options.dyn) q.set('dynamicLayers', JSON.stringify(this.options.dyn)); else q.set('layers', this.options.layers);
      return this._url + '/export?' + q;
    }
  });
  // Imagen única por vista (no teselas): las etiquetas de Hacienda y AyA no se cortan ni se repiten
  map.createPane('ags').style.zIndex = 300; map.getPane('ags').style.pointerEvents = 'none';
  const AGSImg = L.Layer.extend({
    options: { pane: 'ags', opacity: 1, minZoom: 0 },
    initialize(url, o) { this._url = url; L.setOptions(this, o); },
    getAttribution() { return this.options.attribution; },
    onAdd(m) { this._m = m; this._upd = L.Util.throttle(this._update, 300, this); m.on('moveend zoomend resize', this._upd, this); this._update(); },
    onRemove(m) { m.off('moveend zoomend resize', this._upd, this); if (this._img) this._img.remove(); this._img = null; this._seq = (this._seq || 0) + 1; },
    _update() {
      const m = this._m; if (!m) return;
      if (m.getZoom() < this.options.minZoom) { if (this._img) { this._img.remove(); this._img = null; } return; }
      const b = m.getBounds(), sz = m.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
      const sw = L.CRS.EPSG3857.project(b.getSouthWest()), ne = L.CRS.EPSG3857.project(b.getNorthEast());
      const q = new URLSearchParams({ bbox: [sw.x, sw.y, ne.x, ne.y].join(','), bboxSR: 3857, imageSR: 3857, size: Math.round(sz.x * dpr) + ',' + Math.round(sz.y * dpr), dpi: Math.round(96 * dpr), format: 'png32', transparent: 'true', f: 'image', dynamicLayers: JSON.stringify(this.options.dyn) });
      const seq = this._seq = (this._seq || 0) + 1, url = this._url + '/export?' + q, pre = new Image();
      pre.onload = () => {
        if (seq !== this._seq || !this._m) return;
        const ov = L.imageOverlay(url, b, { pane: this.options.pane, opacity: this.options.opacity, interactive: false }).addTo(m);
        if (this._img) this._img.remove(); this._img = ov;
      };
      pre.src = url;
    }
  });
  const ags = (url, o) => new AGSImg(url, o);
  const sfs = (fill, line, w) => ({ type: 'esriSFS', style: 'esriSFSSolid', color: fill, outline: { type: 'esriSLS', style: 'esriSLSSolid', color: line, width: w || 0.8 } });
  const ZH_DYN = [{ id: 0, source: { type: 'mapLayer', mapLayerId: 0 }, drawingInfo: { renderer: { type: 'simple', symbol: sfs([233, 196, 106, 38], [176, 120, 40, 210], 0.9) }, showLabels: true,
    labelingInfo: zhLabels() } }];
  // Etiquetas de zona homogénea: valor en colones y dólares por m²; el código se agrega al acercarse
  function zhLabels() {
    const tc = (PX.tc && PX.tc.venta) || 456.32, ts = sz => ({ type: 'esriTS', color: [110, 64, 16, 255], haloColor: [255, 255, 255, 235], haloSize: 1.6, font: { family: 'Arial', size: sz, weight: 'bold' } });
    const crc = "'₡' + Replace(Text($feature.VALOR, '#,###'), ',', '\u00a0') + '/m²'", usd = `'US$' + Replace(Text(Round($feature.VALOR / ${tc}, 0), '#,###'), ',', '\u00a0') + '/m²'`;
    const pl = 'esriServerPolygonPlacementAlwaysHorizontal';
    return [
      { labelExpressionInfo: { expression: `${crc} + TextFormatting.NewLine + ${usd}` }, labelPlacement: pl, minScale: 100000, maxScale: 25000, symbol: ts(7.5) },
      { labelExpressionInfo: { expression: `$feature.COD_ZONAH + TextFormatting.NewLine + ${crc} + TextFormatting.NewLine + ${usd}` }, labelPlacement: pl, minScale: 25000, maxScale: 0, symbol: ts(8.5) }
    ];
  }
  const AG_COL = [['AyA', [59, 139, 217]], ['ESPH', [42, 157, 143]], ['ASADA', [106, 153, 78]], ['Municipal', [157, 141, 201]]];
  // Agua: color por tipo de operador y etiqueta con el nombre del operador y el sistema (desde zoom 12)
  const AG_LBL = ["'AyA · ' + $feature.sistema", "'ESPH'", "$feature.Operador + IIf(IsEmpty(Trim($feature.Sistema)), '', ' · ' + $feature.Sistema)", "$feature.Operador + IIf(IsEmpty(Trim($feature.Sistema)), '', ' · ' + $feature.Sistema)"];
  const AG_DYN = [3, 2, 1, 0].map(i => ({ id: i, source: { type: 'mapLayer', mapLayerId: i }, drawingInfo: { renderer: { type: 'simple', symbol: sfs(AG_COL[i][1].concat(80), AG_COL[i][1].concat(i === 0 ? 0 : 110), 0.5) }, showLabels: true,
    labelingInfo: [{ labelExpressionInfo: { expression: AG_LBL[i] }, labelPlacement: 'esriServerPolygonPlacementAlwaysHorizontal', minScale: 150000, maxScale: 0, symbol: { type: 'esriTS', color: AG_COL[i][1].map(c => Math.round(c * 0.55)).concat(255), haloColor: [255, 255, 255, 235], haloSize: 1.6, font: { family: 'Arial', size: 8, weight: 'bold' } } }] } }));
  const ICX = { 'Aeropuerto internacional': '<path d="M2 16l20-6-2-3-7 2-5-6H6l2 7-4 1-2-2H1l1 4z"/>', 'Aeródromo': '<path d="M2 16l20-6-2-3-7 2-5-6H6l2 7-4 1-2-2H1l1 4z"/>', 'Puerto': '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 12H2a10 10 0 0 0 20 0h-3M8 10h8"/>' };
  // Mapas base con miniatura (tesela de Costa Rica central) y para qué sirve cada uno
  const T8 = { esri: s => `https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/9/241/136`, xyz: u => u.replace('{z}', 9).replace('{x}', 136).replace('{y}', 241).replace('{s}', 'a') };
  const BASES = [
    ['claro', 'Claro', 'Ideal para ver datos y capas', T8.esri('Canvas/World_Light_Gray_Base')],
    ['calles', 'Calles', 'Calles, poblados y comercios', T8.esri('World_Street_Map')],
    ['sat', 'Ortofoto', 'Imagen satelital con nombres', T8.esri('World_Imagery')],
    ['topo', 'Topográfico', 'Curvas de nivel y relieve', T8.xyz('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png')],
    ['relieve', 'Relieve', 'Sombras del terreno y vías', T8.esri('World_Topo_Map')],
    ['osm', 'OSM', 'OpenStreetMap: mapa colaborativo detallado', T8.xyz('https://tile.openstreetmap.org/{z}/{x}/{y}.png')],
    ['oscuro', 'Oscuro', 'Para el modo oscuro', T8.esri('Canvas/World_Dark_Gray_Base')]
  ];

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
    { id: 'distritos', minZ: 10, n: 'Límites distritales', free: true, on: true, lg: [['ln', 'var(--dline)', 'Distrito']] },
    { id: 'catastro', n: 'Predios del catastro', z: 15, free: true, on: true, lg: [['ln', '#8A948F', 'Lindero de predio']], mk: () => wms('https://siri.snitcr.go.cr/Geoservicios/wms', 'catastro,catastro_aldia', { minZoom: 15, zIndex: 8, className: 'tl-cat', attribution: 'Catastro &copy; Registro Inmobiliario (SNIT)' }) },
    { id: 'rios_n', n: 'Nombres de ríos', z: 13, free: true, on: true, mk: () => wms('https://geos.snitcr.go.cr/be/IGN_NG/wms', 'IGN_NG:hidronimos_25k', { pane: 'lbl', minZoom: 13, zIndex: 6, sld_body: sld('IGN_NG:hidronimos_25k', `<Rule><TextSymbolizer><Label><ogc:PropertyName>nom_ofi</ogc:PropertyName></Label><Font><CssParameter name="font-family">SansSerif</CssParameter><CssParameter name="font-size">11</CssParameter><CssParameter name="font-style">italic</CssParameter></Font><Halo><Radius>1.5</Radius><Fill><CssParameter name="fill">#FFFFFF</CssParameter></Fill></Halo><Fill><CssParameter name="fill">#2E6FB0</CssParameter></Fill></TextSymbolizer></Rule>`), attribution: 'Hidrónimos &copy; IGN' }) },
    { id: 'planes', n: 'Estado del plan regulador', free: true, hover: true, lg: PRC.map(p => ['', p[2], p[1]]) },
    { g: 'Valor y mercado', id: 'zh', n: 'Zonas homogéneas de Hacienda', note: 'valor del terreno', z: 13, hover: true, lg: [['', '#E9C46A', 'Zona homogénea: valor del terreno en ₡ y US$ por m²']], mk: () => ags('https://sig.hacienda.go.cr/server/rest/services/Zonas_Homogeneas_ONT/MapServer', { dyn: ZH_DYN, minZoom: 13, zIndex: 4, attribution: 'Zonas homogéneas &copy; Ministerio de Hacienda (ONT)' }) },
    { id: 'precios', n: 'Precio por m² de remates', note: 'mediana por cantón', hover: true, lg: [] },
    { g: 'Servicios e infraestructura', id: 'agua', n: 'Cobertura de agua potable', hover: true, lg: AG_COL.map(([n, c]) => ['', `rgb(${c})`, n === 'Municipal' ? 'Acueducto municipal' : n]), mk: () => ags('https://gis.aya.go.cr/server/rest/services/Web/Coberturas_AyA_ASADAS_Muni/MapServer', { dyn: AG_DYN, zIndex: 4, opacity: 0.9, attribution: 'Coberturas de agua &copy; AyA' }) },
    { id: 'vias', n: 'Vías públicas', z: 13, lg: [['', '#C9CED1', 'Derecho de vía (Registro)']], mk: () => wms('https://siri.snitcr.go.cr/Geoservicios/wms', 'vias_publicas', { minZoom: 13, zIndex: 7, className: 'tl-vias', attribution: 'Vías públicas &copy; Registro Inmobiliario' }) },
    { id: 'infra', n: 'Puertos y aeropuertos', lg: [['', '#15302A', 'Aeropuerto, aeródromo o puerto (IGN)']] },
    { id: 'salud', n: 'Centros de salud CCSS', lg: [['', 'var(--accent)', 'Hospital, clínica o EBAIS']] },
    { g: 'Ambiente y restricciones', id: 'zv', n: 'Zonas de vida', hover: true, lg: ZVG.map(g => ['', g[2], g[1]]) },
    { id: 'cob', n: 'Uso y cobertura del suelo 2020', hover: true, lg: MAF.filter(m => m[0] !== 'Red vial').map(([n, c]) => ['', c, n]).concat([['', MAFO, 'Otros']]), mk: () => wms(SINIA + 'MAF2020/wms', 'MAF2020', { sld_body: mafSld, opacity: 0.9, zIndex: 3, attribution: 'Mapa agropecuario y forestal 2020 &copy; MINAE' }) },
    { id: 'hidro', n: 'Ríos y quebradas', z: 13, lg: [['ln', HIDRO, 'Cauce (IGN 1:5 000)']], mk: () => wms('https://geos.snitcr.go.cr/be/IGN_5/wms', 'IGN_5:hidrografia_5000', { minZoom: 13, zIndex: 6, sld_body: sld('IGN_5:hidrografia_5000', lineRule(HIDRO, 1.6, 0.95)), attribution: 'Hidrografía &copy; IGN' }) },
    { id: 'curvas', n: 'Curvas de nivel cada 10 m', z: 15, lg: [['ln', CURV, 'Curva de nivel']], mk: () => wms('https://geos.snitcr.go.cr/be/IGN_5/wms', 'IGN_5:curvas_5000', { minZoom: 15, zIndex: 5, sld_body: sld('IGN_5:curvas_5000', lineRule(CURV, 0.7, 0.75)), attribution: 'Curvas &copy; IGN' }) },
    { id: 'prot', n: 'Franjas de protección de ríos', note: 'GAM, no oficial', z: 13, lg: [['', PROT, 'Franja de protección']], mk: () => wms(SINIA + 'PNUD_TEVU/wms', 'areas_proteccion_no_oficial', { minZoom: 13, zIndex: 4, sld_body: sld('areas_proteccion_no_oficial', polyRule(PROT, 0.22, PROT, 0.8)), attribution: 'Protección de ríos (no oficial) &copy; PNUD-TEVU' }) },
    { id: 'psa', n: 'Pago por servicios ambientales 2025', lg: [['', PSA, 'Contrato PSA']], mk: () => wms(SINIA + 'FONAFIFO/wms', 'psa2025', { zIndex: 4, sld_body: sld('psa2025', polyRule(PSA, 0.3, '#386641', 0.8)), attribution: 'PSA &copy; FONAFIFO' }) },
    { id: 'zmt', n: 'Zona marítimo terrestre', note: 'calculada desde la línea de costa', lg: [['', '#4FA3F0', 'Zona pública: primeros 50 m'], ['', '#E9C46A', 'Zona restringida: 50 a 200 m']] }
  ];
  const lyrState = Object.assign(Object.fromEntries(LY.map(l => [l.id, !!l.on])), PX.store.get('px-layers', {}));
  let baseId = PX.store.get('px-base2', dark() ? 'oscuro' : 'claro'); if (!base[baseId]) baseId = 'claro';
  const vec = { infra: L.layerGroup(), zmt: L.layerGroup(), precios: L.layerGroup(), cantones: L.layerGroup(), distritos: L.layerGroup(), planes: L.layerGroup(), zv: L.layerGroup(), salud: L.layerGroup() };
  for (const l of LY) l.layer = l.mk ? l.mk() : vec[l.id];
  const allowed = l => l.free || PX.isPro();
  function syncLayers() {
    for (const k in base) { if (k === baseId) base[k].addTo(map); else base[k].remove(); }
    map.getContainer().classList.toggle('on-sat', baseId === 'sat');
    if (lyrState.zmt && allowed(LY.find(l => l.id === 'zmt')) && !ZMT) loadZMT();
    for (const l of LY) { const on = lyrState[l.id] && allowed(l) && (!l.minZ || map.getZoom() >= l.minZ); if (on && !map.hasLayer(l.layer)) l.layer.addTo(map); if (!on && map.hasLayer(l.layer)) l.layer.remove(); }
    PX.store.set('px-layers', lyrState); PX.store.set('px-base2', baseId); paintBaseSw();
  }
  // Selector rápido de mapa base sobre el mapa (miniaturas)
  const bsw = L.control({ position: 'bottomright' });
  bsw.onAdd = () => { const d = L.DomUtil.create('div', 'basesw'); L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; };
  bsw.addTo(map);
  function paintBaseSw() {
    const d = bsw.getContainer(), cur = BASES.find(b => b[0] === baseId) || BASES[0];
    d.innerHTML = `<button class="bcur" aria-expanded="${d.classList.contains('open')}" title="Cambiar mapa base"><img src="${cur[3]}" alt="" width="58" height="58"><span>${cur[1]}</span></button>
      <div class="blist" role="radiogroup" aria-label="Mapa base">${BASES.map(([k, n, ds, img]) => `<button role="radio" aria-checked="${k === baseId}" data-base="${k}" title="${ds}"><img src="${img}" alt="" loading="lazy" width="58" height="44"><span>${n}</span></button>`).join('')}</div>`;
  }
  bsw.getContainer().addEventListener('click', e => {
    const d = bsw.getContainer(), b = e.target.closest('[data-base]');
    if (b) { baseId = b.dataset.base; d.classList.remove('open'); syncLayers(); if (!$('lyrPanel').hidden) renderLyrPanel(); return; }
    if (e.target.closest('.bcur')) { d.classList.toggle('open'); paintBaseSw(); }
  });
  const lyrOpen = PX.store.get('px-lyrg', { 'Mapa base': true, Referencia: true });
  function renderLyrPanel() {
    let h = `<details class="lg-g"${lyrOpen['Mapa base'] ? ' open' : ''} data-g="Mapa base"><summary>Mapa base<span class="chev" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2"/></svg></span></summary><div class="bgrid">${BASES.map(([k, n, d, img]) => `<label class="bopt" title="${d}"><input type="radio" name="base" value="${k}"${baseId === k ? ' checked' : ''}><img src="${img}" alt="" loading="lazy" width="64" height="44"><span>${n}</span></label>`).join('')}</div></details>`;
    let open_ = false;
    for (const l of LY) {
      if (l.g) { if (open_) h += '</details>'; const nOn = LY.filter(x => x.g === l.g).length; h += `<details class="lg-g"${lyrOpen[l.g] ? ' open' : ''} data-g="${l.g}"><summary>${l.g}<span class="chev" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2"/></svg></span></summary>`; open_ = true; }
      const ok = allowed(l), on = lyrState[l.id] && ok;
      h += `<label class="lyr${ok ? '' : ' locked'}" data-id="${l.id}"><input type="checkbox"${on ? ' checked' : ''}${ok ? '' : ' disabled'}>
        <span>${l.n}${l.note ? ` <small>${l.note}</small>` : ''}${l.z ? ` <small>zoom ${l.z}+</small>` : ''}</span><span>${l.free ? '' : PX.PRO}${ok && l.hover && on ? ' <small>clic en el mapa</small>' : ''}</span>
        ${on && l.lg && l.lg.length ? `<span class="lg">${l.lg.map(([t, c, n]) => `<span><i class="${t}" style="--c:${c}"></i>${esc(n)}</span>`).join('')}</span>` : ''}</label>`;
    }
    if (open_) h += '</details>';
    h += `<div class="foot" style="padding:8px 14px 0">Servicios del SNIT, Registro Inmobiliario, IGN, Hacienda, AyA, MINAE, INVU y CCSS con estilos propios de PlanoExactoCR. Algunos tardan unos segundos en cargar. Las amenazas de la CNE se agregarán cuando su servicio esté disponible.</div>`;
    $('lyrPanel').innerHTML = h;
  }
  $('lyrPanel').addEventListener('toggle', e => { const d = e.target.closest('details.lg-g'); if (d) { lyrOpen[d.dataset.g] = d.open; PX.store.set('px-lyrg', lyrOpen); } }, true);
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
  function prepZV() { if (!ZV) return; for (const f of ZV.features) { const g = zvGroup(f.properties.n); f.properties.col = g[2]; f.bb = bbox(f.geometry); } if (CANT) CANT.features.forEach(f => f.bb = bbox(f.geometry)); if (DIST) DIST.features.forEach(f => f.bb = f.bb || bbox(f.geometry)); if (PX.ctx.planes) PX.ctx.planes.features.forEach(f => f.bb = bbox(f.geometry)); }
  // Mediana de US$/m² de remates vigentes por cantón (código de cantón: provincia = primer dígito)
  const medCant = f => PX.medC[Math.floor(f.properties.c / 100) + '|' + f.properties.k];
  function priceClasses() {
    const brks = PX.cur === 'USD' ? [10, 25, 50, 100, 200] : [5000, 12000, 25000, 50000, 100000];
    const cols = ['#FFF3C4', '#F9D57E', '#F0A64A', '#D9733A', '#B04A2E', '#7A2E25'];
    const col = v => cols[brks.findIndex(b => v < b) < 0 ? brks.length : brks.findIndex(b => v < b)];
    const u = PX.cur === 'USD' ? 'US$' : '₡', f = v => v.toLocaleString('es-CR');
    const o = PX.cur === 'USD' ? 'CRC' : 'USD', ou = o === 'USD' ? 'US$' : '₡', g = v => Math.round(PX.conv(v, PX.cur, o)).toLocaleString('es-CR');
    const eq = (x, y) => ` (${ou} ${g(x)}${y != null ? '–' + g(y) : ''})`;
    const leg = cols.map((c, i) => ['', c, i === 0 ? `menos de ${u} ${f(brks[0])}/m²${eq(brks[0])}` : i === brks.length ? `${u} ${f(brks[i - 1])}/m² o más${eq(brks[i - 1])}` : `${u} ${f(brks[i - 1])} – ${f(brks[i])}/m²${eq(brks[i - 1], brks[i])}`]).concat([['', 'var(--chip)', 'Menos de 3 remates con área']]);
    return { col, leg };
  }
  function bbox(g) { let a = [180, 90, -180, -90]; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; for (const p of polys) for (const [x, y] of p[0]) { if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y; } return a; }
  const hit = (fc, x, y) => fc && fc.features.find(f => (!f.bb || (x >= f.bb[0] && x <= f.bb[2] && y >= f.bb[1] && y <= f.bb[3])) && PX.inGeom(x, y, f.geometry));
  function drawVectors() {
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
    if (INFRA) for (const f of INFRA.features) { const t = f.properties.t, big = t !== 'Aeródromo'; const mk = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { pane: 'ctx', icon: L.divIcon({ className: 'infra' + (big ? ' big' : ''), iconSize: big ? [26, 26] : [18, 18], html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICX[t]}</svg>` }) }).bindTooltip(`<b>${esc(f.properties.n)}</b><br>${t}`, { direction: 'top' }); vec.infra.addLayer(mk); }
    if (ZMT) vec.zmt.addLayer(L.geoJSON(ZMT, Object.assign({ style: f => f.properties.t === 'publica' ? { stroke: false, fillColor: '#4FA3F0', fillOpacity: 0.45 } : { stroke: false, fillColor: '#E9C46A', fillOpacity: 0.38 } }, o)));
    for (const s of PX.ctx.salud || []) vec.salud.addLayer(L.circleMarker([s.ll[1], s.ll[0]], { renderer: ctxR, pane: 'ctx', radius: s.c === 'EBAIS' ? 3 : 5, color: css('--panel'), weight: 1, fillColor: css('--accent'), fillOpacity: 0.9, interactive: false }));
    syncLayers();
  }

  // Al pasar el mouse: solo distrito, cantón y provincia
  let overMarker = false, hovT = null;
  const hb = $('hoverbox');
  const PROV = ['', 'San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'];
  const where = (x, y) => { const d = hit(DIST, x, y); return d ? { d: d.properties.d, k: d.properties.k, p: PROV[String(d.properties.c)[0]] || '' } : null; };
  map.on('mousemove', e => {
    if (hovT) return;
    hovT = requestAnimationFrame(() => { hovT = null; hover(e); });
  });
  map.on('mouseout', () => { hb.hidden = true; });
  function hover(e) {
    if (overMarker || window.innerWidth <= 900) { hb.hidden = true; return; }
    const w = where(e.latlng.lng, e.latlng.lat);
    if (!w) { hb.hidden = true; return; }
    hb.innerHTML = `<div><b>${esc(w.d)}</b><div>${esc(w.k)}, ${esc(w.p)}</div></div>`;
    const pt = e.containerPoint, W = map.getSize();
    hb.style.left = Math.min(pt.x + 14, W.x - 230) + 'px'; hb.style.top = Math.min(pt.y + 14, W.y - 70) + 'px';
    hb.hidden = false;
  }

  // Clic en el mapa: datos de las capas temáticas activas en ese punto
  const idPop = L.popup({ className: 'idpop', maxWidth: 300, autoPanPadding: [20, 20] });
  map.on('click', async e => {
    if (overMarker) return;
    const x = e.latlng.lng, y = e.latlng.lat;
    const on = id => lyrState[id] && allowed(LY.find(l => l.id === id));
    const rows = [], w = where(x, y), jobs = [];
    if (w) rows.push(['Ubicación', `${w.d}, ${w.k}, ${w.p}`]);
    if (on('zh')) jobs.push(['Zona homogénea', PX.zhAt(x, y)]);
    if (on('agua')) jobs.push(['Agua potable', PX.aguaAt(x, y)]);
    if (on('cob')) jobs.push(['Uso del suelo', PX.cobertura(x.toFixed(5), y.toFixed(5))]);
    if (on('zv')) { const f = hit(ZV, x, y); if (f) rows.push(['Zona de vida', f.properties.n]); }
    if (on('planes')) { const f = hit(PX.ctx.planes, x, y); if (f) rows.push(['Plan regulador', PX.prText(f.properties)]); }
    if (on('precios')) { const f = hit(CANT, x, y); if (f) { const m = medCant(f); rows.push(['Precio por m² en ' + f.properties.k, m ? `${PX.duoT(m.v, 'USD', '/m²')}, mediana de ${m.n} remates` : 'Menos de 3 remates con área']); } }
    if (!jobs.length && rows.length < 2 && (window.innerWidth > 900 || !w)) return; // sin capas temáticas activas el recuadro del mouse ya basta
    const paint = vals => idPop.setContent(`<div class="idrows">${rows.concat(jobs.map(([k], i) => [k, vals ? (vals[i] || 'Sin dato en este punto') : 'Consultando…'])).map(([k, v]) => `<div><span>${esc(k)}</span><div>${esc(v)}</div></div>`).join('')}</div>`);
    paint(null); idPop.setLatLng(e.latlng).openOn(map);
    if (jobs.length) { const vals = await Promise.all(jobs.map(j => j[1].catch(() => null))); if (map.hasLayer(idPop) && idPop.getLatLng().equals(e.latlng)) paint(vals); }
  });

  // Bloque de la escala PECR en la ficha: nivel, escala de colores y dónde cae la base frente al rango del nivel
  const PECR_COL = ['#E0CFA3', '#CFC48D', '#B8BA7C', '#9DAE70', '#80A068', '#619060', '#477F57', '#316C4E', '#1F5843', '#123F31'];
  function pecrHTML(r, pc) {
    const z = (r.ent || {}).zh, zu = z && z.v ? z.v / PX.tc.venta : null, bu = r.usdm2;
    const L = v => Math.max(0, Math.min(100, Math.log10(Math.max(1, Math.min(1000, v))) / 3 * 100)); // escala log de US$1 a US$1 000 por m²
    const pos = bu == null ? '' : bu < pc[2] ? 'por debajo del rango' : bu >= pc[3] ? 'por encima del rango' : 'dentro del rango';
    return `<div class="pecrb emph">
      <div class="iphh"><span class="iphn${pc[0] <= 4 ? ' lt' : ''}" style="--c:${PECR_COL[pc[0] - 1]}">${pc[0]}<small>/${PX.PECR_N}</small></span><div><b><span class="pico">${PX.PECR_ICON[pc[0] - 1]}</span>Nivel ${pc[0]} de ${PX.PECR_N}</b><span>${esc(pc[1])}</span></div><button class="linkbtn" data-about="guia" data-gsec="met">¿Qué es?</button></div>
      <div class="pscale">${PX.PECR.map((x, i) => `<span class="${x[0] === pc[0] ? 'me' : ''}" style="--c:${PECR_COL[i]}" title="Nivel ${x[0]}: ${esc(x[1])} (${PX.pecrRango(x)})">${PX.PECR_ICON[i]}<i>${x[0]}</i></span>`).join('')}</div>
      <div class="lv"><span>Rural aislado</span><span>Centralidad urbana</span></div>
      <div class="prange"><div class="pr-t"><i style="left:${L(pc[2])}%;width:${L(pc[3]) - L(pc[2])}%;background:${PECR_COL[pc[0] - 1]}"></i>${bu != null ? `<b class="mk" style="left:${L(bu)}%" title="Base vigente"></b>` : ''}${zu ? `<b class="mk zh" style="left:${L(zu)}%" title="Valor de Hacienda"></b>` : ''}</div>
        <div class="pr-ax">${[1, 10, 100, 1000].map(v => `<span style="left:${L(v)}%">US$${v}</span>`).join('')}</div></div>
      ${PX.pecrTable(pc, bu, zu, PECR_COL[pc[0] - 1])}</div>`;
  }

  // Bloque del Índice Puja/Hacienda en la ficha
  function iphHTML(r) {
    const x = PX.iph(r); if (!x) return '';
    const st = r.st != null ? r.st : 0;
    return `<div class="iph emph"><div class="iphh"><span class="iphn" style="--c:${x.band[2]}">${Math.round(x.v)}</span><div><b>${esc(x.band[1])}</b><span>IPH ${Math.round(x.v)}: la puja arranca en el ${Math.round(x.v)} % del valor de Hacienda</span></div><button class="linkbtn" data-about="guia" data-gsec="met">¿Qué es?</button></div>
      ${PX.iphBar(x.v)}
      <p class="note2">La puja arranca en <b>${PX.duoI(x.base, 'CRC')}</b>; el valor según Hacienda es <b>${PX.duoI(x.hac, 'CRC')}</b>${x.constr ? ` (terreno ${PX.duoI(x.terreno, 'CRC')} + construcción estimada ${PX.duoI(x.constr, 'CRC')})` : ' (solo terreno)'}.</p>
      <div class="iphst">${x.etapas.map((v, i) => `<span class="${i === st ? 'cur' : i < st ? 'past' : ''}">${PX.stageBadge(i, true)} <b style="color:${PX.iphBand(v)[2]}">${Math.round(v)}</b></span>`).join('')}</div>
      ${x.aviso ? `<p class="note2 warnt">⚠ ${esc(x.aviso)}</p>` : ''}</div>`;
  }

  // Remates en el mapa
  const markers = L.layerGroup().addTo(map), polys = L.layerGroup().addTo(map), selLayer = L.layerGroup().addTo(map);
  function tip(r) {
    const a = PX.prof(r);
    if (r.isPlano) return `<span class="tipn">${esc(r.nom)}</span>${a ? fnum(a) + ' m²' : ''}<br><span class="tipm">${esc(r.lugar)}</span>`;
    return `<span class="tipn">${PX.isFav(r.key) ? '♥ ' : ''}${esc(r.nom)}</span>${PX.stageBadge(r.st, true)} ${PX.duoI(r.bv, r.mon)}<br>${a ? fnum(a) + ' m²' : 'área s/d'}${r.usdm2 ? ' · ' + PX.duoI(r.usdm2, 'USD', '/m²') : ''}<br><span class="tipm">${PX.ETAPA[r.st]} · ${fdate(r.next)}${r.bar && !r.nom.includes(r.bar) ? '<br>' + esc(r.bar) : ''}</span>`;
  }
  const ringLL = r => r.poly.map(p => p.map(ring => ring.map(([x, y]) => [y, x])));
  // Marcador en cruz: dos líneas que se cruzan sobre el punto; color según la etapa del remate
  const XC = ['#2B5C8A', '#B7791F', '#B42318'];
  // Tamaños 30 % mayores que la primera versión: 18 / 26 / 34 px según el zoom
  const xIcon = (st, big, fav) => { const c = XC[st] || '#15302A', s2 = big === 2 ? 34 : big ? 26 : 18, h = s2 / 2, g = 3.2; return L.divIcon({ className: 'xh', iconSize: [s2, s2], iconAnchor: [h, h], html: `<svg width="${s2}" height="${s2}" viewBox="0 0 ${s2} ${s2}"><path d="M${h} 0V${h - g}M${h} ${h + g}V${s2}M0 ${h}H${h - g}M${h + g} ${h}H${s2}" stroke="${c}" stroke-width="${big === 2 ? 3.9 : big ? 3.1 : 2.6}" stroke-linecap="round"/>${fav ? `<circle cx="${h}" cy="${h}" r="4.2" fill="#C8553D"/>` : `<circle cx="${h}" cy="${h}" r="2.1" fill="${c}"/>`}</svg>` }); };
  function renderMarkers() {
    markers.clearLayers(); polys.clearLayers();
    const z = map.getZoom();
    for (const r of shown) {
      if (!r.ll) continue;
      const col = XC[r.st], ll = [r.ll[1], r.ll[0]];
      const on = l => { l.on('click', () => openFicha(r.key, true)); l.on('mouseover', () => { overMarker = true; hb.hidden = true; }); l.on('mouseout', () => { overMarker = false; }); };
      if (r.exact && r.poly && z >= 15) {
        const pg = L.polygon(ringLL(r), { color: col, weight: 2, fillColor: col, fillOpacity: 0.18 });
        on(pg); pg.bindTooltip(tip(r), { direction: 'top', sticky: true }); polys.addLayer(pg);
      }
      const m = L.marker(ll, { icon: xIcon(r.st, z >= 13 ? 2 : z >= 10 ? 1 : 0, PX.isFav(r.key)), keyboard: false, riseOnHover: true });
      on(m); m.bindTooltip(tip(r), { direction: 'top', offset: [0, -10] });
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
        <span class="alt eqbig">${PX.other(r.bv, r.mon)}</span>
        <span class="alt"><span>${a ? fnum(a) + ' m²' : 'área s/d'}</span>${r.usdm2 ? `<span>${PX.duoI(r.usdm2, 'USD', ' por m²')}</span>` : ''}</span></div>`;
    }
    const tl = (r.fd || []).map((d, k) => `<div class="tl ${k < r.st ? 'past' : ''} ${k === r.st ? 'now' : ''}">${PX.stageBadge(k, true)}
        <span class="d">${PX.ETAPA[k]}${k ? ` · ${PX.PCT[k] * 100} %` : ''}<small>${fdate(d, true)}</small></span><span class="b">${PX.duo(r.bases[k], r.mon)}</span></div>`).join('');
    const attrs = ATTR.filter(x => x[2](r)).map(x => x[1]);
    const nserv = (r.serv || []).length;
    const fav = PX.isFav(r.key);
    const I = PX.ICON, sec = (icon, t, body, right) => `<section class="fs"><h3>${icon}${t}${right ? `<span class="r">${right}</span>` : ''}</h3><div class="fb">${body}</div></section>`;
    const z = e.zh, topo = PX.topo(r), nv = PX.pro.normativa(r), dm = nv.dims, pc = PX.pecr(r);
    const pecrH = pc ? pecrHTML(r, pc) : '';
    const ubic = r.isPlano ? 'Predio del catastro consultado por plano' : r.exact ? `Ubicada por ${r.loc} en el catastro` : 'Aproximada: el punto marca el centro del distrito declarado, porque el catastro no devolvió el predio';
    f.innerHTML = `<div class="fhead">${PX.tipoIcon(r)}${r.isPlano ? '<span class="tag">Predio consultado</span>' : PX.stageBadge(r.st) + `<span class="tag${r.tipo === 'Agrícola' ? ' agro' : ''}">${esc(r.tipo)}</span>`}<button class="btn sm favbtn" data-act="fav" aria-pressed="${fav}">${PX.HEART}${fav ? 'En favoritos' : 'Favorito'}</button><button class="x" id="fx" aria-label="Cerrar ficha">×</button></div>
    <div class="fbody">
      <div class="ftitle"><h2>${esc(r.nom)}</h2><div class="where">${esc(r.lugar || 'Ubicación por definir')}</div></div>
      ${top}
      ${actionsHTML(r)}
      ${r.rev ? `<div class="note">${esc(r.rev)}</div>` : ''}
      ${r.isPlano ? '' : sec(PX.ICON.gavel, 'Remate', `<div class="timeline">${tl || '<div class="tl">Sin fechas legibles en el edicto.</div>'}</div>`, PX.whenTag(r.next))}
      ${sec(I.moneda, PX.iph(r) ? 'Índice Puja/Hacienda' : 'Valor y mercado', `<dl class="kv">
        ${z ? `<dt>Zona homogénea</dt><dd>${esc(z.c)} · ${esc(PX.cap(z.n))}<small class="sub">Hacienda (ONT): ${PX.duoI(z.v, 'CRC', '/m²')} · tipología ${esc(z.u)}</small></dd>` : '<dt>Zona homogénea</dt><dd>Sin dato</dd>'}
      </dl>${iphHTML(r)}`)}
      ${pecrH ? sec(I.valor, 'Escala de valor PECR <small class="h3sub">(PlanoExactoCR)</small>', pecrH) : ''}
      ${sec(I.terreno, 'Terreno', `<dl class="kv">
        <dt>Área</dt><dd>${r.area ? fnum(r.area) + ' m² en edicto' : ''}${r.area && r.areaCat ? ' · ' : ''}${r.areaCat ? fnum(r.areaCat) + ' m² en catastro' : ''}${!r.area && !r.areaCat ? '—' : ''}</dd>
        ${dm ? `<dt>Dimensiones</dt><dd>≈ ${fnum(dm.corto, 1)} × ${fnum(dm.largo, 1)} m<small class="sub">relación 1:${fnum(dm.rel, 1)}</small></dd>` : ''}
        <dt>Topografía</dt><dd>${topo ? esc(topo.txt) : 'Sin cartografía 1:5 000 en el sitio'}${topo ? '<small class="sub">Según curvas de nivel del IGN</small>' : ''}</dd>
        ${e.cob || r.isPlano ? `<dt>Uso del suelo</dt><dd id="pcob">${esc(e.cob || r.cob || '…')}</dd>` : ''}
        ${e.zv ? `<dt>Zona de vida</dt><dd>${esc(e.zv)}</dd>` : ''}
      </dl>`)}
      ${sec(I.entorno, 'Servicios y entorno', `<dl class="kv">
        <dt>Agua potable</dt><dd>${e.aguaS ? 'Cobertura de ' + esc(e.aguaS.join(', ')) : 'Sin cobertura registrada'}<small class="sub">AyA, ESPH, ASADAS y acueductos municipales</small></dd>
        ${e.via ? `<dt>Vía más cercana</dt><dd>${e.via.d <= 10 ? esc(e.via.t) + ', al frente' : esc(e.via.t) + ' a ' + PX.dist(e.via.d)}</dd>` : ''}
        ${e.salud ? `<dt>Salud</dt><dd>${esc(e.salud.n)}<small class="sub">${PX.dist(e.salud.d)}</small></dd>` : ''}
        ${e.esc != null ? `<dt>Escuela</dt><dd>A ${PX.dist(e.esc)}</dd>` : ''}
        ${e.agua !== undefined ? `<dt>Ríos</dt><dd>${e.agua == null ? 'Ninguno a menos de 400 m' : 'Cauce a ' + PX.dist(e.agua)}</dd>` : ''}
        ${e.costa != null && e.costa < 2000 ? `<dt>Costa</dt><dd>A ${PX.dist(e.costa)}${e.costa <= 200 ? ' <span class="tag warn">zona marítimo terrestre</span>' : ''}</dd>` : ''}
      </dl>`)}
      ${sec(I.norma, 'Normativa', `<p style="margin:0"><b>${esc(nv.titulo)}.</b> ${esc(nv.vigente ? 'Confirme zona, usos, cobertura y altura con el certificado de uso de suelo.' : 'Lote mínimo 90 a 120 m², frente mínimo 6 m, fondo hasta 7 veces el frente.')}</p>${nv.alertas.slice(0, 2).map(t => `<div class="note" style="padding:6px 9px">${esc(t)}</div>`).join('')}`)}
      ${sec(I.registro, 'Registro y ubicación', `<dl class="kv">
        <dt>Finca</dt><dd class="num">${esc(r.fincaTxt)}${r.multi ? ' <span class="tag warn">varias fincas o derechos</span>' : ''}</dd>
        <dt>Plano</dt><dd class="num">${esc(r.plano || (r.planoCat ? PX.planoTxt(r.planoCat) + ' (catastro)' : 'No indicado'))}</dd>
        ${r.isPlano ? '' : `<dt>Servidumbres</dt><dd>${nserv ? `<span class="tag warn">${nserv === 1 ? 'Una citada' : nserv + ' citadas'}</span>` : 'Ninguna citada en el edicto'}</dd>`}
        <dt>Ubicación</dt><dd>${esc(ubic)}</dd>
        ${r.pub ? `<dt>Publicado</dt><dd>${fdate(r.pub)}<small class="sub">Boletín Judicial Nº ${(r.bols || [r.bol]).join(' y ')}</small></dd>` : ''}
      </dl>`)}
      ${sec(PX.ICON.valor, 'Índice PlanoExacto', `<div class="idx">${scoreRing(s.total)}<div class="lab"><b>${PX.scoreLabel(s.total)}</b><span>Sanidad jurídica, precio por m², servicios y restricciones</span></div></div>
        <div class="${full ? '' : 'blur'}" aria-hidden="${!full}">${barsHTML(s)}</div>
        ${full ? '' : `<div class="prohint"><span>${PX.PRO} Desglose en el expediente o en PRO</span><button class="linkbtn" data-planes>Ver planes</button></div>`}`)}
      ${r.isPlano ? '' : sec(PX.ICON.Lote, 'Atributos del lote', `<div class="chips${pro ? '' : ' blur'}">${(pro ? attrs : ['Terreno plano', 'Frente a vía', 'Zona urbana']).map(t => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="chip">Sin atributos destacados</span>'}</div>`, PX.PRO)}
      ${proBox(r)}
      ${expBox(r)}
      <div class="foot">Información orientativa de fuentes públicas. No sustituye la certificación del Registro Nacional, el certificado de uso de suelo ni la revisión del expediente judicial. <button class="linkbtn" data-about="terms">Términos y descargo</button></div>
    </div>`;
    f.querySelectorAll('dl.kv dt').forEach(dt => { const ic = PX.rowIcon(dt.textContent); if (ic) dt.insertAdjacentHTML('afterbegin', `<span class="ri" aria-hidden="true">${ic}</span>`); });
    f.hidden = false;
    $('fx').onclick = closeFicha;
    if (r.isPlano && !r.cob && !e.cob && r.ll) PX.cobertura(r.ll[0], r.ll[1]).then(v => { r.cob = v; if (r.ent) r.ent.cob = v; PX.savePlano(r); const d = $('pcob'); if (d) d.textContent = v || 'Sin dato del MINAE'; });
    selLayer.clearLayers();
    if (r.ll) {
      const col = r.isPlano ? css('--accent') : XC[r.st];
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
    if (act === 'fav') return favToggle(r.key);
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
    modal(`<div class="hd"><img src="assets/img/logo-mark.webp" alt="" width="56" height="40" class="dlgmark"><h2>Planes de PlanoExactoCR</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
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
  // ---------- Cómo usar la herramienta (guía de funciones gratis y PRO) ----------
  function guideHTML() {
    const I = PX.ICON, cupo = PX.PRECIOS.cupo, P_ = PX.PRO;
    // Bloques didácticos: tarjeta con «para qué sirve», pasos numerados y un ejemplo
    const steps = arr => `<ol class="gsteps">${arr.map(t => `<li><span>${t}</span></li>`).join('')}</ol>`;
    const card = (ic, t, pro, para, pasos, ej) => `<div class="gcard"><h4><span class="gi">${ic || ''}</span>${t}${pro ? ' ' + P_ : ''}</h4>
      <p class="gpara"><b>¿Para qué sirve?</b> ${para}</p>${pasos ? `<div class="glbl">Cómo se usa</div>${steps(pasos)}` : ''}${ej ? `<p class="gej"><b>Ejemplo:</b> ${ej}</p>` : ''}</div>`;
    const tip = t => `<p class="gtip"><b>Consejo</b> ${t}</p>`;
    const sec = (id, t, intro, body) => `<section class="gsec" id="g-${id}"><h3>${t}</h3>${intro ? `<p class="gintro">${intro}</p>` : ''}${body}</section>`;
    const toc = [['inicio', 'En 5 pasos'], ['mapa', 'El mapa'], ['buscar', 'Buscar y filtrar'], ['ficha', 'La ficha'], ['herr', 'Herramientas PRO'], ['exp', 'Expediente'], ['met', 'Índices y metodología'], ['fuentes', 'Origen de los datos'], ['gloss', 'Palabras clave']];
    const flow = [[I.pin, 'Mira el mapa', 'Cada cruz es una propiedad en remate.'], [I.list, 'Filtra', 'Elige zona, precio, tamaño o tipo.'], [I.Lote, 'Abre la ficha', 'Haz clic en una cruz o en la lista.'], [I.valor, 'Analiza', 'Usa las herramientas PRO.'], [I.gavel, 'Decide', 'Descarga el expediente y verifica.']];
    return `<div class="about guide">
      <nav class="gtoc" aria-label="Contenido">${toc.map(([k, t]) => `<button class="chip" data-gto="${k}">${t}</button>`).join('')}</nav>

      ${sec('inicio', 'PlanoExactoCR en 5 pasos', 'PlanoExactoCR te muestra en un mapa las propiedades que salen a remate judicial en Costa Rica y te ayuda a entender cada una antes de ofertar.',
        `<div class="gflow">${flow.map(([ic, t, d], i) => `<div class="gstep"><span class="gn">${i + 1}</span><span class="gi">${ic}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
        ${tip('¿Prefieres ver los montos en dólares? Cambia la moneda arriba a la derecha (₡ / US$). Siempre verás también el equivalente en la otra moneda.')}`)}

      ${sec('mapa', 'Cómo leer el mapa', '',
        `<div class="ggrid">
          <div class="gcard"><h4>Las cruces y sus colores</h4><p class="gpara">El color dice en qué remate va la propiedad. Mientras más avanza, más baja el precio mínimo (la <b>base</b>).</p>
            <ul class="gkey"><li>${PX.stageBadge(0, true)} <span><b>Primer remate</b>: precio completo</span></li><li>${PX.stageBadge(1, true)} <span><b>Segundo remate</b>: 75 % del precio</span></li><li>${PX.stageBadge(2, true)} <span><b>Tercer remate</b>: 25 % del precio</span></li><li><i class="gfav"></i> <span>Punto rojizo al centro: <b>tu favorito</b></span></li></ul></div>
          <div class="gcard"><h4>Moverte por el mapa</h4><ul class="gkey">
            <li><span class="gk">+ / −</span><span>Acerca o aleja. El número indica el nivel: <b>8</b> ves el país, <b>17</b> ves la calle.</span></li>
            <li><span class="gk">Mouse</span><span>Al pasarlo te dice en qué distrito y cantón estás.</span></li>
            <li><span class="gk">Clic</span><span>En el mapa: te muestra los datos de las capas que tengas encendidas en ese punto.</span></li></ul></div>
        </div>
        ${card(I.entorno, 'Capas: información sobre el mapa', false, 'Encender información extra encima del mapa, como el valor del terreno, el agua potable o los ríos.',
          ['Pulsa <b>Capas</b> (arriba a la izquierda).', 'Abre un grupo, por ejemplo <b>Valor y mercado</b>.', 'Marca la capa que quieras ver. Para quitarla, desmárcala.'],
          'enciende <b>Zonas homogéneas de Hacienda</b> y acércate a una ciudad: verás cuánto vale el m² de terreno en cada zona, en colones y dólares.')}
        <p class="gmini">Gratis: mapas base, límites, catastro, nombres de ríos y estado del plan regulador. ${P_}: valor del terreno, precios por m², agua potable, vías, puertos y aeropuertos, salud, zonas de vida, uso del suelo, curvas de nivel, áreas protegidas y zona marítimo terrestre.</p>`)}

      ${sec('buscar', 'Buscar y filtrar', 'Hay más de 800 remates. Los filtros te ayudan a quedarte solo con los que te interesan.',
        `${card(I.list, 'Filtros', false, 'Reducir la lista a lo que buscas.',
          ['En <b>Ubicación</b> escribe un lugar o elige provincia y cantón.', 'En <b>Remate</b> elige la etapa, las fechas y cuánto quieres pagar como máximo.', 'En <b>Características</b> elige el tipo (lote, casa, finca agrícola…) y el tamaño en m².'],
          'lotes en Guanacaste, de 500 a 2&nbsp;000&nbsp;m², con base menor a ₡20&nbsp;millones.')}
        <div class="ggrid">
          <div class="gcard"><h4>Botones útiles</h4><ul class="gkey">
            <li><span class="gk">Restablecer</span><span>Borra todos los filtros de una vez.</span></li>
            <li><span class="gk">Favoritos</span><span>Muestra solo los que marcaste con ♥.</span></li>
            <li><span class="gk">Calendario</span><span>Ve los remates día por día. Los de <b>mañana</b> salen resaltados.</span></li>
            <li><span class="gk">Guardar búsqueda</span><span>Guarda tus filtros para usarlos otra vez.</span></li></ul></div>
          ${card(I.registro, 'Buscar un plano', false, 'Consultar cualquier terreno del país, esté o no en remate.', ['Abre la pestaña <b>Buscar plano</b>.', 'Escribe el número de plano (por ejemplo P-1311611-2008) o el de finca.', 'Pulsa <b>Buscar en el catastro</b> y luego <b>Ver en el mapa</b>.'], '')}
        </div>
        ${tip(`Con ${P_} tienes filtros extra por <b>atributos del lote</b>: terreno plano, con construcción, frente a calle pública, zona urbana y más.`)}`)}

      ${sec('ficha', 'La ficha de cada propiedad', 'Al abrir una propiedad ves su ficha a la derecha. Está ordenada como una historia: primero cuánto y cuándo, después cómo es el terreno y al final los datos legales.',
        `<div class="gtable">
          <div><b>Remate</b><span>Precio mínimo (base) y las fechas de los tres remates.</span></div>
          <div><b>Valor y mercado</b> ${P_}<span>Cuánto vale la propiedad según Hacienda, el <b>Índice Puja/Hacienda</b> y la <b>escala PECR</b> (del 1 al 10).</span></div>
          <div><b>Terreno</b><span>Tamaño, forma aproximada, si es plano o quebrado, y uso actual del suelo.</span></div>
          <div><b>Servicios y entorno</b><span>Agua potable, calle, salud, escuela, ríos y costa cercanos.</span></div>
          <div><b>Normativa</b><span>Qué plan regulador aplica (o las normas nacionales si el cantón no tiene).</span></div>
          <div><b>Registro y ubicación</b><span>Número de finca y plano, y qué tan exacta es la ubicación en el mapa.</span></div>
        </div>
        ${tip('Usa ♥ <b>Favorito</b> para marcarla, <b>Seguir</b> para recibir avisos y <b>Comparar</b> para ponerla junto a otras.')}`)}

      ${sec('herr', `Herramientas ${P_}`, `Responden las preguntas que todo comprador se hace. Se abren desde la ficha (recuadro dorado) o desde la pestaña ${P_} de la izquierda. Todos los números se pueden cambiar y el resultado se actualiza solo.`,
        `<div class="ggrid">
        ${card(I.valor, '¿Cuánto vale realmente?', true, '<b>Valor de referencia.</b> Estima el valor de la propiedad para saber si la base es buena oportunidad.',
          ['Revisa el área del terreno y el valor de Hacienda (ya vienen llenos).', 'Si tiene casa, ajusta el área construida, el tipo de construcción, la edad y el estado.', 'Mira el resultado: <b>Base frente a referencia</b>.'],
          'si dice <b>60 %</b>, la base es un 40 % menor que el valor de referencia.')}
        ${card(I.Lote, '¿Cuánto puedo construir?', true, '<b>Potencial constructivo.</b> Calcula cuántos m² y cuántas casas o apartamentos caben en el lote.',
          ['Revisa cobertura (qué porcentaje del lote se puede techar) y número de pisos.', 'Indica el tamaño de cada unidad (por ejemplo 80 m²).', 'Lee cuántas unidades caben y cuántos lotes saldrían si se divide.'], '')}
        ${card(I.valor, '¿Es buen negocio?', true, '<b>Prefactibilidad financiera.</b> Calcula cuánto invertirías, cuánto podrías ganar y en cuánto tiempo.',
          ['Elige: <b>comprar y revender</b> el terreno o <b>construir y vender</b>.', 'Escribe tu oferta y revisa los gastos (traspaso, abogado, timbres).', 'Mira la <b>utilidad</b> y el <b>retorno</b>. En verde, gana; en rojo, pierde.'],
          'el <b>punto de equilibrio</b> te dice el precio mínimo al que tendrías que vender para no perder.')}
        ${card(I.norma, '¿Qué puede salir mal?', true, '<b>Riesgos del proceso.</b> Lista los problemas posibles de esa propiedad y qué revisar antes de ofertar.', '', 'hipotecas que siguen vigentes, servidumbres, gente viviendo en la casa o restricciones ambientales.')}
        </div>
        <div class="gtable">
          <div><b>Alertas</b><span>Te avisa por correo o WhatsApp si un remate que sigues cambia de fecha o etapa, o si sale uno nuevo que cumple tu búsqueda guardada.</span></div>
          <div><b>Mapa de precios</b><span>Pinta cada cantón según el precio típico por m² de los remates.</span></div>
          <div><b>Top 10 del mes</b><span>Los remates mejor calificados de cada provincia.</span></div>
          <div><b>Comparar</b><span>Gratis comparas 2 propiedades; con ${P_}, hasta 4, y decides qué pesa más para ti (precio, servicios, entorno…).</span></div>
        </div>`)}

      ${sec('exp', 'El expediente en PDF', 'Un informe de 4 hojas con todo lo importante de una propiedad, listo para imprimir, guardar o compartir con tu abogado.',
        `<div class="gflow g4">${[['Mapa', 'El lote, su entorno y una vista satelital.'], ['Ficha', 'Fechas, registro, valor y análisis.'], ['Normativa y riesgos', 'Lo que se puede hacer y lo que hay que revisar.'], ['Edicto', 'El texto oficial del remate.']].map(([t, d], i) => `<div class="gstep"><span class="gn">${i + 1}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
        <p class="gmini">Se genera con el botón <b>Generar expediente</b> de la ficha. Se compra por propiedad o viene incluido en ${P_} (hasta ${cupo} al mes).</p>`)}

      ${sec('met', 'Índices y metodología', 'Cómo se calcula cada número que ves en la ficha y en el expediente. Son referencias para comparar, no avalúos.',
        `${card(I.valor, 'Índice Puja/Hacienda (IPH)', false, 'Saber en un solo número si el precio con que arranca la puja es bajo o alto frente al valor que Hacienda le da a la propiedad.',
          ['Se toma la <b>base vigente</b>: el precio con que arranca la puja en el remate que sigue.', 'Se calcula el <b>valor según Hacienda</b>: área × valor de la zona homogénea; si hay casa, se suma la construcción estimada con el manual de tipologías de la ONT.', '<b>IPH = base vigente ÷ valor según Hacienda × 100.</b>'],
          'IPH <b>45</b> quiere decir que la puja arranca en el 45 % del valor de Hacienda. Si el remate pasa a la siguiente etapa, el índice baja: la ficha muestra el IPH del 1.º, 2.º y 3.º remate.')}
        <div class="gtable">${PX.IPH.map((b, i) => `<div><b><span class="iphdot" style="--c:${b[2]}"></span>${i ? 'de ' + PX.IPH[i - 1][0] + ' ' : 'menos de '}${b[0] === Infinity ? 'o más' : (i ? 'a ' : '') + b[0]}</b><span><b>${b[1]}.</b> ${b[3]}</span></div>`).join('')}</div>
        <p class="gmini">${PX.iphBar(45)}</p>
        ${tip('Hacienda suele valorar por debajo del mercado, así que un IPH bajo es una señal fuerte. Un IPH muy bajo (menos de 10) también puede indicar que se remata solo una parte de la finca (derechos) o que el área del edicto no coincide: la ficha lo advierte.')}

        ${card(I.entorno, 'Escala PECR, PlanoExactoCR (niveles 1 a 10)', false, 'Ubicar el lote en una escala de valor según su acceso, servicios y entorno, con un rango orientativo de precio por m².', '', '')}
        <div class="gtable pecrtab">${PX.PECR.map(x => `<div><b><span class="pn">${x[0]}</span><span class="pico">${PX.PECR_ICON[x[0] - 1]}</span>${PX.pecrRango(x)}</b><span>${esc(x[1])}</span></div>`).join('')}</div>
        <p class="gmini"><b>Cómo se calibra:</b> los rangos son contiguos y no se traslapan: cada nivel empieza donde termina el anterior, desde US$0 hasta el nivel 10, que no tiene tope. Se ajustaron con el valor de zona homogénea de Hacienda de los 801 remates (en dólares). El nivel de cada lote es el rango donde cae su valor de Hacienda; las reglas del sitio (frente a vía pública, agua, distancia a salud y escuela, zona urbana o rural) lo suben o bajan un nivel solo cuando apuntan claramente a otro (diferencia de 3 niveles o más). Así, en casi 8 de cada 10 lotes (77 %) el valor de Hacienda cae dentro del rango de su nivel.</p>

        <div class="gcard"><h4><span class="gi">${I.gavel}</span>Índice PlanoExacto (0 a 100)</h4><p class="gpara"><b>¿Para qué sirve?</b> Comparar remates entre sí con una nota general. Suma cuatro dimensiones con estos pesos:</p>
          <ul class="gkey">${PX.DIMS.map(d => `<li><span class="gk">${PX.W0[d.k]} %</span><span><b>${esc(d.n)}:</b> ${esc(d.d)}.</span></li>`).join('')}</ul><p class="gmini">Con ${P_} puedes cambiar los pesos al comparar.</p></div>
        <div class="gtable">
          <div><b>Valor de referencia</b><span>Terreno = área × valor de la zona homogénea. Construcción = m² × valor de la tipología ONT 2023 (Alcance 187, La Gaceta 178), con depreciación por edad (método de Ross) y estado de conservación (Heidecke). Por defecto se suponen 20 años y estado intermedio.</span></div>
          <div><b>Topografía</b><span>Pendiente media calculada con las curvas de nivel del IGN: <b>plana</b> menos de 5 %, <b>ondulada</b> 5 a 15 %, <b>quebrada</b> 15 a 30 %, <b>muy quebrada</b> más de 30 %.</span></div>
          <div><b>Precio por m²</b><span>Base vigente ÷ área (del catastro si existe, si no del edicto). La mediana por cantón usa al menos 3 remates.</span></div>
          <div><b>Ubicación exacta o aproximada</b><span><b>Exacta</b>: el plano o la finca se encontró en el catastro del Registro Inmobiliario. <b>Aproximada</b>: no se encontró y la cruz va al distrito o poblado del edicto.</span></div>
          <div><b>Zona marítimo terrestre</b><span>Franjas de 50 y 200 m trazadas desde la línea de costa del IGN. Es un cálculo propio, no el amojonamiento oficial.</span></div>
          <div><b>Tipo de cambio</b><span>Tipo de cambio de referencia de venta del BCCR del día de la actualización.</span></div>
        </div>`)}

      ${sec('fuentes', 'Origen de los datos', 'Toda la información viene de fuentes públicas. PlanoExactoCR la reúne, la cruza y le da estilo propio.',
        `<div class="gtable srctab">
          <div><b>Remates</b><span>Edictos del <b>Boletín Judicial</b> (Imprenta Nacional): fechas, bases, gravámenes y expediente. Se omiten nombres y cédulas.</span></div>
          <div><b>Catastro y planos</b><span><b>Registro Inmobiliario</b>, servicios del SNIT: predios, planos catastrados y vías públicas.</span></div>
          <div><b>Límites, ríos, curvas e infraestructura</b><span><b>Instituto Geográfico Nacional (IGN)</b>, SNIT: cantones y distritos, hidrografía y nombres de ríos, curvas de nivel, línea de costa, aeropuertos, aeródromos y muelles (escalas 1:5 000 a 1:200 000).</span></div>
          <div><b>Valor del terreno</b><span><b>Ministerio de Hacienda, Órgano de Normalización Técnica (ONT)</b>: zonas homogéneas y manual de tipologías constructivas 2023.</span></div>
          <div><b>Agua potable</b><span><b>AyA</b>: áreas de cobertura del AyA, la ESPH, las ASADAS y los acueductos municipales.</span></div>
          <div><b>Planes reguladores</b><span><b>INVU</b>: estado y año de publicación de cada plan regulador.</span></div>
          <div><b>Ambiente</b><span><b>MINAE</b>: mapa agropecuario y forestal 2020 y zonas de vida (CENIGA). <b>FONAFIFO</b>: pago por servicios ambientales 2025. Franjas de protección de ríos: PNUD-TEVU (referencia no oficial).</span></div>
          <div><b>Salud y educación</b><span><b>CCSS</b>: EBAIS, áreas de salud y hospitales. Escuelas y colegios: puntos de interés del <b>IGN</b>.</span></div>
          <div><b>Tipo de cambio</b><span><b>Banco Central de Costa Rica (BCCR)</b>.</span></div>
          <div><b>Mapas base</b><span>Esri (claro, calles, relieve, oscuro y ortofoto de Maxar y Earthstar Geographics), OpenStreetMap y OpenTopoMap.</span></div>
        </div>
        <p class="gmini">Cada fuente tiene su propia escala y fecha de actualización. Puede haber diferencias entre capas; ante cualquier duda, la fuente oficial manda.</p>`)}

      ${sec('gloss', 'Palabras clave', '',
        `<div class="gtable">
          <div><b>Base</b><span>Precio mínimo para ofertar. Baja en cada remate: 100 %, 75 % y 25 %.</span></div>
          <div><b>Zona homogénea</b><span>Zona donde Hacienda fija un mismo valor del terreno por m².</span></div>
          <div><b>Escala PECR (PlanoExactoCR)</b><span>Nota del 1 al 10: 1 es campo aislado sin servicios y 10 es una centralidad urbana de alto valor. Cada nivel trae un rango de precio por m².</span></div>
          <div><b>Índice PlanoExacto</b><span>Nota de 0 a 100 que resume precio, situación legal, servicios y entorno.</span></div>
          <div><b>IPH</b><span>Índice Puja/Hacienda: en qué porcentaje del valor de Hacienda arranca la puja. 50 = a la mitad.</span></div>
          <div><b>Ubicación aproximada</b><span>Cuando no encontramos el plano exacto, la cruz va al centro del distrito o poblado. La ficha lo indica.</span></div>
          <div><b>ZMT</b><span>Zona marítimo terrestre: los 200 m desde la playa. Los primeros 50 m son públicos.</span></div>
        </div>
        <p class="muted">Recuerda: todo es información orientativa. Antes de ofertar, revisa el expediente judicial y consulta con un abogado. Ver <button class="linkbtn" data-about="terms">Términos y descargo</button>.</p>`)}
    </div>`;
  }
  // ---------- Quiénes somos y descargo de responsabilidad ----------
  function openAbout(which) {
    const us = `<div class="about">
      <img src="assets/img/logo.webp" alt="PlanoExactoCR · Ubica, comprende, decide" width="900" height="481" style="width:220px;height:auto">
      <p><b>PlanoExactoCR</b> reúne en un solo mapa los remates judiciales de propiedades de Costa Rica y los cruza con la información pública que normalmente está dispersa: catastro, planes reguladores, zonas homogéneas de Hacienda, agua potable, ríos, relieve, cobertura del suelo, salud, escuelas y normativa.</p>
      <h3>Quiénes somos</h3>
      <p>Somos un equipo de profesionales en urbanismo, arquitectura y planificación territorial con experiencia en planes reguladores, sistemas de información geográfica y gestión municipal en distintos cantones del país. Creamos PlanoExactoCR para que cualquier persona pueda <b>ubicar</b> un lote con precisión, <b>comprender</b> su contexto territorial y legal, y <b>decidir</b> con más información antes de participar en un remate.</p>
      <h3>Qué hacemos</h3>
      <ul><li>Leemos el Boletín Judicial y ubicamos cada propiedad por su plano o su finca en el catastro.</li><li>Calculamos un índice orientativo con sanidad jurídica, precio por m², servicios y restricciones.</li><li>Preparamos expedientes por lote con mapa, variables del sitio, potencialidades y riesgos.</li></ul>
      <h3>Lo que viene</h3>
      <ul><li>Propiedades curadas en venta, revisadas por nuestro equipo.</li><li>Amenazas naturales, historia del sitio con ortofotos del IGN y normativa por zona de cada plan regulador.</li><li>Cobertura en Panamá y otros países de Latinoamérica.</li></ul>
      <p class="muted">Contacto: <i>por definir</i>.</p></div>`;
    const terms = `<div class="about">
      <h3>Términos de uso y descargo de responsabilidad</h3>
      <p>Al usar PlanoExactoCR usted acepta lo siguiente:</p>
      <ul>
        <li><b>Naturaleza de la información.</b> Todo el contenido (mapas, fichas, índices, escalas de valor, expedientes y herramientas) es un <b>compendio de información pública</b> y un <b>análisis orientativo</b> generado en buena parte de forma automática. No es un certificado de uso de suelo, una certificación registral o catastral, un avalúo, un estudio de título, un dictamen técnico ni asesoría legal, financiera o de inversión.</li>
        <li><b>Fuentes de terceros.</b> Los datos provienen del Boletín Judicial, el Registro Inmobiliario, el IGN, el INVU, el Ministerio de Hacienda, el AyA, el MINAE, la CCSS, el BCCR y otros servicios públicos. Pueden contener errores, omisiones, desactualizaciones o diferencias de escala que no dependen de PlanoExactoCR. La ubicación de un predio puede ser aproximada.</li>
        <li><b>Verificación obligatoria.</b> Antes de ofertar, comprar o tomar cualquier decisión, usted debe verificar por su cuenta la información en el expediente judicial, el Registro Nacional, la municipalidad y con profesionales habilitados (abogado, topógrafo, perito valuador).</li>
        <li><b>Limitación de responsabilidad.</b> PlanoExactoCR, sus creadores, colaboradores y proveedores no asumen responsabilidad alguna por daños, pérdidas, costos o perjuicios directos o indirectos derivados del uso o la imposibilidad de uso del sitio, ni de decisiones tomadas con base en su contenido. El uso es bajo su propio riesgo.</li>
        <li><b>Sin relación con el proceso judicial.</b> PlanoExactoCR no participa en los remates, no representa a ninguna parte, juzgado, banco ni acreedor, y no garantiza fechas, bases, condiciones ni el resultado de ningún proceso.</li>
        <li><b>Datos personales.</b> Se omiten los nombres de personas deudoras y los números de cédula de los edictos. No se debe usar el sitio para identificar o contactar a personas.</li>
        <li><b>Valores de referencia.</b> Las zonas homogéneas, tipologías constructivas, escalas PECR, medianas y prefactibilidades son referencias estadísticas y supuestos editables, no valores de mercado ni avalúos.</li>
        <li><b>Cambios.</b> El contenido, los precios y estos términos pueden cambiar sin previo aviso. En la etapa de prueba, las cuentas y los pagos funcionan en modo demostración.</li>
      </ul>
      <p class="muted">Última actualización: ${PX.fdate(PX.now)}. Este texto debe ser revisado por un abogado antes del lanzamiento comercial.</p></div>`;
    const T = { guia: 'Cómo usar PlanoExactoCR', us: 'Quiénes somos', terms: 'Términos y descargo' };
    if (!T[which]) which = 'us';
    modal(`<div class="hd"><h2>${T[which]}</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
      <div class="seg" role="group"><button data-about="guia" aria-pressed="${which === 'guia'}">Cómo usar</button><button data-about="us" aria-pressed="${which === 'us'}">Quiénes somos</button><button data-about="terms" aria-pressed="${which === 'terms'}">Términos y descargo</button></div>
      ${which === 'terms' ? terms : which === 'guia' ? guideHTML() : us}`);
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-about]');
    if (a) { openAbout(a.dataset.about); if (a.dataset.gsec) setTimeout(() => { const t = document.getElementById('g-' + a.dataset.gsec); if (t) t.scrollIntoView({ block: 'start' }); }, 60); return; }
    const g = e.target.closest('[data-gto]'); if (g) { const t = document.getElementById('g-' + g.dataset.gto); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  const setVista = p => { if ((p === 'pro') === PX.isPro()) return; PX.acct.plan = p; PX.saveAcct(); toast(p === 'pro' ? 'Vista PRO: todas las herramientas activas' : 'Vista gratis: así la ve un usuario sin suscripción'); };
  $('vFree').onclick = () => setVista('free'); $('vPro').onclick = () => setVista('pro');

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
          ${sig.length ? sig.map(r => { const s0 = snap[r.key]; const cambio = s0 && s0.st !== r.st ? (r.st < 0 ? 'Ya pasaron todas las fechas' : `Pasó a ${PX.ETAPA[r.st]}`) : ''; return `<div class="li"><div><button class="linkbtn" data-open="${r.key}">${esc(r.nom)}</button><br><small>${r.st >= 0 ? `${PX.ETAPA[r.st]} · ${fdate(r.next)} · ${when(r.next)}` : 'Sin fechas pendientes'}</small>${cambio ? ` <span class="tag warn">${cambio}</span>` : ''}</div><div>${r.st >= 0 ? PX.duo(r.bv, r.mon) : ''}<br><button class="linkbtn" data-unsig="${r.key}" style="font-weight:500;font-size:12px">Dejar de seguir</button></div></div>`; }).join('') : '<small class="muted">Usa «Seguir» en la ficha de un remate para ver aquí su próxima fecha y los cambios de etapa.</small>'}
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
        <section class="acc"><h3>Administración</h3>
          <div class="li"><div><a href="catastro.html">Ubicar remates en el catastro</a><br><small>Botón para consultar el SNIT desde Costa Rica los remates nuevos que quedaron ubicados por distrito.</small></div></div>
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
      await Promise.all(res.map(async o => { const [z, ag] = await Promise.all([PX.zhQuery(o.ll[0], o.ll[1]), PX.aguaQuery(o.ll[0], o.ll[1])]); if (z) o.ent.zh = z; if (ag && ag.length) o.ent.aguaS = ag; o.pecr = PX.pecrCalc(o); }));
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
        ${row('Base vigente', its.map(r => r.isPlano ? '<span class="muted">No está en remate</span>' : PX.duo(r.bv, r.mon)), best(its.map(r => r.isPlano ? null : PX.usd(r.bv, r.mon)), false))}
        ${row('Área', its.map(r => PX.prof(r) ? fnum(PX.prof(r)) + ' m²' : '—'), best(its.map(PX.prof), true))}
        ${row('Precio por m²', its.map(r => r.usdm2 == null ? '—' : PX.duo(r.usdm2, 'USD')), best(m2, false))}
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
        <p>${r ? `Lote abierto: <b>${esc(r.nom)}</b>` : 'Abre un lote en el mapa o busca un plano para usar las herramientas de lote.'}</p>
        <div class="acts"><button class="btn sm" data-about="guia">Cómo usar las herramientas</button></div></div>
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
        <span class="rt"><div class="price">${PX.duo(x.r.bv, x.r.mon)}</div><div class="when">Índice <b class="num">${x.s.total}</b></div></span></button>`).join('') : '<div class="empty">No hay remates con fecha en ese mes para esta provincia.</div>'}</div>`;
  }
  $('topOut').addEventListener('change', e => { if (e.target.id === 'tProv') { topProv = +e.target.value; PX.store.set('px-topprov', topProv); } if (e.target.id === 'tMes') topMes = +e.target.value; renderTop(); });
  $('topOut').addEventListener('click', e => { const b = e.target.closest('.item[data-k]'); if (b) openFicha(b.dataset.k, true); });

  // ---------- tema ----------
  function retheme() { drawVectors(); renderMarkers(); if (open) openFicha(open, false); paintTheme(); }
  // Botón de tema claro / oscuro en la barra superior
  function paintTheme() { const d = dark(), b = $('bTheme'); if (!b) return; b.innerHTML = `<span class="ic" aria-hidden="true">${d ? PX.ICON.sol : PX.ICON.luna}</span>`; b.title = d ? 'Cambiar a colores claros' : 'Cambiar a colores oscuros'; b.setAttribute('aria-label', b.title); document.querySelector('meta[name=theme-color]').content = d ? '#151C1A' : '#FCFBF8'; }
  $('bTheme').onclick = () => {
    const t = dark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = t; try { localStorage.setItem('px-theme', t); } catch (e) {}
    if (baseId === 'claro' && t === 'dark') baseId = 'oscuro'; else if (baseId === 'oscuro' && t === 'light') baseId = 'claro';
    syncLayers();
  };
  paintTheme();
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme); } catch (e) {}
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- arranque ----------
  paintPlan(); paintTipos(); paintAttrs(); setCurUI(); drawVectors(); apply();
  await extra;
  const h = (location.hash || '').slice(1);
  if (/^r\d+$/.test(h) || /^p/.test(h)) openFicha(h, true);
  else if (/^r?(\d+)$/.test(h)) openFicha('r' + h.replace(/\D/g, ''), true);
})();
