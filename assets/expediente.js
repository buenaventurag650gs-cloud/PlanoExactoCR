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
  if (!r) { doc.innerHTML = '<div class="wall"><h1>No encontramos ese lote</h1><p>El enlace puede ser de un remate que ya no está vigente o de un plano consultado en otro navegador.</p><div class="acts"><a class="btn primary" href="/mapa">Volver al mapa</a></div></div>'; return; }
  $('back').href = '/mapa#' + r.key;

  // Acceso: con cuenta, dentro del cupo del mes (PRO o cortesía del acceso anticipado)
  await PX.cargarYo();
  if (!PX.tieneExp(r.key) && !PX.registrarExp(r.key, r.nom)) {
    doc.innerHTML = `<div class="wall"><span class="lbl">Expediente del lote</span><h1>${esc(r.nom)}</h1><p class="muted">${esc(r.lugar)}</p>
      <p>Este expediente reúne en una lámina el mapa del predio con sus variables, el índice PlanoExacto, las potencialidades y los riesgos, más el edicto, los datos registrales y los gravámenes explicados.</p>
      <p>${PX.conCuenta() ? `Ya usaste los expedientes que incluye tu plan (${PX.cupoTxt()}). Cada expediente adicional cuesta ${PX.mt(PX.PRECIOS.expediente, 'CRC')}; con PRO generas todos los que quieras. Puedes solicitar un plan desde el mapa.` : 'Entra con tu cuenta para generar el expediente.'}</p>
      <div class="acts"><a class="btn primary" href="/mapa${PX.conCuenta() ? '#' + r.key : '?entrar=1'}">Volver al mapa</a></div>
      <div class="legal">${PX.DISCLAIMER}</div></div>`;
    $('print').hidden = true;
    return;
  }
  if (r.isPlano && r.ent && r.ent.cob === undefined && r.ll) { r.ent.cob = await PX.cobertura(r.ll[0], r.ll[1]); PX.savePlano(r); }
  // Postes, cobertura móvil/internet fijo y transporte público: carga perezosa y NO
  // bloqueante. Entre los tres, estas consultas pueden pesar varios MB (postes.json)
  // y varias peticiones WMS al ICE; si el expediente esperara (await) todo esto antes
  // de pintar, la ficha completa se sentiría lenta por un puñado de filas. En vez de
  // eso, renderizamos de inmediato sin estos datos y cada uno se inserta solo, por su
  // cuenta, cuando llega (o no aparece si la consulta falla).
  let posteCerc = null, sutelCov = null, sutelListo = false, cobMovil = null, inetFijo = null, telecomListo = false, transp = null;
  function cargarServicios() {
    if (!r.ll) return;
    const [lon, lat] = r.ll;
    PX.posteMasCercano(lon, lat).then(pc => { if (pc) { posteCerc = pc; render(); } }).catch(() => {});
    // Cobertura móvil, por operador: mediciones reales de usuarios (SUTEL/MedUX) —
    // Kolbi, Claro y Liberty por igual. Se deja además la capa del ICE (debajo) por
    // si esa fuente llega a estabilizarse; mientras tanto son dos señales aparte.
    PX.coberturaSUTEL(lon, lat).then(c => { sutelCov = c; }).catch(() => { sutelCov = {}; }).finally(() => { sutelListo = true; render(); });
    // Cobertura móvil (ICE) e internet fijo: consultas WMS paralelas al ICE
    (async () => {
      try {
        const d = 0.0005, bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
        const CAPAS = ['ice:5g-omv', 'ice:ltea', 'ice:lte', 'ice:tg'];
        const TECH = ['5G', 'LTE-A', 'LTE', '3G/2G'];
        const imgs = await Promise.all([...CAPAS, 'ice:internet-shp'].map(l =>
          fetch(`/api/ice-wms?layer=${l}&bbox=${bbox}&width=3&height=3&srs=EPSG:4326`)
            .then(r => r.ok ? r.blob().then(b => createImageBitmap(b)) : null).catch(() => null)));
        const cv = document.createElement('canvas'); cv.width = 3; cv.height = 3;
        const ctx = cv.getContext('2d');
        const chk = bmp => { if (!bmp) return false; ctx.clearRect(0, 0, 3, 3); ctx.drawImage(bmp, 0, 0); return ctx.getImageData(1, 1, 1, 1).data[3] > 10; };
        for (let i = 0; i < CAPAS.length; i++) if (chk(imgs[i])) { cobMovil = TECH[i]; break; }
        inetFijo = chk(imgs[4]);
      } catch (_) {}
      telecomListo = true; render();
    })();
    // Transporte público: distancia a ruta de bus y estación de tren
    PX.transporteCercano(lon, lat).then(t => { if (t) { transp = t; render(); } }).catch(() => {});
    // Apoyo legal en sitio
    if (r.juz) {
      fetch('/api/apoyo-legal?juz=' + encodeURIComponent(r.juz)).then(r => r.json()).then(data => {
        const d = document.getElementById('exp-apoyo');
        if (!d) return;
        if (data.error || !data.length) { d.innerHTML = '<p class="note2">No hay apoyos legales registrados para este juzgado todavía.</p>'; return; }
        d.innerHTML = `<p class="note2 mb-1">${data.length} apoyo${data.length > 1 ? 's' : ''} legal${data.length > 1 ? 'es' : ''} disponible${data.length > 1 ? 's' : ''} cerca del juzgado</p>
          <table class="kv-table"><thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Especialidad</th></tr></thead><tbody>${data.map(a => `<tr><td>${esc(a.nombre)}</td><td>${a.telefono || '—'}</td><td>${a.correo || '—'}</td><td>${esc(a.especialidad || '—')}</td></tr>`).join('')}</tbody></table>`;
      }).catch(() => { const d = document.getElementById('exp-apoyo'); if (d) d.textContent = 'No disponible'; });
    }
  }

  const folio = `PX-${r.key.toUpperCase()}-${PX.now.getFullYear()}${String(PX.now.getMonth() + 1).padStart(2, '0')}${String(PX.now.getDate()).padStart(2, '0')}`;
  const titleCase = s => String(s || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
  // Enlace de vuelta a la ficha en línea (mismo que usa "Volver al mapa"), con QR para
  // quien tiene el expediente impreso y quiere ver los datos actualizados desde el celular.
  const fichaURL = location.origin + '/mapa#' + r.key;
  const pmQR = PX.qrSVG ? `<a class="pmqr" href="${esc(fichaURL)}" target="_blank" rel="noopener" title="Ver esta ficha actualizada en línea">${PX.qrSVG(fichaURL, { nivel: 'M', quiet: 1 })}</a>` : '';

  // Encabezado y pie comunes a cada hoja
  const head = (t) => `<header class="ph"><div class="lbrand"><span class="mark"><img src="assets/img/logo-mark.svg" alt="" width="40" height="32"></span><span class="wmcol"><span class="wm"><span class="w1">PLANO</span><span class="w2">EXACTO</span><span class="w3">CR</span></span><span class="lsub">${esc(PX.CONTACTO.web)} · @${esc(PX.CONTACTO.ig)}</span></span></div>
      <div class="pt"><b>${esc(r.nom)}</b><span>${t}</span></div><div class="pm">${pmQR}<span class="pmtxt"><b class="num">${folio}</b><span>${fdate(new Date())}</span><small>Ficha en línea ↗</small></span></div></header>`;
  const foot = n => `<footer class="pf">Compendio de información pública y análisis orientativo: no es certificado de uso de suelo, certificación registral o catastral, avalúo ni estudio de título. Verifique en el expediente judicial, el Registro Nacional y la municipalidad.<span class="num">${n}</span></footer>`;

  function render() {
    const s = PX.score(r), e = r.ent || {}, a = PX.prof(r);
    const pots = PX.pro.potencialidades(r), ries = PX.pro.riesgos(r);
    const nv = PX.pro.normativa(r);
    const lv = ['', 'Informativo', 'Medio', 'Alto'];
    const I = PX.ICON;
    let h = PX.lamina.html(r, s, { folio });

    // ---------- Hoja 2: ficha sintética ----------
    // Dos columnas con un propósito distinto cada una, para que no se sienta
    // como una sola chorrera de bloques: la izquierda son los datos técnicos
    // y legales del lote; la derecha, el análisis de valor y mercado.
    const jc = r.isPlano ? null : PX.juzContacto(r.juz);
    const tl = r.isPlano ? '' : `<section class="blk"><h2>${I.gavel}Remate</h2>
      <table class="tb"><thead><tr><th>Etapa</th><th>Fecha</th><th class="n">Base</th></tr></thead><tbody>
      ${r.fd.map((d, k) => `<tr class="${k < r.st ? 'past' : ''}${k === r.st ? ' now' : ''}"><td>${PX.ETAPA[k]}${k ? ` <small>${PX.PCT[k] * 100} %</small>` : ''}</td><td>${fdate(d, true)}</td><td class="n">${PX.duo(r.bases[k], r.mon)}</td></tr>`).join('')}</tbody></table>
      <dl class="kv sm"><dt>Expediente</dt><dd class="num">${esc(r.exp || '—')}${r.exp ? ` <button class="btn-copy" onclick="navigator.clipboard.writeText('${esc(r.exp)}');this.textContent='✓ Copiado';setTimeout(()=>this.textContent='Copiar',1500)" title="Copiar número de expediente">Copiar</button><small class="sub"><a href="https://pjenlinea.poder-judicial.go.cr/GestionEnLinea/inicio/consultas" target="_blank" rel="noopener">Consultar en el Poder Judicial ↗</a></small>` : ''}</dd><dt>Despacho</dt><dd>${esc(r.juz || '—')}<small class="sub">${jc
        ? `<a href="tel:+506${jc.tel.replace(/\D/g, '')}">Llamar</a> · <a href="mailto:${jc.mail}">Escribir</a> · ${jc.tel}`
        : `<a href="tel:+50622953000">Central del Poder Judicial</a> · <a href="mailto:institucionalidad@poder-judicial.go.cr">Escribir</a> <small class="note2">(sin contacto directo de este despacho; línea gratuita 800-800-3000)</small>`
      }</small></dd><dt>Proceso</dt><dd>${esc(PX.cap(r.proc) || '—')}</dd><dt>Boletín Judicial</dt><dd>Nº ${(r.bols || [r.bol]).join(' y ')} de 2026</dd></dl></section>`;
    const diff = r.area && r.areaCat ? (r.areaCat - r.area) / r.area : null;
    const reg = `<section class="blk"><h2>${I.registro}Registro y catastro</h2><dl class="kv sm">
      <dt>Finca</dt><dd class="num">${esc(r.fincaTxt)}${r.der && r.der !== '000' ? ' <span class="tag warn">derecho parcial</span>' : ''}</dd>
      <dt>Plano</dt><dd class="num">${esc(r.plano || (r.planoCat ? PX.planoTxt(r.planoCat) : 'No indicado'))}${(r.plano || r.planoCat) ? ` <button class="btn-copy" onclick="navigator.clipboard.writeText('${esc(r.planoCat || '')}');this.textContent='✓ Copiado';setTimeout(()=>this.textContent='Copiar',1500)" title="Copiar número de plano">Copiar</button><small class="sub"><a href="https://siri.rnp.go.cr/SIRI/index.jsp?faces-redirect=true" target="_blank" rel="noopener">Consultar en SIRI (Registro Nacional) ↗</a></small>` : ''}</dd>
      ${r.nat ? `<dt>Naturaleza</dt><dd>${esc(r.nat)}</dd>` : ''}
      <dt>Área</dt><dd>${r.area ? `<span class="num">${fnum(r.area)}</span> m² en edicto` : ''}${r.area && r.areaCat ? ' · ' : ''}${r.areaCat ? `<span class="num">${fnum(r.areaCat)}</span> m² en catastro` : ''}${diff != null && Math.abs(diff) > 0.1 ? ` <span class="tag warn">${diff > 0 ? '+' : ''}${Math.round(diff * 100)} %</span>` : ''}</dd>
      ${nv.dims ? `<dt>Dimensiones</dt><dd>≈ <span class="num">${fnum(nv.dims.corto, 1)} × ${fnum(nv.dims.largo, 1)}</span> m <small class="sub">relación frente/fondo 1:${fnum(nv.dims.rel, 1)}, medida sobre el polígono catastral</small></dd>` : ''}
      ${PX.topo(r) ? `<dt>Topografía</dt><dd>${esc(PX.topo(r).txt)}</dd>` : ''}
      <dt>Ubicación</dt><dd>${esc(r.lugar || '—')}<small class="sub">${r.isPlano ? 'Predio del catastro' : r.exact ? 'Ubicada por ' + r.loc + ' en el catastro' : 'Aproximada al centro del distrito'}${r.ll ? ' · ' + r.ll[1].toFixed(5) + ', ' + r.ll[0].toFixed(5) : ''}</small>${r.ll ? `<small class="sub">Mirar en línea: <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${r.ll[1]},${r.ll[0]}" target="_blank" rel="noopener">Street View</a> · <a href="https://www.google.com/maps/search/?api=1&query=${r.ll[1]},${r.ll[0]}" target="_blank" rel="noopener">Google Maps</a></small>` : ''}</dd>
      ${r.rev ? `<dt>Revisión</dt><dd>${esc(r.rev)}</dd>` : ''}</dl></section>`;
    const gl = r.isPlano ? [] : PX.explicar(r.grav, r.serv);
    const grav = r.isPlano ? '' : `<section class="blk"><h2>${I.alerta}Gravámenes y servidumbres</h2>
      ${(r.serv || []).length ? `<div class="chips">${r.serv.map(x => `<span class="chip warn">${esc(PX.cap(x))}</span>`).join('')}</div>` : '<p class="ok">El edicto no cita servidumbres.</p>'}
      ${r.grav ? `<p class="raw">${esc(r.grav)}</p>` : ''}
      ${gl.length ? `<div class="gl">${gl.map(g => `<div><b>${esc(g.n)}.</b> ${esc(g.d)}</div>`).join('')}</div>` : ''}</section>`;
    // Servicios e infraestructura: todo lo que antes quedaba disuelto entre las
    // filas de «Valor y mercado» — agua, electricidad, telecomunicaciones y
    // transporte público — reunido en una sola sección con su propio ícono,
    // igual al de su categoría en el mapa.
    const serv = `<section class="blk"><h2>${I.servicios}Servicios e infraestructura</h2><dl class="kv sm">
      ${e.aguaS ? `<dt>${I.agua}Agua potable</dt><dd>Cobertura de ${esc(e.aguaS.join(', '))}<small class="sub">AyA / ASADAS / ESPH / municipal</small></dd>` : `<dt>${I.agua}Agua potable</dt><dd>Sin cobertura registrada<small class="sub">AyA / ASADAS / ESPH / municipal</small></dd>`}
      ${e.costa != null ? `<dt>${I.costa}Costa</dt><dd>A <b class="num">${PX.dist(e.costa)}</b>${e.costa <= 200 ? ' <span class="tag warn">zona marítimo terrestre</span>' : ''}<small class="sub">Distancia a la línea de costa (IGN)</small></dd>` : ''}
      ${posteCerc ? `<dt>${I.elec}Tendido eléctrico</dt><dd>Poste más cercano a <b class="num">${PX.dist(posteCerc.d)}</b><small class="sub">Infraestructura vertical del tendido eléctrico (ARESEP)</small></dd>` : `<dt>${I.elec}Tendido eléctrico</dt><dd class="muted">Buscando el poste más cercano…</dd>`}
      ${sutelListo ? (sutelCov && Object.keys(sutelCov).length ? `<dt>${I.tele}Cobertura móvil por operador</dt><dd>${Object.entries(sutelCov).map(([op, v]) => `<b>${esc(PX.SUTEL_OPS[op] || op)}</b> ${PX.rsrpLabel(v.rsrp)}`).join(' · ')}<small class="sub">Mediciones reales de usuarios cercanos (SUTEL/MedUX), no un mapa oficial de cobertura</small></dd>` : `<dt>${I.tele}Cobertura móvil por operador</dt><dd>Sin mediciones cercanas registradas<small class="sub">SUTEL/MedUX</small></dd>`) : `<dt>${I.tele}Cobertura móvil por operador</dt><dd class="muted">Consultando mediciones de SUTEL…</dd>`}
      ${telecomListo ? (cobMovil ? `<dt>${I.tele}Cobertura móvil (ICE)</dt><dd><b>${cobMovil}</b><small class="sub">Mejor tecnología celular disponible según el ICE/Kolbi</small></dd>` : `<dt>${I.tele}Cobertura móvil (ICE)</dt><dd>Sin cobertura registrada (ICE)</dd>`) : `<dt>${I.tele}Cobertura móvil (ICE)</dt><dd class="muted">Consultando al ICE…</dd>`}
      ${telecomListo && inetFijo != null ? (inetFijo ? `<dt>${I.tele}Internet fijo</dt><dd>Disponible (ICE)<small class="sub">Cobertura de internet fijo residencial</small></dd>` : `<dt>${I.tele}Internet fijo</dt><dd>Sin cobertura registrada</dd>`) : ''}
      ${transp && transp.bus ? `<dt>${I.bus}Ruta de bus</dt><dd>A <b class="num">${PX.dist(transp.bus.d)}</b>${transp.bus.n ? `<small class="sub">${esc(transp.bus.n)}</small>` : '<small class="sub">Ramal concesionado (ARESEP)</small>'}</dd>` : transp ? `<dt>${I.bus}Ruta de bus</dt><dd>Sin rutas a menos de 5 km</dd>` : `<dt>${I.bus}Transporte público</dt><dd class="muted">Consultando a ARESEP…</dd>`}
      ${transp && transp.tren != null ? `<dt>${I.bus}Estación de tren</dt><dd>A <b class="num">${PX.dist(transp.tren)}</b><small class="sub">INCOFER (GAM)</small></dd>` : transp ? `<dt>${I.bus}Estación de tren</dt><dd>Sin estaciones a menos de 15 km</dd>` : ''}
      </dl></section>`;
    const norm = `<section class="blk"><h2>${I.norma}Normativa aplicable</h2><p><b>${esc(nv.titulo)}.</b> ${esc(nv.texto)}</p>
      ${nv.reglas.length ? `<dl class="kv sm">${nv.reglas.map(([k, t]) => `<dt>${k}</dt><dd>${esc(t)}</dd>`).join('')}</dl>` : ''}
      ${nv.alertas.length ? `<div class="gl">${nv.alertas.map(t => `<div>${esc(t)}</div>`).join('')}</div>` : ''}
      ${nv.vigente ? '' : `<p class="note2">Fuente: ${esc(PX.pro.NAC.fuente)}.</p>`}</section>`;
    const z = e.zh, pcr = PX.pecr(r), vd = PX.pro.valDefaults(r), vc = PX.pro.valCalc(r, vd), ip = PX.iph(r);
    // Barra graduada del nivel PECR (eje $/m² en escala log). El icono del nivel es la franja de
    // color; la base vigente se marca con una barrita (el diamante amarillo es de Hacienda, que
    // se muestra arriba, no aquí). Así no se confunden PECR y Hacienda.
    const pecrBar = pcr ? (() => {
      const bu = r.usdm2, L = v => Math.max(0, Math.min(100, Math.log10(Math.max(1, Math.min(1000, v))) / 3 * 100));
      return `<div class="prange"><div class="pr-t"><i style="left:${L(pcr[2])}%;width:${L(pcr[3]) - L(pcr[2])}%;background:#2A6B4D"></i>${bu != null ? `<b class="mk" style="left:${L(bu)}%" title="Base vigente"></b>` : ''}</div>
        <div class="pr-ax">${[1, 10, 100, 1000].map(v => `<span style="left:${L(v)}%">$${v}</span>`).join('')}</div>
        ${bu != null ? `<div class="pleg"><span class="sw lvl" style="background:#2A6B4D"></span>Rango del nivel<span class="sw mk"></span>Base vigente (${PX.duoI(bu, 'USD', '/m²')})</div>` : ''}</div>`;
    })() : '';
    const val = `<section class="blk"><h2>${I.valor}Valor y mercado</h2><dl class="kv sm">
      ${z ? `<dt>Zona homogénea</dt><dd>${esc(z.c)} · ${esc(PX.cap(z.n))}<small class="sub">Hacienda (ONT): ${PX.duoI(z.v, 'CRC', '/m²')} · tipología ${esc(z.u)}</small></dd>` : ''}
      ${vc.total ? `<dt>Valor de referencia</dt><dd>${PX.duoI(vc.total, 'CRC')}<small class="sub">Terreno ${PX.duoI(vc.terreno, 'CRC')}${vd.ac ? ` + construcción estimada ${fnum(vd.ac)} m² ${vd.tip} (${PX.duoI(vc.vnr, 'CRC')})` : ''}</small></dd>` : ''}
      ${ip ? `<dt>Índice Puja/Hacienda</dt><dd><b>${Math.round(ip.v)}</b> · ${esc(ip.band[1])}<small class="sub">Base vigente ÷ valor según Hacienda × 100. Por etapa: ${ip.etapas.map((v, i) => ['1.º', '2.º', '3.º'][i] + ' ' + Math.round(v)).join(' · ')}${ip.aviso ? '. ' + esc(ip.aviso) : ''}</small>${PX.iphBar(ip.v, true)}</dd>` : ''}
      </dl>
      ${pcr ? `<div class="pecr"><div><b>Nivel PECR ${pcr[0]} de ${PX.PECR_N}</b> · ${esc(pcr[1])}</div><div class="sc">${PX.PECR.map(x => `<span class="${x[0] === pcr[0] ? 'me' : x[0] < pcr[0] ? 'on' : ''}"></span>`).join('')}</div>
        ${pecrBar}
        ${PX.pecrTable(pcr, r.usdm2, null, '#2A6B4D')}</div>` : ''}
      <p class="note2">Referencias orientativas, no avalúo. Construcción estimada con supuestos editables en la herramienta PRO «Valor de referencia».</p></section>`;
    const ana = `<section class="blk"><h2>${I.entorno}Análisis multidimensional · índice <span class="num">${s.total ?? '–'}</span> ${esc(PX.scoreLabel(s.total).toLowerCase())}</h2>
      ${PX.DIMS.map(d => `<div class="dm"><div class="dmh"><b>${d.n}</b><span class="num">${s[d.k] ?? '–'}</span></div><span class="track"><i style="width:${s[d.k] || 0}%"></i></span>
        <p>${(s.why[d.k] || []).slice(0, 2).map(([p, t]) => esc(t)).join(' · ')}</p></div>`).join('')}</section>`;
    const riesg = `<section class="blk"><h2>${I.alerta}Riesgos posibles</h2><div class="rl">${ries.length ? ries.map(x => `<div class="r${x.n}"><i>${x.n === 1 ? 'i' : '!'}</i><span><b>${esc(x.t)}</b> <em>${lv[x.n]}</em><br>${esc(x.d)}</span></div>`).join('') : '<p>Sin riesgos detectados en los datos disponibles.</p>'}</div></section>`;
    const potl = `<section class="blk"><h2>${I.star}Potencialidades</h2><div class="rl pos">${pots.length ? pots.slice(0, 6).map(x => `<div><i>+</i><span><b>${esc(x.t)}.</b> ${esc(x.d)}</span></div>`).join('') : '<p>Sin ventajas destacadas en los datos disponibles.</p>'}</div></section>`;
    const chk = `<section class="blk"><h2>${I.list}Antes de ofertar</h2><ul class="chk">${PX.pro.CHECK.map(t => `<li>☐ ${t}</li>`).join('')}</ul></section>`;
    const procLegal = `<section class="blk"><h2>${I.book}Cómo funciona el proceso de remate</h2><dl class="kv sm">
      <dt>Art. 157 · Señalamiento y publicación</dt><dd>El tribunal fija en una sola resolución las fechas de las hasta tres subastas posibles. El edicto se publica en el Boletín Judicial y describe el bien, la base y los gravámenes que soporta.</dd>
      <dt>Art. 158 · Suspensión</dt><dd>Solo se suspende si lo pide el acreedor, o si alguien deposita ante el tribunal una suma que cubra toda la deuda reclamada más costas. Un depósito claramente insuficiente no lo suspende; uno dudoso deja la subasta condicionada a completarlo en pocos días.</dd>
      <dt>Art. 159 · Participar y pagar</dt><dd>Para ofertar hay que depositar el 50 % de la base (efectivo, entero bancario o cheque certificado de un banco costarricense). Quien gana tiene 3 días hábiles para depositar el resto en el Banco Nacional; si no lo hace, pierde el depósito y el remate se declara insubsistente.</dd>
      <dt>Art. 161 · Si no hay postores</dt><dd>Sin ofertas en el primer remate, se repite con la base rebajada 25 %; si tampoco hay postores, un tercer remate arranca en el 25 % de la base original. Si ni así se presenta nadie, el bien se adjudica al acreedor ejecutante por ese mismo 25 %.</dd>
      <dt>Art. 162 · Remate insubsistente</dt><dd>Si quien ganó no paga a tiempo, el 30 % de su depósito queda como indemnización para los acreedores y el resto se abona a la deuda. Se vuelve a subastar, pero esa vez el depósito para participar es por el 100 % de la base.</dd>
      <dt>Art. 163 · Aprobación</dt><dd>Cumplidos los requisitos, el tribunal aprueba el remate, cancela los gravámenes posteriores al que se ejecuta y ordena entregar el bien al rematante — ahí se vuelve dueño de verdad.</dd>
      </dl><p class="note2">Resumen en lenguaje llano del Código Procesal Civil (Ley 9342); no sustituye el texto legal ni asesoría de un abogado.</p></section>`;

    const apoyoLegal = `<section class="blk"><h2>⚖️ Apoyo legal en sitio</h2><div id="exp-apoyo">Cargando apoyo legal…</div></section>`;
    const fuentes = `<section class="blk"><h2>${I.book}Fuentes</h2><p class="note2">Boletín Judicial · Registro Inmobiliario (SNIT) · IGN: límites, hidrografía, curvas, vías, escuelas, puertos · Hacienda (ONT): zonas homogéneas y tipologías 2023 · AyA: coberturas de agua · INVU: planes reguladores y reglamentos · MINAE: cobertura 2020, zonas de vida · CCSS: salud · ICE: cobertura móvil e internet fijo · ARESEP: tendido eléctrico y transporte · BCCR: ${PX.duoT(1, 'USD')}, ${esc(PX.tc.fecha)}.</p></section>`;
    const C = PX.CONTACTO;
    const svgIG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>';
    const svgWA = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 18.3z"/><path d="M8.5 9.5c0 4 2 6 6 6 .8 0 1.3-1 1-1.6l-1.6-.8-1 1c-1.2-.5-2-1.3-2.5-2.5l1-1-.8-1.6c-.6-.3-1.6.2-1.6 1z"/></svg>';
    const svgML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
    const svgWEB = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>';
    const contacto = `<section class="blk contacto"><h2>${I.info}¿Dudas sobre este remate? Hablemos</h2>
      <p class="note2 mb-1">PlanoExactoCR acompaña el proceso: resolvemos dudas y, con el plan PRO, te conectamos con apoyo legal cerca del juzgado.</p>
      <div class="cx">
        <a href="mailto:${esc(C.correo)}?subject=${encodeURIComponent('Consulta sobre ' + r.nom)}">${svgML}<span>${esc(C.correo)}</span></a>
        <a href="${esc(C.igUrl)}" target="_blank" rel="noopener">${svgIG}<span>@${esc(C.ig)}</span></a>
        ${C.waUrl ? `<a href="${esc(C.waUrl)}?text=${encodeURIComponent('Hola, tengo una duda sobre ' + r.nom)}" target="_blank" rel="noopener">${svgWA}<span>WhatsApp</span></a>` : ''}
        <a href="https://${esc(C.web)}" target="_blank" rel="noopener">${svgWEB}<span>${esc(C.web)}</span></a>
      </div></section>`;
    h += `<section class="page">${head('Detalles técnicos y de mercado')}<div class="cols">
        <div class="col"><p class="colkick">Detalles técnicos y legales</p>${tl}${reg}${serv}${grav}</div>
        <div class="col"><p class="colkick">Análisis de mercado</p>${val}${ana}</div></div>${foot(2)}</section>`;
    h += `<section class="page">${head('Normativa y riesgos')}<div class="cols">
        <div class="col"><p class="colkick">Normativa</p>${norm}${chk}${procLegal}</div>
        <div class="col"><p class="colkick">Potencialidades y riesgos</p>${potl}${riesg}${apoyoLegal}${fuentes}${contacto}${!r.isPlano && r.txt && r.txt.length < 1600 && ries.length < 4 ? `<section class="blk"><h2>${I.book}Texto del edicto</h2><p class="edicto">${esc(r.txt)}</p></section>` : ''}</div></div>${foot(3)}</section>`;
    if (!r.isPlano && r.txt && !(r.txt.length < 1600 && ries.length < 4)) h += `<section class="page">${head('Texto del edicto')}<section class="blk"><p class="edicto cols2">${esc(r.txt)}</p><p class="note2">Transcrito del Boletín Judicial. Se omiten nombres de personas deudoras y cédulas.</p></section>${foot(4)}</section>`;
    // Hoja adicional: cambio de uso del suelo (3 vistas satélite históricas)
    if (r.ll && !r.isPlano) {
      const hcols = PX.lamina.WAYBACK_VERSIONS.map(v =>
        `<div class="hsat-col"><div class="hsat-map" id="hmap-${v.y}"></div><div class="hsat-lbl">${esc(v.t)}</div></div>`
      ).join('');
      h += `<section class="page">${head('Cambio de uso del suelo')}
        <div class="hsat-intro"><p>Las tres imágenes muestran el mismo sitio en distintos períodos para identificar cambios en la cobertura o el uso del suelo. <b>Verificar cambios de vegetación, construcciones, movimientos de tierra o deforestación antes de la compra.</b> Imágenes: Esri/Maxar (actual y ~2014) · Ortofoto IGN/SNIT 2017.</p></div>
        <div class="hsat-grid">${hcols}</div>
        <div class="hsat-nota"><b>Nota:</b> Las imágenes son orientativas. La resolución varía según la zona. Para análisis definitivo use Google Earth o el Visor del SINAC.</div>
        ${foot(h.match(/class="page"/g)?.length + 1 || 4)}</section>`;
    }
    h += `<div class="legal screen-only">${PX.DISCLAIMER}</div>`;
    doc.innerHTML = h;
    PX.lamina.init(r);
    if (r.ll && !r.isPlano) PX.lamina.initHistorial(r);
  }
  function setCur(c) { PX.setCur(c); $('cCRC').setAttribute('aria-pressed', c === 'CRC'); $('cUSD').setAttribute('aria-pressed', c === 'USD'); render(); }
  $('cCRC').onclick = () => setCur('CRC'); $('cUSD').onclick = () => setCur('USD');
  $('print').onclick = () => window.print();
  setCur(PX.cur);
  document.title = `Expediente · ${r.nom} · PlanoExactoCR`;
  cargarServicios();
})();
