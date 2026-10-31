#!/bin/sh
# =============================================================================
# check-engine.sh — pureté de src/engine (pas d'E/S, pas de réseau, pas de timer)
# -----------------------------------------------------------------------------
# Pourquoi : le moteur (salons, ICE, signaling, machine à états) doit rester
# testable hors Electron et hors réseau. S'il importe electron/ws/net/dgram, il
# n'est plus testable en `node --test` et la promesse « LAN only » n'est plus
# vérifiable statiquement : elle dépend du runtime.
#
# CONTROLES
#   E1  imports de VALEUR interdits : electron, ws, node:net, node:dgram,
#       node:http(s), node:tls, node:dns, node:child_process, @electron/remote,
#       electron-updater (et leurs équivalents sans préfixe node:)
#       -> un `import type` (effacé à la compilation) est un AVERTISSEMENT,
#          pas un échec : il ne crée aucune dépendance d'exécution.
#   E2  accès fichier : node:fs / fs (E1) + appels readFile*, writeFile*,
#       mkdir*, existsSync, open*, createReadStream, stat*
#   E3  minuteries : setInterval / setTimeout / setImmediate (le moteur reçoit
#       une horloge injectée, il n'en crée pas)
#   E4  toute dépendance npm importée doit être déclarée dans package.json
#       (dependencies / devDependencies / peerDependencies / optionalDependencies)
#   E5  réseau par API globale : fetch(, XMLHttpRequest, WebSocket(,
#       navigator.sendBeacon, eval(, new Function(
#
# SKIP explicite si src/engine est absent, vide, ou si `node` manque.
# Les commentaires sont neutralisés avant analyse (machine à états qui respecte
# les chaînes et les littéraux d'expression régulière), sinon les JSDoc
# « pas de fetch ici » compteraient comme des violations.
#
# Usage : ./check-engine.sh [RACINE]      RACINE par défaut = dossier parent
# Dépendances : sh, node (intégré au script, aucun paquet npm).
# Sortie machine : CHECK_ENGINE RESULT=PASS|FAIL|SKIP ...
# =============================================================================

ROOT=${1:-}
if [ -z "$ROOT" ]; then
  HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
  ROOT=$(CDPATH= cd -- "$HERE/.." && pwd) || exit 2
fi
NOW=$(date -Is 2>/dev/null || date)

echo "=== check-engine.sh — $NOW ==="
echo "RACINE   : $ROOT"
echo "périmètre: $ROOT/src/engine/**/*.{ts,tsx,js,mjs,cjs} (hors *.test.*, *.spec.*, *.d.ts)"
echo "règles   : E1 imports interdits · E2 accès fs · E3 minuteries · E4 deps npm déclarées · E5 réseau global"

ENGINE="$ROOT/src/engine"
if [ ! -d "$ENGINE" ]; then
  echo ""
  echo "[SKIP] E0  src/engine est ABSENT ($ENGINE)"
  echo "       -> rien à analyser : les contrôles E1..E5 ne sont PAS exécutés,"
  echo "          ce n'est pas un succès. A relancer dès que le moteur existe."
  echo "--- résumé ---"
  echo "fichiers=0 échecs=0 avertissements=0 skips=5"
  printf 'CHECK_ENGINE RESULT=SKIP files=0 reason=src-engine-absent path=%s\n' "$ENGINE"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[SKIP] E0  'node' introuvable dans le PATH : analyse statique impossible."
  echo "--- résumé ---"
  echo "fichiers=0 échecs=0 avertissements=0 skips=5"
  printf 'CHECK_ENGINE RESULT=SKIP files=0 reason=node-absent\n'
  exit 0
fi

NFILES=$(find "$ENGINE" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \
          -o -name '*.mjs' -o -name '*.cjs' \) \
        ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.spec.ts' ! -name '*.d.ts' \
        | wc -l | tr -d ' ')
if [ "$NFILES" -eq 0 ]; then
  echo ""
  echo "[SKIP] E0  src/engine existe mais ne contient aucun module .ts/.js exploitable"
  echo "--- résumé ---"
  echo "fichiers=0 échecs=0 avertissements=0 skips=5"
  printf 'CHECK_ENGINE RESULT=SKIP files=0 reason=src-engine-sans-fichier path=%s\n' "$ENGINE"
  exit 0
fi

NODE_SRC=$(cat <<'NODE_EOF'
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[1];
const ENGINE = path.join(ROOT, 'src', 'engine');
const PKG = path.join(ROOT, 'package.json');

/* ---- neutralisation des commentaires -------------------------------------
   Machine a etats : code / // / bloc / '...' / "..." / `...` / litteral regex.
   Le contenu des commentaires est remplace par des espaces en conservant les
   retours a la ligne (numeros de ligne intacts). Les chaines sont conservees :
   c'est la que vivent les specificateurs d'import.                          */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const isRegexStart = (prev) => prev === '' || /[([{,;:=!&|?+\-*%~^]/.test(prev);
  let prevNonSpace = '';
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      prevNonSpace = q; continue;
    }
    if (c === '/' && isRegexStart(prevNonSpace)) {
      let j = i + 1, closed = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '/') { closed = true; break; }
        j++;
      }
      if (closed) { out += src.slice(i, j + 1); i = j + 1; prevNonSpace = '/'; continue; }
    }
    out += c;
    if (!/\s/.test(c)) prevNonSpace = c;
    i++;
  }
  return out;
}

