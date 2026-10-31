/**
 * src/engine/index.ts — Carillon
 *
 * Point d'entrée unique du moteur pur. Rien d'autre que des ré-exports : ce
 * fichier n'ajoute aucune logique, il donne juste un nom stable aux quatre
 * modules décidables (`vad`, `gain`, `device`, `room`) pour que le renderer et
 * les tests n'aient pas à connaître l'arborescence.
 *
 * Aucun import de `node:*` ni d'`electron` : `src/engine` est exécutable et
 * testable hors application (cf. VERIF/check-engine.sh).
 */

export * from './vad.ts'
export * from './gain.ts'
export * from './device.ts'
export * from './room.ts'
