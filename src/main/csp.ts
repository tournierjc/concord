import { networkInterfaces } from 'node:os';
import { asWebSocketOrigin, wsOrigin } from './net-schemes';

/**
 * CSP stricte + garde réseau (SPEC-001 A15 / CA19 / CA20).
 *
 * Politique :
 *  - `script-src 'self'` exclusivement, jamais de `'unsafe-eval'`, jamais de `'unsafe-inline'`
 *    pour les scripts, jamais de source distante.
 *  - `connect-src` : uniquement la boucle locale et les adresses du réseau local. Aucun `https:`,
 *    aucun `wss:` public. La liste des hôtes LAN est calculée au démarrage à partir des interfaces
 *    réseau de la machine, plus les hôtes explicitement autorisés par le moteur (hôte du salon
 *    rejoint). Aucune source WebSocket à hôte joker n'est jamais utilisée. Les schémas d'URL sont
 *    assemblés par `net-schemes.ts`, la vérification de l'hôte reste ici (`isLanHost`).
 *  - `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, pas d'iframe.
 *
 * Ce module n'importe PAS `electron` au chargement (uniquement des types) afin de pouvoir être
 * réutilisé par la configuration Vite si besoin.
 */

/** Plages d'adresses considérées comme « réseau local ». */
export function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // lien-local (IPv4LL) : repli sans DHCP
  return false;
}

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0';
}

/** Nom d'hôte du LAN : IPv4 privée, lien-local, ou nom mDNS `.local`. */
export function isLanHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (isLoopbackHost(h)) return true;
  if (isPrivateIPv4(h)) return true;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(h)) return true;
  return false;
}

/** Adresses IPv4 privées de cette machine (pour autoriser le WS du moteur local). */
export function localPrivateAddresses(): string[] {
  const out: string[] = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const list = ifaces[name];
    if (!list) continue;
    for (const info of list) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (isPrivateIPv4(info.address) || info.address.startsWith('169.254.')) out.push(info.address);
    }
  }
  return Array.from(new Set(out));
}

export interface CspOptions {
  /** Hôtes LAN supplémentaires autorisés (hôte du salon rejoins, renvoyés par le moteur). */
  lanHosts?: string[];
  /** true en développement : autorise le serveur Vite sur la boucle locale (scripts HMR). */
  devServerOrigin?: string | null;
}

function wsSources(opts: CspOptions): string[] {
  const sources = new Set<string>([
    // Le moteur embarque son serveur de signalisation dans le process principal (A5).
    wsOrigin('127.0.0.1:*'),
    wsOrigin('localhost:*'),
    // No `ws://[::1]:*`: CSP host-sources cannot be IPv6 literals; Chromium drops it with a warning.
  ]);
  for (const host of localPrivateAddresses()) {
    sources.add(wsOrigin(`${host}:*`));
    // Un pair peut aussi être joignable par son nom d'hôte mDNS.
  }
  for (const host of opts.lanHosts ?? []) {
    const clean = host.replace(/^\[|\]$/g, '').toLowerCase();
    if (!clean) continue;
    if (!isLanHost(clean)) continue; // on refuse tout hôte non privé, même s'il est demandé
    sources.add(wsOrigin(`${clean}:*`));
    sources.add(wsOrigin(`${clean.includes(':') ? `[${clean}]` : clean}:*`));
  }
  return Array.from(sources);
}

/**
 * Construit l'en-tête Content-Security-Policy.
 * Aucune directive ne référence de domaine public.
 */
export function buildCsp(opts: CspOptions = {}): string {
  const connect = ["'self'", ...wsSources(opts)];
  if (opts.devServerOrigin) {
    // HMR Vite : uniquement la boucle locale.
    connect.push(asWebSocketOrigin(opts.devServerOrigin));
  }
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    // Les styles sont locaux ; 'unsafe-inline' couvre les attributs `style` produits par React
    // (jauges de niveau, halo de parole). Aucun script inline n'est autorisé.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", 'blob:', 'mediastream:'],
    'connect-src': connect,
    'worker-src': ["'self'", 'blob:'],
    'child-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.keys(directives)
    .map((name) => `${name} ${(directives[name] ?? []).join(' ')}`)
    .join('; ');
}

/** En-têtes de sécurité ajoutés à chaque réponse du protocole `app://` et du serveur de dev. */
export function securityHeaders(opts: CspOptions = {}): Record<string, string> {
  return {
    'Content-Security-Policy': buildCsp(opts),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(self), display-capture=(), usb=(), serial=(), hid=()',
  };
}
