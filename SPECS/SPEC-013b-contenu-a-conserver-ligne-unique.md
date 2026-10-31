# SPEC-013b — Contenu à conserver : la ligne unique de participant

Maquette (desk-design) · 2026-10-31 · **T23 étape A**, bloquant pour Cadre
Répond à Régie (arbitrage **AD-20**, SPEC-014 §1 **D3**, exécution dans le feu T23 étape A). Références : SPEC-014 (AD-20 D1–D5),
**AD-19 D1/D2** (canal `lan:speaking-set`, un seul espace d'id), **SPEC-013 §2** (R-U1..R-U8,
normatif, repris tel quel), **SPEC-010 §3** (matrice palier → libellé, un seul libellé à la fois),
**AD-17 D2** (l'annuaire ne mesure rien), `Room.tsx` (état mesuré le 2026-10-31), `styles.css`,
`design/i18n/fr.json` + `design/i18n/en.json`.

Portée : **aucune ligne de code, aucune clé i18n nouvelle, aucun texte nouveau.** Cette page est la
liste de contrôle de la fusion des deux listes de participants en une seule ligne par personne. Elle
ne planifie pas le diff (T22) et ne l'écrit pas (T23) : elle dit ce qui doit se retrouver dans la
ligne unique, information par information, pour que Cadre n'ait rien à deviner.

---

## 0. Comment s'en servir

1. Chaque information portée aujourd'hui par la première liste a **une destination nommée** (§2) et
   **une règle de composition** (§3). Les deux cas limites qui n'existent pas dans la première liste
   sont traités à part : pair sans annuaire (§4), ligne « soi » (§5).
2. Si une ligne du diff ne correspond à aucune entrée de §2/§3, c'est un ajout non arbitré : on
   s'arrête et on remonte, plutôt que d'inventer.
3. Tout est vérifiable sans React installable : lecture de l'arbre (`grep`, lignes citées) + DOM rendu
   par le harnais de Banc (§9). Aucun de ces contrôles n'exige d'écrire du code ici.

---

## 1. État mesuré des deux listes (au 2026-10-31)

| | **Liste 1 — signalisation** | **Liste 2 — annuaire** |
|---|---|---|
| Lignes | `Room.tsx` **131-160** | `Room.tsx` **162-216** (`<li>` 172-213, curseur de gain 197-212) |
| Source | `voice.peers` (`VoiceSnapshot`, `voice.ts:95`), alimenté par les liens du maillage | `participants` (props, annuaire du salon) |
| Garde de rendu | `voice.peers.length > 0` (l.131) | **aucune** : rendue en toutes circonstances |
| État vide voisin | — (la disparition de la liste suffisait) | Bloc `room.empty.*` affiché si `participants.length <= 1` (**l.218-223**) : condition à reprendre, voir **F9** |
| `<ul>` | `className="participants"`, `aria-label={t('voice.peers.title')}`, `data-voice="peers"` (l.132) | `className="participants"`, **sans** `aria-label`, **sans** `data-voice` (l.162) |
| `<li>` | `key={peer.peerId}`, `className="participant"` (l.134-136) | `key={participant.id}`, `className="participant"` (l.172-174) |
| Attributs | `data-peer-id`, `data-peer-state`, `data-peer-cause`, `data-peer-stream`, `data-speaking` (l.137-141) | `data-speaking`, `data-muted`, `data-self` (l.175-177) |
| Contenu | avatar (initiales), nom, **un** libellé d'état (l.143-156) | avatar, **halo** (l.182), nom + badge « Vous », état `joinStates` (4 fragments), curseur de gain |
| Ne porte pas | halo, badge « Vous », `data-self`, `data-muted`, gain | les quatre `data-peer-*`, le libellé audio du plan média |

Repère de lecture : AD-20 cite `:135-158` et `:160-196`. Mesures de cette page, sur le fichier tel
qu'il est : le `<li>` de la liste 1 va de 134 à 157, la liste 1 entière de 131 à 160, la liste 2 de 162
à 216 (le curseur de gain 197-212). Les fourchettes d'AD-20 sont donc des ancres approximatives ; c'est
sans effet ici parce que **chaque information est citée par sa ligne ET par son texte**, jamais par un
numéro seul. Cette page prend la **liste 1 entière** (131-160) pour ne rien laisser hors champ : le
`<ul>`, sa garde et son `aria-label` décident des sélecteurs du harnais autant que les attributs de
ligne.

Deux faits qui commandent toute la fusion :

- **Ordre de la liste 1** = ordre de `mesh.peers()`, trié par id (`mesh.ts:581-583`), donc **jamais
  soi** : la table des liens ne contient que des pairs distants. L'**ordre de la liste 2** est l'ordre
  de l'annuaire, et elle **contient soi**.
- Les deux listes emploient **la même** classe `.participants` / `.participant` (`styles.css:318-336`)
  et le **même** module d'état (`participant-state.ts`, dont l'en-tête de `PEER_LEVELS` dit déjà « id
  de signalisation ou id de participant : c'est le même espace », `participant-state.ts:59-61`). La
  fusion ne demande donc **aucune règle CSS nouvelle et aucune table de correspondance d'id** : elle
  demande de choisir, pour chaque information, où elle atterrit.

---

## 2. Inventaire de la première liste — information par information

Une ligne = une information portée par `Room.tsx:131-160` aujourd'hui, sa destination, et ce qui doit
être vrai après fusion. Rien d'autre n'est porté par cette liste : ce tableau est exhaustif.

| # | Information (ligne d'origine) | Destination dans la ligne unique | Ce qui doit être vrai après fusion |
|---|---|---|---|
| 1 | **La liste elle-même** : un `<ul class="participants">` (l.132) affiché seulement si `voice.peers.length > 0` | Le `<ul class="participants">` de la liste 2 (l.162), qui devient **le seul** | Un seul `<ul class="participants">` dans l'écran salon. **Rendu inconditionnel** (statu quo de la liste 2 : elle contient toujours soi une fois joint). La garde `voice.peers.length > 0` disparaît avec la liste 1 ; **aucun état vide n'est inventé** (pas de clé, pas de texte) : celui qui existe (l.218-223) est **réutilisé** et sa condition repassée sur la liste unie (F9). |
| 2 | **`aria-label={t('voice.peers.title')}`** = « Pairs distants » / « Remote peers » (l.132) | **Supprimé** — pas déplacé | Le `<ul>` fusionné n'a **pas** d'`aria-label`. Motif : la liste contient désormais soi-même ; l'annoncer « Pairs distants » serait un libellé faux pour la ligne de l'utilisateur. La liste 2 n'en avait pas : rien n'est perdu. La clé `voice.peers.title` **reste dans les deux fichiers i18n** (on ne supprime pas de clé : ce serait une modification de contrat pour zéro bénéfice écran) et devient inutilisée — c'est dit ici une fois pour toutes. |
| 3 | **`data-voice="peers"`** (l.132) | Conservé **tel quel** sur le `<ul>` fusionné | Valeur conservée mot pour mot (nom historique). Aucun consommateur dans le dépôt (`styles.css` n'utilise que `data-voice-status`, l.433-443), donc ce sont les sélecteurs externes — harnais de Banc, vérifs — qui en dépendent. **Renommer = casser un harnais sans gain écran : interdit ici.** Sa portée change (il désigne maintenant toute la liste, soi compris) : consigné, pas renommé. |
| 4 | **`key={peer.peerId}`** (l.135) | `key` de la ligne unique = **l'id**, point | Une seule clé React par personne, dans l'espace d'id unique (AD-19 D2). Conséquence voulue : quand un pair passe de « présent en signalisation, absent de l'annuaire » à « présent dans l'annuaire » (§4), **la clé ne change pas** → pas de remontage, le halo et la transition de 80 ms survivent au passage. |
| 5 | **`className="participant"`** (l.136) | Inchangé | Même classe que la liste 2 : la ligne unique hérite du même gabarit (`styles.css:327-336`), du même halo et du même badge de mute. Aucune variante de classe pour « pair sans annuaire ». |
| 6 | **`data-peer-id={peer.peerId}`** (l.137) | Sur **chaque** ligne, valeur = l'id de la personne, **soi compris** | C'est l'identité de ligne pour le harnais. Après fusion : `data-peer-id` présent sur **toutes** les lignes (`li[data-peer-id]`), valeur = id de signalisation = id d'annuaire = `room.selfId` pour soi. Corollaire à répercuter côté Banc : **« N pairs » = lignes dont `data-self="false"`**, pas `li[data-peer-id]` (voir ACb-2 et §9). |
| 7 | **`data-peer-state={peer.state}`** (l.138), domaine `connecting \| connected \| noFlow \| failed` (`mesh.ts:85`) | Sur chaque ligne, avec **une valeur de plus** : `unknown` | Ligne avec entrée de signalisation : l'état du maillage, inchangé. Ligne **sans** entrée (annuaire seul, et soi) : `data-peer-state="unknown"`. Une seule valeur ajoutée, **aucune clé i18n, aucun texte** : `unknown` ne produit aucun libellé (§3 F6), exactement comme R-U1/R-U2 de SPEC-013. Motif du choix « attribut présent avec sentinelle » plutôt qu'« attribut omis » : un harnais qui itère les lignes lirait `undefined` sur les lignes sans entrée — c'est le trou par lequel la fusion redeviendrait invisible. |
| 8 | **`data-peer-cause={peer.cause ?? 'none'}`** (l.139), domaine `ice \| timeout \| sink` + `none` (`mesh.ts:82`) | Sur chaque ligne ; `none` pour une ligne sans entrée | Aucune nouvelle valeur. `none` est déjà le défaut écrit par la liste 1 quand la cause est absente : le réutiliser n'ajoute rien au domaine. Jamais rendu en texte (SPEC-010 §3). |
| 9 | **`data-peer-stream={peer.hasStream ? 'true' : 'false'}`** (l.140) | Sur chaque ligne ; **`false`** pour une ligne sans entrée | `true`/`false` seulement, pas de troisième valeur (un harnais compare à `'true'`). Ligne sans entrée → `false` : c'est l'identité de rendu de R-U1 (`unknown` ≡ `false`), et cela n'affirme rien de faux puisque rien n'est mesuré. Aucun consommateur CSS aujourd'hui (constat : aucune occurrence de `peer-stream` dans `styles.css`) : **on migre l'attribut, on ne branche rien de neuf**. |
| 10 | **L'intention écrite l.104-106** : « état du TUYAU, puis celui de chaque pair distant ; un pair dont aucun flux n'arrive est annoncé « muet », et aucun anneau ne tourne sur du vide — l'anneau n'est branché que sur `data-peer-stream="true"` » | Commentaire **conservé et ré-ancré** sur le bloc fusionné | Le commentaire suit le bloc qu'il décrit, avec ses numéros de ligne mis à jour. C'est le seul document de la sémantique de `data-peer-stream` : il ne se perd pas dans la fusion, et il n'est pas réécrit. |
| 11 | **`data-speaking={peerSpeaking(peer.peerId, PEER_LEVELS, speakingClock)}`** (l.141) | Inchangé dans son principe, **une seule écriture par ligne** | Une ligne = un `data-speaking`, écrit par **un seul** helper qui aiguille : soi → `selfSpeakingAttr(voice.status === 'live', selfSpeaking)` (l.168-169), tout autre → `peerSpeaking(id, PEER_LEVELS, speakingClock)`. Jamais `participant.speaking` (AD-17 D2). Jamais de `false` par défaut quand rien n'est mesuré : `unknown` (R-U1), et le halo reste monté (l.182) avec un rendu indiscernable de `false`. |
| 12 | **Avatar** : `<span class="participant__avatar" aria-hidden="true">` + `initials(peer.name ?? peer.peerId)` (l.143-145) | Le même span, avec `initials(nom affiché)` | Les initiales se calculent **sur le nom affiché**, pas sur l'id quand un nom existe. `initials` (`Room.tsx:38-41`) prend les deux premiers mots, ne casse pas sur une chaîne sans espace et retombe sur `?` : un id de signalisation passé en nom (cas §4) **ne produit donc ni exception ni case vide**. |
| 13 | **Nom** : `<span class="participant__name">{peer.name ?? peer.peerId}</span>` (l.146) | Le nom de la ligne unique, avec **la règle des deux niveaux** | Niveau 1 : le nom d'annuaire. Niveau 2, seulement s'il n'y a pas d'entrée d'annuaire : **l'id de signalisation, affiché tel quel** (pas de troncature, pas de « … », pas de « participant inconnu »). C'est la règle actuelle de la liste 1, reprise mot pour mot ; elle est la seule source de nom pour un pair absent de l'annuaire (§4). |
| 14 | **Le libellé d'état** : `<span class="participant__state">` + un seul des cinq textes (l.147-156) | **Dernier fragment de `joinStates`** de la ligne unique, à la place du texte de connexion de l'annuaire | Voir F6 (§3) : matrice inchangée (SPEC-010 §3), **un seul** libellé à la fois, **il remplace** `participant.iceFailed`/`participant.iceRetrying` quand une entrée de signalisation existe ; **sans** entrée, il est absent et le fragment reste celui de l'annuaire. Aucun sixième libellé, aucun libellé pour `unknown`. |
| 15 | **Ce que la liste 1 ne porte pas** : halo, badge « Vous », `data-self`, `data-muted`, curseur de gain | La ligne unique les reçoit **de la liste 2** | La fusion est **ascendante en richesse** : la ligne unique = toutes les informations de la liste 2 + les attributs et le libellé audio de la liste 1. Aucune ligne ne perd un contrôle qu'elle avait. |

Le détail du libellé d'état (information 14), matrice SPEC-010 §3 conservée telle quelle :

| `data-peer-state` | `data-peer-stream` | Libellé (clé existante) |
|---|---|---|
| `connecting` | — | `voice.peer.connecting` — « Connexion audio… » |
| `connected` | `true` | `voice.peer.audio` — « Audio reçu » / « Audio received » |
| `connected` | `false` | `voice.peer.pending` — « Audio en attente… » / « Waiting for audio… » |
| `noFlow` | — | `voice.peer.noFlow` — « Pas de flux audio » |
| `failed` | — | `voice.peer.failed` — « Audio échoué » |
| `unknown` | — | **aucun libellé** (R-U2 : on n'ajoute pas de texte) |

---

## 3. Règles de composition (les neuf décisions de la fusion)

**F1 — Une seule liste, une seule ligne par id.** La ligne unique est l'union, indexée par id, de
`participants` (annuaire, soi compris) et de `voice.peers`. Ordre : **l'ordre de l'annuaire d'abord**,
puis les pairs présents en signalisation et absents de l'annuaire, **dans l'ordre de `voice.peers`**
(déjà trié par id). *Motif :* ne pas re-trier une liste que l'utilisateur connaît ; la ligne de soi ne
bouge pas. *Ne pas faire :* concaténer deux tableaux (donne deux lignes par pair — le mensonge visible
que la fusion supprime), ni trier par nom (déplace la ligne de soi à chaque changement d'annuaire).

**F2 — L'espace d'id est unique (AD-19 D2).** Id de signalisation = id d'annuaire = `room.selfId` pour
soi. Aucun drapeau `self` dans les données, aucune table de correspondance, aucun préfixe. *Ne pas
faire :* clé composite `type:id` ou préfixe `peer:` / `member:` : deux personnes deviendraient deux
lignes.

**F3 — Un seul prédicat d'identité.** `isSelf` = (id de la ligne === `room.selfId`), calculé une fois
par ligne et utilisé pour **quatre** choses exactement : `data-self`, le badge « Vous »
(`participant.you`), la source de `data-muted` (valeur réelle pour soi, `unknown` pour tout autre,
`participant-state.ts:88-91`), et l'aiguillage de `data-speaking` (information 11). *Ne pas faire :*
comparer l'id à `localId`, à un `selfId` de snapshot de voix, ou au nom : quatre vérités différentes
finissent par diverger.

**F4 — Nom en deux niveaux.** Nom d'annuaire, sinon id de signalisation affiché tel quel ;
initiales calculées sur le nom affiché. Voir information 13 et §4.

**F5 — Les quatre `data-peer-*` sur chaque ligne, sans exception.** Y compris sur la ligne de soi et sur
les lignes sans entrée de signalisation, avec les valeurs du tableau ci-dessous. Une seule valeur
nouvelle dans tout le contrat : `unknown` pour `data-peer-state`. *Motif :* un harnais doit pouvoir
itérer toutes les lignes sans rencontrer d'attribut manquant ; c'est la condition pour que la fusion
soit **vérifiable** et pas seulement jolie. *Ne pas faire :* omettre les attributs « là où ça n'a pas de
sens » (trou de vérification), ni écrire `connected` par défaut (affirmation non mesurée).

**F6 — Le libellé d'état : un seul à la fois, à la place du texte de connexion.** Dans le
`joinStates` de la ligne unique, **l'ordre existant de la liste 2 est conservé** et le 4ᵉ fragment
devient :

| Cas de la ligne | 4ᵉ fragment de `joinStates` |
|---|---|
| Entrée de signalisation présente (pair du maillage) | **le libellé audio** (matrice §2), et **pas** `participant.iceFailed` / `participant.iceRetrying` |
| Pas d'entrée de signalisation (annuaire seul, et soi) | **exactement** ce que la liste 2 affiche aujourd'hui : `iceFailed` si `connection === 'failed'`, `iceRetrying` sinon quand `connection !== 'connected'`, rien si `connected` |

Compatible avec SPEC-013 **AC-U5** (« un pair `unknown` dont `state ≠ connected` affiche son texte de
liaison ») : cette règle ne supprime aucun texte de liaison, elle choisit **lequel** des deux est dit
quand les deux sources parlent du même fait. *Motif :* deux textes de transport sur la même ligne
produiraient soit un doublon (« Audio échoué · Connexion impossible »), soit une contradiction visible (« Connexion audio… » à côté de « Connexion
impossible ») ; la source mesurée sur le transport réel (maillage) est la plus fraîche et gagne
(AD-17 D2 : ce qui est mesuré bat ce qui est déclaré). *Ne pas faire :* empiler les deux, ni garder le
texte d'annuaire et reléguer le libellé audio en second. Les trois premiers fragments (`Muet`,
`Sourdine`, `parle`) et leur ordre ne changent pas.

**F7 — Les contrôles ne s'inventent pas.** Halo : monté sur **toutes** les lignes, jamais conditionné
au flux ni à la mesure (R-U1), inséré entre l'avatar et le nom — il est en position absolue
(`styles.css:351-360`), donc son ajout sur les lignes issues de la liste 1 **ne déplace rien**. Curseur
de gain : seulement sur une ligne qui a un `ParticipantDto` (donc pas sur un pair sans annuaire, §4) ;
pas de curseur désactivé ni de valeur par défaut inventée. Son étiquette accessible `visually-hidden`
(« Volume — nom », clé `participant.volume`, l.197-200) **suit le curseur** : présente avec lui, absente
sans lui — jamais de curseur sans nom accessible. Badge de mute : `unknown` pour tout pair,
donc **pas de pastille** (SPEC-010 §4) ; il n'apparaît que sur soi.

**F8 — Zéro clé, zéro texte, zéro CSS.** Aucune clé ajoutée dans `design/i18n/fr.json` ni
`design/i18n/en.json` ; `voice.peers.title` reste dans les fichiers mais n'est plus utilisée ; les cinq
clés `voice.peer.*` et les clés `participant.*` existantes suffisent. Aucune règle CSS nouvelle : la
ligne unique est une `.participant` ordinaire.

**F9 — L'état vide suit la liste unie, pas l'annuaire.** Le bloc « Le salon est vide / Plus personne
n'est connecté » (l.218-223, clés `room.empty.title` / `room.empty.body`, **textes inchangés**) n'est
affiché que si la liste unie ne contient **aucune ligne dont `data-self="false"`**. *Motif :* sa
condition actuelle (`participants.length <= 1`) compte l'annuaire ; un pair présent en signalisation et
pas encore dans l'annuaire ferait donc afficher « Le salon est vide » **sous une liste qui montre ce
pair** — mensonge visible, et exactement le genre d'oubli que la fusion doit fermer. *Ne pas faire :*
garder `participants.length`, ni compter `voice.peers` à part : une seule source, la liste unie.

Tableau de vérité des attributs de ligne après fusion (F3/F5) :

| Type de ligne | `data-peer-id` | `data-peer-state` | `data-peer-cause` | `data-peer-stream` | `data-self` | `data-muted` | `data-speaking` | Libellé audio |
|---|---|---|---|---|---|---|---|---|
| Pair avec entrée de signalisation | son id | `connecting`/`connected`/`noFlow`/`failed` | `ice`/`timeout`/`sink`/`none` | `true`/`false` | `false` | `unknown` | `peerSpeaking` | oui (1 des 5) |
| Pair sans entrée (annuaire seul) | son id | `unknown` | `none` | `false` | `false` | `unknown` | `peerSpeaking` (= `unknown` sans échantillon) | non |
| Soi | `room.selfId` | `unknown` | `none` | `false` | `true` | `true`/`false` (réel) | `selfSpeakingAttr` | non |

---

## 4. Cas : un pair présent dans `voice.peers` mais absent de l'annuaire

C'est le cas qui n'a **aucune** existence dans la première liste autre que son propre `<li>`, et c'est
donc celui où Cadre pourrait le plus facilement deviner. La ligne existe quand même, et voici son
contenu complet :

| Élément de la ligne | Valeur |
|---|---|
| Position | Après toutes les lignes d'annuaire, dans l'ordre de `voice.peers` (id croissant) |
| `key` / `data-peer-id` | l'id de signalisation (identique à celui qui arrivera dans l'annuaire) |
| Avatar | initiales calculées sur l'id (`initials` ne casse pas : `?` au pire) |
| Nom | **l'id de signalisation, tel quel** (F4) |
| Badge « Vous » | non (`data-self="false"`) |
| Halo | monté, éteint tant que `data-speaking` vaut `unknown` |
| `data-speaking` | `peerSpeaking` : `unknown` sans échantillon, valeur réelle dès qu'un échantillon arrive |
| Les quatre `data-peer-*` | ceux du maillage (première ligne du tableau de vérité §3) |
| `data-muted` | `unknown` → aucune pastille |
| Curseur de gain | **absent** (aucun `ParticipantDto` : rien à écrire, donc rien à montrer) |
| Libellé d'état | le libellé audio, seul |
| Textes Muet/Sourdine | aucun (`selfFlagKnown` est faux pour un pair) |

Transitoire assumé, à ne pas traiter comme un défaut : quand l'annuaire rattrape ce pair, la ligne
**change de position** (elle passe de la fin de liste à sa place d'annuaire) mais **ne se remonte pas**
(même `key`, F1/information 4) : le halo, la transition de 80 ms et le focus éventuel survivent. Une
seule réorganisation, bornée aux premières secondes d'une jonction, sans clignotement. Le sens inverse
(pair qui quitte l'annuaire mais garde son lien) est symétrique.

---

## 5. Cas : la ligne « soi », qui n'existe pas dans la première liste

`voice.peers` ne contient jamais soi (`mesh.peers()` = clés des liens, `mesh.ts:581-583`) : la ligne de
soi vient **entièrement** de la liste 2. Elle devient pourtant une ligne comme les autres, et voici ce
qui ne doit pas changer :

| Élément | Règle |
|---|---|
| `key` / `data-peer-id` | `room.selfId` — même espace d'id que la signalisation (AD-19 D2) |
| `data-self` | `true` (seule ligne dans ce cas) |
| Badge | « Vous » (`participant.you`), inchangé |
| `data-speaking` | `selfSpeakingAttr(voice.status === 'live', selfSpeaking)` : mesure **locale**, `unknown` si le plan média ne tourne pas (jamais `false` par défaut) |
| `data-muted` | valeur réelle (`participant.muted`), inchangé |
| `data-peer-state/-cause/-stream` | `unknown` / `none` / `false` : il n'y a pas de lien vers soi-même, donc rien à mesurer — et surtout **pas** `connected`, qui serait une affirmation sur un transport inexistant |
| Libellé audio | **aucun** : le verdict audio de soi vit dans la barre de voix locale (`data-voice-status`, `styles.css:433-443`), pas dans sa ligne de participant |
| Curseur de gain | présent, comme sur toute ligne d'annuaire (le gain d'un pair se règle localement), avec son étiquette `visually-hidden` « Volume — nom » |
| Halo | monté, piloté par la mesure locale |

Note AD-20 D1 : l'état de parole de soi circule dans le **même** `speaking[]`, sous son id de
signalisation, pour l'overlay. Cela **ne crée pas** de seconde source dans le salon : la ligne de soi
continue de lire la mesure locale. Si `voice.peers` venait un jour à contenir `selfId`, F1 et F3
s'appliquent sans exception : **une seule** ligne pour soi, et l'entrée de signalisation alimente
seulement ses quatre `data-peer-*` et son libellé audio (elle n'ajoute ni ligne, ni nom, ni badge).

---

## 6. Ordre, longueur, contraste

- **Fragments** : 4 au maximum, comme aujourd'hui. Le libellé audio ne peut **pas** coexister avec
  « Muet »/« Sourdine » tant que ces drapeaux sont réservés à soi (`selfFlagKnown`), et un pair ne les
  affiche donc jamais.
- **Longueur** : le pire cas réel devient **plus court** qu'aujourd'hui, puisque le libellé audio
  remplace le texte de connexion au lieu de s'y ajouter. Pire cas aujourd'hui : 46 caractères
  (« Muet · Sourdine · parle · Connexion impossible », fr) / 47 (en). Pire cas après fusion :
  « parle · Audio en attente… » (25, fr) / « speaking · Waiting for audio… » (29, en) ; le pire cas de
  la ligne de soi reste « Muet · Sourdine · parle » (23). Aucune règle de troncature à ajouter, aucune
  hauteur de ligne à changer.
- **Contraste — constat, hors décision** : le libellé audio hérite de `.participant__state`
  (`text.muted` en `text-xs`) : ≈5,8:1 à 100 % d'opacité, ≈2,78:1 à 60 % (SPEC-013 §4). La fusion ne
  change rien à ce calcul (le texte existait déjà dans les deux listes), et il n'y a **rien à
  modifier** aujourd'hui. On note seulement que ce libellé devient, pour un pair, **la seule**
  information audio de la ligne : si un défaut de lisibilité est signalé un jour, c'est là qu'il se
  corrige (montée de jeton de couleur), jamais par une clé ou un texte nouveau.

---

## 7. Ce qui ne doit pas arriver (mensonges visibles)

1. Deux lignes pour une même personne (concaténation) : une seule peut s'allumer, donc l'autre ment.
2. Un halo **visible** sur une ligne sans mesure (R-U1 : inconnu ≡ faux, donc halo monté mais éteint,
   zéro pixel) ou, à l'inverse, un halo absent d'une ligne de pair.
3. Un libellé audio pris dans l'annuaire, ou un texte de connexion ajouté **en plus** du libellé audio.
4. Un sixième libellé (ou un libellé pour `unknown`) : « non mesuré », « … », une infobulle.
5. Une pastille de mute sur un pair (`unknown`), un curseur de gain sans `ParticipantDto`, un curseur
   grisé.
6. Une clé i18n ajoutée, `voice.peers.title` supprimée, ou `data-voice="peers"` renommé.
7. Un tri par nom, une clé composite, un préfixe d'id, un `key` qui change quand l'annuaire rattrape un
   pair.
8. Un `data-peer-*` manquant sur une ligne : c'est le trou par lequel la fusion redevient invérifiable.
9. « Le salon est vide » affiché alors qu'une ligne de pair figure dans la liste (condition d'état vide
   restée sur `participants.length`, F9).

---

## 8. Errata de SPEC-013 (à lire avec cette page)

- **R-U8 (SPEC-013 §2) est refusé sur sa cadence** par AD-20 : pas de cœur à 5 Hz (50 messages/10 s,
  budget A2 = 12). Le clignotement est empêché par les **transitions + une tenue de relâchement de
  600 ms côté producteur**, et côté rendu la péremption de 250 ms ne peut plus éteindre un halo
  (**plancher 1000 ms**). L'exigence d'usage que j'avais écrite reste vraie et devient **AC20-3** :
  *0 mutation de halo vers `unknown` pendant 10 s de parole avec pauses*. Le reste de SPEC-013 §2
  (R-U1..R-U7, et notamment « témoin = halo, jamais du texte », 2,78:1) est **normatif tel quel**.
- **Mise à jour du 2026-10-31 (producteur livré) — R-U8 est levé, AC-U10 est rouvert.** desk-engine a
  livré `src/renderer/peer-speech.ts` : échantillonnage **50 ms** (`SAMPLE_PERIOD_MS`, exporté, asserté
  `< 250` et `≤ 250/4`), tenue **600 ms** côté producteur (`SPEAKING_HOLD_MS`, plage 500–700 assertée),
  extinction mesurée **680 ms** (600 + 80 de transition), attaque sans les 2 trames d'hystérésis du VAD.
  Les deux clauses qui fondaient le refus sont donc satisfaites : **pas de cœur à 5 Hz publié** (50 ms est
  local, jamais sur le fil) et **tenue producteur de 600 ms réelle**. Conséquence : **AC-U10 redevient
  exécutable** et se mesure désormais sur `peerSpeaking()` elle-même (la même fonction que Room.tsx et
  Overlay.tsx lisent), **en plus** d'AC20-3 qui reste l'exigence d'usage (0 mutation vers `unknown` sur
  10 s). Ce n'est pas un retour en arrière : AC20-3 avait remplacé AC-U10 *faute de producteur*, il ne la
  remplace plus. R-U8 n'est pas réécrite, elle est **levée par la mesure**. Le **plancher de péremption
  ≥ 1000 ms au rendu** reste, lui, entièrement à livrer (`SPEAKING_STALE_MS = 250` est encore en place).
- **Pastille muette à 2,73:1 à 60 %** : noté, rien à changer, candidat seulement si un défaut est
  signalé (le chiffre est dans la planche `SPEC-013-planche-etat-inconnu.html`, ligne du badge muet).
  **Aucune retouche de la planche** n'est nécessaire pour ces deux points.

---

## 9. Critères d'acceptation de la fusion (ACb)

Tous vérifiables sur l'arbre React (grep + lignes) et sur le DOM rendu par le harnais de Banc. Aucun
n'exige du code nouveau.

- **ACb-1 — Une seule liste.** Un seul `<ul class="participants">` dans l'écran salon ; plus de garde
  `voice.peers.length > 0` ; le `<ul>` est rendu inconditionnellement.
- **ACb-2 — Une seule ligne par id.** Nombre de `<li class="participant">` = nombre d'ids distincts de
  (annuaire ∪ `voice.peers`) ; aucun `data-peer-id` en double. **« N pairs » se compte désormais en
  `data-self="false"`**, pas en `li[data-peer-id]` (la ligne de soi porte l'attribut).
- **ACb-3 — Les quatre `data-peer-*` sur chaque ligne**, valeurs conformes au tableau de vérité §3
  (sentinelles `unknown`/`none`/`false` incluses), `data-self`, `data-muted`, `data-speaking` présents.
- **ACb-4 — Libellé audio.** Chaque ligne dont `data-peer-state` ∈ {`connecting`, `connected`,
  `noFlow`, `failed`} affiche **exactement un** des cinq libellés, conforme à la matrice ; une ligne
  `unknown` n'affiche aucun libellé audio.
- **ACb-5 — Pas de doublon de transport.** Aucune ligne n'affiche à la fois un libellé audio et
  `participant.iceFailed`/`participant.iceRetrying`. Une ligne sans entrée de signalisation affiche
  exactement ce que la liste 2 affiche aujourd'hui.
- **ACb-6 — Pair sans annuaire.** Sa ligne existe, nom = id de signalisation, pas de badge « Vous », pas
  de curseur de gain, halo monté, `data-self="false"`, quatre `data-peer-*` du maillage.
- **ACb-7 — Ligne de soi.** Une seule, `data-self="true"`, `data-peer-id="room.selfId"`,
  `unknown`/`none`/`false`, aucun libellé audio, badge « Vous », curseur de gain **et son étiquette
  `visually-hidden`**.
- **ACb-8 — Libellés.** `design/i18n/fr.json` et `design/i18n/en.json` inchangés (mêmes clés, mêmes
  valeurs) ; aucune occurrence nouvelle de `t(` sur une clé ajoutée.
- **ACb-9 — Harnais.** `data-voice="peers"` toujours présent sur le `<ul>` ; `aria-label` de ce `<ul>`
  absent ; `voice.peers.title` toujours dans les deux fichiers i18n.
- **ACb-10 — Stabilité.** Le passage « pair sans annuaire → pair dans l'annuaire » ne change pas la
  `key`, ne remonte pas la ligne et ne coupe pas la transition du halo (contrôle visuel 80 ms).
- **ACb-11 — Aucune règle CSS ajoutée** pour distinguer les origines de ligne ; `.participant` et
  `.participants` inchangées ; `data-peer-stream` sans nouveau consommateur CSS.
- **ACb-12 — Longueur.** Aucun libellé d'état ne dépasse 4 fragments ; le pire cas reste ≤ celui
  d'aujourd'hui (§6).
- **ACb-13 — État vide.** Avec soi seul dans l'annuaire et **un** pair dans `voice.peers`, la liste
  montre la ligne du pair et le bloc « Le salon est vide » **n'apparaît pas**. Inversement, sans aucune
  ligne `data-self="false"`, il apparaît, avec les textes `room.empty.*` inchangés.

---

## 10. Suites

- **T23 étape A** : cette fusion, **avant** le relais de parole (ordonnancement AD-20 / « en premier,
  avant le relais ») — sinon on livre deux lignes par
  pair dont une seule s'allume, c'est-à-dire un mensonge visible.
- **T23 étape B (relais)** : `speaking[]` alimente `data-speaking` des pairs **et** de soi par le même
  canal ; le rendu suit R-U1..R-U7 ; **AC20-3 remplace AC-U10** (l'ancienne AC de cadence, §8).
- **À surveiller** : le transport de `muted` par la présence (`participant-state.ts:83-87`). Le jour où
  il arrive, `data-muted` devient réel pour les pairs et une ligne de pair pourra afficher
  « Muet · Audio reçu » — toujours 4 fragments au plus, aucun changement de structure.
- **Clos par cette page** : le doublon des deux listes de pairs (point d'ergonomie signalé par SPEC-013
  §7) — la décision est la fusion, et le contenu conservé est inventorié ci-dessus.
- **Hors périmètre, mais à ne pas perdre** : l'overlay lit lui aussi l'annuaire seul
  (`Overlay.tsx:28`, `:43` — `participants.slice(0, MAX_OVERLAY_PARTICIPANTS)`). Un pair présent en
  signalisation et absent de l'annuaire n'y figure donc pas, et son halo ne peut pas s'y allumer : la
  fusion ferme le trou **dans le salon**, pas dans l'overlay. C'est un candidat pour l'étape B (relais),
  pas une ligne à ajouter ici.

---

## 11. Errata 2 — mesures de Banc avant T23 (2026-10-31)

*Ajout, pas réécriture : aucune règle F1..F9, aucun ACb-1..ACb-13 et aucune ligne de §1 n'est modifiée
ci-dessous. Trois compléments relevés par desk-qa sur le source, un quatrième relevé ici.*

### 11.1 `data-muted` entre dans la liste des sentinelles — F10

desk-qa a raison et le trou était réel : mon §3 ne listait comme domaine fermé que les **quatre**
`data-peer-*` et `data-speaking`. Or la ligne porte aussi **`data-muted`**, dont le domaine est déjà
ternaire (`Tri = 'true' | 'false' | 'unknown'`, `participant-state.ts:88`) :

**F10 — `data-muted` est présent sur TOUTES les lignes unies, avec cette table et pas une autre.**

| Ligne | `data-muted` | Pourquoi |
|---|---|---|
| soi (`data-self="true"`) | la valeur **réelle**, `"true"` ou `"false"` | c'est le seul locuteur dont on connaît le drapeau sans transport : `flagsKnown` est vrai pour soi |
| pair (`data-self="false"`) | **`"unknown"`, toujours** | `mutedAttr()` rend `unknown` pour tout pair ; ce n'est pas une valeur par défaut, c'est l'absence de mesure |

Interdit, et c'est la formulation que je veux voir dans le test : **un pair ne porte jamais
`data-muted="false"`**. `false` veut dire « mesuré non muet » ; l'écrire pour un pair transforme un inconnu
en **silence mesuré**, exactement le faux-silence que R-U1/R-U2 interdisent, et c'est le même mensonge que
`data-speaking="false"` sur un pair non mesuré. `"true"` sur un pair reste interdit par AC-U6 (drapeau non
transporté à ce jour) et le restera tant que la présence ne transporte pas `muted` (§10, à surveiller).
Corollaire : `unknown` **n'est donc pas une valeur nouvelle** dans le contrat, contrairement à ce que
disait F5 pour `data-peer-state` — `data-muted` le portait déjà. F5 reste vraie pour les quatre
`data-peer-*` ; elle n'a jamais prétendu couvrir `data-muted`, et c'est précisément ce que je n'avais pas
écrit.

### 11.2 Le diff attendu n'est pas celui qu'un test de non-régression croira voir

La migration est **à moitié faite** dans le code actuel : la liste 1 (`Room.tsx:132-158`) porte **déjà**
`data-peer-id`, `data-peer-state`, `data-peer-cause`, `data-peer-stream` et `data-speaking` (`:137-141`).
Conséquence pour Cadre et pour Banc : un test qui compte les attributs « migrés » les verra **déjà là** et
ne prouvera rien.

Ce que la fusion **ajoute réellement** à une ligne existante de la liste 1 : **`data-self`**,
**`data-muted`**, le **halo**, et le **libellé de gain** (curseur de volume, aujourd'hui seulement sur la
liste 2). Ce qu'elle **retire** : la seconde `<ul>` (`:160-196`), son `aria-label` « Pairs distants » et
son état vide parallèle (F9). Le test de non-régression utile n'est donc pas « les attributs sont là » mais
**« la ligne unie en porte sept** (`data-peer-id`, `data-self`, `data-peer-state`, `data-peer-cause`,
`data-peer-stream`, `data-speaking`, `data-muted`) **et aucun id n'apparaît deux fois »**.

### 11.3 « Aucun texte pour `unknown` » : confirmé par lecture, pas par confiance

desk-qa le vérifie sur le source, je le reprends tel quel : le libellé de ligne est assemblé par
`joinStates()` (`participant-state.ts:99`) à partir des clés `voice.peer.*` et des **drapeaux connus** —
jamais de `state` seul — et l'état de mute n'est rendu que si `flagsKnown` (`Room.tsx:189`). Donc ajouter
`unknown` au domaine de `data-peer-state` (et `data-muted` à la ligne) **n'ouvre aucune clé i18n** : c'est
la confirmation du §2 de cette page, et c'est la raison pour laquelle la fusion ne coûte pas un mot.

### 11.4 AC-U9 : une limite d'instrument, déclarée, pas une concession

AC-U9 (diff de pixels **nul** entre `unknown` et `false`, à 100 % et à 60 % d'opacité) sera mesurée par
**capture comparée**, pas par `getComputedStyle` — c'est la bonne méthode, la seule qui voie
`backdrop-filter`. Mais sous Xvfb sans composition, `backdrop-filter` n'est pas rendu : dans ce cas le
résultat se déclare **NON VÉRIFIÉ**, pas vert. Une AC mesurée par un instrument aveugle à la propriété
qu'elle teste ne passe pas ; elle attend une session avec compositeur. La règle, elle, ne bouge pas.

### 11.5 Deux AC ajoutés

| AC | Ce qui est mesuré | Falsification attendue |
|---|---|---|
| **ACb-14 — `data-muted` sur chaque ligne, sentinelle pour les pairs** | Pour chaque `li` de la liste unie : l'attribut existe ; `li[data-self="true"]` porte la valeur réelle (`"true"` ou `"false"`) ; **chaque** `li[data-self="false"]` porte `data-muted="unknown"`, sans exception, y compris pour un pair hors annuaire (§4) | Un pair avec `data-muted="false"` ⇒ rouge (faux-silence mesuré) ; un pair avec `"true"` ⇒ rouge (AC-U6) ; un `li` sans l'attribut ⇒ rouge (trou d'invérifiabilité, comme F7 point 8) |
| **ACb-15 — Le diff est celui qui est écrit** | La ligne unie issue de la liste 1 porte **sept** attributs nommés en §11.2 et **aucun doublon d'id** dans la liste ; la seconde `<ul>`, son `aria-label` et son état vide parallèle ont disparu | Compter les cinq attributs déjà présents comme preuve de migration ⇒ test vide, rouge ; un id deux fois ⇒ rouge (c'est le défaut d'origine) |

### 11.6 Ce que cet errata ne change pas

Aucune règle F1..F9, aucun ACb-1..ACb-13, aucun libellé, aucune clé, aucun état vide. Le feu T23 A n'est
pas modifié : `data-muted` **était** dans le tableau de vérité §3 et dans la ligne « `data-muted` |
`unknown` → aucune pastille » du §4 — c'est son **caractère obligatoire sur chaque ligne** et l'interdiction
du `false` chez un pair qui manquaient à l'écrit. Le trou de l'overlay, lui, est traité dans
**SPEC-015** (§7 C4, C5) : il n'est pas rouvert ici.
