/**
 * update.ts — vérifier et installer une mise à jour depuis les publications GitHub, sans rien
 * laisser sortir d'autre (avenant SPEC-006b, arbitrage JC du 2026-11-01).
 *
 * POURQUOI CE FICHIER, ET POURQUOI ICI. La garde réseau (`net-guard.ts`, SPEC-001 CA20) et la CSP
 * (`csp.ts`) interdisent tout `https:` sortant du renderer — et c'est voulu : un document chargé
 * ne demande rien à Internet. L'amendement 2026-11-01 autorise UNE seule dérogation : la mise à
 * jour, par le **process principal seul**, via `node:https` — jamais `electron-updater`, jamais une
 * session Electron avec `webRequest`, jamais le `fetch` de la page. Les hôtes sont allowlistés en
 * dur (condition 1 de l'avenant) et l'hôte est revérifié sur CHAQUE redirection ; aucune télémétrie
 * (condition 3) : la requête est la requête API publique standard, sans token, `User-Agent` fixe.
 *
 * Ce qui est vérifié avant d'installer quoi que ce soit (conditions 4 et 6) :
 *  - l'empreinte SHA-256 publiée dans le corps de release (bloc « Empreintes SHA-256 ») est
 *    recalculée sur les octets téléchargés : mismatch ⇒ fichier supprimé, jamais installé ;
 *  - un artefact sans empreinte publiée n'est JAMAIS installé : c'est un `failed`, pas un espoir ;
 *  - l'installation ne commence JAMAIS pendant un salon actif — la garde `roomActive` est relue à
 *    CHAQUE tentative, automatique comme manuelle.
 *
 * La structure suit le pattern du dépôt (avatar-store, ducking) : tout I/O passe par un seam
 * injectable (`UpdateIo`) et toute DÉCISION est une fonction pure exportée — choix de l'artefact
 * par plateforme, arguments d'installateur, comparaison de versions, analyse du corps de release.
 * Sous `node --test`, un double en mémoire joue GitHub et le disque ; ce qui ne peut pas être
 * exercé ici (le vrai `spawn`, le vrai réseau) est isolé dans `electronUpdateIo`, relisible en
 * revue, et ses ARGUMENTS sont produits par les pures testées.
 *
 * Minuteries : le port `MainTimers` (`timers.ts`, SPEC-012 §4) — jamais un `setTimeout` ambiant.
 * Aucun `require(` ambiant : `node:https`, `node:fs` et `node:child_process` sont importés
 * dynamiquement (motif `ducking.ts`) pour qu'un `node --test` qui importe CE module ne puisse
 * ni ouvrir une socket ni enfanter un processus.
 */

import { createHash } from 'node:crypto';
import { mkdir, rename, rm, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { MainTimers } from './timers';

/* ------------------------------------------------------------------ */
/* Constantes du contrat d'amendement (liste close)                     */
/* ------------------------------------------------------------------ */

/** Le dépôt publié, seul interrogé. Aucune autre origine n'existe dans ce module. */
const REPO_OWNER = 'tournierjc';
const REPO_NAME = 'concord';

/**
 * Condition 1 de l'avenant : allowlist d'hôtes DURCIE ici. `github.com` est présent parce que
 * `browser_download_url` d'un asset pointe sur `/releases/download/…` et REDIRIGE vers le CDN ;
 * le contrat nomme `objects.githubusercontent.com` (+ redirections CDN) — la première cible
 * `github.com` fait partie du chemin public standard de GitHub. `api.github.com` porte l'API.
 */
export const UPDATE_ALLOWED_HOSTS: readonly string[] = [
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
];

/** Condition 3 : un seul User-Agent, fixe, sans identifiant. */
export const UPDATE_USER_AGENT = 'ConcordDesktop';

/** Timeout d'une requête (API et téléchargement), en millisecondes. */
export const FETCH_TIMEOUT_MS = 10_000;
/** Taille maximale de la réponse JSON de l'API (~1 Mo) : au-delà, on coupe. */
export const API_MAX_BYTES = 1024 * 1024;
/** Taille maximale d'un artefact (~400 Mo) : au-delà, on coupe et on supprime. */
export const ARTIFACT_MAX_BYTES = 400 * 1024 * 1024;
/** Nombre maximum de redirections suivies (GitHub en saute une : /download → CDN). */
export const MAX_REDIRECTS = 3;

/** Cadence : première vérification 30 s après le démarrage, puis toutes les 24 h. */
export const STARTUP_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Backoff sur échec : +6 h par échec consécutif, plafond de 3 échecs puis la fenêtre des 24 h. */
export const BACKOFF_STEP_MS = 6 * 60 * 60 * 1000;
export const MAX_CONSECUTIVE_FAILURES = 3;

/* ------------------------------------------------------------------ */
/* Types d'état                                                         */
/* ------------------------------------------------------------------ */

/** La machine à états, dans l'ordre du cycle normal, plus les états d'arrêt. */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'up-to-date'
  | 'disabled'
  | 'failed';

/**
 * L'état public, tel qu'il traverse l'IPC (`eventUpdateState`). `version` n'est rendue que sous
 * sa forme `X.Y.Z` (le contrat l'exige) ; `percent` est un entier 0..100 pendant le téléchargement.
 */
export interface UpdateState {
  state: UpdatePhase;
  version: string | null;
  percent: number | null;
  /** Raison lisible en `failed` (ou commande à rendre en `deb-only`) — jamais un code seul. */
  reason: string | null;
}

export const IDLE_UPDATE_STATE: UpdateState = {
  state: 'idle',
  version: null,
  percent: null,
  reason: null,
};

/** Un artefact publié, réduit à ce qui compte (le reste de l'objet GitHub est ignoré). */
export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
}

