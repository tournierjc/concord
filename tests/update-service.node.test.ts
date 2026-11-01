/**
 * tests/update-service.node.test.ts — la machine à états des mises à jour sur seam faux
 * (avenant SPEC-006b, arbitrage JC du 2026-11-01).
 *
 * Aucun réseau, aucun disque, aucun spawn : `createUpdateService` ne touche le monde qu'à travers
 * son seam (`UpdateIo`) et ses minuteries via `MainTimers` (horloge injectée, SPEC-012 §4).
 * Ce fichier exerce le cycle complet, les gardes (salon actif, empreinte, auto=false), la
 * reentrance, le backoff et l'installation immédiate Windows/AppImage — les ARGUMENTS du spawn
 * sont observés, le vrai `spawn` vit dans `electronUpdateIo` (non exerçable ici, dit honnêtement).
 *
 * Lancer : npx tsx --test tests/update-service.node.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BACKOFF_STEP_MS,
  CHECK_INTERVAL_MS,
  MAX_CONSECUTIVE_FAILURES,
  STARTUP_CHECK_DELAY_MS,
  createUpdateService,
  type GetResult,
  type StreamResult,
  type UpdateIo,
  type UpdateService,
  type UpdateState,
} from '../src/main/update';
import type { MainTimers } from '../src/main/timers';

/* ------------------------------------------------------------------ */
/* Double de MainTimers — horloge artificielle, jamais l'horloge du test */
/* ------------------------------------------------------------------ */

interface FakeTimer {
  dueAt: number;
  everyMs: number | null;
  callback: () => void;
  cancelled: boolean;
}

