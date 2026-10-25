/* PlanoExactoCR — expediente de un lote: lámina cartográfica + ficha sintética + edicto. Se imprime en carta horizontal. */
(async function () {
  'use strict';
  const { $, esc, fdate, fnum } = PX;
  const doc = $('doc');
  const key = new URLSearchParams(location.search).get('k') || '';
  let R, META;
  try { [R, META] = await Promise.all([PX.get('data/remates.json'), PX.get('data/meta.json')]); }
  catch (e) { doc.innerHTML = '<p class="err">No se pudieron cargar los datos. Recarga la página.</p>'; return; }
  PX.tc = META.tc; PX.prepare(R);
  const r = PX.item(key);
  if (!r) { doc.innerHTML = '<div class="wall"><h1>No encontramos ese lote</h1><p>El enlace puede ser de un remate que ya no está vigente o de un plano consultado en otro navegador.</p><div class="acts"><a class="btn primary" href="index.html">Volver al mapa</a></div></div>'; return; }
  $('back').href = 'index.html#' + r.key;

  // Acceso: comprado, o incluido en la suscripción (descuenta del cupo la primera vez en el mes)
  if (!PX.tieneExp(r.key) && !PX.registrarExp(r.key, r.nom)) {
    doc.innerHTML = `<div class="wall"><span class="lbl">Expediente del lote</span><h1>${esc(r.nom)}</h1><p class="muted">${esc(r.lugar)}</p>
      <p>Este expediente reúne en una lámina el mapa del predio con sus variables, el índice PlanoExacto, las potencialidades y los riesgos, más el edicto, los datos registrales y los gravámenes explicados.</p>
      <div class="acts"><button class="btn primary" id="buy">Comprar por ${PX.duoT(PX.PRECIOS.expediente, 'USD')}</button><button class="btn" id="sub">Suscripción PRO: ${PX.mt(PX.PRECIOS.suscripcion, 'USD')} al mes, ${PX.PRECIOS.cupo} expedientes</button></div>
      <div class="demo">Modo demostración: el pago aún no está conectado. Al confirmar se activa el acceso en este navegador.</div>
      <div class="legal">${PX.DISCLAIMER}</div></div>`;
    $('print').hidden = true;
    $('buy').onclick = () => { PX.comprar(r.key, r.nom); location.reload(); };
    $('sub').onclick = () => { PX.acct.plan = 'pro'; PX.saveAcct(); location.reload(); };
    return;
  }
  if (r.isPlano && r.ent && r.ent.cob === undefined && r.ll) { r.ent.cob = await PX.cobertura(r.ll[0], r.ll[1]); PX.savePlano(r); }

  const folio = `PX-${r.key.toUpperCase()}-${PX.now.getFullYear()}${String(PX.now.getMonth() + 1).padStart(2, '0')}${String(PX.now.getDate()).padStart(2, '0')}`;
  const titleCase = s => String(s || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());

  // Encabezado y pie comunes a cada hoja
  const head = (t) => `<header class="ph"><div class="lbrand"><span class="mark"><img src="assets/img/logo-mark.webp" alt="" width="40" height="28"></span><span class="wm"><span class="w1">PLANO</span><span class="w2">EXACTO</span><span class="w3">CR</span></span></div>
      <div class="pt"><b>${esc(r.nom)}</b><span>${t}</span></div><div class="pm"><b class="num">${folio}</b><span>${fdate(new Date())}</span></div></header>`;
  const foot = n => `<footer class="pf">Compendio de información pública y análisis orientativo: no es certificado de uso de suelo, certificación registral o catastral, avalúo ni estudio de título. Verifique en el expediente judicial, el Registro Nacional y la municipalidad.<span class="num">${n}</span></footer>`;

  function render() {
    const s = PX.score(r), e = r.ent || {}, a = PX.prof(r);
    const pots = PX.pro.potencialidades(r), ries = PX.pro.riesgos(r);
    const lv = ['', 'Informativo', 'Medio', 'Alto'];
    let h = PX.lamina.html(r, s, { folio });

    // ---------- Hoja 2: ficha sintética ----------
    const tl = r.isPlano ? '' : `<section class="blk"><h2>Remate</h2>
      <table class="tb"><thead><tr><th>Etapa</th><th>Fecha</th><th class="n">Base</th></tr></thead><tbody>
      ${r.fd.map((d, k) => `<tr class="${k < r.st ? 'past' : ''}${k === r.st ? ' now' : ''}"><td>${PX.ETAPA[k]}${k ? ` <small>${PX.PCT[k] * 100} %</small>` : ''}</td><td>${fdate(d, true)}</td><td class="n">${PX.duo(r.bases[k], r.mon)}</td></tr>`).join('')}</tbody></table>
      <dl class="kv sm"><dt>Expediente</dt><dd class="num">${esc(r.exp || '—')}</dd><dt>Despacho</dt><dd>${esc(r.juz || '—')}</dd><dt>Proceso</dt><dd>${esc(PX.cap(r.proc) || '—')}</dd><dt>Boletín Judicial</dt><dd>Nº ${(r.bols || [r.bol]).join(' y ')} de 2026</dd></dl></section>`;
    const diff = r.area && r.areaCat ? (r.areaCat - r.area) / r.area : null;
    const reg = `<section class="blk"><h2>Registro y catastro</h2><dl class="kv sm">
      <dt>Finca</dt><dd class="num">${esc(r.fincaTxt)}${r.der && r.der !== '000' ? ' <span class="tag warn">derecho parcial</span>' : ''}</dd>
      <dt>Plano</dt><dd class="num">${esc(r.plano || (r.planoCat ? PX.planoTxt(r.planoCat) : 'No indicado'))}</dd>
      ${r.nat ? `<dt>Naturaleza</dt><dd>${esc(r.nat)}</dd>` : ''}
      <dt>Área</dt><dd>${r.area ? `<span class="num">${fnum(r.area)}</span> m² en edicto` : ''}${r.area && r.areaCat ? ' · ' : ''}${r.areaCat ? `<span class="num">${fnum(r.areaCat)}</span> m² en catastro` : ''}${diff != null && Math.abs(diff) > 0.1 ? ` <span class="tag warn">${diff > 0 ? '+' : ''}${Math.round(diff * 100)} %</span>` : ''}</dd>
      <dt>Ubicación</dt><dd>${esc(r.lugar || '—')}${r.ll ? `<small class="sub num">${r.ll[1].toFixed(5)}, ${r.ll[0].toFixed(5)}</small>` : ''}</dd>
      ${r.rev ? `<dt>Revisión</dt><dd>${esc(r.rev)}</dd>` : ''}</dl></section>`;
    const gl = r.isPlano ? [] : PX.explicar(r.grav, r.serv);
    const grav = r.isPlano ? '' : `<section class="blk"><h2>Gravámenes y servidumbres</h2>
      ${(r.serv || []).length ? `<div class="chips">${r.serv.map(x => `<span class="chip warn">${esc(PX.cap(x))}</span>`).join('')}</div>` : '<p class="ok">El edicto no cita servidumbres.</p>'}
      ${r.grav ? `<p class="raw">${esc(r.grav)}</p>` : ''}
      ${gl.length ? `<div class="gl">${gl.map(g => `<div><b>${esc(g.n)}.</b> ${esc(g.d)}</div>`).join('')}</div>` : ''}</section>`;
    const pv = PX.pro.potDefaults(r), pc = PX.pro.potCalc(pv);
    const potc = pv.area ? `<section class="blk"><h2>Potencial constructivo <small>supuestos generales</small></h2>
      <div class="k4"><div><small>Huella (${pv.cob} %)</small><b class="num">${fnum(pc.huella, 0)} m²</b></div><div><small>En ${pv.pisos} pisos</small><b class="num">${fnum(pc.total, 0)} m²</b></div><div><small>Unidades de ${pv.unidad} m²</small><b class="num">${pc.unidades}</b></div><div><small>Lotes de ${fnum(pv.loteMin)} m²</small><b class="num">${pc.lotes}</b></div></div>
      <p class="note2">Los valores reales los fija el plan regulador: ${esc(PX.prText(e.pr).toLowerCase())}.</p></section>` : '';
    const ana = `<section class="blk"><h2>Análisis multidimensional · índice <span class="num">${s.total ?? '–'}</span> ${esc(PX.scoreLabel(s.total).toLowerCase())}</h2>
      ${PX.DIMS.map(d => `<div class="dm"><div class="dmh"><b>${d.n}</b><span class="num">${s[d.k] ?? '–'}</span></div><span class="track"><i style="width:${s[d.k] || 0}%"></i></span>
        <p>${(s.why[d.k] || []).slice(0, 3).map(([p, t]) => esc(t)).join(' · ')}</p></div>`).join('')}</section>`;
    const riesg = `<section class="blk"><h2>Riesgos posibles</h2><div class="rl">${ries.length ? ries.map(x => `<div class="r${x.n}"><i>${x.n === 1 ? 'i' : '!'}</i><span><b>${esc(x.t)}</b> <em>${lv[x.n]}</em><br>${esc(x.d)}</span></div>`).join('') : '<p>Sin riesgos detectados en los datos disponibles.</p>'}</div></section>`;
    const potl = `<section class="blk"><h2>Potencialidades</h2><div class="rl pos">${pots.length ? pots.slice(0, 6).map(x => `<div><i>+</i><span><b>${esc(x.t)}.</b> ${esc(x.d)}</span></div>`).join('') : '<p>Sin ventajas destacadas en los datos disponibles.</p>'}</div></section>`;
    const chk = `<section class="blk"><h2>Antes de ofertar</h2><ul class="chk">${PX.pro.CHECK.map(t => `<li>☐ ${t}</li>`).join('')}</ul></section>`;

    h += `<section class="page">${head('Ficha del lote')}<div class="cols">
        <div class="col">${tl}${reg}${grav}</div>
        <div class="col">${ana}${potl}${potc}</div></div>${foot(2)}</section>`;
    h += `<section class="page">${head('Riesgos y verificación')}<div class="cols">
        <div class="col">${riesg}</div><div class="col">${chk}
        <section class="blk"><h2>Fuentes</h2><p class="note2">Boletín Judicial (Poder Judicial) · Catastro del Registro Inmobiliario (SNIT) · IGN: límites, hidrografía, curvas, vías, escuelas · INVU: planes reguladores · MINAE: cobertura 2020, zonas de vida, cuencas · CCSS: sedes de salud · BCCR: tipo de cambio ${PX.duoT(1, 'USD')}, ${esc(PX.tc.fecha)}.</p></section>
        </div></div>${foot(3)}</section>`;
    if (!r.isPlano && r.txt) h += `<section class="page">${head('Texto del edicto')}<section class="blk"><p class="edicto cols2">${esc(r.txt)}</p><p class="note2">Transcrito del Boletín Judicial. Se omiten nombres de personas deudoras y cédulas.</p></section>${foot(4)}</section>`;
    h += `<div class="legal screen-only">${PX.DISCLAIMER}</div>`;
    doc.innerHTML = h;
    PX.lamina.init(r);
  }
  function setCur(c) { PX.setCur(c); $('cCRC').setAttribute('aria-pressed', c === 'CRC'); $('cUSD').setAttribute('aria-pressed', c === 'USD'); render(); }
  $('cCRC').onclick = () => setCur('CRC'); $('cUSD').onclick = () => setCur('USD');
  $('print').onclick = () => window.print();
  setCur(PX.cur);
  document.title = `Expediente · ${r.nom} · PlanoExactoCR`;
})();
