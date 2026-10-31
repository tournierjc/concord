/**
 * main-timers.node.test.ts — la porte unique des minuteries du processus principal (T21 / SPEC-012 §4).
 *
 * Ce que ce fichier garde, et pourquoi deux familles d'assertions :
 *
 *   1. LE COMPORTEMENT du port (`src/main/timers.ts`) : une échéance qui arrive, une cadence qui
 *      arrive PLUSIEURS fois et que `cancel` arrête vraiment, un `cancel` idempotent et tolérant à
 *      un jeton étranger, et surtout l'`unref` armé pour les deux formes — c'est la raison d'être du
 *      port (deux des quatre sites d'origine l'armaient à la main, deux l'oubliaient).
 *
 *   2. LA ROUTE STATIQUE des quatre sites migrés. Un port que personne n'appelle ne coûte rien et
 *      ne prouve rien : A3/A4 de SPEC-012 §4 sont des mesures de TEXTE du dépôt. On lit donc les
 *      sources : les appels ambiants n'existent que dans deux fichiers (un par processus), et
 *      chacun des quatre modules du main arme bien son échéance/cadence par `timers.*`.
 *      Ces assertions ne peuvent pas être satisfaites en remettant un `setTimeout` local : c'est
 *      exactement la régression qu'on veut voir rouge.
 *
 * Note de contrat : `MainTimers` ÉTEND `Timers` (moteur) et n'ajoute que `repeat`. Le moteur ne
 * poll jamais ; le main a une cadence légitime (curseur de l'overlay, seul moyen de laisser passer
 * les clics hors des avatars). On vérifie ici que `repeat` reste l'unique extension, pour que
 * l'élargissement ne dérive pas.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/main-timers.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { NO_MAIN_TIMERS, systemTimers, type MainTimers } from '../src/main/timers.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src');

// ---------------------------------------------------------------------------- helpers de lecture

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Les lignes qui sont du CODE : un commentaire qui nomme `setTimeout(` ne compte pas. */
function codeLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('//') &&
        !line.startsWith('*') &&
        !line.startsWith('/*'),
    );
}

/** Chemin relatif au dépôt, séparateurs `/` (stable quelle que soit la plateforme). */
function rel(path: string): string {
  return relative(ROOT, path).split('\\').join('/');
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((path) => codeLines(path).some((line) => pattern.test(line)))
    .map(rel)
    .sort();
}

