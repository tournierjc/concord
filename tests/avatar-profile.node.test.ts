/**
 * tests/avatar-profile.node.test.ts — le profil pseudo + avatar (SPEC-002, amendement 2026-10-31).
 *
 * Ce que la directive produit tient, et ce fichier vérifie :
 *   1. la galerie embarquée est close, déterministe (défaut dérivé de l'instanceId), et un id
 *      hors galerie ne passe JAMAIS (réglages ni fil) ;
 *   2. l'avatar local a une forme exacte (`{kind:'custom', file:'<empreinte>.png', ref}`) et le
 *      nom qui ment est refusé, pas corrigé ;
 *   3. le magasin (`avatar-store`) refuse une extension hors liste, un fichier trop lourd, un
 *      contenu qui n'est pas une image (signature), et ne sert jamais un contenu qui ne
 *      correspond pas à son nom — `load()` d'une empreinte inconnue = repli, pas d'exception ;
 *   4. le fil ne transporte JAMAIS l'image : `join` porte un `avatarRef` borné, `avatar_get` est
 *      remonté au main, `answerAvatarGet` écrit le PNG sur la connexion du demandeur et refuse
 *      une ligne au-dessus du plafond ; empreinte inconnue côté réponse = `null` honnête ;
 *   5. rétro-compat : un fichier de réglages SANS la clé `avatar` (écrit avant l'amendement) se
 *     lit et devient `null` (initiales), sans erreur.
 *
 * Lancer : npx tsx --test tests/avatar-profile.node.test.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  AVATAR_GALLERY,
  AVATAR_IMAGE_EXTENSIONS,
  AVATAR_MAX_SOURCE_BYTES,
  AVATAR_MAX_STORED_BYTES,
  AVATAR_REF_LENGTH,
  AVATAR_STORED_SIZE_PX,
  avatarEmojiFor,
  avatarInitials,
  avatarRefFor,
  customAvatarRef,
  defaultAvatarIdFor,
  isAllowedAvatarImagePath,
  isAvatarFileName,
  isAvatarRef,
  isCustomAvatarShape,
  isGalleryAvatarId,
  makeCustomAvatar,
  normalizeIncomingAvatarRef,
} from '../src/shell/avatar.ts';
import {
  createAvatarStore,
  cropToSquare,
  avatarRefForPng,
  decodeAvatarPngFromWire,
  encodeAvatarPngForWire,
} from '../src/main/avatar-store.ts';
import {
  applySettingsPatch,
  defaultSettings,
  parseSettings,
  serializeSettings,
} from '../src/shell/settings-schema.ts';
import {
  createLocalSignaling,
  MAX_AVATAR_BASE64_CHARS,
  parseClientMessage,
  type ReceiveResult,
  type ServerMessage,
  type SocketLike,
} from '../src/engine/net/local-signaling.ts';
import { guardPayload } from '../src/shell/ipc-contract.ts';

/* ------------------------------------------------------------------ */
/* Galerie embarquée                                                   */
/* ------------------------------------------------------------------ */

test('galerie : 16 choix, ids uniques, emoji non vides', () => {
  assert.equal(AVATAR_GALLERY.length, 16);
  const ids = new Set(AVATAR_GALLERY.map((entry) => entry.id));
  assert.equal(ids.size, AVATAR_GALLERY.length, 'deux choix portent le même id');
  for (const entry of AVATAR_GALLERY) {
    assert.ok(entry.id.length > 0 && /^[a-z]+$/.test(entry.id), `id hors forme : ${entry.id}`);
    assert.ok(entry.emoji.length > 0, `emoji vide pour ${entry.id}`);
    assert.equal(avatarEmojiFor(entry.id), entry.emoji);
  }
});

test('galerie : un id hors galerie est refusé partout (réglage, fil, défaut)', () => {
  assert.equal(isGalleryAvatarId('hacker'), false);
  assert.equal(isGalleryAvatarId('../etc/passwd'), false);
  assert.equal(avatarEmojiFor('hacker'), null);
  assert.equal(normalizeIncomingAvatarRef('hacker'), null);

  const settings = defaultSettings();
  const patched = applySettingsPatch(settings, { avatar: 'hacker' });
  assert.equal(patched.ok, false, 'un id hors galerie ne doit pas entrer dans les réglages');
});

