/**
 * ducking.ts — baisse automatique du volume des AUTRES applications pendant qu'un pair parle.
 *
 * Sémantique produite (décision prise, non rouverte) : quand AU MOINS UN PAIR — jamais soi-même,
 * la table du renderer exclut déjà l'auto — est mesuré en train de parler, les autres applications
 * du système sont baissées (la voix de Concord reste à volume plein). À l'extinction (fin de la
 * tenue de 600 ms du relais de parole), restauration.
 *
 * Electron/Chromium n'a AUCUNE API pour le volume des autres applications. Le chemin est donc
 * plateforme, derrière un SEUL seam injectable (`DuckingIo`, même famille de pattern que
 * `electronAvatarIo` de `avatar-store.ts`) : sous `node --test`, un double en mémoire joue le
 * rôle de `pactl`/`wpctl`/PowerShell, et toute la décision — choix plateforme, sélection des
 * entrées, exclusion de Concord, sérialisation, garde de temporisation, horodatage, restauration
 * après tenue — reste ici, pure, testée.
 *
 * Par plateforme :
 *  - Linux/X11 : `pactl list sink-inputs` puis `pactl set-sink-input-volume <index> -- <pct>` ;
 *    si `pactl` est absent, repli WirePlumber : `wpctl get-volume <id>` / `wpctl set-volume <id> <ratio>` ;
 *  - Windows : PowerShell + `IAudioEndpointVolume` (type compilé à la volée), repli `nircmd` s'il
 *    est sur le PATH. Ce chemin ne peut pas être exercé dans ce conteneur : il est isolé derrière
 *    le seam, relisible en revue, et ses ARGUMENTS sont produits par des fonctions pures testées ;
 *  - macOS : non implémenté à ce jour — no-op TRACÉ, documenté, jamais une promesse muette.
 *
 * Si aucun outil n'est disponible, l'application ne change RIEN au système et le dit une fois en
 * `console.debug` (no-op silencieux traçé) : le ducking est un confort, jamais un écran bloquant.
 *
 * Garde-fous, tous tenus par `DuckingController` (testés dans `tests/ducking.node.test.ts`) :
 *  - JAMAIS une exécution concurrente : les commandes sont sérialisées (une promise en vol ⇒ la
 *    suivante est mise en file), et seules les INTENTIONS les plus récentes sont rejouées ;
 *  - timeout d'exécution (`EXEC_TIMEOUT_MS`, 2 s) avec `kill` du processus enfant — posé par
 *    l'implémentation Electron, un double de test peut le prouver ;
 *  - si `active` bascule PENDANT une exécution, la commande en cours est terminée puis le
 *    résultat le plus récent est appliqué (jamais un ordre périmé après le plus récent) ;
 *  - restauration différée de `RESTORE_HOLD_MS` : la parole qui revient dans cette fenêtre
 *    annule la restauration (aucun va-et-vient de volume sur une pause inter-mots) ;
 *  - les entrées dont le `application-name` contient « concord » (insensible à la casse) ne sont
 *    JAMAIS baissées ; si toutes les entrées sont Concord, aucune exécution ;
 *  - aucun shell string : `execFile` avec tableau d'arguments, jamais une chaîne interpolée.
 */

/** Pourcentage appliqué aux autres applications pendant la parole d'un pair (30 % du niveau). */
export const DUCK_VOLUME_PERCENT = 30;
/** Pourcentage rendu à la restauration (le niveau d'avant, lu AVANT de baisser, est préféré). */
export const RESTORE_VOLUME_PERCENT = 100;
/** Fenêtre de tenue : la parole qui revient là-dedans annule la restauration différée. */
export const RESTORE_HOLD_MS = 700;
/** Timeout d'une commande système ; au-delà, le processus enfant est tué. */
export const EXEC_TIMEOUT_MS = 2000;

/** Ce que la commande système doit rendre : la valeur réellement appliquée, jamais un espoir. */
export type DuckCommand =
  | { tool: 'pactl'; kind: 'list' }
  | { tool: 'pactl'; kind: 'set'; index: number; percent: number }
  | { tool: 'wpctl'; kind: 'probe' }
  | { tool: 'wpctl'; kind: 'set'; id: number; ratio: string }
  | { tool: 'powershell'; kind: 'set'; percent: number }
  | { tool: 'nircmd'; kind: 'setsysvolume'; percent: number };

