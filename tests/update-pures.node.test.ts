/**
 * tests/update-pures.node.test.ts — la décision des mises à jour, sans réseau ni disque
 * (avenant SPEC-006b, arbitrage JC du 2026-11-01).
 *
 * Ce fichier ne teste QUE les fonctions pures de `src/main/update.ts` : comparaison de versions,
 * analyse des empreintes publiées, analyse défensive de la réponse API, choix de la stratégie
 * d'installation par plateforme (surjouée — `process.platform` n'est pas modifiable) et allowlist
 * d'hôtes. La machine à états complète vit dans `update-service.node.test.ts` ; les appels réseau
 * réels et le vrai `spawn` ne sont pas exerçables ici (conteneur sans GitHub joignable, installeurs
 * inexistants) et sont isolés dans `electronUpdateIo`.
 *
 * Lancer : npx tsx --test tests/update-pures.node.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareSemver,
  chooseInstallerStrategy,
  debManualCommand,
  expectedAppImageAsset,
  expectedDebAsset,
  expectedWindowsAsset,
  isAllowedUpdateHost,
  isSha256Hex,
  normalizeTagVersion,
  nsisSpawnArgs,
  appImageEnv,
  parseLatestRelease,
  parseSha256Block,
  planSpawn,
  semverFields,
  type LatestRelease,
} from '../src/main/update';

/* ------------------------------------------------------------------ */
/* compareSemver — numérique champ à champ, jamais lexicographique      */
/* ------------------------------------------------------------------ */

describe('compareSemver', () => {
  it('0.10.0 est supérieur à 0.9.9 (le piège lexicographique)', () => {
    assert.equal(compareSemver('0.10.0', '0.9.9'), 1);
    assert.equal(compareSemver('0.9.9', '0.10.0'), -1);
    // La preuve que le test vaut quelque chose : la comparaison lexicographique dirait l'inverse.
    assert.equal('0.10.0' < '0.9.9', true);
  });
  it('1.0.0 est supérieur à 0.99.99', () => {
    assert.equal(compareSemver('1.0.0', '0.99.99'), 1);
    assert.equal(compareSemver('0.99.99', '1.0.0'), -1);
  });
  it('0.4.0 contre 0.10.0 et 0.9.9', () => {
    assert.equal(compareSemver('0.10.0', '0.4.0'), 1);
    assert.equal(compareSemver('0.9.9', '0.4.0'), 1);
    assert.equal(compareSemver('0.4.0', '0.4.0'), 0);
  });
  it('les champs se comparent dans l\'ordre majeur, mineur, patch', () => {
    assert.equal(compareSemver('2.0.0', '1.99.99'), 1);
    assert.equal(compareSemver('1.2.3', '1.2.4'), -1);
    assert.equal(compareSemver('1.2.3', '1.3.0'), -1);
  });
  it('une version mal formée est la plus petite qui soit', () => {
    assert.equal(compareSemver('bogue', '0.0.1'), -1);
    assert.equal(compareSemver('0.0.1', 'bogue'), 1);
    assert.equal(compareSemver('bogue', 'autre'), 0);
  });
  it('semverFields rejette tout ce qui n\'est pas X.Y.Z', () => {
    assert.deepEqual(semverFields('1.2.3'), [1, 2, 3]);
    assert.equal(semverFields('1.2'), null);
    assert.equal(semverFields('v1.2.3'), null);
    assert.equal(semverFields('1.2.3.4'), null);
    assert.equal(semverFields(''), null);
  });
});

describe('normalizeTagVersion', () => {
  it('retire le préfixe v', () => {
    assert.equal(normalizeTagVersion('v0.4.0'), '0.4.0');
    assert.equal(normalizeTagVersion('V1.2.3'), '1.2.3');
    assert.equal(normalizeTagVersion('0.4.0'), '0.4.0');
  });
  it('un tag qui n\'est pas une version rend null — aucune version inventée', () => {
    assert.equal(normalizeTagVersion('beta'), null);
    assert.equal(normalizeTagVersion(null), null);
    assert.equal(normalizeTagVersion(42), null);
    assert.equal(normalizeTagVersion('v'), null);
  });
});

/* ------------------------------------------------------------------ */
/* parseSha256Block — les deux formats publiés, rien d'autre            */
/* ------------------------------------------------------------------ */

