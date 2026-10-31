/**
 * tests/engine-purity.test.ts — Carillon
 *
 * Garde-fou mécanique des contraintes de SPEC-004 sur `src/engine/**` :
 *   • aucun import de `electron`, `ws`, `node:*`, ni de paquet npm
 *   • aucun `require`, aucun `fetch`, aucun timer, aucune horloge
 *   • aucun accès navigateur (`navigator`, `window`, `document`, `RTCPeerConnection`)
 *   • TS « erasable » uniquement : pas d'`enum`, pas de `namespace`,
 *     pas de parameter properties
 *   • imports relatifs suffixés `.ts` (nécessaire pour `node --test` sans bundler)
 *
 * Si ce test passe, Banc peut mesurer C1 = 0 (zéro requête hors LAN) : le module
 * pur ne peut structurellement rien appeler dehors.
 *
 *   node --test tests/engine-purity.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ENGINE_DIR = join(HERE, '..', 'src', 'engine')

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full))
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Retire commentaires de bloc et de ligne : on ne veut juger que le code. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const FILES = listTsFiles(ENGINE_DIR)

/**
 * Modules navigateur, et les seules règles dont ils sont dispensés.
 *
 * Decision de PÉRIMÈTRE, pas trou dans le garde-fou : SPEC-005 §1.2 (T14) place
 * le plan média *dans la page Chromium* — `rtc/media-plane.ts` DOIT instancier
 * `RTCPeerConnection`, appeler `navigator.mediaDevices` et créer un `AudioContext`,
 * sinon il n'y a pas de voix du tout (constat Régie 01:26Z : 0 occurrence de
 * `RTCPeerConnection` dans un `.ts`). Toutes les autres règles SPEC-004 restent
 * appliquées à ce fichier (aucune API Node, aucun import npm, TS erasable), et
 * le bloc « plan média » plus bas le contre-vérifie mécaniquement.
 */
const BROWSER_MODULES = new Set<string>([join('rtc', 'media-plane.ts')])

const BROWSER_ONLY_RULES = new Set<string>(['accès navigator', 'RTCPeerConnection', 'AudioContext'])

