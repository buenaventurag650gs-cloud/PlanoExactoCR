/* PlanoExactoCR — herramientas de la versión PRO: potencial constructivo, prefactibilidad, riesgos del proceso y alertas.
   Todas se muestran con la marca PRO. Sin suscripción se ven como vista previa: datos difuminados y controles bloqueados. */
(function () {
  'use strict';
  const { esc, fnum } = PX;
  const P = PX.pro = {};
  PX.PRO = '<span class="pro" title="Herramienta de la versión PRO">PRO</span>';

  // Catálogo de herramientas (las disponibles y las que vienen)
  P.TOOLS = [
    { k: 'potencial', n: 'Potencial constructivo', q: '¿Cuántos m² y unidades caben en el lote?', st: 'ok' },
    { k: 'prefa', n: 'Prefactibilidad financiera', q: '¿Cuánto invierto, cuánto podría valer y qué margen deja?', st: 'ok' },
    { k: 'riesgos', n: 'Riesgos del proceso', q: '¿Qué puede salir mal y qué revisar antes de ofertar?', st: 'ok' },
    { k: 'alertas', n: 'Alertas del remate', q: 'Avisos de cambio de etapa, nuevos edictos y fechas próximas', st: 'ok' },
    { k: 'precios', n: 'Mapa de precios por m²', q: 'Mediana de las bases de remate por cantón, en el mapa', st: 'ok', map: true },
    { k: 'top', n: 'Top 10 del mes', q: 'Los mejores remates por provincia según el índice', st: 'ok', list: true },
    { k: 'normativa', n: 'Normativa urbana del lote', q: 'Zona del plan regulador, usos, cobertura, altura y lote mínimo', st: 'soon' },
    { k: 'zh', n: 'Valor por zona homogénea', q: '¿La base está por debajo del valor de referencia de Hacienda?', st: 'soon' },
    { k: 'historia', n: 'Historia del sitio', q: 'Imágenes satelitales antiguas y cambio de cobertura', st: 'soon' }
  ];

  // ---------- Riesgos del proceso ----------
  // nivel: 3 alto, 2 medio, 1 bajo/información
  P.riesgos = r => {
    const out = [], e = r.ent || {}, g = PX.limpiarGrav ? PX.limpiarGrav(r.grav) : PX.norm(r.grav);
    const add = (n, t, d) => out.push({ n, t, d });
    if (r.isPlano) add(1, 'Plano consultado, sin edicto', 'Los riesgos del proceso judicial se evalúan solo para lotes en remate.');
    if (r.der && r.der !== '000' && r.der !== '0') add(3, 'Se remata un derecho, no la finca completa', `Se adquiere el derecho ${r.der}: se comparte la propiedad con otras personas y no se puede ocupar ni vender un área específica sin acuerdo o un proceso de división.`);
    if (!r.isPlano && !r.exact) add(3, 'Ubicación no confirmada en el catastro', 'No se encontró el predio por plano ni por finca. Antes de ofertar hay que identificarlo en el Registro y en el sitio.');
    if (r.rev) add(3, 'El catastro no coincide con el edicto', r.rev);
    if (e.costa != null && e.costa <= 250) add(3, 'Posible zona marítimo terrestre', 'A menos de 250 m de la costa: la zona restringida se da en concesión municipal, no en propiedad.');
    if (r.multi) add(2, 'Varias fincas o derechos en el mismo edicto', 'Puede rematarse en bloque o por separado: confirme en el expediente qué se adjudica con cada oferta.');
    if (r.filial) add(2, 'Filial de condominio', 'Revise el reglamento del condominio y si hay cuotas atrasadas, que suelen pasar al nuevo dueño.');
    if ((r.serv || []).length) add(2, (r.serv.length === 1 ? 'Una servidumbre' : r.serv.length + ' servidumbres') + ' inscritas', 'Limitan el uso de una parte del terreno. Ubíquelas en el plano antes de calcular lo que se puede construir.');
    if (/hipotec/.test(g)) add(2, 'Hipoteca citada', 'Confirme en el expediente cuáles gravámenes se cancelan con el remate y cuáles subsisten.');
    if (/anotaci|demanda/.test(g)) add(2, 'Anotaciones o demandas', 'Un proceso anotado puede afectar al adjudicatario. Pida la certificación literal.');
    if (/usufruct/.test(g)) add(3, 'Usufructo', 'Otra persona puede tener derecho a usar el inmueble aunque usted lo compre.');
    if (r.tipo === 'Con construcción' || (r.tg || []).includes('constr')) add(2, 'Inmueble con construcción: posible ocupación', 'Si hay personas habitándolo, la entrega puede requerir un desalojo. Visite el sitio y revise el expediente.');
    if (r.area && r.areaCat && Math.abs(r.areaCat - r.area) / r.area > 0.1) add(2, 'Área del catastro diferente a la del edicto', `Diferencia de ${Math.round((r.areaCat - r.area) / r.area * 100)} %. Puede requerir un nuevo plano o rectificación de medida.`);
    if (e.agua != null && e.agua <= 50) add(2, 'Cauce cercano', `Hay un río o quebrada a ${PX.dist(e.agua)}. La franja de protección (10 a 50 m) no se puede construir.`);
    if (e.pend != null && e.pend >= 30) add(2, 'Pendiente fuerte', `Pendiente aproximada de ${e.pend} %: más costo de movimiento de tierras y posibles restricciones.`);
    if (e.cob === 'Cobertura forestal') add(2, 'Cobertura forestal', 'El cambio de uso de suelo en bosque está prohibido por la Ley Forestal.');
    if (e.prot) add(2, 'Franja de protección de ríos', 'El predio toca una franja de protección (delimitación no oficial).');
    if (e.psa) add(1, 'Contrato de pago por servicios ambientales', 'Si el contrato está vigente, trae compromisos de conservación.');
    if (e.pr && !e.pr.si) { add(1, 'Cantón sin plan regulador vigente', 'Rige la normativa nacional del INVU (lote mínimo 90 a 120 m², frente mínimo 6 m). Pida el certificado de uso de suelo a la municipalidad.'); const nv = P.normativa(r); if (nv.dims && (nv.dims.corto < P.NAC.frenteMin || nv.dims.rel > P.NAC.fondoMax)) add(2, 'Forma del lote fuera de la norma nacional', nv.alertas[0]); }
    if (!r.isPlano && (r.tg || []).includes('frente') && /servidumbre/.test(g)) add(2, 'Acceso a confirmar', 'El edicto menciona servidumbre: verifique que la calle del frente esté en el inventario de caminos de la municipalidad y no sea una servidumbre.');
    if (r.st === 2) add(1, 'Tercer remate', 'La base es el 25 %: suele haber más competencia y es la última oportunidad del proceso.');
    if (r.next && PX.days(r.next) <= 7) add(1, 'Poco tiempo para estudiar', `El remate es ${PX.when(r.next)}.`);
    out.sort((a, b) => b.n - a.n);
    return out;
  };
  // ---------- Potencialidades (lo que juega a favor) ----------
  P.potencialidades = r => {
    const out = [], e = r.ent || {}, sc = PX.score(r), add = (w, t, d) => out.push({ w, t, d });
    if (sc.precio != null && sc.precio >= 60 && r.usdm2) { const med = PX.medFor(r); add(9, 'Precio por m² bajo la zona', `${Math.round((1 - r.usdm2 / med.v) * 100)} % por debajo de la mediana de remates en ${med.ref}.`); }
    if (r.st === 1) add(7, 'Segundo remate', 'La base bajó al 75 % de la original.');
    if (r.st === 2) add(8, 'Tercer remate', 'La base es el 25 % de la original.');
    if ((r.tg || []).includes('frente') || (e.via && e.via.d <= 10)) add(8, 'Frente a vía', e.via ? `${e.via.t} al frente del predio.` : 'El edicto o la cartografía indican frente a calle.');
    if (e.pr && e.pr.si) add(7, 'Plan regulador vigente', `Reglas urbanísticas definidas desde ${e.pr.anno || 'hace años'}; trámites más previsibles.`);
    if (e.cob === 'Zona urbana' || (r.tg || []).includes('urbano')) add(7, 'Entorno urbano', 'La cobertura 2020 la clasifica como zona urbana: servicios y demanda cercanos.');
    if (e.salud && e.salud.d <= 2000) add(5, 'Salud cerca', `${e.salud.n} a ${PX.dist(e.salud.d)}.`);
    if (e.esc != null && e.esc <= 1000) add(5, 'Escuela cerca', `A ${PX.dist(e.esc)}.`);
    if (e.suave || (e.pend != null && e.pend < 10)) add(6, 'Terreno plano o de pendiente suave', e.pend != null ? `Pendiente aproximada de ${e.pend} %.` : 'Pocas curvas de nivel alrededor.');
    if ((r.exact || r.isPlano) && e.agua === null) add(5, 'Sin cauces cercanos', 'Ningún río o quebrada a menos de 400 m en la cartografía 1:5 000.');
    if (!r.isPlano && !(r.serv || []).length && sc.juridica >= 90) add(8, 'Situación registral limpia', 'Sin servidumbres ni cargas relevantes citadas en el edicto.');
    if (r.exact && !r.isPlano) add(4, 'Ubicación confirmada', `El catastro ubicó el predio por ${r.loc}.`);
    const pot = P.potCalc(P.potDefaults(r));
    if (PX.prof(r) >= 1000) add(6, 'Área amplia', `${fnum(PX.prof(r))} m²${pot.lotes >= 2 ? `: podría segregarse en unos ${pot.lotes} lotes` : ''}; cabrían unas ${pot.unidades} unidades de vivienda (supuestos generales).`);
    else if (pot.total > 0) add(3, 'Potencial constructivo', `Alrededor de ${fnum(pot.total, 0)} m² construibles con supuestos generales.`);
    return out.sort((a, b) => b.w - a.w);
  };
  P.CHECK = ['Certificación literal de la finca en el Registro Nacional', 'Plano catastrado y su ubicación en el sitio', 'Revisión del expediente judicial: condiciones, depósito y suspensiones', 'Certificado de uso de suelo en la municipalidad', 'Visita al sitio: accesos, ocupantes y servicios', 'Deudas municipales y, si es filial, cuotas de condominio'];

  // ---------- Potencial constructivo ----------
  // ---------- Dimensiones aproximadas del predio (rectángulo mínimo que lo contiene) ----------
  P.dims = r => {
    if (!r.poly) return null;
    const ring = r.poly.reduce((a, p) => p[0].length > a.length ? p[0] : a, []), lat0 = ring[0][1] * Math.PI / 180;
    const pts = ring.map(([x, y]) => [x * 111320 * Math.cos(lat0), y * 110574]);
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], L = Math.hypot(dx, dy); if (L < 0.5) continue;
      const ux = dx / L, uy = dy / L; let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, y] of pts) { const a = x * ux + y * uy, b = -x * uy + y * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
      const w = a1 - a0, h = b1 - b0; if (!best || w * h < best.w * best.h) best = { w, h };
    }
    if (!best) return null;
    const corto = Math.min(best.w, best.h), largo = Math.max(best.w, best.h);
    return { corto, largo, rel: largo / Math.max(corto, 0.1) };
  };

  // ---------- Normativa aplicable ----------
  // Con plan regulador vigente rige el plan del cantón. Sin plan vigente rigen supletoriamente los reglamentos nacionales del INVU:
  // Reglamento de Fraccionamiento y Urbanizaciones (RFU, actualización 2019 y reforma 2020) y Reglamento de Construcciones (2018).
  P.NAC = {
    loteMin: 90, loteMinSin: 120, frenteMin: 6, fondoMax: 7,
    serv: { ancho: 6, largo: 60, lotes: 6 },
    agro: 5000, agroGAM: 7000,
    fuente: 'INVU: Reglamento de Fraccionamiento y Urbanizaciones (arts. 15, 16, 20, 25 y 30) y Reglamento de Construcciones (2018)'
  };
  P.normativa = r => {
    const e = r.ent || {}, pr = e.pr, vig = !!(pr && pr.si), d = P.dims(r), a = PX.prof(r) || 0, N = P.NAC;
    const urb = (r.tg || []).includes('urbano') || e.cob === 'Zona urbana';
    const out = { vigente: vig, parcial: vig && pr.escala === 'Parcial', reglas: [], alertas: [], dims: d };
    if (vig) {
      out.titulo = `Plan regulador de ${pr.canton || r.cn || 'el cantón'}${pr.anno ? ' (' + pr.anno + ')' : ''}`;
      out.texto = 'Rigen la zonificación, los usos, la cobertura, la altura, los retiros y el lote mínimo del plan regulador. Confírmelos con el certificado de uso de suelo de la municipalidad.' + (out.parcial ? ' El plan cubre solo parte del cantón: si el lote queda fuera de su área, aplica la normativa nacional del INVU.' : '');
      out.loteMin = urb ? 200 : 1000; out.supuesto = true;
    } else {
      out.titulo = 'Normativa nacional del INVU (aplicación supletoria)';
      out.texto = 'El cantón no tiene plan regulador vigente, así que rigen los reglamentos nacionales del INVU. Igual se requiere el certificado de uso de suelo municipal.';
      out.loteMin = N.loteMinSin; out.supuesto = false;
      out.reglas.push(['Lote mínimo', `${N.loteMin} m² con alcantarillado sanitario o planta de tratamiento; ${N.loteMinSin} m² con tanque séptico`]);
      out.reglas.push(['Frente mínimo', `${N.frenteMin} m a calle pública`]);
      out.reglas.push(['Fondo máximo', `${N.fondoMax} veces el frente`]);
      out.reglas.push(['Acceso por servidumbre', `${N.serv.ancho} m de ancho, hasta ${N.serv.largo} m de largo y ${N.serv.lotes} lotes como máximo (solo en cuadrantes urbanos y sus áreas de expansión)`]);
      out.reglas.push(['Parcelas agropecuarias', `${fnum(N.agro)} m² como mínimo (${fnum(N.agroGAM)} m² dentro de la GAM), con estudio de capacidad de uso`]);
      if (d && d.corto < N.frenteMin) out.alertas.push(`El lado corto mide unos ${fnum(d.corto, 1)} m: menos que el frente mínimo de ${N.frenteMin} m.`);
      if (d && d.rel > N.fondoMax) out.alertas.push(`La relación fondo/frente es de 1:${fnum(d.rel, 1)}: supera el máximo de 1:${N.fondoMax}.`);
      if (a && a < N.loteMin) out.alertas.push(`El área (${fnum(a)} m²) es menor que el lote mínimo nacional de ${N.loteMin} m².`);
      if (Math.floor(a * 0.8 / N.loteMinSin) >= 2) out.alertas.push(`Por área podría segregarse en unos ${Math.floor(a * 0.8 / N.loteMinSin)} lotes de ${N.loteMinSin} m² si cumple frente a calle pública (o hasta ${N.serv.lotes} con servidumbre).`);
    }
    // Protección de cauces y costa (Ley Forestal art. 33 y Ley de la Zona Marítimo Terrestre)
    if (e.agua != null && e.agua <= 50) out.alertas.push(`Cauce a ${PX.dist(e.agua)}: la Ley Forestal (art. 33) protege 10 m en zona urbana y 15 m en zona rural si el terreno es plano, y 50 m si es quebrado.`);
    if (e.costa != null && e.costa <= 250) out.alertas.push('Cerca de la costa: los primeros 50 m son zona pública y los 150 m siguientes zona restringida (Ley 6043), en concesión y no en propiedad.');
    return out;
  };

  P.potDefaults = r => {
    const urb = (r.tg || []).includes('urbano') || (r.ent && r.ent.cob === 'Zona urbana');
    return { area: Math.round(PX.prof(r) || 0), cob: urb ? 70 : 50, pisos: urb ? 3 : 2, util: 90, unidad: 90, circ: 15, loteMin: P.normativa(r).loteMin };
  };
  P.potCalc = v => {
    const huella = v.area * v.util / 100 * v.cob / 100;
    const total = huella * v.pisos;
    const unidades = v.unidad > 0 ? Math.floor(total * (1 - v.circ / 100) / v.unidad) : 0;
    const lotes = v.loteMin > 0 ? Math.max(0, Math.floor(v.area * 0.8 / v.loteMin)) : 0;
    return { huella, total, unidades, lotes, cus: v.area ? total / v.area : 0 };
  };

  // ---------- Prefactibilidad ----------
  const crcTo = v => PX.conv(v, 'CRC', PX.cur);
  P.prefDefaults = r => {
    const urb = (r.tg || []).includes('urbano') || (r.ent && r.ent.cob === 'Zona urbana');
    const pot = P.potCalc(P.potDefaults(r));
    const med = r.isPlano || !r.prov ? null : PX.medFor(r);
    const ref = med && PX.prof(r) ? PX.conv(med.v * PX.prof(r), 'USD', PX.cur) : null;
    return {
      modo: 'reventa',
      oferta: r.bv ? Math.round(PX.conv(r.bv, r.mon, PX.cur)) : Math.round(ref || 0),
      traspaso: 1.5, timbres: 0.9, legal: 2, otros: 0,
      ref: ref ? Math.round(ref) : 0, meses: 12, comision: 5,
      m2: Math.round(pot.total), costo: Math.round(crcTo(urb ? 480000 : 400000)), venta: Math.round(crcTo(urb ? 950000 : 700000))
    };
  };
  P.prefCalc = v => {
    const gastos = v.oferta * (v.traspaso + v.timbres + v.legal) / 100 + v.otros;
    const terreno = v.oferta + gastos;
    if (v.modo === 'reventa') {
      const ingreso = v.ref * (1 - v.comision / 100);
      const util = ingreso - terreno;
      return { gastos, terreno, obra: 0, inversion: terreno, ingreso, util, margen: ingreso ? util / ingreso : 0, roi: terreno ? util / terreno : 0, anual: terreno && v.meses ? Math.pow(1 + util / terreno, 12 / v.meses) - 1 : 0, equilibrio: terreno / (1 - v.comision / 100) };
    }
    const obra = v.m2 * v.costo * 1.12; // +12 % de indirectos, permisos y diseño
    const inversion = terreno + obra;
    const ingreso = v.m2 * v.venta * (1 - v.comision / 100);
    const util = ingreso - inversion;
    return { gastos, terreno, obra, inversion, ingreso, util, margen: ingreso ? util / ingreso : 0, roi: inversion ? util / inversion : 0, anual: inversion && v.meses ? Math.pow(Math.max(0, 1 + util / inversion), 12 / v.meses) - 1 : 0, equilibrio: v.m2 ? inversion / v.m2 / (1 - v.comision / 100) : 0 };
  };

  // ---------- Alertas (demostración, en este navegador) ----------
  P.alertas = () => PX.acct.alertas || (PX.acct.alertas = { canal: { correo: true, whatsapp: false }, dias: 3, etapa: true, nuevos: true, zona: '' });

  // ---------- Vista de cada herramienta ----------
  const pct = v => (v * 100).toLocaleString('es-CR', { maximumFractionDigits: 1 }) + ' %';
  const num = (id, label, val, unit, o) => `<label class="pf"><span>${label}</span><span class="pin">${o && o.pre ? `<span class="u">${o.pre}</span>` : ''}<input type="number" data-v="${id}" value="${val}" step="${(o && o.step) || 'any'}" min="0" inputmode="decimal"${o && o.dis ? ' disabled' : ''}>${unit ? `<span class="sfx">${unit}</span>` : ''}</span></label>`;
  const curU = () => PX.cur === 'USD' ? 'US$' : '₡';
  const M = v => PX.duo(v, PX.cur);
  const I = v => PX.duoI(v, PX.cur);

  function lotSVG(v, c) {
    // Lote cuadrado proporcional, huella centrada y pisos apilados
    const S = 150, side = Math.sqrt(Math.max(1, v.area)), f = Math.sqrt(Math.max(0, c.huella) / Math.max(1, v.area));
    const h = S * f, off = (S - h) / 2, util = Math.sqrt(v.util / 100) * S, uo = (S - util) / 2;
    const fl = Math.min(v.pisos, 12), fh = Math.min(16, 110 / Math.max(1, fl));
    return `<svg viewBox="0 0 330 170" class="potsvg" role="img" aria-label="Esquema del lote y la huella construible">
      <rect x="10" y="10" width="${S}" height="${S}" class="s-lot"/><rect x="${10 + uo}" y="${10 + uo}" width="${util}" height="${util}" class="s-util"/>
      <rect x="${10 + off}" y="${10 + off}" width="${h}" height="${h}" class="s-foot"/>
      <text x="85" y="168" class="s-t" text-anchor="middle">${fnum(side, 0)} × ${fnum(side, 0)} m equivalentes</text>
      ${Array.from({ length: fl }, (_, i) => `<rect x="215" y="${150 - (i + 1) * fh}" width="90" height="${fh - 2}" class="s-floor"/>`).join('')}
      <line x1="200" y1="150" x2="320" y2="150" class="s-ground"/>
      <text x="260" y="168" class="s-t" text-anchor="middle">${v.pisos} piso${v.pisos == 1 ? '' : 's'}</text></svg>`;
  }

  P.view = {
    potencial(r, st) {
      const v = st.pot = st.pot || P.potDefaults(r), c = P.potCalc(v), dis = !PX.isPro();
      const nv = P.normativa(r);
      return `<div class="normbox"><b>${esc(nv.titulo)}</b><span>${esc(nv.texto)}</span>${nv.reglas.length ? `<dl>${nv.reglas.map(([k, t]) => `<dt>${k}</dt><dd>${esc(t)}</dd>`).join('')}</dl>` : ''}${nv.dims ? `<span>Dimensiones aproximadas del predio: <b>${fnum(nv.dims.corto, 1)} × ${fnum(nv.dims.largo, 1)} m</b> (relación 1:${fnum(nv.dims.rel, 1)}).</span>` : ''}${nv.alertas.map(t => `<span class="na">⚠ ${esc(t)}</span>`).join('')}</div>
        <p class="lead">Cobertura y pisos son supuestos editables${nv.vigente ? '; los valores reales los fija el plan regulador' : '; confírmelos con el Reglamento de Construcciones y la municipalidad'}.</p>
        <div class="pgrid"><div class="pform">
          ${num('area', 'Área del lote', v.area, 'm²', { dis })}${num('util', 'Área aprovechable (sin retiros)', v.util, '%', { dis, step: 5 })}
          ${num('cob', 'Cobertura máxima', v.cob, '%', { dis, step: 5 })}${num('pisos', 'Pisos', v.pisos, '', { dis, step: 1 })}
          ${num('unidad', 'Tamaño por unidad', v.unidad, 'm²', { dis, step: 5 })}${num('circ', 'Circulaciones y muros', v.circ, '%', { dis, step: 5 })}
          ${num('loteMin', 'Lote mínimo para segregar', v.loteMin, 'm²', { dis, step: 10 })}</div>
        <div class="pres"><div class="pkpi"><div><small>Huella construible</small><b class="num">${fnum(c.huella, 0)} <span class="u">m²</span></b></div><div><small>Área total construible</small><b class="num">${fnum(c.total, 0)} <span class="u">m²</span></b></div>
          <div><small>Unidades de ${v.unidad} m²</small><b class="num">${c.unidades}</b></div><div><small>Lotes si se segrega</small><b class="num">${c.lotes}</b></div></div>
          ${lotSVG(v, c)}<div class="foot">Coeficiente de aprovechamiento ≈ ${fnum(c.cus, 2)}. La segregación reserva 20 % para vías y áreas públicas.</div></div></div>`;
    },
    prefa(r, st) {
      const v = st.pref = st.pref || P.prefDefaults(r);
      if (st.pot && !v.m2Edit) v.m2 = Math.round(P.potCalc(st.pot).total); // el área a construir sigue al potencial constructivo
      const c = P.prefCalc(v), dis = !PX.isPro(), U = curU();
      const bars = [['Terreno y gastos', c.terreno, 'var(--s1)'], ['Obra', c.obra, 'var(--s2)'], ['Ingreso neto', c.ingreso, 'var(--accent)']].filter(b => b[1] > 0);
      const mx = Math.max(...bars.map(b => b[1]), 1);
      return `<div class="seg" role="group" aria-label="Escenario"><button data-modo="reventa" aria-pressed="${v.modo === 'reventa'}"${dis ? ' disabled' : ''}>Comprar y revender el terreno</button><button data-modo="desarrollo" aria-pressed="${v.modo === 'desarrollo'}"${dis ? ' disabled' : ''}>Desarrollar y vender</button></div>
        <div class="pgrid"><div class="pform">
          <div class="lbl">Compra en remate</div>
          ${num('oferta', 'Oferta', v.oferta, '', { dis, pre: U })}${num('traspaso', 'Impuesto de traspaso', v.traspaso, '%', { dis, step: 0.1 })}
          ${num('timbres', 'Timbres y registro', v.timbres, '%', { dis, step: 0.1 })}${num('legal', 'Honorarios legales', v.legal, '%', { dis, step: 0.5 })}
          ${num('otros', 'Deudas, desalojo u otros', v.otros, '', { dis, pre: U })}
          <div class="lbl">${v.modo === 'reventa' ? 'Venta del terreno' : 'Desarrollo'}</div>
          ${v.modo === 'reventa' ? num('ref', 'Precio de venta esperado', v.ref, '', { dis, pre: U }) : num('m2', 'Área a construir', v.m2, 'm²', { dis, step: 10 }) + (v.m2Edit ? '' : '<small class="muted">Tomada del potencial constructivo</small>') + num('costo', 'Costo de obra por m²', v.costo, '', { dis, pre: U }) + num('venta', 'Venta por m² construido', v.venta, '', { dis, pre: U })}
          ${num('comision', 'Comisión de venta', v.comision, '%', { dis, step: 0.5 })}${num('meses', 'Plazo total', v.meses, 'meses', { dis, step: 1 })}</div>
        <div class="pres"><div class="pkpi"><div><small>Inversión total</small><b>${M(c.inversion, true)}</b></div><div><small>Ingreso neto</small><b>${M(c.ingreso, true)}</b></div>
          <div class="${c.util >= 0 ? 'good' : 'bad'}"><small>Utilidad</small><b>${M(c.util, true)}</b></div><div><small>Margen sobre ventas</small><b class="num">${pct(c.margen)}</b></div>
          <div><small>Retorno sobre inversión</small><b class="num">${pct(c.roi)}</b></div><div><small>Rendimiento anualizado</small><b class="num">${pct(c.anual)}</b></div></div>
          <div class="wf">${bars.map(b => `<div class="wfr"><span>${b[0]}</span><span class="track"><i style="width:${b[1] / mx * 100}%;background:${b[2]}"></i></span><b>${M(b[1], true)}</b></div>`).join('')}</div>
          <div class="foot">${v.modo === 'reventa' ? `Punto de equilibrio: vender en ${I(c.equilibrio, true)} o más.${v.ref && !r.isPlano ? ' El precio de venta parte de la mediana de remates del cantón por el área: ajústelo con su conocimiento del mercado.' : ''}` : `Punto de equilibrio: ${I(c.equilibrio)} por m² construido. La obra incluye 12 % de indirectos, diseño y permisos.`} Gastos de adjudicación aproximados: ${I(c.gastos, true)}.</div></div></div>`;
    },
    riesgos(r) {
      const rs = P.riesgos(r), lv = ['', 'Información', 'Medio', 'Alto'];
      const cnt = [3, 2, 1].map(n => rs.filter(x => x.n === n).length);
      return `<div class="sem"><span class="s3"><b class="num">${cnt[0]}</b> altos</span><span class="s2"><b class="num">${cnt[1]}</b> medios</span><span class="s1"><b class="num">${cnt[2]}</b> informativos</span></div>
        <div class="rlist">${rs.length ? rs.map(x => `<div class="rk r${x.n}"><i></i><div><b>${esc(x.t)}</b><span class="tag">${lv[x.n]}</span><p>${esc(x.d)}</p></div></div>`).join('') : '<p>No se detectaron riesgos en los datos disponibles.</p>'}</div>
        <div class="lbl" style="margin-top:6px">Antes de ofertar</div><ul class="chk">${P.CHECK.map(t => `<li><label><input type="checkbox"${PX.isPro() ? '' : ' disabled'}> ${t}</label></li>`).join('')}</ul>
        <div class="foot">Detección automática a partir del edicto y de capas públicas. No es asesoría legal.</div>`;
    },
    alertas(r) {
      const a = P.alertas(), dis = !PX.isPro() ? ' disabled' : '', sig = r && !r.isPlano ? PX.sigo(r.key) : false;
      return `<p class="lead">Recibe avisos sin entrar al sitio. ${r && !r.isPlano ? `Este lote ${sig ? '<b>está en tu seguimiento</b>' : 'no está en tu seguimiento todavía'}.` : ''}</p>
        <div class="pform" style="max-width:520px">
          <div class="lbl">Canales</div>
          <label class="ck"><input type="checkbox" data-al="correo"${a.canal.correo ? ' checked' : ''}${dis}> Correo electrónico</label>
          <label class="ck"><input type="checkbox" data-al="whatsapp"${a.canal.whatsapp ? ' checked' : ''}${dis}> WhatsApp</label>
          <div class="lbl">Avisarme cuando</div>
          <label class="ck"><input type="checkbox" data-al="etapa"${a.etapa ? ' checked' : ''}${dis}> Un lote que sigo cambie de etapa, se suspenda o se reprograme</label>
          <label class="ck"><input type="checkbox" data-al="nuevos"${a.nuevos ? ' checked' : ''}${dis}> Salgan remates nuevos que cumplan mis búsquedas guardadas</label>
          ${num('dias', 'Recordatorio antes del remate', a.dias, 'días', { dis: !!dis, step: 1 })}
          ${r && !r.isPlano ? `<button class="btn sm${sig ? '' : ' primary'}" data-sig${dis}>${sig ? 'Dejar de seguir este lote' : 'Seguir este lote'}</button>` : ''}
        </div>
        <div class="demo">Vista previa: el envío de correos y WhatsApp se conecta en la siguiente fase, junto con el robot diario que lee el Boletín Judicial.</div>`;
    }
  };

  // ---------- Espacio de trabajo PRO (ventana) ----------
  const states = {};
  P.open = (r, tool, layer, hooks) => {
    const st = states[r.key] = states[r.key] || {};
    let cur = tool || 'potencial';
    const tools = P.TOOLS.filter(t => P.view[t.k]);
    function paint() {
      const pro = PX.isPro();
      layer.innerHTML = `<div class="scrim"><div class="dlg prows" role="dialog" aria-modal="true" aria-label="Herramientas PRO">
        <div class="hd">${PX.PRO}<h2>Herramientas PRO</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
        <div class="prolot"><b>${esc(r.nom)}</b><span class="muted">${esc(r.lugar || '')}${r.bv ? ' · base ' + PX.duoT(r.bv, r.mon) : ''}${PX.prof(r) ? ' · ' + fnum(PX.prof(r)) + ' m²' : ''}</span></div>
        ${pro ? '' : `<div class="probar">${PX.PRO}<span>Estás viendo una <b>vista previa</b>. Con la suscripción PRO editas los supuestos y ves todos los resultados.</span><button class="btn sm primary" data-sub>Activar PRO</button></div>`}
        <div class="pnav" role="tablist">${tools.map(t => `<button role="tab" data-tool="${t.k}" aria-selected="${t.k === cur}">${t.n}</button>`).join('')}</div>
        <div class="pbody${pro ? '' : ' preview'}" data-tool-body>${P.view[cur](r, st)}</div>
        <div class="foot">Herramienta PRO de PlanoExactoCR. Resultados orientativos: no son un avalúo, un certificado de uso de suelo ni asesoría legal o financiera.</div>
      </div></div>`;
    }
    paint();
    function refresh() { const b = layer.querySelector('[data-tool-body]'); if (b) b.innerHTML = P.view[cur](r, st); }
    function bind() {
      const root2 = layer.firstElementChild; if (!root2 || root2._b) return; root2._b = 1;
      root2.addEventListener('click', e => {
        const t = e.target.closest('[data-tool]'); if (t) { cur = t.dataset.tool; paint(); bind(); return; }
        const m = e.target.closest('[data-modo]'); if (m && PX.isPro()) { st.pref.modo = m.dataset.modo; refresh(); return; }
        if (e.target.closest('[data-sig]') && PX.isPro()) { PX.toggleSigo(r.key); refresh(); if (hooks && hooks.changed) hooks.changed(); }
      });
      root2.addEventListener('change', e => {
        const k = e.target.dataset.al; if (k == null || !PX.isPro()) return;
        const a = P.alertas(); if (k === 'correo' || k === 'whatsapp') a.canal[k] = e.target.checked; else a[k] = e.target.checked; PX.saveAcct();
      });
      root2.addEventListener('input', e => {
        const k = e.target.dataset.v; if (!k || !PX.isPro()) return;
        const v = parseFloat(e.target.value); if (isNaN(v)) return;
        if (cur === 'potencial') st.pot[k] = v; else if (cur === 'prefa') { st.pref[k] = v; if (k === 'm2') st.pref.m2Edit = true; } else if (cur === 'alertas' && k === 'dias') { P.alertas().dias = v; PX.store.set('px-acct', PX.acct); return; }
        const pos = e.target.selectionStart; refresh();
        const el = layer.querySelector(`[data-v="${k}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (er) {} }
      });
    }
    bind();
  };
})();
