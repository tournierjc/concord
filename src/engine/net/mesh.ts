/**
 * src/engine/net/mesh.ts — pilote de maillage WebRTC, sans transport (Carillon)
 *
 * TÂCHE T16a / SPEC-007 §4.2. Contrat **gelé** (signature identique, non renégociable) :
 *
 *   MeshOptions, Mesh, createMesh()
 *
 * Ce que fait ce fichier : il transforme un flux de messages de signalisation
 * (`SignalIn`, fourni par la coquille : mDNS + TCP ligne-JSON) en gestes sur le
 * plan média (`MediaPlane`, `src/engine/rtc/media-plane.ts`), et inversement.
 *
 * Ce qu'il ne fait PAS, volontairement :
 *   • aucun transport : le tuyau sortant est la fonction `send` de l'appelant ;
 *   • aucune horloge AMBIANTE : le seul délai (les 5 s sans flux, SPEC-008 §1)
 *     est armé sur l'horloge INJECTÉE `MeshOptions.timers` (`src/engine/timers.ts`),
 *     fournie par la coquille. SPEC-004 §3 interdit toute minuterie ambiante dans
 *     `src/engine/**` (cf. `tests/engine-purity.test.ts`) ; un test fournit une
 *     horloge manuelle et déclenche
 *     l'échéance à la main, sans attente réelle ;
 *   • aucun accès réseau, aucun global navigateur (ni `RTCPeerConnection`, ni
 *     `navigator`) : les contraintes de SPEC-004 §3 restent tenues, le fichier
 *     est effaçable et importable en Node pur.
 *
 * PRÉCONDITION D'ORDRE (SPEC-007 §4.2, vérifiée par A7) : l'appelant doit
 * avoir lancé `plane.startMicrophone()` AVANT de router le premier
 * `peer-joined` dans `onSignal`. `MeshOptions` ne porte volontairement pas la
 * piste locale (contrat gelé), donc ce pilote ne peut pas la créer : s'il
 * ouvre un lien avant le micro, `attach()`/`accept()` négocient une
 * description locale SANS ligne audio, et le branchement tardif tombe après
 * `setLocalDescription` — le lien est né sourd, sans erreur. Le plan média
 * trace ce cas (une ligne par pair, avec le remède), mais l'ordre reste une
 * obligation de l'intégration, pas une option.
 *
 * Pourquoi les types §4.1 sont RECOPIÉS ici plutôt qu'importés du contrat :
 *   `src/shell/ipc-contract.ts` est la couche DTO de l'IPC (lue par main et
 *   preload, qui importent déjà `settings-schema`). L'importer depuis
 *   `src/engine/**` créerait une dépendance engine → shell à rebours de la
 *   stratification, et ferait dépendre le module pur de la coquille IPC. Au
 *   moment de l'écriture (T16a), les exports `SignalKind` / `SignalOut` /
 *   `SignalIn` n'existent pas encore dans ce fichier — ils sont livrés par T16b
 *   (Cadre) : `grep -c Signal src/shell/ipc-contract.ts` = 0. Recopie donc, à
 *   l'identique, avec dette explicite : quand T16b les publie, la suppression du
 *   doublon se fait d'un bloc (remplacer ce bloc par un `import type`) et un
 *   test de parité type-à-type (assignabilité dans les deux sens) doit alors
 *   être ajouté côté contrat.
 */

import type { MediaPlane } from '../rtc/media-plane.ts'
import type { Timers } from '../timers.ts'

/* ------------------------------------------------------------------ */
/* §4.1 — charge utile de signalisation (recopie du contrat, cf. plus haut) */
/* ------------------------------------------------------------------ */

export type SignalKind = 'offer' | 'answer' | 'ice'

export type SignalOut =
  | { kind: SignalKind; to: string; payload: unknown }
  | { kind: 'leave' }

