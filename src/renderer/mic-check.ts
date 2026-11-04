/**
 * renderer/mic-check.ts — le test de configuration du micro (bouton « Tester le micro »)
 *
 * AJOUT 2026-11-03 (demande JC). Le panneau Réglages laissait l'utilisateur sans AUCUNE preuve
 * que son micro va bien : le VU-mètre de salon n'existe qu'EN salon, et le gain s'ajustait à
 * l'aveugle. Ce module fait la preuve en deux temps, et le second est la seule qui vaille pour
 * un utilisateur non technique :
 *
 *   1. CAPTURER les réglages du REGISTRE (pas ceux de l'écran) : `buildMicrophoneConstraints`
 *      sur `settings.audio` — périphérique choisi, réduction de bruit, annulation d'écho, gain.
 *   2. ÉCOUTER LE RÉSULTAT : le micro repasse par la MEME chaîne de filtrage vocal
 *      (`voice-filter.ts`) et le MEME gain que la session réelle, puis la destination de la
 *      chaîne est posée sur un `<audio>` — l'audition passe par le pipeline de sortie du
 *      navigateur (périphérique choisi, volume, ducking), jamais par un `connect()` brut qui
 *      court-circuiterait la sortie.
 *
 * Un CAPTEUR RMS vit à part (AnalyserMeter, ci-dessous, branché sur le micro BRUT : le VAD et
 * le VU-mètre local du plan média suivent la même loi — on ne juge pas la capture sur une voix
 * robot). `null` = absence de mesure, jamais un `0` qui affirmerait un silence mesuré (AD-17).
 * La barre de l'UI rend `null` en grisé avec l'aide qui le dit, et le test n'est JAMAIS
 * présenté comme muet sur une simple absence de mesure.
 *
 * Ce que ce module NE fait PAS : ouvrir le micro d'une session (`voice.ts`), toucher au WebRTC,
 * ni garder le micro ouvert entre deux gestes. `stopMicCheck()` libère TOUT : pistes stoppées,
 * chaîne fermée, contexte fermé, cadence annulée, `<audio>` retiré.
 *
 * Toute la machine est injectable (`MicCheckPort`) : elle s'éprouve en Node sur doubles
 * (`tests/mic-check.node.test.ts`), sans micro ni Chromium.
 */

import { browserBeat, type RendererBeat } from './browser-beat.ts';
import { buildMicrophoneConstraints, toMediaTrackConstraints } from '../engine/rtc/media-config.ts';
import { createVoiceFilterChain, singleTrackMediaStream } from './voice-filter.ts';
import type { AnalyserLike, FilterAudioContext, FilterStreamLike, VoiceFilterChain, VoiceProcessOptions } from './voice-filter.ts';
import type { VoiceFilterId } from '../engine/rtc/voice-filters.ts';
import type { Settings } from '../shell/settings-schema';

/** Nombre de mesures RMS par seconde de la barre (le battement est la cadence de la page). */
const LEVEL_INTERVAL_MS = 60;

/** FFT des analyseurs de mesure (même taille que le plan média : un seul comportement de mesure). */
const METER_FFT_SIZE = 512;

/** RMS (0..1) au-delà duquel le micro est dit « capte » (la barre passe au vert). */
export const MIC_CHECK_SPEAKING_RMS = 0.02;

export type MicCheckStatus = 'idle' | 'starting' | 'listening' | 'error';

export interface MicCheckApplied {
  /** La voix RÉELLEMENT posée sur la chaîne (mesure, pas l'intention du réglage). */
  readonly voiceFilter: VoiceFilterId;
  /** Le gain RÉELLEMENT appliqué (0..2). */
  readonly gain: number;
  readonly noiseSuppression: boolean;
  readonly echoCancellation: boolean;
}

export interface MicCheckState {
  readonly status: MicCheckStatus;
  /** Niveau RMS live (0..1), ou `null` = AUCUNE mesure (pas « silence mesuré » — AD-17). */
  readonly level: number | null;
  /** Message d'erreur lisible en `error` (permission refusée, périphérique introuvable). */
  readonly error: string | null;
  /** Ce qui a réellement été testé, lu sur la chaîne (`null` avant l'écoute). */
  readonly applied: MicCheckApplied | null;
}