/** Ce que l'API rend, défensivement analysé : version normalisée + empreintes publiées. */
export interface LatestRelease {
  version: string;
  assets: ReleaseAsset[];
  /** Nom d'artefact → empreinte hexadécimale (64 minuscules). Absente = jamais installée. */
  sha256: ReadonlyMap<string, string>;
}

/* ------------------------------------------------------------------ */
/* Logique pure — toute la décision, sans réseau ni disque              */
/* ------------------------------------------------------------------ */

/**
 * Vrai si l'URL est autorisée : schéma `https:` ET hôte dans l'allowlist (insensible à la casse).
 * C'est la SEULE autorisation de sortie du module : `evil.com` et `http:` sont refusés ici, sur
 * l'URL initiale comme sur chaque `Location` de redirection.
 */
export function isAllowedUpdateHost(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return UPDATE_ALLOWED_HOSTS.some((allowed) => allowed === host);
}

/** Les trois champs numériques de `X.Y.Z`, `null` si la forme n'est pas la bonne. */
export function semverFields(version: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return null;
  return [major, minor, patch];
}

/**
 * Compare deux versions `X.Y.Z` champ à champ, en numériques — jamais lexicographiquement :
 * `0.10.0` EST supérieur à `0.9.9`, ce que `'0.10.0' > '0.9.9'` nierait. Rend 1 si `a > b`,
 * -1 si `a < b`, 0 si égales. Une version mal formée est la plus petite qui soit.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const left = semverFields(a);
  const right = semverFields(b);
  if (left === null || right === null) {
    if (left === null && right === null) return 0;
    return left === null ? -1 : 1;
  }
  for (let index = 0; index < 3; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

/**
 * Normalise un tag GitHub : `v0.4.0` → `0.4.0`. Un tag qui n'est pas une version `X.Y.Z` après
 * retrait du préfixe optionnel `v` rend `null` — une version inventée ne pilote aucun cycle.
 */
export function normalizeTagVersion(tagName: unknown): string | null {
  if (typeof tagName !== 'string') return null;
  const trimmed = tagName.trim();
  const bare = trimmed.startsWith('v') || trimmed.startsWith('V') ? trimmed.slice(1) : trimmed;
  return semverFields(bare) === null ? null : bare;
}

/** Ligne « <64 hex>  <fichier> » (un ou deux espaces : `sha256sum` en publie deux). */
const SHAPE_PAIR_LINE = /^([0-9a-f]{64})\s{1,2}(\S+)\s*$/;
/** Ligne « sha256sum <fichier> » : l'empreinte est alors sur la ligne SUIVANTE, seule. */
const SHAPE_SUM_LINE = /^sha256sum\s+(\S+)\s*$/i;

/** 64 hexadécimaux MINUSCULES, exactement — la forme publiée, rien de plus. */
export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Lit le bloc « Empreintes SHA-256 » du corps de release. Deux formats sont admis, tous deux
 * produits par la chaîne de publication du dépôt (bloc de code de la release v0.3.0) :
 *  - « <64 hex minuscules>  <fichier> » sur une ligne ;
 *  - « sha256sum <fichier> » suivi, sur la ligne SUIVANTE, de l'empreinte seule.
 * Une empreinte mal formée (majuscule, longueur autre que 64) est REJETÉE, pas corrigée : une
 * empreinte qu'on a dû réparer n'est plus une empreinte publiée.
 */
export function parseSha256Block(body: string | null): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  if (body === null) return found;
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim();
    const pair = SHAPE_PAIR_LINE.exec(line);
    if (pair !== null) {
      const digest = pair[1] ?? '';
      const file = pair[2] ?? '';
      if (isSha256Hex(digest) && file.length > 0) found.set(file, digest);
      continue;
    }
    const sum = SHAPE_SUM_LINE.exec(line);
    if (sum !== null) {
      const next = (lines[index + 1] ?? '').trim();
      const file = sum[1] ?? '';
      if (isSha256Hex(next) && file.length > 0) found.set(file, next);
    }
  }
  return found;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** Une URL n'est téléchargeable que si son HÔTE est allowlisté et son schéma `https:`. */
function isSafeDownloadUrl(rawUrl: unknown): rawUrl is string {
  return typeof rawUrl === 'string' && isAllowedUpdateHost(rawUrl);
}

