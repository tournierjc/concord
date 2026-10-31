# VERIF-007 — Delta : `ReceiveAccepted` honnête, confirmé par exécution

**Date** : 2026-10-31, mesures entre 01:07:39Z et 01:08:48Z (UTC)
**Auteur** : Banc (desk-qa) — contrôle indépendant
**Objet** : vérifier le correctif annoncé par desk-engine à 01:02:54Z (`ReceiveAccepted` = union honnête)
et lever/confirmer mon point ouvert du rapport VERIF-006 (« `ReceiveAccepted` reste malhonnête côté engine »).
**Canon mesuré** : `/work/lan-voice` (pas de dépôt git sur ce canon — aucune commande git utilisée).
**Environnement** : node v22.23.4, typescript 5.9.3 (`tsc --version` → `Version 5.9.3`), tsx via `npx --no-install tsx`.

## Verdict

**Point levé. L'annonce de desk-engine est exacte, et je l'ai reproduite par exécution, pas par lecture.**

- `ReceiveAccepted` est bien `JoinSuccess | RelaySuccess | LeaveSuccess` (src/engine/net/local-signaling.ts:269).
- Les quatre retours `{ ok: true … }` de l'implémentation tombent un pour un dans l'union, mesurés au
  runtime sur le moteur réel (section 2).
- La garde `'peerId' in result` de mon test n'est pas un contournement : c'est la discrimination prévue
  par le type. Contrôle négatif à l'appui (section 3).
- Mon commentaire périmé (L92-94) est corrigé, et le test est **renforcé** : il lit désormais le `peerId`
  rendu par `receive()` et vérifie qu'il est identique à celui de la connexion (section 4).
- `tsc --noEmit -p tsconfig.json` → EXIT=0, 0 diagnostic ; suite 378/378 pass (section 5).

Une seule nuance à l'argumentaire de desk-engine : dans le contrôle négatif, `'peerId' in accepted` sur
l'ancien type `{ ok: true }` ne réduit pas à `never` (TS 5.9.3 laisse le type `{ ok: true }` et l'accès
`.peerId` rend `unknown`). Le symptôme est donc **TS2322 `Type 'unknown' is not assignable to type 'string'`**,
pas une réduction à `never` (mesure exacte en section 3). Le fond de la démonstration est inchangé : la
garde ne compile que sur l'union honnête.

## 1. État du type au moment de la mesure — 01:07:39Z

```
$ cd /work/lan-voice && grep -n "ok: true" src/engine/net/local-signaling.ts
238:  ok: true
246:  ok: true
254:  readonly ok: true
514:      return { ok: true, peerId: state.peerId, name: existing === undefined ? '' : existing.name }
549:    return { ok: true, peerId, name }
644:    return { ok: true, delivered: [to] }
668:      return { ok: true }
```

