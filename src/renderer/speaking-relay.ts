/**
 * speaking-relay.ts — publication de l'ensemble « qui parle » vers la fenêtre d'overlay
 * (AD-19 D1 / AD-20 D1-D3, cadence arbitrée D3).
 *
 * Ce module ne MESURE rien : il ne reçoit ni niveau, ni échantillon, ni horodatage de mesure. Il
 * reçoit une liste D'IDS et décide seulement **quand** la publier. C'est la frontière qui empêche
 * le process principal (ou l'overlay) de devenir un second avis sur la parole : la mesure reste
 * dans `peer-speech.ts` (pairs) et dans le plan média (soi), la cadence est ici, le transport est
 * ailleurs.
 *
 * Règles tenues ici (AD-20 D3), et testées dans `tests/speaking-relay.test.ts` :
 *
 *  1. **Transitions seules.** Un message à l'attaque, un message à l'extinction, rien entre les
 *     deux. Pas de cœur à 5 Hz : 50 messages en 10 s ne tiennent pas dans un budget de 12.
 *  2. **Remplacement complet.** Chaque message porte l'ensemble entier (`speaking[]`), jamais un
 *     delta : un message perdu ne laisse pas l'overlay sur un état intermédiaire.
 *  3. **Garde-vie ≤ 1 Hz, uniquement si l'ensemble est non vide.** L'ensemble vide est publié UNE
 *     fois (l'extinction), puis plus rien : le silence complet ne coûte aucun message.
 *  4. **Tenue de relâchement 600 ms pour soi**, calculée ici parce que la mesure locale
 *     (`voice.level`) arrive brute, trame par trame, sans mémoire. Les pairs, eux, arrivent déjà
 *     tenus par le producteur (`peer-speech.ts`) : une seule tenue par source, jamais deux en
 *     cascade (600 + 600 = 1200 ms d'extinction, mesuré et refusé).
 *
 * L'id publié est l'**id de signalisation** — celui de `speaking[]` d'AD-19 D1, le même domaine
 * pour soi et pour les pairs, sans drapeau `self` (AD-20 D1).
 */

import { heldSpeaks } from './peer-speech.ts';

/** Période maximale entre deux publications d'un ensemble non vide (AD-20 D3 : ≤ 1 Hz). */
export const SPEAKING_KEEPALIVE_MS = 1000;

/** Instantanés d'entrée : aucun niveau, aucun booléen de pair — des ids et un verdict pour soi. */
export interface SpeakingInput {
  /** Id de signalisation de soi ; `null` tant que le salon n'a pas rendu d'id. */
  readonly selfId: string | null;
  /** Verdict BRUT de la mesure locale (seuil), non tenu : la tenue est appliquée ici. */
  readonly self: boolean;
  /** Ids des pairs déjà tenus par le producteur (`peerSpeaking(...) === 'true'`). */
  readonly peers: readonly string[];
}

export interface SpeakingRelay {
  /** Dernier ensemble publié (`[]` tant que rien n'a été publié). */
  readonly speaking: readonly string[];
  /**
   * Décide la publication. Rend l'ensemble à publier, ou `null` s'il n'y a rien à dire.
   * `now` est l'horloge du renderer, la même que celle des échantillons.
   */
  update(input: SpeakingInput, now: number): readonly string[] | null;
  /** Départ de salon : oublie la tenue et l'historique de publication (le prochain set repart à zéro). */
  reset(): void;
}

/** Forme canonique : ids vides refusés, doublons fondus, ordre stable (comparaison et test). */
function canonical(ids: readonly string[]): readonly string[] {
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0) unique.add(id);
  }
  return [...unique].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function same(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function createSpeakingRelay(): SpeakingRelay {
  /** Dernière trame où la mesure locale a VRAIMENT parlé (ancre de la tenue, cf. R-U8 §2). */
  let selfLastTrue: number | null = null;
  /** Dernier ensemble publié ; `null` = rien n'a encore été dit à l'overlay. */
  let sent: readonly string[] | null = null;
  let sentAt = Number.NEGATIVE_INFINITY;
  let current: readonly string[] = [];

  function publish(ids: readonly string[], now: number): readonly string[] {
    sent = ids;
    sentAt = now;
    current = ids;
    return ids;
  }

  return {
    get speaking(): readonly string[] {
      return current;
    },

    update(input, now): readonly string[] | null {
      // Horodatage non fini : on ne date rien, donc on ne publie rien. Un message sans horodatage
      // exploitable ferait juger la tenue sur une horloge qui n'existe pas.
      if (!Number.isFinite(now)) return null;

      if (input.self) selfLastTrue = now;
      if (selfLastTrue !== null && now < selfLastTrue) selfLastTrue = now; // horloge qui recule

      const selfId = input.selfId !== null && input.selfId.length > 0 ? input.selfId : null;
      const selfHeld = selfId !== null && heldSpeaks(input.self, selfLastTrue, now);

      const ids = canonical(selfHeld && selfId !== null ? [...input.peers, selfId] : input.peers);

      if (sent === null) {
        // Rien n'a jamais été publié : publier un ensemble vide n'apprendrait rien à l'overlay
        // (son état par défaut est déjà « inconnu ») et coûterait un message sur un silence total.
        if (ids.length === 0) return null;
        return publish(ids, now);
      }

      if (!same(ids, sent)) return publish(ids, now);

      // Ensemble inchangé : le garde-vie n'existe que pour un ensemble NON vide. Un silence qui
      // dure ne se rejoue pas à 1 Hz — c'est le seul moyen de tenir 0 message sur 10 s de silence.
      if (ids.length > 0 && now - sentAt >= SPEAKING_KEEPALIVE_MS) return publish(ids, now);

      return null;
    },

    reset(): void {
      selfLastTrue = null;
      sent = null;
      sentAt = Number.NEGATIVE_INFINITY;
      current = [];
    },
  };
}
