/* PlanoExactoCR — tipografía en un solo lugar.
   Para cambiar la fuente de todo el sitio: cambiar PREDETERMINADA. Para probar otra sin publicar: agregar ?fuente=<id>
   a cualquier dirección (se recuerda en este navegador; ?fuente=predeterminada vuelve a la oficial).
   Cada juego define: títulos (display), texto (body) y cifras (mono). El logotipo usa siempre Montserrat. */
(function () {
  var PREDETERMINADA = 'actual';
  var JUEGOS = {
    actual:    { n: 'Archivo + IBM Plex', fam: 'Archivo:wght@500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500',
                 d: '"Archivo", "Helvetica Neue", Arial, sans-serif', b: '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif', m: '"IBM Plex Mono", ui-monospace, Menlo, monospace' },
    clasica:   { n: 'Source Serif + Source Sans', fam: 'Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&family=Source+Sans+3:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500',
                 d: '"Source Serif 4", Georgia, serif', b: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif', m: '"IBM Plex Mono", ui-monospace, Menlo, monospace' },
    editorial: { n: 'Fraunces + Public Sans', fam: 'Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500',
                 d: '"Fraunces", Georgia, serif', b: '"Public Sans", "Helvetica Neue", Arial, sans-serif', m: '"IBM Plex Mono", ui-monospace, Menlo, monospace' },
    caslon:    { n: 'Libre Caslon + Libre Franklin', fam: 'Libre+Caslon+Text:wght@400;700&family=Libre+Franklin:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500',
                 d: '"Libre Caslon Text", Georgia, serif', b: '"Libre Franklin", "Helvetica Neue", Arial, sans-serif', m: '"IBM Plex Mono", ui-monospace, Menlo, monospace' }
  };
  var id = PREDETERMINADA;
  try {
    var q = new URLSearchParams(location.search).get('fuente');
    if (q === 'predeterminada') localStorage.removeItem('px-fuente');
    else if (q && JUEGOS[q]) localStorage.setItem('px-fuente', q);
    var g = localStorage.getItem('px-fuente');
    if (g && JUEGOS[g]) id = g;
  } catch (e) {}
  var j = JUEGOS[id], h = document.head;
  var l = document.createElement('link'); l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=' + j.fam + '&family=Montserrat:wght@300;500;700&display=swap';
  h.appendChild(l);
  var s = document.createElement('style');
  s.textContent = 'html:root{--f-display:' + j.d + ';--f-body:' + j.b + ';--f-mono:' + j.m + '}';
  h.appendChild(s);
  document.documentElement.dataset.fuente = id;
  window.PX_FUENTES = { actual: id, juegos: JUEGOS };
})();
