// Extrae todos los edictos de fincas de 2026, deduplica y conserva solo los remates vigentes.
const fs = require('fs');
const X = require('./extractor.js');
const SRC = '/mnt/user-data/uploads/Downloads/edictos_fincas_2026.json';
const HOY = process.argv[2] || new Date().toISOString().slice(0, 16);
const bols = JSON.parse(fs.readFileSync(SRC, 'utf8'));

let n = 0, fallidos = 0;
const recs = [];
for (const b of bols) {
  for (const [texto, referencia, pub, pubDe] of b.e) {
    n++;
    const x = X.extraer(texto);
    if (!x || !x.finca) { fallidos++; continue; }
    Object.assign(x, { boletin: b.n, fechaBoletin: b.date, referencia, pub, pubDe });
    recs.push(x);
  }
}

// Un remate = provincia + finca + derecho. Si se reprograma (nuevo edicto con otras fechas), gana el edicto más reciente.
const byKey = new Map();
for (const x of recs) {
  const k = [x.provincia || '', x.finca, x.derecho || ''].join('|');
  const prev = byKey.get(k);
  if (!prev) { x.boletines = [x.boletin]; byKey.set(k, x); continue; }
  const bs = [...new Set([...prev.boletines, x.boletin])].sort((a, b) => a - b);
  if (x.boletin > prev.boletin) { x.boletines = bs; byKey.set(k, x); } else prev.boletines = bs;
}
const uniq = [...byKey.values()];
const vigentes = uniq.filter(x => x.fechas && x.fechas.length && x.fechas[x.fechas.length - 1] >= HOY);
const sinFecha = uniq.filter(x => !x.fechas || !x.fechas.length).length;

fs.writeFileSync('/home/claude/visor/vigentes_2026.json', JSON.stringify(vigentes));
console.log(JSON.stringify({ edictos: n, extraidos: recs.length, fallidos, remates_unicos: uniq.length, sin_fecha: sinFecha, vigentes: vigentes.length, con_plano: vigentes.filter(x => x.planoSnit).length, hoy: HOY }));