export type SignalIn =
  | { kind: 'peer-joined'; peerId: string; name: string; avatarRef?: string }
  | { kind: 'peer-left'; peerId: string }
  | { kind: SignalKind; from: string; payload: unknown }
  /**
   * Image d'avatar reçue d'un pair (SPEC-002, amendement 2026-10-31) — réponse du main à un
   * `avatar_get` portant une empreinte inconnue. `data` = PNG validé, `null` = le répondant ne
   * la connaît pas (repli sur les initiales). Le maillage ne consomme pas cet événement, il le
   * laisse passer vers l'affichage.
   */
  | { kind: 'avatar-data'; from: string; avatarRef: string; data: string | null }
  | {
      kind: 'link'
      state: 'connecting' | 'connected' | 'refused' | 'closed'
      detail: string | null
    }

/* ------------------------------------------------------------------ */
/* §4.2 — contrat du pilote de maillage                                */
/* ------------------------------------------------------------------ */

/**
 * Vocabulaire de cause d'un changement d'état de lien — celui de SPEC-008 §2
 * (`cause.ice`, `cause.timeout`, `cause.sink`), pour qu'aucun mot nouveau
 * n'apparaisse dans l'interface. Le maillage émet `'ice'` et `'timeout'`;
 * `'sink'` est réservé à la coquille (sortie audio) et complète l'union pour
 * que le type reste le même de bout en bout.
 */
export type PeerStateCause = 'ice' | 'timeout' | 'sink'

/** Les quatre paliers que le maillage sait nommer (SPEC-008 §1). */
export type MeshPeerState = 'connecting' | 'connected' | 'noFlow' | 'failed'

export interface MeshOptions {
  localId: string
  plane: MediaPlane
  /** Tuyau sortant fourni par l'appelant (aucun réseau ici). */
  send: (msg: SignalOut) => void
  /** Nombre maximum de pairs simultanés. Défaut : 8 (SPEC-007 §7). */
  maxPeers?: number
  /**
   * État d'un lien, AVEC sa cause (`'ice'` = négociation, `'timeout'` = horloge
   * des 5 s, `'sink'` = sortie audio côté coquille). La cause est obligatoire :
   * sans elle, « échec » et « délai dépassé » restaient indiscernables (DÉFAUT-E).
   */
  onPeerState?: (peerId: string, state: MeshPeerState, cause: PeerStateCause) => void
  /**
   * Horloge « pas de flux » : 5 s, plafond de SPEC-008 §1. Surchargeable par le
   * harnais de test uniquement (le défaut est la valeur de la fiche).
   */
  flowTimeoutMs?: number
  /**
   * Horloge INJECTÉE qui arme l'échéance des 5 s (SPEC-004 §3 : aucun timer dans
   * `src/engine/**`). Champ **requis** : sans horloge la veille ne s'arme pas et
   * `noFlow` ne se déclenche jamais — un silence, exactement le défaut que
   * DÉFAUT-E demandait de supprimer. Une horloge qu'on peut oublier est une
   * horloge qu'on oubliera : d'où le champ obligatoire, pas un défaut muet.
   */
  timers: Timers
  /**
   * Flux distant d'un pair CONNU, AVEC son identité (AD-17 / D3).
   *
   * Le maillage ne devine pas : il reçoit `peerId` du plan média (seul témoin de
   * la `RTCPeerConnection` d'origine) et ne transmet que si ce pair a un lien
   * ouvert ici. Un flux sans pair connu est compté et tracé (`unattributed: N`),
   * jamais remis à l'appelant — c'est DÉFAUT-C : « premier pair sans flux » puis
   * `distant-<n>` à l'écran.
   */
  onRemoteStream?: (peerId: string, stream: MediaStream) => void
}

