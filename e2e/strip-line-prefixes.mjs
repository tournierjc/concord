// e2e/strip-line-prefixes.mjs — nettoyeur d'urgence : retire les préfixes "N|" que read_file
// a pu injecter dans un fichier écrit via des patches successifs (2026-11-02, incident e2e).
import { readFileSync, writeFileSync } from 'node:fs';
const p = process.argv[2];
const raw = readFileSync(p, 'utf8');
const cleaned = raw.split('\n').map((l) => l.replace(/^\s*\d+\|\s?/, '')).join('\n');
writeFileSync(p, cleaned);
console.log(raw === cleaned ? 'déjà propre' : 'préfixes retirés');
