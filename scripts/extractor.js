// Extractor de edictos de remate de fincas del Boletín Judicial (Costa Rica)
// Funciona igual en Node (pruebas) y en el navegador (producción).
(function (root) {
  const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const SMALL = {
    cero: 0, un: 1, uno: 1, una: 1, primero: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
    veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
    setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
    cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
    setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900
  };

  // Convierte palabras (ya normalizadas) a número; se detiene en la primera palabra que no sea numérica.
  function words2num(txt) {
    const toks = txt.trim().split(/[\s-]+/);
    let millions = 0, total = 0, cur = 0, used = 0, any = false;
    for (const t of toks) {
      if (t === 'y' && any) { used++; continue; }
      if (t in SMALL) { cur += SMALL[t]; any = true; used++; continue; }
      if (t === 'mil') { total += (cur || 1) * 1000; cur = 0; any = true; used++; continue; }
      if (t === 'millon' || t === 'millones') { millions += (total + cur) || 1; total = 0; cur = 0; any = true; used++; continue; }
      break;
    }
    if (!any) return null;
    return { value: millions * 1e6 + total + cur, used };
  }

  function parseDigits(s) {
    // "17,516.26" | "10.000.000,00" | "10 000 000" | "969"
    s = s.replace(/\s/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return parseFloat(s.replace(/,/g, ''));
    if (/^\d+,\d{1,2}$/.test(s)) return parseFloat(s.replace(',', '.'));
    return parseFloat(s);
  }

  // Monto que empieza en `n` (texto normalizado). Devuelve {valor, moneda}.
  function parseMonto(n) {
    n = n.replace(/^\s*(?:de\s+)?/, '');
    let valor = null;
    const moneda = /^\s*(\$|us\$|usd)|^[^.;(]{0,160}?(dolar|dolares|usd)/.test(n) ? 'USD' : 'CRC';
    const dig = n.match(/^(?:\$|us\$|₡|c)?\s*([\d][\d.,\s]*\d|\d)/);
    if (dig) valor = parseDigits(dig[1]);
    else {
      const w = words2num(n);
      if (w) {
        valor = w.value;
        const rest = n.split(/\s+/).slice(w.used).join(' ');
        const cent = rest.match(/^(?:de\s+)?(?:colones|dolares|dolar|dolares estadounidenses|dolares americanos)?\s*(?:exactos\s*)?con\s+([a-z ]+?)\s+(?:centimos|centavos)/);
        if (cent) { const c = words2num(cent[1]); if (c && c.value < 100) valor += c.value / 100; }
      }
    }
    return valor ? { valor: Math.round(valor * 100) / 100, moneda } : null;
  }

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  function fechas(n) {
    const re = /las\s+([a-z ]+?)\s+horas(?:\s+(?:con\s+)?([a-z ]+?)\s+minutos?)?\s+del?\s+(?:dia\s+)?([a-z0-9 ]+?)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+|del\s+)?(?:ano\s+)?(dos mil(?:\s+[a-z]+){0,3}|\d{4})/g;
    const out = []; let m;
    while ((m = re.exec(n)) && out.length < 3) {
      const h = words2num(m[1]); const mi = m[2] ? words2num(m[2]) : { value: 0 };
      const d = /^\d+$/.test(m[3].trim()) ? { value: +m[3] } : words2num(m[3]);
      const y = /^\d{4}$/.test(m[5]) ? { value: +m[5] } : words2num(m[5]);
      const mes = m[4] === 'septiembre' ? 9 : MESES.indexOf(m[4]) + 1;
      if (!h || !d || !y || y.value < 2020 || y.value > 2035) continue;
      const pad = x => String(x).padStart(2, '0');
      out.push(`${y.value}-${pad(mes)}-${pad(d.value)}T${pad(h.value)}:${pad(mi ? mi.value : 0)}`);
    }
    return out;
  }

  const PROV = { 'san jose': 1, alajuela: 2, cartago: 3, heredia: 4, guanacaste: 5, puntarenas: 6, limon: 7 };
  const PLANO_PROV = { sj: 1, a: 2, c: 3, h: 4, g: 5, p: 6, l: 7 };
  const PROV_RE = '(san jose|alajuela|cartago|heredia|guanacaste|puntarenas|limon)';

  // Si el trozo trae otro edicto pegado antes (p. ej. un vehículo), corta desde el último inicio previo a "matrícula".
  function recortar(t) {
    t = t.replace(/\s+/g, ' ');
    const mi = t.search(/matr[íi]cula/i);
    if (mi <= 0) return t;
    const re = /(En este Despacho|En la puerta|En el Juzgado|En la sede|Con una base|Con la base|Al ser las)/gi;
    let st = 0, mm;
    while ((mm = re.exec(t)) && mm.index < mi) st = mm.index;
    return t.slice(st);
  }

  function extraer(orig) {
    const o = recortar(orig);
    const n = strip(o);
    if (!/(saquese a remate|se rematar|sacar a remate|se saca a remate)/.test(n)) return null;
    const r = {};

    // Finca
    // Formatos: 619217-000 · 1-621159-000 · 566655000 (finca+derecho) · 153342000-F · 159944-F-003
    let m = n.match(/matricula\s+(?:numero\s+|no\.?\s+|n[°º.]+\s*)?(?:([1-7])\s*-\s*(?=\d{3,7}\s*-))?(\d{1,10})\s*(?:-\s*(f)\s*)?(?:-\s*(\d{3}))?(\s*-\s*f\b)?/);
    if (m) {
      let f = m[2];
      if (m[1]) r.provincia = +m[1];
      if (f.length >= 8) { r.derecho = f.slice(-3); f = f.slice(0, -3); }
      r.finca = +f; r.filial = !!(m[3] || m[5]); if (m[4]) r.derecho = m[4];
    }
    else if ((m = n.match(/matricula\s+(?:numero\s+)?([a-z ]+?)(?=,|\s+derecho|\s+la cual|\s+naturaleza|\.)/))) {
      const w = words2num(m[1]); if (w && w.value > 0) r.finca = w.value;
    }
    if (!r.finca && (m = n.match(/finca\s+(?:numero\s+)?([1-7])\s*-\s*(\d{3,7})\s*(?:-\s*(f)\s*)?-\s*(\d{3})/))) {
      r.provincia = +m[1]; r.finca = +m[2]; r.filial = !!m[3]; r.derecho = m[4];
    }
    if (!r.finca) return null;
    if (!r.derecho && (m = n.match(/derechos?\s+(\d{3}|cero cero cero)/))) r.derecho = m[1] === 'cero cero cero' ? '000' : m[1];
    if (/-f-|\bfilial\b/.test(n.slice(0, n.indexOf('matricula') + 80))) r.filial = r.filial || /-f-/.test(n);
    r.multiple = (n.match(/matricula/g) || []).length > 1 || /\d{3,7}-f-\d{3}\s+y\s+\d{3,7}-f-\d{3}/.test(n);

    // Provincia
    if (!r.provincia) {
      m = n.match(new RegExp('partido de\\s+' + PROV_RE)) || n.match(new RegExp('(?:la finca|finca)\\s+(?:del?\\s+)?' + PROV_RE + '\\s*,?\\s+matricula'))
        || n.match(new RegExp('provincia de\\s+' + PROV_RE));
      if (m) r.provincia = PROV[m[1]];
    }
    // Finca de 7 cifras que empieza con el código de provincia ("dos millones doscientos ochenta y un mil…" = 2-281672)
    if (r.finca >= 1e6 && r.provincia && String(r.finca)[0] === String(r.provincia)) r.finca = +String(r.finca).slice(1);

    // Plano
    if ((m = n.match(/plano[^.]{0,80}?\b(sj|[achgpl])\s*-\s*(\d{1,8})\s*-\s*(\d{4})/))) {
      r.plano = `${m[1].toUpperCase()}-${m[2]}-${m[3]}`;
      r.planoSnit = `${PLANO_PROV[m[1]]}${m[2].replace(/^0+/, '').padStart(7, '0')}${m[3]}`;
    }

    // Base del primer remate
    m = n.match(/base de\s+(.{0,260})/);
    if (m) { const b = parseMonto(m[1]); if (b) { r.base = b.valor; r.moneda = b.moneda; } }

    // Fechas (1.º, 2.º, 3.º)
    r.fechas = fechas(n);

    // Área
    if ((m = n.match(/\bmide:?\s+(?:un area de\s+|area de\s+)?([a-z0-9 .,]+?)\s*(metros|m2|m²|hectareas)/))) {
      let a = /^\d/.test(m[1]) ? { value: parseDigits(m[1]) } : words2num(m[1]);
      if (a) {
        let v = a.value;
        if (m[2] === 'hectareas') v *= 10000;
        const after = n.slice(m.index + m[0].length, m.index + m[0].length + 140);
        const dec = after.match(/^\s*con\s+([a-z0-9 ]+?)\s+decimetros/);
        if (dec) { const dv = /^\d/.test(dec[1]) ? { value: +dec[1] } : words2num(dec[1]); if (dv && dv.value < 100) v += dv.value / 100; }
        r.area = Math.round(v * 100) / 100;
      }
    }

    // Naturaleza (texto original)
    if ((m = o.match(/(?:la cual es|NATURALEZA:?|naturaleza:?)\s+([^.;]{3,140})/i))) r.naturaleza = m[1].replace(/\s*,?\s*(finca se encuentra|situada|linderos|colinda).*$/i, '').replace(/naturaleza:?\s*/gi, '').replace(/^terreno\s+(terreno\b)/i, '$1').replace(/[\s,.-]+$/, '').trim();

    // Ubicación declarada
    const ORD = '(?:primero|segundo|tercero|cuarto|quinto|sexto|setimo|septimo|octavo|noveno|decimo[a-z ]*?)';
    m = n.match(new RegExp('distrito\\s+(?:\\d+\\s*-?\\s*|' + ORD + '\\s+)?([a-z ]+?)[,.]?\\s+canton\\s+(?:\\d+\\s*-?\\s*|' + ORD + '\\s+)?([a-z ]+?)[,.]?\\s+(?:de\\s+la\\s+)?provincia'));
    if (m) { r.distritoTxt = m[1].trim(); r.cantonTxt = m[2].trim(); }

    // Gravámenes y servidumbres (texto original entre la base y "sáquese")
    const iS = o.search(/(libre de grav|soportando|con grav)/i);
    const iE = o.search(/(s[áa]quese a remate|se rematar[áa]|en el mejor postor)/i);
    if (iS >= 0 && iE > iS) r.gravamenes = o.slice(iS, iE).replace(/[;,\s]+$/, '').trim();
    else if (/libre de gravamenes/.test(n)) r.gravamenes = 'Libre de gravámenes';
    r.servidumbres = [...new Set(((r.gravamenes || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/SERVIDUMBRE[A-Z ]*?(?= CITAS| BAJO|,|;|$)/g) || []).map(s => s.trim()))];
    r.servidumbres = r.servidumbres.filter(s => s !== 'SERVIDUMBRE' || r.servidumbres.length === 1);
    r.texto = o;

    // Proceso, expediente, juzgado
    if ((m = o.match(/PROCESO\s+([A-ZÁÉÍÓÚÑ ]{4,60}?)\s+(?:de|DE)\s/))) r.proceso = m[1].trim();
    if ((m = o.match(/\b(\d{2}-\d{6}-\d{4}-[A-Z]{2})\b/))) r.expediente = m[1];
    if ((m = o.match(/((?:JUZGADO|TRIBUNAL|Juzgado|Tribunal)[^.]{5,160}?)(?=\.|\s+Hora y fecha|\s+Fecha|$)/))) r.juzgado = m[1].replace(/\s+(Hora|Fecha|Lic|Licda|Msc|MSc|Dr|Dra)\b.*$/, '').trim();
    return r;
  }

  // Divide el texto de un boletín en edictos (cada uno termina en "Referencia N°: …, publicación número: x de y").
  function edictos(texto) {
    const re = /Referencia N[°º]?:?\s*(\d+),\s*publicaci[óo]n n[úu]mero:\s*(\d+)\s*de\s*(\d+)/gi;
    const out = []; let last = 0, m;
    while ((m = re.exec(texto))) {
      let t = texto.slice(last, m.index);
      const st = t.search(/(En este Despacho|En la puerta|En el Juzgado|En la sede|Con una base|A las|Al ser las|En el mejor postor|Se hace saber)/i);
      if (st > 0 && t.length - st > 200) t = t.slice(st);
      out.push({ texto: t.slice(-4000), referencia: m[1], pub: +m[2], pubDe: +m[3] });
      last = m.index + m[0].length;
    }
    return out;
  }

  const api = { extraer, edictos, words2num, parseMonto, fechas, strip };
  if (typeof module !== 'undefined') module.exports = api; else root.Extractor = api;
})(typeof window !== 'undefined' ? window : this);