export interface Mesh {
  /** Entrée unique de la signalisation entrante. Idempotente, ne rejette jamais. */
  onSignal(msg: SignalIn): Promise<void>
  /**
   * Sortie ICE : le plan média annonce ici chaque candidat local, AVEC le pair
   * émetteur (AD-16 / T17). Jamais de diffusion à tous, jamais de silence : un
   * candidat sans lien ouvert est tracé et compté.
   */
  onLocalCandidate(peerId: string, candidate: RTCIceCandidateInit | null): void
  /**
   * Entrée ICE : candidat distant à remettre au plan média pour ce pair.
   * Même chemin que la signalisation `ice` (qui y délègue), pour que les deux
   * provenances ne puissent pas diverger.
   */
  addCandidate(peerId: string, candidate: RTCIceCandidateInit | null): Promise<void>
  /**
   * Entrée flux : une piste distante arrive du plan média AVEC son pair (AD-17 /
   * D3). Sixième et dernier membre de la surface : sans lui, l'appelant devait
   * rattacher le flux lui-même — c'est exactement ce qui a produit DÉFAUT-C.
   *
   * Un flux attribué est AUSSI la preuve de flux du lien (SPEC-008 §1, défaut (c)) :
   * c'est lui qui désarme l'horloge des 5 s et autorise `connected`.
   */
  onRemoteStream(peerId: string, stream: MediaStream): void
  /**
   * Preuve de flux par le niveau mesuré (défaut (c), SPEC-008 §1) : la coquille
   * appelle ici quand `plane.level(peerId)` a rendu un nombre pour ce pair.
   * Septième membre de la surface (ajout assumé, commentaire et test de surface
   * mis à jour avec lui) — sans lui, un lien dont la piste est arrivée AVANT
   * l'ouverture du lien mesh ne pourrait jamais être dit connecté sur mesure.
   */
  reportFlow(peerId: string): void
  /** Pairs du maillage, triés, jamais de doublon. */
  peers(): string[]
  close(): void
}

/** Défaut du nombre de pairs (SPEC-007 §7 : « pas de plus de 8 pairs »). */
const DEFAULT_MAX_PEERS = 8

/** Rôle déterministe d'un lien : `localId < remoteId` ⇒ j'offre, sinon j'attends. */
type LinkRole = 'offerer' | 'answerer'

/**
 * Preuve de flux d'un lien (SPEC-008 §1). Deux témoins, tous deux portés par le
 * pair, jamais déduits d'un minuteur :
 *   • `'track'` — `onRemoteStream(peerId, …)` est passé par ce lien : la piste
 *     distante est arrivée (`ontrack` de la bonne `RTCPeerConnection`) ;
 *   • `'level'` — `reportFlow(peerId)` a reçu un niveau mesuré pour ce pair.
 * Un lien sans preuve ne peut être dit `connected` : le SDP échangé prouve la
 * négociation, pas la voix.
 */
type FlowProof = 'track' | 'level'

/**
 * Où en est la négociation du lien :
 *   'waiting'  — lien connu, aucune description locale encore posée
 *   'offered'  — j'ai émis (offreur) ou accepté (répondeur) une description, en vol
 *   'answered' — échange de descriptions terminé : plus aucune description à émettre
 *   'failed'   — un geste du plan média a échoué : lien retiré, aucune reprise implicite
 */
type LinkPhase = 'waiting' | 'offered' | 'answered' | 'failed'

interface Link {
  readonly peerId: string
  readonly role: LinkRole
  phase: LinkPhase
  /** SDP de la dernière offre distante acceptée (répondeur) — clé d'idempotence. */
  remoteOfferSdp: string
  /**
   * Preuve de flux reçue pour ce lien (`null` tant qu'aucun échantillon, aucune
   * piste n'est arrivée). C'est elle qui autorise `connected`, jamais l'échange
   * de SDP seul (défaut (c), SPEC-008 §1).
   */
  flow: FlowProof | null
  /**
   * Le palier `connected` a-t-il déjà été annoncé pour la preuve en cours ?
   * `noFlow` réarme cette autorisation : une preuve tardive doit pouvoir
   * ramener le lien à `connected` une fois, puis se taire.
   */
  connectedAnnounced: boolean
}