Les lignes 238/246/254 sont les déclarations de type (`JoinSuccess`, `RelaySuccess`, `LeaveSuccess`) ;
les quatre retours effectifs sont donc 514, 549, 644, 668 — exactement la liste annoncée par desk-engine,
et non plus « L499/L534 » comme dans mon relevé précédent (décalage de lignes dû à l'écriture du type).

```
$ sed -n 265,272p src/engine/net/local-signaling.ts
 * Ce qui n'est pas dans l'union n'est pas rendu, et ce qui est rendu y est :
 * l'appelant discrimine par `result.ok` puis, pour le détail, par la présence
 * du champ (`'peerId' in result`, `'delivered' in result`) — sans …
269:export type ReceiveAccepted = JoinSuccess | RelaySuccess | LeaveSuccess
```

## 2. Forme des retours mesurée au runtime, sur le moteur réel — 01:08:40Z et 01:08:47Z

Sonde dans mon sandbox, important le module du canon par chemin absolu, exécutée depuis `/work/lan-voice` :

```
$ cd /work/lan-voice && npx --no-install tsx .../sandbox/probe/engine-shape.ts
join  -> {"ok":true,"peerId":"p1","name":"eve"}      # JoinSuccess      ← L549
conn  -> {"peerId":"p1"}
rejoin-> {"ok":true,"peerId":"p1","name":"eve"}      # JoinSuccess idempotent ← L514
relay -> {"ok":false,"code":"invalid-message",…}     # entrée invalide, non concluant
leave -> {"ok":true}                                 # LeaveSuccess     ← L668
EXIT=0
```

Le relais a été re-mesuré séparément avec deux connexions jointes (le relais passe par `server.relay`,
pas par `receive`) :

```
$ cd /work/lan-voice && npx --no-install tsx .../sandbox/probe/engine-relay.ts
relay -> {"ok":true,"delivered":["p2"]} deliveredOk= true   # RelaySuccess ← L644
bobRecu= 2 aliceRecu= 2
EXIT=0
```

Les quatre retours de l'implémentation portent donc, à l'exécution, les champs que déclarent les quatre
branches de l'union. Aucune branche de l'union n'est un fourre-tout.

## 3. Contrôle positif / négatif de la garde — 01:07:56Z → 01:07:57Z

Deux fichiers de 6 lignes de code utile, même fonction, même garde, seul le type change :

```
$ /work/lan-voice/node_modules/.bin/tsc --noEmit --strict --target ES2022 honest.ts
EXIT_honest=0
$ /work/lan-voice/node_modules/.bin/tsc --noEmit --strict --target ES2022 dishonest.ts
dishonest.ts(6,9): error TS2322: Type 'unknown' is not assignable to type 'string'.
EXIT_dishonest=2
```

`honest.ts` : `ReceiveAccepted = JoinSuccess | RelaySuccess | LeaveSuccess` → compile, `result.peerId`
est typé `string`. `dishonest.ts` : `ReceiveAccepted = { ok: true }` → **refusé**. La garde est donc
discriminante : elle n'aurait pas compilé sur l'ancien type.

Non-vacuité au runtime (même fichier, exécuté) — 01:08:33Z :

```
$ cd /work/lan-voice && npx --no-install tsx .../sandbox/probe/runtime-guard.ts
JoinSuccess -> p-1
RelaySuccess -> REFUS: retour sans peerId
LeaveSuccess -> REFUS: retour sans peerId
EXIT=0
```

## 4. Correction du test — tests/local-signaling.test.ts L85-103

Avant (ce que j'avais laissé en T11) : `peerId` lu sur `harness.connection.peerId`, avec un commentaire
expliquant que `ReceiveAccepted` « ne déclare pas encore `peerId` » — vrai avant 01:02:54Z, faux depuis.
Après :

```ts
  const result = harness.connection.receive({ type: 'join', name })
  assert.equal(result.ok, true, `join(${name}) doit réussir`)
  if (!result.ok) throw new Error('inatteignable')
  // `ReceiveAccepted` est l'union `JoinSuccess | RelaySuccess | LeaveSuccess` :
  // on discrimine le détail par présence du champ, jamais par cast. Un « join »
  // accepté doit porter `peerId` dans son retour, et ce `peerId` doit être
  // celui que la connexion a retenu.
  if (!('peerId' in result)) {
    throw new Error(`join(${name}) accepté mais le retour de receive() ne porte pas de peerId`)
  }
  const peerId = result.peerId
  assert.equal(harness.connection.peerId, peerId, 'le peerId rendu est celui de la connexion')
  return { ...harness, peerId }
```

Ce n'est pas un simple dépoussiérage de commentaire : le retour de `receive()` est maintenant **asserté**
(présence de `peerId`, égalité avec l'identité retenue par la connexion), au lieu d'être ignoré. Un moteur
qui répondrait `{ ok: true }` nu, ou `RelaySuccess`, sur un `join` fait échouer le test.

## 5. Mesures d'ensemble après la retouche — 01:07:48Z et 01:08:21Z

```
$ cd /work/lan-voice && npx tsc --noEmit -p tsconfig.json        # 01:07:48Z → 01:07:49Z
EXIT=0                                   # 0 diagnostic, 0 octet

$ cd /work/lan-voice && npx tsx --test tests/*.test.ts           # 01:08:21Z → 01:08:22Z
# tests 378
# suites 15
# pass 378
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 182.925047
EXIT=0
```

Les 378 tests incluent le test renforcé de la section 4 : il s'exécute, il passe, et il échouerait sur
un retour non-`JoinSuccess`.

## 6. Inventaire des `as` / `!` / `ts-ignore` — correction de mon propre rapport

Mon compte-rendu T11 disait « zéro `as`/`!`/`ts-ignore` » pour les trois fichiers que j'avais corrigés.
C'est vrai pour les `!` et les suppressions de diagnostic, mais **imprécis pour les `as`**. Relevé exact
(`grep -nE "(^|[^a-zA-Z0-9_])as [A-Za-z{]|@ts-ignore|@ts-expect-error|!\."` sur les trois fichiers) :

| Fichier | `!` non-null | `@ts-ignore`/`@ts-expect-error` | `as` restants |
|---|---|---|---|
| tests/gain.test.ts | 0 | 0 | 0 (hors `as const`) |
| tests/room.test.ts | 0 | 0 | `as const` ×3 ; `as never` ×2 (L168, L175 — entrées volontairement invalides) |
| tests/local-signaling.test.ts | 0 | 0 | `as ServerMessage` ×1 (L65, `JSON.parse` frontière) |

Les `as never` sont intentionnels (on teste la robustesse du dispatcher à une entrée invalide) ; le
`as ServerMessage` est un cast de frontière sur `JSON.parse`, antérieur à mes retouches. Aucun des trois
ne porte sur `ReceiveAccepted` ni sur un `peerId`. Je ne les ai pas retirés : les remplacer demanderait
un validateur de message que rien ne couvre aujourd'hui — le faire sans test serait pire que le cast.

## 7. Non vérifié dans ce delta (nommé comme tel)

- La preuve de desk-engine `check-accepted.ts` (leur sandbox) : **accès refusé** de mon côté
  (`No permission to access …/desk-engine/sandbox`). Je ne l'ai donc pas relue ; j'ai refait les contrôles
  équivalents (§2, §3) avec mes propres sondes.
- `tsconfig.main.json`, build Vite, wrapper `npm test` : non re-mesurés ici (couverture inchangée depuis
  VERIF-006). `npx tsx --test` est ma mesure de référence, `npm test` n'a pas été exécuté dans ce run.
- Runtime Electron : hors périmètre de ce delta (aucune mesure graphique/audio).

## 8. Conclusion

`ReceiveAccepted` n'est plus un type malhonnête : le type, les quatre retours et le consommateur sans cast
concordent, et c'est vrai à la compilation **et** à l'exécution. Mon point 3 de VERIF-006 est **fermé**.
Le seul reste de ma part — le commentaire de tests/local-signaling.test.ts — est corrigé et le test
renforcé. Rien d'ouvert côté typage.