const IDLE_STATE: MicCheckState = { status: 'idle', level: null, error: null, applied: null };

let state: MicCheckState = IDLE_STATE;
const listeners = new Set<() => void>();

function publish(patch: Partial<MicCheckState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

/** Souscription au store du test (même forme que le store de `voice.ts`). */
export function subscribeMicCheck(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function micCheckSnapshot(): MicCheckState {
  return state;
}

/** RMS d'un bloc d'échantillons (-1..1), borné 0..1 — la même loi que le plan média. */
function rootMeanSquare(samples: Float32Array<ArrayBuffer>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  if (rms < 0) return 0;
  if (rms > 1) return 1;
  return rms;
}

/**
 * Le capteur du test : source micro → analyseur, RMS à la demande.
 * `null` quand le contexte ne sait pas mesurer (facette absente) — une absence d'affirmation.
 */
export function createAnalyserMeter(
  context: FilterAudioContext,
  stream: FilterStreamLike,
): (() => number | null) | null {
  if (context.createAnalyser === undefined) return null;
  const analyser = context.createAnalyser();
  analyser.fftSize = METER_FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  const track = stream.getAudioTracks()[0];
  if (track === undefined) return null;
  // Même contrat que la chaîne d'appel : un MediaStream natif monopiste, pas le flux capté.
  const source = context.createMediaStreamSource(singleTrackMediaStream(track));
  source.connect(analyser as unknown as Parameters<typeof source.connect>[0]);
  const buffer = new Float32Array(METER_FFT_SIZE);
  return () => {
    analyser.getFloatTimeDomainData(buffer);
    return rootMeanSquare(buffer);
  };
}

/**
 * Hôte de l'audition : où le test pose la piste filtrée pour qu'on l'ENTENDE.
 * La production crée un `<audio autoplay>` hors écran ; les tests enregistrent ce qu'on pose.
 */
export interface MicCheckSpeakerHost {
  play(track: MediaStreamTrack): void;
  /** Retire la piste et détruit l'élément. Idempotent. */
  silence(): void;
}

/** Ce que la page fournit — tout injectable pour éprouver la machine en Node. */
export interface MicCheckPort {
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly createAudioContext: () => FilterAudioContext;
  readonly buildChain: (
    context: FilterAudioContext,
    stream: FilterStreamLike,
    initial: VoiceFilterId,
    process?: VoiceProcessOptions,
  ) => VoiceFilterChain;
  /** Le port de cadence (production : `browserBeat()` ; test : pompe manuelle). */
  readonly makeBeat?: () => RendererBeat;
  /** L'hôte d'audition (production : `<audio>` caché ; test : enregistreur). Défaut : le DOM. */
  readonly speakers?: MicCheckSpeakerHost;
}

const pageSpeakerHost: MicCheckSpeakerHost = {
  play(track: MediaStreamTrack): void {
    const audio = ensureAudioElement();
    audio.srcObject = new MediaStream([track]);
    // Le clic sur le bouton est le déverrouillage autoplay requis ; un `play()` refusé ne fait
    // PAS échouer le test — la barre RMS prouve la capture, l'audition est le confort.
    void audio.play().catch(() => undefined);
  },
  silence(): void {
    const existing = document.getElementById('mic-check-monitor');
    if (existing !== null) existing.remove();
  },
};

function ensureAudioElement(): HTMLAudioElement {
  const existing = document.getElementById('mic-check-monitor');
  if (existing instanceof HTMLAudioElement) return existing;
  const audio = document.createElement('audio');
  audio.id = 'mic-check-monitor';
  audio.autoplay = true;
  // Dans le DOM mais hors champ : `display:none` éteindrait le rendu audio de certains moteurs,
  // taille + opacité nulles sont la voie sûre.
  audio.style.position = 'fixed';
  audio.style.width = '0';
  audio.style.height = '0';
  audio.style.opacity = '0';
  audio.style.pointerEvents = 'none';
  document.body.appendChild(audio);
  return audio;
}

const defaultPort: MicCheckPort = {
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createAudioContext: () => new AudioContext({ latencyHint: 'interactive' }) as unknown as FilterAudioContext,
  buildChain: createVoiceFilterChain,
  speakers: pageSpeakerHost,
};

interface Running {
  readonly stream: MediaStream;
  readonly context: FilterAudioContext;
  readonly chain: VoiceFilterChain;
  readonly readLevel: (() => number | null) | null;
  beatHandle: unknown;
  readonly beat: RendererBeat;
  readonly speakers: MicCheckSpeakerHost;
}

let running: Running | null = null;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Lance le test avec les réglages du REGISTRE (`settings.audio`, tels que sauvés). Rappel
 * pendant l'écoute : l'écoute en cours est ARRÊTÉE puis relancée — entendre une voix périmée
 * sans le savoir serait un mensonge de confort.
 */
export async function startMicCheck(
  settings: Settings,
  port: MicCheckPort = defaultPort,
  /**
   * La voix réellement sur le fil, RELUE du plan média (`voice.ts` → `plane.voiceFilter()`).
   * Par défaut on prend celle du registre — c'est déjà les mêmes contraintes que la session pour
   * le RNNoise, l'annulation d'écho et le gain. Cet argument n'existe que pour le cas réel où
   * l'intention écrite et la voix appliquée DIFFÈRENT (voix refusée en page : `setVoiceFilter`
   * rend `false`) : le test rejoue alors ce que les pairs ENTENDENT, pas ce que le réglage prétend.
   */
  appliedVoiceFilter?: VoiceFilterId,
): Promise<void> {
  stopMicCheck();
  publish({ status: 'starting', level: null, error: null, applied: null });
  const requested = buildMicrophoneConstraints(settings.audio);
  const gain = typeof requested.gain === 'number' ? requested.gain : 1;
  const voice = appliedVoiceFilter ?? settings.audio.voiceFilter ?? 'none';
  try {
    const stream = await port.getUserMedia({
      audio: toMediaTrackConstraints(requested),
    });
    const context = port.createAudioContext();
    // Resume avant toute fabrication : un contexte SUSPENDU rend un RMS FIGÉ (le piège RMS du repo).
    void context.resume?.();
    // La MÊME chaîne que la session (mêmes recettes, mêmes poids de formants). La différence est
    // en AVAL : l'hôte d'audition porte la piste vers les HP, pas un connect brut.
    const chain = port.buildChain(context, stream, voice, {
      inputGain: gain,
      noiseGate: settings.audio.noiseGate === true,
      noiseGateThresholdDb: settings.talk.vadThresholdDb,
    });
    const speakers = port.speakers ?? pageSpeakerHost;
    speakers.play(chain.track);
    // Capteur sur le micro BRUT : la barre prouve la CAPTURE, pas le rendu du filtre.
    const readLevel = createAnalyserMeter(context, stream);
    const beat = (port.makeBeat ?? browserBeat)();
    const session: Running = { stream, context, chain, readLevel, beat, beatHandle: undefined, speakers };
    running = session;
    session.beatHandle = beat.repeat(LEVEL_INTERVAL_MS, () => {
      if (running !== session) return;
      publish({ level: session.readLevel === null ? null : session.readLevel() });
    });
    publish({
      status: 'listening',
      applied: {
        voiceFilter: chain.current,
        gain,
        noiseSuppression: requested.noiseSuppression === true,
        echoCancellation: requested.echoCancellation === true,
      },
    });
  } catch (error) {
    teardown();
    publish({ status: 'error', level: null, error: describeError(error) });
  }
}

/** Arrête le test. Idempotent (bouton, démontage du panneau, seconde ouverture). */
export function stopMicCheck(): void {
  teardown();
  publish({ ...IDLE_STATE });
}

function teardown(): void {
  const current = running;
  if (current === null) return;
  running = null;
  try {
    current.beat.cancel(current.beatHandle);
  } catch {
    // Une cadence déjà rendue ne peut pas être rendue deux fois.
  }
  try {
    current.chain.close();
  } catch {
    // Graphe déjà débranché.
  }
  for (const track of current.stream.getTracks()) track.stop();
  try {
    void current.context.close?.();
  } catch {
    // Un contexte fermé refuse le second `close()` : c'est l'idempotence, pas une panne.
  }
  try {
    current.speakers.silence();
  } catch {
    // Élément déjà retiré.
  }
}
