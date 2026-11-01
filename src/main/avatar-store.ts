/**
 * avatar-store.ts — l'image d'avatar, chez soi, et nulle part ailleurs.
 *
 * SPEC-002 (amendement 2026-10-31) : l'utilisateur peut, en plus de la galerie embarquée, choisir
 * UNE IMAGE SUR SON DISQUE. Ce module fait les trois choses que le renderer n'a pas le droit de
 * faire (aucun accès disque, `sandbox: true`) :
 *
 *  1. valider le fichier choisi (extension, taille, signature PNG/JPEG/WEBP) ;
 *  2. le normaliser en PNG carré de `AVATAR_STORED_SIZE_PX` et l'écrire dans
 *     `userData/avatars/<empreinte>.png` — l'empreinte est le SHA-256 (16 hex) du PNG stocké, donc
 *     le fichier est IMMUABLE et son nom ne peut pas mentir ;
 *  3. relire un avatar stocké pour le servir à un pair (`avatar_get`), en revérifiant empreinte,
 *     signature et taille à chaque lecture (défense en profondeur : le disque peut avoir été
 *     touché à la main).
 *
 * Ce qui ne se passe JAMAIS ici : aucun compte, aucun téléversement, aucune adresse autre que
 * locale. L'image ne quitte pas la machine — seul son empreinte voyage sur le LAN, et le binaire
 * n'est demandé que par un pair du même réseau.
 *
 * Le redimensionnement utilise `createImageBitmap` (décodage système, aucune dépendance : ni
 * sharp, ni jimp). Si le décodage échoue — fichier corrompu ou format que le système ne lit pas —
 * on ne stocke RIEN : un avatar invisible vaut mieux qu'un fichier qu'on n'aurait pas su vérifier.
 *
 * `node:fs`, `node:crypto` et le décodeur d'image sont injectés (`AvatarStoreIo`) : la logique de
 * chemins, de bornes et d'empreintes s'exécute sous `node --test` avec un faux système de
 * fichiers, sans Electron ni disque réel.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AVATAR_MAX_SOURCE_BYTES,
  AVATAR_MAX_STORED_BYTES,
  AVATAR_STORED_SIZE_PX,
  isAllowedAvatarImagePath,
  isAvatarFileName,
  isAvatarRef,
  makeCustomAvatar,
  type CustomAvatar,
} from '../shell/avatar.ts';

/** Ce qu'un choix d'image rend au renderer : l'avatar persistable, ou le motif du refus. */
export type AvatarImportResult =
  | { ok: true; avatar: CustomAvatar }
  | { ok: false; reason: 'wrong-format' | 'too-large' | 'unreadable' | 'not-an-image' };

/** Ce qu'une demande `avatar_get` rend au lien de signalisation. */
export type AvatarLoadResult =
  | { ok: true; data: Uint8Array }
  | { ok: false; reason: 'unknown-ref' | 'corrupt' | 'too-large' };

export interface AvatarStoreIo {
  /** Décode une image (png/jpeg/webp) et la rend en RGBA. Injecté : `createImageBitmap` côté app. */
  decode: (bytes: Uint8Array) => Promise<{ width: number; height: number; rgba: Uint8Array } | null>;
  /** Encode un RGBA carré en PNG. Injecté : `canvas.toDataURL`/encodeur côté app. */
  encodePng: (size: number, rgba: Uint8Array) => Promise<Uint8Array | null>;
}

/** Signature réelle des trois formats promis — l'extension seule ne prouve rien. */
function sniffImageKind(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'webp';
  return null;
}

/** Les 16 premiers hexadécimaux du SHA-256 — l'empreinte qui voyage sur le fil. */
export function avatarRefForPng(png: Uint8Array): string {
  return createHash('sha256').update(png).digest('hex').slice(0, 16);
}

/**
 * Le PNG d'un avatar stocké, prêt à voyager sur le fil de signalisation (SPEC-002, amendement
 * 2026-10-31). Une ligne JSON est bornée à 64 Ko et le lien ferme la connexion sur tout
 * dépassement : un contenu qui ne tiendrait pas ENCODE en base64 est traité comme corrompu —
 * le demandeur retombe sur ses initiales plutôt que de faire tomber le lien.
 */