/** Attend `ms` réels : ces tests mesurent une horloge, pas une simulation. */
function sleep(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

function hasRef(handle: unknown): boolean | null {
  if (typeof handle !== 'object' || handle === null) return null;
  if (!('hasRef' in handle)) return null;
  const candidate = handle as { hasRef?: () => boolean };
  return typeof candidate.hasRef === 'function' ? candidate.hasRef() : null;
}

// ------------------------------------------------------------------------ 1. le port, au réel

// ------------------------------------------------------------------------ 0. l'instant, au routage

describe('A9 — l’horloge de lecture est un port, elle aussi', () => {
  it('`Date.now(` n’est lu que dans la porte du main', () => {
    assert.deepEqual(
      filesMatching(/\bDate\.now\s*\(/),
      ['src/main/timers.ts'],
      'une lecture ambiante de l’instant hors de la porte rend le temps non injectable : ' +
        'un test d’expiration doit pouvoir figer le temps sans monkey-patching',
    );
  });

  it('les deux sites de datation du main passent par le port', () => {
    for (const name of ['src/main/index.ts', 'src/main/discovery-bridge.ts']) {
      const code = codeLines(resolve(ROOT, name)).join('\n');
      assert.match(code, /(?:systemTimers|timers)\.now\(\)/, `${name} date par le port`);
      assert.ok(!/\bDate\.now\s*\(/.test(code), `${name} ne lit plus l’instant en direct`);
    }
  });
});

describe('systemTimers — échéance', () => {
  it('once : la callback part une fois, et le jeton ne retient pas le processus', async () => {
    let calls = 0;
    const handle = systemTimers.once(5, () => {
      calls += 1;
    });

    // L'`unref` est la raison d'être du port : sans lui, une pastille PTT en vol retiendrait
    // Electron à la fermeture. `hasRef()` est la mesure, pas une intention.
    assert.equal(hasRef(handle), false, 'unref non armé sur once');

    await sleep(40);
    assert.equal(calls, 1, 'once doit partir exactement une fois');
  });

  it('once : cancel avant échéance empêche la callback', async () => {
    let calls = 0;
    const handle = systemTimers.once(30, () => {
      calls += 1;
    });
    systemTimers.cancel(handle);
    await sleep(60);
    assert.equal(calls, 0, 'une échéance désarmée ne doit pas partir');
  });
});

describe('systemTimers — cadence', () => {
  it('repeat : la callback part plusieurs fois, et cancel l’arrête', async () => {
    let calls = 0;
    const handle = systemTimers.repeat(5, () => {
      calls += 1;
    });

    // Le désarmement est dans un `finally` : si l'assertion d'`unref` tombe (mutant M2), la cadence
    // n'est pas laissée armée, sinon le runner lui-même ne rendrait jamais la main et le rouge
    // arriverait par expiration du délai au lieu de l'assertion. Un banc qui se bloque n'apprend
    // rien ; un banc qui nomme son assertion, si.
    let fired = 0;
    try {
      assert.equal(hasRef(handle), false, 'unref non armé sur repeat');
      await sleep(60);
      fired = calls;
      assert.ok(fired >= 2, `repeat doit se répéter (mesuré ${fired})`);
    } finally {
      systemTimers.cancel(handle);
    }

    await sleep(40);
    assert.ok(calls - fired <= 1, 'cancel doit arrêter la cadence (au plus le tour en cours)');
  });
});

describe('systemTimers — cancel', () => {
  it('est idempotent et tolère un jeton étranger', () => {
    const handle = systemTimers.once(5, () => {});
    assert.doesNotThrow(() => systemTimers.cancel(handle));
    assert.doesNotThrow(() => systemTimers.cancel(handle));
    assert.doesNotThrow(() => systemTimers.cancel(null));
    assert.doesNotThrow(() => systemTimers.cancel(undefined));
    assert.doesNotThrow(() => systemTimers.cancel(42));
    assert.doesNotThrow(() => systemTimers.cancel('jeton'));
  });

  it('now : un instant croissant, et une horloge inerte qui n’avance pas', async () => {
    const before = systemTimers.now();
    assert.equal(typeof before, 'number');
    assert.ok(Number.isFinite(before), 'un instant fini, pas NaN');
    assert.ok(before > 1_600_000_000_000, 'epoch en millisecondes, pas un compteur relatif');
    await sleep(5);
    assert.ok(systemTimers.now() >= before, 'l’instant ne recule jamais');
    // Horloge inerte : temps figé, et deux lectures successives restent égales — un producteur qui
    // date par `NO_MAIN_TIMERS` ne peut donc pas simuler une péremption par accident.
    assert.equal(NO_MAIN_TIMERS.now(), NO_MAIN_TIMERS.now());
  });

  it('NO_MAIN_TIMERS n’arme aucune échéance réelle', async () => {
    let calls = 0;
    const fire = (): void => {
      calls += 1;
    };
    const onceToken = NO_MAIN_TIMERS.once(1, fire);
    const repeatToken = NO_MAIN_TIMERS.repeat(1, fire);
    assert.equal(hasRef(onceToken) ?? null, null, 'pas de jeton réel attendu');
    assert.doesNotThrow(() => NO_MAIN_TIMERS.cancel(onceToken));
    assert.doesNotThrow(() => NO_MAIN_TIMERS.cancel(repeatToken));
    await sleep(20);
    assert.equal(calls, 0, 'l’horloge inerte ne doit rien déclencher');
  });
});

describe('MainTimers — forme du contrat', () => {
  it('n’ajoute que `repeat` et `now` à `Timers` : une échéance, une cadence, un désarmement, un instant', () => {
    const port: MainTimers = systemTimers;
    assert.equal(typeof port.once, 'function');
    assert.equal(typeof port.repeat, 'function');
    assert.equal(typeof port.cancel, 'function');
    assert.equal(typeof port.now, 'function');
    const extra = Object.keys(port).filter(
      (key) => key !== 'once' && key !== 'repeat' && key !== 'cancel' && key !== 'now',
    );
    assert.deepEqual(extra, [], `le port a grossi : ${extra.join(', ')}`);
  });
});

// ----------------------------------------------------------------- 2. la route, mesurée au texte

describe('SPEC-012 §4 — la porte unique, mesurée dans les sources', () => {
  const AMBIENT = /\bset(Timeout|Interval)\s*\(/;

  it('A3 : les appels ambiants n’existent que dans une porte par processus', () => {
    assert.deepEqual(filesMatching(AMBIENT), [
      'src/main/timers.ts',
      'src/renderer/browser-timers.ts',
    ]);
  });

  it('A4 : `setInterval` n’existe que dans la porte du main (une seule cadence légitime)', () => {
    assert.deepEqual(filesMatching(/\bsetInterval\s*\(/), ['src/main/timers.ts']);
  });

  it('`unref` et les désarmements bruts ne sortent pas de `src/main/timers.ts`', () => {
    const mainFiles = sourceFiles(resolve(SRC, 'main')).map((path) => ({
      path: rel(path),
      lines: codeLines(path),
    }));
    for (const file of mainFiles) {
      if (file.path === 'src/main/timers.ts') continue;
      for (const line of file.lines) {
        assert.ok(!/clea(r|a)r?Timeout\s*\(/.test(line), `clearTimeout brut dans ${file.path}`);
        assert.ok(!/\bclearInterval\s*\(/.test(line), `clearInterval brut dans ${file.path}`);
        assert.ok(!/\.unref\s*\(/.test(line), `unref recopié dans ${file.path}`);
      }
    }
  });

  it('les quatre sites du main passent par le port, aucun ne réarme en local', () => {
    const sites: Record<string, RegExp> = {
      'src/main/ptt.ts': /timers\.once\s*\(/,
      'src/main/signaling-link.ts': /timers\.once\s*\(/,
      'src/main/discovery-bridge.ts': /timers\.once\s*\(/,
      'src/main/overlay-controller.ts': /timers\.repeat\s*\(/,
    };
    for (const [file, arming] of Object.entries(sites)) {
      const lines = codeLines(resolve(ROOT, file));
      assert.ok(
        lines.some((line) => /from '\.\/timers'/.test(line)),
        `${file} n’importe pas la porte`,
      );
      assert.ok(
        lines.some((line) => arming.test(line)),
        `${file} n’arme pas par le port (${arming})`,
      );
      assert.ok(!lines.some((line) => AMBIENT.test(line)), `${file} porte un minuteur ambiant`);
    }
  });

  it('les trois cadences/échéances désarmables désarment par `timers.cancel`', () => {
    for (const file of [
      'src/main/signaling-link.ts',
      'src/main/discovery-bridge.ts',
      'src/main/overlay-controller.ts',
    ]) {
      const lines = codeLines(resolve(ROOT, file));
      assert.ok(
        lines.some((line) => /timers\.cancel\s*\(/.test(line)),
        `${file} n’a pas de désarmement par le port`,
      );
    }
  });
});
