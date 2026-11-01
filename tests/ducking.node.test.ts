/**
 * tests/ducking.node.test.ts — le ducking (baisse des autres applications quand un pair parle),
 * mesuré sans aucun système : `src/main/ducking.ts` porte toute sa logique sur le seam
 * `DuckExec` (double en mémoire) et une horloge manuelle (`tests/manual-timers.ts`).
 *
 * Exigence → test qui l'assert :
 *  - choix plateforme avec `process.platform` surjoueur .................. `duckFamilyForPlatform`
 *  - parsing `pactl list sink-inputs` (vraies sorties en fixtures) ........ parseSinkInputs
 *  - exclusion des entrées Concord (application-name, casse) .............. duckTargets / skipped
 *  - toutes les entrées sont Concord ⇒ AUCUN exec de set ................. 'aucune entree a baisser'
 *  - sérialisation des exec (jamais deux en vol) ......................... 'serialise'
 *  - intention la plus récente gagnante (bouleversement en vol) ........... 'revient pendant'
 *  - timeout/kill (2 s, execFile) ........................................ toLaunch + exec electron
 *  - no-op silencieux sans pactl/wpctl (tracé une fois, zéro set) ........ 'aucun outil'
 *  - option false ⇒ aucun exec (câblé dans index.ts, prouvé par la sonde) . tests/ducking-wiring
 *  - défaut absent ⇒ ducking ON .......................................... tests/settings-schema
 *  - restauration après fin de tenue (700 ms) ............................ 'restaure apres tenue'
 *  - la parole qui revient dans la tenue annule la restauration ........... 'annule la restauration'
 *  - soi-même qui parle ⇒ AUCUN ducking (exclu du signal par le renderer,
 *    asserting le contrat du main : `duckingApply` n'est appelé qu'avec des pairs)
 *    ..................................................................... tests/ducking-peer-gate
 *
 * Lancer : npx tsx --test tests/ducking.node.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DUCK_VOLUME_PERCENT,
  RESTORE_HOLD_MS,
  RESTORE_VOLUME_PERCENT,
  createDuckingController,
  duckFamilyForPlatform,
  duckTargets,
  isConcordSinkInput,
  nircmdDuckArguments,
  parseSinkInputs,
  skippedConcordInputs,
  toLaunch,
  toWpctlRatio,
  windowsDuckArguments,
  windowsDuckCommands,
  type DuckCommand,
  type DuckExec,
  type DuckingTimers,
} from '../src/main/ducking.ts';

/* ------------------------------------------------------------------ */
/* Doubles                                                             */
/* ------------------------------------------------------------------ */

interface ExecutedCall {
  command: DuckCommand;
  /** Instant (compteur de la horloge manuelle) où l'appel a DÉBUTÉ. */
  startedAt: number;
  /** Instant où il a rendu la main. */
  endedAt: number;
}

interface FakeSystem {
  exec: DuckExec;
  readonly calls: ExecutedCall[];
  /** Commandes qui « rendent » (stdout) — les autres rendent `null` (outil absent). */
  available: Set<string>;
  /** Sortie de `pactl list sink-inputs` jouée. */
  sinkInputs: string;
  /** Retarde chaque exécution de `ms` (ticks d'horloge) pour tester la sérialisation. */
  delayMs: number;
}

/** Le pourcentage réellement demandé par une commande `set` (toutes familles confondues). */
function setPercent(command: DuckCommand): number | null {
  if (command.kind !== 'set') return null;
  if (command.tool === 'pactl') return command.percent;
  if (command.tool === 'wpctl') return Math.round(Number(command.ratio) * 100);
  return command.percent;
}

/** L'index d'entrée d'un `set` pactl, `null` pour les autres familles. */
function setIndex(command: DuckCommand): number | null {
  if (command.kind === 'set' && command.tool === 'pactl') return command.index;
  return null;
}

/**
 * Fabrique un double + son horloge COUPLÉS (la fermeture `run` lit l'horloge de la paire — un
 * `clock` module-global serait lu après la fin du test, d'où le couplage à la création).
 */
