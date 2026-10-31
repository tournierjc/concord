/**
 * audio-sink.ts — le HAUT-PARLEUR : un `<audio>` par pair distant (T16b / SPEC-007 §4.3).
 *
 * `onRemoteStream` du plan média rend un `MediaStream` : sans élément qui le porte, il ne sort
 * aucun son. Ce module tient le registre des sorties audio, une par pair :
 *
 *   1. **Créé avant l'événement.** `ensure(peerId)` allume l'élément dès qu'un pair se signale
 *      (`peer-joined`), donc avant tout flux. L'arrivée du flux ne fait que remplir `srcObject` :
 *      il n'y a jamais de flux orphelin, ni de lecteur créé à retardement qui perdrait le direct.
 *   2. **Détruit au départ du pair.** `remove(peerId)` coupe `srcObject` puis retire l'élément du
 *      document — **une seule fois** : `element.remove()` détache déjà le nœud, et le `removeChild`
 *      qui suivait levait `NotFoundError` sur un vrai DOM. Aucun flux mort ne reste branché, aucun
 *      son fantôme ne persiste, et un retrait impossible n'empêche pas les autres.
 *   3. **Testable sans navigateur.** Aucun `document` en dur : l'hôte DOM est injecté, donc
 *      `node --test` vérifie création/destruction avec un faux DOM.
 *
 * Aucune lecture réseau, aucune dépendance : ce fichier ne fait que du DOM.
 */

/** Élément `<audio>` réduit à ce dont on se sert (structurel : un faux DOM suffit en test). */
export interface SinkElement {
  srcObject: unknown;
  autoplay: boolean;
  setAttribute?(name: string, value: string): void;
  play?(): Promise<void> | void;
  remove?(): void;
}

/** Le peu de DOM nécessaire : créer un élément, l'ajouter, le retirer. */
export interface SinkHost {
  createElement(tagName: string): SinkElement;
  append(node: SinkElement): void;
  remove(node: SinkElement): void;
}

export interface AudioSink {
  readonly peerId: string;
  readonly element: SinkElement;
  readonly hasStream: boolean;
  /** Branche le flux distant et tente la lecture ; ne lève jamais. */
  attach(stream: unknown): void;
  /** Coupe le flux (l'élément reste en place jusqu'à `remove`). */
  detach(): void;
}

export interface AudioSinkRegistry {
  /** Crée l'élément s'il n'existe pas encore — à appeler AVANT l'arrivée du flux. */
  ensure(peerId: string): AudioSink;
  /** Branche un flux sur le pair (l'élément est créé au besoin). */
  attach(peerId: string, stream: unknown): AudioSink;
  remove(peerId: string): void;
  get(peerId: string): AudioSink | undefined;
  list(): AudioSink[];
  /** Détruit tous les éléments (départ du salon). */
  clear(): void;
}

/**
 * Forme minimale d'un `document` : structurelle, donc un faux DOM de test passe aussi.
 * `never` en paramètre rend n'importe quel `appendChild`/`removeChild` DOM compatible.
 */
export interface DocumentLike {
  createElement(tagName: string): unknown;
  body: { appendChild(node: never): unknown; removeChild(node: never): unknown } | null;
}

/** Hôte réel : `document` du renderer. */
export function documentSinkHost(doc: DocumentLike): SinkHost {
  return {
    createElement: (tagName) => doc.createElement(tagName) as SinkElement,
    append: (node) => {
      doc.body?.appendChild(node as never);
    },
    remove: (node) => {
      doc.body?.removeChild(node as never);
    },
  };
}

export function createAudioSinkRegistry(host: SinkHost): AudioSinkRegistry {
  const sinks = new Map<string, AudioSink & { hasStream: boolean }>();

  function create(peerId: string): AudioSink & { hasStream: boolean } {
    const element = host.createElement('audio');
    element.autoplay = true;
    element.srcObject = null;
    element.setAttribute?.('data-audio-peer', peerId);
    // `playsInline` évite la lecture plein écran sur certains moteurs mobiles ; sans contrôle
    // visible, l'élément ne prend ni focus ni place à l'écran.
    element.setAttribute?.('playsinline', '');
    element.setAttribute?.('aria-hidden', 'true');
    host.append(element);

    const sink: AudioSink & { hasStream: boolean } = {
      peerId,
      element,
      hasStream: false,
      attach(stream: unknown): void {
        element.srcObject = stream;
        sink.hasStream = stream !== null && stream !== undefined;
        try {
          const played = element.play?.();
          if (played && typeof (played as Promise<void>).catch === 'function') {
            (played as Promise<void>).catch(() => {
              // Lecture refusée (politique d'autoplay) : l'élément reste branché, l'écran le dit.
            });
          }
        } catch {
          // `play()` indisponible ou refusé : le flux est branché quand même, aucun crash.
        }
      },
      detach(): void {
        element.srcObject = null;
        sink.hasStream = false;
      },
    };
    return sink;
  }

  function remove(peerId: string): void {
    const sink = sinks.get(peerId);
    if (sink === undefined) return;
    // Sorti du registre AVANT le retrait DOM : même si le retrait échoue, le pair ne reste pas
    // dans la liste et `clear()` peut poursuivre sa boucle.
    sinks.delete(peerId);
    sink.detach();
    // UN SEUL geste de retrait. Les deux à la suite étaient un défaut, pas une ceinture :
    // `element.remove()` détache déjà le nœud, donc `body.removeChild(element)` levait
    // `NotFoundError` (`documentSinkHost.remove`, plus bas). Le `clear()` de fin de salon
    // abandonnait alors les sorties suivantes, et `closeVoice()` — dont l'appel à `clear()`
    // n'était pas protégé — n'atteignait plus la fermeture du micro ni des RTCPeerConnection.
    if (typeof sink.element.remove === 'function') {
      sink.element.remove();
      return;
    }
    host.remove(sink.element);
  }

  return {
    ensure(peerId: string): AudioSink {
      const existing = sinks.get(peerId);
      if (existing !== undefined) return existing;
      const sink = create(peerId);
      sinks.set(peerId, sink);
      return sink;
    },
    attach(peerId: string, stream: unknown): AudioSink {
      const sink = sinks.get(peerId) ?? create(peerId);
      sinks.set(peerId, sink);
      sink.attach(stream);
      return sink;
    },
    remove,
    get(peerId: string): AudioSink | undefined {
      return sinks.get(peerId);
    },
    list(): AudioSink[] {
      return [...sinks.values()];
    },
    clear(): void {
      for (const peerId of [...sinks.keys()]) {
        try {
          remove(peerId);
        } catch (error) {
          // Un DOM qui refuse un retrait ne doit pas empêcher les AUTRES sorties de tomber : la
          // décision de quitter le salon n'est pas annulée par un nœud capricieux.
          console.warn('[audio] sortie non retirée du document', error);
        }
      }
    },
  };
}