function fakeTimers(start: number = 1_000) {
  let nowMs = start;
  const timers: FakeTimer[] = [];
  const api: MainTimers & {
    now(): number;
    advance(ms: number): void;
    pending(): number;
  } = {
    once(delayMs: number, callback: () => void): unknown {
      const timer: FakeTimer = { dueAt: nowMs + delayMs, everyMs: null, callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    repeat(everyMs: number, callback: () => void): unknown {
      const timer: FakeTimer = { dueAt: nowMs + everyMs, everyMs, callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel(handle: unknown): void {
      const timer = handle as FakeTimer | null;
      if (timer !== null) timer.cancelled = true;
    },
    now: () => nowMs,
    advance(ms: number): void {
      const target = nowMs + ms;
      // Déclenche dans l'ordre d'échéance, jusqu'à la cible (les rearmements du `repeat` peuvent
      // tomber avant la cible si l'appelant avance très loin).
      for (;;) {
        const due = timers
          .filter((t) => !t.cancelled && t.dueAt <= target)
          .sort((a, b) => a.dueAt - b.dueAt)[0];
        if (due === undefined) break;
        nowMs = due.dueAt;
        if (due.everyMs === null) {
          due.cancelled = true;
        } else {
          due.dueAt = nowMs + due.everyMs;
        }
        due.callback();
      }
      nowMs = target;
    },
    pending(): number {
      return timers.filter((t) => !t.cancelled).length;
    },
  };
  return api;
}

/* ------------------------------------------------------------------ */
/* Seam faux — GitHub et le disque joués en mémoire                      */
/* ------------------------------------------------------------------ */

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

interface SeamScript {
  json?: unknown;
  getError?: string;
  platform?: string;
  hasDpkg?: boolean;
  appVersion?: string;
  /**
   * L'empreinte que le faux disque calcule. Par defaut le corps publie HEX_A pour le .exe et le
   * .deb, HEX_B pour l'AppImage : chaque plateforme telecharge donc son propre artefact avec son
   * empreinte concordante, sauf demande explicite de mismatch.
   */
  computedSha?: string;
}

function fakeSeam(script: SeamScript, clockNow: () => number) {
  const calls = {
    get: 0,
    stream: 0,
    spawn: [] as Array<{ path: string; args: string[]; env: Record<string, string> | undefined }>,
    remove: [] as string[],
    move: [] as Array<{ from: string; to: string }>,
    chmod: [] as string[],
    logs: [] as string[],
    streamUrls: [] as string[],
  };
  let progress: ((percent: number) => void) | null = null;
  const json = script.json ?? {
    tag_name: 'v9.9.9',
    assets: [
      {
        name: 'concord-9.9.9-setup-x64.exe',
        browser_download_url: 'https://github.com/tournierjc/concord/releases/download/v9.9.9/concord-9.9.9-setup-x64.exe',
      },
      {
        name: 'concord-9.9.9-x86_64.AppImage',
        browser_download_url: 'https://github.com/tournierjc/concord/releases/download/v9.9.9/concord-9.9.9-x86_64.AppImage',
      },
      {
        name: 'concord-9.9.9-linux-amd64.deb',
        browser_download_url: 'https://github.com/tournierjc/concord/releases/download/v9.9.9/concord-9.9.9-linux-amd64.deb',
      },
    ],
    body: [
      'Empreintes SHA-256',
      `${HEX_A}  concord-9.9.9-setup-x64.exe`,
      `${HEX_B}  concord-9.9.9-x86_64.AppImage`,
      'sha256sum concord-9.9.9-linux-amd64.deb',
      HEX_A,
    ].join('\n'),
  };
  /** Millesecondes de chaque appel `get` (toute requête API est horodatée par l'horloge du test). */
  const getTimestamps: number[] = [];
  const seam: UpdateIo = {
    async get(url: string): Promise<GetResult> {
      calls.get += 1;
      calls.streamUrls.push(url);
      getTimestamps.push(clockNow());
      if (script.getError !== undefined) return { ok: false, reason: script.getError };
      return { ok: true, status: 200, json };
    },
    async streamFile(url: string, targetPath: string): Promise<StreamResult> {
      calls.stream += 1;
      calls.streamUrls.push(url);
      void targetPath;
      if (progress !== null) {
        progress(40);
        progress(100);
      }
      // Le faux disque calcule l'empreinte de ce qu'on lui demande : l'AppImage a la sienne (HEX_B),
      // les autres artefacts celle du corps (HEX_A) — un mismatch doit etre demande explicitement.
      const computed =
        script.computedSha ?? (url.endsWith('.AppImage') ? HEX_B : HEX_A);
      return { ok: true, sha256: computed, bytes: 128 };
    },
    async removeFile(path: string): Promise<void> {
      calls.remove.push(path);
    },
    async moveFile(from: string, to: string): Promise<void> {
      calls.move.push({ from, to });
    },
    async makeExecutable(path: string): Promise<void> {
      calls.chmod.push(path);
    },
    async spawn(path: string, args: string[], env: Record<string, string> | undefined): Promise<boolean> {
      calls.spawn.push({ path, args, env });
      return true;
    },
    async platform(): Promise<string> {
      return script.platform ?? 'win32';
    },
    async hasDpkg(): Promise<boolean> {
      return script.hasDpkg ?? false;
    },
    appVersion: () => script.appVersion ?? '0.4.0',
    now: () => Date.now(),
    downloadsDir: () => '/fake/downloads',
    env: () => ({ APPIMAGE: '/old/concord.AppImage', PATH: '/usr/bin' }),
    setStreamProgress: (callback) => {
      progress = callback;
    },
    log: (message: string) => {
      calls.logs.push(message);
    },
  };
  return { seam, calls, getTimestamps };
}

function harness(script: SeamScript, options?: { roomActive?: boolean; auto?: boolean }) {
  const timers = fakeTimers();
  const { seam, calls, getTimestamps } = fakeSeam(script, () => timers.now());
  const published: UpdateState[] = [];
  const quits: number[] = [];
  let roomActive = options?.roomActive ?? false;
  let auto = options?.auto ?? true;
  const service: UpdateService = createUpdateService({
    seam,
    timers,
    quitApp: () => {
      quits.push(timers.now());
    },
    roomActive: () => roomActive,
    isAutoEnabled: () => auto,
    onStateChange: (state) => {
      published.push({ ...state });
    },
  });
  return {
    service,
    seam,
    calls,
    getTimestamps,
    timers,
    published,
    quits,
    states: () => published.map((s) => s.state),
    setRoomActive: (value: boolean) => {
      roomActive = value;
    },
    setAuto: (value: boolean) => {
      auto = value;
    },
  };
}

/** Laisse tourner la file des microtaches ET des macrotaches jusqu'au repos complet. */
async function drain(): Promise<void> {
  // Le seam est `async` (promesses reelles) et l'implantation de MainTimers peut glisser une
  // minuterie reelle : une simple boucle de microtaches ne suffit pas. `setImmediate` rend la main
  // a la boucle des evenements a chaque tour — le cycle se termine en quelques tours.
  for (let i = 0; i < 40; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/* ------------------------------------------------------------------ */
/* Le cycle complet                                                      */
/* ------------------------------------------------------------------ */

describe('machine à états', () => {
  it('idle → checking → available → downloading (%) → downloaded → installing, quitApp après spawn', async () => {
    const h = harness({ platform: 'win32' });
    assert.deepEqual(h.states(), []);
    await h.service.checkNow();
    await drain();
    // Les premieres transitions sont le cycle complet ; la machine traverse `downloaded` puis
    // s'arrete en `installing` — l'installateur a ete lance, l'app rend la main (quitApp).
    assert.deepEqual(h.states().slice(0, 6), [
      'checking',
      'available',
      'downloading',
      'downloading',
      'downloading',
      'downloaded',
    ]);
    assert.equal(h.states()[h.states().length - 1], 'installing', 'la machine finit en installing');
    // Les pourcentages publiés viennent du flux (0, 40, 100) — bornés 0..100, entiers.
    const percents = h.published.filter((s) => s.state === 'downloading').map((s) => s.percent);
    assert.deepEqual(percents, [0, 40, 100]);
    // Windows : spawn `/S` silencieux + quitApp.
    assert.equal(h.calls.spawn.length, 1);
    assert.equal(h.calls.spawn[0]?.args.includes('/S'), true);
    assert.equal(h.quits.length, 1, 'quitApp appelé après un spawn réussi');
  });

  it('à jour ⇒ up-to-date sans téléchargement', async () => {
    const h = harness({ appVersion: '9.9.9', platform: 'win32' });
    await h.service.checkNow();
    await drain();
    assert.deepEqual(h.states(), ['checking', 'up-to-date']);
    assert.equal(h.calls.stream, 0);
    assert.equal(h.calls.spawn.length, 0);
  });

  it('reentrance : un second checkNow pendant un cycle NE relance PAS le réseau', async () => {
    const h = harness({ platform: 'win32' });
    const first = h.service.checkNow();
    const second = h.service.checkNow();
    await Promise.all([first, second]);
    await drain();
    assert.equal(h.calls.get, 1, 'un seul appel API pour deux demandes');
    assert.equal(h.calls.logs.filter((l) => l.includes('déjà en cours')).length, 1);
  });
});

/* ------------------------------------------------------------------ */
/* Les gardes                                                            */
/* ------------------------------------------------------------------ */

describe('garde salon actif (condition 6)', () => {
  it('auto : le cycle télécharge mais n installe PAS pendant un salon, artifact conserve', async () => {
    const h = harness({ platform: 'win32' });
    h.setRoomActive(true);
    await h.service.checkNow();
    await drain();
    assert.equal(h.calls.spawn.length, 0, 'aucun spawn pendant un salon');
    assert.equal(h.quits.length, 0);
    // L'état final est `downloaded` : l'artefact reste prêt pour le bouton.
    assert.equal(h.service.getState().state, 'downloaded');
  });
  it('installUpdateNow est refusé en salon actif, meme apres un telechargement', async () => {
    const h = harness({ platform: 'win32' });
    h.setRoomActive(true);
    await h.service.checkNow();
    await drain();
    h.setRoomActive(false);
    h.calls.spawn.length = 0;
    await h.service.installUpdateNow();
    await drain();
    assert.equal(h.calls.spawn.length, 1, 'hors salon, le bouton installe');
    h.setRoomActive(true);
    await h.service.installUpdateNow();
    await drain();
    assert.equal(h.calls.spawn.length, 1, 'en salon, le bouton ne relance rien');
  });
});

describe('empreinte SHA-256 (condition 4)', () => {
  it('mismatch : failed, fichier .part supprime, jamais installe', async () => {
    const h = harness({ platform: 'win32', computedSha: 'f'.repeat(64) });
    await h.service.checkNow();
    await drain();
    const last = h.published[h.published.length - 1];
    assert.equal(last?.state, 'failed');
    assert.match(last?.reason ?? '', /empreinte non concordante/);
    assert.ok(h.calls.remove.some((p) => p.endsWith('.part')), 'le .part est supprimé');
    assert.equal(h.calls.move.length, 0, 'le .part n est jamais devenu l artefact');
    assert.equal(h.calls.spawn.length, 0, 'jamais installe');
  });
  it('absence d empreinte pour l asset : refuse sans meme telecharger', async () => {
    // Le .exe est publie SANS son empreinte dans le corps : la strategie devient unsupported (le
    // service ne telecharge meme pas un artefact sans empreinte verifiable).
    const timers0 = fakeTimers();
    const seamJsonOnly = fakeSeam({
      platform: 'win32',
      json: {
        tag_name: 'v9.9.9',
        assets: [
          {
            name: 'concord-9.9.9-setup-x64.exe',
            browser_download_url: 'https://github.com/tournierjc/concord/releases/download/v9.9.9/concord-9.9.9-setup-x64.exe',
          },
        ],
        body: null,
      },
    }, () => timers0.now());
    const published: UpdateState[] = [];
    const service = createUpdateService({
      seam: seamJsonOnly.seam,
      timers: timers0,
      quitApp: () => undefined,
      roomActive: () => false,
      isAutoEnabled: () => true,
      onStateChange: (s) => published.push({ ...s }),
    });
    await service.checkNow();
    await drain();
    const last = published[published.length - 1];
    assert.equal(last?.state, 'failed');
    // La raison dit ce qui manque (empreinte absente ⇒ aucun installateur verifiable) ; dans les
    // deux formulations, le contrat est le meme : sans empreinte publiee, rien n'est installe.
    assert.match(last?.reason ?? '', /empreinte|installateur/);
    assert.equal(seamJsonOnly.calls.stream, 0, 'sans empreinte, on ne telecharge meme pas');
    assert.equal(seamJsonOnly.calls.spawn.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* auto=false (condition 5) et backoff                                   */
/* ------------------------------------------------------------------ */

describe('reglage auto', () => {
  it('auto=false : le cycle CADENCE fait 0 appel du seam, checkNow manuel passe', async () => {
    const h = harness({ platform: 'win32' }, { auto: false });
    h.service.start();
    h.timers.advance(STARTUP_CHECK_DELAY_MS);
    await drain();
    assert.equal(h.calls.get, 0, 'aucun appel reseau cadence quand auto=false');
    assert.deepEqual(h.states(), ['disabled']);
    // L'exception documentee : la demande explicite de l'utilisateur reste autorisee.
    await h.service.checkNow();
    await drain();
    assert.equal(h.calls.get, 1, 'checkNow manuel passe malgré auto=false');
  });
  it('auto=false n empeche pas le cycle manuel complet (telechargement + install)', async () => {
    const h = harness({ platform: 'win32' }, { auto: false });
    await h.service.checkNow();
    await drain();
    assert.equal(h.calls.spawn.length, 1);
    assert.equal(h.quits.length, 1);
  });
});

describe('backoff sur echec', () => {
  it('+6 h par echec consecutif, puis plafond : plus de reveil avant la fenetre des 24 h', async () => {
    const h = harness({ platform: 'win32', getError: 'connexion refusée' });
    h.service.start();
    // Premier echec (demarrage, 30 s) — le backoff arme 6 h, pas 12 h.
    h.timers.advance(STARTUP_CHECK_DELAY_MS);
    await drain();
    assert.equal(h.published.filter((s) => s.state === 'failed').length, 1);
    // Deuxieme echec : le reveil est a t=6 h + 30 s.
    h.timers.advance(BACKOFF_STEP_MS + 1000);
    await drain();
    assert.equal(h.published.filter((s) => s.state === 'failed').length, 2);
    // Un reveil de 12 h sonnerait a t=12 h, DONC AVANT la cible de cette etape (6 h + 1 s) : un
    // seul appel API a ete emis entre les deux — c'est la preuve qu'aucun backoff double n'existe.
    assert.equal(h.calls.get, 2, 'un seul reveil de backoff entre le 1er et le 2e echec');
    // Troisieme : le reveil est a t=6 h + 30 s + 12 h.
    h.timers.advance(BACKOFF_STEP_MS * 2 + 1000);
    await drain();
    assert.equal(h.published.filter((s) => s.state === 'failed').length, MAX_CONSECUTIVE_FAILURES);
    // Au plafond : plus AUCUN reveil de backoff. Le repeat des 24 h est ancre au demarrage et
    // sonne a t=24 h, six heures apres le 3e echec (t=18 h) : un backoff deplafonne sonnerait
    // AVANT la fenetre et multiplierait les appels — la mesure est l'ECART, pas le simple compte.
    // Seuls restent arms : le repeat des 24 h (duree <= 24 h) et l'once de demarrage (deja consomme).
    const pendingAfterThird = h.timers.pending();
    assert.ok(pendingAfterThird >= 1, 'le repeat des 24 h reste arme au plafond');
    // L'appel d'avant est le 3e echec (t=18 h) ; le prochain doit etre la fenetre des 24 h, jamais
    // un reveil de backoff deplafonne : un ecart >= 6 h est la seule mesure qui le prouve.
    // Le 3e echec est a t=18 h (+30 s) ; la fenetre des 24 h sonnera a t=24 h (+1 s). Avancer
    // SEULEMENT jusqu'a 22 h laisse les deux reveils arms : un backoff deplafonne sonnerait dans
    // cette fenetre (18 h < 18+delta <= 22 h), la fenetre legitime non. Zero appel attendu ici.
    const before = h.calls.get;
    h.timers.advance(4 * 3_600_000 - 1000);
    await drain();
    assert.equal(h.calls.get, before, 'le plafond coupe le backoff : zero appel avant la fenetre des 24 h');
    // Puis traverser la fenetre des 24 h : un seul appel de plus, et c'est la cadence qui l'emet.
    h.timers.advance(CHECK_INTERVAL_MS);
    await drain();
    assert.equal(h.calls.get, before + 1, 'la fenetre des 24 h a repris, un seul appel');
  });
  it('checkNow ignore le backoff et le cache up-to-date', async () => {
    const h = harness({ platform: 'win32', getError: 'connexion refusée' });
    h.service.start();
    h.timers.advance(STARTUP_CHECK_DELAY_MS);
    await drain();
    const before = h.calls.get;
    // Un backoff est arme : checkNow doit le couper et verifier quand meme.
    await h.service.checkNow();
    await drain();
    assert.equal(h.calls.get, before + 1, 'le bouton force passe malgré le backoff');
    // Cache up-to-date : deux checkNow successifs doivent reinterroger (pas de cache opposable).
    const h2 = harness({ platform: 'win32' });
    await h2.service.checkNow();
    await drain();
    await h2.service.checkNow();
    await drain();
    assert.equal(h2.calls.get, 2, 'pas de cache up-to-date pour le bouton');
  });
});

/* ------------------------------------------------------------------ */
/* Installation immediate par plateforme                                 */
/* ------------------------------------------------------------------ */

describe('installation immediate', () => {
  it('Windows : spawnPath/spawnArgs observés + quitApp', async () => {
    const h = harness({ platform: 'win32' });
    await h.service.checkNow();
    await drain();
    assert.equal(h.calls.spawn.length, 1);
    const spawned = h.calls.spawn[0];
    assert.equal(spawned?.path, '/fake/downloads/concord-9.9.9-setup-x64.exe');
    assert.deepEqual(spawned?.args, ['/fake/downloads/concord-9.9.9-setup-x64.exe', '/S']);
    assert.equal(spawned?.env, undefined, 'NSIS : lenvironnement du processus, pas un env invente');
    assert.equal(h.quits.length, 1);
    // Le .part valide est devenu l'artefact.
    assert.ok(h.calls.move.some((m) => m.to === '/fake/downloads/concord-9.9.9-setup-x64.exe'));
  });
  it('AppImage : chmod +x, remplacement, env APPIMAGE mis a jour, quitApp', async () => {
    const h = harness({ platform: 'linux' });
    await h.service.checkNow();
    await drain();
    assert.equal(h.calls.chmod.length, 1, 'chmod +x sur l AppImage');
    assert.equal(h.calls.spawn.length, 1);
    const spawned = h.calls.spawn[0];
    assert.equal(spawned?.path, '/fake/downloads/concord-9.9.9-x86_64.AppImage');
    assert.deepEqual(spawned?.args, []);
    assert.equal(spawned?.env?.['APPIMAGE'], '/fake/downloads/concord-9.9.9-x86_64.AppImage');
    assert.equal(spawned?.env?.['PATH'], '/usr/bin', 'lenvironnement existant est conserve');
    assert.equal(h.quits.length, 1);
  });
  it('.deb : telecharge et rend la commande sudo, JAMAIS spawn, JAMAIS faux installing', async () => {
    // Linux sans AppImage : seule la strategie deb-only reste.
    const scriptedTimers = fakeTimers();
    const scripted = fakeSeam({
      platform: 'linux',
      json: {
        tag_name: 'v9.9.9',
        assets: [
          {
            name: 'concord-9.9.9-linux-amd64.deb',
            browser_download_url: 'https://github.com/tournierjc/concord/releases/download/v9.9.9/concord-9.9.9-linux-amd64.deb',
          },
        ],
        body: `${HEX_A}  concord-9.9.9-linux-amd64.deb`,
      },
    }, () => scriptedTimers.now());
    const published: UpdateState[] = [];
    const service = createUpdateService({
      seam: scripted.seam,
      timers: scriptedTimers,
      quitApp: () => undefined,
      roomActive: () => false,
      isAutoEnabled: () => true,
      onStateChange: (s) => published.push({ ...s }),
    });
    await service.checkNow();
    await drain();
    assert.equal(scripted.calls.spawn.length, 0, 'le .deb n est jamais lance');
    assert.equal(published.some((s) => s.state === 'installing'), false, 'jamais de faux installing');
    assert.equal(published[published.length - 1]?.state, 'downloaded');
    // installUpdateNow sur un deb rend la commande, ne spawn toujours pas.
    await service.installUpdateNow();
    await drain();
    assert.equal(scripted.calls.spawn.length, 0);
    assert.match(published[published.length - 1]?.reason ?? '', /^sudo apt install \/fake\/downloads\//);
  });
});

/* ------------------------------------------------------------------ */
/* Cadence de demarrage                                                  */
/* ------------------------------------------------------------------ */

describe('cadence', () => {
  it('start() arme 30 s puis 24 h ; stop() desarmer tout', () => {
    const h = harness({ platform: 'win32' });
    h.service.start();
    assert.equal(h.timers.pending(), 2, 'un once (30 s) + un repeat (24 h)');
    h.service.stop();
    assert.equal(h.timers.pending(), 0, 'rien ne survit a stop()');
  });
});
