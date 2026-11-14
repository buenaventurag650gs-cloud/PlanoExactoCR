/* Botón «Capturar datos SIRI»: se usa desde siri.rnp.go.cr (requiere sesión activa en ese sitio).
   Lee la página "Información general" de un predio y envía los datos a PlanoExactoCR.
   La página /siri.html convierte este archivo en un marcador (reemplaza __SITIO__ por la dirección del sitio). */
(async () => {
  const SITIO = '__SITIO__';
  if (!/(^|\.)rnp\.go\.cr$/.test(location.hostname)) { alert('Abre primero siri.rnp.go.cr, busca el predio y vuelve a pulsar «Capturar datos SIRI».'); return; }

  // ---------- Leer token de sesión de PlanoExactoCR ----------
  // El token se guarda en localStorage de siri.rnp.go.cr (mismo origen)
  // y se usa para autenticar el POST a PlanoExactoCR.
  // Si no hay token, pide el correo y contraseña una sola vez.
  let token = localStorage.getItem('pecr_siri_token');

  const caja = document.createElement('div');
  caja.style.cssText = 'position:fixed;z-index:99999;right:16px;bottom:16px;width:340px;padding:16px 18px;border-radius:14px;background:#073B32;color:#EEF3F0;font:14px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)';
  const msg = (t, err) => { caja.style.background = err ? '#7f1d1d' : '#073B32'; caja.innerHTML = '<b style="display:block;margin-bottom:6px">PlanoExactoCR · SIRI</b>' + t; };
  document.body.appendChild(caja);
  msg('Leyendo la página…');

  // ---------- Función auxiliar: leer texto de celda de tabla por encabezado ----------
  const tbl = (tabla, header) => {
    if (!tabla) return null;
    const rows = tabla.querySelectorAll('tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td, th');
      for (let i = 0; i < cells.length - 1; i++) {
        if (cells[i].textContent.trim().toLowerCase().includes(header.toLowerCase())) {
          return cells[i + 1]?.textContent?.trim() || null;
        }
      }
    }
    return null;
  };

  // ---------- Extraer datos de la página actual ----------
  // La página "Información general" tiene varias secciones con tablas
  const todas = [...document.querySelectorAll('table')];

  // Detectar si estamos en la página correcta
  const titulo = document.querySelector('h2, h3, .portlet-title, .rich-panel-header, .ui-panel-title, [class*=titulo], [class*=title]');
  const breadcrumb = document.querySelector('.breadcrumb, [class*=breadcrumb], [id*=breadcrumb]')?.textContent || '';
  const enPaginaCorrecta = breadcrumb.includes('Información general') || document.title.includes('SIRI') || todas.length > 2;
  if (!enPaginaCorrecta && todas.length < 2) {
    msg('⚠️ Abrí el detalle de un predio en el SIRI (Buscar predio → Ver predio) y volvé a pulsar el botón.', true);
    setTimeout(() => caja.remove(), 6000);
    return;
  }

  // Situación (tabla izquierda: Número, Avaluo, Área total, Plano, Estado)
  let numero = null, avaluo = null, areaTotal = null, plano = null, estado = null;
  let provincia = null, canton = null, distrito = null;
  let naturaleza = null;
  let idPredio = null;

  // Leer todas las celdas par por par (encabezado → valor)
  for (const t of todas) {
    const rows = t.querySelectorAll('tr');
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td, th')];
      for (let i = 0; i < cells.length - 1; i += 2) {
        const h = cells[i]?.textContent?.trim().toLowerCase() || '';
        const v = cells[i + 1]?.textContent?.trim() || '';
        if (!v || v === '-') continue;
        if (h.includes('número') && !h.includes('finca') && !h.includes('plano') && !h.includes('tomo') && !h.includes('asiento')) numero = numero || v;
        if (h.includes('avaluo') || h.includes('avalúo')) avaluo = parseFloat(v.replace(/[^0-9.]/g, '')) || null;
        if (h.includes('área total') || h.includes('area total')) areaTotal = parseFloat(v.replace(/[^0-9.]/g, '')) || null;
        if (h === 'plano') plano = plano || v;
        if (h === 'estado') estado = estado || v;
        if (h.includes('provincia')) provincia = provincia || v;
        if (h.includes('cantón') || h.includes('canton')) canton = canton || v;
        if (h.includes('distrito')) distrito = distrito || v;
        if (h.includes('naturaleza')) naturaleza = naturaleza || v;
        if (h.includes('id predio') || h.includes('id_predio')) idPredio = idPredio || v;
      }
    }
  }

  // ID predio: también puede aparecer en la URL o en el breadcrumb
  if (!idPredio) {
    const m = location.href.match(/[?&]id[Pp]redio=([0-9]+)/) || location.href.match(/\/([0-9]{14,15})(\/|$)/);
    if (m) idPredio = m[1];
  }

  // Finca: construida desde número de finca visible o desde id_predio
  // Formato esperado: X-NNNNNNN-N-N o 500018016 (número puro)
  let finca = null;
  for (const t of todas) {
    const rows = t.querySelectorAll('tr');
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')];
      for (const cell of cells) {
        const txt = cell.textContent.trim();
        // Formato estándar de finca: X-NNNNNNN-N-N
        const m = txt.match(/^(\d)-(\d{7})-(\d)-(\d)$/);
        if (m) { finca = txt; break; }
      }
      if (finca) break;
    }
    if (finca) break;
  }
  // Fallback: construir finca desde número si tenemos provincia
  if (!finca && numero && provincia) {
    const pmap = { 'SAN JOSÉ': 1, 'ALAJUELA': 2, 'CARTAGO': 3, 'HEREDIA': 4, 'GUANACASTE': 5, 'PUNTARENAS': 6, 'LIMÓN': 7 };
    const pnum = pmap[provincia.toUpperCase().trim()];
    if (pnum) finca = `${pnum}-${String(numero).padStart(7, '0')}-0-0`;
  }

  if (!finca && !numero) {
    msg('⚠️ No se encontró el número de finca. Asegurate de estar en la página "Información general" del predio.', true);
    setTimeout(() => caja.remove(), 6000);
    return;
  }
  const fincaId = finca || numero;

  // ---------- Linderos ----------
  const linderos = {};
  const dirNames = ['norte', 'sur', 'este', 'oeste'];
  for (const t of todas) {
    const rows = t.querySelectorAll('tr');
    for (const row of rows) {
      const cells = [...row.querySelectorAll('th, td')];
      const headers = cells.map(c => c.textContent.trim().toLowerCase());
      const norteIdx = headers.indexOf('norte');
      if (norteIdx >= 0) {
        // Es la tabla de linderos; la siguiente fila tiene los valores
        const nextRow = row.nextElementSibling;
        if (nextRow) {
          const vals = [...nextRow.querySelectorAll('td')].map(c => c.textContent.trim());
          if (vals[0]) linderos.norte = vals[0];
          if (vals[1]) linderos.sur = vals[1];
          if (vals[2]) linderos.este = vals[2];
          if (vals[3]) linderos.oeste = vals[3];
        }
        break;
      }
    }
    if (Object.keys(linderos).length) break;
  }

  // ---------- Anotaciones ----------
  const anotaciones = [];
  for (const t of todas) {
    const headers = [...t.querySelectorAll('th')].map(h => h.textContent.trim().toLowerCase());
    if (headers.some(h => h.includes('tipo') && h.includes('fecha')) || headers.includes('tipo')) {
      const rows = [...t.querySelectorAll('tbody tr')];
      for (const row of rows) {
        const cells = [...row.querySelectorAll('td')];
        const txt = cells.map(c => c.textContent.trim()).join(' | ');
        if (txt.trim() && !txt.includes('No se han encontrado')) {
          anotaciones.push({ tipo: cells[0]?.textContent?.trim(), fecha: cells[1]?.textContent?.trim(), participantes: cells[2]?.textContent?.trim() });
        }
      }
    }
  }

  // ---------- Gravámenes ----------
  const gravamenes = [];
  for (const t of todas) {
    const headers = [...t.querySelectorAll('th')].map(h => h.textContent.trim().toLowerCase());
    if (headers.includes('tomo') && headers.includes('asiento')) {
      const rows = [...t.querySelectorAll('tr')];
      let currentGrav = null;
      for (const row of rows) {
        const cells = [...row.querySelectorAll('td')];
        if (!cells.length) continue;
        const isGravRow = cells.length >= 4 && cells[0].textContent.trim().match(/^\d+$/) && cells[1].textContent.trim().match(/^\d+$/);
        if (isGravRow) {
          currentGrav = {
            tomo: cells[0].textContent.trim(),
            asiento: cells[1].textContent.trim(),
            consecutivo: cells[2]?.textContent?.trim(),
            secuencia: cells[3]?.textContent?.trim(),
            subsecuencia: cells[4]?.textContent?.trim(),
            monto: cells[5]?.textContent?.trim() || null,
            fecha_inicial: cells[6]?.textContent?.trim() || null,
            fecha_final: cells[7]?.textContent?.trim() || null,
            citas: [],
          };
          gravamenes.push(currentGrav);
        } else if (currentGrav && cells.length >= 2) {
          // Fila de detalle: Citas, Operación
          const cita = cells[0]?.textContent?.trim();
          const operacion = cells[1]?.textContent?.trim();
          const moneda = cells[3]?.textContent?.trim();
          if (cita && cita.match(/\d+-\d+-\d+/)) {
            currentGrav.citas.push({ cita, operacion, moneda });
          }
        }
      }
    }
  }

  // ---------- Derechos ----------
  const derechos = [];
  for (const t of todas) {
    const headers = [...t.querySelectorAll('th')].map(h => h.textContent.trim().toLowerCase());
    if (headers.some(h => h.includes('id persona') || h.includes('nombre persona') || h.includes('tipo derecho'))) {
      const rows = [...t.querySelectorAll('tbody tr')];
      for (const row of rows) {
        const cells = [...row.querySelectorAll('td')];
        if (cells.length >= 4) {
          derechos.push({
            numero: cells[0]?.textContent?.trim(),
            tipo_persona: cells[1]?.textContent?.trim(),
            id_persona: cells[2]?.textContent?.trim(),
            nombre: cells[3]?.textContent?.trim(),
            estado_civil: cells[4]?.textContent?.trim(),
            proporcion: cells[5]?.textContent?.trim(),
            tipo_proporcion: cells[6]?.textContent?.trim(),
            tipo_derecho: cells[7]?.textContent?.trim(),
            presentacion: cells[8]?.textContent?.trim(),
            fecha: cells[9]?.textContent?.trim(),
          });
        }
      }
    }
  }

  msg(`Finca: <b>${fincaId}</b><br>Gravámenes: ${gravamenes.length} · Anotaciones: ${anotaciones.length}<br>Enviando a PlanoExactoCR…`);

  // ---------- Autenticación con PlanoExactoCR ----------
  // Intentar con token guardado; si falla pedir correo/contraseña
  const post = async (tok) => fetch(SITIO + '/api/siri-catastral', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(tok ? { 'Authorization': 'Bearer ' + tok } : {}) },
    body: JSON.stringify({ finca: fincaId, id_predio: idPredio, avaluo, area_total: areaTotal, plano, estado, provincia, canton, distrito, naturaleza, linderos, anotaciones, gravamenes, derechos }),
  });

  let r = await post(token).catch(() => null);

  if (!r || r.status === 401) {
    // Sin sesión activa de PlanoExactoCR — el usuario debe estar logueado
    msg('⚠️ Necesitás estar logueado en PlanoExactoCR en este browser.<br><small>Abrí planoexactocr.com, iniciá sesión, y volvé a pulsar el botón.</small>', true);
    setTimeout(() => caja.remove(), 8000);
    return;
  }

  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    msg('⚠️ Error al guardar: ' + (e.error || r.status), true);
    setTimeout(() => caja.remove(), 6000);
    return;
  }

  msg(`✔ Guardado en PlanoExactoCR<br><b>${fincaId}</b><br>${gravamenes.length} gravamen${gravamenes.length !== 1 ? 'es' : ''} · ${anotaciones.length} anotación${anotaciones.length !== 1 ? 'es' : ''} · ${derechos.length} titular${derechos.length !== 1 ? 'es' : ''}<br><small style="opacity:.7">Verlos en el expediente o en la ficha de la finca.</small>`);
  setTimeout(() => caja.remove(), 8000);
})();
