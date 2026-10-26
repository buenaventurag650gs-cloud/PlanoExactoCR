// Lee boletines [{n, date, texto}] por la entrada estándar y devuelve los remates de fincas extraídos.
const X = require('./extractor.js');
let buf = '';
process.stdin.on('data', d => buf += d).on('end', () => {
  const out = [];
  for (const b of JSON.parse(buf)) {
    for (const e of X.edictos(b.texto)) {
      const x = X.extraer(e.texto);
      if (!x || !x.finca) continue;
      Object.assign(x, { boletin: +b.n, fechaBoletin: b.date, referencia: e.referencia, pub: e.pub, pubDe: e.pubDe });
      out.push(x);
    }
  }
  process.stdout.write(JSON.stringify(out));
});