function createFakeSystem(): FakeSystem & { clock: ManualClock } {
  const clock = createClock();
  const system: FakeSystem = {
    exec: { run: () => Promise.reject(new Error('double non initialise')) },
    calls: [],
    available: new Set(['pactl']),
    sinkInputs: '',
    delayMs: 0,
  };
  system.exec = {
    async run(command: DuckCommand) {
      const startedAt = clock.time;
      system.calls.push({ command, startedAt, endedAt: startedAt });
      if (system.delayMs > 0) await clock.advance(system.delayMs);
      const last = system.calls[system.calls.length - 1];
      if (last !== undefined) last.endedAt = clock.time;
      if (!system.available.has(command.tool)) return { stdout: null };
      if (command.tool === 'wpctl') return { stdout: 'ok' };
      if (command.tool === 'pactl' && command.kind === 'list') {
        return { stdout: system.sinkInputs };
      }
      return { stdout: 'ok' };
    },
  };
  return Object.assign(system, { clock }) as FakeSystem & { clock: ManualClock };
}

/** Horloge manuelle : `advance` rend la main aux promesses (comme manual-timers du moteur). */
interface ManualClock {
  readonly time: number;
  advance(ms: number): Promise<void>;
  /** Fait tomber toutes les échéances armées avant `time + ms`, dans l'ordre. */
  fireWithin(ms: number): Promise<void>;
  timers: DuckingTimers;
  armed(): number;
}

function createClock(): ManualClock {
  let time = 0;
  let nextId = 1;
  interface Alarm {
    id: number;
    at: number;
    callback: () => void;
    cancelled: boolean;
  }
  const alarms: Alarm[] = [];
  const clock: ManualClock = {
    get time(): number {
      return time;
    },
    async advance(ms: number): Promise<void> {
      const target = time + ms;
      while (time < target) {
        const step = Math.min(1, target - time);
        time += step;
        // Laisse tourner les microtâches des promesses en vol.
        await Promise.resolve();
      }
    },
    async fireWithin(ms: number): Promise<void> {
      const due = alarms
        .filter((alarm) => !alarm.cancelled && alarm.at <= time + ms)
        .sort((a, b) => a.at - b.at);
      for (const alarm of due) {
        if (alarm.cancelled) continue;
        time = Math.max(time, alarm.at);
        alarm.cancelled = true;
        alarm.callback();
        await Promise.resolve();
        await Promise.resolve();
      }
      await Promise.resolve();
    },
    timers: {
      once(ms: number, callback: () => void): unknown {
        const alarm: Alarm = { id: nextId++, at: time + ms, callback, cancelled: false };
        alarms.push(alarm);
        return alarm.id;
      },
      cancel(handle: unknown): void {
        if (typeof handle !== 'number') return;
        const alarm = alarms.find((candidate) => candidate.id === handle);
        if (alarm !== undefined) alarm.cancelled = true;
      },
    },
    armed(): number {
      return alarms.filter((alarm) => !alarm.cancelled).length;
    },
  };
  return clock;
}