/** Trace d'un refus : jamais une exception, toujours une ligne lisible. */
function warn(message: string): void {
  console.warn(`[mesh] ${message}`)
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Objet non nul : premier palier de toute validation de charge utile `unknown`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Valide une charge utile de description de session SANS assertion de type :
 * on exige la forme exacte (`type` attendu + `sdp` non vide) et on rend un objet
 * NEUF, jamais l'objet de l'appelant (aucun alias mutable entre le réseau et le
 * plan média).
 */
function descriptionOf(
  value: unknown,
  expected: 'offer' | 'answer'
): RTCSessionDescriptionInit | null {
  if (!isRecord(value)) return null
  if (value['type'] !== expected) return null
  const sdp = value['sdp']
  if (typeof sdp !== 'string' || sdp.length === 0) return null
  return { type: expected, sdp }
}

/** Résultat de validation d'un candidat : valide (avec `null` = fin de ramassage), ou malformé. */
type ParsedCandidate =
  | { readonly ok: true; readonly value: RTCIceCandidateInit | null }
  | { readonly ok: false; readonly reason: string }

/**
 * Valide une charge utile `ice`.
 *   • `null`, ou `candidate: ''` ⇒ candidat de FIN DE RAMASSAGE (marqueur, pas un
 *     candidat) : `{ ok: true, value: null }` — on le transmet quand même au plan
 *     média, qui en fait un no-op documenté (DÉFAUT-2) ;
 *   • forme invalide (champs absents ou de mauvais type) ⇒ `{ ok: false }` : refus
 *     explicite tracé, aucun appel au plan média, aucune exception (SPEC-007 A6).
 */
function parseCandidate(value: unknown): ParsedCandidate {
  if (value === null) return { ok: true, value: null }
  if (!isRecord(value)) return { ok: false, reason: 'charge utile non objet' }

  const line = value['candidate']
  if (typeof line !== 'string') return { ok: false, reason: 'champ « candidate » absent ou non chaîne' }
  if (line.length === 0) return { ok: true, value: null }

  const mid = value['sdpMid']
  if (mid !== undefined && mid !== null && typeof mid !== 'string') {
    return { ok: false, reason: 'champ « sdpMid » de type invalide' }
  }
  const index = value['sdpMLineIndex']
  if (index !== undefined && index !== null && typeof index !== 'number') {
    return { ok: false, reason: 'champ « sdpMLineIndex » de type invalide' }
  }

  const candidate: RTCIceCandidateInit = {
    candidate: line,
    sdpMid: typeof mid === 'string' ? mid : null,
    sdpMLineIndex: typeof index === 'number' ? index : null,
  }
  return { ok: true, value: candidate }
}

/**
 * Normalise `maxPeers` : entier ≥ 1. Toute valeur non finie, négative ou nulle
 * retombe sur le défaut (8) — une borne de sûreté ne se devine pas d'un NaN.
 */
function normaliseMaxPeers(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_PEERS
  if (!Number.isFinite(value)) return DEFAULT_MAX_PEERS
  const floored = Math.floor(value)
  if (floored < 1) return DEFAULT_MAX_PEERS
  return floored
}

/**
 * Normalise `flowTimeoutMs` : entier fini > 0, sinon la valeur de la fiche
 * (5 000 ms). Zéro « pour désactiver » n'existe pas : l'horloge de SPEC-008
 * n'est pas optionnelle.
 */
function normaliseFlowTimeout(value: number | undefined): number {
  if (value === undefined) return FLOW_TIMEOUT_MS
  if (!Number.isFinite(value)) return FLOW_TIMEOUT_MS
  const floored = Math.floor(value)
  if (floored < 1) return FLOW_TIMEOUT_MS
  return floored
}

/** Horloge « pas de flux » de SPEC-008 §1 : `noFlow` commence exactement à 5 s. */
const FLOW_TIMEOUT_MS = 5_000

/**
 * Construit le pilote de maillage.
 *
 * Les décisions de routage sont déterministes ; la seule horloge est celle de
 * SPEC-008 §1 (5 s sans flux ⇒ `noFlow`, cause `'timeout'`). Aucune I/O réseau :
 * tout passe par `send` (l'appelant) et par le plan média.
 */
export function createMesh(o: MeshOptions): Mesh {
  const localId = o.localId
  const plane = o.plane
  const maxPeers = normaliseMaxPeers(o.maxPeers)
  const flowTimeoutMs = normaliseFlowTimeout(o.flowTimeoutMs)
  const timers = o.timers
  const links = new Map<string, Link>()
  /** Un seul minuteur par pair : celui des 5 s sans flux. Jamais deux. */
  const clocks = new Map<string, unknown>()
  let closed = false
  /** Candidats locaux arrivés sans lien ouvert : comptés et tracés, jamais diffusés. */
  let orphanCandidates = 0
  /** Flux reçus sans pair connu (AD-17 / D3) : comptés et tracés, jamais attribués. */
  let unattributedStreams = 0

  function notify(peerId: string, state: MeshPeerState, cause: PeerStateCause): void {
    const callback = o.onPeerState
    if (callback === undefined) return
    callback(peerId, state, cause)
  }

  function send(msg: SignalOut): void {
    if (closed) return
    o.send(msg)
  }

  /** Débranche l'horloge d'un pair (départ, échec, fermeture). */
  function clearClock(peerId: string): void {
    if (!clocks.has(peerId)) return
    const handle = clocks.get(peerId)
    clocks.delete(peerId)
    timers.cancel(handle)
  }

  /**
   * La preuve de flux est arrivée pour ce lien : désarme l'horloge des 5 s et
   * publie `connected`, UNE SEULE FOIS par preuve.
   *
   * Défaut (c) : avant cette fonction, `answerTo()`/`onAnswer()` appelaient
   * `clearClock()` + `notify('connected','ice')` dès l'échange de SDP. Un pair
   * muet (ICE vivant, aucun paquet audio) restait affiché « connecté » FOREVER —
   * le chien de garde `noFlow` était désarmé par la négociation, qui n'est pas
   * une preuve de voix. Ici, le SDP ne désarme plus rien : seule une preuve
   * l'autorise — piste distante (`'track'`) ou niveau mesuré (`'level'`).
   */
  function proveFlow(link: Link, proof: FlowProof): void {
    if (closed) return
    if (links.get(link.peerId) !== link) return
    link.flow = proof
    if (link.connectedAnnounced) return
    link.connectedAnnounced = true
    clearClock(link.peerId)
    notify(link.peerId, 'connected', 'ice')
  }

  /**
   * Horloge des 5 s (SPEC-008 §1) : un lien qui n'a PAS apporté de preuve de flux
   * au bout de 5 s n'a pas de voix — on le dit (`noFlow`, cause `'timeout'`) au
   * lieu de laisser l'interface afficher « connexion » pour toujours.
   * Le lien n'est PAS détruit : une preuve tardive (`proveFlow`) le rétablit
   * (`connected`) — y compris après un `answered` de SDP sans flux, que
   * l'ancienne version excluait de l'horloge par `if (phase === 'answered')`.
   */
  function armClock(link: Link): void {
    clearClock(link.peerId)
    const handle = timers.once(flowTimeoutMs, () => {
      clocks.delete(link.peerId)
      if (closed) return
      if (links.get(link.peerId) !== link) return
      if (link.flow !== null) return
      link.connectedAnnounced = false // une preuve tardive ramènera `connected`
      warn(`${link.peerId} : pas de flux après ${flowTimeoutMs} ms — noFlow`)
      notify(link.peerId, 'noFlow', 'timeout')
    })
    clocks.set(link.peerId, handle)
  }

  /** Vide l'état du lien et signale l'échec — jamais silencieux, toujours causé. */
  function fail(link: Link, what: string, error: unknown): void {
    link.phase = 'failed'
    links.delete(link.peerId)
    clearClock(link.peerId)
    warn(`${what} avec ${link.peerId} : ${describeError(error)}`)
    notify(link.peerId, 'failed', 'ice')
  }

  /**
   * Offreur : `attach()` puis envoi de l'offre, UNE SEULE FOIS par lien.
   * `phase` passe à 'offered' AVANT le premier `await` : une ré-entrance
   * (deux `peer-joined` rejoués, ou un `ice` arrivé pendant l'attente) ne peut
   * donc pas déclencher une seconde offre ni un second `attach()`.
   */
  async function offerTo(link: Link): Promise<void> {
    if (link.phase !== 'waiting') return
    link.phase = 'offered'
    try {
      const offer = await plane.attach(link.peerId)
      send({ kind: 'offer', to: link.peerId, payload: offer })
    } catch (error: unknown) {
      fail(link, 'attach/offer', error)
    }
  }

  /**
   * Répondeur : `accept()` puis envoi de la réponse, UNE SEULE FOIS par SDP
   * d'offre. Un second `accept()` n'a lieu que si l'offre distante diffère
   * réellement de celle déjà acceptée (renégociation demandée par le pair) ;
   * c'est le seul chemin qui produirait un second SDP de notre côté.
   */
  async function answerTo(link: Link, offer: RTCSessionDescriptionInit, sdp: string): Promise<void> {
    link.phase = 'offered'
    try {
      const answer = await plane.accept(link.peerId, offer)
      link.remoteOfferSdp = sdp
      link.phase = 'answered'
      send({ kind: 'answer', to: link.peerId, payload: answer })
      // Défaut (c) : plus de `clearClock()` + `notify('connected','ice')` ici.
      // L'échange de SDP prouve la négociation, pas la voix — SPEC-008 §1 exige
      // un flux reçu il y a moins de 5 s. L'horloge des 5 s reste ARMÉE jusqu'à
      // preuve réelle (`onRemoteStream` ou `reportFlow`).
    } catch (error: unknown) {
      fail(link, 'accept/answer', error)
    }
  }

  /** Crée le lien s'il reste de la place ; sinon refuse explicitement. */
  function openLink(peerId: string, cause: string): Link | null {
    if (peerId === localId) {
      warn(`message ${cause} ignoré : il vient de moi-même (${localId})`)
      return null
    }
    const existing = links.get(peerId)
    if (existing !== undefined) return existing
    if (links.size >= maxPeers) {
      warn(`${cause} refusé : borne de ${maxPeers} pairs atteinte (${peerId} reste hors maillage)`)
      return null
    }
    const link: Link = {
      peerId,
      role: localId < peerId ? 'offerer' : 'answerer',
      phase: 'waiting',
      remoteOfferSdp: '',
      flow: null,
      connectedAnnounced: false,
    }
    links.set(peerId, link)
    notify(peerId, 'connecting', 'ice')
    armClock(link)
    return link
  }

  async function onPeerJoined(peerId: string): Promise<void> {
    const existing = links.get(peerId)
    if (existing !== undefined) {
      // Idempotence : un `peer-joined` rejoué ne rouvre rien et ne re-offre rien.
      return
    }
    const link = openLink(peerId, 'peer-joined')
    if (link === null) return
    if (link.role === 'offerer') await offerTo(link)
  }

  async function onOffer(from: string, payload: unknown): Promise<void> {
    const offer = descriptionOf(payload, 'offer')
    if (offer === null) {
      warn(`offer de ${from} refusée : charge utile sans type 'offer' ni SDP`)
      return
    }
    const link = openLink(from, 'offer')
    if (link === null) return
    if (link.role === 'offerer') {
      // Deux offreurs simultanés : je suis l'offreur désigné (`localId < from`),
      // donc MON offre gagne et l'offre entrante est ignorée. Jamais deux SDP
      // pour un même lien.
      warn(`offre de ${from} ignorée : je suis l'offreur désigné de ce lien`)
      await offerTo(link)
      return
    }
    const sdp = offer.sdp ?? ''
    if (link.phase === 'answered' && link.remoteOfferSdp === sdp) {
      // Idempotence : même offre rejouée ⇒ aucun second accept, aucune seconde
      // réponse, aucun second SDP. (La file `pending` du plan média et son map
      // de pairs sont déjà en place, cf. DÉFAUT-2.)
      return
    }
    await answerTo(link, offer, sdp)
  }

  async function onAnswer(from: string, payload: unknown): Promise<void> {
    const answer = descriptionOf(payload, 'answer')
    if (answer === null) {
      warn(`answer de ${from} refusée : charge utile sans type 'answer' ni SDP`)
      return
    }
    const link = links.get(from)
    if (link === undefined) {
      warn(`answer de ${from} ignorée : aucun lien ouvert (offre jamais émise)`)
      return
    }
    if (link.role !== 'offerer') {
      warn(`answer de ${from} ignorée : je suis le répondeur de ce lien`)
      return
    }
    if (link.phase === 'answered') return // idempotence : pas de second acceptAnswer
    if (link.phase !== 'offered') {
      warn(`answer de ${from} ignorée : aucune offre locale en vol`)
      return
    }
    link.phase = 'answered'
    try {
      await plane.acceptAnswer(link.peerId, answer)
      // Défaut (c) : plus de `clearClock()` + `notify('connected','ice')` ici —
      // la réponse SDP reçue n'est pas une preuve de flux. L'horloge des 5 s
      // reste armée ; `onRemoteStream`/`reportFlow` la désarmeront, sinon
      // `noFlow` sonnera à 5 s sans détruire le lien.
    } catch (error: unknown) {
      fail(link, 'acceptAnswer', error)
    }
  }

  /**
   * Entrée ICE, commune aux deux provenances (signalisation `ice`, et appel
   * direct `addCandidate`) : un seul chemin, donc pas de divergence possible.
   * `null` = fin de ramassage, transmis tel quel (no-op côté plan média). Les
   * candidats LAN arrivés avant la description distante sont mis en file par le
   * plan média, jamais perdus. Un candidat refusé ne tue pas le lien, mais il
   * n'est jamais avalé en silence.
   */
  async function addCandidate(peerId: string, candidate: RTCIceCandidateInit | null): Promise<void> {
    if (closed) {
      warn(`candidat de ${peerId} ignoré : maillage fermé`)
      return
    }
    const link = links.get(peerId)
    if (link === undefined) {
      warn(`candidat de ${peerId} ignoré : aucun lien ouvert pour ce pair`)
      return
    }
    try {
      await plane.addRemoteCandidate(link.peerId, candidate)
    } catch (error: unknown) {
      warn(`addRemoteCandidate(${peerId}) a échoué : ${describeError(error)}`)
    }
  }

  async function onIce(from: string, payload: unknown): Promise<void> {
    const parsed = parseCandidate(payload)
    if (!parsed.ok) {
      warn(`ice de ${from} refusé : ${parsed.reason}`)
      return
    }
    await addCandidate(from, parsed.value)
  }

  /**
   * Sortie ICE (AD-16 / T17) : le plan média appelle ici pour CHAQUE candidat
   * local, avec le pair émetteur. On l'achemine vers ce pair et lui seul ; un
   * candidat sans lien ouvert est compté et tracé, jamais diffusé.
   */
  function onLocalCandidate(peerId: string, candidate: RTCIceCandidateInit | null): void {
    if (closed) return
    const link = links.get(peerId)
    if (link === undefined) {
      orphanCandidates += 1
      warn(`candidat local pour ${peerId} ignoré : aucun lien ouvert (${orphanCandidates} sans destinataire)`)
      return
    }
    if (candidate === null) {
      send({ kind: 'ice', to: peerId, payload: null })
      return
    }
    send({ kind: 'ice', to: peerId, payload: candidate })
  }

  /**
   * Entrée flux (AD-17 / D3) : le plan média appelle ici pour chaque piste
   * distante, avec le pair émetteur. Le maillage ne transmet que les flux dont il
   * connaît le lien ; tout le reste est COMPTÉ et TRACÉ, jamais attribué.
   *
   * Pourquoi compter plutôt que jeter en silence : un flux orphelin est le
   * symptôme d'un `ontrack` arrivé avant nous, d'un flux après `close()`, ou d'un
   * pair hors maillage. Le compteur (`unattributed: N`) est ce qui distingue
   * « aucun flux » de « flux que je n'ai pas su nommer ».
   *
   * Le flux attribué EST aussi la preuve de flux du lien (défaut (c), SPEC-008 §1) :
   * une piste qui arrive par la `RTCPeerConnection` de ce pair est un flux reçu —
   * `connected` n'attend plus que cet événement, plus la fin du SDP.
   */
  function onRemoteStream(peerId: string, stream: MediaStream): void {
    if (closed) {
      unattributedStreams += 1
      warn(`flux reçu après fermeture, ignoré — unattributed: ${unattributedStreams}`)
      return
    }
    const link = links.get(peerId)
    if (link === undefined) {
      unattributedStreams += 1
      warn(`flux reçu sans pair connu (${peerId}), ignoré — unattributed: ${unattributedStreams}`)
      return
    }
    proveFlow(link, 'track')
    const notify = o.onRemoteStream
    if (notify === undefined) return
    notify(peerId, stream)
  }

  /**
   * Preuve de flux par le niveau (défaut (c), SPEC-008 §1) : `voice.ts` appelle
   * ici quand `plane.level(peerId)` a RENDU UN NOMBRE pour ce pair — un RMS même
   * faible est un paquet reçu, contrairement à `null` qui dit « je ne mesure pas ».
   *
   * Idempotente par conception (`proveFlow`) : le battement de mesure tourne à
   * ~20 Hz, cette entrée est appelée à chaque trame mesurée et ne publie
   * `connected` qu'une seule fois par preuve.
   */
  function reportFlow(peerId: string): void {
    if (closed) return
    const link = links.get(peerId)
    if (link === undefined) return // pair hors maillage : rien à prouver, rien à dire
    proveFlow(link, 'level')
  }

  async function onSignal(msg: SignalIn): Promise<void> {
    if (closed) {
      warn('message ignoré : maillage fermé')
      return
    }
    switch (msg.kind) {
      case 'link':
        // État de lien calculé par la coquille (relais TCP / ICE) : il ne change
        // aucune décision de maillage, et le pilote n'a pas d'état à en tirer.
        return
      case 'peer-joined':
        await onPeerJoined(msg.peerId)
        return
      case 'peer-left':
        // `MediaPlane` (contrat gelé) n'expose pas de fermeture PAR pair : le lien
        // est oublié ici, la `RTCPeerConnection` correspondante ne peut être
        // fermée que par `plane.close()`. Limite déclarée, pas contournée.
        clearClock(msg.peerId)
        links.delete(msg.peerId)
        return
      case 'offer':
        await onOffer(msg.from, msg.payload)
        return
      case 'answer':
        await onAnswer(msg.from, msg.payload)
        return
      case 'ice':
        await onIce(msg.from, msg.payload)
        return
    }
  }

  function peers(): string[] {
    return Array.from(links.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }

  function close(): void {
    if (closed) return
    closed = true
    for (const peerId of Array.from(clocks.keys())) clearClock(peerId)
    links.clear()
    try {
      plane.close()
    } catch (error: unknown) {
      warn(`plane.close() a échoué : ${describeError(error)}`)
    }
  }

  // Surface runtime GELÉE (AD-16 / T17, étendue par AD-17 / D3 ; septième membre
  // `reportFlow` ajouté par le défaut (c) de SPEC-008 §1 — preuve de flux par le
  // niveau, cf. l'interface `Mesh` ci-dessus), mesurée par VERIF :
  // ["addCandidate","close","onLocalCandidate","onRemoteStream","onSignal","peers","reportFlow"]
  // — sept membres, pas un de plus (`onRemoteStream` entre AVEC `onLocalCandidate`
  // porteur du pair : l'un sans l'autre est une application partielle, refusée en
  // revue). L'ordre du littéral suit l'ordre trié pour que `Object.keys(mesh)` et
  // `Object.keys(mesh).sort()` soient identiques.
  return { addCandidate, close, onLocalCandidate, onRemoteStream, onSignal, peers, reportFlow }
}
