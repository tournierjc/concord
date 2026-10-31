/**
 * tests/security-policy.node.test.ts — la politique de sécurité de la coquille, telle que le main
 * l'applique vraiment.
 *
 * Ce que ce fichier défend :
 *   1. la **caméra** n'est pas accordée. La coquille répondait `permission === 'media'` sans lire
 *      `details.mediaTypes` (`index.ts:258-261`) : `getUserMedia({video:true})` passait comme le
 *      micro, alors que `Permissions-Policy` annonce `camera=()`. Règle extraite dans
 *      `permissions.ts` (pure) pour être falsifiable hors Electron ;
 *   2. les en-têtes de sécurité sont TOUS posés. `securityHeaders()` (CSP,
 *      X-Content-Type-Options, Referrer-Policy, Cross-Origin-Opener-Policy,
 *      Cross-Origin-Resource-Policy, Permissions-Policy) était **défini et jamais utilisé** :
 *      `applySecurityPolicies()` recomposait la liste à la main et laissait tomber trois en-têtes ;
 *   3. la fenêtre d'overlay est durcie comme la fenêtre principale (`harden()` n'était appelé que
 *      sur celle-ci) — vérifié par lecture de la source, faute de fenêtre Electron ici.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/security-policy.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { securityHeaders } from '../src/main/csp.ts';
import {
  ALLOWED_MEDIA_TYPES,
  isPermissionAllowed,
  isPermissionCheckAllowed,
} from '../src/main/permissions.ts';

const MAIN_SOURCE = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');

describe('permissions — la caméra n’est jamais accordée', () => {
  it('media/audio est accordé (c’est le micro, le seul média utilisé)', () => {
    assert.equal(isPermissionAllowed('media', ['audio']), true);
    assert.deepEqual([...ALLOWED_MEDIA_TYPES], ['audio']);
  });

  it('media/vidéo est refusé, seul ou accompagné', () => {
    // Le défaut mesuré : `permission === 'media'` seul laissait passer ceci.
    assert.equal(isPermissionAllowed('media', ['video']), false);
    assert.equal(isPermissionAllowed('media', ['audio', 'video']), false);
    assert.equal(isPermissionAllowed('media', ['video', 'audio']), false);
  });

  it('media sans type annoncé est traité comme une demande de micro', () => {
    // Aucun `getUserMedia` du dépôt ne demande `video` : une demande générique est la nôtre.
    assert.equal(isPermissionAllowed('media', undefined), true);
    assert.equal(isPermissionAllowed('media', []), true);
  });

  it('tout le reste est refusé sans consulter personne', () => {
    for (const permission of [
      'geolocation',
      'notifications',
      'clipboard-read',
      'clipboard-sanitized-write',
      'usb',
      'serial',
      'hid',
      'display-capture',
      'midi',
      'fullscreen',
      'openExternal',
      'unknown',
      'speaker-selection',
    ]) {
      assert.equal(isPermissionAllowed(permission, ['audio']), false, `${permission} doit être refusé`);
      assert.equal(isPermissionCheckAllowed(permission, 'audio'), false, `${permission} doit être refusé`);
    }
  });

  it('la vérification préalable refuse la vidéo et laisse passer le reste', () => {
    // Ce gestionnaire ne fait que prévenir : la requête reste le seul endroit qui accorde.
    assert.equal(isPermissionCheckAllowed('media', 'audio'), true);
    assert.equal(isPermissionCheckAllowed('media', undefined), true);
    assert.equal(isPermissionCheckAllowed('media', 'unknown'), true);
    assert.equal(isPermissionCheckAllowed('media', 'video'), false);
  });
});

describe('en-têtes — securityHeaders est la source unique, et elle est utilisée', () => {
  const headers = securityHeaders({ devServerOrigin: null });

  it('pose les six en-têtes, dont ceux que la coquille avait laissés tomber', () => {
    assert.deepEqual(
      Object.keys(headers).sort(),
      [
        'Content-Security-Policy',
        'Cross-Origin-Opener-Policy',
        'Cross-Origin-Resource-Policy',
        'Permissions-Policy',
        'Referrer-Policy',
        'X-Content-Type-Options',
      ],
    );
  });

  it('Permissions-Policy dit la même chose que la décision de permission : camera refusée, micro local', () => {
    const policy = headers['Permissions-Policy'] ?? '';
    assert.match(policy, /camera=\(\)/);
    assert.match(policy, /microphone=\(self\)/);
    assert.match(policy, /geolocation=\(\)/);
  });

  it('la CSP ne s’ouvre ni au script inline ni à l’évaluation', () => {
    const csp = headers['Content-Security-Policy'] ?? '';
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.match(csp, /object-src 'none'/);
  });

  it('le main importe et applique securityHeaders (le défaut était : défini, jamais utilisé)', () => {
    assert.match(MAIN_SOURCE, /import \{[^}]*securityHeaders[^}]*\} from '\.\/csp'/);
    assert.match(MAIN_SOURCE, /securityHeaders\(\{ devServerOrigin: DEV_SERVER \}\)/);
    assert.match(MAIN_SOURCE, /onHeadersReceived/);
    // Aucun en-tête recomposé à la main : une seule définition, celle testée ci-dessus.
    assert.doesNotMatch(MAIN_SOURCE, /'Content-Security-Policy': \[/);
  });

  it('le main applique les deux décisions de permission (requête ET vérification)', () => {
    assert.match(MAIN_SOURCE, /setPermissionRequestHandler/);
    assert.match(MAIN_SOURCE, /isPermissionAllowed\(permission, mediaTypes\)/);
    assert.match(MAIN_SOURCE, /setPermissionCheckHandler/);
    assert.match(MAIN_SOURCE, /isPermissionCheckAllowed\(permission, details\.mediaType\)/);
    // La décision ne doit plus être un test d'égalité posé à la volée dans index.ts.
    assert.doesNotMatch(MAIN_SOURCE, /callback\(permission === 'media'\)/);
  });

  it('l’overlay reçoit le même durcissement que la fenêtre principale', () => {
    const overlay = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf('function createOverlay'));
    assert.match(overlay, /harden\(/, 'createOverlay doit durcir le webContents de l’overlay');
    assert.ok(
      MAIN_SOURCE.indexOf('harden(window.webContents)') < MAIN_SOURCE.indexOf('harden(overlayWindow'),
      'la fenêtre principale reste durcie en premier',
    );
  });
});