const FORBIDDEN: Array<[string, RegExp]> = [
  ['import de electron', /from\s+['"]electron['"]/],
  ['import de ws', /from\s+['"]ws['"]/],
  ['import d’un module node:', /from\s+['"]node:/],
  ['import d’un paquet npm nu', /from\s+['"][^.'"][^'"]*['"]/],
  ['require()', /\brequire\s*\(/],
  ['appel réseau fetch', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['timer setTimeout/setInterval', /\bset(Timeout|Interval|Immediate)\s*\(/],
  ['horloge Date.now()', /\bDate\.now\s*\(/],
  ['accès navigator', /(?<![.\w])navigator\./],
  ['accès window', /(?<![.\w])window\./],
  ['accès document', /(?<![.\w])document\./],
  ['RTCPeerConnection', /\bRTCPeerConnection\b/],
  ['AudioContext', /\bAudioContext\b/],
  ['AudioWorklet', /\bAudioWorkletNode\b/],
  ['enum (non erasable)', /\benum\s+[A-Za-z_$]/],
  ['namespace (non erasable)', /\bnamespace\s+[A-Za-z_$]/],
  ['parameter property (non erasable)', /constructor\s*\([^)]*\b(private|public|protected|readonly)\s+[A-Za-z_$]/],
]

describe('engine — pureté (SPEC-004)', () => {
  it('trouve les modules du moteur', () => {
    assert.ok(FILES.length >= 4, `modules trouvés : ${FILES.length}`)
    assert.ok(
      FILES.some((file) => file.endsWith(join('rtc', 'ice-filter.ts'))),
      'src/engine/rtc/ice-filter.ts doit exister'
    )
  })

  for (const file of FILES) {
    const name = relative(ENGINE_DIR, file)
    const code = stripComments(readFileSync(file, 'utf8'))
    const browserModule = BROWSER_MODULES.has(name)

    for (const [label, pattern] of FORBIDDEN) {
      if (browserModule && BROWSER_ONLY_RULES.has(label)) continue
      it(`${name} — pas de ${label}`, () => {
        const match = pattern.exec(code)
        assert.equal(
          match,
          null,
          `${name} : « ${label} » interdit dans src/engine (trouvé : ${match?.[0] ?? ''})`
        )
      })
    }

    it(`${name} — imports relatifs suffixés .ts`, () => {
      const imports = [...code.matchAll(/from\s+['"](\.[^'"]*)['"]/g)].map((m) => m[1] as string)
      for (const specifier of imports) {
        assert.ok(
          specifier.endsWith('.ts'),
          `${name} : import relatif « ${specifier} » sans extension .ts (node --test ne résoudra pas)`
        )
      }
    })
  }
})

describe('engine — plan média (SPEC-005 §2, module navigateur)', () => {
  const MEDIA_PLANE = join(ENGINE_DIR, 'rtc', 'media-plane.ts')
  const source = readFileSync(MEDIA_PLANE, 'utf8')
  const code = stripComments(source)

  it('existe et instancie une RTCPeerConnection (la voix peut exister)', () => {
    assert.ok(
      /new\s+RTCPeerConnection\s*\(/.test(code),
      'media-plane.ts doit créer une RTCPeerConnection : sans elle le produit est un chat sans voix'
    )
  })

  it('expose le contrat gelé §2', async () => {
    const mod: Record<string, unknown> = await import('../src/engine/rtc/media-plane.ts')
    assert.equal(typeof mod['createMediaPlane'], 'function', 'createMediaPlane doit être exporté')
    for (const name of ['MediaPlaneOptions', 'PeerStats', 'MediaPlane']) {
      assert.ok(source.includes(`interface ${name}`), `l'interface ${name} doit être déclarée`)
    }
  })

  it('n’utilise AUCUNE API Node (renderer = page Chromium)', () => {
    for (const [label, pattern] of [
      ['require()', /\brequire\s*\(/],
      ['import node:', /from\s+['"]node:/],
      ['Buffer', /\bBuffer\b/],
      ['process.', /(?<![.\w])process\./],
      ['__dirname/__filename', /\b__(dirname|filename)\b/],
      ['import npm', /from\s+['"][^.'"][^'"]*['"]/],
    ] as Array<[string, RegExp]>) {
      assert.equal(pattern.exec(code), null, `media-plane.ts ne doit pas utiliser ${label}`)
    }
  })

  it('zéro `as`, zéro assertion non-nulle `!`, zéro @ts-ignore (C12-3 durci)', () => {
    assert.equal(/\bas\s+[A-Za-z_$({[]/.test(code), false, 'cast `as` interdit')
    assert.equal(/[A-Za-z0-9_$)\]]!(?!=)/.test(code), false, 'assertion non-nulle `!` interdite')
    assert.equal(
      /(\/\/[ \t]*@ts-(ignore|expect-error|nocheck))|(\/\*[ \t]*@ts-)/.test(source),
      false,
      'contournement de typage interdit'
    )
  })

  it('réutilise ice-filter.ts au lieu de dupliquer le filtre LAN', () => {
    assert.ok(
      /from\s+['"]\.\/ice-filter\.ts['"]/.test(code),
      'media-plane.ts doit importer isLanCandidate depuis ./ice-filter.ts'
    )
    assert.ok(/\bisLanCandidate\s*\(/.test(code), 'isLanCandidate doit être appelé sur les candidats')
  })

  it('ne contient aucun serveur STUN/TURN (zéro sortie hors LAN)', () => {
    assert.equal(/stun:|turn:|stuns:|turns:/.test(code), false, 'aucun URI STUN/TURN ne doit apparaître')
  })
})

describe('engine — contrat gelé de ice-filter', () => {
  it('expose exactement isLanCandidate et filterLanCandidates', async () => {
    const mod: Record<string, unknown> = await import('../src/engine/rtc/ice-filter.ts')
    const isLan = mod['isLanCandidate'] as ((candidate: string) => boolean) | undefined
    const filter = mod['filterLanCandidates'] as ((list: unknown[]) => unknown[]) | undefined
    assert.equal(typeof isLan, 'function')
    assert.equal(typeof filter, 'function')
    assert.equal(isLan?.length, 1, 'isLanCandidate prend un argument')
    assert.equal(filter?.length, 1, 'filterLanCandidates prend un argument')
  })
})