/** Attend que plus aucune exécution n'est en vol (la sérialisation rend `calls` stable). */
async function settle(system: FakeSystem, clock: ManualClock): Promise<void> {
  for (let pass = 0; pass < 50; pass += 1) {
    const before = system.calls.length;
    await clock.advance(1);
    if (system.calls.length === before) return;
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures : vraies sorties collées                                    */
/* ------------------------------------------------------------------ */

const PACTL_TWO_APPS = `Sink Input #12
\tIndex: 12
\tDriver: protocol-native.c
\tApplication Name: Firefox
\tmedia.name = "Debug — Mozilla Firefox"
\tProperties:
\t\tapplication.process.binary = "firefox"

Sink Input #18
\tIndex: 18
\tDriver: protocol-native.c
\tApplication Name: Spotify
\tmedia.name = "Spotify"
\tProperties:
\t\tapplication.process.binary = "spotify"
`;

const PACTL_WITH_CONCORD = `Sink Input #12
\tIndex: 12
\tApplication Name: Firefox

Sink Input #15
\tIndex: 15
\tApplication Name: Concord

Sink Input #18
\tIndex: 18
\tApplication Name: Spotify
`;

const PACTL_ONLY_CONCORD = `Sink Input #15
\tIndex: 15
\tApplication Name: concord — Electron
`;

const PACTL_NO_APPS = `Sink Input #7
\tIndex: 7
\tDriver: protocol-native.c
\tClient: 3
\tApplication: Firefox
`;

/* ------------------------------------------------------------------ */
/* Logique pure                                                        */
/* ------------------------------------------------------------------ */

describe('ducking — choix plateforme (process.platform surjoueur)', () => {
  it('linux/freebsd/openbsd → pulse ; win32 → windows ; darwin et inconnu → noop', () => {
    assert.equal(duckFamilyForPlatform('linux'), 'pulse');
    assert.equal(duckFamilyForPlatform('freebsd'), 'pulse');
    assert.equal(duckFamilyForPlatform('openbsd'), 'pulse');
    assert.equal(duckFamilyForPlatform('win32'), 'windows');
    assert.equal(duckFamilyForPlatform('darwin'), 'noop');
    assert.equal(duckFamilyForPlatform('sunos'), 'noop');
  });
});

describe('ducking — parsing pactl list sink-inputs', () => {
  it('deux entrées lues avec leur index et leur application', () => {
    const inputs = parseSinkInputs(PACTL_TWO_APPS);
    assert.deepEqual(inputs, [
      { index: 12, applicationName: 'Firefox' },
      { index: 18, applicationName: 'Spotify' },
    ]);
  });

  it('Concord reconnu quelle que soit la casse, les autres non', () => {
    const inputs = parseSinkInputs(PACTL_WITH_CONCORD);
    assert.deepEqual(duckTargets(inputs), [12, 18]);
    assert.deepEqual(skippedConcordInputs(inputs), [15]);
    assert.equal(isConcordSinkInput({ index: 1, applicationName: 'MyConcord Audio' }), true);
    assert.equal(isConcordSinkInput({ index: 1, applicationName: null }), false);
  });

  it('une entrée sans `Application Name:` n\'est pas Concord et reste baissable', () => {
    const inputs = parseSinkInputs(PACTL_NO_APPS);
    assert.deepEqual(inputs, [{ index: 7, applicationName: null }]);
    assert.deepEqual(duckTargets(inputs), [7]);
  });

  it('sortie vide ⇒ aucune entrée', () => {
    assert.deepEqual(parseSinkInputs(''), []);
  });
});

describe('ducking — construction des commandes (execFile, jamais de shell string)', () => {
  it('pactl list / set avec args séparés et pourcentage borné', () => {
    assert.deepEqual(toLaunch({ tool: 'pactl', kind: 'list' }), {
      command: 'pactl',
      args: ['list', 'sink-inputs'],
    });
    assert.deepEqual(toLaunch({ tool: 'pactl', kind: 'set', index: 12, percent: 30 }), {
      command: 'pactl',
      args: ['set-sink-input-volume', '12', '--', '30%'],
    });
  });

  it('wpctl probe/set avec ratio chaîne à deux décimales', () => {
    assert.equal(toWpctlRatio(30), '0.30');
    // La sonde ne touche à rien : `wpctl status` sert uniquement à détecter la présence de l'outil.
    assert.deepEqual(toLaunch({ tool: 'wpctl', kind: 'probe' }), {
      command: 'wpctl',
      args: ['status'],
    });
    assert.deepEqual(toLaunch({ tool: 'wpctl', kind: 'set', id: 9, ratio: '0.30' }), {
      command: 'wpctl',
      args: ['set-volume', '9', '0.30'],
    });
  });

  it('windows : powershell d\'abord, nircmd en repli ; aucun argument injectable', () => {
    const commands = windowsDuckCommands(30);
    assert.deepEqual(commands.map((c) => c.tool), ['powershell', 'nircmd']);
    const ps = windowsDuckArguments(30);
    assert.equal(ps.command, 'powershell.exe');
    assert.deepEqual(ps.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
    assert.match(ps.args[3] ?? '', /IAudioEndpointVolume/);
    assert.match(ps.args[3] ?? '', /0\.30/);
    assert.deepEqual(nircmdDuckArguments(30), ['setsysvolume', '19661']);
  });
});

/* ------------------------------------------------------------------ */
/* Le contrôleur                                                       */
/* ------------------------------------------------------------------ */

describe('ducking — contrôleur Linux/Pulse sur double execFile', () => {
  it('pair qui parle ⇒ baisse de 30 % chaque entrée, JAMAIS l\'entrée Concord', async () => {
    const { clock, ...system } = createFakeSystem();
    system.sinkInputs = PACTL_WITH_CONCORD;
    const controller = createDuckingController({
      platform: 'linux',
      exec: system.exec,
      timers: clock.timers,
      trace: () => undefined,
    });

    controller.apply({ active: true, at: clock.time });
    await settle(system, clock);

    const sets = system.calls.filter((call) => call.command.kind === 'set');
    assert.deepEqual(
      sets.map((call) => setIndex(call.command)),
      [12, 18],
      'Firefox et Spotify baissés, Concord (15) jamais',
    );
    assert.equal(sets[0]?.command.tool, 'pactl');
    assert.deepEqual(system.calls.map((c) => c.command.kind), ['list', 'set', 'set']);
    assert.equal(controller.state().ducked, true);
    const report = controller.state().lastReport;
    assert.ok(report !== null);
    assert.deepEqual(report.targets, [12, 18]);
    assert.deepEqual(report.skipped, [15]);
    assert.equal(report.percent, DUCK_VOLUME_PERCENT);
  });

  it('toutes les entrées sont Concord ⇒ AUCUN set exécuté, pas de faux « ducked »', async () => {
    const { clock, ...system } = createFakeSystem();
    system.sinkInputs = PACTL_ONLY_CONCORD;
    const controller = createDuckingController({
      platform: 'linux',
      exec: system.exec,
      timers: clock.timers,
      trace: () => undefined,
    });
    controller.apply({ active: true, at: clock.time });
    await settle(system, clock);
    assert.equal(system.calls.filter((c) => c.command.kind === 'set').length, 0);
    assert.equal(controller.state().ducked, false);
  });

  it('restauration à 100 % seulement APRÈS la fin de tenue (700 ms)', async () => {
    const { clock, ...system } = createFakeSystem();
    system.sinkInputs = PACTL_TWO_APPS;
    const controller = createDuckingController({
      platform: 'linux',
      exec: system.exec,
      timers: clock.timers,
      trace: () => undefined,
    });
    controller.apply({ active: true, at: clock.time });
    await settle(system, clock);

    // Extinction du relay (fin de la tenue de 600 ms côté renderer) : rien dans l'immédiat.
    controller.apply({ active: false, at: clock.time });
    await settle(system, clock);
    assert.equal(controller.state().ducked, true, 'rien n\'est restauré avant la tenue');
    assert.equal(clock.armed(), 1, 'une restauration différée est armée');

    await clock.fireWithin(RESTORE_HOLD_MS);
    await settle(system, clock);
    assert.equal(controller.state().ducked, false);
    const restores = system.calls.filter(
      (call) => call.command.tool === 'pactl' && setPercent(call.command) === RESTORE_VOLUME_PERCENT,
    );
    assert.deepEqual(restores.map((c) => setIndex(c.command)), [12, 18]);
  });

  it('la parole qui REVIENT pendant la tenue annule la restauration (aucun pompage)', async () => {
    const { clock, ...system } = createFakeSystem();
    system.sinkInputs = PACTL_TWO_APPS;
    const controller = createDuckingController({
      platform: 'linux',
      exec: system.exec,
      timers: clock.timers,
      trace: () => undefined,
    });
    controller.apply({ active: true, at: clock.time });
    await settle(system, clock);
    controller.apply({ active: false, at: clock.time });
    // Un pair reprend la parole avant l'échéance : l'alarme est annulée, aucun set 100 %.
    controller.apply({ active: true, at: clock.time });
    await clock.fireWithin(RESTORE_HOLD_MS + 500);
    await settle(system, clock);
    assert.equal(clock.armed(), 0, 'l\'alarme de restauration a été annulée');
    assert.equal(controller.state().ducked, true, 'le ducking continue sans interruption');
    assert.equal(
      system.calls.filter((c) => c.command.tool === 'pactl' &&
        setPercent(c.command) === RESTORE_VOLUME_PERCENT).length,
      0,
      'aucune restauration n\'a été envoyée',
    );
  });

  it('deux « pair parle » successifs ne produisent qu\'une seule salve de sets', async () => {
    const { clock, ...system } = createFakeSystem();
    system.sinkInputs = PACTL_TWO_APPS;
    const controller = createDuckingController({
      platform: 'linux',
      exec: system.exec,
      timers: clock.timers,
      trace: () => undefined,
    });
    controller.apply({ active: true, at: clock.time });
    await settle(system, clock);
    const setsAfterFirst = system.calls.filter((c) => c.command.kind === 'set').length;
    // Le second pair qui parle ne change rien : `ducked` est déjà vrai, aucune nouvelle commande.
    controller.apply({ active: true, at: clock.time + 200 });
    await settle(system, clock);
    assert.equal(system.calls.filter((c) => c.command.kind === 'set').length, setsAfterFirst);
  });

  it('les exec sont SÉRIALISÉS : jamais deux commandes en vol', async () => {
    const { clock, ...system } = createFakeSystem();
    system.sinkInputs = PACTL_TWO_APPS;
    system.delayMs = 5;
    const controller = createDuckingController({
      platform: 'linux',
      exec: system.exec,
      timers: clock.timers,
      trace: () => undefined,
    });
    controller.apply({ active: true, at: clock.time });
    // Laisse la salve avancer à mi-chemin, puis vérifie l'absence de recouvrement.
    await clock.advance(1);
    await clock.advance(200);
    await settle(system, clock);
    for (let index = 1; index < system.calls.length; index += 1) {
      const previous = system.calls[index - 1];
      const current = system.calls[index];
      if (previous === undefined || current === undefined) continue;
      assert.ok(
        current.startedAt >= previous.endedAt,
        `recouvrement détecté entre ${index - 1} et ${index}`,
      );
    }
    assert.ok(system.calls.length >= 3, 'la salve list + 2 sets a bien eu lieu');
  });

  it('l\'intention la plus RÉCENTE gagne : bouleversement pendant une exécution', async () => {
    const { clock, ...system } = createFakeSystem();
    system.sinkInputs = PACTL_TWO_APPS;
    system.delayMs = 10;
    const controller = createDuckingController({
      platform: 'linux',
      exec: system.exec,
      timers: clock.timers,
      trace: () => undefined,
    });
    // Le pair parle…
    controller.apply({ active: true, at: clock.time });
    await clock.advance(1);
    // …et se tait PENDANT que la baisse est encore en train de s'écrire.
    controller.apply({ active: false, at: clock.time });
    // La restauration est différée : on la déclenche une fois la tenue écoulée.
    await clock.advance(500);
    await clock.fireWithin(RESTORE_HOLD_MS);
    await settle(system, clock);
    assert.equal(controller.state().ducked, false, 'l\'extinction a fini par s\'appliquer');
    // La DERNIÈRE commande pactl set est une restauration (100 %), jamais une baisse périmée.
    const lastSet = [...system.calls]
      .reverse()
      .find((c) => c.command.kind === 'set' && c.command.tool === 'pactl');
    assert.ok(lastSet !== undefined);
    assert.equal(setPercent(lastSet.command), RESTORE_VOLUME_PERCENT);
  });

  it('sans pactl NI wpctl ⇒ AUCUN set, no-op tracé UNE fois (option ON mais muet)', async () => {
    const { clock, ...system } = createFakeSystem();
    system.available = new Set();
    const traced: string[] = [];
    const controller = createDuckingController({
      platform: 'linux',
      exec: system.exec,
      timers: clock.timers,
      trace: (line) => traced.push(line),
    });
    controller.apply({ active: true, at: clock.time });
    await settle(system, clock);
    assert.equal(system.calls.filter((c) => c.command.kind === 'set').length, 0);
    assert.equal(controller.state().ducked, false);
    assert.equal(traced.length, 1, 'le no-op est tracé une fois, pas à chaque geste');
  });

  it('macOS (noop) : aucune exécution, tracé une fois', async () => {
    const { clock, ...system } = createFakeSystem();
    const traced: string[] = [];
    const controller = createDuckingController({
      platform: 'darwin',
      exec: system.exec,
      timers: clock.timers,
      trace: (line) => traced.push(line),
    });
    controller.apply({ active: true, at: clock.time });
    controller.apply({ active: false, at: clock.time + 1000 });
    await clock.fireWithin(RESTORE_HOLD_MS);
    await settle(system, clock);
    assert.equal(system.calls.length, 0);
    assert.equal(traced.length, 1);
  });

  it('stop() restaure immédiatement, sans attendre la tenue', async () => {
    const { clock, ...system } = createFakeSystem();
    system.sinkInputs = PACTL_TWO_APPS;
    const controller = createDuckingController({
      platform: 'linux',
      exec: system.exec,
      timers: clock.timers,
      trace: () => undefined,
    });
    controller.apply({ active: true, at: clock.time });
    await settle(system, clock);
    controller.stop({ active: false, at: clock.time });
    await settle(system, clock);
    assert.equal(controller.state().ducked, false);
    assert.equal(clock.armed(), 0, 'aucune alarme survivante après un stop');
  });

  it('Windows : powershell d\'abord, nircmd en repli si powershell échoue', async () => {
    const { clock, ...system } = createFakeSystem();
    system.available = new Set(['nircmd']);
    const controller = createDuckingController({
      platform: 'win32',
      exec: system.exec,
      timers: clock.timers,
      trace: () => undefined,
    });
    controller.apply({ active: true, at: clock.time });
    await settle(system, clock);
    assert.deepEqual(system.calls.map((c) => c.command.tool), ['powershell', 'nircmd']);
    assert.equal(controller.state().ducked, true);
    const report = controller.state().lastReport;
    assert.ok(report !== null);
    assert.equal(report.tool, 'nircmd');
  });
});