const FORBIDDEN_MODULE = {
  'electron': 'electron', 'electron/main': 'electron',
  'ws': 'ws', '@electron/remote': 'remote', 'electron-updater': 'auto-update',
  'node:net': 'net', 'net': 'net', 'node:dgram': 'dgram', 'dgram': 'dgram',
  'node:http': 'http', 'http': 'http', 'node:https': 'https', 'https': 'https',
  'node:http2': 'http2', 'http2': 'http2', 'node:tls': 'tls', 'tls': 'tls',
  'node:dns': 'dns', 'dns': 'dns', 'node:dns/promises': 'dns', 'dns/promises': 'dns',
  'node:child_process': 'child_process', 'child_process': 'child_process',
  'node:fs': 'fs', 'fs': 'fs', 'node:fs/promises': 'fs', 'fs/promises': 'fs'
};

function lineOf(text, idx) {
  let l = 1;
  for (let k = 0; k < idx && k < text.length; k++) if (text.charCodeAt(k) === 10) l++;
  return l;
}

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, acc); continue; }
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) continue;
    if (/\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(e.name) || /\.d\.ts$/.test(e.name)) continue;
    acc.push(p);
  }
  return acc;
}

const files = walk(ENGINE, []).sort();
const hits = [];
const raw = new Map();

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  const code = stripComments(text);
  const rawLines = text.split('\n');
  raw.set(rel, rawLines);
  const push = (ctrl, idx, rule, sev) => {
    const ln = lineOf(code, idx);
    hits.push({
      ctrl, file: rel, line: ln, rule, severity: sev || 'FAIL',
      evidence: (rawLines[ln - 1] || '').trim().slice(0, 150)
    });
  };

  // E1 + E4 : specificateurs d'import
  const specRe = [
    /\bfrom\s*['"]([^'"\n]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /^[ \t]*import\s*['"]([^'"\n]+)['"]/gm
  ];
  const seen = new Set();
  for (const re of specRe) {
    let m;
    while ((m = re.exec(code)) !== null) {
      const spec = m[1];
      const key = m.index + ':' + spec;
      if (seen.has(key)) continue;
      seen.add(key);
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      // type-only : on remonte a l'instruction `import` COURANTE (la derniere
      // avant le `from`), pas a une fenetre glissante : sinon un `import type`
      // de la ligne precedente blanchirait l'import de valeur suivant.
      const before = code.slice(Math.max(0, m.index - 2000), m.index);
      const lastImp = before.lastIndexOf('import');
      const stmt = lastImp >= 0 ? before.slice(lastImp) : '';
      let typeOnly = /^import\s+type\b/.test(stmt);
      const brace = stmt.match(/^import\s*(?:type\s*)?\{([^}]*)\}/);
      if (!typeOnly && brace) {
        const items = brace[1].split(',').map(s => s.trim()).filter(Boolean);
        typeOnly = items.length > 0 && items.every(s => /^type\s+\w/.test(s));
      }
      if (FORBIDDEN_MODULE[spec]) {
        push('E1', m.index, (typeOnly ? 'import-type-interdit(' : 'import-interdit(') + spec + ')',
             typeOnly ? 'WARN' : 'FAIL');
      } else if (!spec.startsWith('node:')) {
        push('E4', m.index, 'dep-non-declaree(' + spec + ')');
      }
    }
  }

  // E2 : acces fichier par appel
  const fsCall = /\b(readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rmSync|rmdir|unlink|unlinkSync|existsSync|openSync|createReadStream|createWriteStream|readdir|readdirSync|statSync)\s*\(/g;
  let m2;
  while ((m2 = fsCall.exec(code)) !== null) push('E2', m2.index, 'appel-fs(' + m2[1] + ')');

  // E3 : minuteries
  const timer = /\b(setInterval|setTimeout|setImmediate)\s*\(/g;
  let m3;
  while ((m3 = timer.exec(code)) !== null) push('E3', m3.index, 'minuterie(' + m3[1] + ')');

  // E5 : reseau / eval par API globale
  const glob = /(^|[^.\w$])(fetch|XMLHttpRequest|navigator\s*\.\s*sendBeacon|eval|Function)\s*[(`]/g;
  let m4;
  while ((m4 = glob.exec(code)) !== null) {
    const what = m4[2] === 'Function' ? 'new Function' : m4[2];
    push('E5', m4.index + m4[1].length, 'api-globale(' + what + ')');
  }
}

// E4 : ne garder que les paquets reellement non declares
let pkgOk = true;
const declared = new Set();
try {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
    for (const name of Object.keys(pkg[k] || {})) declared.add(name);
} catch (e) { pkgOk = false; }

for (const h of hits) {
  if (h.ctrl !== 'E4') continue;
  const name = h.rule.slice('dep-non-declaree('.length, -1);
  const segs = name.split('/');
  const pkgName = name.startsWith('@') ? segs.slice(0, 2).join('/') : segs[0];
  if (!pkgOk || declared.has(name) || declared.has(pkgName)) h.drop = true;
}

const kept = hits.filter(h => !h.drop);
const byCtrl = { E1: [], E2: [], E3: [], E4: [], E5: [] };
for (const h of kept) byCtrl[h.ctrl].push(h);

const fmt = (h) => '  ' + h.file + ':' + h.line + '  ' + h.evidence;
const TITLES = {
  E1: 'imports de valeur interdits (electron / ws / net / dgram / http / tls / dns / remote)',
  E2: 'accès au système de fichiers',
  E3: 'minuteries créées dans le moteur (horloge non injectée)',
  E4: 'dépendances npm importées mais non déclarées dans package.json',
  E5: 'réseau ou eval par API globale (fetch / XHR / WebSocket / eval)'
};
let fails = 0, warns = 0, skips = 0;
for (const ctrl of ['E1', 'E2', 'E3', 'E4', 'E5']) {
  const list = byCtrl[ctrl];
  if (ctrl === 'E4' && !pkgOk) {
    skips++;
    console.log('[SKIP] ' + ctrl + ' package.json illisible ou absent : déclaration des paquets non vérifiable');
    continue;
  }
  const hard = list.filter(h => h.severity === 'FAIL');
  const soft = list.filter(h => h.severity === 'WARN');
  if (hard.length === 0 && soft.length === 0) {
    console.log('[OK]   ' + ctrl + ' ' + TITLES[ctrl] + ' — aucune occurrence');
    continue;
  }
  if (hard.length > 0) {
    fails++;
    console.log('[ECHEC] ' + ctrl + ' ' + TITLES[ctrl] + ' — ' + hard.length + ' occurrence(s)');
    for (const h of hard) console.log(fmt(h) + '   [' + h.rule + ']');
  }
  if (soft.length > 0) {
    warns += soft.length;
    console.log('[AVERT] ' + ctrl + ' ' + soft.length + ' import(s) de TYPE seulement (effacés à la compilation, à relire) :');
    for (const h of soft) console.log(fmt(h) + '   [' + h.rule + ']');
  }
  if (hard.length === 0 && soft.length > 0) {
    console.log('[OK]   ' + ctrl + ' aucun import de valeur interdit (' + soft.length + ' type-only tolérés)');
  }
}
console.log('SUMMARY\t' + JSON.stringify({ files: files.length, fails, warns, skips }));
NODE_EOF
)

OUT=$(node -e "$NODE_SRC" "$ROOT" 2>&1)
RC=$?
if [ "$RC" -ne 0 ]; then
  echo ""
  echo "[ECHEC] E0  l'analyseur node a échoué (code $RC) :"
  printf '%s\n' "$OUT" | sed 's/^/  | /'
  echo "--- résumé ---"
  echo "fichiers=$NFILES échecs=1 avertissements=0 skips=0"
  printf 'CHECK_ENGINE RESULT=FAIL files=%s reason=analyseur-node-en-erreur rc=%s\n' "$NFILES" "$RC"
  exit 1
fi

printf '%s\n' "$OUT" | grep -v '^SUMMARY'
SUM=$(printf '%s\n' "$OUT" | grep '^SUMMARY' | tail -1 | sed 's/^SUMMARY\t//')
NF=$(printf '%s' "$SUM" | sed 's/.*"files":\([0-9]*\).*/\1/')
NF_FAIL=$(printf '%s' "$SUM" | sed 's/.*"fails":\([0-9]*\).*/\1/')
NF_WARN=$(printf '%s' "$SUM" | sed 's/.*"warns":\([0-9]*\).*/\1/')
NF_SKIP=$(printf '%s' "$SUM" | sed 's/.*"skips":\([0-9]*\).*/\1/')

echo "--- résumé ---"
echo "modules analysés=$NF échecs=$NF_FAIL avertissements=$NF_WARN skips=$NF_SKIP"
if [ "$NF_FAIL" -gt 0 ]; then
  printf 'CHECK_ENGINE RESULT=FAIL files=%s failures=%s warnings=%s skips=%s\n' "$NF" "$NF_FAIL" "$NF_WARN" "$NF_SKIP"
  exit 1
fi
printf 'CHECK_ENGINE RESULT=PASS files=%s failures=0 warnings=%s skips=%s\n' "$NF" "$NF_WARN" "$NF_SKIP"
exit 0
