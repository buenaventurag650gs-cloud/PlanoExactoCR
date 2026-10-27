/* PlanoExactoCR — herramientas de la versión PRO: potencial constructivo, prefactibilidad, riesgos del proceso y alertas.
   Todas se muestran con la marca PRO. Sin suscripción se ven como vista previa: datos difuminados y controles bloqueados. */
(function () {
  'use strict';
  const { esc, fnum } = PX;
  const P = PX.pro = {};
  PX.PRO = '<span class="pro" title="Herramienta de la versión PRO">PRO</span>';
  PX.ESE = '<span class="ese" title="Incluido desde el plan Esencial">Esencial</span>';

  // Catálogo de herramientas (las disponibles y las que vienen)
  // nv: plan desde el que se usa la herramienta completa (2 Esencial, 3 PRO)
  P.TOOLS = [
    { k: 'valor', n: 'Valor de referencia', q: 'Terreno según la zona homogénea de Hacienda y construcción por tipología, frente a la base', st: 'ok', nv: 3 },
    { k: 'potencial', n: 'Potencial constructivo', q: '¿Cuántos m² y unidades caben en el lote?', st: 'ok', nv: 3 },
    { k: 'prefa', n: 'Prefactibilidad financiera', q: '¿Cuánto invierto, cuánto podría valer y qué margen deja?', st: 'ok', nv: 3 },
    { k: 'riesgos', n: 'Riesgos del proceso', q: '¿Qué puede salir mal y qué revisar antes de ofertar?', st: 'ok', nv: 2 },
    { k: 'alertas', n: 'Alertas del remate', q: 'Avisos de cambio de etapa, nuevos edictos y fechas próximas', st: 'ok', nv: 2 },
    { k: 'precios', n: 'Mapa de precios por m²', q: 'Mediana de las bases de remate por cantón, en el mapa', st: 'ok', map: true, nv: 3 },
    { k: 'top', n: 'Top 10 del mes', q: 'Los mejores remates por provincia según el índice', st: 'ok', list: true, nv: 3 },
    { k: 'normativa', n: 'Normativa urbana del lote', q: 'Zona del plan regulador, usos, cobertura, altura y lote mínimo', st: 'soon', nv: 2 },
    { k: 'amenazas', n: 'Amenazas naturales (CNE)', q: 'Inundación, deslizamiento y amenaza sísmica en el lote', st: 'soon', nv: 3 },
    { k: 'historia', n: 'Historia del sitio', q: 'Ortofotos del IGN de distintos años y cambio de cobertura', st: 'soon', nv: 3 }
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
    { const z = e.zh, a2 = PX.prof(r); if (z && z.v && a2 && r.bv && r.tipo !== 'Con construcción') { const ratio = PX.conv(r.bv, r.mon, 'CRC') / (z.v * a2); if (ratio < 0.85) add(9, 'Base bajo el valor de Hacienda', `La base equivale al ${Math.round(ratio * 100)} % del valor del terreno según la zona homogénea (${PX.duoT(z.v, 'CRC', '/m²')}).`); } }
    if (e.aguaS && e.aguaS.length) add(6, 'Zona con servicio de agua', `Dentro del área de cobertura de ${e.aguaS.join(', ')} (AyA).`);
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
      return { gastos, terreno, obra: 0, inversion: terreno, ingreso, util, margen: ingreso ? util / ingreso : 0, roi: terreno ? util / terreno : 0, anual: terreno && v.meses ? Math.pow(Math.max(0, 1 + util / terreno), 12 / v.meses) - 1 : 0, equilibrio: terreno / (1 - v.comision / 100) };
    }
    const obra = v.m2 * v.costo * 1.12; // +12 % de indirectos, permisos y diseño
    const inversion = terreno + obra;
    const ingreso = v.m2 * v.venta * (1 - v.comision / 100);
    const util = ingreso - inversion;
    return { gastos, terreno, obra, inversion, ingreso, util, margen: ingreso ? util / ingreso : 0, roi: inversion ? util / inversion : 0, anual: inversion && v.meses ? Math.pow(Math.max(0, 1 + util / inversion), 12 / v.meses) - 1 : 0, equilibrio: v.m2 ? inversion / v.m2 / (1 - v.comision / 100) : 0 };
  };

  // ---------- Valor de referencia ----------
  P.valDefaults = r => PX.valDefaults(r);
  P.valCalc = (r, v) => {
    const c = PX.valorRef(v), base = r.bv ? PX.conv(r.bv, r.mon, 'CRC') : null;
    return Object.assign(c, { base, ratio: base && c.total ? base / c.total : null });
  };

  // ---------- Alertas (demostración, en este navegador) ----------
  P.alertas = () => PX.acct.alertas || (PX.acct.alertas = { canal: { correo: true, whatsapp: false }, dias: 3, etapa: true, nuevos: true, zona: '' });

  // ---------- Vista de cada herramienta (componentes de Tabler) ----------
  const pct = v => (isFinite(v) ? v * 100 : 0).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %';
  // Campos numéricos con separador de miles (punto) y decimales con coma, como se escriben en Costa Rica
  const fmtIn = v => v == null || v === '' || isNaN(v) ? '' : Number(v).toLocaleString('de-DE', { maximumFractionDigits: 2 });
  const parseIn = s => { const t = String(s).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''); return t === '' ? NaN : parseFloat(t); };
  const num = (id, label, val, unit, o = {}) => `<div class="row g-2 align-items-center mb-2">
      <label class="col-6 col-form-label py-0" for="pv-${id}">${label}${o.hint ? `<small class="form-hint mt-0">${o.hint}</small>` : ''}</label>
      <div class="col-6"><div class="input-group">${o.pre ? `<span class="input-group-text">${o.pre}</span>` : ''}<input id="pv-${id}" type="text" inputmode="decimal" autocomplete="off" class="form-control text-end" data-v="${id}" value="${fmtIn(val)}"${o.dis ? ' disabled' : ''}>${unit ? `<span class="input-group-text">${unit}</span>` : ''}</div></div></div>`;
  const grupo = t => `<div class="subheader mt-3 mb-2">${t}</div>`;
  const curU = () => PX.cur === 'USD' ? '$' : '₡';
  const T = v => PX.mt(Math.round(v), PX.cur);                 // monto en texto, moneda elegida
  const kpi = (t, v, sub, cls = '') => `<div class="col-6"><div class="card card-sm h-100"><div class="card-body"><div class="subheader">${t}</div><div class="h2 mb-1 ${cls}">${v}</div>${sub ? `<div class="text-secondary small">${sub}</div>` : ''}</div></div></div>`;

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

  // Resultados (se recalculan al escribir, sin tocar el formulario)
  P.res = {
    potencial(r, st) {
      const v = st.pot, c = P.potCalc(v);
      return `<div class="row g-2 mb-3">
          ${kpi('Huella construible', `${fnum(c.huella, 0)} m²`, `${fnum(v.area, 0)} m² × ${fnum(v.util)} % aprovechable × ${fnum(v.cob)} % de cobertura`)}
          ${kpi('Área total construible', `${fnum(c.total, 0)} m²`, `Huella × ${fnum(v.pisos)} piso${v.pisos == 1 ? '' : 's'}`)}
          ${kpi(`Unidades de ${fnum(v.unidad)} m²`, fnum(c.unidades, 0), `Área total menos ${fnum(v.circ)} % de circulaciones y muros, dividida entre ${fnum(v.unidad)} m²`)}
          ${kpi('Lotes si se segrega', fnum(c.lotes, 0), `80 % del área (el resto va a vías y áreas públicas) dividido entre ${fnum(v.loteMin)} m²`)}
        </div>
        <div class="card card-sm"><div class="card-body text-center">${lotSVG(v, c)}<div class="text-secondary small mt-1">Coeficiente de aprovechamiento ≈ ${fnum(c.cus, 2)}: se construyen ${fnum(c.cus, 2)} m² por cada m² de lote.</div></div></div>`;
    },
    prefa(r, st) {
      const v = st.pref, c = P.prefCalc(v), rev = v.modo === 'reventa', gana = c.util >= 0, U = curU();
      const ventas = rev ? v.ref : v.m2 * v.venta, com = ventas * v.comision / 100;
      const fila = (signo, t, sub, x, total) => `<tr${total ? ' class="fw-bold"' : ''}><td class="w-1 text-secondary">${signo}</td><td>${t}${sub ? `<div class="small text-secondary fw-normal">${sub}</div>` : ''}</td><td class="text-end text-nowrap">${T(x)}</td></tr>`;
      const tabla = `<div class="card card-sm mb-3"><div class="card-header"><h3 class="card-title">Cómo se calcula</h3></div>
        <div class="table-responsive"><table class="table table-vcenter card-table mb-0"><tbody>
          ${fila('', 'Oferta en el remate', '', v.oferta)}
          ${fila('+', 'Gastos de adjudicación', `Traspaso ${fnum(v.traspaso)} %, timbres ${fnum(v.timbres)} % y honorarios ${fnum(v.legal)} % sobre la oferta${v.otros ? `, más ${T(v.otros)} de deudas u otros` : ''}`, c.gastos)}
          ${rev ? '' : fila('+', 'Construcción', `${fnum(v.m2, 0)} m² × ${T(v.costo)}, más 12 % de diseño, permisos e indirectos`, c.obra)}
          ${fila('=', 'Inversión total', '', c.inversion, true)}
          ${fila('', rev ? 'Precio de venta del terreno' : 'Ventas', rev ? '' : `${fnum(v.m2, 0)} m² × ${T(v.venta)}`, ventas)}
          ${fila('−', 'Comisión de venta', `${fnum(v.comision)} % del precio de venta`, com)}
          ${fila('=', 'Ingreso neto', '', c.ingreso, true)}
          <tr class="fw-bold ${gana ? 'text-green' : 'text-red'}"><td class="w-1">=</td><td>${gana ? 'Ganancia' : 'Pérdida'}<div class="small text-secondary fw-normal">Ingreso neto menos inversión total</div></td><td class="text-end text-nowrap">${T(Math.abs(c.util))}</td></tr>
        </tbody></table></div></div>`;
      const cien = x => `${U}${fnum(Math.abs(x * 100), 0)}`;
      return `<div class="alert alert-${gana ? 'success' : 'danger'} mb-3"><div>
          <h4 class="alert-title">Con estos supuestos ${gana ? 'ganarías' : 'perderías'} ${T(Math.abs(c.util))}</h4>
          <div class="text-secondary">${rev ? `Para no perder, el terreno tendría que venderse en <b>${T(c.equilibrio)}</b> o más.` : `Para no perder, cada m² construido tendría que venderse en <b>${T(c.equilibrio)}</b> o más.`}</div></div></div>
        ${tabla}
        <div class="row g-2">
          ${kpi('Retorno sobre lo invertido', pct(c.roi), `Por cada ${U}100 invertidos, ${gana ? 'ganas' : 'pierdes'} ${cien(c.roi)}.`, gana ? 'text-green' : 'text-red')}
          ${kpi('Margen sobre la venta', pct(c.margen), `De cada ${U}100 de ingreso neto, ${gana ? 'te quedan' : 'pierdes'} ${cien(c.margen)}.`, gana ? 'text-green' : 'text-red')}
          ${gana && v.meses != 12 ? kpi('Rendimiento por año', pct(c.anual), `El retorno llevado a 12 meses (el plazo es de ${fnum(v.meses)} meses).`) : ''}
        </div>`;
    },
    valor(r, st) {
      const c = P.valCalc(r, st.val), M2 = x => PX.duo(x, 'CRC');
      return `<div class="row g-2 mb-3">
          ${kpi('Terreno', M2(c.terreno), `${fnum(st.val.area, 0)} m² × ${PX.mt(st.val.zh, 'CRC')} por m²`)}
          ${kpi('Construcción depreciada', M2(c.vnr), `Reposición nueva ${PX.mt(Math.round(c.vrn), 'CRC')} × factor de edad y estado ${fnum(c.fd, 3)}`)}
          ${kpi('Valor de referencia', M2(c.total), 'Terreno más construcción')}
          ${c.base ? kpi('Base vigente frente a referencia', `${Math.round(c.ratio * 100)} %`, `La base (${PX.mt(Math.round(c.base), 'CRC')}) es ${c.ratio < 1 ? 'menor' : 'mayor'} que el valor de referencia.`, c.ratio < 1 ? 'text-green' : 'text-red') : ''}
        </div>
        <div class="text-secondary small">Tipología ${esc(c.tip[0])}: ${PX.mt(c.tip[2], 'CRC')} por m², vida útil ${c.tip[3]} años. Referencia orientativa, no es un avalúo.</div>`;
    }
  };

  P.view = {
    potencial(r, st) {
      const v = st.pot = st.pot || P.potDefaults(r), dis = !PX.isPro(), nv = P.normativa(r);
      return `<div class="card card-sm mb-3"><div class="card-header"><h3 class="card-title">${esc(nv.titulo)}</h3></div><div class="card-body">
          <p class="text-secondary">${esc(nv.texto)}</p>
          ${nv.reglas.length ? `<div class="datagrid mb-2">${nv.reglas.map(([k, t]) => `<div class="datagrid-item"><div class="datagrid-title">${k}</div><div class="datagrid-content">${esc(t)}</div></div>`).join('')}</div>` : ''}
          ${nv.dims ? `<p class="mb-2">Dimensiones aproximadas del predio: <b>${fnum(nv.dims.corto, 1)} × ${fnum(nv.dims.largo, 1)} m</b> (relación 1:${fnum(nv.dims.rel, 1)}).</p>` : ''}
          ${nv.alertas.map(t => `<div class="alert alert-warning py-2 mb-2"><div>${esc(t)}</div></div>`).join('')}</div></div>
        <div class="row g-4"><div class="col-lg-5">
          <p class="text-secondary small">Cobertura y pisos son supuestos editables${nv.vigente ? '; los valores reales los fija el plan regulador' : '; confírmelos con el Reglamento de Construcciones y la municipalidad'}.</p>
          ${grupo('El lote')}
          ${num('area', 'Área del lote', v.area, 'm²', { dis })}${num('util', 'Área aprovechable', v.util, '%', { dis, hint: 'Lo que queda sin retiros' })}
          ${grupo('Lo que se puede construir')}
          ${num('cob', 'Cobertura máxima', v.cob, '%', { dis, hint: 'Parte del lote que ocupa el edificio' })}${num('pisos', 'Pisos', v.pisos, '', { dis })}
          ${grupo('Unidades y segregación')}
          ${num('unidad', 'Tamaño por unidad', v.unidad, 'm²', { dis })}${num('circ', 'Circulaciones y muros', v.circ, '%', { dis })}
          ${num('loteMin', 'Lote mínimo para segregar', v.loteMin, 'm²', { dis })}
        </div><div class="col-lg-7 pres" data-res>${P.res.potencial(r, st)}</div></div>`;
    },
    prefa(r, st) {
      const v = st.pref = st.pref || P.prefDefaults(r);
      if (st.pot && !v.m2Edit) v.m2 = Math.round(P.potCalc(st.pot).total); // el área a construir sigue al potencial constructivo
      const dis = !PX.isPro(), U = curU(), rev = v.modo === 'reventa';
      const base = r.bv ? `Base vigente: ${T(PX.conv(r.bv, r.mon, PX.cur))}` : '';
      return `<div class="btn-group w-100 mb-3" role="group" aria-label="Escenario">
          <button type="button" class="btn${rev ? ' btn-primary' : ''}" data-modo="reventa" aria-pressed="${rev}"${dis ? ' disabled' : ''}>Comprar y revender el terreno</button>
          <button type="button" class="btn${rev ? '' : ' btn-primary'}" data-modo="desarrollo" aria-pressed="${!rev}"${dis ? ' disabled' : ''}>Construir y vender</button></div>
        <div class="row g-4"><div class="col-lg-5">
          ${grupo('1. Compra en el remate')}
          ${num('oferta', 'Tu oferta', v.oferta, '', { dis, pre: U, hint: base })}
          ${num('traspaso', 'Impuesto de traspaso', v.traspaso, '%', { dis })}
          ${num('timbres', 'Timbres y registro', v.timbres, '%', { dis })}
          ${num('legal', 'Honorarios legales', v.legal, '%', { dis })}
          ${num('otros', 'Deudas, desalojo u otros', v.otros, '', { dis, pre: U, hint: 'Monto fijo, si lo hay' })}
          ${rev ? `${grupo('2. Venta del terreno')}${num('ref', 'Precio de venta esperado', v.ref, '', { dis, pre: U, hint: !r.isPlano && PX.medFor && PX.medFor(r) ? 'Sugerido: mediana de remates del cantón por el área. Ajústelo a su mercado.' : '' })}`
            : `${grupo('2. Construcción')}${num('m2', 'Área a construir', v.m2, 'm²', { dis, hint: v.m2Edit ? '' : 'Tomada del potencial constructivo' })}${num('costo', 'Costo de obra por m²', v.costo, '', { dis, pre: U })}
              ${grupo('3. Venta')}${num('venta', 'Precio de venta por m²', v.venta, '', { dis, pre: U })}`}
          ${num('comision', 'Comisión de venta', v.comision, '%', { dis })}
          ${num('meses', 'Plazo total', v.meses, 'meses', { dis, hint: 'De la compra a la venta' })}
        </div><div class="col-lg-7 pres" data-res>${P.res.prefa(r, st)}</div></div>`;
    },
    riesgos(r) {
      const rs = P.riesgos(r), lv = ['', 'Información', 'Medio', 'Alto'], col = ['', 'blue', 'yellow', 'red'];
      const cnt = [3, 2, 1].map(n => rs.filter(x => x.n === n).length);
      return `<div class="row g-2 mb-3 pres">${[['Altos', cnt[0], 'red'], ['Medios', cnt[1], 'yellow'], ['Informativos', cnt[2], 'blue']].map(([t, n, c]) => `<div class="col-4"><div class="card card-sm"><div class="card-body d-flex align-items-center gap-2"><span class="status-dot status-${c}" aria-hidden="true"></span><span class="h2 mb-0">${n}</span><span class="text-secondary">${t}</span></div></div></div>`).join('')}</div>
        <div class="card card-sm mb-3 pres"><div class="list-group list-group-flush">${rs.length ? rs.map(x => `<div class="list-group-item"><div class="d-flex align-items-center gap-2 mb-1"><span class="badge bg-${col[x.n]}-lt">${lv[x.n]}</span><b>${esc(x.t)}</b></div><div class="text-secondary">${esc(x.d)}</div></div>`).join('') : '<div class="list-group-item">No se detectaron riesgos en los datos disponibles.</div>'}</div></div>
        ${grupo('Antes de ofertar')}${P.CHECK.map(t => `<label class="form-check"><input class="form-check-input" type="checkbox"${P.puede('riesgos') ? '' : ' disabled'}><span class="form-check-label">${t}</span></label>`).join('')}
        <div class="text-secondary small mt-2">Detección automática a partir del edicto y de capas públicas. No es asesoría legal.</div>`;
    },
    valor(r, st) {
      const v = st.val = st.val || P.valDefaults(r), dis = !PX.isPro(), z = (r.ent || {}).zh;
      return `<p class="text-secondary">${z ? `Zona homogénea <b>${esc(z.c)} · ${esc(PX.cap(z.n))}</b> (Hacienda, ONT): <b>${PX.duoI(z.v, 'CRC', '/m²')}</b>, tipología predominante ${esc(z.u)}.` : 'Sin dato de zona homogénea para este punto.'} La construcción se estima con el manual de tipologías de la ONT (valores a marzo 2023) y depreciación Ross-Heidecke.</p>
        <div class="row g-4"><div class="col-lg-5">
          ${grupo('Terreno')}
          ${num('area', 'Área del terreno', v.area, 'm²', { dis })}${num('zh', 'Valor de zona homogénea', v.zh, '/m²', { dis, pre: '₡' })}
          ${grupo('Construcción')}
          ${num('ac', 'Área construida', v.ac, 'm²', { dis })}
          <div class="mb-2"><label class="form-label" for="pv-tip">Tipología</label><select id="pv-tip" class="form-select" data-vs="tip"${dis ? ' disabled' : ''}>${PX.TIPOLOGIAS.map(t => `<option value="${t[0]}"${t[0] === v.tip ? ' selected' : ''}>${t[0]} · ${t[1]}</option>`).join('')}</select></div>
          ${num('edad', 'Edad', v.edad, 'años', { dis })}
          <div class="mb-2"><label class="form-label" for="pv-est">Estado de conservación</label><select id="pv-est" class="form-select" data-vs="est"${dis ? ' disabled' : ''}>${PX.ESTADOS.map(([n, f]) => `<option value="${f}"${f === v.est ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
        </div><div class="col-lg-7 pres" data-res>${P.res.valor(r, st)}</div></div>`;
    },
    alertas(r) {
      const a = P.alertas(), dis = !P.puede('alertas') ? ' disabled' : '', sig = r && !r.isPlano ? PX.sigo(r.key) : false;
      const ck = (k, on, t) => `<label class="form-check"><input class="form-check-input" type="checkbox" data-al="${k}"${on ? ' checked' : ''}${dis}><span class="form-check-label">${t}</span></label>`;
      return `<p class="text-secondary">Recibe avisos sin entrar al sitio. ${r && !r.isPlano ? `Este lote ${sig ? '<b>está en tu seguimiento</b>' : 'no está en tu seguimiento todavía'}.` : ''}</p>
        <div style="max-width:560px">
          ${grupo('Canales')}${ck('correo', a.canal.correo, 'Correo electrónico')}${ck('whatsapp', a.canal.whatsapp, 'WhatsApp')}
          ${grupo('Avisarme cuando')}${ck('etapa', a.etapa, 'Un lote que sigo cambie de etapa, se suspenda o se reprograme')}${ck('nuevos', a.nuevos, 'Salgan remates nuevos que cumplan mis búsquedas guardadas')}
          ${num('dias', 'Recordatorio antes del remate', a.dias, 'días', { dis: !!dis })}
          ${r && !r.isPlano ? `<button class="btn${sig ? '' : ' btn-primary'} mt-2" data-sig${dis}>${sig ? 'Dejar de seguir este lote' : 'Seguir este lote'}</button>` : ''}
        </div>
        <div class="alert alert-info mt-3 mb-0"><div>Vista previa: el envío de correos y WhatsApp se conecta en la siguiente fase, junto con el robot diario que lee el Boletín Judicial.</div></div>`;
    }
  };

  // ---------- Espacio de trabajo (ventana de Tabler) ----------
  const states = {};
  P.nivelDe = k => (P.TOOLS.find(t => t.k === k) || { nv: 3 }).nv;
  P.puede = k => PX.nivel() >= P.nivelDe(k);
  // Etiqueta del plan de cada herramienta
  P.tag = k => P.nivelDe(k) === 2 ? PX.ESE : PX.PRO;
  const tema = () => ((matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light') || document.documentElement.dataset.theme === 'dark') ? 'dark' : 'light';
  P.open = (r, tool, layer, hooks) => {
    const st = states[r.key] = states[r.key] || {};
    let cur = tool || 'potencial';
    const tools = P.TOOLS.filter(t => P.view[t.k]);
    function paint() {
      const pro = P.puede(cur), ese = P.nivelDe(cur) === 2;
      layer.innerHTML = `<div class="tb" data-bs-theme="${tema()}"><div class="modal modal-blur show d-block" tabindex="-1" role="dialog" aria-modal="true" aria-label="Herramientas" data-fondo>
        <div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">
        <div class="modal-header"><div><h5 class="modal-title">${esc(r.nom)}</h5><div class="text-secondary small">${esc(r.lugar || '')}${r.bv ? ' · base ' + PX.mt(Math.round(PX.conv(r.bv, r.mon, PX.cur)), PX.cur) : ''}${PX.prof(r) ? ' · ' + fnum(PX.prof(r)) + ' m²' : ''}</div></div><button type="button" class="btn-close" data-close aria-label="Cerrar"></button></div>
        <div class="modal-body pt-0">
          <ul class="nav nav-tabs mb-3" role="tablist">${tools.map(t => `<li class="nav-item" role="presentation"><a href="#" class="nav-link${t.k === cur ? ' active' : ''}" role="tab" data-tool="${t.k}" aria-selected="${t.k === cur}">${t.n}<span class="ms-2">${P.tag(t.k)}</span></a></li>`).join('')}</ul>
          ${pro ? '' : `<div class="alert alert-${ese ? 'success' : 'warning'} d-flex align-items-center gap-3"><div class="flex-fill">Estás viendo una <b>vista previa</b>. Esta herramienta viene en el plan <b>${ese ? 'Esencial' : 'PRO'}</b>${ese ? ' (y en PRO)' : ''}: con él editas los supuestos y ves todos los resultados.</div><button class="btn btn-primary" data-planes>Ver planes</button></div>`}
          <div class="${pro ? '' : 'preview'}" data-tool-body>${P.view[cur](r, st)}</div>
        </div>
        <div class="modal-footer justify-content-start text-secondary small">Herramienta ${ese ? 'del plan Esencial' : 'PRO'} de PlanoExactoCR. Resultados orientativos: no son un avalúo, un certificado de uso de suelo ni asesoría legal o financiera.</div>
      </div></div></div><div class="modal-backdrop fade show"></div></div>`;
    }
    paint();
    function refresh() { const b = layer.querySelector('[data-tool-body]'); if (b) b.innerHTML = P.view[cur](r, st); }
    function refreshRes() { const b = layer.querySelector('[data-res]'); if (b && P.res[cur]) b.innerHTML = P.res[cur](r, st); }
    // Formatea mientras se escribe: puntos de miles, coma decimal, sin mover el cursor de su dígito
    function formatear(el) {
      const raw = el.value, pos = el.selectionStart || 0, antes = raw.slice(0, pos).replace(/[^\d,]/g, '').length;
      let limpio = raw.replace(/[^\d,]/g, ''); const i = limpio.indexOf(',');
      if (i >= 0) limpio = limpio.slice(0, i + 1) + limpio.slice(i + 1).replace(/,/g, '');
      const [ent, dec] = limpio.split(',');
      const nuevo = (ent || '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec != null ? ',' + dec : '');
      el.value = nuevo;
      let n = 0, p = 0; while (p < nuevo.length && n < antes) { if (/[\d,]/.test(nuevo[p])) n++; p++; }
      try { el.setSelectionRange(p, p); } catch (er) {}
    }
    function bind() {
      const root2 = layer.firstElementChild; if (!root2 || root2._b) return; root2._b = 1;
      root2.addEventListener('click', e => {
        const t = e.target.closest('[data-tool]'); if (t) { e.preventDefault(); cur = t.dataset.tool; paint(); bind(); return; }
        const m = e.target.closest('[data-modo]'); if (m && PX.isPro()) { st.pref.modo = m.dataset.modo; refresh(); return; }
        if (e.target.closest('[data-sig]') && P.puede('alertas')) { PX.toggleSigo(r.key); refresh(); if (hooks && hooks.changed) hooks.changed(); }
      });
      root2.addEventListener('change', e => {
        const k = e.target.dataset.al; if (k == null || !P.puede('alertas')) return;
        const a = P.alertas(); if (k === 'correo' || k === 'whatsapp') a.canal[k] = e.target.checked; else a[k] = e.target.checked; PX.saveAcct();
      });
      root2.addEventListener('change', e => { const k = e.target.dataset.vs; if (!k || !PX.isPro()) return; st.val[k] = k === 'est' ? +e.target.value : e.target.value; refreshRes(); });
      root2.addEventListener('input', e => {
        const k = e.target.dataset.v; if (!k) return;
        formatear(e.target);
        const v = parseIn(e.target.value); if (isNaN(v)) return;
        if (cur === 'alertas' && k === 'dias') { if (P.puede('alertas')) { P.alertas().dias = v; PX.saveAcct(); } return; }
        if (!PX.isPro()) return;
        if (cur === 'valor') st.val[k] = v; else if (cur === 'potencial') st.pot[k] = v; else if (cur === 'prefa') { st.pref[k] = v; if (k === 'm2') st.pref.m2Edit = true; }
        refreshRes();
      });
      // Al salir del campo se deja el número con su formato final
      root2.addEventListener('focusout', e => { const el = e.target; if (!el.dataset || !el.dataset.v) return; const v = parseIn(el.value); el.value = isNaN(v) ? '' : fmtIn(v); });
    }
    bind();
  };
})();
