// Checks the Sinhala and Tamil text tables: no letters from the other script, and no English
// words left untranslated. Run: node tools/check-i18n.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /(strings\.ts|i18n\/ui\.ts|registry\.ts)$/.test(p) && files.push(p); });
walk('src');
const TAMIL = /[஀-௿]/;
const SINHALA = /[඀-෿]/;
// English that may stay: brand, keys, units, abbreviations.
const OK = new Set(['Frostvale', 'WASD', 'Space', 'Shift', 'Esc', 'SMS', 'Enter']);
let problems = 0;
for (const file of files) {
  // Comments can hold apostrophes ("Krampus' Cellar") that would throw the quote matching off.
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');
  const marks = [...src.matchAll(/\b(en|si|ta)\s*:\s*[{[]/g)].map((m) => ({ at: m.index, lang: m[1] }));
  for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const lang = marks.filter((k) => k.at < m.index).at(-1)?.lang;
    if ((lang !== 'si' && lang !== 'ta') || m[2].includes('${string}')) continue;
    const s = m[2].replace(/<[^>]+>|\{\w+\}|\$\{[^}]*\}/g, ' ');
    const line = src.slice(0, m.index).split('\n').length;
    const wrongScript = lang === 'si' ? TAMIL : SINHALA;
    if (wrongScript.test(s)) { console.log(`${file}:${line} ${lang}: letters from the other script: ${m[2]}`); problems++; }
    const english = (s.match(/[A-Za-z]{4,}/g) ?? []).filter((w) => !OK.has(w));
    // Keys like 'title_newcomer' or ids are not text.
    if (english.length && (SINHALA.test(s) || TAMIL.test(s) || s.includes(' '))) { console.log(`${file}:${line} ${lang}: untranslated English (${english.join(', ')}): ${m[2]}`); problems++; }
  }
}
console.log(problems ? `${problems} problem(s) in ${files.length} files` : `i18n OK: ${files.length} files checked`);
process.exit(problems ? 1 : 0);