const HEX_A = 'a'.repeat(64);
const HEX_B = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('parseSha256Block', () => {
  it('format pair sur une ligne (un ou deux espaces)', () => {
    const map = parseSha256Block(`Empreintes SHA-256\n\`\`\`\n${HEX_A}  concord-0.5.0-setup-x64.exe\n${HEX_B} concord-0.5.0-x86_64.AppImage\n\`\`\``);
    assert.equal(map.get('concord-0.5.0-setup-x64.exe'), HEX_A);
    assert.equal(map.get('concord-0.5.0-x86_64.AppImage'), HEX_B);
  });
  it('format « sha256sum <fichier> » suivi de l\'empreinte seule sur la ligne suivante', () => {
    const map = parseSha256Block(`sha256sum concord-0.5.0-x86_64.AppImage\n${HEX_A}`);
    assert.equal(map.get('concord-0.5.0-x86_64.AppImage'), HEX_A);
  });
  it("absence de bloc ⇒ map vide : un artefact sans empreinte ne sera jamais installé", () => {
    assert.equal(parseSha256Block(null).size, 0);
    assert.equal(parseSha256Block('rien d\'utile ici').size, 0);
    assert.equal(parseSha256Block('').size, 0);
  });
  it("un hex mal formé est REJETÉ, jamais réparé (majuscules, longueur)", () => {
    assert.equal(parseSha256Block(`${HEX_A.toUpperCase()}  x.exe`).size, 0);
    assert.equal(parseSha256Block(`${'a'.repeat(63)}  x.exe`).size, 0);
    assert.equal(parseSha256Block(`${'a'.repeat(65)}  x.exe`).size, 0);
    // « sha256sum » dont la ligne suivante n'est pas une empreinte : rien n'est retenu.
    assert.equal(parseSha256Block('sha256sum x.exe\npas-une-empreinte').size, 0);
  });
  it("isSha256Hex n'accepte que 64 minuscules", () => {
    assert.equal(isSha256Hex(HEX_A), true);
    assert.equal(isSha256Hex(HEX_A.toUpperCase()), false);
    assert.equal(isSha256Hex('a'.repeat(64) + 'g'), false);
  });
});

/* ------------------------------------------------------------------ */
/* parseLatestRelease — défensif, sans cast                             */
/* ------------------------------------------------------------------ */

function asset(name: string, url: string): Record<string, unknown> {
  return { name, browser_download_url: url };
}