export function decodeAvatarPngFromWire(base64: string): Uint8Array | null {
  // Rejet large d'abord (longueur > plafond ou caractère hors alphabet → longueur mal formée),
  // puis décodage strict : Node LÂCHE des bits en trop sur un padding douteux — si la longueur
  // n'est pas un multiple de 4, on ne décode pas du tout.
  if (base64.length === 0 || base64.length > AVATAR_WIRE_BASE64_MAX_CHARS) return null;
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  const decoded = Buffer.from(base64, 'base64');
  if (decoded.byteLength === 0 || decoded.byteLength > AVATAR_MAX_STORED_BYTES) return null;
  const bytes = new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  if (sniffImageKind(bytes) !== 'png') return null;
  return bytes;
}

export function encodeAvatarPngForWire(png: Uint8Array): string | null {
  const base64 = Buffer.from(png).toString('base64');
  // Enveloppe JSON (`{"type":"avatar_data","from":…,"to":…,"avatarRef":…,"pngBase64":…}`) ≈ 120
  // octets + marge : on cale la borne du base64 sous les 64 Ko de la ligne.
  if (base64.length > AVATAR_WIRE_BASE64_MAX_CHARS) return null;
  return base64;
}

/** Plafond du base64 dans une ligne `avatar_data` (≈ 47 Ko de PNG, pour une ligne < 64 Ko). */
export const AVATAR_WIRE_BASE64_MAX_CHARS = 63 * 1024;

export interface AvatarStore {
  /** Le fichier a-t-il une taille lue, validée et convertie ; `null` = avatar persistable. */
  importFromPath(path: string): Promise<AvatarImportResult>;
  /** Relit un avatar stocké pour le servir à un pair ; jamais l'empreinte n'est fait confiance aveuglément. */
  load(avatarRef: string): AvatarLoadResult;
}

export function createAvatarStore(avatarsDir: string, io: AvatarStoreIo): AvatarStore {
  function filePathFor(ref: string): string {
    // L'empreinte est validée AVANT de servir un chemin : jamais `../` ne devient un chemin.
    if (!isAvatarRef(ref)) throw new Error('empreinte d’avatar hors contrat');
    return join(avatarsDir, `${ref}.png`);
  }

  async function importFromPath(path: string): Promise<AvatarImportResult> {
    if (!isAllowedAvatarImagePath(path)) return { ok: false, reason: 'wrong-format' };

    let raw: Buffer;
    try {
      raw = readFileSync(path);
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
    if (raw.byteLength === 0) return { ok: false, reason: 'unreadable' };
    if (raw.byteLength > AVATAR_MAX_SOURCE_BYTES) return { ok: false, reason: 'too-large' };

    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (sniffImageKind(bytes) === null) return { ok: false, reason: 'not-an-image' };

    let decoded: { width: number; height: number; rgba: Uint8Array } | null;
    try {
      decoded = await io.decode(bytes);
    } catch {
      decoded = null;
    }
    if (decoded === null || decoded.width <= 0 || decoded.height <= 0) {
      return { ok: false, reason: 'not-an-image' };
    }

    // Le centre-carré se fait ICI (sur le RGBA décodé), pas dans l'encodeur : la règle « on
    // stocke un carré de 256 px » tient en un seul endroit, testable sans canvas.
    const square = cropToSquare(decoded.width, decoded.height, decoded.rgba);
    let png: Uint8Array | null;
    try {
      png = await io.encodePng(AVATAR_STORED_SIZE_PX, square.rgba);
    } catch {
      png = null;
    }
    if (png === null || png.byteLength === 0) return { ok: false, reason: 'not-an-image' };
    if (png.byteLength > AVATAR_MAX_STORED_BYTES) return { ok: false, reason: 'too-large' };
    if (sniffImageKind(png) !== 'png') return { ok: false, reason: 'not-an-image' };

    const ref = avatarRefForPng(png);
    const avatar = makeCustomAvatar(ref);
    if (avatar === null) return { ok: false, reason: 'not-an-image' };

    mkdirSync(avatarsDir, { recursive: true });
    // Écriture directe : le nom est une empreinte, donc deux écritures du même contenu sont le
    // même fichier (idempotent par construction) — pas de fichier temporaire à renommer.
    writeFileSync(filePathFor(ref), png);
    return { ok: true, avatar };
  }

  function load(avatarRef: string): AvatarLoadResult {
    if (!isAvatarRef(avatarRef)) return { ok: false, reason: 'unknown-ref' };
    let raw: Buffer;
    try {
      raw = readFileSync(filePathFor(avatarRef));
    } catch {
      return { ok: false, reason: 'unknown-ref' };
    }
    if (raw.byteLength === 0 || raw.byteLength > AVATAR_MAX_STORED_BYTES) {
      return { ok: false, reason: raw.byteLength > AVATAR_MAX_STORED_BYTES ? 'too-large' : 'corrupt' };
    }
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    // Le fichier s'appelle `<empreinte>.png` : s'il ne contient pas ce PNG-là, il ment. On ne
    // sert pas un contenu qui ne correspond pas à son nom — le demandeur retombera sur les initiales.
    if (sniffImageKind(bytes) !== 'png') return { ok: false, reason: 'corrupt' };
    if (avatarRefForPng(bytes) !== avatarRef) return { ok: false, reason: 'corrupt' };
    return { ok: true, data: bytes };
  }

  return { importFromPath, load };
}

/**
 * Recadre le centre de l'image en carré puis rend un RGBA. Le recadrage centre est un choix
 * produit assumé (le visage est au centre d'un portrait) ; l'arrondi est fait vers le bas et le
 * cas dégénéré (largeur ou hauteur nulle) est rejeté par l'appelant.
 */
export function cropToSquare(
  width: number,
  height: number,
  rgba: Uint8Array,
): { size: number; rgba: Uint8Array } {
  const size = Math.min(width, height);
  const offsetX = Math.floor((width - size) / 2);
  const offsetY = Math.floor((height - size) / 2);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const srcRow = ((y + offsetY) * width + offsetX) * 4;
    out.set(rgba.subarray(srcRow, srcRow + size * 4), y * size * 4);
  }
  return { size, rgba: out };
}

