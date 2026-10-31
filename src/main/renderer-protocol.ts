/// <reference lib="dom" />
/**
 * renderer-protocol.ts — service du bundle React par un protocole maison `app://`.
 *
 * Pourquoi pas `file://` : un document chargé en `file://` a une origine opaque, ce qui casse les
 * modules ES et rend la CSP difficile à poser. `app://` donne une origine stable, déclarée
 * « standard + secure », sans jamais ouvrir la moindre socket : le handler lit des fichiers du
 * bundle installé et rien d'autre.
 *
 * La référence `lib="dom"` ci-dessus n'est là que pour typer `Response` (global Node ≥ 18, utilisé
 * comme type de retour de `protocol.handle`) ; le process principal n'exécute aucun code DOM.
 */

import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { APP_SCHEME, SCHEME_SEP } from './net-schemes';

/** Hôte unique du protocole : `app://bundle/index.html`. */
export const APP_HOST = 'bundle';

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** À appeler AVANT `app.whenReady()` : privilèges du schéma. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // Pas de CORS : tout est servi depuis la même origine app://bundle.
        corsEnabled: false,
      },
    },
  ]);
}

/** URL d'un document du bundle. */
export function appUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  return `${APP_SCHEME}${SCHEME_SEP}${APP_HOST}/${clean}`;
}

/**
 * Convertit une URL `app://` en chemin relatif sûr, ou null.
 * Refuse : mauvais schéma, hôte inconnu, remontée `..`, NUL, chemin absolu.
 */
export function resolveRequestPath(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:`) return null;
  if (parsed.host !== APP_HOST) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\u0000')) return null;
  if (pathname === '' || pathname === '/') pathname = '/index.html';

  const segments = normalize(pathname).split(/[/\\]+/).filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '..' || segment === '.')) return null;
  return segments.join('/');
}

/**
 * Installe le handler du protocole. `rendererRoot` = `dist/renderer` en production.
 * Toute sortie du répertoire racine est refusée (403), toute erreur de lecture → 404.
 */
export function registerAppProtocol(rendererRoot: string): void {
  const root = resolve(rendererRoot);
  protocol.handle(APP_SCHEME, async (request) => {
    const relativePath = resolveRequestPath(request.url);
    if (relativePath === null) {
      return new Response('requête refusée', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const target = resolve(join(root, relativePath));
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      return new Response('hors du bundle', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    try {
      const data = await readFile(target);
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'content-type': MIME_BY_EXTENSION[extname(target).toLowerCase()] ?? 'application/octet-stream',
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        },
      });
    } catch {
      return new Response('introuvable', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  });
}
