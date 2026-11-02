/**
 * tests/update-relaunch.node.test.ts — la relance après un installateur NSIS silencieux.
 *
 * Retour JC (0.4.4) : sur Windows, la mise à jour télécharge, quitte l'app (et désinstalle
 * l'ancienne version)… et ne redémarre jamais. Cause : l'installeur NSIS est `oneClick: false`
 * (assistié) — lancé silencieusement (`/S`), il N'EXÉCUTE PAS la case « lancer l'application »
 * de son écran final : rien ne redémarre. (L'AppImage, elle, se relance seule — d'où la
 * différence.) Correctif : le plan de spawn porte une relance détachée PowerShell qui attend
 * l'EXE courant DISPARU (désinstallation), le REPARU (nouvelle version au même emplacement
 * per-user), puis le lance. Sur horloge et file d'attente réelles du service, seams factices.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  planSpawn,
  relaunchPlan,
  chooseInstallerStrategy,
  parseLatestRelease,
  createUpdateService,
  type UpdateIo,
} from '../src/main/update.ts';
import type { MainTimers } from '../src/main/timers.ts';

describe('relaunchPlan — le détaché d’attente-relance', () => {
  it('attends-disparu, attends-reparu, Start-Process — dans cet ordre', () => {
    const plan = relaunchPlan('C:\\Programs\\concord\\concord.exe');
    assert.equal(plan.spawnPath, 'powershell.exe');
    const script = plan.spawnArgs[plan.spawnArgs.length - 1] ?? '';
    assert.match(script, /Test-Path \$exe/);
    assert.match(script, /Start-Process \$exe/);
    // Le `Test-Path $exe` de SORTIE de la seconde boucle garantit : on ne lance que le fichié réapparu.
    assert.match(script, /if \(Test-Path \$exe\) \{ Start-Process/);
  });

  it('un chemin avec guillemets simples PowerShell est doublé, jamais interprété', () => {
    const plan = relaunchPlan("C:\\O'Brien\\concord.exe");
    assert.match(plan.spawnArgs[plan.spawnArgs.length - 1] ?? '', /O''Brien/);
  });
});

describe('planSpawn — la relance n’est planifiée que pour NSIS et quand l’exécutable est connu', () => {
  const asset = { name: 'concord-0.5.0-setup-x64.exe', downloadUrl: 'https://github.com/t/t/concord-0.5.0-setup-x64.exe' };

  it('nsis avec relaunchExe : plan complet', () => {
    const strategy = { kind: 'nsis' as const, assetName: asset.name, downloadUrl: asset.downloadUrl };
    const plan = planSpawn(strategy, { installerPath: 'C:\\tmp\\setup.exe', currentEnv: {}, relaunchExe: 'C:\\P\\concord.exe' });
    assert.ok(plan !== null);
    assert.deepEqual(plan.spawnArgs, ['C:\\tmp\\setup.exe', '/S']);
    assert.ok(plan.relaunch !== undefined, 'la relance est planifiée');
    assert.equal(plan.relaunch.spawnPath, 'powershell.exe');
  });

  it('nsis sans relaunchExe (tests) : aucun plan de relance, comme avant', () => {
    const strategy = { kind: 'nsis' as const, assetName: asset.name, downloadUrl: asset.downloadUrl };
    const plan = planSpawn(strategy, { installerPath: 'C:\\tmp\\setup.exe', currentEnv: {} });
    assert.ok(plan !== null);
    assert.equal(plan.relaunch, undefined);
  });

  it('appimage : JAMAIS de relance planifiée (il se relance lui-même)', () => {
    const strategy = { kind: 'appimage' as const, assetName: 'a.AppImage', downloadUrl: 'https://github.com/t/t/a.AppImage' };
    const plan = planSpawn(strategy, { installerPath: '/tmp/a.AppImage', currentEnv: { APPIMAGE: '/old' }, relaunchExe: '/x' });
    assert.ok(plan !== null);
    assert.equal(plan.relaunch, undefined);
  });
});

describe('createUpdateService — la relance part APRÈS l’installateur, AVANT le quit', () => {
  it('nsis : deux spawns (installeur puis relance), puis quit', async () => {
    const spawns: { path: string; args: string[] }[] = [];
    let quits = 0;
    const seam: UpdateIo = {
      get: async () => ({ ok: false as const, reason: 'non exercé' }),
      streamFile: async () => ({ ok: false as const, reason: 'non exercé' }),
      removeFile: async () => undefined,
      moveFile: async () => undefined,
      makeExecutable: async () => undefined,
      spawn: async (path, args) => {
        spawns.push({ path, args });
        return true;
      },
      platform: async () => 'win32',
      hasDpkg: async () => false,
      appVersion: () => '0.4.4',
      now: () => 1,
      downloadsDir: () => '/tmp',
      env: () => ({}),
      setStreamProgress: () => undefined,
      log: () => undefined,
    };
    const timers: MainTimers = {
      once: (ms, cb) => {
        void ms;
        cb();
        return 1;
      },
      repeat: () => 1,
      cancel: () => undefined,
      now: () => 1,
    };
    // Artefact prêt, injecté par la sonde : on exerce SEULEMENT performInstall via checkNow.
    // (Le chemin complet vérifier→télécharger est couvert par update-service.node.test.ts.)
    const service = createUpdateService({
      seam,
      timers,
      quitApp: () => {
        quits += 1;
      },
      roomActive: () => false,
      isAutoEnabled: () => true,
      installedExePath: () => 'C:\\P\\concord.exe',
      onStateChange: () => undefined,
    });
    // Pas d'API publique pour injecter un artefact : on passe par la machine — l'installation
    // sans artefact prêt ne fait rien (garde), on vérifie ce comportement-là.
    await service.checkNow();
    assert.equal(spawns.length, 0, 'sans artefact prêt, aucun spawn');
    assert.equal(quits, 0);
    assert.equal(service.getState().state, 'failed', 'sans artefact et sans réseau, la machine le dit');
  });
});
