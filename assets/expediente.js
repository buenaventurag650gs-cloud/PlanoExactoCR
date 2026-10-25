/* PlanoExactoCR — expediente imprimible de un lote. */
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
      <p>Este expediente reúne el edicto, los datos registrales, los gravámenes explicados, el entorno del predio, el análisis multidimensional y los comparables de la zona.</p>
      <div class="acts"><button class="btn primary" id="buy">Comprar por ${PX.mt(PX.PRECIOS.expediente, 'USD')}</button><button class="btn" id="sub">Suscripción: ${PX.mt(PX.PRECIOS.suscripcion, 'USD')} al mes, ${PX.PRECIOS.cupo} expedientes</button></div>
      <div class="demo">Modo demostración: el pago aún no está conectado. Al confirmar se activa el acceso en este navegador.</div>
      <div class="legal">${PX.DISCLAIMER}</div></div>`;
    $('print').hidden = true;
    $('buy').onclick = () => { PX.comprar(r.key, r.nom); location.reload(); };
    $('sub').onclick = () => { PX.acct.plan = 'pro'; PX.saveAcct(); location.reload(); };
    return;
  }

  // Plano consultado: completar cobertura si falta
  if (r.isPlano && r.ent && r.ent.cob === undefined && r.ll) { r.ent.cob = await PX.cobertura(r.ll[0], r.ll[1]); PX.savePlano(r); }

  function render() {
    const s = PX.score(r), e = r.ent || {}, a = PX.prof(r);
    const folio = `PX-${r.key.toUpperCase()}-${PX.now.getFullYear()}${String(PX.now.getMonth() + 1).padStart(2, '0')}${String(PX.now.getDate()).padStart(2, '0')}`;
    const m2 = r.bv && a ? PX.conv(r.bv, r.mon, PX.cur) / a : null;
    const sec = (n, t, body, cls) => `<section class="sheet ${cls || ''}"><h2><span class="n">${n}</span>${t}</h2>${body}</section>`;
    let n = 0; const N = () => String(++n).padStart(2, '0');
    const warn = t => ` <span class="tag warn">${t}</span>`;

    // Resumen
    const kpi = r.isPlano
      ? `<div><small>Área catastro</small><b><span class="num">${fnum(a)}</span> <span class="u">m²</span></b></div><div><small>Finca</small><b class="num">${esc(r.fincaTxt)}</b></div><div><small>Plano</small><b class="num">${esc(r.plano || '—')}</b></div><div><small>Remate</small><b>${r.remate ? 'Sí, vigente' : 'No'}</b></div>`
      : `<div><small>Base vigente · ${PX.ETAPA[r.st]}</small><b>${PX.money(r.bv, r.mon)}</b></div><div><small>Próximo remate</small><b>${fdate(r.next)}</b></div><div><small>Área</small><b><span class="num">${a ? fnum(a) : '—'}</span> <span class="u">m²</span></b></div><div><small>Precio por m²</small><b>${m2 ? PX.mh(m2, PX.cur) : '—'}</b></div>`;
    let h = `<div class="legal">${PX.DISCLAIMER}</div>
    <section class="sheet hdr"><img class="logo" src="assets/img/logo.webp" alt="PlanoExactoCR · Ubica, comprende, decide" width="900" height="481"><div class="meta"><span>Expediente <b class="num">${folio}</b></span><span>Generado el ${fdate(new Date(), true)}</span><span>Datos del ${esc(META.generado || '')} · TC BCCR ${PX.mt(PX.tc.venta, 'CRC')}</span></div>
      <h1>${esc(r.nom)}</h1><div class="where">${esc(r.lugar || 'Ubicación por definir')}</div>
      <div class="chips"><span class="chip">${esc(r.tipo)}</span>${r.isPlano ? '<span class="chip">Plano consultado en el catastro</span>' : r.exact ? `<span class="chip">Ubicación exacta por ${r.loc}</span>` : '<span class="chip warn">Ubicación aproximada al distrito</span>'}${r.multi ? '<span class="chip warn">Varias fincas o derechos</span>' : ''}</div>
      <div class="kpi">${kpi}</div></section>`;

    h += sec(N(), 'Resumen del análisis', `<div class="sum"><span class="score big" style="--p:${s.total || 0}" data-v="${s.total ?? '–'}"></span>
      <div style="display:grid;gap:10px"><div><b style="font-size:17px">${PX.scoreLabel(s.total)}</b><div class="muted" style="font-size:12.5px">Índice PlanoExacto de 0 a 100: promedio ponderado de cuatro dimensiones (pesos ${PX.DIMS.map(d => d.n.toLowerCase() + ' ' + PX.W0[d.k] + ' %').join(', ')}).</div></div>
      <div class="bars">${PX.DIMS.map(d => `<div class="bar"><span>${d.n}</span><b>${s[d.k] ?? '–'}</b><span class="track"><i style="width:${s[d.k] || 0}%"></i></span></div>`).join('')}</div></div></div>`);

    h += sec(N(), 'Ubicación del predio', `<div id="emap" role="img" aria-label="Mapa del predio"></div>
      <div class="foot">${r.poly ? 'Polígono del Registro Inmobiliario (catastro) sobre imagen satelital.' : 'El catastro no confirmó el predio: el círculo marca el distrito declarado en el edicto.'} Coordenadas del centro: <span class="num">${r.ll ? r.ll[1].toFixed(6) + ', ' + r.ll[0].toFixed(6) : '—'}</span>${r.ll ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${r.ll[1]},${r.ll[0]}" target="_blank" rel="noopener">Google Maps</a>` : ''}</div>`);

    if (!r.isPlano) {
      const rows = r.fd.map((d, k) => `<tr class="${k < r.st ? 'past' : ''} ${k === r.st ? 'now' : ''}"><td>${PX.ETAPA[k]}${k ? ` (${PX.PCT[k] * 100} % de la base)` : ''}</td><td>${fdate(d, true)}</td><td class="n">${PX.money(r.bases[k], r.mon)}</td><td class="n">${PX.other(r.bases[k], r.mon)}</td></tr>`).join('');
      h += sec(N(), 'Remate', `<table><thead><tr><th>Etapa</th><th>Fecha y hora</th><th class="n">Base</th><th class="n">Equivalente</th></tr></thead><tbody>${rows}</tbody></table>
        <dl class="kv"><dt>Proceso</dt><dd>${esc(PX.cap(r.proc) || '—')}</dd><dt>Expediente judicial</dt><dd class="num">${esc(r.exp || '—')}${r.exp ? ` · <a href="https://nexuspj.poder-judicial.go.cr/search?q=%22${encodeURIComponent(r.exp)}%22" target="_blank" rel="noopener">buscar en Nexus</a>` : ''}</dd>
        <dt>Despacho</dt><dd>${esc(r.juz || '—')}</dd><dt>Publicado en</dt><dd>Boletín Judicial Nº ${(r.bols || [r.bol]).join(' y ')} de 2026${r.ref ? `<small class="sub">Referencia ${esc(r.ref)}</small>` : ''}</dd>
        <dt>Moneda del edicto</dt><dd>${r.mon === 'USD' ? 'Dólares' : 'Colones'}</dd></dl>
        <div class="foot">Las bases del 2.º y 3.er remate se calculan con el 75 % y el 25 % de la base original, según el Código Procesal Civil. Verifique fechas y condiciones en el expediente.</div>`);
    }

    const diff = r.area && r.areaCat ? (r.areaCat - r.area) / r.area : null;
    h += sec(N(), 'Datos registrales y catastrales', `<dl class="kv">
      <dt>Finca</dt><dd class="num">${esc(r.fincaTxt)}</dd>
      ${r.der ? `<dt>Derecho</dt><dd class="num">${esc(r.der)}${r.der !== '000' ? warn('derecho parcial') : ''}</dd>` : ''}
      <dt>Plano catastrado</dt><dd class="num">${esc(r.plano || (r.planoCat ? PX.planoTxt(r.planoCat) : 'No indicado'))}${r.planoCat && r.plano && !r.isPlano ? `<small class="sub">Catastro: ${esc(PX.planoTxt(r.planoCat))}</small>` : ''}</dd>
      ${r.nat ? `<dt>Naturaleza</dt><dd>${esc(r.nat)}</dd>` : ''}
      ${r.area ? `<dt>Área en edicto</dt><dd class="num">${fnum(r.area)} m²</dd>` : ''}
      ${r.areaCat ? `<dt>Área en catastro</dt><dd class="num">${fnum(r.areaCat)} m²${diff != null && Math.abs(diff) > 0.1 ? warn((diff > 0 ? '+' : '') + Math.round(diff * 100) + ' % frente al edicto') : ''}</dd>` : ''}
      <dt>Distrito</dt><dd>${esc([r.dn, r.cn, r.pn].filter(Boolean).join(', ') || '—')}${r.dc ? `<small class="sub">Código ${r.dc}</small>` : ''}</dd>
      ${r.bar ? `<dt>Barrio o urbanización</dt><dd>${esc(r.bar)}</dd>` : ''}
      ${r.rev ? `<dt>Revisión</dt><dd>${esc(r.rev)}</dd>` : ''}
    </dl>`);

    if (!r.isPlano) {
      const gl = PX.explicar(r.grav, r.serv);
      h += sec(N(), 'Gravámenes y servidumbres', `${(r.serv || []).length ? `<div class="chips">${r.serv.map(x => `<span class="chip warn">${esc(PX.cap(x))}</span>`).join('')}</div>` : '<div class="chips"><span class="chip">El edicto no cita servidumbres</span></div>'}
        ${r.grav ? `<div class="raw">${esc(r.grav)}</div>` : '<div class="muted">El edicto no detalla gravámenes.</div>'}
        ${gl.length ? `<div class="lbl">Qué significa</div><div class="gl">${gl.map(g => `<div><b>${esc(g.n)}</b><span>${esc(g.d)}</span></div>`).join('')}</div>` : ''}
        <div class="foot">Explicación general, no asesoría legal. La lista exacta de cargas se confirma con una certificación literal del Registro Nacional.</div>`);
    }

    // Entorno
    const er = [];
    if (e.pr) er.push(['Plan regulador', esc(PX.prText(e.pr)) + (e.pr.pub && e.pr.si ? `<small class="sub">${esc(e.pr.pub)}</small>` : '') + `<small class="sub">Estado INVU: ${esc(e.pr.cat)}</small>`]);
    else er.push(['Plan regulador', 'Sin dato del INVU para este punto']);
    if (e.cob !== undefined) er.push(['Uso y cobertura 2020', esc(e.cob || 'Sin dato del MINAE')]);
    if (e.agua !== undefined) er.push(['Ríos y quebradas', e.agua == null ? 'Ninguno a menos de 400 m en la cartografía 1:5 000' : `Cauce a ${PX.dist(e.agua)}${e.agua <= 15 ? warn('dentro de franja de protección') : e.agua <= 50 ? warn('posible franja de protección') : ''}`]);
    if (e.elev != null || e.pend != null || e.suave) er.push(['Relieve', [e.elev != null ? `≈ ${Math.round(e.elev)} m s. n. m.` : null, e.pend != null ? `pendiente ≈ ${e.pend} %${e.pend >= 30 ? warn('fuerte') : ''}` : e.suave ? 'pendiente suave' : null].filter(Boolean).join(' · ')]);
    if (e.via) er.push(['Vía más cercana', e.via.d <= 10 ? `${esc(e.via.t)}, al frente del predio` : `${esc(e.via.t)} a ${PX.dist(e.via.d)}`]);
    if (e.prot) er.push(['Protección de ríos', 'Toca una franja de protección de cauces' + warn('delimitación no oficial')]);
    if (e.psa) er.push(['Servicios ambientales', 'Toca un área con contrato de PSA de FONAFIFO (2025)' + warn('revisar')]);
    if (e.costa != null) er.push(['Costa', `A ${PX.dist(e.costa)} de la línea de costa${e.costa <= 250 ? warn('posible zona marítimo terrestre') : ''}`]);
    if (e.salud) er.push(['Salud', `${esc(e.salud.n)}<small class="sub">${esc(e.salud.c)} · ${PX.dist(e.salud.d)}</small>`]);
    if (e.esc != null) er.push(['Escuela o colegio', `A ${PX.dist(e.esc)}<small class="sub">Nomenclátor del IGN</small>`]);
    if (e.zv) er.push(['Zona de vida', esc(e.zv)]);
    if (e.cu) er.push(['Cuenca', esc(e.cu)]);
    h += sec(N(), 'Entorno', `<dl class="kv">${er.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <div class="foot">${r.exact || r.isPlano ? 'Distancias medidas desde el borde del predio' : 'Distancias medidas desde el centro del distrito, porque el predio no está ubicado con exactitud'}. La cartografía 1:5 000 del IGN no cubre todo el país. Fuentes: INVU, IGN, MINAE, FONAFIFO y CCSS vía SNIT.</div>`);

    // Análisis
    h += sec(N(), 'Análisis multidimensional', PX.DIMS.map(d => `<div class="dim"><span class="score" style="--p:${s[d.k] || 0}" data-v="${s[d.k] ?? '–'}"></span>
      <div><h3>${d.n}</h3><p>${d.d}</p><ul>${(s.why[d.k] || []).map(([p, t]) => `<li><b class="${p < 0 ? 'neg' : p > 0 ? 'pos' : ''}">${p ? (p > 0 ? '+' : '') + p : '·'}</b><span>${esc(t)}</span></li>`).join('')}</ul></div></div>`).join('') +
      `<div class="foot">Método: sanidad jurídica parte de 100 y descuenta por cada carga o incertidumbre; precio compara el ${PX.cur === 'USD' ? 'US$' : '₡'}/m² de la base vigente con la mediana de remates del mismo cantón (o provincia si hay menos de 3); servicios suma puntos por plan regulador, frente a vía, salud, escuela y zona urbana; restricciones parte de 100 y descuenta por ríos, pendiente, costa, bosque y protección.</div>`, 'long');

    // Comparables
    const comp = PX.R.filter(x => x.st >= 0 && x.key !== r.key && x.cn && x.cn === r.cn && x.usdm2).sort((a, b) => a.usdm2 - b.usdm2);
    const med = PX.medFor(r);
    if (comp.length || med) {
      const me = r.usdm2 ? [{ me: true, x: r }] : [];
      const rows = comp.slice(0, 10).map(x => ({ x })).concat(me).sort((a, b) => a.x.usdm2 - b.x.usdm2);
      h += sec(N(), 'Comparables de la zona', `${med ? `<div>Mediana de ${esc(med.ref)}: <b>${PX.mh(PX.conv(med.v, 'USD', PX.cur), PX.cur)}</b> por m² (${med.n} remates vigentes)${r.isPlano && a ? `. Aplicada al área del predio da una <b>referencia de ${PX.mh(PX.conv(med.v * a, 'USD', PX.cur), PX.cur, true)}</b>, que no es un avalúo.` : ''}</div>` : ''}
        ${rows.length ? `<table><thead><tr><th>Lote</th><th>Etapa</th><th class="n">Área m²</th><th class="n">Base</th><th class="n">Precio/m²</th></tr></thead><tbody>
        ${rows.map(({ x, me: isMe }) => `<tr class="${isMe ? 'me' : ''}"><td>${isMe ? 'Este lote · ' : ''}${esc(x.nom)}</td><td>${PX.ETAPA[x.st]}</td><td class="n">${fnum(PX.prof(x))}</td><td class="n">${PX.money(x.bv, x.mon, true)}</td><td class="n">${PX.mh(PX.conv(x.usdm2, 'USD', PX.cur), PX.cur)}</td></tr>`).join('')}</tbody></table>` : ''}
        <div class="foot">Bases de remate vigentes en el mismo cantón, no precios de venta. Sirven para ubicar el precio en su contexto.</div>`);
    }

    if (PX.isPro()) {
      const rs = PX.pro.riesgos(r), lv = ['', 'Información', 'Medio', 'Alto'];
      h += sec(N(), 'Riesgos del proceso ' + PX.PRO, `<div class="rlist">${rs.map(x => `<div class="rk r${x.n}"><i></i><div><b>${esc(x.t)}</b><span class="tag">${lv[x.n]}</span><p>${esc(x.d)}</p></div></div>`).join('') || '<p>No se detectaron riesgos en los datos disponibles.</p>'}</div>
        <div class="lbl">Antes de ofertar</div><ul class="chk">${PX.pro.CHECK.map(t => `<li>☐ ${t}</li>`).join('')}</ul>`);
      const pv = PX.pro.potDefaults(r), pc = PX.pro.potCalc(pv);
      if (pv.area) h += sec(N(), 'Potencial constructivo ' + PX.PRO, `<div class="kpi"><div><small>Huella (${pv.cob} % de cobertura)</small><b class="num">${fnum(pc.huella, 0)} m²</b></div><div><small>Construible en ${pv.pisos} pisos</small><b class="num">${fnum(pc.total, 0)} m²</b></div><div><small>Unidades de ${pv.unidad} m²</small><b class="num">${pc.unidades}</b></div><div><small>Lotes de ${pv.loteMin} m²</small><b class="num">${pc.lotes}</b></div></div>
        <div class="foot">Supuestos generales (${pv.util} % aprovechable, ${pv.circ} % de circulaciones). Ajústelos en el mapa con la herramienta PRO; los valores reales los fija el plan regulador.</div>`);
    }
    if (!r.isPlano && r.txt) h += sec(N(), 'Texto del edicto', `<div class="edicto">${esc(r.txt)}</div><div class="foot">Transcrito del Boletín Judicial. Se omiten nombres de personas deudoras y números de cédula.</div>`, 'long');

    h += sec(N(), 'Fuentes', `<ul style="margin:0;padding-left:18px;font-size:12.5px;display:grid;gap:3px">
      <li>Boletín Judicial, Poder Judicial (Nexus): edictos de remate 2026.</li><li>Registro Inmobiliario, catastro en el SNIT: polígono, área y plano.</li>
      <li>IGN: límites, hidrografía, curvas de nivel, vías y nomenclátor (1:5 000 y 1:25 000).</li><li>INVU: estado de los planes reguladores.</li>
      <li>MINAE (SINIA): mapa agropecuario y forestal 2020, zonas de vida, cuencas; FONAFIFO: PSA 2025; PNUD-TEVU: franjas de protección (no oficial).</li>
      <li>CCSS: sedes de salud. BCCR: tipo de cambio de referencia.</li></ul>`);
    h += `<div class="legal">${PX.DISCLAIMER}</div>`;
    doc.innerHTML = h;

    // Mapa
    if (r.ll && W.L) {
      const map = L.map('emap', { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      map.attributionControl.setPrefix(false);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imágenes &copy; Esri, Maxar' }).addTo(map);
      L.tileLayer.wms('https://siri.snitcr.go.cr/Geoservicios/wms', { layers: 'catastro,catastro_aldia', version: '1.1.1', format: 'image/png', transparent: true, minZoom: 15, maxZoom: 19, opacity: 0.7, attribution: 'Catastro &copy; Registro Inmobiliario' }).addTo(map);
      if (r.poly) {
        const pg = L.polygon(r.poly.map(p => p.map(ring => ring.map(([x, y]) => [y, x]))), { color: '#FFD166', weight: 3, fillColor: '#FFD166', fillOpacity: 0.18 }).addTo(map);
        map.fitBounds(pg.getBounds(), { padding: [40, 40], maxZoom: 18 });
      } else { L.circle([r.ll[1], r.ll[0]], { radius: 1200, color: '#FFD166', weight: 2, dashArray: '5 5', fill: false }).addTo(map); map.setView([r.ll[1], r.ll[0]], 13); }
    }
  }
  const W = window;
  function setCur(c) { PX.setCur(c); $('cCRC').setAttribute('aria-pressed', c === 'CRC'); $('cUSD').setAttribute('aria-pressed', c === 'USD'); render(); }
  $('cCRC').onclick = () => setCur('CRC'); $('cUSD').onclick = () => setCur('USD');
  $('print').onclick = () => window.print();
  setCur(PX.cur);
  document.title = `Expediente · ${r.nom} · PlanoExactoCR`;
})();