test('galerie : le défaut est déterministe par instanceId et reste dans la galerie', () => {
  const first = defaultAvatarIdFor('aaaaaaaa-0000-4000-8000-000000000001');
  const again = defaultAvatarIdFor('aaaaaaaa-0000-4000-8000-000000000001');
  assert.equal(first, again, 'deux relances sur la même machine donnent le même visage');
  assert.ok(isGalleryAvatarId(first));
  // Deux instances distinctes ne sont pas contraintes d'être distinctes, mais le hachage n'est
  // pas une constante : au moins deux instanceIds différents sur trois choisis rendent deux visages.
  const faces = new Set([
    defaultAvatarIdFor('instance-one'),
    defaultAvatarIdFor('instance-two'),
    defaultAvatarIdFor('instance-three'),
  ]);
  assert.ok(faces.size >= 2, 'le choix par défaut ne doit pas être une constante');
});

/* ------------------------------------------------------------------ */
/* Avatar local : forme, empreinte, initiales                          */
/* ------------------------------------------------------------------ */

test('avatar local : la forme exacte est la seule admise', () => {
  const valid = { kind: 'custom', file: `${'a'.repeat(16)}.png`, ref: 'a'.repeat(16) } as const;
  assert.ok(isCustomAvatarShape(valid));
  assert.ok(!isCustomAvatarShape({ kind: 'custom', file: `${'a'.repeat(16)}.png` }), 'ref manquant');
  assert.ok(!isCustomAvatarShape({ ...valid, extra: 1 }), 'un champ de trop est un refus');
  // La garde de forme ne vérifie QUE la forme ; la coïncidence file = <ref>.png est vérifiée plus
  // haut (schéma, `customAvatarRef`) — deux règles distinctes, jamais confondues.
  assert.ok(isCustomAvatarShape({ ...valid, file: 'autre.png' }), 'la forme est bonne, la coïncidence se vérifie ailleurs');
  assert.equal(customAvatarRef({ ...valid, file: 'autre.png' }), null, 'un nom qui ne coïncide pas ne rend aucune empreinte');
  const made = makeCustomAvatar('b'.repeat(16));
  assert.deepEqual(made, { kind: 'custom', file: `${'b'.repeat(16)}.png`, ref: 'b'.repeat(16) });
  assert.equal(makeCustomAvatar('nope'), null);
  assert.equal(customAvatarRef(valid), 'a'.repeat(16));
  assert.equal(customAvatarRef('fox'), null);
  assert.equal(avatarRefFor(valid), 'a'.repeat(16));
  assert.equal(avatarRefFor('fox'), 'fox');
  assert.equal(avatarRefFor(null), null);
});

test('empreinte et initiales : bornes partagées avec le fil', () => {
  assert.equal(AVATAR_REF_LENGTH, 16);
  assert.ok(isAvatarRef('0123456789abcdef'));
  assert.ok(!isAvatarRef('0123456789abcde'));
  assert.ok(!isAvatarRef('0123456789abcdefg'));
  assert.ok(!isAvatarRef('0123456789ABCDEF'), 'les majuscules ne sont pas l’écriture de l’empreinte');
  assert.ok(isAvatarFileName(`${'0'.repeat(16)}.png`));
  assert.ok(!isAvatarFileName('../../etc/passwd'));
  assert.ok(!isAvatarFileName(`${'0'.repeat(16)}.jpg`));
  assert.equal(avatarInitials('Jeanne Corbin'), 'JC');
  assert.equal(avatarInitials(''), '?');
  assert.equal(avatarInitials(null), '?');
});

test('formats acceptés : png/jpg/jpeg/webp seulement, comparaison insensible à la casse', () => {
  assert.deepEqual([...AVATAR_IMAGE_EXTENSIONS], ['.png', '.jpg', '.jpeg', '.webp']);
  assert.ok(isAllowedAvatarImagePath('/home/jean/Images/photo.PNG'));
  assert.ok(isAllowedAvatarImagePath('C:\\Users\\jean\\avatar.webp'));
  assert.ok(!isAllowedAvatarImagePath('/home/jean/script.sh'));
  assert.ok(!isAllowedAvatarImagePath('/home/jean/no-extension'));
  assert.ok(!isAllowedAvatarImagePath('/home/jean/png'));
  assert.ok(!isAllowedAvatarImagePath(null));
});

