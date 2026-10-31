/**
 * speaking-surface.ts — la surface RELAYÉE de « qui parle » (overlay), et son extinction
 * (AD-25 D2 / D4.2, §6 points 1, 3 et 4).
 *
 * Ce module est le SEUL consommateur de `SPEAKING_RELAY_STALE_MS`. Il ne mesure rien : il reçoit
 * des ids déjà mesurés dans la fenêtre principale (par `lan:speaking-set` → main → 
 * `lan:event:speaking-set`) et répond à une seule question : « à cet instant, qu'est-ce que
 * l'overlay a le droit d'affirmer ? »
 *
 * Trois règles, opposables :
 *
 * 1. **L'horodatage qui compte est l'ARRIVÉE**, jamais l'heure d'émission. L'overlay est une autre
 *    fenêtre : un âge négatif (horloges distinctes, trame reçue « du futur ») vaut `unknown`, donc
 *    un halo jamais allumé (`participant-state.ts` D5). On estampille ici, avec l'horloge de la
 *    surface, et aucune charge utile ne peut fournir cet instant.
 * 2. **Extinction par échéancier armé à l'ARRIVÉE, pas par balayage** (AD-25 D1). Un balayage de
 *    période P donne un pire cas F+P : à P = F = 2000 ms, 4000 ms contre un budget de
 *    2000 + 1 trame. Donc : un seul créneau, `cancel` puis armement à CHAQUE arrivée (sinon la
 *    garde-vie à 1 Hz empile des échéanciers qui éteignent un halo frais), `cancel` aussi au
 *    démontage, et l'échéance **vérifie l'âge** avant d'éteindre.
 * 3. **Égalité d'état ⇒ zéro notification** (ACo-16). La garde-vie à 1 Hz arrive sans rien changer :
 *    elle réarme l'échéancier mais n'appelle pas `onChange`, donc ne provoque aucun rendu.
 *
 * Aucune minuterie ambiante ici : l'échéancier passe par le port injecté (`Timers`,
 * `src/engine/timers.ts`), c'est-à-dire `browser-timers.ts` en production. Un `setTimeout` local
 * ferait un troisième fichier à minuterie et casserait A3.
 */

import type { Timers } from '../engine/timers.ts';

/**
 * Seuil de péremption de la surface relayée : 2000 ms (AD-25, ACo-9 : « 2000 + 1 trame »).
 *
 * C'est un SEUIL, pas une cadence : il n'est pas dérivé de la garde-vie de publication
 * (AD-25 §5 — « quand l'un change, l'autre n'est pas répercuté : il est réexaminé »). Le fixer à
 * `2 × SPEAKING_KEEPALIVE_MS` ferait croire que les deux nombres sont liés ; ils ne le sont pas.
 * Et c'est bien 2000, pas 2500 : le budget ACo-9 est 2000 + 1 trame (AD-23 D2 vs D4.2 tranché).
 */
export const SPEAKING_RELAY_STALE_MS = 2000;

/**
 * Ce que la surface relayée a le droit de dire : `'true'` ou `'unknown'`. **Jamais** `'false'` —
 * l'absence d'un id dit « pas de parole mesurée », pas « muet » (AD-17 D1, AD-25 §6).
 */
export type SpeakingMark = 'true' | 'unknown';

/** Ce que la surface rend à la vue : les ids affichés comme parlants MAINTENANT. */
export type SpeakingIds = readonly string[];

export interface SpeakingSurfaceOptions {
  /** Port de minuterie unique du renderer (`browserTimers()` en production). */
  timers: Timers;
  /** Horloge de la surface : sert à estampiller l'ARRIVÉE et à vérifier l'âge. */
  clock: () => number;
  /**
   * Appelé UNIQUEMENT quand l'état affiché change (arrivée différente, ou extinction).
   * C'est le seul déclencheur de rendu de l'overlay : ne pas l'appeler = zéro rendu (ACo-16).
   */
  onChange: (ids: SpeakingIds) => void;
}