/** Une exécution rendue : stdout sur la sortie demandée, `null` = outil absent ou erreur. */
export interface DuckExecResult {
  readonly stdout: string | null;
}

/** Le seam plateforme. Une seule méthode, un seul contrat : exécuter, rendre, ne jamais décider. */
export interface DuckExec {
  run(command: DuckCommand): Promise<DuckExecResult>;
}

/** Une intention de ducking : le contrôleur n'applique que la plus récente. */
export interface DuckIntent {
  readonly active: boolean;
  /** Horodatage injecté (horloge du main) — jamais `Date.now()` lu au fond d'un module. */
  readonly at: number;
}

/** Ce qu'une exécution a réellement touché (mesuré, pas supposé). */
export interface DuckReport {
  /** Vrai si le ducking est effectivement en cours d'application après ce geste. */
  readonly ducked: boolean;
  /** Le pourcentage rendu aux entrées (lu avant de baisser, sinon 100). */
  readonly percent: number;
  /** Les entrées réellement baissées. */
  readonly targets: number[];
  /** Les entrées exclues parce qu'appartenant à Concord. */
  readonly skipped: number[];
  /** Outil effectivement utilisé, `null` si aucun n'est disponible (no-op tracé). */
  readonly tool: 'pactl' | 'wpctl' | 'powershell' | 'nircmd' | null;
  /** Vrai = aucun outil système trouvé, le ducking ne peut rien faire sur cette machine. */
  readonly unavailable: boolean;
}

/** Une entrée de lecture PulseAudio (`pactl list sink-inputs`), réduite à ce qui compte. */
export interface SinkInput {
  readonly index: number;
  readonly applicationName: string | null;
}

/* ------------------------------------------------------------------ */
/* Logique pure — la partie qui se teste sans aucun système            */
/* ------------------------------------------------------------------ */

/**
 * Choix de la famille de commandes selon la plateforme, sur une valeur SURJOUABLE (le test ne
 * peut pas changer `process.platform`, il passe la sienne). Toute plateforme inconnue est un
 * no-op, pas un essai en aveugle.
 */
export function duckFamilyForPlatform(platform: string): 'pulse' | 'windows' | 'noop' {
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') return 'pulse';
  if (platform === 'win32') return 'windows';
  return 'noop';
}

/** Ligne `Indice:` ou `Sink Input #N` — la seule forme de titre de bloc acceptée (pactl récent). */
function readSinkIndex(line: string): number | null {
  // Vraie sortie `pactl list sink-inputs` : en anglais, « Index: 12 » (locale C, ce que lance
  // l'application). « Indice » reste accepté au cas où l'outil rendrait la locale du système.
  const indexed = /^\s*(?:Index|Indice):\s*(\d+)\s*$/.exec(line);
  if (indexed !== null) return Number(indexed[1]);
  const header = /^\s*Sink Input #(\d+)\s*$/.exec(line);
  if (header === null) return null;
  // Un titre `Sink Input #N` ouvre un bloc ; la ligne `Index: N` qui suit est ce MÊME bloc et ne
  // doit surtout pas en ouvrir un second.
  return Number(header[1]);
}

/** Vrai si la ligne est la ligne `Index:` interne d'un bloc déjà ouvert par son titre. */
function isBlockIndexLine(line: string, openIndex: number | null): boolean {
  if (openIndex === null) return false;
  const indexed = /^\s*(?:Index|Indice):\s*(\d+)\s*$/.exec(line);
  return indexed !== null && Number(indexed[1]) === openIndex;
}

/**
 * Parse une sortie réelle de `pactl list sink-inputs` : un bloc par entrée, une propriété
 * `Name:`/`Application Name:` par ligne. Les lignes de progression et les blocs sans index sont
 * ignorés ; `module-x11-cp.desktop` est un PROPRIÉTAIRE, pas une application — ses lignes `Name:`
 * ne définissent jamais un nom d'application. Les fixtures collées dans les tests sont la vérité
 * de référence.
 */
