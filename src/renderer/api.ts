/**
 * api.ts — accès unique à `window.lanAPI` (exposé par le preload).
 *
 * Le renderer ne touche jamais à Node ni à `ipcRenderer` : tout passe par cette surface typée.
 * L'erreur explicite sert de diagnostic honnête si le document est ouvert hors application
 * (navigateur de développement sans preload), plutôt qu'un `undefined` silencieux.
 *
 * NON VÉRIFIÉ ici : code navigateur (build Vite requis).
 */

import type { LanAPI } from '../shell/ipc-contract';

export function lanApi(): LanAPI {
  const api = window.lanAPI;
  if (!api) {
    throw new Error('window.lanAPI indisponible : le preload n’a pas tourné (document ouvert hors application ?)');
  }
  return api;
}
