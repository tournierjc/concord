/**
 * api.d.ts — déclaration de la surface exposée au renderer par le preload.
 *
 * Vit sous `src/preload/` (et non sous `src/renderer/`) pour être compilée par les deux
 * configurations : `tsconfig.main.json` (preload) et `tsconfig.json` (renderer). Aucun code.
 */

import type { LanAPI } from '../shell/ipc-contract';

declare global {
  interface Window {
    /** Exposé par contextBridge uniquement ; absent si le preload n'a pas tourné. */
    lanAPI: LanAPI;
  }
}

export {};
