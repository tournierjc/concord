/**
 * room-recreate.ts — la machine qui recrée le dernier salon hébergé au démarrage
 * (2026-11-02, « add auto recreate room on startup »).
 *
 * CE QUE FAIT CE MODULE, et ce qu'il ne fait PAS. À froid, après le chargement des réglages et
 * l'init du main, le processus principal arme UN SEUL geste : si l'utilisateur hébergeait un salon
 * la dernière fois qu'il a utilisé l'app (`settings.room.lastHosted` non nul) ET que l'option
 * `settings.room.auto` est active, le salon est recréé après un délai — via le MÊME chemin que le
 * geste manuel « Créer » du lobby (le `join` du pont + le tuyau de signalisation que le main ouvre
 * derrière). Ce module ne fait qu'armer, décider et compter : il ne connaît ni Electron, ni le
 * pont, ni la signalisation — `createRoomRecreator` reçoit une fonction `host` (le geste réel) et
 * le port `Timers` (`src/main/timers.ts`, SPEC-012 §4). C'est ce découpage qui rend chaque garde
 * falsifiable sous `node --test` avec une horloge manuelle.
 *
 * Les règles, énoncées une fois ici et reprises en tests :
 *  1. JAMAIS un recréage sans mesure : `lastHosted` absent, nul, ou option éteinte ⇒ la machine
 *     n'arme RIEN. `arm()` est une décision pure : même entrée, même sortie, aucun effet de bord.
 *  2. LE DÉLAI (2 s, `RECREATE_STARTUP_DELAY_MS`) attend que le réseau et le browse mDNS soient
 *     prêts — `discovery.start()` vient de tourner, ses callbacks `up` sont asynchrones — et ne
 *     bloque pas le rendu : rien ne part avant l'échéance, l'UI est déjà peinte.
 *  3. UNE SEULE TENTATIVE par session. Un échec (nom déjà porté par un pair, pas de réseau, mDNS
 *     en panne, `join` refusé) publie `failed` une fois et se tait : pas de boucle de retry. La
 *     personne garde le bouton [Créer et rejoindre] du lobby, qui est la vraie réponse.
 *  4. L'État se lit, jamais ne se déduit : le lobby n'affiche qu'une ligne sobre (aria-live),
 *     jamais un modal, jamais une barre pendant un salon (`host` n'est appelé que hors salon).
 *  5. Les libellés sont des CLÉS i18n (`room.auto.*`), pas des phrases : le main ne connaît pas
 *     la langue, le renderer traduit (même patron que `notice` du pont de salon).
 *
 * Rétro-compat assumée : un `settings.json` écrit avant ce changement n'a pas le groupe `room` ;
 * le schéma le lit (`readRoomSection`) et rend `auto: true` + `lastHosted: null` — donc la machine
 * n'arme rien, exactement comme si personne n'avait jamais hébergé de salon.
 */

import type { Timers } from '../engine/timers.ts';

/**
 * Délai avant le recréage automatique : 2 s. Pas 0 — `discovery.start()` et les liaisons réseau
 * sont en vol au moment où le main arme la machine, et un `join` trop tôt hébergerait un salon que
 * personne ne voit encore (l'annonce mDNS part au bind, mais le browse voisin n'a rien demandé).
 * Pas 30 s — l'utilisateur doit retrouver son salon pendant qu'il regarde l'écran.
 */
export const RECREATE_STARTUP_DELAY_MS = 2000;

/** Les phases de la machine, dans l'ordre du cycle normal, plus l'arrêt sur échec. */
export type RecreatePhase =
  /** Rien n'a été armé (jamais d'armement, ou option éteinte, ou pas de mesure). */
  | 'idle'
  /** Minuterie armée, le geste n'a pas encore eu lieu. */
  | 'pending'
  /** Le geste `host` est en cours (le join + le tuyau du main). */
  | 'recreating'
  /** Le salon est recréé — l'événement d'état du pont le dit déjà, cet état n'ajoute rien. */
  | 'recreated'
  /** Échec définitif pour cette session : une ligne dans le lobby, aucune nouvelle tentative. */
  | 'failed';

/** La raison d'un échec, sous forme de CLÉ (le renderer traduit, le main ne connaît pas la langue). */
export type RecreateFailureKey = 'room.auto.failed.hosting' | 'room.auto.failed.network' | 'room.auto.failed.create';

/** L'état publié au lobby à chaque transition (`eventRoomRecreate`). */
export interface RecreateState {
  phase: RecreatePhase;
  /** Nom du salon visé — la mesure, ou `null` tant qu'aucun nom n'a été lu. */
  roomName: string | null;
  /** Clé du libellé d'échec (`room.auto.failed.*`), ou `null` hors échec. Jamais une phrase. */
  reasonKey: RecreateFailureKey | null;
}

export const IDLE_RECREATE_STATE: RecreateState = { phase: 'idle', roomName: null, reasonKey: null };

/** Ce que la machine lit des réglages — réduit au strict nécessaire, jamais l'objet complet. */
export interface RecreateSettingsView {
  auto: boolean;
  lastHosted: { name: string; capacity: number } | null;
}

/**
 * Ce que la machine exige pour armer : la mesure ET l'intention. Une fonction pure — testée sans
 * horloge ni double : mêmes réglages, même décision.
 */
export function shouldAutoRecreateOnStartup(settings: RecreateSettingsView): boolean {
  return settings.auto === true && settings.lastHosted !== null;
}