/**
 * Analyse DÉFENSIVE de la réponse `/releases/latest`. Tout ce qui n'est pas la forme attendue
 * est écarté — tag manquant, `assets` absent ou non tableau, `body` non textuel, URL non-GitHub :
 * la version reste ce qu'elle est, un artefact sans URL sûre n'existe pas. Aucun cast : chaque
 * niveau est testé avant d'être descendu.
 */
export function parseLatestRelease(raw: unknown): LatestRelease | null {
  if (!isRecord(raw)) return null;
  const version = normalizeTagVersion(raw['tag_name']);
  if (version === null) return null;
  const assetsRaw = raw['assets'];
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(assetsRaw)) {
    for (const entry of assetsRaw) {
      if (!isRecord(entry)) continue;
      const name = entry['name'];
      const url = entry['browser_download_url'];
      if (typeof name !== 'string' || name.length === 0) continue;
      if (!isSafeDownloadUrl(url)) continue;
      assets.push({ name, downloadUrl: url });
    }
  }
  const bodyRaw = raw['body'];
  const body = typeof bodyRaw === 'string' ? bodyRaw : null;
  return { version, assets, sha256: parseSha256Block(body) };
}

/* ------------------------------------------------------------------ */
/* Stratégie d'installation par plateforme — pure, surjouée au test      */
/* ------------------------------------------------------------------ */

/**
 * Ce que le service va faire d'un artefact :
 *  - `nsis`         : Windows — l'exécutable se lance en silence (`/S`) ;
 *  - `appimage`     : Linux — `chmod +x`, relance avec `APPIMAGE` pointé sur le NOUVEAU fichier ;
 *  - `deb-only`     : Linux — le `.deb` n'est JAMAIS auto-installé (apt exige sudo) : on le
 *                     télécharge et on rend le chemin + la commande ;
 *  - `unsupported`  : rien de téléchargeable pour cette plateforme.
 */
export type InstallerStrategyKind = 'nsis' | 'appimage' | 'deb-only' | 'unsupported';

export interface InstallerStrategy {
  kind: InstallerStrategyKind;
  /** Le nom exact de l'asset visé, `null` si rien n'a été trouvé. */
  assetName: string | null;
  /** L'URL de téléchargement, `null` si rien n'a été trouvé. */
  downloadUrl: string | null;
}

/** Nom exact de l'artefact Windows attendu pour une version (NSIS, build officiel). */
export function expectedWindowsAsset(version: string): string {
  return `concord-${version}-setup-x64.exe`;
}

/** Nom exact de l'artefact AppImage attendu pour une version (build officiel). */
export function expectedAppImageAsset(version: string): string {
  return `concord-${version}-x86_64.AppImage`;
}

/** Nom exact de l'artefact .deb attendu pour une version (téléchargé, jamais spawné). */
export function expectedDebAsset(version: string): string {
  return `concord-${version}-linux-amd64.deb`;
}

/**
 * La commande manuelle honnête du `.deb` — celle que la documentation publie (`docs/INSTALL.md`),
 * avec le chemin LOCAL téléchargé, jamais une URL.
 */
export function debManualCommand(downloadedPath: string): string {
  return `sudo apt install ${downloadedPath}`;
}

/**
 * Choisit l'artefact et la stratégie pour une plateforme DONNÉE (surjouable en test :
 * `process.platform` n'est pas modifiable). Plateforme inconnue ⇒ `unsupported`, jamais un essai
 * en aveugle. Un artefact doit exister dans la release ET porter son empreinte publiée (condition 4
 * de l'avenant) : un `.exe` sans empreinte n'est pas une stratégie, c'est un `failed` du service.
 * `hasDpkg` est une INFORMATION (machine Debian) — le `.deb` n'est jamais lancé, qu'il existe ou non.
 */
export function chooseInstallerStrategy(
  platform: string,
  release: LatestRelease,
  hasDpkg: boolean,
): InstallerStrategy {
  const find = (name: string): ReleaseAsset | null => {
    const asset = release.assets.find((candidate) => candidate.name === name) ?? null;
    if (asset === null) return null;
    if (release.sha256.get(asset.name) === undefined) return null;
    return asset;
  };

  if (platform === 'win32') {
    const asset = find(expectedWindowsAsset(release.version));
    if (asset === null) return { kind: 'unsupported', assetName: null, downloadUrl: null };
    return { kind: 'nsis', assetName: asset.name, downloadUrl: asset.downloadUrl };
  }

  if (platform === 'linux') {
    const appimage = find(expectedAppImageAsset(release.version));
    if (appimage !== null) {
      return { kind: 'appimage', assetName: appimage.name, downloadUrl: appimage.downloadUrl };
    }
    const deb = find(expectedDebAsset(release.version));
    if (deb !== null) {
      // apt exige sudo : une app qui le demanderait en silence mentrait sur ce qu'elle fait.
      void hasDpkg;
      return { kind: 'deb-only', assetName: deb.name, downloadUrl: deb.downloadUrl };
    }
  }

  return { kind: 'unsupported', assetName: null, downloadUrl: null };
}

