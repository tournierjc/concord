import type { Session } from 'electron';
import { isLanHost, isLoopbackHost } from './csp';
import { webRequestFilterUrls } from './net-schemes';

/**
 * Garde réseau — deuxième barrière après la CSP (SPEC-001 A15 / CA5 / CA20).
 *
 * Toute requête sortante du renderer passe par le webRequest du process principal. On n'autorise
 * QUE :
 *   app:      le bundle local (protocole maison, voir renderer-protocol.ts)
 *   file:     lecture du bundle/asar (chargement des assets par Electron)
 *   blob:/data: contenus générés localement (flux audio, icônes SVG inline)
 *   devtools: uniquement pour les outils de développement
 *   http(s):  UNIQUEMENT le serveur Vite en développement, sur la boucle locale
 *   ws(s):    boucle locale (serveur de signalisation embarqué) ou adresse du réseau local
 *
 * Tout le reste est bloqué et journalisé (console locale, jamais transmise).
 * Conséquence vérifiable pour CA5/CA20 : aucune requête vers un domaine public ne peut aboutir,
 * même si du code tentait de le faire.
 */

export interface NetworkGuardOptions {
  /** Origine du serveur de dev (boucle locale, port 5173), null en production. */
  devServerOrigin: string | null;
  /** Hôtes LAN supplémentaires autorisés (hôte du salon rejoins). */
  lanHosts: string[];
  onBlocked?: (url: string, reason: string) => void;
}

const ALWAYS_ALLOWED_SCHEMES = new Set(['app:', 'file:', 'blob:', 'data:', 'devtools:', 'chrome-extension:']);

export function isAllowedRequest(rawUrl: string, opts: NetworkGuardOptions): { allowed: boolean; reason: string } {
  if (!rawUrl || rawUrl === 'about:blank') return { allowed: true, reason: 'about:blank' };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'URL illisible' };
  }
  if (ALWAYS_ALLOWED_SCHEMES.has(url.protocol)) return { allowed: true, reason: 'local' };

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (opts.devServerOrigin) {
      try {
        const dev = new URL(opts.devServerOrigin);
        if (url.origin === dev.origin && isLoopbackHost(url.hostname)) return { allowed: true, reason: 'serveur de dev local' };
      } catch {
        /* ignore */
      }
    }
    return { allowed: false, reason: `http(s) non autorisé hors serveur de dev : ${url.host}` };
  }

  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isLoopbackHost(host)) return { allowed: true, reason: 'signalisation locale' };
    if (opts.lanHosts.some((h) => h.toLowerCase() === host.toLowerCase())) return { allowed: true, reason: 'hôte LAN autorisé' };
    if (isLanHost(host)) return { allowed: true, reason: 'adresse du réseau local' };
    return { allowed: false, reason: `WebSocket hors réseau local : ${url.host}` };
  }

  return { allowed: false, reason: `schéma non autorisé : ${url.protocol}` };
}

/** Installe la garde sur la session. Retourne une fonction pour mettre à jour la liste d'hôtes. */
export function installNetworkGuard(ses: Session, options: NetworkGuardOptions): { setLanHosts: (hosts: string[]) => void; dispose: () => void } {
  let opts: NetworkGuardOptions = { ...options, lanHosts: [...options.lanHosts] };

  const filter = { urls: webRequestFilterUrls() };
  const listener = (details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void): void => {
    const verdict = isAllowedRequest(details.url, opts);
    if (!verdict.allowed) {
      opts.onBlocked?.(details.url, verdict.reason);
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  };

  ses.webRequest.onBeforeRequest(filter, listener);

  return {
    setLanHosts(hosts: string[]): void {
      opts = { ...opts, lanHosts: [...hosts] };
    },
    dispose(): void {
      ses.webRequest.onBeforeRequest(null);
    },
  };
}