/**
 * La décision « créer ou rejoindre » quand un NOM EST DÉJÀ PORTÉ sur le réseau (règle anti-hôte-
 * doublon du lobby, 31/10/2026). Un recréage automatique qui créerait un SECOND salon du même nom
 * trahirait cette règle : si un pair (ou l'ancienne annonce qui n'a pas encore expiré) porte déjà
 * CE nom, le geste automatique s'ARRÊTE plutôt que de dupliquer — c'est un `failed` discret, et la
 * personne garde la main (elle verra le salon dans sa liste et pourra le rejoindre elle-même).
 *
 * Pure, exécutée sous `node --test` : c'est la seule façon de prouver que l'automatisme ne crée
 * jamais un doublon, sans allumer un réseau.
 */
export function autoRecreateCreateAction(
  lastHosted: { name: string } | null,
  discoveredNames: readonly string[],
): { kind: 'blocked'; reasonKey: RecreateFailureKey } | { kind: 'create'; name: string } {
  if (lastHosted === null) return { kind: 'blocked', reasonKey: 'room.auto.failed.create' };
  const wanted = lastHosted.name.trim().toLocaleLowerCase();
  if (wanted.length === 0) return { kind: 'blocked', reasonKey: 'room.auto.failed.create' };
  const taken = discoveredNames.some((name) => name.trim().toLocaleLowerCase() === wanted);
  if (taken) return { kind: 'blocked', reasonKey: 'room.auto.failed.hosting' };
  return { kind: 'create', name: lastHosted.name };
}

/** L'injection du geste réel : `host` recrée le salon (join + tuyau, chemin du flux manuel). */
export interface RoomRecreatorOptions {
  /** Le geste réel — le MÊME que `runCreateAction` du lobby. Rend `false` si le salon n'a pas été créé. */
  host(name: string): Promise<boolean> | boolean;
  /** Le réglage courant, lu À L'ÉCHÉANCE (pas à l'armement) : éteindre l'option avant les 2 s éteint le geste. */
  settings(): RecreateSettingsView;
  /** Les noms des salons vus sur le réseau à l'instant du geste (registre de découverte). */
  discoveredNames(): readonly string[];
  timers: Timers;
  /** Publication vers le lobby à chaque transition. */
  onStateChange(state: RecreateState): void;
}

export interface RoomRecreator {
  /**
   * Arme le recréage (appelé au démarrage, après les fenêtres et les handlers). Ne JAMAIS lever,
   * ne jamais rien publier avant l'échéance. Rend `false` si rien n'a été armé (garde `arm`), et
   * dans ce cas RIEN n'est écrit nulle part : la lecture des réglages ne compte pas comme action.
   */
  arm(): boolean;
  /** Désarmer la minuterie en vol (`will-quit`) ; un geste déjà lancé n'est pas annulable — il est unique. */
  stop(): void;
  /** Le dernier état publié (instantané pour le lobby au montage). */
  getState(): RecreateState;
}

export function createRoomRecreator(options: RoomRecreatorOptions): RoomRecreator {
  let state: RecreateState = { ...IDLE_RECREATE_STATE };
  let handle: unknown = null;
  /** Une seule tentative par session : posée au premier geste, jamais relevée. */
  let attempted = false;

  function publish(next: RecreateState): void {
    state = next;
    options.onStateChange(next);
  }

  async function run(name: string): Promise<void> {
    if (state.phase !== 'recreating') publish({ phase: 'recreating', roomName: name, reasonKey: null });
    let created = false;
    try {
      created = await options.host(name);
    } catch {
      // Un geste qui lève est un échec comme les autres : une ligne, pas une pile d'appels.
      created = false;
    }
    if (created) {
      publish({ phase: 'recreated', roomName: name, reasonKey: null });
      return;
    }
    publish({ phase: 'failed', roomName: name, reasonKey: 'room.auto.failed.create' });
  }

  function arm(): boolean {
    // Décision lue À L'ARMEMENT — si le geste doit avoir lieu, il relit à l'échéance (ci-dessous).
    const current = options.settings();
    if (!shouldAutoRecreateOnStartup(current) || attempted) return false;
    const lastHosted = current.lastHosted;
    if (lastHosted === null) return false;
    publish({ phase: 'pending', roomName: lastHosted.name, reasonKey: null });
    handle = options.timers.once(RECREATE_STARTUP_DELAY_MS, () => {
      handle = null;
      // Relue À L'ÉCHÉANCE : l'option peut avoir été éteinte pendant les 2 s, et l'UI n'est pas
      // l'autorité — c'est ici que la garde « éteint ⇒ rien de neuf » est appliquée, pas dans le lobby.
      const atDelay = options.settings();
      if (!shouldAutoRecreateOnStartup(atDelay) || atDelay.lastHosted === null) {
        publish(IDLE_RECREATE_STATE);
        return;
      }
      // Anti-doublon : un nom déjà porté sur le réseau ⇒ on ne crée PAS, on le dit une fois.
      const action = autoRecreateCreateAction(atDelay.lastHosted, options.discoveredNames());
      if (action.kind === 'blocked') {
        publish({ phase: 'failed', roomName: atDelay.lastHosted.name, reasonKey: action.reasonKey });
        return;
      }
      attempted = true;
      void run(action.name);
    });
    return true;
  }

  function stop(): void {
    if (handle === null) return;
    options.timers.cancel(handle);
    handle = null;
    // Une minuterie désarmée sans geste n'a rien affirmé : l'état reste celui qu'il était avant
    // (`idle` si personne n'a armé plus tôt, `pending` ici — mais la session se termine, rien à publier).
  }

  return { arm, stop, getState: () => state };
}
