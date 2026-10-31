/**
 * tests/manual-timers.ts — horloge manuelle pour le moteur (Carillon)
 *
 * AD-17 / T17. Le moteur n'appelle pas `setTimeout` : il reçoit un `Timers`
 * (`src/engine/timers.ts`). Ce faux-ci n'attend rien : il empile les échéances
 * et ne les déclenche que quand le test le dit (`fire`). Deux propriétés en
 * découlent, et ce sont elles qu'on veut mesurer :
 *
 *   • **déterminisme** : « 4 999 ms puis 1 ms » se teste en deux appels, pas en
 *     une seconde d'attente réelle, et la même suite donne le même résultat ;
 *   • **falsifiabilité de l'échéance** : `armed` dit à quel délai exact l'horloge
 *     a été armée (5 000 pour `noFlow`, 1 000 pour le plafond ICE) et `live` dit
 *     combien d'échéances sont encore armées — donc si `cancel` a bien été appelé
 *     quand un flux arrive ou qu'une réponse est reçue.
 */

import type { Timers } from '../src/engine/timers.ts'

interface Armed {
  readonly ms: number
  readonly callback: () => void
  cancelled: boolean
}

export interface ManualTimers extends Timers {
  /** Délais armés, dans l'ordre d'armement (garde les annulés : c'est la trace). */
  readonly armed: readonly number[]
  /** Nombre d'échéances encore armées ET non annulées. */
  readonly live: number
  /** Nombre de `cancel` reçus (y compris sur un jeton déjà échu ou inconnu). */
  readonly cancelled: number
  /** Déclenche les échéances dues (`ms` omis = toutes). Rend le nombre déclenché. */
  fire(ms?: number): number
  /** Oublie tout (entre deux `it`). */
  reset(): void
}

export function manualTimers(): ManualTimers {
  let entries: Armed[] = []
  const armed: number[] = []
  let cancelled = 0

  return {
    get armed(): readonly number[] {
      return armed
    },
    get live(): number {
      return entries.filter((entry) => !entry.cancelled).length
    },
    get cancelled(): number {
      return cancelled
    },
    once(ms: number, callback: () => void): unknown {
      const entry: Armed = { ms, callback, cancelled: false }
      entries.push(entry)
      armed.push(ms)
      return entry
    },
    cancel(handle: unknown): void {
      cancelled += 1
      const entry = entries.find((candidate) => candidate === handle)
      if (entry === undefined) return
      entry.cancelled = true
    },
    fire(ms?: number): number {
      const limit = ms ?? Number.POSITIVE_INFINITY
      const due = entries.filter((entry) => !entry.cancelled && entry.ms <= limit)
      entries = entries.filter((entry) => !due.includes(entry))
      for (const entry of due) {
        entry.cancelled = true // échu : un `cancel` ultérieur ne doit plus rien annuler
        entry.callback()
      }
      return due.length
    },
    reset(): void {
      entries = []
      armed.length = 0
      cancelled = 0
    },
  }
}
