// Sitedeki dosya bağlantılarına yeni bir sürüm numarası ekler (?v=...).
// Böylece güncellemeden sonra tarayıcılar eski dosyaları önbellekten kullanmaz.
// Kullanım: npm run bump
'use strict';
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const files = ['index.html', ...fs.readdirSync(path.join(DOCS, 'js')).map((f) => path.join('js', f))];
const current = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8').match(/\?v=(\d+)/);
const next = String((current ? Number(current[1]) : 0) + 1);
for (const f of files) {
  const p = path.join(DOCS, f);
  const s = fs.readFileSync(p, 'utf8');
  const out = s.replace(/(\.(?:js|css))\?v=\d+/g, `$1?v=${next}`);
  if (out !== s) fs.writeFileSync(p, out);
}
console.log(`Sürüm: v${next}`);
