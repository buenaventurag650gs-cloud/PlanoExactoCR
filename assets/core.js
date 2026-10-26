/* PlanoExactoCR — lógica común: datos, formato, puntajes y cuenta (demo en este navegador). */
(function (W) {
  'use strict';
  const PX = W.PX = {};
  PX.PCT = [1, 0.75, 0.25];
  PX.ETAPA = ['1.er remate', '2.º remate', '3.er remate'];
  PX.SC = ['--s1', '--s2', '--s3'];
  PX.PROVS = ['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'];
  PX.PRECIOS = { expediente: 20, suscripcion: 200, cupo: 200 };
  const MES = PX.MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  const MESL = PX.MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  PX.now = new Date();

  // ---------- utilidades ----------
  PX.$ = id => document.getElementById(id);
  PX.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  PX.css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  PX.norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  PX.cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  PX.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  PX.get = u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
  PX.fdate = (d, withTime) => d ? `${DIA[d.getDay()]} ${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}` + (withTime ? ` · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '') : '—';
  PX.fnum = (v, dec) => v == null || isNaN(v) ? '—' : v.toLocaleString('es-CR', { maximumFractionDigits: dec != null ? dec : v < 100 ? 2 : 0 });
  PX.days = d => d ? Math.ceil((d - PX.now) / 864e5) : null;
  PX.dist = m => m == null ? '—' : m < 1000 ? Math.round(m / 5) * 5 + ' m' : (m / 1000).toLocaleString('es-CR', { maximumFractionDigits: 1 }) + ' km';
  PX.when = d => { const n = PX.days(d); return n == null ? '' : n <= 0 ? 'hoy' : n === 1 ? 'mañana' : 'en ' + n + ' días'; };

  // ---------- moneda: la unidad va separada del valor ----------
  PX.cur = PX.store.get('px-cur', 'CRC') === 'USD' ? 'USD' : 'CRC';
  PX.tc = { venta: 456.32, compra: 450.04, fecha: '' };
  PX.setCur = c => { PX.cur = c; PX.store.set('px-cur', c); };
  PX.conv = (v, from, to) => v == null ? null : from === to ? v : from === 'CRC' ? v / PX.tc.venta : v * PX.tc.venta;
  PX.usd = (v, from) => PX.conv(v, from, 'USD');
  function parts(v, c, compact) {
    if (v == null || isNaN(v)) return { u: c === 'USD' ? 'US$' : '₡', n: '—', s: '' };
    const u = c === 'USD' ? 'US$' : '₡';
    const f = (x, d) => x.toLocaleString('es-CR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
    if (false) { // siempre cifras completas, sin «mil» ni «M»
      if (v >= 1e9) return { u, n: f(v / 1e9, 2), s: 'mil M' };
      if (v >= 1e6) return { u, n: f(v / 1e6, v >= 1e8 ? 0 : 1), s: 'M' };
      if (v >= 1e4) return { u, n: f(v / 1e3, 0), s: 'mil' };
    }
    return { u, n: f(v, c === 'USD' && Math.abs(v) < 1000 ? 2 : 0), s: '' };
  }
  // HTML con la unidad en su propio elemento
  PX.mh = (v, c, compact) => { const p = parts(v, c, compact); return `<span class="money"><span class="u">${p.u}</span><span class="num">${p.n}</span>${p.s ? `<span class="sx">${p.s}</span>` : ''}</span>`; };
  PX.mt = (v, c, compact) => { const p = parts(v, c, compact); return `${p.u} ${p.n}${p.s ? ' ' + p.s : ''}`; };
  PX.money = (v, from, compact) => PX.mh(PX.conv(v, from, PX.cur), PX.cur, compact);
  PX.moneyT = (v, from, compact) => PX.mt(PX.conv(v, from, PX.cur), PX.cur, compact);
  PX.other = (v, from) => { const o = PX.cur === 'CRC' ? 'USD' : 'CRC'; return PX.mh(PX.conv(v, from, o), o); };
  PX.otherT = (v, from) => { const o = PX.cur === 'CRC' ? 'USD' : 'CRC'; return PX.mt(PX.conv(v, from, o), o); };
  // Toda cifra va con su equivalente en la otra moneda
  PX.duo = (v, from, suf) => v == null ? '—' : `<span class="duo">${PX.money(v, from)}${suf || ''}<span class="eq">${PX.other(v, from)}${suf || ''}</span></span>`;
  PX.duoI = (v, from, suf) => v == null ? '—' : `${PX.money(v, from)}${suf || ''} <span class="eqi">· ${PX.other(v, from)}${suf || ''}</span>`;
  PX.duoT = (v, from, suf) => v == null ? '—' : `${PX.moneyT(v, from)}${suf || ''} (${PX.otherT(v, from)}${suf || ''})`;
  PX.usdH = v => PX.mh(v, 'USD');

  // ---------- datos ----------
  PX.prText = p => {
    if (!p) return 'Sin dato del INVU';
    if (p.si) return `Plan regulador vigente${p.anno ? ' desde ' + p.anno : ''}${p.escala === 'Parcial' ? ', cubre parte del cantón' : ''}`;
    return /elaboraci/.test(p.cat) ? 'Sin plan regulador vigente; en elaboración' : 'Sin plan regulador vigente';
  };
  PX.prof = r => r.area || r.areaCat || null;
  PX.prepare = function (R) {
    for (const r of R) {
      r.key = 'r' + r.id;
      r.fd = (r.f || []).map(s => new Date(s));
      const i = r.fd.findIndex(d => d >= PX.now);
      r.st = i; r.next = i >= 0 ? r.fd[i] : null;
      r.bases = (r.f || []).map((_, k) => r.base * PX.PCT[k]);
      r.bv = i >= 0 ? r.base * PX.PCT[i] : null;
      r.exact = r.loc === 'plano' || r.loc === 'finca';
      r.tg = r.tg || [];
      r.fincaTxt = (r.prov ? r.prov + '-' : '') + (r.finca || '') + (r.filial ? '-F' : '') + (r.der ? '-' + r.der : '');
      r.nom = r.nom || r.tipo;
      r.lugar = [r.dn, r.cn, r.pn].filter(Boolean).join(', ');
      r.search = PX.norm([r.nom, r.bar, r.plano, r.planoCat, r.fincaTxt, String(r.finca), r.exp, r.dn, r.cn, r.pn, r.nat, r.juz].join(' '));
      r.searchDigits = [r.plano, r.fincaTxt, r.exp, r.planoCat].join(' ').replace(/\D/g, '');
      r.pub = r.pubF ? new Date(r.pubF + 'T12:00') : null;
      r.usdm2 = r.bv && PX.prof(r) ? PX.usd(r.bv, r.mon) / PX.prof(r) : null;
      const ip = r.st >= 0 && PX.tc ? PX.iph(r) : null; r.iphV = ip ? ip.v : null;
    }
    // medianas de US$/m² por cantón y provincia (remates vigentes con área)
    const med = a => { if (!a.length) return null; a = a.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
    const byC = {}, byP = {};
    for (const r of R) if (r.st >= 0 && r.usdm2) { (byC[r.prov + '|' + r.cn] = byC[r.prov + '|' + r.cn] || []).push(r.usdm2); (byP[r.prov] = byP[r.prov] || []).push(r.usdm2); }
    PX.medC = {}; PX.medP = {};
    for (const k in byC) if (byC[k].length >= 3) PX.medC[k] = { v: med(byC[k]), n: byC[k].length };
    for (const k in byP) PX.medP[k] = { v: med(byP[k]), n: byP[k].length };
    PX.R = R; PX.byKey = {}; for (const r of R) PX.byKey[r.key] = r;
    return R;
  };
  PX.medFor = r => PX.medC[r.prov + '|' + r.cn] ? Object.assign({ ref: 'cantón ' + r.cn }, PX.medC[r.prov + '|' + r.cn]) : PX.medP[r.prov] ? Object.assign({ ref: 'provincia de ' + PX.PROVS[r.prov - 1] }, PX.medP[r.prov]) : null;

  // Quita las frases de "libre de …" para no confundirlas con cargas reales
  PX.limpiarGrav = t => PX.norm(t).replace(/libres? de (gravamenes|anotaciones|hipotecas)( hipotecarios)?((,| y| e) (gravamenes|anotaciones|hipotecas))*/g, ' ');

  // ---------- Íconos (trazo simple, color por CSS) ----------
  const ic = (d, vb) => `<svg viewBox="${vb || '0 0 24 24'}" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  PX.ICON = {
    'Lote': ic('<path d="M4 7l8-4 8 4-8 4z"/><path d="M4 7v9l8 4 8-4V7"/><path d="M12 11v9"/>'),
    'Con construcción': ic('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
    'Agrícola': ic('<path d="M12 21V11"/><path d="M12 11c0-4 3-7 8-7 0 5-3 8-8 7z"/><path d="M12 14c0-3-2.5-5.5-7-5.5 0 4 2.5 6 7 5.5z"/><path d="M5 21h14"/>'),
    'Filial': ic('<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>'),
    'Predio': ic('<path d="M4 6l7-2 9 3-2 13-12-2z"/><circle cx="12" cy="11" r="1.6"/>'),
    cal: ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    list: ic('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    reset: ic('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
    pin: ic('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    agua: ic('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
    valor: ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    terreno: ic('<path d="M3 18l5-7 4 5 3-3 6 5z"/><circle cx="17" cy="7" r="2"/>'),
    norma: ic('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'),
    registro: ic('<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h4"/>'),
    entorno: ic('<circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/>'),
    gavel: ic('<path d="M14 4l6 6M11 7l6 6M12.5 5.5l-6 6M9 15l-5 5"/>'),
    // Íconos de interfaz y de filas de la ficha
    info: ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'),
    book: ic('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 7h6"/>'),
    tag: ic('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
    user: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
    eye: ic('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    star: ic('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
    via: ic('<path d="M7 21L10 3M17 21L14 3M12 6v2M12 11v2M12 16v2"/>'),
    salud: ic('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>'),
    escuela: ic('<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>'),
    rio: ic('<path d="M2 8c3-2 5 2 8 0s5-2 8 0 2 0 4-1M2 13c3-2 5 2 8 0s5-2 8 0 2 0 4-1M2 18c3-2 5 2 8 0s5-2 8 0 2 0 4-1"/>'),
    costa: ic('<path d="M3 18c2 0 3-1 4.5-1S10 18 12 18s3-1 4.5-1 2.5 1 4.5 1"/><path d="M6 14l4-8 3 5 2-2 3 5"/>'),
    hoja: ic('<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l8-8"/>'),
    capas: ic('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
    monte: ic('<path d="M2 20l7-12 4 6 3-4 6 10z"/>'),
    regla: ic('<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
    plano: ic('<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>'),
    reloj: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    moneda: ic('<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.6-3-1.5M12 6v2M12 16v2"/>'),
    juzgado: ic('<path d="M3 21h18M4 10h16M12 3l9 5H3z"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/>'),
    alerta: ic('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>')
  };
  // Ícono para cada fila de la ficha según su etiqueta
  PX.rowIcon = t => {
    const n = PX.norm(t), I = PX.ICON;
    const m = [[/zona homog|valor de ref|base|precio|puja/, I.moneda], [/area|superficie/, I.regla], [/dimension/, I.regla], [/topograf|pendiente|elevac/, I.monte], [/uso del suelo|cobertura/, I.capas], [/zona de vida/, I.hoja],
      [/agua/, I.agua], [/via|camino|calle/, I.via], [/salud|ebais|hospital/, I.salud], [/escuela|colegio/, I.escuela], [/rio|quebrada|cuenca/, I.rio], [/costa|zmt|playa/, I.costa],
      [/plan regulador|normativa|zona/, I.norma], [/finca/, I.registro], [/plano/, I.plano], [/ubicac|distrito|lugar/, I.pin], [/naturaleza/, I.Lote], [/expediente|juzgado|despacho|proceso/, I.juzgado],
      [/publicac|boletin|fecha/, I.cal], [/gravamen|servidumbre|anotac/, I.alerta]];
    const h = m.find(([re]) => re.test(n)); return h ? h[1] : '';
  };
  PX.tipoIcon = r => `<span class="ti${r.tipo === 'Agrícola' ? ' agro' : ''}" title="${r.tipo}">${PX.ICON[r.tipo] || PX.ICON.Lote}</span>`;
  // Insignia de etapa del remate (1.º, 2.º, 3.º): martillo + número, usada en lista, ficha, mapa y expediente
  PX.stageBadge = (st, small) => st < 0 ? '' : `<span class="stb s${st + 1}${small ? ' sm' : ''}" title="${PX.ETAPA[st]} · base al ${PX.PCT[st] * 100} %"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M9.2 1.6l5.2 5.2-1.6 1.6L7.6 3.2z M6.8 4l5.2 5.2-1.2 1.2L5.6 5.2z M7.4 7.4L1.8 13l1.2 1.2 5.6-5.6" fill="currentColor"/></svg>${st + 1}.º<i>${PX.PCT[st] * 100} %</i></span>`;
  PX.whenTag = d => { const n = PX.days(d); if (n == null) return ''; const t = PX.when(d); return `<span class="when${n <= 0 ? ' hoy' : n === 1 ? ' manana' : n <= 7 ? ' pronto' : ''}">${t.charAt(0).toUpperCase() + t.slice(1)}</span>`; };

  // ---------- Topografía a partir de las curvas de nivel (IGN 1:5 000) ----------
  PX.topo = r => {
    const e = r.ent || {};
    if (e.pend == null && !e.suave) return null;
    const p = e.pend != null ? e.pend : 3;
    const c = p < 5 ? ['Plana', 'pendiente menor al 5 %'] : p < 15 ? ['Ondulada', 'pendiente entre 5 y 15 %'] : p < 30 ? ['Quebrada', 'pendiente entre 15 y 30 %'] : ['Muy quebrada', 'pendiente mayor al 30 %'];
    return { clase: c[0], txt: `${c[0]}: ${e.pend != null ? 'pendiente aproximada de ' + e.pend + ' %' : c[1]}${e.elev != null ? ', a unos ' + PX.fnum(Math.round(e.elev)) + ' m s. n. m.' : ''}` };
  };

  // ---------- Escala PECR de valor por accesibilidad y dotación ----------
  PX.PECR = [
    [1, 'Rural aislado, acceso difícil, sin servicios disponibles', 1, 5],
    [2, 'Rural, acceso limitado por camino de lastre o servidumbre', 3, 10],
    [3, 'Acceso razonable, frente a camino público, sin servicios confirmados', 8, 20],
    [4, 'Acceso consolidado, electricidad disponible, agua no confirmada', 12, 30],
    [5, 'Acceso consolidado y disponibilidad de agua potable y electricidad', 20, 50],
    [6, 'Entorno rural residencial, lote aprovechable y servicios disponibles', 35, 85],
    [7, 'Periurbano, proximidad a centros poblados y equipamientos', 50, 150],
    [8, 'Suelo urbano consolidado, infraestructura y potencial edificatorio', 80, 500]
  ];
  // Nivel PECR: reglas de acceso y dotación, calibradas con el valor de la zona homogénea de Hacienda (60 % valor, 40 % reglas)
  PX.pecrCalc = r => {
    const e = r.ent || {}, z = e.zh || {}, tg = r.tg || [];
    const urb = e.cob === 'Zona urbana' || tg.includes('urbano'), frente = tg.includes('frente') || (e.via && e.via.d <= 10), agua = !!(e.aguaS && e.aguaS.length);
    const sal = (e.salud || {}).d || 99999, esc = e.esc || 99999, vt = PX.norm((e.via || {}).t), vd = (e.via || {}).d || 9999;
    const serv = (r.serv || []).some(x => /paso/i.test(x));
    const a = z.k === 'U' && urb && frente && agua ? 8 : (z.k === 'U' || urb) && (sal <= 3000 || esc <= 1000) ? 7 : agua && frente && (r.area || PX.prof(r) || 0) <= 5000 ? 6 : agua && frente ? 5 : frente && sal <= 6000 ? 4 : frente ? 3 : (serv || /vereda|lastre/.test(vt) || vd <= 200) ? 2 : 1;
    if (!z.v) return a;
    const usd = z.v / PX.tc.venta;
    const b = PX.PECR.reduce((m, x) => Math.abs(Math.log(usd / Math.sqrt(x[2] * x[3]))) < Math.abs(Math.log(usd / Math.sqrt(m[2] * m[3]))) ? x : m)[0];
    return Math.max(1, Math.min(8, Math.round(0.4 * a + 0.6 * b)));
  };
  PX.pecr = r => r.pecr ? PX.PECR[r.pecr - 1] : null;

  // ---------- Valor de referencia: zona homogénea de Hacienda + construcción por tipología (ONT) ----------
  // Manual de valores base unitarios por tipología constructiva, ONT, valores a marzo de 2023 (Alcance 187, La Gaceta 178, 28/09/2023).
  PX.TIPOLOGIAS = [
    ['VC01', 'Concreto, económica (42–90 m²)', 260000, 50], ['VC02', 'Concreto, económica normal (80–110 m²)', 320000, 55],
    ['VC03', 'Concreto, calidad media (100–150 m²)', 365000, 65], ['VC04', 'Concreto, calidad buena (140–220 m²)', 425000, 70],
    ['VC05', 'Concreto, diseño especial (210–250 m²)', 485000, 90], ['VC06', 'Concreto, muy buena (240–300 m²)', 545000, 105],
    ['VC07', 'Concreto, acabados de alto nivel (290–350 m²)', 700000, 120], ['VC08', 'Concreto, lujosa (340–400 m²)', 920000, 120],
    ['VC09', 'Concreto, lujosa importada (390 m² o más)', 1495000, 120], ['VM01', 'Madera, acabados sencillos (36–90 m²)', 290000, 80],
    ['VS01', 'Muro seco, una planta (100–150 m²)', 310000, 40], ['VS02', 'Muro seco, calidad buena (140–350 m²)', 500000, 60],
    ['VE01', 'Modular en acero (24–90 m²)', 550000, 60], ['VP01', 'PVC espumado (45 m² o más)', 370000, 90]
  ];
  PX.ESTADOS = [['Óptimo', 1], ['Muy bueno', 0.97], ['Bueno', 0.9], ['Intermedio', 0.8], ['Regular', 0.68], ['Malo', 0.5]];
  PX.valorRef = v => {
    // v: { area, zh (₡/m²), ac (m² construidos), tip (código), edad (años), est (factor) }
    const t = PX.TIPOLOGIAS.find(x => x[0] === v.tip) || PX.TIPOLOGIAS[1];
    const terreno = (v.area || 0) * (v.zh || 0);
    const vrn = (v.ac || 0) * t[2];
    const x = Math.min(1, (v.edad || 0) / t[3]);
    const fd = 1 - 0.5 * (x + x * x);           // Ross
    const vnr = vrn * fd * (v.est || 1);          // Heidecke (estado de conservación)
    return { terreno, vrn, fd, vnr, total: terreno + vnr, tip: t };
  };

  // Supuestos por defecto del valor de referencia (los usa la ficha, el expediente y la herramienta PRO)
  PX.valDefaults = r => {
    const e = r.ent || {}, z = e.zh || {}, constr = r.tipo === 'Con construcción' || (r.tg || []).includes('constr');
    const tip = PX.TIPOLOGIAS.some(t => t[0] === z.u) ? z.u : 'VC02';
    return { area: Math.round(PX.prof(r) || 0), zh: z.v || 0, ac: constr ? Math.min(120, Math.round((PX.prof(r) || 200) * 0.45)) : 0, tip, edad: 20, est: 0.8 };
  };

  // ---------- Índice Puja/Hacienda (IPH) ----------
  // IPH = base vigente de la puja ÷ valor según Hacienda × 100.
  // Valor según Hacienda = área × valor de la zona homogénea (ONT) + construcción estimada por tipología ONT, depreciada.
  // 100 = la puja arranca en el valor de Hacienda; 50 = a la mitad; 200 = al doble.
  PX.IPH = [
    [30, 'Muy por debajo de Hacienda', '#1E7A4C', 'La puja arranca en menos de un tercio del valor de Hacienda.'],
    [60, 'Por debajo de Hacienda', '#5E9E4A', 'La puja arranca entre un tercio y dos tercios del valor de Hacienda.'],
    [100, 'Cerca del valor de Hacienda', '#C9A227', 'La puja arranca un poco por debajo del valor de Hacienda.'],
    [200, 'Por encima de Hacienda', '#D9822B', 'La puja arranca por encima del valor de Hacienda, hasta el doble.'],
    [Infinity, 'Muy por encima de Hacienda', '#B42318', 'La puja arranca en más del doble del valor de Hacienda.']
  ];
  PX.iphBand = v => PX.IPH.find(b => v < b[0]);
  PX.iph = r => {
    const z = (r.ent || {}).zh;
    if (!z || !z.v || !r.base || !(PX.prof(r) > 0)) return null;
    const ref = PX.valorRef(PX.valDefaults(r)), hac = ref.total;
    if (!hac) return null;
    const crc = v => PX.conv(v, r.mon, 'CRC');
    const etapas = PX.PCT.map(p => crc(r.base * p) / hac * 100);
    const base = r.bv != null ? crc(r.bv) : crc(r.base);
    const v = base / hac * 100;
    const aviso = r.der && r.der !== '000' ? `La finca está en derechos (derecho ${r.der}): si se remata solo una parte, el índice puede verse más bajo de lo real.`
      : r.multi ? 'El remate incluye varias fincas: el índice usa solo el área de una.'
      : v < 10 ? 'Índice muy bajo: revise el área y la naturaleza en el edicto antes de sacar conclusiones.' : '';
    return { v, base, hac, terreno: ref.terreno, constr: ref.vnr, etapas, band: PX.iphBand(v), aviso };
  };
  // Medidor del IPH en escala logarítmica de 10 a 400
  PX.iphBar = (v, small) => {
    const pos = x => Math.max(0, Math.min(100, (Math.log10(Math.max(10, Math.min(400, x))) - 1) / Math.log10(40) * 100));
    let prev = 10;
    const segs = PX.IPH.map(b => { const a = pos(prev), z = pos(Math.min(b[0], 400)); prev = b[0]; return `<i style="left:${a}%;width:${z - a}%;background:${b[2]}"></i>`; }).join('');
    return `<div class="iphbar${small ? ' sm' : ''}">${segs}<b style="left:${pos(v)}%"></b></div>${small ? '' : `<div class="iphax">${[10, 30, 60, 100, 200, 400].map(x => `<span style="left:${pos(x)}%">${x === 400 ? '400+' : x}</span>`).join('')}</div>`}`;
  };

  // ---------- análisis multidimensional ----------
  // Cada dimensión va de 0 a 100 (más alto = mejor para quien compra) y trae sus razones.
  PX.DIMS = [
    { k: 'juridica', n: 'Sanidad jurídica', d: 'Servidumbres, gravámenes, derechos y certeza de ubicación' },
    { k: 'precio', n: 'Precio por m²', d: 'Base vigente frente a la mediana de remates de la zona' },
    { k: 'servicios', n: 'Potencial por servicios', d: 'Plan regulador, acceso, salud, escuela y entorno urbano' },
    { k: 'restricciones', n: 'Pocas restricciones', d: 'Ríos, pendiente, costa, bosque y protección' }
  ];
  PX.W0 = { juridica: 35, precio: 25, servicios: 25, restricciones: 15 };
  const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
  PX.score = function (r, W) {
    W = W || PX.W0;
    const out = {}, why = {};
    // Sanidad jurídica
    let j = 100; const wj = [];
    const sub = (p, t) => { j -= p; wj.push([-p, t]); };
    const serv = r.serv || [];
    if (serv.length) sub(Math.min(36, 12 * serv.length), serv.length === 1 ? 'Soporta una servidumbre' : `Soporta ${serv.length} servidumbres`);
    const g = PX.limpiarGrav(r.grav);
    if (/hipotec/.test(g) && !/libre de gravamenes hipotecarios|libre de hipotecas/.test(g)) sub(15, 'Hipoteca citada en el edicto');
    if (/anotaci/.test(g)) sub(10, 'Tiene anotaciones');
    if (/usufruct/.test(g)) sub(15, 'Usufructo citado');
    if (/embargo/.test(g)) sub(5, 'Embargo inscrito');
    if (r.der && r.der !== '000' && r.der !== '0') sub(15, `Se remata el derecho ${r.der}, no la finca completa`);
    if (r.multi) sub(8, 'El edicto incluye varias fincas o derechos');
    if (r.filial) sub(5, 'Filial de condominio: reglamento y cuotas');
    if (r.isPlano) { /* plano consultado: sin edicto */ }
    else if (!r.exact) sub(15, 'Ubicación aproximada: el catastro no confirmó el predio');
    if (r.rev) sub(15, 'El catastro devolvió un predio que no coincide con el edicto');
    if (r.area && r.areaCat && Math.abs(r.areaCat - r.area) / r.area > 0.1) sub(10, `Área del catastro difiere ${Math.round((r.areaCat - r.area) / r.area * 100)} % del edicto`);
    if (!wj.length) wj.push([0, r.isPlano ? 'Sin edicto: solo se revisa la ubicación catastral' : 'Sin servidumbres ni gravámenes relevantes citados']);
    out.juridica = r.isPlano ? null : clamp(j); why.juridica = wj;
    // Precio por m²
    const med = r.isPlano ? null : PX.medFor(r);
    if (r.usdm2 && med) {
      const ratio = r.usdm2 / med.v;
      out.precio = clamp(50 - 50 * Math.log2(ratio));
      why.precio = [[0, `${PX.duoT(r.usdm2, 'USD', '/m²')} frente a una mediana de ${PX.duoT(med.v, 'USD', '/m²')} en ${med.ref}`], [0, ratio < 1 ? `${Math.round((1 - ratio) * 100)} % por debajo de la mediana` : `${Math.round((ratio - 1) * 100)} % por encima de la mediana`]];
    } else { out.precio = null; why.precio = [[0, r.isPlano ? 'Sin precio: no está en remate' : 'Sin área o sin base vigente']]; }
    // Potencial por servicios
    const e = r.ent || {}; let s = 0; const ws = [];
    const add = (p, t) => { s += p; ws.push([p, t]); };
    if (e.pr && e.pr.si) add(20, 'Cantón con plan regulador vigente');
    if (r.tg.includes('frente') || (e.via && e.via.d <= 10)) add(25, 'Frente a vía');
    if (e.salud) { const d = e.salud.d; d <= 1000 ? add(20, `Centro de salud a ${PX.dist(d)}`) : d <= 3000 ? add(12, `Centro de salud a ${PX.dist(d)}`) : d <= 6000 ? add(5, `Centro de salud a ${PX.dist(d)}`) : ws.push([0, `Centro de salud a ${PX.dist(d)}`]); }
    if (e.esc != null) { e.esc <= 1000 ? add(15, `Escuela a ${PX.dist(e.esc)}`) : e.esc <= 2000 ? add(8, `Escuela a ${PX.dist(e.esc)}`) : ws.push([0, `Escuela a ${PX.dist(e.esc)}`]); }
    if (e.cob === 'Zona urbana' || r.tg.includes('urbano')) add(20, 'Zona urbana según cobertura 2020');
    out.servicios = clamp(s); why.servicios = ws.length ? ws : [[0, 'Sin datos de servicios cercanos']];
    // Restricciones (100 = ninguna detectada)
    let x = 100; const wx = [];
    const res = (p, t) => { x -= p; wx.push([-p, t]); };
    const hasGeo = r.exact || r.isPlano;
    if (!hasGeo) { x = 60; wx.push([0, 'Sin polígono exacto: valor neutro']); }
    else {
      if (e.agua != null) { e.agua <= 15 ? res(45, `Cauce a ${PX.dist(e.agua)}: dentro de la franja de protección`) : e.agua <= 50 ? res(25, `Cauce a ${PX.dist(e.agua)}: posible franja de protección`) : e.agua <= 100 ? res(10, `Cauce a ${PX.dist(e.agua)}`) : null; }
      if (e.pend != null) { e.pend >= 30 ? res(30, `Pendiente fuerte (≈ ${e.pend} %)`) : e.pend >= 15 ? res(15, `Pendiente moderada (≈ ${e.pend} %)`) : null; }
      if (e.costa != null && e.costa <= 250) res(30, `A ${PX.dist(e.costa)} de la costa: posible zona marítimo terrestre`);
      if (e.cob === 'Cobertura forestal') res(20, 'Cobertura forestal: cambio de uso restringido');
      if (e.prot) res(25, 'Toca una franja de protección de cauces');
      if (e.psa) res(15, 'Toca un área con contrato de PSA');
      if (!wx.length) wx.push([0, e.agua === undefined && e.pend == null ? 'Sin restricciones en los datos disponibles (cartografía 1:5 000 parcial)' : 'Sin restricciones detectadas']);
    }
    out.restricciones = clamp(x); why.restricciones = wx;
    // total ponderado con las dimensiones disponibles
    let sw = 0, sv = 0;
    for (const d of PX.DIMS) if (out[d.k] != null && W[d.k] > 0) { sw += W[d.k]; sv += W[d.k] * out[d.k]; }
    out.total = sw ? Math.round(sv / sw) : null;
    out.why = why;
    return out;
  };
  PX.scoreLabel = v => v == null ? 'Sin dato' : v >= 75 ? 'Muy favorable' : v >= 60 ? 'Favorable' : v >= 45 ? 'Intermedio' : v >= 30 ? 'Con reparos' : 'Desfavorable';

  // ---------- cuenta del usuario (modo demostración, en este navegador) ----------
  const A0 = { plan: 'pro', comprados: [], usados: {}, expedientes: [], listas: [{ id: 'l1', n: 'Mis favoritos', items: [] }], sigo: [], busquedas: [], notas: {} };
  PX.acct = Object.assign({}, A0, PX.store.get('px-acct', {}));
  if (!PX.store.get('px-v3')) { PX.acct.plan = 'pro'; PX.store.set('px-v3', 1); PX.store.set('px-acct', PX.acct); } // etapa de prueba: PRO activo
  PX.saveAcct = () => { PX.store.set('px-acct', PX.acct); document.dispatchEvent(new CustomEvent('px-acct')); };
  PX.isPro = () => PX.acct.plan === 'pro';
  PX.mesKey = () => PX.now.getFullYear() + '-' + String(PX.now.getMonth() + 1).padStart(2, '0');
  PX.usoMes = () => PX.acct.usados[PX.mesKey()] || 0;
  PX.tieneExp = key => PX.acct.comprados.includes(key) || PX.acct.expedientes.some(x => x.k === key && x.m === PX.mesKey() && x.via === 'pro');
  PX.puedeGenerar = key => PX.tieneExp(key) || (PX.isPro() && PX.usoMes() < PX.PRECIOS.cupo);
  // Registra la generación: con suscripción descuenta del cupo mensual la primera vez en el mes.
  PX.registrarExp = (key, label) => {
    const a = PX.acct;
    if (!PX.tieneExp(key)) {
      if (!(PX.isPro() && PX.usoMes() < PX.PRECIOS.cupo)) return false;
      a.usados[PX.mesKey()] = PX.usoMes() + 1;
      a.expedientes.unshift({ k: key, n: label, t: Date.now(), m: PX.mesKey(), via: 'pro' });
    } else if (!a.expedientes.some(x => x.k === key)) a.expedientes.unshift({ k: key, n: label, t: Date.now(), m: PX.mesKey(), via: 'compra' });
    PX.saveAcct(); return true;
  };
  PX.comprar = (key, label) => { if (!PX.acct.comprados.includes(key)) PX.acct.comprados.push(key); PX.saveAcct(); PX.registrarExp(key, label); };
  PX.toggleSigo = key => { const s = PX.acct.sigo; const i = s.indexOf(key); i >= 0 ? s.splice(i, 1) : s.unshift(key); PX.saveAcct(); return i < 0; };
  PX.sigo = key => PX.acct.sigo.includes(key);
  // Favoritos = la primera lista de Mi cuenta («Mis favoritos»)
  PX.favList = () => { let l = PX.acct.listas.find(x => x.id === 'l1'); if (!l) { l = { id: 'l1', n: 'Mis favoritos', items: [] }; PX.acct.listas.unshift(l); } return l; };
  PX.isFav = key => PX.favList().items.some(i => i.k === key);
  PX.toggleFav = (key, name) => { const l = PX.favList(), on = !PX.isFav(key); if (on) l.items.unshift({ k: key, n: name, t: Date.now(), nota: '' }); else l.items = l.items.filter(i => i.k !== key); PX.saveAcct(); return on; };
  PX.HEART = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>';

  // Planos consultados (para comparar, listas y expediente)
  PX.planos = PX.store.get('px-planos', {});
  PX.savePlano = o => { PX.planos[o.key] = o; const ks = Object.keys(PX.planos); if (ks.length > 40) delete PX.planos[ks[0]]; PX.store.set('px-planos', PX.planos); };
  PX.item = key => key && key[0] === 'r' ? (PX.byKey || {})[key] : PX.planos[key] ? PX.hydratePlano(PX.planos[key]) : null;
  PX.hydratePlano = o => { o.isPlano = true; o.tg = o.tg || []; return o; };

  // ---------- geometría ----------
  PX.CRTM05 = '+proj=tmerc +lat_0=0 +lon_0=-84 +k=0.9999 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs';
  function inRing(x, y, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  PX.inGeom = (x, y, g) => {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.some(p => inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));
  };
  PX.featAt = (fc, x, y) => fc && fc.features.find(f => PX.inGeom(x, y, f.geometry));
  PX.haversine = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  // Centroide simple del anillo exterior más grande
  PX.centroid = polys => {
    let best = null, ba = -1;
    for (const p of polys) { const r = p[0]; let a = 0, cx = 0, cy = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; } if (Math.abs(a) > ba) { ba = Math.abs(a); best = a ? [cx / (3 * a), cy / (3 * a)] : r[0]; } }
    return best;
  };

  // Número de plano: acepta P-1311611-2008, 6-1311611-2008, SJ-123456-2010 o 613116112008
  const LET = { SJ: 1, A: 2, C: 3, H: 4, G: 5, P: 6, L: 7 };
  PX.parsePlano = (txt, provSel) => {
    const t = String(txt || '').toUpperCase().replace(/\s+/g, '');
    let m = t.match(/^(SJ|A|C|H|G|P|L|[1-7])-?0*(\d{1,7})-?(\d{4})$/);
    if (m) { const p = LET[m[1]] || +m[1]; return { code: p + m[2].padStart(7, '0') + m[3], prov: p, txt: `${Object.keys(LET)[p - 1]}-${m[2].padStart(7, '0')}-${m[3]}` }; }
    m = t.match(/^(\d)(\d{7})(\d{4})$/);
    if (m && +m[1] >= 1 && +m[1] <= 7) return { code: t, prov: +m[1], txt: `${Object.keys(LET)[+m[1] - 1]}-${m[2]}-${m[3]}` };
    m = t.match(/^0*(\d{1,7})-?(\d{4})$/);
    if (m && provSel) return { code: provSel + m[1].padStart(7, '0') + m[2], prov: +provSel, txt: `${Object.keys(LET)[provSel - 1]}-${m[1].padStart(7, '0')}-${m[2]}` };
    return null;
  };
  PX.planoTxt = code => code && code.length === 12 ? `${Object.keys(LET)[+code[0] - 1] || code[0]}-${code.slice(1, 8)}-${code.slice(8)}` : code;

  // Consulta de un plano o finca en el catastro, a través del puente /api del sitio.
  // Devuelve objetos con la misma forma que un remate (sin precio) para reutilizar ficha, comparador y expediente.
  PX.ctx = {};
  PX.loadCtx = async () => {
    if (PX.ctx.ready) return PX.ctx;
    const [dist, planes, salud] = await Promise.all([PX.get('data/distritos.geojson'), PX.get('data/planes_reguladores.geojson').catch(() => null), PX.get('data/salud.json').catch(() => [])]);
    Object.assign(PX.ctx, { dist, planes, salud, ready: true });
    return PX.ctx;
  };
  PX.consultar = async (tipo, valor, prov) => {
    const url = tipo === 'plano' ? `api/plano?v=${encodeURIComponent(valor)}` : `api/finca?v=${encodeURIComponent(valor)}&p=${encodeURIComponent(prov || '')}`;
    const res = await fetch(url, { cache: 'no-cache' });
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j) throw new Error((j && j.error) || 'El servicio de búsqueda no está disponible en este momento.');
    if (!j.result || !j.data) return [];
    await PX.loadCtx();
    const tr = W.proj4 ? W.proj4(PX.CRTM05, 'WGS84') : null;
    if (!tr) throw new Error('No se cargó la librería de proyecciones.');
    const out = [];
    for (const z of ['zona_1', 'zona_2']) {
      const fc = j.data[z]; if (!fc || !fc.features) continue;
      for (const f of fc.features) {
        if (!f.geometry) continue;
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        const ll = polys.map(p => p.map(ring => ring.map(c => tr.forward([c[0], c[1]]).map(v => Math.round(v * 1e6) / 1e6))));
        out.push(PX.armarPlano(f.properties || {}, ll));
      }
    }
    return out;
  };
  PX.armarPlano = (p, poly) => {
    const c = PX.centroid(poly.map(x => [x[0]])) || poly[0][0][0];
    const ctx = PX.ctx;
    const d = PX.featAt(ctx.dist, c[0], c[1]);
    const prf = PX.featAt(ctx.planes, c[0], c[1]);
    let sal = null;
    for (const s of ctx.salud || []) { const dd = PX.haversine(c, s.ll); if (!sal || dd < sal.d) sal = { n: s.n, c: s.c, d: Math.round(dd) }; }
    const code = String(p.plano || '');
    const prov = +p.provincia || (d ? +String(d.properties.c)[0] : null);
    const o = {
      key: 'p' + (code || (p.provincia + '-' + p.finca)), isPlano: true, plano: code ? PX.planoTxt(code) : null, planoCat: code,
      prov, finca: p.finca ? String(+p.finca) : null, der: null, area: null, areaCat: p.area ? Math.round(p.area * 100) / 100 : null,
      horizontal: p.horizontal === '1', poly, ll: [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6],
      dn: d ? d.properties.d : null, cn: d ? d.properties.k : null, pn: prov ? PX.PROVS[prov - 1] : null, dc: d ? d.properties.c : null,
      ent: { pr: prf ? prf.properties : null, salud: sal }, tg: [], tipo: p.horizontal === '1' ? 'Filial' : 'Predio', exact: true, loc: 'plano'
    };
    o.fincaTxt = (o.prov ? o.prov + '-' : '') + (o.finca || '—');
    o.lugar = [o.dn, o.cn, o.pn].filter(Boolean).join(', ');
    o.nom = `Plano ${o.plano || o.fincaTxt}${o.dn ? ' · ' + o.dn : ''}`;
    // ¿Está en remate?
    const hit = (PX.R || []).find(r => (code && r.planoCat === code) || (o.finca && r.prov === o.prov && String(r.finca) === o.finca && r.exact));
    if (hit) o.remate = hit.key;
    return o;
  };
  // Zona homogénea de Hacienda en un punto (servicio ArcGIS público, permite consultas desde el navegador)
  PX.zhQuery = async (lon, lat) => {
    try {
      const p = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'VALOR,COD_ZONAH,NOMBRE_ZONAH,TIPO_DE_USO,CATEGORIZADA', returnGeometry: 'false', f: 'json' });
      const j = await (await fetch('https://sig.hacienda.go.cr/server/rest/services/Zonas_Homogeneas_ONT/MapServer/0/query?' + p)).json();
      const t = j.features && j.features[0] && j.features[0].attributes; if (!t) return null;
      return { v: t.VALOR, c: t.COD_ZONAH, n: t.NOMBRE_ZONAH, u: t.TIPO_DE_USO, k: t.CATEGORIZADA };
    } catch (e) { return null; }
  };
  PX.zhAt = async (lon, lat) => { const z = await PX.zhQuery(lon, lat); return z ? `${z.c} · ${PX.cap(z.n)} · ${PX.duoT(z.v, 'CRC', '/m²')} · ${z.u}` : null; };
  // Cobertura de agua potable (AyA, ESPH, ASADAS, municipal)
  PX.aguaQuery = async (lon, lat) => {
    try {
      const L = ['AyA', 'ESPH', 'ASADA', 'Municipal'];
      const p = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', sr: '4326', layers: 'all:0,1,2,3', tolerance: '0', mapExtent: `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`, imageDisplay: '400,400,96', returnGeometry: 'false', f: 'json' });
      const j = await (await fetch('https://gis.aya.go.cr/server/rest/services/Web/Coberturas_AyA_ASADAS_Muni/MapServer/identify?' + p)).json();
      const r = (j.results || []).map(f => L[f.layerId] || f.layerName);
      return [...new Set(r)];
    } catch (e) { return null; }
  };
  PX.aguaAt = async (lon, lat) => { const a = await PX.aguaQuery(lon, lat); return a == null ? null : a.length ? 'Cobertura de ' + a.join(', ') : 'Fuera de las áreas de cobertura registradas'; };
  PX.cobertura = async (lon, lat) => {
    try { const r = await fetch(`api/cobertura?lon=${lon}&lat=${lat}`); if (!r.ok) return null; const j = await r.json(); return j.cat || null; } catch (e) { return null; }
  };

  // ---------- glosario jurídico (para el expediente) ----------
  PX.GLOSARIO = [
    [/servidumbre de paso|servidumbre trasladada|servidumbre de acceso/, 'Servidumbre de paso', 'Otra finca tiene derecho a pasar por este terreno, o este terreno pasa por otra. Limita cercar o construir sobre la franja.'],
    [/servidumbre de (aguas|acueducto|desague|alcantarillado|tuberia)/, 'Servidumbre de aguas o tubería', 'Una franja queda reservada para conducir agua o aguas residuales. Normalmente no se puede construir encima.'],
    [/servidumbre (electrica|de electroducto|de linea)|electroducto|ice|cnfl/, 'Servidumbre eléctrica', 'Paso de líneas eléctricas. Restringe construir bajo el tendido y exige retiros.'],
    [/servidumbre/, 'Servidumbre (otra)', 'Un derecho a favor de otra finca o institución que limita el uso de una parte del terreno.'],
    [/reservas? de ley de aguas/, 'Reservas de la Ley de Aguas', 'Reserva general de ley sobre el uso del agua y las franjas de cauces. Es común y no impide la compra.'],
    [/reservas? de ley de caminos/, 'Reservas de la Ley de Caminos', 'Reserva general sobre el derecho de vía de caminos públicos. Es común; revise retiros frente a la vía.'],
    [/hipotec/, 'Hipoteca', 'Garantía sobre la finca a favor de un acreedor. En remate, las hipotecas de grado inferior al que se ejecuta suelen cancelarse, pero debe verificarse en el expediente.'],
    [/anotaci/, 'Anotación', 'Aviso registral de un proceso o trámite pendiente (por ejemplo una demanda) que puede afectar al nuevo dueño.'],
    [/embargo/, 'Embargo', 'Bloqueo judicial de la finca para garantizar una deuda. El juzgado ordena su cancelación al aprobar el remate, según el caso.'],
    [/usufruct/, 'Usufructo', 'Otra persona tiene derecho a usar y aprovechar la finca. Puede impedir ocuparla aunque se compre.'],
    [/condiciones/, 'Condiciones', 'Restricciones inscritas al formar la finca (por ejemplo de un proyecto o de una institución). Conviene leerlas en el Registro.'],
    [/plazo de convalidacion|convalidaci/, 'Plazo de convalidación', 'Limitación temporal ligada a la inscripción por información posesoria o titulación. Puede limitar traspasos.'],
    [/afectacion a? ?patrimonio familiar|patrimonio familiar/, 'Patrimonio familiar', 'Protección de la vivienda familiar. Puede limitar el remate o exigir requisitos adicionales.'],
    [/arrendamiento/, 'Arrendamiento', 'Contrato de alquiler inscrito. El inquilino podría mantener derechos.'],
    [/demanda/, 'Demanda inscrita', 'Hay un proceso judicial anotado sobre la finca.']
  ];
  PX.explicar = (texto, serv) => {
    const t = PX.limpiarGrav([texto].concat(serv || []).join(' '));
    const out = [], seen = new Set();
    for (const [re, n, d] of PX.GLOSARIO) if (re.test(t) && !seen.has(n)) {
      if (n === 'Servidumbre (otra)' && [...seen].some(s => /Servidumbre/.test(s))) continue;
      seen.add(n); out.push({ n, d });
    }
    return out;
  };

  PX.DISCLAIMER = 'Este documento <b>no es un certificado de uso de suelo</b>, ni una certificación registral o catastral, ni un avalúo, ni un estudio de título. Es un <b>compendio de información pública</b> (Boletín Judicial, Registro Inmobiliario, IGN, INVU, MINAE, CCSS) y un <b>análisis multidimensional orientativo</b> generado de forma automática. Antes de ofertar, verifique en el expediente judicial, el Registro Nacional y la municipalidad.';
})(window);