/**
 * Arguments d'invocation de l'installeur NSIS (Windows). `/S` est silencieux même sur un installeur
 * `oneClick: false` : NSIS accepte `/S` en mode assisté et saute les pages. Aucun autre argument —
 * jamais un chemin saisi par quelqu'un d'autre que notre propre téléchargement.
 */
export function nsisSpawnArgs(installerPath: string): string[] {
  return [installerPath, '/S'];
}

/**
 * Environnement de relance de l'AppImage : `APPIMAGE` doit pointer sur le NOUVEAU fichier, sinon
 * l'AppImage relancée remonte l'ancienne. `current` est la valeur lue dans `process.env` par le
 * seam — pas une supposition des pures.
 */
export function appImageEnv(current: Record<string, string | undefined>, newPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (typeof value === 'string') env[key] = value;
  }
  env['APPIMAGE'] = newPath;
  return env;
}

/**
 * Ce que l'installation va réellement exécuter, construit par la pure : le seam ne reçoit que ce
 * plan, jamais une chaîne shell (même loi que `ducking.ts` : aucun shell string). `null` pour
 * `deb-only` et `unsupported` — rien n'est lançable, et le service ne spawn JAMAIS ces deux-là.
 */
export interface SpawnPlan {
  spawnPath: string;
  spawnArgs: string[];
  /** Environnement de l'enfant (`undefined` = celui du processus). */
  spawnEnv: Record<string, string> | undefined;
}