/** Un nom de fichier d'avatar est toujours `<empreinte>.png` — vérifié avant tout `join`. */
export function isSafeAvatarFileName(name: unknown): name is string {
  return isAvatarFileName(name);
}

/**
 * L'`AvatarStoreIo` de l'application : décodage via `createImageBitmap` (décodeur système, aucune
 * dépendance) et encodage PNG via un `OffscreenCanvas` (disponible dans le process main d'Electron
 * 34). Ces deux API sont lues sur `globalThis` et non liées directement : sous `node --test` elles
 * n'existent pas, et seule la voie injectée avec de faux codecs est exercée. Tout échec de décodage
 * rend `null` — `importFromPath` transforme alors le refus en `not-an-image`, jamais en fichier.
 */
export function electronAvatarIo(): AvatarStoreIo {
  type Offscreen = { width: number; height: number; getContext(kind: '2d'): unknown; convertToBlob(): Promise<Blob> };
  const g = globalThis as unknown as {
    createImageBitmap?: (blob: Blob) => Promise<{ close(): void; width: number; height: number }>;
    OffscreenCanvas?: new (w: number, h: number) => Offscreen;
    ImageData?: new (data: Uint8ClampedArray, w: number, h: number) => unknown;
  };
  return {
    async decode(bytes) {
      if (typeof g.createImageBitmap !== 'function') return null;
      let bitmap: { close?: () => void; width: number; height: number } | null = null;
      const createBitmap = g.createImageBitmap;
      if (typeof createBitmap !== 'function') return null;
      try {
        bitmap = await createBitmap(new Blob([bytes as unknown as BlobPart]));
        const { width, height } = bitmap;
        if (width <= 0 || height <= 0) return null;
        if (typeof g.OffscreenCanvas !== 'function' || typeof g.ImageData !== 'function') return null;
        const canvas = new g.OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d') as {
          drawImage(source: object, x: number, y: number): void;
          getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
        } | null;
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, width, height).data;
        return { width, height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
      } catch {
        return null;
      } finally {
        bitmap?.close?.();
      }
    },
    async encodePng(size, rgba) {
      const Ctor = g.OffscreenCanvas;
      const ImageDataCtor = g.ImageData;
      if (typeof Ctor !== 'function' || typeof ImageDataCtor !== 'function') return null;
      try {
        const canvas = new Ctor(size, size);
        const ctx = canvas.getContext('2d') as {
          putImageData(data: unknown, x: number, y: number): void;
        } | null;
        if (!ctx) return null;
        ctx.putImageData(new ImageDataCtor(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), size, size), 0, 0);
        const blob = await canvas.convertToBlob();
        const buffer = await blob.arrayBuffer();
        return new Uint8Array(buffer);
      } catch {
        return null;
      }
    },
  };
}