/* ------------------------------------------------------------------ */
/* Le magasin : validation, stockage, repli                            */
/* ------------------------------------------------------------------ */

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function fakeIo(overrides: Partial<{ decode: () => Promise<any>; encodePng: () => Promise<any> }> = {}) {
  return {
    decode: overrides.decode ?? (async () => ({ width: 4, height: 2, rgba: new Uint8Array(4 * 2 * 4) })),
    encodePng: overrides.encodePng ?? (async () => new Uint8Array(PNG_1PX)),
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'concord-avatars-'));
}

test('magasin : une image valide est stockée sous <empreinte>.png et relue intacte', async () => {
  const dir = tempDir();
  try {
    const store = createAvatarStore(dir, fakeIo());
    const src = join(dir, 'source.png');
    writeFileSync(src, PNG_1PX);
    const imported = await store.importFromPath(src);
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    assert.equal(imported.avatar.kind, 'custom');
    assert.equal(imported.avatar.file, `${imported.avatar.ref}.png`);
    assert.ok(isAvatarRef(imported.avatar.ref));
    // Relisible, et son contenu correspond bien à son nom.
    const loaded = store.load(imported.avatar.ref);
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.deepEqual([...loaded.data], [...PNG_1PX]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('magasin : extension refusée, fichier trop lourd, contenu non-image', async () => {
  const dir = tempDir();
  try {
    const store = createAvatarStore(dir, fakeIo());
    const txt = join(dir, 'note.txt');
    writeFileSync(txt, Buffer.from('bonjour'));
    assert.deepEqual(await store.importFromPath(txt), { ok: false, reason: 'wrong-format' });

    const heavy = join(dir, 'heavy.png');
    writeFileSync(heavy, Buffer.alloc(AVATAR_MAX_SOURCE_BYTES + 1, 0x41));
    assert.deepEqual(await store.importFromPath(heavy), { ok: false, reason: 'too-large' });

    const lying = join(dir, 'lying.png');
    writeFileSync(lying, Buffer.from('%PDF-1.4 pas une image du tout'));
    assert.deepEqual(await store.importFromPath(lying), { ok: false, reason: 'not-an-image' });

    const missing = join(dir, 'absent.png');
    assert.deepEqual(await store.importFromPath(missing), { ok: false, reason: 'unreadable' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('magasin : empreinte inconnue ou fichier qui ment = repli, jamais une exception', async () => {
  const dir = tempDir();
  try {
    const store = createAvatarStore(dir, fakeIo());
    assert.deepEqual(store.load('ffffffffffffffff'), { ok: false, reason: 'unknown-ref' });
    // Un chemin n'est pas une empreinte : c'est une absence, jamais une lecture hors du magasin.
    assert.deepEqual(store.load('../../../etc/passwd'), { ok: false, reason: 'unknown-ref' });

    // Un fichier posé à la main sous un nom d'empreinte qui ne correspond pas à son contenu :
    // `load` revérifie l'empreinte et refuse de servir un contenu qui ment.
    const png = new Uint8Array(PNG_1PX);
    const wrongName = join(dir, `${'0'.repeat(16)}.png`);
    writeFileSync(wrongName, png);
    // Le contenu est un PNG valide… mais ce n'est PAS celui que le nom annonce.
    assert.notEqual(avatarRefForPng(png), '0'.repeat(16));
    assert.deepEqual(store.load('0'.repeat(16)), { ok: false, reason: 'corrupt' });

    // Le bon nom rend le bon contenu.
    const goodRef = avatarRefForPng(png);
    writeFileSync(join(dir, `${goodRef}.png`), png);
    assert.equal(store.load(goodRef).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('magasin : décodage impossible = rien n’est stocké', async () => {
  const dir = tempDir();
  try {
    const store = createAvatarStore(dir, fakeIo({ decode: async () => null }));
    const src = join(dir, 'corrompu.png');
    writeFileSync(src, PNG_1PX);
    assert.deepEqual(await store.importFromPath(src), { ok: false, reason: 'not-an-image' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('magasin : le centre-carré garde le centre et la taille minimale', () => {
  // 4×2 : le carré fait 2×2, centré → colonne 1..2, ligne 0..1.
  const rgba = new Uint8Array(4 * 2 * 4);
  rgba.fill(0);
  rgba[(0 * 4 + 1) * 4 + 3] = 7; // pixel (x=1,y=0) : alpha 7
  const square = cropToSquare(4, 2, rgba);
  assert.equal(square.size, 2);
  assert.equal(square.rgba[3], 7, 'le recadrage doit être centré sur les colonnes 1..2');
});

/* ------------------------------------------------------------------ */
/* Le fil : bornes d’encodage, décodage, refus                                         */
/* ------------------------------------------------------------------ */

test('fil : un PNG trop lourd pour une ligne JSON n’est jamais encodé, jamais tronqué', () => {
  const small = encodeAvatarPngForWire(new Uint8Array(PNG_1PX));
  assert.equal(typeof small, 'string');
  const huge = new Uint8Array(AVATAR_MAX_STORED_BYTES);
  huge.fill(0x41);
  assert.equal(encodeAvatarPngForWire(huge), null);
});

test('fil : le décodage rejette tout ce qui n’est pas un PNG borné', () => {
  const encoded = Buffer.from(PNG_1PX).toString('base64');
  const decoded = decodeAvatarPngFromWire(encoded);
  assert.ok(decoded !== null);
  assert.deepEqual([...decoded], [...PNG_1PX]);
  assert.equal(decodeAvatarPngFromWire(''), null);
  assert.equal(decodeAvatarPngFromWire('pas du base64 !!'), null);
  assert.equal(decodeAvatarPngFromWire('a'.repeat(64 * 1024)), null, 'au-dessus du plafond de ligne');
  assert.equal(decodeAvatarPngFromWire(Buffer.from('ceci n est pas un png').toString('base64')), null);
});

/* ------------------------------------------------------------------ */
/* Réglages : rétro-compat et patch avatar                             */
/* ------------------------------------------------------------------ */

test('réglages : un fichier sans la clé avatar (pré-amendement) se lit, avatar = null', () => {
  const withoutAvatar = JSON.parse(serializeSettings(defaultSettings())) as Record<string, unknown>;
  delete withoutAvatar.avatar;
  const result = parseSettings(withoutAvatar);
  assert.equal(result.ok, true, 'l’absence de clé est de la rétro-compat, pas une faute');
  if (result.ok) assert.equal(result.value.avatar, null);
});

test('réglages : les trois formes de l’avatar sont admises, le reste est refusé', () => {
  const base = defaultSettings();
  const gallery = applySettingsPatch(base, { avatar: 'fox' });
  assert.equal(gallery.ok, true);
  if (gallery.ok) assert.equal(gallery.value.avatar, 'fox');

  const custom = applySettingsPatch(base, {
    avatar: { kind: 'custom', file: `${'c'.repeat(16)}.png`, ref: 'c'.repeat(16) },
  });
  assert.equal(custom.ok, true);
  if (custom.ok) assert.deepEqual(custom.value.avatar, { kind: 'custom', file: `${'c'.repeat(16)}.png`, ref: 'c'.repeat(16) });

  const cleared = applySettingsPatch(base, { avatar: null });
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.equal(cleared.value.avatar, null);

  const lying = applySettingsPatch(base, {
    avatar: { kind: 'custom', file: 'mentir.png', ref: 'c'.repeat(16) },
  });
  assert.equal(lying.ok, false, 'un nom qui ment est refusé, pas corrigé');

  const wrongType = applySettingsPatch(base, { avatar: 42 });
  assert.equal(wrongType.ok, false);

  // Aller-retour sérialisation : un réglage écrit puis relu garde son avatar.
  const round = parseSettings(JSON.parse(serializeSettings(custom.ok ? custom.value : base)));
  assert.equal(round.ok, true);
});

/* ------------------------------------------------------------------ */
/* Le fil de signalisation : join + avatar_get + avatar_data           */
/* ------------------------------------------------------------------ */

interface FakeSocket extends SocketLike {
  sent: ServerMessage[];
}

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    sent: [],
    send(data: string): void {
      socket.sent.push(JSON.parse(data) as ServerMessage);
    },
  };
  return socket;
}

let clockTick = 1000;
const clock = (): number => (clockTick += 1);

/** Le pairId d'un `join` accepté (receive rend l'union `ReceiveResult` : on discrimine, pas de cast). */
function peerIdOf(result: ReceiveResult): string {
  assert.equal(result.ok, true, 'le join devait être accepté');
  assert.ok('peerId' in result && typeof result.peerId === 'string', 'un join accepté porte un peerId');
  return result.peerId;
}

test('signalisation : le join transporte l’empreinte, le hello et join la relaient', () => {
  const events: Array<{ kind: string; avatarGet?: { from: string; avatarRef: string } }> = [];
  const server = createLocalSignaling({ port: 47899, now: clock, onEvent: (e) => events.push(e as never) });
  const a = fakeSocket();
  const ca = server.handleConnection(a);
  const joinedA = ca.receive({ type: 'join', name: 'Jeanne', avatarRef: 'fox' });
  assert.equal(joinedA.ok, true);

  const b = fakeSocket();
  const cb = server.handleConnection(b);
  const joinedB = cb.receive({ type: 'join', name: 'Marc', avatarRef: 'a'.repeat(16) });
  assert.equal(joinedB.ok, true);

  // L'arrivée de B est annoncée à A avec l'empreinte de B (jamais l'image).
  const announce = a.sent.filter((m) => m.type === 'join');
  assert.equal(announce.length, 1);
  assert.deepEqual(announce[0]?.peer?.avatarRef, 'a'.repeat(16));

  // Le hello de B liste A avec son id de galerie.
  const hello = b.sent.find((m) => m.type === 'hello');
  assert.ok(hello !== undefined && hello.type === 'hello');
  assert.equal(hello.peers[0]?.avatarRef, 'fox');
  server.close();
});

test('signalisation : une empreinte hors contrat au join est une absence, pas une faute', () => {
  const server = createLocalSignaling({ port: 47898, now: clock });
  const s = fakeSocket();
  const c = server.handleConnection(s);
  const result = c.receive({ type: 'join', name: 'Marc', avatarRef: '<img src=x>' });
  assert.equal(result.ok, true, 'un avatar douteux devient une absence, le join reste valable');
  const peerId = peerIdOf(result);
  const summary = server.participants().find((p) => p.peerId === peerId);
  assert.equal(summary?.avatarRef, undefined);
  server.close();
});

test('signalisation : avatar_get est remonté au main, avatar_data répond sur la connexion du demandeur', () => {
  const events: Array<{ kind: string; avatarGet?: { from: string; to: string; avatarRef: string } }> = [];
  const server = createLocalSignaling({ port: 47899, now: clock, onEvent: (e) => events.push(e as never) });
  const a = fakeSocket();
  const ca = server.handleConnection(a);
  const ra = ca.receive({ type: 'join', name: 'Jeanne', avatarRef: 'fox' });
  const b = fakeSocket();
  const cb = server.handleConnection(b);
  const rb = cb.receive({ type: 'join', name: 'Marc', avatarRef: 'a'.repeat(16) });
  assert.equal(ra.ok && rb.ok, true);

  // A demande l'image de Marc (empreinte inconnue de A).
  const REF = 'a'.repeat(16);
  const request = ca.receive({ type: 'avatar_get', to: peerIdOf(rb), avatarRef: REF });
  assert.equal(request.ok, true);
  const asked = events.find((e) => e.kind === 'avatar-get');
  assert.ok(asked !== undefined && asked.avatarGet !== undefined);
  assert.equal(asked.avatarGet.avatarRef, REF);

  // Le main répond avec le PNG encodé : il part sur la connexion de A.
  const pngBase64 = encodeAvatarPngForWire(new Uint8Array(PNG_1PX));
  assert.ok(pngBase64 !== null);
  const answered = server.answerAvatarGet(
    { from: peerIdOf(ra), to: peerIdOf(rb), avatarRef: REF },
    pngBase64,
  );
  assert.equal(answered.ok, true);
  const data = a.sent.find((m) => m.type === 'avatar_data');
  assert.ok(data !== undefined && data.type === 'avatar_data');
  assert.equal(data.avatarRef, REF);
  assert.equal(data.pngBase64, pngBase64);

  // Une réponse « je ne connais pas » est un null honnête, pas une erreur.
  const declined = server.answerAvatarGet(
    { from: peerIdOf(ra), to: peerIdOf(rb), avatarRef: 'b'.repeat(16) },
    null,
  );
  assert.equal(declined.ok, true);
  server.close();
});

test('signalisation : une réponse trop lourde pour une ligne est refusée, jamais tronquée', () => {
  const server = createLocalSignaling({ port: 47898, now: clock });
  const a = fakeSocket();
  const ca = server.handleConnection(a);
  const ra = ca.receive({ type: 'join', name: 'Jeanne' });
  const b = fakeSocket();
  const cb = server.handleConnection(b);
  const rb = cb.receive({ type: 'join', name: 'Marc' });
  assert.equal(ra.ok && rb.ok, true);
  const failure = server.answerAvatarGet(
    { from: peerIdOf(ra), to: peerIdOf(rb), avatarRef: 'a'.repeat(16) },
    'A'.repeat(MAX_AVATAR_BASE64_CHARS + 1),
  );
  assert.equal(failure.ok, false);
  assert.equal(a.sent.filter((m) => m.type === 'avatar_data').length, 0);
  server.close();
});

test('signalisation : avatar_get vers un absent ou vers soi-même est refusé', () => {
  const server = createLocalSignaling({ port: 47898, now: clock });
  const a = fakeSocket();
  const ca = server.handleConnection(a);
  const ra = ca.receive({ type: 'join', name: 'Jeanne', avatarRef: 'a'.repeat(16) });
  assert.equal(ra.ok, true);
  const self = ca.receive({ type: 'avatar_get', to: peerIdOf(ra), avatarRef: 'a'.repeat(16) });
  assert.equal(self.ok, false, 'on ne se demande pas son propre avatar');
  const ghost = ca.receive({ type: 'avatar_get', to: 'pair-fantôme', avatarRef: 'a'.repeat(16) });
  assert.equal(ghost.ok, false, 'pas de demande vers un pair absent du salon');
  server.close();
});

test('parseClientMessage : avatar_get n’accepte que l’empreinte exacte', () => {
  assert.ok(parseClientMessage({ type: 'avatar_get', to: 'pair-1', avatarRef: 'a'.repeat(16) }));
  assert.equal(parseClientMessage({ type: 'avatar_get', to: 'pair-1', avatarRef: 'fox' }), null, 'une galerie ne se demande pas, elle est embarquée');
  assert.equal(parseClientMessage({ type: 'avatar_get', to: 'pair-1', avatarRef: 'A'.repeat(16) }), null);
});

/* ------------------------------------------------------------------ */
/* Le contrat IPC refuse un avatar hors forme                          */
/* ------------------------------------------------------------------ */

test('contrat IPC : settingsSet refuse un avatar local dont le nom ment', () => {
  const good = guardPayload('invoke', 'lan:settings:set', {
    avatar: { kind: 'custom', file: `${'d'.repeat(16)}.png`, ref: 'd'.repeat(16) },
  });
  assert.equal(good.ok, true);
  const liar = guardPayload('invoke', 'lan:settings:set', {
    avatar: { kind: 'custom', file: `${'e'.repeat(16)}.png`, ref: 'd'.repeat(16) },
  });
  assert.equal(liar.ok, false, 'file ≠ <ref>.png doit être refusé AVANT le schéma');
  const bogus = guardPayload('invoke', 'lan:settings:set', { avatar: 'hacker' });
  assert.equal(bogus.ok, false);
  const none = guardPayload('invoke', 'lan:settings:set', { avatar: null });
  assert.equal(none.ok, true);
});

test('contrat IPC : avatarGetImage n’accepte que l’empreinte sous son nom exact', () => {
  const ok = guardPayload('invoke', 'lan:avatar:get-image', { avatarRef: 'a'.repeat(16) });
  assert.equal(ok.ok, true);
  assert.equal(guardPayload('invoke', 'lan:avatar:get-image', { avatarRef: 'fox' }).ok, false);
  assert.equal(guardPayload('invoke', 'lan:avatar:get-image', {}).ok, false);
  assert.equal(guardPayload('invoke', 'lan:avatar:get-image', { avatarRef: 'a'.repeat(16), extra: 1 }).ok, false);
});
