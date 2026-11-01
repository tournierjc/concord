/**
 * tests/verify-build.node.test.ts — the build guard catches the defect that shipped in v0.4.0.
 *
 * v0.4.0 packaged a preload built from older sources (no `onDiscoveryStatus`, `onUpdateState`,
 * `setDucking`…): the renderer threw on its first render and the window stayed empty. The guard
 * must (1) see every `LanAPI` method in a freshly built preload, and (2) reject a preload that
 * lacks one.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// @ts-expect-error — plain ESM script without type declarations
import { lanApiMethods, missingPreloadMethods } from '../scripts/verify-build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workDir = mkdtempSync(join(tmpdir(), 'concord-verify-'));
const outfile = join(workDir, 'preload.js');

after(() => rmSync(workDir, { recursive: true, force: true }));

describe('verify-build — preload/LanAPI parity', () => {
  const build = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-preload.mjs'), '--outfile', outfile], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  it('reads the LanAPI methods from the contract', () => {
    const methods: string[] = lanApiMethods();
    assert.ok(methods.length >= 25, `only ${methods.length} methods parsed`);
    for (const name of ['onDiscoveryStatus', 'onUpdateState', 'setDucking', 'joinRoom']) {
      assert.ok(methods.includes(name), `${name} not parsed`);
    }
  });

  it('a fresh preload exposes every LanAPI method', () => {
    assert.equal(build.status, 0, build.stderr);
    assert.deepEqual(missingPreloadMethods(readFileSync(outfile, 'utf8')), []);
  });

  it('a stale preload (method removed) is rejected', () => {
    const stale = readFileSync(outfile, 'utf8').replace(/\bonDiscoveryStatus\s*:/, 'removedMethod:');
    assert.deepEqual(missingPreloadMethods(stale), ['onDiscoveryStatus']);
  });
});
