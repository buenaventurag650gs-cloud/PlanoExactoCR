/* Botón «Ubicar remates»: se usa desde www.snitcr.go.cr (conexión en Costa Rica).
   Pide a PlanoExactoCR la lista de remates sin ubicar, consulta el catastro del SNIT y devuelve los resultados.
   La página /catastro.html convierte este archivo en un marcador (reemplaza __SITIO__ por la dirección del sitio). */
(async () => {
  const SITIO = '__SITIO__';
  if (!/(^|\.)snitcr\.go\.cr$/.test(location.hostname)) { alert('Abre primero www.snitcr.go.cr y vuelve a pulsar «Ubicar remates».'); return; }
  let clave = localStorage.getItem('pecr_clave');
  if (!clave) { clave = prompt('Contraseña de PlanoExactoCR (se guarda en este navegador):'); if (!clave) return; }
  const auth = { Authorization: 'Basic ' + btoa('admin:' + clave) };
  const caja = document.createElement('div');
  caja.style.cssText = 'position:fixed;z-index:99999;right:16px;bottom:16px;width:320px;padding:16px 18px;border-radius:14px;background:#15302A;color:#EEF3F0;font:14px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)';
  const msg = t => { caja.innerHTML = '<b style="display:block;margin-bottom:4px">PlanoExactoCR · catastro</b>' + t; };
  document.body.appendChild(caja); msg('Pidiendo la lista de remates sin ubicar…');
  let P;
  try {
    const r = await fetch(SITIO + '/api/catastro/pendientes', { headers: auth });
    if (r.status === 401) { localStorage.removeItem('pecr_clave'); msg('La contraseña no es correcta. Vuelve a pulsar el botón.'); return; }
    P = await r.json();
  } catch (e) { msg('No se pudo conectar con PlanoExactoCR.'); return; }
  localStorage.setItem('pecr_clave', clave);
  if (!P.length) { msg('No hay remates pendientes. Todo está ubicado. ✔'); return; }
  const q = async p => { try { const j = await (await fetch('/Visor/services/siri?' + new URLSearchParams(p))).json(); return [...(j.data?.zona_1?.features || []), ...(j.data?.zona_2?.features || [])]; } catch (e) { return null; } };
  const res = {}; let hechos = 0, ok = 0;
  const uno = async p => {
    let feats = [], via = null;
    if (p.plano) { const f = await q({ tipoquery: 'plano', plano: p.plano }); if (f === null) return; if (f.length) { feats = f; via = 'plano'; } }
    if (!via && !p.filial) { const f = await q({ tipoquery: 'finca', finca: String(p.finca).padStart(7, '0'), provincia: String(p.prov) }); if (f === null) return; if (f.length) { feats = f; via = 'finca'; } }
    res[p.k] = via ? { via, feats: feats.slice(0, 6).map(f => ({ properties: { plano: f.properties.plano, shape_area: f.properties.shape_area, finca: f.properties.finca }, geometry: f.geometry })) } : { sin_resultado: true };
    if (via) ok++;
  };
  for (let i = 0; i < P.length; i += 4) { await Promise.all(P.slice(i, i + 4).map(uno)); hechos = Math.min(P.length, i + 4); msg(`Consultando el catastro: ${hechos} de ${P.length}…<br><small>Puedes dejar esta pestaña abierta.</small>`); }
  msg('Enviando los resultados…');
  try {
    const r = await fetch(SITIO + '/api/catastro/resultados', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth), body: JSON.stringify(res) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    msg(`Listo ✔<br>${ok} de ${P.length} remates encontrados en el catastro.<br><small>La actualización corre ahora en GitHub; en 5 a 10 minutos aparecen en el mapa.</small>`);
  } catch (e) { msg('No se pudieron guardar los resultados: ' + e.message); }
})();