export interface SpeakingSurface {
  /** Une trame reçue du main. Estampille l'arrivée, réarme l'échéancier, notifie si ça change. */
  receive(speaking: readonly string[]): void;
  /** Ids affichés comme parlants à cet instant (vide si périmé). */
  ids(): SpeakingIds;
  /** Verdict par pair : `'true'` ou `'unknown'`, jamais `'false'`. */
  speakingOf(peerId: string): SpeakingMark;
  /** Démontage : désarme l'échéancier. Aucun minuteur ne survit à l'overlay. */
  dispose(): void;
}

const EMPTY: SpeakingIds = Object.freeze([]);

/** Forme canonique : ids non vides, dédoublonnés, ordre stable (même règle que le relais). */
function canonical(speaking: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const id of speaking) {
    if (typeof id === 'string' && id.length > 0) unique.add(id);
  }
  return [...unique].sort();
}

function sameIds(a: SpeakingIds, b: SpeakingIds): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function createSpeakingSurface(options: SpeakingSurfaceOptions): SpeakingSurface {
  const { timers, clock, onChange } = options;

  /** Dernière trame non vide, avec l'instant d'ARRIVÉE (jamais l'instant d'émission). */
  let received: { ids: SpeakingIds; at: number } | null = null;
  /** L'unique créneau d'échéancier : un jeton, toujours remplacé, jamais doublé. */
  let armed: unknown = null;
  let disposed = false;

  /**
   * Un âge non fini, négatif (horloges distinctes) ou atteignant le seuil ⇒ plus rien n'est affirmé.
   *
   * Borne STRICTE : à `age === 2000` le halo est éteint. Avec `<=`, l'échéance armée à 2000 ms
   * s'exécuterait sur un âge de 2000 encore « frais » et se réarmerait à 0 ms — extinction repoussée
   * d'une trame, en boucle. La borne stricte place l'extinction DANS le budget ACo-9
   * (2000 ms + 1 trame) : vrai à 1999, faux à 2000, faux à 2001.
   */
  function live(now: number): boolean {
    if (received === null) return false;
    const age = now - received.at;
    return Number.isFinite(age) && age >= 0 && age < SPEAKING_RELAY_STALE_MS;
  }

  function displayed(now: number): SpeakingIds {
    return received !== null && live(now) ? received.ids : EMPTY;
  }

  function disarm(): void {
    if (armed === null) return;
    const handle = armed;
    armed = null;
    timers.cancel(handle);
  }

  /** Armement : un seul créneau, `cancel` d'abord (obligation AD-25 D2 « un seul créneau »). */
  function arm(delayMs: number = SPEAKING_RELAY_STALE_MS): void {
    disarm();
    if (disposed) return;
    armed = timers.once(delayMs, () => {
      armed = null;
      expire();
    });
  }

  /**
   * Échéance : elle VÉRIFIE l'âge avant d'éteindre. Une échéance qui éteint sans regarder
   * rendrait un halo frais tributaire d'un minuteur retardataire.
   */
  function expire(): void {
    if (disposed) return;
    const now = clock();
    if (live(now) && received !== null) {
      // Encore frais (arrivée plus récente que l'armement) : on réarme pour le restant exact.
      arm(Math.max(0, SPEAKING_RELAY_STALE_MS - (now - received.at)));
      return;
    }
    if (received === null) return;
    received = null;
    onChange(EMPTY);
  }

  return {
    receive(speaking: readonly string[]): void {
      if (disposed) return;
      const now = clock();
      if (!Number.isFinite(now)) return;
      const ids = canonical(speaking);
      const before = displayed(now);
      // L'ensemble vide n'est pas un état de parole : on désarme plutôt que d'armer une échéance
      // qui n'éteindrait rien. La notification, elle, ne part que si quelque chose était allumé.
      received = ids.length === 0 ? null : { ids: Object.freeze(ids), at: now };
      if (received === null) disarm();
      else arm();
      if (!sameIds(before, displayed(now))) onChange(displayed(now));
    },

    ids(): SpeakingIds {
      return displayed(clock());
    },

    speakingOf(peerId: string): SpeakingMark {
      return displayed(clock()).includes(peerId) ? 'true' : 'unknown';
    },

    dispose(): void {
      disposed = true;
      disarm();
    },
  };
}
