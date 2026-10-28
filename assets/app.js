/* PlanoExactoCR — mapa, filtros, búsqueda por plano, comparador, Top 10 y cuenta. */
(async function () {
  'use strict';
  const { $, esc, css, fdate, fnum, when } = PX;
  let R, DIST, CANT, ZV, META, INFRA = null, ZMT = null;
  const loadZMT = () => { ZMT = { type: 'FeatureCollection', features: [] }; PX.get('data/zmt.geojson').then(z => { ZMT = z; drawVectors(); }).catch(() => {}); };
  try {
    [R, DIST, META] = await Promise.all([PX.cargarYo().then(() => PX.get('data/remates.json')), PX.get('data/distritos.geojson'), PX.get('data/meta.json')]);
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
    const b = $('planBadge'); b.textContent = PX.isPro() ? 'PRO' : PX.isEsencial() ? 'Esencial' : 'Gratis'; b.className = 'badge' + (PX.isPro() ? ' pro' : PX.isEsencial() ? ' ese' : ''); b.hidden = !PX.conCuenta();
    $('bCuenta').querySelector('span:not(.ic):not(.badge)').textContent = PX.conCuenta() ? 'Mi cuenta' : 'Entrar';
    $('bCuenta').classList.toggle('primary', !PX.conCuenta());
    const vs = document.querySelector('.vista'); if (vs) vs.style.display = PX.admin ? '' : 'none';
    $('attrHint').hidden = PX.isPro();
    $('vFree').setAttribute('aria-pressed', PX.plan() === 'free'); $('vBas').setAttribute('aria-pressed', PX.plan() === 'basico'); $('vPro').setAttribute('aria-pressed', PX.isPro());
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
    $('tipos').innerHTML = TIPOS.map(t => `<button class="tipo ${PX.tipoCls(t)}" data-t="${t}" aria-pressed="${tipoOn.has(t)}">${PX.ICON[t]}<span>${t === 'Con construcción' ? 'Construcción' : t}</span><span class="num muted">${live.filter(r => r.tipo === t).length}</span></button>`).join('');
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
    document.querySelectorAll('.amt .cu').forEach(e => e.textContent = PX.cur === 'CRC' ? '₡' : '$');
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
    const nt = nU + nR + nC + onlyFav; $('nAct').textContent = nt ? nt + (nt === 1 ? ' activo' : ' activos') : ''; $('resetF').disabled = false;
    limit = 100; renderList(); renderMarkers();
  }
  ['q', 'fMin', 'fMax', 'aMin', 'aMax'].forEach(id => $(id).addEventListener('input', apply));
  ['fCanton', 'order'].concat(CHK).forEach(id => $(id).addEventListener('change', apply));
  $('resetF').onclick = () => { setFilt({ order: $('order').value }); calDay = null; if (open) closeFicha(); vistaInicial(); toast('Filtros y mapa restablecidos'); };
  $('fProv').addEventListener('change', () => { fillCantones(); $('fCanton').value = ''; apply(); fitShown(); });
  $('fCanton').addEventListener('change', fitShown);
  $('saveSearch').onclick = () => {
    const n = prompt_('Nombre para esta búsqueda', [($('fCanton').value || PX.PROVS[+$('fProv').value - 1] || 'Todo el país'), [...tipoOn].join(', ')].filter(Boolean).join(' · '));
    n.then(name => { if (!name) return; PX.acct.busquedas.unshift({ n: name, s: filtState(), t: Date.now() }); PX.saveAcct(); toast('Búsqueda guardada en Mi cuenta'); });
  };

  // ---------- lista ----------
  function itemHTML(r) {
    const tags = [PX.tipoTag(r)];
    if (r.serv && r.serv.length) tags.push(`<span class="tag warn">Servidumbre</span>`);
    if (r.pub && PX.now - r.pub < 7 * 864e5) tags.push(`<span class="tag ok">Nuevo</span>`);
    if (PX.sigo(r.key)) tags.push(`<span class="tag gold">Siguiendo</span>`);
    if (r.iphV != null && PX.isPro()) { const b = PX.iphBand(r.iphV); tags.push(`<span class="tag iphtag" style="--c:${b[2]}" title="Índice Puja/Hacienda: ${esc(b[1])}">IPH ${Math.round(r.iphV)}</span>`); }
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
  $('list').addEventListener('dblclick', e => { const b = e.target.closest('.item'); if (!b) return; const r = PX.item(b.dataset.k); if (r && r.ll) irA(r); });

  // ---------- mapa ----------
  const map = L.map('map', { preferCanvas: true, zoomControl: true, minZoom: 7, maxZoom: 21, zoomSnap: 0.5 }).fitBounds([[8.03, -85.95], [11.22, -82.55]], { paddingTopLeft: [10, 10], paddingBottomRight: [10, 10] });
  map.setMaxBounds([[7.5, -87.5], [11.6, -82]]);
  const vistaInicial = () => map.fitBounds([[8.03, -85.95], [11.22, -82.55]], { paddingTopLeft: [10, 10], paddingBottomRight: [10, 10] });
  map.attributionControl.setPrefix('<a class="attrb" href="/" title="Ir al inicio">' + PX.marca('', 18, 12) + '<b>PlanoExacto</b>CR</a>');
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
  const esri = (svc, o) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, Object.assign({ maxZoom: 21, maxNativeZoom: 19 }, o));
  // Mapas base sin llave de API (CARTO pasó a exigir llave en 2026): Esri, OpenStreetMap y OpenTopoMap
  // Los nombres (calles, poblados, ríos) van en una capa superior para que no los tapen las capas temáticas
  map.createPane('lbl').style.zIndex = 450; map.getPane('lbl').style.pointerEvents = 'none';
  const lblOpt = { pane: 'lbl', zIndex: 5 };
  const EA = 'Mapa &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, OpenStreetMap', SA = 'Imágenes &copy; Esri, Maxar, Earthstar Geographics';
  const canvas = (v, o) => esri('Canvas/' + v, Object.assign({ maxNativeZoom: 16 }, o));
  const base = {
    claro: L.layerGroup([canvas('World_Light_Gray_Base', { attribution: EA }), canvas('World_Light_Gray_Reference', lblOpt)]),
    calles: L.layerGroup([esri('World_Street_Map', { attribution: EA })]),
    // Ortofoto: Esri de fondo y encima las ortofotos oficiales del Registro Nacional / IGN (SNIT), que tienen más detalle:
    // mosaico 1:5 000 (2014-2017, todo el país), 1:1 000 (2015-2018, ciudades) y la misión 2026 de 10 cm donde ya existe.
    sat: L.layerGroup([esri('World_Imagery', { attribution: SA, maxNativeZoom: 19 }),
      L.tileLayer.wms('https://geos1.snitcr.go.cr/Ortofoto2017/wms', { layers: 'Ortofoto2017:ortofoto2017_5000_altaresolucion', format: 'image/jpeg', version: '1.1.1', minZoom: 15, maxZoom: 21, attribution: 'Ortofotos &copy; Registro Nacional · IGN (SNIT)' }),
      L.tileLayer.wms('https://geos1.snitcr.go.cr/Ortofoto1k/wms', { layers: 'Ortofoto1k:ortofoto2017_1000', format: 'image/png', transparent: true, version: '1.1.1', minZoom: 17, maxZoom: 21 }),
      L.tileLayer.wms('https://geos1.snitcr.go.cr/ANOC_10cm_202601/wms', { layers: 'ortoimagen_10cm_mision_202601', format: 'image/png', transparent: true, version: '1.1.1', minZoom: 17, maxZoom: 21 }),
      esri('Reference/World_Transportation', Object.assign({ opacity: 0.85 }, lblOpt)), esri('Reference/World_Boundaries_and_Places', Object.assign({ attribution: 'Nombres &copy; Esri' }, lblOpt))]),
    topo: L.layerGroup([L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 21, maxNativeZoom: 17, attribution: 'Mapa &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), SRTM, OpenStreetMap' })]),
    relieve: L.layerGroup([esri('World_Topo_Map', { attribution: EA + ', USGS' })]),
    osm: L.layerGroup([L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: osmAttr })]),
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
    const crc = "'₡' + Replace(Text($feature.VALOR, '#,###'), ',', '.') + '/m²'", usd = `'$' + Replace(Text(Round($feature.VALOR / ${tc}, 0), '#,###'), ',', '.') + '/m²'`;
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
  const wms = (url, layers, o) => L.tileLayer.wms(url, Object.assign({ layers, version: '1.1.1', format: 'image/png', transparent: true, maxZoom: 21 }, o));
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
    { g: 'Valor y mercado', id: 'zh', n: 'Zonas homogéneas de Hacienda', note: 'valor del terreno', z: 13, hover: true, lg: [['', '#E9C46A', 'Zona homogénea: valor del terreno en ₡ y $ por m²']], mk: () => ags('https://sig.hacienda.go.cr/server/rest/services/Zonas_Homogeneas_ONT/MapServer', { dyn: ZH_DYN, minZoom: 13, zIndex: 4, attribution: 'Zonas homogéneas &copy; Ministerio de Hacienda (ONT)' }) },
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
  // Mediana de $/m² de remates vigentes por cantón (código de cantón: provincia = primer dígito)
  const medCant = f => PX.medC[Math.floor(f.properties.c / 100) + '|' + f.properties.k];
  function priceClasses() {
    const brks = PX.cur === 'USD' ? [10, 25, 50, 100, 200] : [5000, 12000, 25000, 50000, 100000];
    const cols = ['#FFF3C4', '#F9D57E', '#F0A64A', '#D9733A', '#B04A2E', '#7A2E25'];
    const col = v => cols[brks.findIndex(b => v < b) < 0 ? brks.length : brks.findIndex(b => v < b)];
    const u = PX.cur === 'USD' ? '$' : '₡', f = v => v.toLocaleString('de-DE');
    const o = PX.cur === 'USD' ? 'CRC' : 'USD', ou = o === 'USD' ? '$' : '₡', g = v => Math.round(PX.conv(v, PX.cur, o)).toLocaleString('de-DE');
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
    const L = v => Math.max(0, Math.min(100, Math.log10(Math.max(1, Math.min(1000, v))) / 3 * 100)); // escala log de $1 a $1 000 por m²
    const pos = bu == null ? '' : bu < pc[2] ? 'por debajo del rango' : bu >= pc[3] ? 'por encima del rango' : 'dentro del rango';
    return `<div class="pecrb emph">
      <div class="iphh"><span class="iphn${pc[0] <= 4 ? ' lt' : ''}" style="--c:${PECR_COL[pc[0] - 1]}">${pc[0]}<small>/${PX.PECR_N}</small></span><div><b><span class="pico">${PX.PECR_ICON[pc[0] - 1]}</span>Nivel ${pc[0]} de ${PX.PECR_N}</b><span>${esc(pc[1])}</span></div><button class="linkbtn" data-about="guia" data-gsec="met">¿Qué es?</button></div>
      <div class="pscale">${PX.PECR.map((x, i) => `<span class="${x[0] === pc[0] ? 'me' : ''}" style="--c:${PECR_COL[i]}" title="Nivel ${x[0]}: ${esc(x[1])} (${PX.pecrRango(x)})">${PX.PECR_ICON[i]}<i>${x[0]}</i></span>`).join('')}</div>
      <div class="lv"><span>Rural aislado</span><span>Centralidad urbana</span></div>
      <div class="prange"><div class="pr-t"><i style="left:${L(pc[2])}%;width:${L(pc[3]) - L(pc[2])}%;background:${PECR_COL[pc[0] - 1]}"></i>${bu != null ? `<b class="mk" style="left:${L(bu)}%" title="Base vigente"></b>` : ''}${zu ? `<b class="mk zh" style="left:${L(zu)}%" title="Valor de Hacienda"></b>` : ''}</div>
        <div class="pr-ax">${[1, 10, 100, 1000].map(v => `<span style="left:${L(v)}%">$${v}</span>`).join('')}</div></div>
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
  // Marcadores: de lejos, círculos que agrupan los remates cercanos con su número y un anillo con la proporción
  // de 1.º, 2.º y 3.º remate; al acercarse se separan en puntos individuales del color de su etapa.
  const XC = ['#2B5C8A', '#B7791F', '#B42318'];
  const TERRA = '#D9906E', TERRA_D = '#C8553D';   // terracota del logo: predios en el mapa
  const ZSEP = 13;          // desde este zoom ya no se agrupa
  const RADIO = 54;         // distancia en píxeles para agrupar
  const xIcon = (st, big, fav, exacto) => {
    const c = XC[st] || '#15302A', d = big === 2 ? 26 : big ? 20 : 15;
    const txt = big === 2 ? `<b>${st + 1}</b>` : '';
    return L.divIcon({ className: 'pt', iconSize: [d, d], iconAnchor: [d / 2, d / 2],
      html: `<span class="pd${exacto ? '' : ' aprox'}" style="--c:${c};width:${d}px;height:${d}px">${txt}${fav ? '<i class="pf"></i>' : ''}</span>` });
  };
  const grupoIcon = g => {
    const n = g.items.length, d = Math.round(Math.min(64, 30 + 7.5 * Math.log2(n)));
    const c = [0, 0, 0]; g.items.forEach(r => { if (r.st >= 0 && r.st < 3) c[r.st]++; });
    let a = 0; const seg = c.map((k, i) => { const b = a + k / n * 360; const t = `${XC[i]} ${a}deg ${b}deg`; a = b; return t; }).join(',');
    return L.divIcon({ className: 'pt', iconSize: [d, d], iconAnchor: [d / 2, d / 2],
      html: `<span class="gr" style="width:${d}px;height:${d}px;background:conic-gradient(${seg})"><b style="font-size:${n >= 100 ? 12 : 13.5}px">${n}</b></span>` });
  };
  function agrupar(lista, z) {
    const celdas = new Map(), grupos = [];
    for (const r of lista) {
      const p = map.project([r.ll[1], r.ll[0]], z), cx = Math.floor(p.x / RADIO), cy = Math.floor(p.y / RADIO);
      let g = null;
      for (let dx = -1; dx <= 1 && !g; dx++) for (let dy = -1; dy <= 1 && !g; dy++) {
        for (const h of celdas.get((cx + dx) + ':' + (cy + dy)) || []) if (Math.hypot(h.x - p.x, h.y - p.y) < RADIO) { g = h; break; }
      }
      if (!g) { g = { x: p.x, y: p.y, items: [] }; grupos.push(g); const k = cx + ':' + cy; (celdas.get(k) || celdas.set(k, []).get(k)).push(g); }
      g.items.push(r);
      g.x += (p.x - g.x) / g.items.length; g.y += (p.y - g.y) / g.items.length;   // centro promedio
    }
    return grupos;
  }
  function renderMarkers() {
    markers.clearLayers(); polys.clearLayers();
    const z = map.getZoom();
    const on = (l, r) => { l.on('click', () => openFicha(r.key, true)); l.on('dblclick', e => { L.DomEvent.stop(e); if (open !== r.key) openFicha(r.key, false); irA(r); }); l.on('mouseover', () => { overMarker = true; hb.hidden = true; }); l.on('mouseout', () => { overMarker = false; }); };
    const punto = r => {
      const col = XC[r.st], ll = [r.ll[1], r.ll[0]];
      if (r.exact && r.poly && z >= 15) {   // el predio exacto, en el terracota del logo
        const pg = L.polygon(ringLL(r), { color: TERRA_D, weight: 2, fillColor: TERRA, fillOpacity: 0.32 });
        on(pg, r); pg.bindTooltip(tip(r), { direction: 'top', sticky: true }); polys.addLayer(pg);
        // Cuando el predio ya se distingue en pantalla, se ve solo el polígono (sin el punto)
        const b = pg.getBounds(), a = map.project(b.getNorthWest(), z), c = map.project(b.getSouthEast(), z);
        if (Math.min(Math.abs(c.x - a.x), Math.abs(c.y - a.y)) >= 18) return;
      }
      // Predio todavía pequeño en pantalla: el punto se achica para no taparlo
      const chico = r.exact && r.poly && z >= 16;
      const m = L.marker(ll, { opacity: chico ? 0.9 : 1, icon: chico ? xIcon(r.st, 0, PX.isFav(r.key), true) : xIcon(r.st, z >= 14 ? 2 : z >= 11 ? 1 : 0, PX.isFav(r.key), r.exact), keyboard: false, riseOnHover: true });
      on(m, r); m.bindTooltip(tip(r), { direction: 'top', offset: [0, -10] });
      markers.addLayer(m);
    };
    const conPunto = shown.filter(r => r.ll);
    if (z >= ZSEP) { conPunto.forEach(punto); return; }
    for (const g of agrupar(conPunto, z)) {
      if (g.items.length === 1) { punto(g.items[0]); continue; }
      const c = [0, 0, 0]; g.items.forEach(r => { if (r.st >= 0 && r.st < 3) c[r.st]++; });
      const m = L.marker(map.unproject([g.x, g.y], z), { icon: grupoIcon(g), keyboard: false, riseOnHover: true, zIndexOffset: g.items.length });
      m.bindTooltip(`<b>${g.items.length} remates</b><br>${c.map((k, i) => k ? `${PX.ETAPA[i]}: ${k}` : '').filter(Boolean).join(' · ')}<br><span class="tipm">Haz clic para acercarte</span>`, { direction: 'top', offset: [0, -14] });
      m.on('click', () => {
        const b = L.latLngBounds(g.items.map(r => [r.ll[1], r.ll[0]]));
        if (b.getNorthEast().equals(b.getSouthWest())) map.setView(b.getCenter(), ZSEP);
        else map.fitBounds(b, { padding: [50, 50], maxZoom: ZSEP });
      });
      m.on('mouseover', () => { overMarker = true; hb.hidden = true; }); m.on('mouseout', () => { overMarker = false; });
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
    const has = PX.tieneExp(r.key), q = PX.quedan(), n = PX.nivel();
    const label = has ? 'Abrir expediente' : !PX.conCuenta() ? 'Generar expediente' : q > 0 ? `Generar expediente <span class="badge bg-white text-primary ms-2">${n >= 3 ? 'sin límite' : q === 1 ? 'te queda 1' : 'te quedan ' + q}</span>` : `Expediente adicional · ${PX.mt(PX.PRECIOS.expediente, 'CRC')}`;
    return `<div class="card card-sm border-warning mb-3"><div class="card-status-top bg-warning"></div><div class="card-body">
      <div class="d-flex align-items-center mb-2"><h3 class="card-title mb-0">Expediente del lote</h3><div class="ms-auto">${has ? '<span class="badge bg-green-lt">Disponible</span>' : `<span class="badge bg-${n >= 2 ? 'yellow' : 'green'}-lt">${n >= 3 ? 'Incluido en PRO' : n === 2 ? `Esencial: ${PX.cupoTxt()}` : `Gratis: ${PX.cupoTxt()}`}</span>`}</div></div>
      <ul class="list-unstyled small mb-3">${['Texto del edicto' + (r.isPlano ? ' (si está en remate)' : '') + ', datos registrales y despacho', 'Gravámenes y servidumbres explicados en lenguaje claro', 'Valor de Hacienda, índices y entorno completo del predio', 'Análisis multidimensional y comparables de la zona', 'Versión imprimible con mapa del predio'].map(t => `<li class="d-flex">${TCHK}<span>${t}</span></li>`).join('')}</ul>
      <div class="btn-list"><button class="btn btn-primary" data-act="exp">${label}</button>${!has && n < 3 ? '<button class="btn" data-planes>Ver planes</button>' : ''}</div>
      <div class="text-secondary small mt-2">${n < 3 ? `Cada expediente adicional cuesta ${PX.mt(PX.PRECIOS.expediente, 'CRC')}. ` : ''}No es un certificado de uso de suelo ni una certificación registral: es un compendio de información pública con un análisis orientativo.</div></div></div>`;
  }
  function proBox(r) {
    const rs = PX.pro.riesgos(r), alto = rs.filter(x => x.n === 3).length, med = rs.filter(x => x.n === 2).length, pro = PX.isPro();
    const pot = PX.pro.potCalc(PX.pro.potDefaults(r));
    const rsk = PX.pro.puede('riesgos');
    const b = (k, t, extra = '') => `<button class="btn btn-sm" data-protool="${k}">${t}${extra}<span class="ms-2">${PX.pro.tag(k)}</span></button>`;
    return `<div class="card card-sm mb-3"><div class="card-header"><span class="avatar avatar-sm bg-primary-lt me-2">${PX.ICON.valor}</span><h3 class="card-title">Herramientas</h3></div><div class="card-body">
      <p class="text-secondary">${pro ? `Riesgos detectados: <b>${alto} altos</b> y <b>${med} medios</b>. Potencial aproximado: <b>${fnum(pot.total, 0)} m²</b> construibles.` : rsk ? `Riesgos detectados: <b>${alto} altos</b> y <b>${med} medios</b>. Con PRO, además, potencial constructivo y prefactibilidad.` : 'Riesgos del proceso y alertas vienen en Esencial; potencial constructivo y prefactibilidad, en PRO.'}</p>
      <div class="btn-list">${b('riesgos', 'Riesgos', rsk ? ` <span class="badge bg-${alto ? 'red' : 'secondary'}-lt ms-1">${alto + med}</span>` : '')}${b('alertas', 'Alertas')}${b('potencial', 'Potencial constructivo')}${b('prefa', 'Prefactibilidad')}</div></div></div>`;
  }
  const openPro = (r, t) => PX.pro.open(r, t, $('layer'), { changed: () => { renderList(); if (open) openFicha(open, false); } });
  function listMenu(r) {
    return `<div class="card card-sm mt-2" id="lmenu" hidden><div class="card-body">${PX.acct.listas.map(l => `<label class="form-check"><input class="form-check-input" type="checkbox" data-l="${l.id}"${l.items.some(i => i.k === r.key) ? ' checked' : ''}><span class="form-check-label">${esc(l.n)} <span class="text-secondary">(${l.items.length})</span></span></label>`).join('')}
      <div class="input-group input-group-sm mt-2"><input type="text" class="form-control" id="lnew" placeholder="Nueva lista" aria-label="Nombre de la nueva lista"><button class="btn" id="lnewb">Crear</button></div></div></div>`;
  }
  function actionsHTML(r) {
    const inCmp = cmp.includes(r.key), sg = PX.sigo(r.key);
    return `<div class="btn-list mb-3">
      <button class="btn btn-sm${inCmp ? ' btn-primary' : ''}" data-act="cmp" aria-pressed="${inCmp}">${inCmp ? 'En comparación' : 'Comparar'}</button>
      ${r.isPlano ? '' : `<button class="btn btn-sm${sg ? ' btn-primary' : ''}" data-act="sigo" aria-pressed="${sg}">${sg ? 'Siguiendo' : 'Seguir'}</button>`}
      <button class="btn btn-sm" data-act="lista">Guardar en lista</button>
      ${r.ll ? `<a class="btn btn-sm" href="https://www.google.com/maps/search/?api=1&query=${r.ll[1]},${r.ll[0]}" target="_blank" rel="noopener">Google Maps</a>` : ''}
    </div>${listMenu(r)}`;
  }
  // Forma del predio en pequeño: contorno a escala con norte y barra de escala
  function formaSVG(r, W = 150, H = 118) {
    if (!r.poly || !r.poly[0] || !r.poly[0][0]) return '';
    const ring = r.poly[0][0], lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    const pts = ring.map(([x, y]) => [x * kx, -y * ky]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0, pad = 14, k = Math.min((W - 2 * pad) / (w || 1), (H - 2 * pad - 10) / (h || 1));
    const ox = (W - w * k) / 2, oy = (H - 10 - h * k) / 2;
    const d = 'M' + pts.map(([x, y]) => `${((x - x0) * k + ox).toFixed(1)},${((y - y0) * k + oy).toFixed(1)}`).join('L') + 'Z';
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find(v => v * k >= 26) || 5000, bl = nice * k;
    return `<figure class="forma"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Forma del predio">
      <path d="${d}" fill="${TERRA}" fill-opacity=".55" stroke="${TERRA_D}" stroke-width="1.6" stroke-linejoin="round"/>
      <g transform="translate(${W - 12},14)"><path d="M0 -8 L4 4 L0 1.5 L-4 4 Z" fill="currentColor"/><text y="13" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor">N</text></g>
      <g transform="translate(8,${H - 8})"><path d="M0 0 H${bl.toFixed(1)}" stroke="currentColor" stroke-width="2"/><path d="M0 -3 V3 M${bl.toFixed(1)} -3 V3" stroke="currentColor" stroke-width="1"/><text x="${(bl + 4).toFixed(1)}" y="3" font-size="8.5" fill="currentColor">${nice} m</text></g>
    </svg><figcaption>Forma según el catastro</figcaption></figure>`;
  }
  // Ficha con Tabler: cabecera, precio, tarjetas por sección y datos en «datagrid»
  const fHead = (r, extra) => `<div class="fhead d-flex align-items-center gap-2 px-3 py-2 border-bottom">${PX.tipoIcon(r)}${r.isPlano ? '<span class="badge bg-secondary-lt">Predio consultado</span>' : PX.stageBadge(r.st) + PX.tipoTag(r)}<div class="ms-auto d-flex align-items-center gap-2"><button type="button" class="btn btn-sm" data-act="compartir" title="Compartir este remate" aria-label="Compartir"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M18 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M8.7 10.7l6.6 -3.4"/><path d="M8.7 13.3l6.6 3.4"/></svg><span class="ms-1">Compartir</span></button>${extra || ''}<button type="button" class="btn-close" id="fx" aria-label="Cerrar ficha"></button></div></div>`;
  const fPrecio = (lbl, grande, alt, linea) => `<div class="card card-sm mb-3 bg-body-tertiary"><div class="card-body"><div class="subheader">${lbl}</div><div class="h1 mb-0 mt-1">${grande}</div>${alt ? `<div class="fw-medium text-secondary">${alt}</div>` : ''}${linea ? `<div class="text-secondary small mt-1">${linea}</div>` : ''}</div></div>`;
  const fGrupo = t => `<div class="hr-text hr-text-start my-3">${t}</div>`;
  function aDatagrid(raiz) {   // convierte <dl class="kv"> en el componente datagrid de Tabler
    raiz.querySelectorAll('dl.kv').forEach(dl => {
      const g = document.createElement('div'); g.className = 'datagrid fdatos';
      dl.querySelectorAll('dt').forEach(dt => {
        const dd = dt.nextElementSibling, it = document.createElement('div'); it.className = 'datagrid-item' + (dd && dd.classList.contains('formadd') ? ' forma-item' : '');
        const ic = PX.rowIcon(dt.textContent);
        it.innerHTML = `<div class="datagrid-title">${ic ? `<span class="ri" aria-hidden="true">${ic}</span>` : ''}${dt.innerHTML}</div><div class="datagrid-content"${dd && dd.id ? ` id="${dd.id}"` : ''}>${dd ? dd.innerHTML : ''}</div>`;
        g.appendChild(it);
      });
      dl.replaceWith(g);
    });
  }
  function fichaPrevia(r) {
    const f = $('ficha'), a = PX.prof(r);
    const ven = [[PX.ICON.gavel || '', 'Fechas y bases de los tres remates'], [PX.ICON.terreno || '', 'Área y topografía del lote'], [PX.ICON.norma || '', 'Estado del plan regulador'], [PX.ICON.list || '', 'Listas y seguimiento de remates'], [PX.ICON.alerta || '', `${PX.PRECIOS.semanal} expediente PDF completo gratis por semana`]];
    f.innerHTML = `<div class="tb fichatb" data-bs-theme="${tbTema()}">${fHead(r)}
    <div class="fbody">
      <h2 class="mb-1">${esc(r.nom)}</h2><div class="text-secondary mb-3">${esc(r.lugar || 'Ubicación por definir')}</div>
      ${fPrecio(`Base vigente · ${PX.ETAPA[r.st] || ''} · ${fdate(r.next)}`, PX.money(r.bv, r.mon), PX.other(r.bv, r.mon), a ? fnum(a) + ' m²' : 'área s/d')}
      ${r.poly ? `<div class="formap mb-3">${formaSVG(r)}</div>` : ''}
      <div class="card bg-primary text-white"><div class="card-body">
        <h3 class="card-title text-white">Crea tu cuenta gratis para ver la ficha</h3>
        <div class="text-white-50 small mb-2">Con tu cuenta gratis:</div>
        <ul class="list-unstyled mb-3">${ven.map(([i, t]) => `<li class="d-flex align-items-center gap-2 mb-1"><span class="ri ri-claro" aria-hidden="true">${i}</span>${t}</li>`).join('')}</ul>
        <div class="btn-list"><button class="btn btn-light" data-auth="crear">Crear cuenta gratis</button><button class="btn btn-outline-light" data-auth="entrar">Ya tengo cuenta</button></div>
        <div class="text-white-50 small mt-2">Al registrarte recibes un cupón de 30 % de descuento en la primera mensualidad de cualquier plan.</div>
      </div></div>
    </div></div>`;
    f.hidden = false; $('fx').onclick = closeFicha;
    selLayer.clearLayers();
    if (r.ll) selLayer.addLayer(r.poly ? L.polygon(ringLL(r), { color: TERRA_D, weight: 3, fillColor: TERRA, fillOpacity: 0.45 }) : L.circleMarker([r.ll[1], r.ll[0]], { radius: 14, color: css('--ink'), weight: 2, dashArray: '4 4', fill: false }));
    try { history.replaceState(null, '', '#' + r.key); } catch (err) {}
  }
  // Acercar al remate: máximo zoom (17) si está ubicado exacto; 14 si es aproximado al distrito.
  // En pantallas anchas se corre el punto a la izquierda para que no quede detrás de la ficha.
  const irA = r => {
    const ancho = window.innerWidth > 900;
    if (r.poly && r.exact !== false) {   // con predio: encuadrarlo completo, con contexto alrededor (hasta zoom 19)
      const b = L.polygon(ringLL(r)).getBounds();
      return map.fitBounds(b, { maxZoom: 19, paddingTopLeft: [140, 140], paddingBottomRight: ancho ? [140 + 480, 140] : [140, 140] });
    }
    const z = r.lite ? (r.exact ? 15 : 14) : r.exact || r.isPlano ? 17 : 14, ll = L.latLng(r.ll[1], r.ll[0]);
    const p = map.project(ll, z).add([ancho ? 240 : 0, 0]);
    map.setView(map.unproject(p, z), z);
  };
  function openFicha(key, fly) {
    const r = PX.item(key); if (!r) return;
    open = key;
    if (!PX.conCuenta() && !r.isPlano) { document.querySelectorAll('.item[aria-current]').forEach(e => e.removeAttribute('aria-current')); fichaPrevia(r); if (r.ll && fly !== false) irA(r); return; }
    document.querySelectorAll('.item[aria-current]').forEach(e => e.removeAttribute('aria-current'));
    const li = document.querySelector(`.item[data-k="${key}"]`); if (li) li.setAttribute('aria-current', 'true');
    const f = $('ficha');
    const s = PX.score(r), pro = PX.isPro(), full = pro || PX.tieneExp(r.key), ese = full || PX.isEsencial();
    const a = PX.prof(r), e = r.ent || {};
    const seal = r.isPlano ? `<span class="seal ok">● Predio del catastro</span>` : r.exact ? `<span class="seal ok">● Exacta por ${r.loc}</span>` : `<span class="seal aprox">◌ Aproximada al distrito</span>`;
    let top;
    if (r.isPlano) {
      top = fPrecio('Área según catastro', `${fnum(a)} m²`, '', r.remate ? '<a href="#" data-act="rem">Está en remate: ver ficha</a>' : 'No aparece en los remates vigentes');
    } else {
      const m2 = r.bv && a ? PX.conv(r.bv, r.mon, PX.cur) / a : null;
      top = fPrecio(`Base vigente · ${PX.ETAPA[r.st]} · ${fdate(r.next)}`, PX.money(r.bv, r.mon), PX.other(r.bv, r.mon), `${a ? fnum(a) + ' m²' : 'área s/d'}${r.usdm2 ? ' · ' + PX.duoI(r.usdm2, 'USD', ' por m²') : ''}`);
    }
    const tl = (r.fd || []).map((d, k) => `<div class="list-group-item${k === r.st ? ' active' : ''}${k < r.st ? ' text-secondary' : ''}"><div class="row align-items-center g-2"><div class="col-auto">${PX.stageBadge(k, true)}</div>
        <div class="col"><div class="fw-medium">${PX.ETAPA[k]}${k ? ` · ${PX.PCT[k] * 100} %` : ''}</div><div class="small text-secondary">${fdate(d, true)}</div></div><div class="col-auto text-end${k < r.st ? ' text-decoration-line-through' : ''}">${PX.duo(r.bases[k], r.mon)}</div></div></div>`).join('');
    const attrs = ATTR.filter(x => x[2](r)).map(x => x[1]);
    const nserv = (r.serv || []).length;
    const fav = PX.isFav(r.key);
    // Secciones con candado: Esencial (registro, entorno) y PRO (valor, índices). Con el expediente del lote se ve todo.
    const ESE = PX.ESE;
    const lockSec = (que, icon, t, nivel) => `<div class="card card-sm mb-3 fbloq"><div class="card-header"><span class="avatar avatar-sm bg-secondary-lt me-2">${icon}</span><h3 class="card-title text-secondary">${t}</h3><div class="card-actions">${nivel === 2 ? ESE : PX.PRO}</div></div>
      <div class="card-body"><p class="text-secondary">${que}</p><div class="btn-list"><button class="btn btn-sm btn-primary" data-planes>Ver planes</button>${PX.quedan() > 0 ? '<button class="btn btn-sm" data-act="exp">O abre el expediente de este lote</button>' : ''}</div></div></div>`;
    const PROsec = (que, icon, t, body, right) => full ? sec(icon, t, body, right) : lockSec(que, icon, t, 3);
    const ESEsec = (que, icon, t, body, right) => ese ? sec(icon, t, body, right) : lockSec(que, icon, t, 2);
    const I = PX.ICON, sec = (icon, t, body, right) => `<div class="card card-sm mb-3"><div class="card-header"><span class="avatar avatar-sm bg-primary-lt me-2">${icon}</span><h3 class="card-title">${t}</h3>${right ? `<div class="card-actions">${right}</div>` : ''}</div><div class="card-body">${body}</div></div>`;
    const z = e.zh, topo = PX.topo(r), nv = PX.pro.normativa(r), dm = nv.dims, pc = PX.pecr(r);
    const pecrH = pc ? pecrHTML(r, pc) : '';
    const ubic = r.isPlano ? 'Predio del catastro consultado por plano' : r.exact ? `Ubicada por ${r.loc} en el catastro` : 'Aproximada: el punto marca el centro del distrito declarado, porque el catastro no devolvió el predio';
    f.innerHTML = `<div class="tb fichatb" data-bs-theme="${tbTema()}">${fHead(r, `<button class="btn btn-sm favbtn${fav ? ' btn-primary' : ''}" data-act="fav" aria-pressed="${fav}">${PX.HEART}<span class="ms-1">${fav ? 'En favoritos' : 'Favorito'}</span></button>`)}
    <div class="fbody">
      <h2 class="mb-1">${esc(r.nom)}</h2><div class="text-secondary mb-3">${esc(r.lugar || 'Ubicación por definir')}</div>
      ${top}
      ${actionsHTML(r)}
      ${r.rev ? `<div class="alert alert-warning"><div>${esc(r.rev)}</div></div>` : ''}
      ${fGrupo('Información base')}
      ${r.isPlano ? '' : `<div class="card card-sm mb-3"><div class="card-header"><span class="avatar avatar-sm bg-primary-lt me-2">${PX.ICON.gavel}</span><h3 class="card-title">Remate</h3><div class="card-actions">${PX.whenTag(r.next)}</div></div><div class="list-group list-group-flush ftl">${tl || '<div class="list-group-item text-secondary">Sin fechas legibles en el edicto.</div>'}</div></div>`}
      ${sec(I.terreno, 'Terreno', `<dl class="kv">
        <dt>Área</dt><dd>${r.area ? fnum(r.area) + ' m² en edicto' : ''}${r.area && r.areaCat ? ' · ' : ''}${r.areaCat ? fnum(r.areaCat) + ' m² en catastro' : ''}${!r.area && !r.areaCat ? '—' : ''}</dd>
        ${dm && ese ? `<dt>Dimensiones</dt><dd>≈ ${fnum(dm.corto, 1)} × ${fnum(dm.largo, 1)} m<small class="sub">relación 1:${fnum(dm.rel, 1)}</small></dd>` : ''}
        ${r.poly ? `<dt>Forma del predio</dt><dd class="formadd">${formaSVG(r)}</dd>` : ''}
        <dt>Topografía</dt><dd>${topo ? esc(topo.txt) : 'Sin cartografía 1:5 000 en el sitio'}${topo ? '<small class="sub">Según curvas de nivel del IGN</small>' : ''}</dd>
        ${e.cob || r.isPlano ? `<dt>Uso del suelo</dt><dd id="pcob">${esc(e.cob || r.cob || '…')}</dd>` : ''}
        ${e.zv ? `<dt>Zona de vida</dt><dd>${esc(e.zv)}</dd>` : ''}
      </dl>`)}
      ${sec(I.norma, 'Normativa', `<p class="mb-2"><b>${esc(nv.titulo)}.</b> ${esc(nv.vigente ? 'Confirme zona, usos, cobertura y altura con el certificado de uso de suelo.' : 'Lote mínimo 90 a 120 m², frente mínimo 6 m, fondo hasta 7 veces el frente.')}</p>${nv.alertas.slice(0, 2).map(t => `<div class="alert alert-warning py-2 mb-2"><div>${esc(t)}</div></div>`).join('')}`)}
      ${fGrupo(`${PX.ESE} <span class="ms-2">Con el plan Esencial</span>`)}
      ${ESEsec('Número de finca y plano, servidumbres citadas y origen de la ubicación.', I.registro, 'Registro y ubicación', `<dl class="kv">
        <dt>Finca</dt><dd class="num">${esc(r.fincaTxt)}${r.multi ? ' <span class="tag warn">varias fincas o derechos</span>' : ''}</dd>
        <dt>Plano</dt><dd class="num">${esc(r.plano || (r.planoCat ? PX.planoTxt(r.planoCat) + ' (catastro)' : 'No indicado'))}</dd>
        ${r.isPlano ? '' : `<dt>Servidumbres</dt><dd>${nserv ? `<span class="tag warn">${nserv === 1 ? 'Una citada' : nserv + ' citadas'}</span>` : 'Ninguna citada en el edicto'}</dd>`}
        <dt>Ubicación</dt><dd>${esc(ubic)}</dd>
        ${r.pub ? `<dt>Publicado</dt><dd>${fdate(r.pub)}<small class="sub">Boletín Judicial Nº ${(r.bols || [r.bol]).join(' y ')}</small></dd>` : ''}
      </dl>`)}
      ${ESEsec('Agua potable, vía de acceso, salud, escuela, ríos y distancia a la costa.', I.entorno, 'Servicios y entorno', `<dl class="kv">
        <dt>Agua potable</dt><dd>${e.aguaS ? 'Cobertura de ' + esc(e.aguaS.join(', ')) : 'Sin cobertura registrada'}<small class="sub">AyA, ESPH, ASADAS y acueductos municipales</small></dd>
        ${e.via ? `<dt>Vía más cercana</dt><dd>${e.via.d <= 10 ? esc(e.via.t) + ', al frente' : esc(e.via.t) + ' a ' + PX.dist(e.via.d)}</dd>` : ''}
        ${e.salud ? `<dt>Salud</dt><dd>${esc(e.salud.n)}<small class="sub">${PX.dist(e.salud.d)}</small></dd>` : ''}
        ${e.esc != null ? `<dt>Escuela</dt><dd>A ${PX.dist(e.esc)}</dd>` : ''}
        ${e.agua !== undefined ? `<dt>Ríos</dt><dd>${e.agua == null ? 'Ninguno a menos de 400 m' : 'Cauce a ' + PX.dist(e.agua)}</dd>` : ''}
        ${e.costa != null && e.costa < 2000 ? `<dt>Costa</dt><dd>A ${PX.dist(e.costa)}${e.costa <= 200 ? ' <span class="tag warn">zona marítimo terrestre</span>' : ''}</dd>` : ''}
      </dl>`)}
      ${fGrupo(`${PX.PRO} <span class="ms-2">Con el plan PRO</span>`)}
      ${PROsec('Valor de Hacienda de la zona y en qué porcentaje de ese valor arranca la puja.', I.moneda, PX.iph(r) ? 'Índice Puja/Hacienda' : 'Valor y mercado', `<dl class="kv">
        ${z ? `<dt>Zona homogénea</dt><dd>${esc(z.c)} · ${esc(PX.cap(z.n))}<small class="sub">Hacienda (ONT): ${PX.duoI(z.v, 'CRC', '/m²')} · tipología ${esc(z.u)}</small></dd>` : '<dt>Zona homogénea</dt><dd>Sin dato</dd>'}
      </dl>${iphHTML(r)}`)}
      ${pecrH ? PROsec('Nivel del predio en la escala de valor PECR, de 1 a 10.', I.valor, 'Escala de valor PECR <small class="h3sub">(PlanoExactoCR)</small>', pecrH) : ''}
      ${sec(PX.ICON.valor, 'Índice PlanoExacto', `<div class="idx">${scoreRing(s.total)}<div class="lab"><b>${PX.scoreLabel(s.total)}</b><span>Sanidad jurídica, precio por m², servicios y restricciones</span></div></div>
        <div class="${full ? '' : 'blur'}" aria-hidden="${!full}">${barsHTML(s)}</div>
        ${full ? '' : `<div class="d-flex align-items-center gap-2 mt-2 small">${PX.PRO}<span class="text-secondary">Desglose en el expediente o en PRO</span><a href="#" class="ms-auto" data-planes>Ver planes</a></div>`}`)}
      ${r.isPlano ? '' : sec(PX.ICON.Lote, 'Atributos del lote', `<div class="d-flex flex-wrap gap-1${pro ? '' : ' blur'}">${(pro ? attrs : ['Terreno plano', 'Frente a vía', 'Zona urbana']).map(t => `<span class="badge bg-secondary-lt">${esc(t)}</span>`).join('') || '<span class="badge bg-secondary-lt">Sin atributos destacados</span>'}</div>`, PX.PRO)}
      ${proBox(r)}
      ${fGrupo('Expediente')}
      ${expBox(r)}
      <div class="text-secondary small">Información orientativa de fuentes públicas. No sustituye la certificación del Registro Nacional, el certificado de uso de suelo ni la revisión del expediente judicial. <a href="#" data-about="terms">Términos y descargo</a></div>
    </div></div>`;
    aDatagrid(f);
    f.hidden = false;
    $('fx').onclick = closeFicha;
    if (r.isPlano && !r.cob && !e.cob && r.ll) PX.cobertura(r.ll[0], r.ll[1]).then(v => { r.cob = v; if (r.ent) r.ent.cob = v; PX.savePlano(r); const d = $('pcob'); if (d) d.textContent = v || 'Sin dato del MINAE'; });
    selLayer.clearLayers();
    if (r.ll) {
      const col = r.isPlano ? css('--accent') : XC[r.st];
      if (r.poly) {
        const pg = L.polygon(ringLL(r), { color: TERRA_D, weight: 3, fillColor: TERRA, fillOpacity: 0.45 });
        selLayer.addLayer(pg);
        if (fly !== false) irA(r);
      } else {
        selLayer.addLayer(L.circleMarker([r.ll[1], r.ll[0]], { radius: 14, color: css('--ink'), weight: 2, dashArray: '4 4', fill: false }));
        if (fly !== false) irA(r);
      }
    }
    try { history.replaceState(null, '', '#' + key); } catch (err) {}
    if (tab === 'top') renderHub();
    f.scrollTop = 0; const fb = f.querySelector('.fbody'); if (fb) fb.scrollTop = 0;
  }
  // Compartir: los remates usan su página pública (con vista previa en WhatsApp y redes); los predios, el enlace al mapa
  async function compartir(r) {
    const base = 'https://' + (location.hostname.endsWith('planoexactocr.com') ? 'planoexactocr.com' : location.host);
    const url = r.isPlano ? `${base}/mapa#${r.key}` : `${base}/remate/${r.id}`;
    const title = r.nom || 'Remate en PlanoExactoCR', text = r.isPlano ? `${title} en PlanoExactoCR` : `${title} · ${PX.ETAPA[r.st] || 'Remate'} · base ${PX.mt(PX.conv(r.bv, r.mon, 'CRC'), 'CRC')}`;
    if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado: ya puedes pegarlo donde quieras'); }
    catch (e) { window.prompt('Copia este enlace:', url); }
  }
  function closeFicha() { $('ficha').hidden = true; open = null; if (tab === 'top') renderHub(); selLayer.clearLayers(); document.querySelectorAll('.item[aria-current]').forEach(e => e.removeAttribute('aria-current')); try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (document.querySelector('#layer > *')) closeLayer(); else if (open) closeFicha(); } });
  $('ficha').addEventListener('click', e => {
    if (e.target.closest('a[href="#"]')) e.preventDefault();
    const pt = e.target.closest('[data-protool]'); if (pt && open) { openPro(PX.item(open), pt.dataset.protool); return; }
    const b = e.target.closest('[data-act]'); if (!b || !open) return;
    const r = PX.item(open), act = b.dataset.act;
    if (act === 'compartir') return compartir(r);
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
  // ---------- Ventanas con Tabler (Bootstrap) ----------
  // Componentes de Tabler tal cual (modal, offcanvas, card, form, btn, badge, steps, alert), dentro de un contenedor
  // .tb para no chocar con los estilos del mapa. Solo se personaliza el color de marca.
  const TCHK = '<svg xmlns="http://www.w3.org/2000/svg" class="icon me-1 text-success flex-shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5l10 -10"/></svg>';
  const tbTema = () => dark() ? 'dark' : 'light';
  function ventana({ titulo, cuerpo, pie = '', tam = '', marca = false, estado = '' }) {
    $('layer').innerHTML = `<div class="tb" data-bs-theme="${tbTema()}"><div class="modal modal-blur show d-block" tabindex="-1" role="dialog" aria-modal="true" data-fondo>
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable${tam ? ' modal-' + tam : ''}"><div class="modal-content">
        ${estado ? `<div class="modal-status bg-${estado}"></div>` : ''}
        <div class="modal-header">${marca ? `<span class="me-2 d-inline-flex">${PX.marca('tbmarca', 40, 27)}</span>` : ''}<h5 class="modal-title">${titulo}</h5><button type="button" class="btn-close" data-close aria-label="Cerrar"></button></div>
        <div class="modal-body">${cuerpo}</div>${pie ? `<div class="modal-footer">${pie}</div>` : ''}
      </div></div></div><div class="modal-backdrop fade show"></div></div>`;
    const f = $('layer').querySelector('.modal-body input:not([type=file]), .modal-body select, .modal-footer .btn-primary, .btn-close'); if (f) f.focus();
  }
  const alerta = (id, tipo = 'danger') => `<div class="alert alert-${tipo}" id="${id}" role="alert" hidden></div>`;
  const mostrar = (id, t) => { const e = $(id); if (!e) return; e.textContent = t || ''; e.hidden = !t; };
  const cuponCard = (cp, usado) => `<div class="card card-sm bg-primary-lt mb-3"><div class="card-body"><div class="subheader">Tu cupón de lanzamiento</div><div class="h2 mb-1 font-monospace">${esc(cp)}</div><div class="text-secondary small">${usado ? 'Ya lo usaste en tu primer pago. ¡Gracias!' : `${PX.PRECIOS.cupon} % de descuento en la primera mensualidad de cualquier plan; se aplica solo al pagar.`}</div></div></div>`;

  function goExpediente(r) {
    if (r.isPlano) PX.savePlano(r);
    if (!PX.conCuenta()) return openAuth('crear', 'Crea tu cuenta gratis para generar expedientes.');
    if (PX.registrarExp(r.key, r.nom)) { location.href = 'expediente.html?k=' + encodeURIComponent(r.key); return; }
    const n = PX.nivel(), cr = PX.yo ? PX.yo.creditos || 0 : 0;
    ventana({ titulo: 'Expediente adicional', tam: 'sm',
      cuerpo: `<p>${n === 2 ? `Tu plan Esencial incluye ${PX.PRECIOS.semanalEsencial} expedientes por semana y ya los usaste.` : `Tu cuenta gratis incluye ${PX.PRECIOS.semanal} expediente por semana y ya lo usaste.`}</p>
        <p class="text-secondary mb-0">${cr ? `Tienes <b>${cr}</b> expediente${cr > 1 ? 's' : ''} adicional${cr > 1 ? 'es' : ''} pagado${cr > 1 ? 's' : ''}.` : `Cada expediente adicional cuesta <b>${PX.mt(PX.PRECIOS.expediente, 'CRC')}</b>; con PRO generas todos los que quieras.`}</p>${alerta('crErr')}`,
      pie: `<button class="btn me-auto" data-planes>Ver planes</button>${cr ? '<button class="btn btn-primary" id="usarCr">Usar 1 expediente adicional</button>' : '<button class="btn btn-primary" data-pagar="expedientes">Comprar expedientes</button>'}` });
    const b = $('usarCr');
    if (b) b.onclick = async () => { b.disabled = true; try { await PX.usarCredito(r.key, r.nom); location.href = 'expediente.html?k=' + encodeURIComponent(r.key); } catch (x) { mostrar('crErr', x.message); b.disabled = false; } };
  }
  // ---------- pago por SINPE Móvil ----------
  // El usuario elige plan (o cantidad de expedientes), hace el SINPE y reporta el comprobante; el administrador lo aprueba en /admin.
  const comprimir = f => new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => { const k = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); ok(c.toDataURL('image/jpeg', 0.72)); };
    img.onerror = () => no(new Error('No pudimos leer la imagen. Usa una captura de pantalla (JPG o PNG).'));
    img.src = URL.createObjectURL(f);
  });
  async function openPago(tipo) {
    if (!PX.conCuenta()) return openAuth('crear', 'Crea tu cuenta gratis y luego eliges tu plan.');
    if (!PX.yo) return toast('Para pagar, entra con una cuenta de usuario (no con la sesión de administración).');
    tipo = tipo === 'expedientes' ? 'expedientes' : tipo === 'basico' ? 'basico' : 'pro';
    if (tipo !== 'expedientes' && PX.nivel() > (tipo === 'pro' ? 3 : 2)) return toast('Ya tienes un plan superior activo');
    let periodo = 'mes', cant = 1, form = { ref: '', tel: '' };
    const concepto = () => tipo === 'expedientes' ? 'expedientes' : (tipo === 'basico' ? 'esencial' : 'pro') + '-' + periodo;
    async function pintar() {
      const q = await (await fetch('/api/cuenta/cotizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ concepto: concepto(), cantidad: cant }) })).json().catch(() => ({}));
      const listo = q.sinpe && q.monto;
      const renov = tipo !== 'expedientes' && PX.plan() === tipo && PX.yo.proHasta;
      ventana({ marca: true,
        titulo: tipo === 'expedientes' ? 'Expedientes adicionales' : `${tipo === 'pro' ? PX.PRO : PX.ESE} <span class="ms-2">${renov ? 'Renovar plan' : 'Activar plan'}</span>`,
        cuerpo: `${tipo === 'expedientes' ? `<div class="mb-3"><label class="form-label" for="pgCant">Cantidad</label><select class="form-select" id="pgCant">${[1, 2, 3, 5, 10].map(k => `<option value="${k}"${k === cant ? ' selected' : ''}>${k} expediente${k > 1 ? 's' : ''} · ${PX.mt(k * PX.PRECIOS.expediente, 'CRC')}</option>`).join('')}</select></div>`
            : `<div class="btn-group w-100 mb-3" role="group"><button type="button" class="btn${periodo === 'mes' ? ' btn-primary' : ''}" data-per="mes">Mensual</button><button type="button" class="btn${periodo === 'anual' ? ' btn-primary' : ''}" data-per="anual">Anual · 2 meses gratis</button></div>`}
          <div class="card card-sm mb-3"><div class="card-body"><div class="subheader">Total a pagar</div><div class="h1 mb-0">${PX.mt(q.monto, 'CRC')}</div>
            ${q.descuento ? `<div class="text-success small">Incluye tu cupón ${esc(PX.yo.cupon)}: −${PX.mt(q.descuento, 'CRC')}</div>` : ''}${renov ? `<div class="text-secondary small">Se suma a tu plan actual, vigente hasta el ${fdate(new Date(PX.yo.proHasta + 'T12:00'))}.</div>` : ''}</div></div>
          ${listo ? `<ul class="steps steps-vertical steps-green mb-3">
              <li class="step-item"><div class="fw-medium">Haz un SINPE Móvil</div><div class="text-secondary">por <b>${PX.mt(q.monto, 'CRC')}</b> al <b class="font-monospace">${esc(q.sinpe)}</b>${q.titular ? ` (a nombre de ${esc(q.titular)})` : ''}</div></li>
              <li class="step-item"><div class="fw-medium">Escribe la referencia</div><div class="text-secondary">En la descripción del SINPE: <code>${esc(q.referencia)}</code></div></li>
              <li class="step-item active"><div class="fw-medium">Reporta el pago aquí</div></li></ul>
            <form id="pgF" novalidate>
              <div class="row g-2"><div class="col-sm-6 mb-2"><label class="form-label required" for="pgRef">Número de comprobante</label><input class="form-control" id="pgRef" inputmode="numeric" autocomplete="off" required value="${esc(form.ref)}"></div>
                <div class="col-sm-6 mb-2"><label class="form-label" for="pgTel">Teléfono desde el que pagaste</label><input class="form-control" id="pgTel" inputmode="tel" value="${esc(form.tel)}" placeholder="Opcional"></div></div>
              <div class="mb-2"><label class="form-label" for="pgImg">Captura del comprobante <span class="form-label-description">Recomendado</span></label><input class="form-control" id="pgImg" type="file" accept="image/*"></div>
              ${alerta('pgErr')}
            </form>
            <div class="text-secondary small">Revisamos cada pago a mano: tu plan queda activo en horas hábiles, normalmente el mismo día, y te escribimos a ${esc(PX.yo.correo)}.</div>`
            : `<div class="alert alert-warning mb-0">Estamos terminando de configurar el pago por SINPE Móvil. Escríbenos a hola@planoexactocr.com y te ayudamos.</div>`}`,
        pie: listo ? '<button class="btn me-auto" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="pgF" id="pgBtn">Enviar comprobante</button>' : '<button class="btn" data-close>Cerrar</button>' });
      document.querySelectorAll('[data-per]').forEach(b => b.onclick = () => { periodo = b.dataset.per; guardar(); pintar(); });
      const c = $('pgCant'); if (c) c.onchange = () => { cant = +c.value; guardar(); pintar(); };
      const f = $('pgF'); if (!f) return;
      f.onsubmit = async ev => {
        ev.preventDefault();
        const btn = $('pgBtn'); mostrar('pgErr', '');
        const ref = $('pgRef').value.trim(); if (ref.replace(/\D/g, '').length < 4) return mostrar('pgErr', 'Escribe el número de comprobante que te dio el banco.');
        btn.disabled = true; btn.textContent = 'Enviando…';
        try {
          const file = $('pgImg').files[0], img = file ? await comprimir(file) : null;
          const r = await fetch('/api/cuenta/pagar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ concepto: concepto(), cantidad: cant, ref, telefono: $('pgTel').value.trim(), img }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'No se pudo enviar. Intenta de nuevo.');
          ventana({ titulo: '¡Recibimos tu comprobante!', tam: 'sm', estado: 'success',
            cuerpo: `<p>Vamos a confirmar tu pago de <b>${PX.mt(j.monto, 'CRC')}</b> y ${tipo === 'expedientes' ? 'te acreditamos los expedientes' : 'activamos tu plan'} en horas hábiles, normalmente el mismo día. Te escribiremos a <b>${esc(PX.yo.correo)}</b>.</p><p class="text-secondary mb-0">Puedes ver el estado en Mi cuenta → Pagos.</p>`,
            pie: '<button class="btn btn-primary w-100" data-close>Entendido</button>' });
        } catch (x) { mostrar('pgErr', x.message); btn.disabled = false; btn.textContent = 'Enviar comprobante'; }
      };
    }
    const guardar = () => { const a = $('pgRef'), b = $('pgTel'); if (a) form.ref = a.value; if (b) form.tel = b.value; };
    pintar();
  }
  document.addEventListener('click', e => {
    { const sb = e.target.closest('[data-sub],[data-pagar]'); if (sb) { e.preventDefault(); openPago(sb.dataset.pagar || sb.dataset.sub); return; } }
    const au = e.target.closest('[data-auth]'); if (au) { openAuth(au.dataset.auth); return; }
    if (e.target.closest('[data-close]') || e.target.classList.contains('scrim') || e.target.hasAttribute('data-fondo')) closeLayer();
  });

  // ---------- crear cuenta / entrar ----------
  const PERF = [['comprador', 'Comprador'], ['inversionista', 'Inversionista'], ['abogado', 'Abogado'], ['corredor', 'Corredor'], ['desarrollador', 'Desarrollador'], ['otro', 'Otro']];
  // Ingreso sin contraseña: Google y enlace por correo (si están configurados en el servidor)
  const GLOGO = '<svg viewBox="0 0 48 48" width="18" height="18" class="me-2" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  const utmQ = () => { const q = new URLSearchParams(location.search), u = {}; ['utm_source', 'utm_medium', 'utm_campaign', 'ref'].forEach(k => { if (q.get(k)) u[k] = q.get(k).slice(0, 60); }); return u; };
  function openIngreso(porque) {
    const I = PX.ingreso, vuelta = location.pathname + location.hash, f = Object.values(utmQ()).join('/');
    ventana({ titulo: 'Entra a PlanoExactoCR', tam: 'sm', marca: true,
      cuerpo: `${porque ? `<div class="alert alert-info"><div>${esc(porque)}</div></div>` : ''}
        <p class="text-secondary">Si es tu primera vez, se crea tu cuenta gratis y recibes tu cupón de lanzamiento. Sin contraseñas.</p>
        ${I.google ? `<a class="btn w-100" href="/auth/google?v=${encodeURIComponent(vuelta)}${f ? '&f=' + encodeURIComponent(f) : ''}">${GLOGO}Continuar con Google</a>` : ''}
        ${I.google && I.correo ? '<div class="hr-text">o con tu correo</div>' : ''}
        ${I.correo ? `<form id="mlF" novalidate><div class="mb-3"><label class="form-label" for="mlCorreo">Correo electrónico</label><input class="form-control" id="mlCorreo" type="email" autocomplete="email" required placeholder="nombre@correo.com"></div>
          ${alerta('mlErr')}<button class="btn btn-primary w-100" type="submit" id="mlBtn">Enviarme un enlace para entrar</button></form>` : ''}
        <div class="text-secondary small mt-3">Al continuar aceptas la <a href="/privacidad" target="_blank" rel="noopener">política de privacidad</a>.</div>` });
    const fm = $('mlF'); if (!fm) return;
    fm.onsubmit = async ev => {
      ev.preventDefault();
      const correo = $('mlCorreo').value.trim(), b = $('mlBtn'); mostrar('mlErr', '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) return mostrar('mlErr', 'Revisa el correo: parece incompleto.');
      b.disabled = true; b.textContent = 'Enviando…';
      try {
        const r = await fetch('/api/cuenta/enlace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo, vuelta, utm: utmQ() }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'No se pudo enviar.');
        ventana({ titulo: 'Revisa tu correo', tam: 'sm', estado: 'success',
          cuerpo: `<p>Te enviamos un enlace a <b>${esc(correo)}</b>. Ábrelo desde este mismo dispositivo para entrar; vale 20 minutos.</p><p class="text-secondary mb-0">¿No llega? Revisa la carpeta de spam o promociones, o vuelve a pedirlo en unos minutos.</p>`,
          pie: '<button class="btn btn-primary w-100" data-close>Entendido</button>' });
      } catch (x) { mostrar('mlErr', x.message); b.disabled = false; b.textContent = 'Enviarme un enlace para entrar'; }
    };
  }
  // Ingreso con contraseña: solo mientras no estén configurados Google o el correo
  function openAuth(modo, porque) {
    if (PX.ingreso.google || PX.ingreso.correo) return openIngreso(porque);
    const crear = modo === 'crear', olvido = modo === 'olvide', utm = utmQ();
    ventana({ marca: true, titulo: olvido ? 'Restablecer contraseña' : crear ? 'Crea tu cuenta gratis' : 'Entrar',
      cuerpo: `${porque ? `<div class="alert alert-info"><div>${esc(porque)}</div></div>` : ''}
        ${olvido ? '' : `<div class="btn-group w-100 mb-3" role="group"><button type="button" class="btn${crear ? ' btn-primary' : ''}" data-auth="crear">Crear cuenta</button><button type="button" class="btn${crear ? '' : ' btn-primary'}" data-auth="entrar">Ya tengo cuenta</button></div>`}
        <form id="authF" novalidate>
          <div class="mb-3"><label class="form-label" for="aCorreo">Correo electrónico</label><input class="form-control" id="aCorreo" type="email" autocomplete="email" required></div>
          ${olvido ? '' : `<div class="mb-3"><label class="form-label" for="aClave">Contraseña${crear ? ' <span class="form-label-description">mínimo 8 caracteres</span>' : ''}</label><input class="form-control" id="aClave" type="password" minlength="8" autocomplete="${crear ? 'new-password' : 'current-password'}" required></div>`}
          ${crear ? `<div class="row g-2"><div class="col-sm-6 mb-3"><label class="form-label" for="aNom">Nombre</label><input class="form-control" id="aNom" autocomplete="name" maxlength="80" placeholder="Opcional"></div>
            <div class="col-sm-6 mb-3"><label class="form-label" for="aPerf">Te interesa como</label><select class="form-select" id="aPerf">${PERF.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div></div>
            <div class="mb-3"><label class="form-label" for="aProv">Provincia de interés</label><select class="form-select" id="aProv"><option value="">Todo el país</option>${PX.PROVS.map(p => `<option>${p}</option>`).join('')}</select></div>
            <label class="form-check mb-3"><input class="form-check-input" id="aOk" type="checkbox"><span class="form-check-label">Acepto la <a href="/privacidad" target="_blank" rel="noopener">política de privacidad</a>: PlanoExactoCR guarda mi correo y mis preferencias para mi cuenta y para avisarme novedades.</span></label>` : ''}
          ${alerta('aErr')}
          ${crear || olvido ? '' : '<a href="#" class="small" data-auth="olvide">¿Olvidaste tu contraseña?</a>'}
        </form>`,
      pie: `<button class="btn btn-primary w-100" type="submit" form="authF" id="aBtn">${olvido ? 'Enviar enlace' : crear ? 'Crear cuenta y recibir mi cupón' : 'Entrar'}</button>` });
    const err = t => mostrar('aErr', t);
    $('authF').onsubmit = async ev => {
      ev.preventDefault(); err('');
      const correo = $('aCorreo').value.trim(), btn = $('aBtn');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) return err('Revisa el correo: parece incompleto.');
      let ruta = olvido ? 'olvide' : crear ? 'crear' : 'entrar', body = { correo };
      if (!olvido) { body.clave = $('aClave').value; if (body.clave.length < 8) return err('La contraseña debe tener al menos 8 caracteres.'); }
      if (crear) { if (!$('aOk').checked) return err('Para crear la cuenta, acepta la política de privacidad.'); Object.assign(body, { nombre: $('aNom').value.trim(), perfil: $('aPerf').value, prov: $('aProv').value, acepto: true, utm }); }
      btn.disabled = true;
      try {
        const r = await fetch('/api/cuenta/' + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { btn.disabled = false; return err(j.error || 'No se pudo completar. Intenta de nuevo.'); }
        if (olvido) return ventana({ titulo: 'Restablecer contraseña', tam: 'sm', cuerpo: `<p class="mb-0">${j.enviado ? 'Si existe una cuenta con ese correo, te enviamos un enlace para elegir una contraseña nueva. Revisa también la carpeta de correo no deseado.' : `Escríbenos a <b>${esc(j.contacto)}</b> desde el correo de tu cuenta y te enviamos un enlace para elegir una contraseña nueva.`}</p>`, pie: '<button class="btn btn-primary w-100" data-close>Entendido</button>' });
        sessionStorage.setItem('px-bienvenida', crear ? '1' : '');
        location.reload();
      } catch (x) { btn.disabled = false; err('No hay conexión. Intenta de nuevo.'); }
    };
  }
  // ---------- ventanas ----------
  // Ventana anterior (aún la usan la guía y las herramientas; pasarán a Tabler en la fase de la ficha)
  function modal(html, small) { $('layer').innerHTML = `<div class="scrim"><div class="dlg${small ? ' sm' : ''}" role="dialog" aria-modal="true">${html}</div></div>`; const f = $('layer').querySelector('button, input'); if (f) f.focus(); }
  function closeLayer() { $('layer').innerHTML = ''; }
  function prompt_(title, def) {
    return new Promise(res => {
      ventana({ titulo: esc(title), tam: 'sm', cuerpo: `<form id="pf"><input class="form-control" id="pv" value="${esc(def || '')}" aria-label="${esc(title)}"></form>`,
        pie: '<button class="btn me-auto" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="pf">Guardar</button>' });
      $('pf').onsubmit = ev => { ev.preventDefault(); const v = $('pv').value.trim(); closeLayer(); res(v); };
      $('pv').select();
    });
  }
  function openPlanes(why) {
    const n = PX.nivel();
    const plan = (activo, nombre, precio, alt, items, boton) => `<div class="col-md-4"><div class="card card-md h-100${activo ? ' border-primary' : ''}">
      ${activo ? '<div class="ribbon ribbon-top bg-primary">Tu plan</div>' : ''}
      <div class="card-body d-flex flex-column"><div class="text-uppercase text-secondary fw-medium d-flex align-items-center gap-2">${nombre}</div>
        <div class="display-6 fw-bold my-2">${precio}</div>${alt ? `<div class="text-secondary small mb-2">${alt}</div>` : ''}
        <ul class="list-unstyled lh-lg mb-4">${items.map(t => `<li class="d-flex">${TCHK}<span>${t}</span></li>`).join('')}</ul>
        <div class="mt-auto">${boton}</div></div></div></div>`;
    const compCell = v => typeof v === 'boolean'
      ? `<td class="text-center">${v ? TCHK : '<span class="text-secondary">—</span>'}</td>`
      : `<td class="text-center${v === 'Sin límite' || v === '4' || v === 'Incluido' ? ' fw-bold text-primary' : ''}">${esc(v)}</td>`;
    const compFila = (t, g, e, p) => `<tr><td>${esc(t)}</td>${compCell(g)}${compCell(e)}${compCell(p)}</tr>`;
    const compGrp = t => `<tr class="table-active"><td colspan="4" class="text-uppercase text-secondary fw-bold small">${esc(t)}</td></tr>`;
    const compTabla = `<div class="card mt-3"><div class="card-header"><h3 class="card-title">Qué incluye cada plan</h3></div>
      <div class="table-responsive"><table class="table table-vcenter card-table mb-0">
        <thead><tr><th></th><th class="text-center">Gratis</th><th class="text-center">Esencial</th><th class="text-center">PRO</th></tr></thead>
        <tbody>
          ${compGrp('El mapa')}
          ${compFila('Ver los remates en el mapa', true, true, true)}
          ${compFila('Capas de valor del terreno, agua potable, vías, salud, zonas de vida, curvas de nivel y zona marítimo terrestre', false, false, true)}
          ${compGrp('La ficha de cada propiedad')}
          ${compFila('Fechas, base y área de cada remate', true, true, true)}
          ${compFila('Predio dibujado según el catastro', true, true, true)}
          ${compFila('Número de finca y plano, servidumbres y gravámenes', false, true, true)}
          ${compFila('Agua potable, vía, salud, escuela, ríos y costa', false, true, true)}
          ${compFila('Valor de Hacienda, índice Puja/Hacienda, escala PECR e Índice PlanoExacto', false, false, true)}
          ${compGrp('Herramientas')}
          ${compFila('Riesgos del proceso y alertas de cambios', false, true, true)}
          ${compFila('Valor de referencia y potencial constructivo', false, false, true)}
          ${compFila('Prefactibilidad financiera', false, false, true)}
          ${compFila('Mapa de precios por m² y Top 10 del mes', false, false, true)}
          ${compFila('Filtrar por atributos del lote', false, false, true)}
          ${compGrp('Organizar tu búsqueda')}
          ${compFila('Favoritos, seguimiento y listas', true, true, true)}
          ${compFila('Búsquedas guardadas', true, true, true)}
          ${compFila('Comparar remates a la vez', '2', '2', '4')}
          ${compGrp('Expedientes')}
          ${compFila('Expedientes PDF por semana', String(PX.PRECIOS.semanal), String(PX.PRECIOS.semanalEsencial), 'Sin límite')}
          ${compFila('Expediente adicional, fuera del cupo', `${PX.mt(PX.PRECIOS.expediente, 'CRC')} c/u`, `${PX.mt(PX.PRECIOS.expediente, 'CRC')} c/u`, 'Incluido')}
        </tbody>
      </table></div></div>`;
    ventana({ titulo: 'Planes de PlanoExactoCR', tam: 'xl', marca: true,
      cuerpo: `${why ? `<div class="alert alert-info"><div>${esc(why)}</div></div>` : ''}<div class="row row-cards">
        ${plan(n === 1, 'Cuenta gratis', '₡0', 'Con tu correo o tu cuenta de Google',
          ['Fechas y bases de cada remate, área y estado del plan regulador', 'Predio exacto en el mapa, con su forma según el catastro', 'Listas y seguimiento', `<b>${PX.PRECIOS.semanal} expediente por semana</b>`],
          !PX.conCuenta() ? '<button class="btn btn-primary w-100" data-auth="crear">Crear cuenta gratis</button>' : '')}
        ${plan(n === 2, `${PX.ESE}`, `${PX.mt(PX.PRECIOS.esencial, 'CRC')} <span class="fs-4 fw-normal text-secondary">/ mes</span>`, `o ${PX.mt(PX.PRECIOS.esencialAnual, 'CRC')} al año`,
          ['Todo lo de la cuenta gratis', 'Número de finca y plano, servidumbres y gravámenes citados', 'Agua potable, vía, salud, escuela, ríos y costa', 'Búsquedas guardadas y comparar 2 lotes', `<b>${PX.PRECIOS.semanalEsencial} expedientes por semana</b>`],
          n === 2 ? '<button class="btn w-100" data-pagar="basico">Renovar Esencial</button>' : n < 2 ? '<button class="btn w-100" data-pagar="basico">Activar Esencial</button>' : '')}
        ${plan(n === 3, `${PX.PRO} <span class="text-body">Acceso total</span>`, `${PX.mt(PX.PRECIOS.pro, 'CRC')} <span class="fs-4 fw-normal text-secondary">/ mes</span>`, `o ${PX.mt(PX.PRECIOS.anual, 'CRC')} al año (2 meses gratis)`,
          ['Todo lo de Esencial', 'Valor de Hacienda, índice Puja/Hacienda y escala PECR', 'Todas las capas, mapa de precios y Top 10 por provincia', 'Comparar 4 lotes, potencial constructivo, prefactibilidad, riesgos y alertas', '<b>Expedientes sin límite</b>'],
          n === 3 ? '<button class="btn w-100" data-pagar="pro">Renovar PRO</button>' : '<button class="btn btn-primary w-100" data-pagar="pro">Activar PRO</button>')}
      </div>
      ${compTabla}
      <div class="text-secondary small mt-3">${n < 3 ? `Expediente adicional, fuera de lo que incluye tu plan: <b>${PX.mt(PX.PRECIOS.expediente, 'CRC')}</b> cada uno. ` : ''}Precios en colones con IVA incluido. Pago por SINPE Móvil: reportas el comprobante y activamos el plan en horas hábiles. Tu cupón de lanzamiento descuenta ${PX.PRECIOS.cupon} % de la primera mensualidad. Los expedientes y análisis no son certificados de uso de suelo, certificaciones registrales ni avalúos.</div>` });
  }
  $('bPlanes').onclick = () => openPlanes();
  // ---------- Cómo usar la herramienta (guía de funciones gratis y PRO) ----------
  // ---------- Quiénes somos y descargo de responsabilidad ----------
  // Versión pública (visitantes): corta, sin metodología; la completa llega en assets/guia.js solo con cuenta
  const guiaCorta = () => `<div class="about guide">
      <p class="gintro">PlanoExactoCR te muestra en un mapa las propiedades que salen a remate judicial en Costa Rica y te ayuda a entender cada una antes de ofertar.</p>
      <ol class="gsteps"><li><span><b>Mira el mapa.</b> Cada punto es una propiedad en remate; los círculos con número agrupan varias.</span></li><li><span><b>Filtra</b> por zona, precio, tamaño o tipo.</span></li><li><span><b>Abre la ficha</b> con un clic en el punto o en la lista.</span></li></ol>
      <div class="gtip"><b>Con tu cuenta gratis</b> ves la ficha de cada propiedad, la guía completa de uso y cómo se calcula cada índice. <button class="btn sm primary" data-auth="crear">Crear cuenta gratis</button></div></div>`;
  const usCorto = () => `<div class="about"><p><b>PlanoExactoCR</b> reúne en un solo mapa los remates judiciales de propiedades de Costa Rica y los cruza con información pública para ayudarte a decidir. Lo hace un equipo de profesionales en urbanismo, arquitectura y planificación territorial.</p></div>`;
  const termsCorto = () => `<div class="about"><h3>Términos de uso y descargo</h3><ul>
      <li>La información es un compendio de fuentes públicas con un análisis orientativo: no es asesoría legal ni financiera, ni un avalúo, ni una certificación registral o de uso de suelo.</li>
      <li>Antes de ofertar, verifica todo en el expediente judicial, el Registro Nacional y la municipalidad. PlanoExactoCR no participa en los remates ni garantiza fechas, bases o resultados.</li>
      <li>No asumimos responsabilidad por decisiones tomadas con esta información.</li></ul>
      <p class="muted">Los términos completos están disponibles para quienes tienen cuenta. <a href="privacidad">Política de privacidad</a>.</p></div>`;
  function openAbout(which) {
    const G = window.PX_GUIA;
    const us = G ? G.us() : usCorto(), terms = G ? G.terms() : termsCorto(), guideHTML = G ? G.guia : guiaCorta;
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
  const setVista = p => { if (!PX.admin || p === PX.plan()) return; PX.acct.plan = p; PX.saveAcct(); toast(p === 'pro' ? 'Vista PRO: todas las herramientas activas' : p === 'basico' ? 'Vista Esencial: así la ve un suscriptor del plan Esencial' : 'Vista gratis: así la ve un usuario con cuenta gratis'); };
  $('vFree').onclick = () => setVista('free'); $('vBas').onclick = () => setVista('basico'); $('vPro').onclick = () => setVista('pro');

  // ---------- Mi cuenta ----------
  function renderCuenta() {
    if (!PX.conCuenta()) return openAuth('entrar');
    const a = PX.acct, pro = PX.isPro(), n = PX.nivel(), uso = PX.usoSemana(), cupo = n === 2 ? PX.PRECIOS.semanalEsencial : PX.PRECIOS.semanal, yo = PX.yo;
    const nameOf = k => { const it = PX.item(k); return it ? it.nom : k; };
    const sig = a.sigo.map(k => PX.item(k)).filter(Boolean);
    const snap = a.snap || {};
    // Tarjeta de Tabler con encabezado y lista
    const tarjeta = (titulo, cuerpo, extra = '', id = '') => `<div class="card mb-3"${id ? ` id="${id}"` : ''}><div class="card-header"><h3 class="card-title">${titulo}</h3>${extra ? `<div class="card-actions">${extra}</div>` : ''}</div>${cuerpo}</div>`;
    const vacio = t => `<div class="card-body text-secondary small">${t}</div>`;
    const cuenta = n => `<span class="badge bg-secondary-lt ms-2">${n}</span>`;
    $('layer').innerHTML = `<div class="tb" data-bs-theme="${tbTema()}"><div class="offcanvas offcanvas-end show" tabindex="-1" role="dialog" aria-modal="true" aria-label="Mi cuenta" style="visibility:visible;width:min(460px,100vw)">
      <div class="offcanvas-header"><h2 class="offcanvas-title">Mi cuenta</h2><button type="button" class="btn-close" data-close aria-label="Cerrar"></button></div>
      <div class="offcanvas-body">
        ${yo ? `<div class="card mb-3"><div class="card-body"><div class="d-flex align-items-center"><span class="avatar avatar-md me-3 bg-primary-lt">${esc((yo.nombre || yo.correo).slice(0, 1).toUpperCase())}</span>
            <div class="flex-fill"><div class="fw-medium">${esc(yo.nombre || yo.correo)}</div>${yo.nombre ? `<div class="text-secondary small">${esc(yo.correo)}</div>` : ''}</div>
            <a class="btn btn-sm" href="/__salir">Cerrar sesión</a></div></div></div>
          ${yo.cupon ? cuponCard(yo.cupon, yo.cuponUsado) : ''}`
        : `<div class="alert alert-info"><div>Sesión de administración: con «Ver como» revisas el sitio como usuario gratis, Esencial o PRO. <a href="/admin">Panel</a> · <a href="/__salir">Salir</a></div></div>`}
        ${tarjeta('Plan', `<div class="card-body">
          <div class="d-flex align-items-center mb-2"><div class="flex-fill"><div class="fw-medium">${n >= 2 ? (pro ? PX.PRO : PX.ESE) : 'Cuenta gratis'}</div>
            <div class="text-secondary small">${n >= 2 ? (yo && yo.proHasta ? 'Activo hasta el ' + fdate(new Date(yo.proHasta + 'T12:00')) : 'Activo') : `Esencial ${PX.mt(PX.PRECIOS.esencial, 'CRC')} · PRO ${PX.mt(PX.PRECIOS.pro, 'CRC')} al mes`}</div></div>
            <div class="btn-list">${n >= 2 ? `<button class="btn btn-sm" data-pagar="${pro ? 'pro' : 'basico'}">Renovar</button>` : ''}${pro ? '' : '<button class="btn btn-sm btn-primary" data-planes>Ver planes</button>'}</div></div>
          ${pro ? '<div class="text-secondary small">Expedientes sin límite.</div>' : `<div class="d-flex mb-1 small"><span>Expedientes esta semana</span><span class="ms-auto fw-medium">${uso} de ${cupo}</span></div>
            <div class="progress progress-sm"><div class="progress-bar bg-primary" style="width:${Math.min(100, uso / Math.max(cupo, 1) * 100)}%" role="progressbar" aria-valuenow="${uso}" aria-valuemin="0" aria-valuemax="${cupo}"></div></div>
            <div class="text-secondary small mt-1">Adicional: ${PX.mt(PX.PRECIOS.expediente, 'CRC')} cada uno${yo && yo.creditos ? ` · tienes <b>${yo.creditos}</b> pagado${yo.creditos > 1 ? 's' : ''}` : ''}</div>`}</div>`)}
        ${yo ? tarjeta('Pagos', vacio('Cargando…'), '', 'accPagos') : ''}
        ${tarjeta('Seguimiento' + cuenta(sig.length), sig.length ? `<div class="list-group list-group-flush">${sig.map(r => { const s0 = snap[r.key]; const cambio = s0 && s0.st !== r.st ? (r.st < 0 ? 'Ya pasaron todas las fechas' : `Pasó a ${PX.ETAPA[r.st]}`) : '';
            return `<div class="list-group-item"><div class="row align-items-center"><div class="col text-truncate"><a href="#" class="text-reset d-block fw-medium" data-open="${r.key}">${esc(r.nom)}</a>
              <div class="text-secondary small">${r.st >= 0 ? `${PX.ETAPA[r.st]} · ${fdate(r.next)} · ${when(r.next)}` : 'Sin fechas pendientes'}${cambio ? ` <span class="badge bg-yellow-lt">${cambio}</span>` : ''}</div></div>
              <div class="col-auto text-end small">${r.st >= 0 ? PX.mt(PX.conv(r.bv, r.mon, PX.cur), PX.cur) : ''}<br><a href="#" class="text-secondary" data-unsig="${r.key}">Dejar de seguir</a></div></div></div>`; }).join('')}</div>`
          : vacio('Usa «Seguir» en la ficha de un remate para ver aquí su próxima fecha y los cambios de etapa.'))}
        ${tarjeta('Listas', `<div class="list-group list-group-flush">${a.listas.map(l => `<details class="list-group-item" ${l.items.length ? 'open' : ''}><summary class="fw-medium" style="cursor:pointer">${esc(l.n)} <span class="text-secondary fw-normal">(${l.items.length})</span></summary>
            ${l.items.map(i => `<div class="mt-2"><div class="d-flex"><a href="#" class="text-reset flex-fill" data-open="${i.k}">${esc(nameOf(i.k) || i.n)}</a><a href="#" class="text-secondary small" data-rmi="${l.id}|${i.k}">Quitar</a></div>
              <textarea class="form-control form-control-sm mt-1" rows="2" data-nota="${l.id}|${i.k}" placeholder="Notas: visita, preguntas al juzgado, tope de oferta…">${esc(i.nota || '')}</textarea></div>`).join('') || '<div class="text-secondary small mt-2">Vacía. Agrega lotes con «Guardar en lista».</div>'}
            <div class="btn-list mt-2"><button class="btn btn-sm" data-ren="${l.id}">Renombrar</button>${a.listas.length > 1 ? `<button class="btn btn-sm btn-ghost-danger" data-dell="${l.id}">Eliminar lista</button>` : ''}</div></details>`).join('')}</div>`, '<button class="btn btn-sm" data-newl>Nueva lista</button>')}
        ${tarjeta('Expedientes' + cuenta(a.expedientes.length), a.expedientes.length ? `<div class="list-group list-group-flush">${a.expedientes.map(x => `<a class="list-group-item list-group-item-action" href="expediente.html?k=${encodeURIComponent(x.k)}"><div class="fw-medium">${esc(x.n || nameOf(x.k))}</div><div class="text-secondary small">${x.via === 'pro' ? 'PRO' : x.via === 'esencial' ? 'Esencial' : x.via === 'compra' ? 'Expediente adicional' : 'Cuenta gratis'} · ${fdate(new Date(x.t))}</div></a>`).join('')}</div>` : vacio('Aún no has generado expedientes.'))}
        ${tarjeta('Búsquedas guardadas', a.busquedas.length ? `<div class="list-group list-group-flush">${a.busquedas.map((b, i) => `<div class="list-group-item d-flex align-items-center"><a href="#" class="text-reset flex-fill" data-bus="${i}">${esc(b.n)}<div class="text-secondary small">${fdate(new Date(b.t))}</div></a><a href="#" class="text-secondary small" data-delb="${i}">Eliminar</a></div>`).join('')}</div>` : vacio('Usa «Guardar búsqueda» sobre la lista de remates para volver a una búsqueda.'))}
        ${PX.admin ? tarjeta('Administración', `<div class="list-group list-group-flush"><a class="list-group-item list-group-item-action" href="/admin"><div class="fw-medium">Usuarios, planes y pagos</div><div class="text-secondary small">Cuentas, pagos por SINPE y exportación.</div></a>
          <a class="list-group-item list-group-item-action" href="catastro.html"><div class="fw-medium">Ubicar remates en el catastro</div><div class="text-secondary small">Botón para consultar el SNIT desde Costa Rica.</div></a></div>`) : ''}
      </div></div><div class="offcanvas-backdrop fade show" data-close></div></div>`;
  }
  const CONC = { 'esencial-mes': 'Esencial · 1 mes', 'esencial-anual': 'Esencial · 1 año', 'pro-mes': 'PRO · 1 mes', 'pro-anual': 'PRO · 1 año', expedientes: 'Expedientes adicionales' };
  const EST = { pendiente: ['En revisión', 'yellow'], aprobado: ['Confirmado', 'green'], rechazado: ['No confirmado', 'red'] };
  async function pintarPagos() {
    if (!$('accPagos')) return;
    const j = await (await fetch('/api/cuenta/pagos', { cache: 'no-store' })).json().catch(() => ({ pagos: [] }));
    const L = j.pagos || [], sec = $('accPagos'); if (!sec) return;
    sec.innerHTML = `<div class="card-header"><h3 class="card-title">Pagos</h3></div>${L.length ? `<div class="list-group list-group-flush">${L.map(p => `<div class="list-group-item"><div class="row align-items-center"><div class="col"><div class="fw-medium">${CONC[p.concepto] || p.concepto}${p.concepto === 'expedientes' ? ' · ' + p.cantidad : ''}</div><div class="text-secondary small">${fdate(new Date(p.creado))} · comprobante ${esc(p.ref)}${p.nota ? ' · ' + esc(p.nota) : ''}</div></div>
      <div class="col-auto text-end"><div class="fw-medium">${PX.mt(p.monto, 'CRC')}</div><span class="badge bg-${EST[p.estado][1]}-lt">${EST[p.estado][0]}</span></div></div></div>`).join('')}</div>` : '<div class="card-body text-secondary small">Aún no has hecho pagos. Los planes se pagan por SINPE Móvil desde «Ver planes».</div>'}`;
  }
  $('bCuenta').onclick = () => { renderCuenta(); pintarPagos(); };
  $('layer').addEventListener('click', async e => {
    const d = e.target.closest('[data-open],[data-unsig],[data-rmi],[data-ren],[data-dell],[data-newl],[data-bus],[data-delb]'); if (!d) return; e.preventDefault();
    const a = PX.acct, ds = d.dataset;
    if (ds.open) { closeLayer(); const it = PX.item(ds.open); if (it && it.isPlano) setTab('pla'); openFicha(ds.open, true); return; }
    if (ds.unsig) PX.toggleSigo(ds.unsig);
    if (ds.rmi) { const [l, k] = ds.rmi.split('|'); const L_ = a.listas.find(x => x.id === l); L_.items = L_.items.filter(i => i.k !== k); }
    if (ds.ren) { const L_ = a.listas.find(x => x.id === ds.ren); const n = await prompt_('Nuevo nombre de la lista', L_.n); if (n) L_.n = n; }
    if (ds.dell) a.listas = a.listas.filter(x => x.id !== ds.dell);
    if (ds.newl !== undefined) { const n = await prompt_('Nombre de la lista', 'Para visitar'); if (n) a.listas.push({ id: 'l' + Date.now(), n, items: [] }); }
    if (ds.bus) { closeLayer(); setFilt(a.busquedas[+ds.bus].s); return; }
    if (ds.delb) a.busquedas.splice(+ds.delb, 1);
    PX.saveAcct(); renderCuenta(); pintarPagos(); renderList();
  });
  $('layer').addEventListener('input', e => {
    const n = e.target.dataset.nota; if (!n) return;
    const [l, k] = n.split('|'); const it = PX.acct.listas.find(x => x.id === l).items.find(i => i.k === k);
    it.nota = e.target.value; PX.store.set('px-acct', PX.acct);
  });
  document.addEventListener('px-acct', () => { paintPlan(); renderList(); paintAttrs(); syncLayers(); if (!$('lyrPanel').hidden) renderLyrPanel(); if (!PX.isPro()) { attrOn.clear(); } if (open) openFicha(open, false); if (tab === 'cmp') renderCmp(); if (tab === 'top') renderTop(); $('cmpN').textContent = cmp.length; });

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
    $('proHub').innerHTML = `<div class="procard"><h3>Herramientas</h3>
        <p>${pro ? 'Tu plan PRO está activo: todas las herramientas completas.' : 'Cada herramienta indica su plan: ' + PX.ESE + ' o ' + PX.PRO + '. Sin ese plan la abres como vista previa.'}</p>
        <p>${r ? `Lote abierto: <b>${esc(r.nom)}</b>` : 'Abre un lote en el mapa o busca un plano para usar las herramientas de lote.'}</p>
        <div class="acts"><button class="btn sm" data-about="guia">Cómo usar las herramientas</button></div></div>
      ${PX.pro.TOOLS.map(t => `<div class="procard${t.st === 'soon' ? ' soon' : ''}"><h3>${PX.pro.tag(t.k)} ${t.n} ${t.st === 'soon' ? '<span class="tag">Próximamente</span>' : ''}</h3><p>${t.q}</p>
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
        <div class="acts"><button class="btn primary" data-pagar="pro">Activar PRO</button><button class="btn" data-planes>Ver planes</button></div></div>
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
  function paintTheme() { const d = dark(), b = $('bTheme'); if (!b) return; b.innerHTML = `<span class="ic" aria-hidden="true">${d ? PX.ICON.sol : PX.ICON.luna}</span>`; b.title = d ? 'Cambiar a colores claros' : 'Cambiar a colores oscuros'; b.setAttribute('aria-label', b.title); document.querySelector('meta[name=theme-color]').content = d ? '#0C1110' : '#FCFBF8'; }
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
  // Enlaces desde la página de inicio: /mapa?crear=1, /mapa?entrar=1
  const qs = new URLSearchParams(location.search);
  if (!PX.conCuenta() && (qs.has('crear') || qs.has('entrar'))) openAuth(qs.has('crear') ? 'crear' : 'entrar');
  let bienv = null; try { bienv = sessionStorage.getItem('px-bienvenida'); sessionStorage.removeItem('px-bienvenida'); } catch (e) {}
  if (qs.has('bienvenida')) { bienv = '1'; try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {} }
  if (bienv === '1' && PX.yo) ventana({ titulo: '¡Bienvenido a PlanoExactoCR!', marca: true, estado: 'success',
    cuerpo: `<p>Tu cuenta está lista. Ya puedes ver la información base de cada remate, guardar listas, seguir remates y generar ${PX.PRECIOS.semanal} expediente PDF completo por semana.</p>
      ${PX.yo.cupon ? cuponCard(PX.yo.cupon, PX.yo.cuponUsado) : ''}
      <form id="bvF"><div class="row g-2"><div class="col-sm-6"><label class="form-label" for="bvPerf">Te interesa como <span class="form-label-description">Opcional</span></label><select class="form-select" id="bvPerf">${PERF.map(([v, t]) => `<option value="${v}"${PX.yo.perfil === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="col-sm-6"><label class="form-label" for="bvProv">Provincia de interés</label><select class="form-select" id="bvProv"><option value="">Todo el país</option>${PX.PROVS.map(p => `<option${PX.yo.prov === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div></div></form>`,
    pie: '<button class="btn me-auto" type="button" data-about="guia">Cómo usar</button><button class="btn btn-primary" type="submit" form="bvF">Ir al mapa</button>' });
  const bvF = $('bvF');
  if (bvF) bvF.onsubmit = ev => { ev.preventDefault(); fetch('/api/cuenta/perfil', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: PX.yo.nombre || '', perfil: $('bvPerf').value, prov: $('bvProv').value }) }).catch(() => {}); closeLayer(); };
})();