export function parseSinkInputs(stdout: string): SinkInput[] {
  interface Draft {
    index: number;
    applicationName: string | null;
  }
  const inputs: SinkInput[] = [];
  let draft: Draft | null = null;
  const flush = (): void => {
    if (draft !== null) {
      inputs.push(Object.freeze({ index: draft.index, applicationName: draft.applicationName }));
      draft = null;
    }
  };
  for (const line of stdout.split('\n')) {
    const index = readSinkIndex(line);
    if (index !== null) {
      flush();
      draft = { index, applicationName: null };
      continue;
    }
    if (draft === null) continue;
    const application = /^\s*Application Name:\s*(.*)$/.exec(line);
    if (application !== null && draft.applicationName === null) {
      draft = { index: draft.index, applicationName: application[1]?.trim() ?? null };
    }
  }
  flush();
  return inputs;
}

/** Vrai si l'entrée appartient à Concord (insensible à la casse) — jamais elle n'est baissée. */
export function isConcordSinkInput(input: SinkInput): boolean {
  return input.applicationName !== null && input.applicationName.toLowerCase().includes('concord');
}

/** Les entrées à baisser : tout ce qui n'est pas Concord, dans l'ordre lu. */
export function duckTargets(inputs: readonly SinkInput[]): number[] {
  return inputs.filter((input) => !isConcordSinkInput(input)).map((input) => input.index);
}

/** Les entrées exclues parce que Concord (traçées, jamais baissées). */
export function skippedConcordInputs(inputs: readonly SinkInput[]): number[] {
  return inputs.filter(isConcordSinkInput).map((input) => input.index);
}

/** Pourcentage → ratio WirePlumber (chaîne à deux décimales, jamais un nombre brut sur le fil). */
export function toWpctlRatio(percent: number): string {
  return (percent / 100).toFixed(2);
}

/**
 * Le mot d'ordre PowerShell complet pour régler le volume de sortie par `IAudioEndpointVolume`.
 * Le type est compilé à la volée (`Add-Type`) ; aucune interpolation d'entrée utilisateur : seul
 * `percent`, validé entier 0..100 par l'appelant, entre dans la commande. Repli `nircmd` si
 * PowerShell échoue (les deux formes sont produites ici, donc relues et testées).
 */
export function windowsDuckArguments(percent: number): { command: string; args: string[] } {
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System.Runtime.InteropServices;',
    '[Guid("5DDE4EEA-AE1E-4AE0-B815-B6D3B8C4B1C1")]',
    'public interface IAudioEndpointVolume {',
    '  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);',
    '  int GetMasterVolumeLevelScalar(out float pfLevel);',
    '}',
    '[Guid("BCA96C5B-F261-4714-A7F2-94B4D2F4988D")]',
    '[ComImport]',
    'public class MMDeviceEnumerator { }',
    '@"',
    '$enumerator = New-Object MMDeviceEnumerator',
    '$endpoint = $enumerator.GetDefaultAudioEndpoint(0, 1)',
    '$volume = $endpoint.QueryInterface([Guid]"5DDE4EEA-AE1E-4AE0-B815-B6D3B8C4B1C1"),[IAudioEndpointVolume]',
    '$volume.SetMasterVolumeLevelScalar(' + (percent / 100).toFixed(2) + ', [Guid]::Empty)',
  ].join('\n');
  return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
}

/** Arguments `nircmd setsysvolume` (repli Windows) : 0..65535, la valeur de l'API. */
export function nircmdDuckArguments(percent: number): string[] {
  return ['setsysvolume', String(Math.round((percent / 100) * 65535))];
}

/**
 * La fonction de repli Windows complète (PowerShell d'abord, nircmd ensuite) — pure, donc relue
 * en revue : elle ne fait que composer des commandes `DuckCommand`, l'exécution est au seam.
 */
export function windowsDuckCommands(percent: number): DuckCommand[] {
  return [
    { tool: 'powershell', kind: 'set', percent },
    { tool: 'nircmd', kind: 'setsysvolume', percent },
  ];
}

/* ------------------------------------------------------------------ */
/* Le contrôleur — sérialisation, horodatage, tenue de restauration     */
/* ------------------------------------------------------------------ */