describe('parseLatestRelease', () => {
  it('la forme attendue passe (version, assets, empreintes)', () => {
    const release = parseLatestRelease({
      tag_name: 'v0.5.0',
      assets: [asset('concord-0.5.0-setup-x64.exe', 'https://github.com/tournierjc/concord/releases/download/v0.5.0/concord-0.5.0-setup-x64.exe')],
      body: `Empreintes\n${HEX_A}  concord-0.5.0-setup-x64.exe`,
    });
    assert.notEqual(release, null);
    assert.equal(release?.version, '0.5.0');
    assert.equal(release?.assets.length, 1);
    assert.equal(release?.sha256.get('concord-0.5.0-setup-x64.exe'), HEX_A);
  });
  it('tag manquant ou illisible', () => {
    assert.equal(parseLatestRelease({ assets: [], body: null }), null);
    assert.equal(parseLatestRelease({ tag_name: 'pas-une-version' }), null);
    assert.equal(parseLatestRelease(null), null);
    assert.equal(parseLatestRelease('texte'), null);
  });
  it('assets vides, non tableau ou mal formés sont écartés', () => {
    const release = parseLatestRelease({
      tag_name: 'v0.5.0',
      assets: ['chaîne', { name: 'sans-url' }, asset('', 'https://github.com/a/b'), asset('bon.exe', 'https://evil.example.com/bon.exe')],
      body: null,
    });
    assert.notEqual(release, null);
    assert.equal(release?.assets.length, 0);
  });
  it("body non textuel : pas d'empreintes, la version survit", () => {
    const release = parseLatestRelease({ tag_name: 'v0.5.0', assets: [], body: { pas: 'une chaîne' } });
    assert.equal(release?.version, '0.5.0');
    assert.equal(release?.sha256.size, 0);
  });
  it("une URL non-GitHub est écartée de l'asset retenu", () => {
    const release = parseLatestRelease({
      tag_name: 'v0.5.0',
      assets: [asset('x.exe', 'https://evil.example.com/x.exe')],
      body: null,
    });
    assert.equal(release?.assets.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* chooseInstallerStrategy — la plateforme est surjouée                 */
/* ------------------------------------------------------------------ */

function releaseWith(assets: Array<{ name: string; url: string }>, body: string | null): LatestRelease {
  return {
    version: '0.5.0',
    assets: assets.map((a) => ({ name: a.name, downloadUrl: a.url })),
    sha256: parseSha256Block(body),
  };
}

const GH = (name: string): string => `https://github.com/tournierjc/concord/releases/download/v0.5.0/${name}`;

describe('chooseInstallerStrategy', () => {
  it('win32 : NSIS avec /S, jamais un shell string', () => {
    const name = expectedWindowsAsset('0.5.0');
    const release = releaseWith([{ name, url: GH(name) }], `${HEX_A}  ${name}`);
    const strategy = chooseInstallerStrategy('win32', release, false);
    assert.equal(strategy.kind, 'nsis');
    assert.equal(strategy.assetName, name);
    const plan = planSpawn(strategy, { installerPath: '/tmp/' + name, currentEnv: {} });
    assert.notEqual(plan, null);
    assert.equal(plan?.spawnPath, '/tmp/' + name);
    assert.deepEqual(plan?.spawnArgs, nsisSpawnArgs('/tmp/' + name));
    assert.deepEqual(plan?.spawnArgs, ['/tmp/' + name, '/S']);
    assert.equal(plan?.spawnEnv, undefined);
  });
  it('linux + AppImage : env APPIMAGE pointé sur le NOUVEAU fichier', () => {
    const name = expectedAppImageAsset('0.5.0');
    const release = releaseWith([{ name, url: GH(name) }], `${HEX_A}  ${name}`);
    const strategy = chooseInstallerStrategy('linux', release, true);
    assert.equal(strategy.kind, 'appimage');
    const plan = planSpawn(strategy, { installerPath: '/dl/' + name, currentEnv: { APPIMAGE: '/old/AppImage', PATH: '/bin' } });
    assert.equal(plan?.spawnPath, '/dl/' + name);
    assert.deepEqual(plan?.spawnArgs, []);
    assert.equal(plan?.spawnEnv?.['APPIMAGE'], '/dl/' + name);
    assert.equal(plan?.spawnEnv?.['PATH'], '/bin');
  });
  it('linux sans AppImage mais avec .deb : deb-only, jamais un plan de spawn', () => {
    const name = expectedDebAsset('0.5.0');
    const release = releaseWith([{ name, url: GH(name) }], `${HEX_A}  ${name}`);
    const strategy = chooseInstallerStrategy('linux', release, true);
    assert.equal(strategy.kind, 'deb-only');
    assert.equal(planSpawn(strategy, { installerPath: '/dl/' + name, currentEnv: {} }), null);
    assert.match(debManualCommand('/dl/' + name), /^sudo apt install \/dl\//);
  });
  it("un artefact sans empreinte publiée n'est PAS une stratégie (condition 4)", () => {
    const name = expectedWindowsAsset('0.5.0');
    const release = releaseWith([{ name, url: GH(name) }], null);
    assert.equal(chooseInstallerStrategy('win32', release, false).kind, 'unsupported');
  });
  it('plateforme inconnue : unsupported, jamais un essai en aveugle', () => {
    const name = expectedWindowsAsset('0.5.0');
    const release = releaseWith([{ name, url: GH(name) }], `${HEX_A}  ${name}`);
    assert.equal(chooseInstallerStrategy('freebsd', release, false).kind, 'unsupported');
  });
  it('linux sans aucun artefact lançable ⇒ unsupported', () => {
    assert.equal(chooseInstallerStrategy('linux', releaseWith([], null), false).kind, 'unsupported');
  });
  it('appImageEnv ne propage que les chaines (jamais undefined dans lenvironnement)', () => {
    const env = appImageEnv({ A: '1', B: undefined }, '/new/path');
    assert.deepEqual(Object.keys(env).sort(), ['A', 'APPIMAGE']);
    assert.equal(env['APPIMAGE'], '/new/path');
  });
});

/* ------------------------------------------------------------------ */
/* Allowlist d'hôtes — la seule autorisation de sortie                  */
/* ------------------------------------------------------------------ */

describe('isAllowedUpdateHost', () => {
  it("les hôtes GitHub de l'avenant passent", () => {
    assert.equal(isAllowedUpdateHost('https://api.github.com/repos/tournierjc/concord/releases/latest'), true);
    assert.equal(isAllowedUpdateHost('https://github.com/tournierjc/concord/releases/download/v0.5.0/x.exe'), true);
    assert.equal(isAllowedUpdateHost('https://objects.githubusercontent.com/asset'), true);
    // Mesuré le 2026-11-01 contre la release live v0.4.0 : la redirection de
    // github.com/…/releases/download aboutit sur ce CDN GitHub pré-signé.
    assert.equal(isAllowedUpdateHost('https://release-assets.githubusercontent.com/asset'), true);
    assert.equal(isAllowedUpdateHost('https://API.GITHUB.COM/x'), true, 'insensible à la casse');
  });
  it('tout le reste est refusé (evil.com, http, schéma exotique)', () => {
    assert.equal(isAllowedUpdateHost('https://evil.com/x'), false);
    assert.equal(isAllowedUpdateHost('https://api.github.com.evil.com/x'), false);
    assert.equal(isAllowedUpdateHost('https://evil.com/api.github.com/x'), false);
    assert.equal(isAllowedUpdateHost('https://release-assets.githubusercontent.com.evil.com/x'), false, 'suffixe collé refusé');
    assert.equal(isAllowedUpdateHost('https://evil-githubusercontent.com/x'), false);
    assert.equal(isAllowedUpdateHost('http://api.github.com/x'), false, 'http refusé');
    assert.equal(isAllowedUpdateHost('ftp://objects.githubusercontent.com/x'), false);
    assert.equal(isAllowedUpdateHost('pas une URL'), false);
    assert.equal(isAllowedUpdateHost(''), false);
  });
});