export function planSpawn(
  strategy: InstallerStrategy,
  input: { installerPath: string; currentEnv: Record<string, string | undefined> },
): SpawnPlan | null {
  if (strategy.kind === 'nsis') {
    return {
      spawnPath: input.installerPath,
      spawnArgs: nsisSpawnArgs(input.installerPath),
      spawnEnv: undefined,
    };
  }
  if (strategy.kind === 'appimage') {
    return {
      spawnPath: input.installerPath,
      spawnArgs: [],
      spawnEnv: appImageEnv(input.currentEnv, input.installerPath),
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Le seam — tout I/O passe par là                                       */
/* ------------------------------------------------------------------ */

/** Un GET JSON borné : corps parsé, ou le motif du refus (jamais une exception hors norme). */
export type GetResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; reason: string };

/** Un flux vers le disque : empreinte calculée en continu, ou motif du refus. */
export type StreamResult =
  | { ok: true; sha256: string; bytes: number }
  | { ok: false; reason: string };

export interface UpdateIo {
  /** GET borné (timeout, taille, allowlist d'hôtes, redirections suivies avec re-vérification). */
  get(url: string): Promise<GetResult>;
  /** Télécharge `url` vers `targetPath`, sha256 recalculé en continu, progression bornée. */
  streamFile(url: string, targetPath: string): Promise<StreamResult>;
  /** Supprime un fichier (nettoyage d'un `.part` après mismatch) ; jamais de levée. */
  removeFile(path: string): Promise<void>;
  /** Renomme `from` → `to` (le `.part` validé devient l'artefact). */
  moveFile(from: string, to: string): Promise<void>;
  /** `chmod +x` (AppImage). */
  makeExecutable(path: string): Promise<void>;
  /** Lance détaché (`stdio: 'ignore'`, `unref`) ; rend `false` si le système refuse. */
  spawn(path: string, args: string[], env: Record<string, string> | undefined): Promise<boolean>;
  /** La plateforme (surjouée en test) — asynchrone : le seam réel n'a aucune lecture synchrone. */
  platform(): Promise<string>;
  /** Vrai si `dpkg` existe (machine Debian — information, jamais un déclencheur d'apt). */
  hasDpkg(): Promise<boolean>;
  /** Version de l'application, déjà normalisée `X.Y.Z`. */
  appVersion(): string;
  /** Millisecondes epoch (la même horloge que `MainTimers.now`). */
  now(): number;
  /** Répertoire de téléchargement (`userData/downloads`). */
  downloadsDir(): string;
  /** Le `process.env` vivant — lu par le seam, jamais par les pures. */
  env(): Record<string, string | undefined>;
  /** Avancement du flux courant (0..100) vers l'état `downloading` — callback, pas une rafale d'IPC. */
  setStreamProgress(onProgress: ((percent: number) => void) | null): void;
  /** Trace locale (console du main), jamais transmise. */
  log(message: string): void;
}

/* ------------------------------------------------------------------ */
/* Le service — machine à états, cadence, gardes                         */
/* ------------------------------------------------------------------ */

export interface UpdateService {
  /** Démarrer la cadence : vérification après 30 s, puis toutes les 24 h (condition 5 relue à chaque réveil). */
  start(): void;
  /** Désarmer toute minuterie (`will-quit`). */
  stop(): void;
  /**
   * Vérification FORCÉE (bouton) : ignore le backoff, le cache `up-to-date` ET `auto=false`
   * (exception documentée de la condition 5 — c'est une commande de l'utilisateur). Si un cycle
   * est en cours, rend sans relancer (reentrance ignorée et tracée).
   */
  checkNow(): Promise<void>;
  /** Installer l'artefact téléchargé (bouton [Installer maintenant]) — même garde salon que l'auto. */
  installUpdateNow(): Promise<void>;
  /** Le dernier état publié (instantané pour l'UI au montage). */
  getState(): UpdateState;
}

export interface UpdateServiceOptions {
  seam: UpdateIo;
  timers: MainTimers;
  /** `app.quit()` du main, appelé APRÈS un spawn réussi (l'installeur prend la main). */
  quitApp: () => void;
  /** Le salon est-il actif (joining/connected/retrying) — lu à CHAQUE tentative d'installation. */
  roomActive: () => boolean;
  /** Le réglage `update.auto`, lu à chaque réveil de cadence (condition 5). */
  isAutoEnabled: () => boolean;
  /** Publication de l'état (événement IPC) à CHAQUE transition, pas seulement à la fin. */
  onStateChange: (state: UpdateState) => void;
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const { seam, timers } = options;

  let state: UpdateState = { ...IDLE_UPDATE_STATE };
  let cycleRunning = false;
  /** La version de la release en cours de traitement (publiée dans les états du cycle). */
  let currentVersion: string | null = null;
  /** L'artefact téléchargé et validé, prêt à installer. */
  let readyArtifact: (InstallerStrategy & { path: string }) | null = null;
  let consecutiveFailures = 0;
  let backoffHandle: unknown = null;
  let startupHandle: unknown = null;
  let intervalHandle: unknown = null;

  function publish(next: UpdateState): void {
    state = next;
    options.onStateChange(next);
  }

  function fail(reason: string): void {
    readyArtifact = null;
    publish({ state: 'failed', version: currentVersion, percent: null, reason });
    consecutiveFailures += 1;
    if (consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
      // Backoff : +6 h par échec consécutif, une seule minuterie de report. La fenêtre des 24 h
      // (le `repeat`) garde la main au-delà — jamais de hammering de l'API GitHub.
      const delay = BACKOFF_STEP_MS * consecutiveFailures;
      seam.log(
        `mise à jour : échec n°${consecutiveFailures} (${reason}) — nouvelle tentative dans ${Math.round(delay / 3_600_000)} h`,
      );
      if (backoffHandle !== null) timers.cancel(backoffHandle);
      backoffHandle = timers.once(delay, () => {
        backoffHandle = null;
        void runCycle('auto');
      });
    } else {
      seam.log(`mise à jour : ${consecutiveFailures} échecs consécutifs — attente de la fenêtre de 24 h`);
    }
  }

  /** Le cycle complet : vérifier → (télécharger) → (installer si auto et salon inactif). */
  async function runCycle(mode: 'auto' | 'manual'): Promise<void> {
    if (cycleRunning) {
      // Reentrance : un bouton pendant un cycle en vol NE relance PAS le réseau — il regarde.
      seam.log('mise à jour : cycle déjà en cours, demande ignorée');
      return;
    }
    if (mode === 'auto' && !options.isAutoEnabled()) {
      // Condition 5 : hors demande manuelle, `auto=false` ⇒ AUCUN appel réseau (0 get, 0 stream).
      if (state.state !== 'disabled') publish({ state: 'disabled', version: null, percent: null, reason: null });
      return;
    }
    cycleRunning = true;
    currentVersion = null;
    readyArtifact = null;
    try {
      publish({ state: 'checking', version: null, percent: null, reason: null });
      const fetched = await seam.get(latestReleaseUrl());
      if (!fetched.ok) {
        fail(fetched.reason);
        return;
      }
      const release = parseLatestRelease(fetched.json);
      if (release === null) {
        fail('réponse de publication illisible');
        return;
      }
      currentVersion = release.version;
      if (compareSemver(release.version, seam.appVersion()) <= 0) {
        consecutiveFailures = 0;
        publish({ state: 'up-to-date', version: release.version, percent: null, reason: null });
        return;
      }
      const platform = await seam.platform();
      const hasDpkg = await seam.hasDpkg();
      const strategy = chooseInstallerStrategy(platform, release, hasDpkg);
      if (strategy.kind === 'unsupported' || strategy.assetName === null || strategy.downloadUrl === null) {
        // Rien de lançable avec empreinte pour cette plateforme : `failed` motivé SANS backoff —
        // on ne punit pas GitHub d'une lacune de notre propre chaîne de publication.
        publish({
          state: 'failed',
          version: release.version,
          percent: null,
          reason: 'aucun installateur disponible pour cette plateforme',
        });
        return;
      }
      publish({ state: 'available', version: release.version, percent: null, reason: null });
      const downloaded = await downloadArtifact(strategy, release);
      if (downloaded === null) return; // `downloadArtifact` a publié le `failed`
      readyArtifact = { ...strategy, path: downloaded };
      publish({ state: 'downloaded', version: release.version, percent: null, reason: null });
      // Choix 3 (JC) : la chaîne installe SANS attendre le redémarrage, en automatique COMME en
      // manuel (le bouton « Vérifier maintenant » lance le cycle complet, pas une simple vérif).
      // Le `.deb` est l'exception : il ne se lance jamais — l'artefact est téléchargé, la commande
      // est rendue au clic ([Installer maintenant] → `performInstall` refuse, la commande sort).
      if (strategy.kind !== 'deb-only') {
        if (options.roomActive()) {
          // Condition 6 : report motivé, l'artefact reste prêt pour le bouton [Installer].
          seam.log('mise à jour : salon actif — installation reportée, artefact conservé');
          return;
        }
        await performInstall();
      }
    } finally {
      cycleRunning = false;
      seam.setStreamProgress(null);
    }
  }

  /** Télécharge l'artefact d'une stratégie et vérifie son empreinte ; rend le chemin, `null` si refusé. */
  async function downloadArtifact(strategy: InstallerStrategy, release: LatestRelease): Promise<string | null> {
    const assetName = strategy.assetName;
    const url = strategy.downloadUrl;
    if (assetName === null || url === null) return null;
    const digest = release.sha256.get(assetName);
    if (digest === undefined) {
      // Condition 4 : aucune empreinte publiée ⇒ jamais installé, jamais même téléchargé.
      fail(`aucune empreinte publiée pour ${assetName}`);
      return null;
    }
    const targetPath = join(seam.downloadsDir(), assetName);
    const partPath = `${targetPath}.part`;
    publish({ state: 'downloading', version: release.version, percent: 0, reason: null });
    // Un seul abonné branché pour tout le cycle. La garde dans le rappel (`state.state ===
    // 'downloading'`) suffit : apres `downloaded`/`failed`, un progress tardif est ignore. Ne PAS
    // couper l'abonne ici — en mode auto, l'installation suit la publication `downloaded` dans la
    // meme pile et le dernier pourcentage (100) arriverait les yeux fermes.
    seam.setStreamProgress((percent: number) => {
      if (state.state !== 'downloading') return;
      publish({ state: 'downloading', version: release.version, percent, reason: null });
    });
    const streamed = await seam.streamFile(url, partPath);
    seam.setStreamProgress(null);
    if (!streamed.ok) {
      await seam.removeFile(partPath);
      fail(`téléchargement refusé : ${streamed.reason}`);
      return null;
    }
    if (streamed.sha256 !== digest) {
      // L'empreinte recalculée ne correspond pas à l'empreinte publiée : ces octets ne sont pas
      // ceux de la publication. Suppression immédiate, `failed` motivé, jamais installé.
      await seam.removeFile(partPath);
      fail(`empreinte non concordante pour ${assetName}`);
      return null;
    }
    await seam.moveFile(partPath, targetPath);
    if (strategy.kind === 'appimage') await seam.makeExecutable(targetPath);
    return targetPath;
  }

  /** Lancer l'installeur (garde salon relue ICI : l'appel peut venir du bouton, pas du cycle). */
  async function performInstall(): Promise<void> {
    const ready = readyArtifact;
    if (ready === null) return;
    if (options.roomActive()) {
      // Condition 6 : jamais pendant un salon, automatique comme manuel. Report tracé, pas muet.
      seam.log('mise à jour : salon actif — installation refusée');
      return;
    }
    const plan = planSpawn(ready, { installerPath: ready.path, currentEnv: seam.env() });
    if (plan === null) {
      fail('stratégie d’installation inconnue');
      return;
    }
    publish({ state: 'installing', version: currentVersion, percent: null, reason: null });
    const spawned = await seam.spawn(plan.spawnPath, plan.spawnArgs, plan.spawnEnv);
    if (!spawned) {
      fail('lancement de l’installateur refusé par le système');
      return;
    }
    // L'installateur a été lancé détaché : il finira sans nous. On rend la machine.
    options.quitApp();
  }

  function latestReleaseUrl(): string {
    return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
  }

  function start(): void {
    // Le cycle régulier est armé une fois pour toutes : la CONDITION `auto` est relue à chaque
    // réveil — couper l'interrupteur en cours de session éteint le prochain cycle, pas celui-ci.
    intervalHandle = timers.repeat(CHECK_INTERVAL_MS, () => {
      void runCycle('auto');
    });
    startupHandle = timers.once(STARTUP_CHECK_DELAY_MS, () => {
      void runCycle('auto');
    });
  }

  function stop(): void {
    if (intervalHandle !== null) timers.cancel(intervalHandle);
    if (startupHandle !== null) timers.cancel(startupHandle);
    if (backoffHandle !== null) timers.cancel(backoffHandle);
    intervalHandle = null;
    startupHandle = null;
    backoffHandle = null;
  }

  return {
    start,
    stop,
    checkNow: () => {
      // Forcée : le backoff et l'état `up-to-date` ne comptent pas, et `auto=false` n'arrête PAS
      // une demande manuelle (exception documentée de la condition 5 de l'avenant).
      if (cycleRunning) {
        seam.log('mise à jour : cycle déjà en cours, vérification manuelle ignorée');
        return Promise.resolve();
      }
      if (backoffHandle !== null) {
        timers.cancel(backoffHandle);
        backoffHandle = null;
      }
      return runCycle('manual');
    },
    installUpdateNow: () => {
      // Garde salon identique à l'auto (condition 6) : le renderer masque le bouton en salon, le
      // main refuse quand même — l'UI n'est pas l'autorité.
      if (options.roomActive()) {
        seam.log('mise à jour : salon actif — installation immédiate refusée');
        return Promise.resolve();
      }
      const ready = readyArtifact;
      if (ready === null) return Promise.resolve();
      if (ready.kind === 'deb-only') {
        // Le `.deb` n'est JAMAIS spawné : le bouton rend la commande, pas un faux « installing ».
        publish({
          state: 'downloaded',
          version: currentVersion,
          percent: null,
          reason: debManualCommand(ready.path),
        });
        return Promise.resolve();
      }
      return performInstall();
    },
    getState: () => state,
  };
}

/* ------------------------------------------------------------------ */
/* L'implémentation Electron du seam — réseau Node, disque userData      */
/* ------------------------------------------------------------------ */

/**
 * Le seam réel. `node:https` seul — pas de session Electron, pas de `webRequest` (condition 2 de
 * l'amendement). NON VÉRIFIÉ dans les tests unitaires : les appels réseau réels et le vrai `spawn`
 * — la décision est testée sur double (update-service) et ces lignes sont relues en revue.
 */
export interface ElectronUpdateIoOptions {
  downloadsDir: string;
  appVersion: string;
  /** Le `process.env` vivant, lu par le seam (jamais par les pures). */
  env: Record<string, string | undefined>;
  /** Le port des minuteries (`MainTimers`, SPEC-012 §4) : le seam date par lui, jamais en direct. */
  timers: MainTimers;
}

export function electronUpdateIo(opts: ElectronUpdateIoOptions): UpdateIo {
  let onProgress: ((percent: number) => void) | null = null;

  /** Une requête HTTPS bornée : plafond de redirections, hôte revérifié à chaque saut, taille bornée. */
  async function get(url: string, redirectsLeft: number = MAX_REDIRECTS): Promise<GetResult> {
    if (!isAllowedUpdateHost(url)) return { ok: false, reason: 'hôte hors allowlist' };
    const https = await import('node:https');
    return new Promise<GetResult>((resolve) => {
      let settled = false;
      const settle = (result: GetResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const request = https.get(
        url,
        {
          headers: { 'User-Agent': UPDATE_USER_AGENT, Accept: 'application/vnd.github+json' },
          timeout: FETCH_TIMEOUT_MS,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            if (redirectsLeft <= 0) {
              settle({ ok: false, reason: 'trop de redirections' });
              return;
            }
            const location = response.headers['location'];
            if (typeof location !== 'string') {
              settle({ ok: false, reason: 'redirection sans cible' });
              return;
            }
            let target: string;
            try {
              target = new URL(location, url).toString();
            } catch {
              settle({ ok: false, reason: 'cible de redirection illisible' });
              return;
            }
            // Condition 1 : l'hôte de CHAQUE cible est revérifié avant le prochain saut.
            if (!isAllowedUpdateHost(target)) {
              settle({ ok: false, reason: 'redirection hors allowlist' });
              return;
            }
            void get(target, redirectsLeft - 1).then(settle);
            return;
          }
          if (status !== 200) {
            response.resume();
            settle({ ok: false, reason: `statut HTTP ${status}` });
            return;
          }
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (piece: string) => {
            text += piece;
            // Borné ~1 Mo : une réponse qui déborde est coupée, pas accumulée sans fin.
            if (text.length > API_MAX_BYTES) {
              response.destroy();
              settle({ ok: false, reason: 'réponse trop volumineuse' });
            }
          });
          response.on('error', () => settle({ ok: false, reason: 'flux interrompu' }));
          response.on('end', () => {
            if (settled) return;
            try {
              settle({ ok: true, status, json: JSON.parse(text) as unknown });
            } catch {
              settle({ ok: false, reason: 'JSON illisible' });
            }
          });
        },
      );
      request.on('timeout', () => {
        request.destroy();
        settle({ ok: false, reason: 'délai dépassé' });
      });
      request.on('error', () => settle({ ok: false, reason: 'connexion refusée' }));
    });
  }

  async function streamFile(
    url: string,
    targetPath: string,
    redirectsLeft: number = MAX_REDIRECTS,
  ): Promise<StreamResult> {
    // Le HOST FINAL est revérifié ici aussi (après redirections) — double barrière avec `get`.
    if (!isAllowedUpdateHost(url)) return { ok: false, reason: 'hôte de téléchargement hors allowlist' };
    const https = await import('node:https');
    const fs = await import('node:fs');
    await mkdir(dirname(targetPath), { recursive: true });
    return new Promise<StreamResult>((resolve) => {
      let settled = false;
      const settle = (result: StreamResult): void => {
        if (settled) return;
        settled = true;
        try {
          fs.rmSync(targetPath, { force: true });
        } catch {
          /* nettoyage au mieux ; l'appelant retente ou renonce */
        }
        resolve(result);
      };
      const hash = createHash('sha256');
      let bytes = 0;
      const request = https.get(
        url,
        { headers: { 'User-Agent': UPDATE_USER_AGENT }, timeout: FETCH_TIMEOUT_MS },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            if (redirectsLeft <= 0) {
              settle({ ok: false, reason: 'trop de redirections' });
              return;
            }
            const location = response.headers['location'];
            if (typeof location !== 'string') {
              settle({ ok: false, reason: 'redirection sans cible' });
              return;
            }
            let target: string;
            try {
              target = new URL(location, url).toString();
            } catch {
              settle({ ok: false, reason: 'cible de redirection illisible' });
              return;
            }
            if (!isAllowedUpdateHost(target)) {
              settle({ ok: false, reason: 'redirection de téléchargement hors allowlist' });
              return;
            }
            void streamFile(target, targetPath, redirectsLeft - 1).then((inner) => {
              if (inner.ok) {
                // Succès d'un saut : ne PAS nettoyer le fichier écrit par le saut interne.
                settled = true;
                resolve(inner);
              } else {
                settle(inner);
              }
            });
            return;
          }
          if (status !== 200) {
            response.resume();
            settle({ ok: false, reason: `statut HTTP ${status}` });
            return;
          }
          const sink = fs.createWriteStream(targetPath);
          sink.on('error', () => {
            response.destroy();
            settle({ ok: false, reason: 'écriture impossible' });
          });
          response.on('error', () => settle({ ok: false, reason: 'flux interrompu' }));
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > ARTIFACT_MAX_BYTES) {
              response.destroy();
              sink.destroy();
              settle({ ok: false, reason: 'artefact trop volumineux' });
              return;
            }
            hash.update(chunk);
            if (onProgress !== null) {
              const totalHeader = response.headers['content-length'];
              if (typeof totalHeader === 'string') {
                const total = Number(totalHeader);
                if (Number.isFinite(total) && total > 0) {
                  onProgress(Math.min(100, Math.floor((bytes / total) * 100)));
                }
              }
            }
            sink.write(chunk);
          });
          response.on('end', () => {
            sink.end(() => {
              if (settled) return;
              settled = true;
              resolve({ ok: true, sha256: hash.digest('hex'), bytes });
            });
          });
        },
      );
      request.on('timeout', () => {
        request.destroy();
        settle({ ok: false, reason: 'délai dépassé' });
      });
      request.on('error', () => settle({ ok: false, reason: 'connexion refusée' }));
    });
  }

  return {
    get: (url: string) => get(url),
    streamFile: (url: string, targetPath: string) => streamFile(url, targetPath),
    async removeFile(path: string): Promise<void> {
      await rm(path, { force: true }).catch(() => undefined);
    },
    async moveFile(from: string, to: string): Promise<void> {
      await mkdir(dirname(to), { recursive: true });
      // Windows refuse un rename sur une cible existante : on l'écarte d'abord.
      await rm(to, { force: true }).catch(() => undefined);
      await rename(from, to);
    },
    async makeExecutable(path: string): Promise<void> {
      await chmod(path, 0o755);
    },
    async spawn(path: string, args: string[], spawnEnv: Record<string, string> | undefined): Promise<boolean> {
      // Import dynamique (motif `ducking.ts`) : `node --test` n'enfante rien en important ce module.
      const childProcess = await import('node:child_process');
      try {
        childProcess.spawn(path, args, {
          detached: true,
          stdio: 'ignore',
          ...(spawnEnv === undefined ? {} : { env: spawnEnv }),
        });
        // `detached: true` separe l'enfant de notre groupe de processus : il finit sans nous.
        // Pas de `.unref()` ici — la garde SPEC-012 §4 reserve `unref` a `src/main/timers.ts`
        // (les minuteries) ; `detached` est le mecanisme equivalent pour un processus enfante.
        return true;
      } catch {
        return false;
      }
    },
    async platform(): Promise<string> {
      return process.platform;
    },
    async hasDpkg(): Promise<boolean> {
      // Information, jamais un déclencheur : le `.deb` n'est jamais spawné (condition de
      // l'avenant). La sonde lit le disque, sans exécuter quoi que ce soit.
      try {
        const fs = await importFsSync();
        return fs.existsSync('/usr/bin/dpkg') || fs.existsSync('/bin/dpkg');
      } catch {
        return false;
      }
    },
    appVersion: () => opts.appVersion,
    // L'instant vient du PORT (`MainTimers.now`, SPEC-012 §4) : le seam ne lit jamais la pendule
    // en direct — la porte du main reste la seule lecture de `Date.now` du process.
    now: () => opts.timers.now(),
    downloadsDir: () => opts.downloadsDir,
    env: () => opts.env,
    setStreamProgress: (callback) => {
      onProgress = callback;
    },
    log: (message: string) => {
      console.debug('[mise à jour]', message);
    },
  };
}

/**
 * `node:fs` chargé à la demande — le module est compilé en CommonJS par `tsconfig.main.json`.
 * Chargement paresseux : aucun accès synchrone au disque à l'import sous `node --test`.
 */
async function importFsSync(): Promise<typeof import('node:fs')> {
  return import('node:fs');
}
