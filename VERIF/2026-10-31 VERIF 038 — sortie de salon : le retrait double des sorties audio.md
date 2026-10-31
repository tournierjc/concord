# VERIF 038 — quitter le salon pouvait laisser le micro ouvert et les connexions vivantes

Date de la campagne : **2026-10-31**, mesures entre **20:22Z et 20:24Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/audio-sink-leave` coupée de `origin/main`.
Hôte Linux `aarch64`, `node v26.5.1`, `npm 11.17.0`, `tsx 4.23.15`.

**Défaut mesuré.** `src/renderer/audio-sink.ts:118-125` retirait chaque sortie **deux fois** :

```ts
if (typeof sink.element.remove === 'function') sink.element.remove();   // détache déjà le nœud
host.remove(sink.element);                                              // → body.removeChild(node)
```

Sur un vrai DOM, le second geste lève `NotFoundError: Failed to execute 'removeChild' on 'Node'`
(`documentSinkHost.remove`, `audio-sink.ts:72-74`). Or `src/renderer/voice.ts:469` appelle
`current.link.sinks.clear()` **hors de tout `try`**, avant `current.wire.close()` (`:477`) :

1. la 1ʳᵉ exception interrompt `clear()` → l'élément suivant n'est jamais retiré et **les `<audio>`
   restants continuent de jouer** ;
2. `current.link.peers.clear()`, `plane.setTransmitting(false)` puis **`wire.close()` ne sont jamais
   atteints** : micro toujours ouvert, `RTCPeerConnection` toujours vivantes. « Quitter le salon »
   laissait l'application en train d'écouter.

Le faux DOM de `tests/audio-sink.test.ts` ne levait pas (`element.remove()` se contentait de marquer
le nœud, `host.remove` était vide) : le défaut était invisible en test.

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/renderer/audio-sink.ts` | `remove()` fait **un seul** geste de retrait : `element.remove()` s'il existe, sinon `host.remove()` ; l'entrée sort du registre **avant** le retrait DOM ; `clear()` isole chaque retrait (un nœud refusé n'interrompt plus la boucle) et documente pourquoi |
| `src/renderer/voice.ts` | `closeVoice()` : `sinks.clear()`/`peers.clear()` dans un `try`, puis `wire.close()` dans son propre `try` — aucune étape ne peut plus empêcher la fermeture du micro ; `suspendVoice()` (reconnexion) reçoit le même isolement |
| `tests/audio-sink.test.ts` | + 3 tests, avec un faux DOM qui se comporte comme Chromium |

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/audio-sink.test.ts` | 11 tests, 11 pass, exit=0 | ✅ |
| `npm test` | **26 fichiers · 667 tests · 667 pass · 0 fail · 49 suites · 5 242 ms** (`20:23:21→20:23:26Z`), rejoué `20:23:32→20:23:37Z` mêmes comptes | ✅ |
| `npx tsc -p tsconfig.json --noEmit` | exit=0 | ✅ |
| `npm run build` | exit=0 | ✅ |
| `sh VERIF/run-all.sh` | `LAN-VOICE VERIF RESULT=PASS` | ✅ |

Ce que les nouveaux tests figent :
1. **un seul retrait** : avec un DOM où `removeChild` sur un nœud détaché lève, `remove('p2')` ne
   lève pas et `hostRemovals()` reste à **0** (l'hôte n'est pas sollicité après un `element.remove()`
   réussi) — c'est la garde du défaut ;
2. chemin de repli : des éléments **sans** `remove()` passent par `host.remove`, un retrait par
   élément (2 pour 2 sorties, jamais 4) et le `body` se vide ;
3. `clear()` **n'est pas interrompu** par un retrait refusé : les trois retraits sont tentés, le
   registre est vidé (`list()` = 0) et rien ne lève — la décision de quitter le salon ne peut plus
   être annulée par le DOM.

## 3. Non vérifié, nommé

- **Aucune mesure dans un vrai moteur** : Chromium n'est pas lancé (pas de binaire Electron
  exécutable ici, `libgtk-3.so.0` absent). Ce qui est mesuré est le comportement du registre contre
  un faux DOM qui reproduit la sémantique de `removeChild` de Chromium — lu dans la spécification
  DOM, pas observé dans un moteur.
- `src/renderer/voice.ts` **n'est pas importable en test** (il importe React) : le `try` ajouté
  autour de `sinks.clear()`/`wire.close()` n'a pas de test propre, c'est une défense en profondeur
  justifiée par lecture. La cause première, elle, est testée à l'endroit où elle vivait
  (`audio-sink.ts`), et c'est cette correction qui rend le chemin non-levant.
- Le micro réel (`getUserMedia`) n'est pas mesuré : dire « le micro est fermé » demanderait un poste
  avec caméra/micro et un moteur réel. Ce qui est prouvé est que `wire.close()` **n'est plus
  sautable** par une exception du DOM.
- Les autres chemins de sortie (`suspendVoice`, reconnexion) sont traités de la même façon mais
  mesurés seulement par `voice-mesh.node.test.ts` (ordre mesh → plan), pas par ce fichier.
