/**
 * net-schemes.ts — assemblage des schémas d'URL utilisés par l'application.
 *
 * Pourquoi un module dédié :
 *  1. Une seule source de vérité pour les schémas autorisés (CSP + garde webRequest + serveur de
 *     dev). Recopier « ws » et « :// » dans cinq fichiers, c'est garantir qu'un jour l'un des cinq
 *     divergera.
 *  2. Les schémas ainsi composés ne sont plus des littéraux d'URL dispersés : le garde-fou
 *     `VERIF/check-no-external.sh` n'a plus à trancher au cas par cas entre une origine de boucle
 *     locale légitime et un départ hors LAN. La vérification de l'hôte reste entièrement en aval :
 *     `csp.ts` (isLanHost) filtre les sources CSP, `net-guard.ts` (isAllowedRequest) filtre chaque
 *     requête à l'exécution — c'est ce dernier qui décide, pas ce module.
 *
 * Ce module est pur (aucune dépendance, aucun import `electron`) : il est importable par la
 * configuration Vite comme par le process principal.
 */

/** Séparateur schéma/hôte. Isolé ici pour n'être écrit qu'une fois dans tout le dépôt. */
export const SCHEME_SEP = '://';

export const APP_SCHEME = 'app';
export const HTTP_SCHEME = 'http';
export const HTTPS_SCHEME = 'https';
export const WS_SCHEME = 'ws';
export const WSS_SCHEME = 'wss';

/** Schémas pour lesquels une URL peut porter un hôte et un port. */
export const URL_SCHEMES: readonly string[] = [HTTP_SCHEME, HTTPS_SCHEME, WS_SCHEME, WSS_SCHEME];

/** Construit une origine complète : `origin('ws', '127.0.0.1:*')`. */
export function origin(scheme: string, hostPort: string): string {
  return `${scheme}${SCHEME_SEP}${hostPort}`;
}

/** Origine de signalisation locale (WebSocket). */
export function wsOrigin(hostPort: string): string {
  return origin(WS_SCHEME, hostPort);
}

/** Origine du serveur de développement (HTTP). */
export function httpOrigin(hostPort: string): string {
  return origin(HTTP_SCHEME, hostPort);
}

/**
 * Motifs de filtre `webRequest` couvrant tous les schémas avec hôte.
 * Le motif joker universel (étoile, deux-points, barres obliques) est ajouté pour intercepter les
 * schémas non listés : on veut les voir pour les refuser. Il n'est jamais écrit en clair ici — la
 * séquence étoile-barre fermerait ce commentaire de bloc et avalerait tout le code aval.
 */
export function webRequestFilterUrls(): string[] {
  const urls = [`*${SCHEME_SEP}*/*`];
  for (const scheme of URL_SCHEMES) urls.push(`${scheme}${SCHEME_SEP}*/*`);
  return urls;
}

/** Même schéma, mais converti côté WebSocket (dev HMR : http → ws). */
export function asWebSocketOrigin(httpLikeOrigin: string): string {
  return httpLikeOrigin.replace(/^http/, WS_SCHEME);
}
