/**
 * audio-capture.ts — latence de capture Linux (Pulse / PipeWire). Pur : aucun Electron.
 *
 * Le retard Linux → Windows mesuré (2 à 3 secondes) est CONSTANT dès la première
 * syllabe. Ce n'est pas une file qui s'allonge pendant l'appel. PulseAudio, quand
 * le client ne demande pas de latence, tamponne environ deux secondes. PipeWire
 * (CachyOS, et donc l'AppImage) expose ce protocole à Chromium. `PULSE_LATENCY_MSEC`
 * est lu par Chromium à l'ouverture du flux. Une valeur déjà posée par
 * l'utilisateur est conservée.
 *
 * `--audio-buffer-size` est le tampon matériel en trames. 960 trames à 48 kHz
 * font 20 ms. Windows (WASAPI) n'est pas modifié : son tampon est déjà court,
 * et le sens en retard est Linux → Windows.
 */

/** Latence Pulse demandée, en millisecondes, quand l'environnement n'en pose pas. */
export const PULSE_LATENCY_MSEC = '20'

/** 960 / 48 000 = 20 ms. Tampon Chromium sur Linux seulement. */
export const LINUX_AUDIO_BUFFER_FRAMES = '960'

/**
 * Valeur à écrire dans `PULSE_LATENCY_MSEC`, ou `null` si rien ne doit changer
 * (pas Linux, ou l'utilisateur a déjà choisi).
 */
export function pulseLatencyMsec(platform: string, current: string | undefined): string | null {
  if (platform !== 'linux') return null
  if (typeof current === 'string' && current.trim().length > 0) return null
  return PULSE_LATENCY_MSEC
}

/** Trames à passer à `--audio-buffer-size`, ou `null` hors Linux. */
export function linuxAudioBufferFrames(platform: string): string | null {
  if (platform !== 'linux') return null
  return LINUX_AUDIO_BUFFER_FRAMES
}
