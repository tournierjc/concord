#!/usr/bin/env node
// a8-confinement.mjs — A8 « comportemental » (AD-24 §4) : confinement de l'horloge ambiante.
//
// Ce que fait A8 historique (grep) : il apparie du TEXTE (`clearTimeout(` au début de ligne,
// hors commentaire). Un alias (`const c = clearTimeout; c(h)`) lui échappe alors que le
// comportement est identique ; un accès calculé (`globalThis['clearTimeout'](h)`) aussi.
//
// Ce que fait ce contrôle : il lit l'ARBRE SYNTAXIQUE (typescript, déjà dans node_modules) et
// relève les RÉFÉRENCES à l'horloge ambiante — identifiant nu, accès membre (`x.clearTimeout`),
// accès calculé par littéral (`x['clearTimeout']`), alias (la référence `clearTimeout` de la
// déclaration d'alias est relevée), liaison déstructurée. Commentaires et chaînes de caractères
// ordinaires ne rougissent pas : la prose ne compte pas, seule une référence compte.
//
// Usage : node a8-confinement.mjs <racine-du-dépôt>
// Sortie : une ligne par référence hors portes, puis CHECK_A8 RESULT=PASS|FAIL|SKIP
// Aucune écriture : lecture seule, stdout uniquement.

import { createRequire } from 'node:module'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.argv[2] ?? process.cwd()
const GATES = new Set(['src/main/timers.ts', 'src/renderer/browser-timers.ts'])
// Noms de l'horloge ambiante : c'est la matière d'A8 (unref(, clearTimeout(, clearInterval()
// et leurs jumeaux d'armement, qu'un mutant de confinement emploierait aussi).
const AMBIENT = new Set([
  'setTimeout', 'setInterval', 'setImmediate',
  'clearTimeout', 'clearInterval',
  'unref',
])

let ts
try {
  ts = createRequire(join(ROOT, 'package.json'))('typescript')
} catch {
  console.log('CHECK_A8 RESULT=SKIP reason=typescript-absent (node_modules/typescript introuvable)')
  process.exit(0)
}

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mts|cts)$/.test(e)) out.push(p)
  }
  return out
}

const files = walk(join(ROOT, 'src'))
if (files.length === 0) {
  console.log('CHECK_A8 RESULT=SKIP reason=src-absent')
  process.exit(0)
}

const hits = []
let parsed = 0

for (const abs of files) {
  const rel = relative(ROOT, abs).split(sep).join('/')
  const text = readFileSync(abs, 'utf8')
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  parsed++
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

  const visit = (node) => {
    if (ts.isIdentifier(node) && AMBIENT.has(node.text)) {
      // Un nom de propriété nu d'objet littéral ({ setTimeout: ... }) ou un nom de paramètre
      // ne référence pas l'horloge ambiante : on ne relève que ce qui peut la désigner.
      const p = node.parent
      const isPlainPropertyName =
        p && (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) &&
        p.name === node && !ts.isComputedPropertyName(p.name)
      // `x.clearTimeout` : le nom de la propriété est relevé par la branche « membre » ci-dessous.
      const isMemberName = p && ts.isPropertyAccessExpression(p) && p.name === node
      if (!isPlainPropertyName && !isMemberName) {
        hits.push({ rel, line: line(node), kind: 'ident', what: node.text, text: text.split('\n')[line(node) - 1].trim() })
      }
    } else if (ts.isPropertyAccessExpression(node) && AMBIENT.has(node.name.text)) {
      hits.push({ rel, line: line(node), kind: 'membre', what: node.name.text, text: text.split('\n')[line(node) - 1].trim() })
    } else if (ts.isElementAccessExpression(node) && node.argumentExpression &&
               ts.isStringLiteralLike(node.argumentExpression) && AMBIENT.has(node.argumentExpression.text)) {
      hits.push({ rel, line: line(node), kind: 'calculé', what: node.argumentExpression.text, text: text.split('\n')[line(node) - 1].trim() })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

const outside = hits.filter((h) => !GATES.has(h.rel))
const inside = hits.filter((h) => GATES.has(h.rel))

console.log(`# A8 comportemental — ${parsed} fichier(s) sous src/ analysés (AST), ${hits.length} référence(s) à l'horloge ambiante`)
for (const h of inside) console.log(`  porte   ${h.rel}:${h.line} [${h.kind}] ${h.what} :: ${h.text}`)
for (const h of outside) console.log(`  HORS-PORTE ${h.rel}:${h.line} [${h.kind}] ${h.what} :: ${h.text}`)

const files_out = [...new Set(outside.map((h) => h.rel))]
if (outside.length === 0) {
  console.log(`CHECK_A8 RESULT=PASS refs_hors_portes=0 portes=${[...GATES].join(',')} refs_dans_portes=${inside.length}`)
} else {
  console.log(`CHECK_A8 RESULT=FAIL refs_hors_portes=${outside.length} fichiers_hors_portes=${files_out.length} (${files_out.join(',')})`)
}