/** Minuterie injectée pour la restauration différée (jamais de `setTimeout` ambiant ici). */
export interface DuckingTimers {
  once(ms: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

export interface DuckingController {
  /** Le renderer a décidé qui parle : on lui passe l'intention (soi est déjà exclu chez lui). */
  apply(intent: DuckIntent): void;
  /** Départ de salon / fermeture : restauration immédiate si le ducking tournait. */
  stop(intent: DuckIntent): void;
  /** État mesuré pour les tests et les journaux : ce qui est en cours, pas ce qui est espéré. */
  state(): DuckControllerState;
}

export interface DuckControllerState {
  readonly ducked: boolean;
  readonly lastReport: DuckReport | null;
}

export interface DuckingControllerOptions {
  /** Plateforme surjouée (défaut : `process.platform`, lu à la construction, jamais ailleurs). */
  readonly platform?: string;
  readonly exec: DuckExec;
  readonly timers: DuckingTimers;
  /** Trace (console.debug par défaut en production, tableau en test). */
  readonly trace?: (line: string) => void;
}

/**
 * Le contrôleur ne MESURE rien et ne DÉCIDE rien de la parole : il reçoit des intentions horodatées
 * du renderer (seul endroit où quelqu'un mesure) et les applique au système, une seule à la fois.
 */
export function createDuckingController(options: DuckingControllerOptions): DuckingController {
  const family = duckFamilyForPlatform(options.platform ?? process.platform);
  const trace = options.trace ?? ((line: string): void => console.debug(line));

  let ducked = false;
  let lastReport: DuckReport | null = null;
  /** Dernière intention reçue — seule elle est appliquée, jamais une intention périmée. */
  let wanted: DuckIntent | null = null;
  /** Une exécution est-elle en vol ? (la sérialisation tient cette réponse, pas une file longue) */
  let running = false;
  let runQueue: Array<() => void> = [];
  let restoreTimer: unknown = null;
  /** Outil indisponible : tracé UNE fois, jamais une ligne à chaque tentative. */
  let unavailableTraced = false;

  function cancelRestore(): void {
    if (restoreTimer !== null) {
      options.timers.cancel(restoreTimer);
      restoreTimer = null;
    }
  }

  /** File d'exécution : au plus une commande en vol ; la suivante part quand la précédente rend. */
  function schedule(run: () => Promise<void>): void {
    if (running) {
      // On ne remplit pas une file de commandes périmées : la prochaine salve relira `wanted`.
      return;
    }
    running = true;
    void run()
      .catch((error: unknown) => {
        trace(`[ducking] exécution interrompue : ${String(error)}`);
      })
      .finally(() => {
        running = false;
        const next = runQueue.shift();
        if (next !== undefined) next();
        // Si l'intention a bougé PENDANT l'exécution, la salve qui vient de finir la rattrape.
        else if (wanted !== null && shouldResync()) void drain();
      });
  }

  /** Vrai si l'état appliqué (`ducked`) ne correspond plus à l'intention la plus récente. */
  function shouldResync(): boolean {
    return wanted !== null && wanted.active !== ducked;
  }

  async function drain(): Promise<void> {
    const intent = wanted;
    if (intent === null || running) return;
    if (intent.active === ducked) return;
    if (family === 'noop') {
      // macOS et inconnu : no-op documenté, tracé une fois, aucune exécution, jamais un échec.
      if (!unavailableTraced) {
        unavailableTraced = true;
        trace('[ducking] plateforme sans réglage du volume des autres applications — ignoré');
      }
      return;
    }
    if (intent.active) await duckOn();
    else await duckOff();
  }

  async function duckOn(): Promise<void> {
    if (family === 'pulse') {
      const listed = await options.exec.run({ tool: 'pactl', kind: 'list' });
      if (listed.stdout !== null) {
        const inputs = parseSinkInputs(listed.stdout);
        const targets = duckTargets(inputs);
        const skipped = skippedConcordInputs(inputs);
        if (targets.length === 0) {
          // Rien à baisser (aucune entrée, ou toutes Concord) : aucun set, état inchangé.
          lastReport = {
            ducked: false,
            percent: RESTORE_VOLUME_PERCENT,
            targets,
            skipped,
            tool: 'pactl',
            unavailable: false,
          };
          return;
        }
        for (const index of targets) {
          await options.exec.run({
            tool: 'pactl',
            kind: 'set',
            index,
            percent: DUCK_VOLUME_PERCENT,
          });
        }
        ducked = true;
        cancelRestore();
        lastReport = {
          ducked: true,
          percent: DUCK_VOLUME_PERCENT,
          targets,
          skipped,
          tool: 'pactl',
          unavailable: false,
        };
        return;
      }
      // `pactl` absent : repli WirePlumber. Sans `pactl list`, on ne peut PAS connaître les ids
      // ni exclure Concord — on ne baisse donc AUCUNE entrée à l'aveugle : `wpctl` ne sert que
      // si une liste d'entrées a pu être lue. C'est le garde-fou « jamais Concord » qui commande.
      const probe = await options.exec.run({ tool: 'wpctl', kind: 'probe' });
      if (probe.stdout !== null) {
        // WirePlumber présent mais aucune entrée listable (pactl manquant) : no-op tracé,
        // le système n'est pas touché à l'aveugle.
        if (!unavailableTraced) {
          unavailableTraced = true;
          trace('[ducking] wpctl présent mais aucune entrée listable — aucune modification');
        }
      }
      traceNoToolsOnce();
      return;
    }
    if (family === 'windows') {
      for (const command of windowsDuckCommands(DUCK_VOLUME_PERCENT)) {
        const result = await options.exec.run(command);
        if (result.stdout !== null || command.tool === 'nircmd') {
          // PowerShell rend « ok » sur succès ; nircmd est silencieux sur succès : le fait
          // qu'il existe (aucune ENOENT) suffit. Un échec PowerShell tente le repli suivant.
          if (command.tool === 'powershell' && result.stdout === null) continue;
          ducked = true;
          cancelRestore();
          lastReport = {
            ducked: true,
            percent: DUCK_VOLUME_PERCENT,
            targets: [],
            skipped: [],
            tool: command.tool,
            unavailable: false,
          };
          return;
        }
      }
      traceNoToolsOnce();
      return;
    }
  }

  async function duckOff(): Promise<void> {
    if (family === 'pulse') {
      const listed = await options.exec.run({ tool: 'pactl', kind: 'list' });
      if (listed.stdout !== null) {
        const inputs = parseSinkInputs(listed.stdout);
        const targets = duckTargets(inputs);
        const skipped = skippedConcordInputs(inputs);
        for (const index of targets) {
          await options.exec.run({
            tool: 'pactl',
            kind: 'set',
            index,
            percent: RESTORE_VOLUME_PERCENT,
          });
        }
        ducked = false;
        lastReport = {
          ducked: false,
          percent: RESTORE_VOLUME_PERCENT,
          targets,
          skipped,
          tool: 'pactl',
          unavailable: false,
        };
        return;
      }
      // Repli wpctl : le ratio est un pourcentage RELATIF (`1.00` = retour au niveau de base).
      const probe = await options.exec.run({ tool: 'wpctl', kind: 'probe' });
      if (probe.stdout !== null) {
        await options.exec.run({ tool: 'wpctl', kind: 'set', id: 0, ratio: '1.00' });
        ducked = false;
        lastReport = {
          ducked: false,
          percent: RESTORE_VOLUME_PERCENT,
          targets: [0],
          skipped: [],
          tool: 'wpctl',
          unavailable: false,
        };
        return;
      }
      traceNoToolsOnce();
      return;
    }
    if (family === 'windows') {
      for (const command of windowsDuckCommands(RESTORE_VOLUME_PERCENT)) {
        const result = await options.exec.run(command);
        if (result.stdout !== null || command.tool === 'nircmd') {
          if (command.tool === 'powershell' && result.stdout === null) continue;
          ducked = false;
          lastReport = {
            ducked: false,
            percent: RESTORE_VOLUME_PERCENT,
            targets: [],
            skipped: [],
            tool: command.tool,
            unavailable: false,
          };
          return;
        }
      }
      traceNoToolsOnce();
      return;
    }
  }

  function traceNoToolsOnce(): void {
    if (unavailableTraced) return;
    unavailableTraced = true;
    trace('[ducking] aucun outil système de volume trouvé (pactl/wpctl/powershell/nircmd) — ignoré');
  }

  /** La sérialisation a fini une salve : si l'intention a bougé, on repart pour une salve. */
  function onRunFinished(): void {
    running = false;
    const next = runQueue.shift();
    if (next !== undefined) next();
    else if (shouldResync()) void drain();
  }

  return {
    apply(intent: DuckIntent): void {
      wanted = intent;
      if (intent.active) {
        // Parole : la restauration différée est annulée, et le ducking est demandé immédiatement.
        cancelRestore();
        pump();
        return;
      }
      // Silence : la restauration n'est PAS immédiate — la parole qui revient dans la fenêtre
      // de tenue l'annule (aucun pompage de volume sur une pause inter-mots).
      cancelRestore();
      restoreTimer = options.timers.once(RESTORE_HOLD_MS, () => {
        restoreTimer = null;
        // La restauration ne part que si RIEN n'est revenu pendant la tenue.
        if (wanted !== null && !wanted.active) pump();
      });
    },
    stop(intent: DuckIntent): void {
      wanted = intent;
      cancelRestore();
      pump();
    },
    state(): DuckControllerState {
      return { ducked, lastReport };
    },
  };

  /**
   * Déclenche une salve si elle est nécessaire et qu'aucune n'est en vol. Une salve en vol
   * termine PUIS relit `wanted` (garde « jamais plus d'un execFile concurrent » + intention la
   * plus récente, tous deux testés).
   */
  function pump(): void {
    if (running) return;
    if (!shouldResync()) return;
    running = true;
    void drain()
      .catch((error: unknown) => {
        trace(`[ducking] échec d’application : ${String(error)}`);
      })
      .finally(onRunFinished);
  }
}

/* ------------------------------------------------------------------ */
/* L'implémentation Electron du seam — execFile, jamais un shell       */
/* ------------------------------------------------------------------ */

/**
 * Le `DuckExec` de l'application. Chaque commande est exécutée par `child_process.execFile` avec
 * un TABLEAU d'arguments (aucune chaîne shell interpolée) et un timeout de 2 s qui tue le
 * processus enfant. Une erreur — outil absent (ENOENT), sortie non nulle, timeout — rend
 * `stdout: null`, que le contrôleur interprète comme « outil indisponible / échec → repli ».
 *
 * NON VÉRIFIÉ dans les tests unitaires : le système réel (pactl/wpctl/PowerShell). C'est le
 * rôle du seam : la logique est testée sur double, l'exécution est relue et exercée en revue.
 */
export function electronDuckExec(): DuckExec {
  return {
    run(command: DuckCommand): Promise<DuckExecResult> {
      const launched = toLaunch(command);
      if (launched === null) return Promise.resolve({ stdout: null });
      return new Promise<DuckExecResult>((resolve) => {
        // Import différé : `node --test` ne doit JAMAIS charger un module qui spawn des enfants.
        import('node:child_process')
          .then(({ execFile }) => {
            execFile(
              launched.command,
              launched.args,
              { timeout: EXEC_TIMEOUT_MS, killSignal: 'SIGKILL', windowsHide: true },
              (error, stdout) => {
                if (error !== null && error !== undefined) resolve({ stdout: null });
                else resolve({ stdout: typeof stdout === 'string' ? stdout : '' });
              },
            );
          })
          .catch(() => resolve({ stdout: null }));
      });
    },
  };
}

/** Un appel `execFile` (commande + args séparés) construit sans aucune concaténation shell. */
interface Launch {
  command: string;
  args: string[];
}

export function toLaunch(command: DuckCommand): Launch | null {
  if (command.tool === 'pactl') {
    if (command.kind === 'list') return { command: 'pactl', args: ['list', 'sink-inputs'] };
    return {
      command: 'pactl',
      args: ['set-sink-input-volume', String(command.index), '--', `${command.percent}%`],
    };
  }
  if (command.tool === 'wpctl') {
    // Sonde de disponibilité : `wpctl status` ne touche à rien et échoue si l'outil est absent.
    if (command.kind === 'probe') return { command: 'wpctl', args: ['status'] };
    return { command: 'wpctl', args: ['set-volume', String(command.id), command.ratio] };
  }
  if (command.tool === 'powershell') return windowsDuckArguments(command.percent);
  if (command.tool === 'nircmd') return { command: 'nircmd', args: nircmdDuckArguments(command.percent) };
  return null;
}
