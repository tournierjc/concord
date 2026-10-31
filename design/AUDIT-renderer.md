# Audit ergonomie & accessibilité — renderer (App.tsx, Room.tsx, Settings.tsx, theme.ts, i18n.ts)
Périmètre : 5 fichiers lus seuls. 7 BLOQUANT · 12 IMPORTANT · 7 CONFORT · 4 points déjà corrects (fin de fiche).
## BLOQUANT
1. App.tsx:176 — `rooms={[]}` en dur : la découverte n'est jamais branchée, l'écran reste sur « Recherche… » puis sur l'état vide, sans issue ; attendu : alimenter depuis le contrat IPC (liste + événement) et distinguer recherche / liste vide / échec.
2. App.tsx:176 & 266 — `onRefresh={() => setError(null)}` : « Actualiser » efface l'erreur et ne relance aucune découverte ; attendu : déclencher le rafraîchissement réel et afficher l'heure du dernier scan.
3. Room.tsx:149-158 — PTT souris uniquement (`onPointerDown/Up/Cancel`) : aucun `onKeyDown/onKeyUp`, donc inutilisable au clavier seul, et `onPointerLeave` coupe l'émission au moindre mouvement ; attendu : Espace/Entrée en keydown/keyup avec `preventDefault`, suppression de la coupure sur pointerleave.
4. Room.tsx:149-165 — état parlé/muet en attente non annoncé : `aria-pressed` n'est lu qu'au focus et le VU-mètre est `aria-hidden` (162) ; attendu : région `role="status" aria-live="polite"` (« Micro ouvert / Muet / Émission en cours ») + `role="progressbar"` et `aria-valuenow` sur le niveau.
5. Settings.tsx:88 — `role="dialog" aria-modal="true"` sans piège de focus, sans Échap, sans focus initial : le clavier ressort derrière la feuille ; attendu : focus sur le titre, Tab cyclique, Échap ferme, focus rendu au bouton d'ouverture.
6. App.tsx:100 & 115 & 148 — les erreurs affichent `cause.message` brut (exception technique, non traduite) et n'offrent que « Fermer » ; attendu : table code IPC → clé i18n FR/EN + un mot d'action (« Réessayer », « Choisir un périphérique »).
7. App.tsx:122-126 — `leaveRoom` sans try/catch : un échec de sortie part en rejet non géré et laisse l'écran salon sans état d'erreur ; attendu : même traitement que `joinRoom`.
## IMPORTANT
8. App.tsx:248 — le bouton affiche « Complet » mais reste cliquable et appelle `onJoin` : le refus du 9ᵉ arrive après coup ; attendu : `disabled` + `aria-disabled` et libellé « Complet (8/8) ».
9. Room.tsx:63-65 — refus du 9ᵉ participant rendu par `t(room.notice)`, clé venue du process principal non validée : clé absente = texte technique à l'écran ; attendu : liste blanche de clés de notice et message explicite « Salon complet : 8 participants maximum ».
10. Room.tsx:57 — le seul repère de capacité est « 3/8 » dans l'en-tête, sans état « complet » ni « bientôt complet » au niveau de la liste ; attendu : compteur n/8 en tête de liste avec l'état de saturation visible.
11. Room.tsx:83-93 — muet / déaf / « Parle » / échec ICE concaténés avec « · » dans un seul span, et `connection === 'failed'` n'offre aucune action ; attendu : puces séparées + action « Réessayer la connexion » sur l'état `failed`.
12. Settings.tsx:72-75 — `enumerateDevices` exécuté une seule fois, aucun écouteur `devicechange` : périphérique débranché = liste périmée et silence ; attendu : réénumération sur `devicechange` et bandeau « Périphérique choisi introuvable — repli sur le défaut ».
13. Settings.tsx:43-50 — `device.label || '#'+(i+1)` : sans permission micro les noms deviennent des numéros, sans explication ni erreur visible ; attendu : message i18n « noms de périphériques indisponibles (autorisation micro) ».
14. App.tsx / Room.tsx — aucun état réseau : perte de signalisation ou hors LAN est indiscernable d'un salon vide ; attendu : état signaling (connecté / reconnexion / perdu) avec mot d'action.
15. Settings.tsx:224-235 — « Changer » active la capture sans focaliser le champ `shortcut__capture` : au clavier il faut deviner l'étape suivante ; attendu : `ref` + `focus()` dans le même geste et annonce live « Enregistrement… ».
16. Settings.tsx:357 — ligne de debug montrée à l'utilisateur : `{MAX_ROOM_PARTICIPANTS} · {SIGNALING_PORT_DEFAULT}` en nombres nus ; attendu : suppression ou clé unique `settings.network.identity.summary`.
17. Room.tsx:158 — libellé PTT dépendant de `{shortcut}` : raccourci vide ou refusé donne « Maintenir  » ambigu ; attendu : variante sans raccourci + `aria-keyshortcuts` sur le bouton.
18. i18n.ts:45 — `missingKeys()` n'est branché nulle part et `t()` renvoie la clé brute : une régression de traduction s'affiche en production ; attendu : test de parité FR/EN en CI + avertissement en dev.
19. Settings.tsx / i18n.ts — FR et EN sont livrés (281 clés chacun) mais aucun sélecteur de langue dans l'interface : `locale` n'est jamais modifiable ; attendu : choix FR/EN dans les réglages.
## CONFORT
20. Settings.tsx:108-165 — `<label>` englobant libellé + aide + contrôle : le texte d'aide entre dans le nom accessible ; attendu : `id`/`htmlFor` + `aria-describedby` pour l'aide.
21. Settings.tsx:190, 259, 305 — curseurs gain / seuil VAD / opacité sans `aria-valuetext` : valeur lue en nombre brut ; attendu : `aria-valuetext` avec unité localisée (dB, %, px).
22. Settings.tsx — groupes `segmented` en `aria-pressed` pour un choix exclusif : attendu : `role="radiogroup"` + `role="radio"`/`aria-checked`.
23. Room.tsx:162-166 — mètre sans graduation : en VAD on ne voit pas où se situe le seuil ; attendu : marqueur de seuil positionné depuis `vadThresholdDb`.
24. Room.tsx:105-110 — état vide affiché sous la liste alors que « vous » y figure déjà ; attendu : formulation dédiée « Vous êtes seul » ou masquage du doublon.
25. App.tsx:148-171 — bandeau d'erreur et bandeau de conflit de raccourci s'empilent sans hiérarchie ; attendu : un seul emplacement de bannière, ordre erreur > avertissement.
26. Room.tsx:160 — bouton PTT en `button--primary` concurrence visuellement mute/déafen ; attendu : hiérarchie réservée à l'action d'émission, toggle à l'état.
## Déjà correct (ne pas retoucher)
27. (a) Muet/déafen : `aria-pressed` + libellé qui change de texte (Room.tsx:130-146), parole doublée d'un texte « · Parle » (Room.tsx:89) : pas d'information par la couleur seule.
28. (c) Aucun libellé en dur : 78 clés littérales employées, toutes présentes en FR et EN, y compris la clé dynamique `settings.overlay.scale.${scale}` ; seul reste hors i18n le point 16.
29. (e) Socle contraste/focus : theme.ts:28-43 expose `--color-focus-*` et theme.ts:92-94 `--component-focus-width/offset`, avec `data-theme` + `color-scheme` posés ; l'anneau visible reste à confirmer dans styles.css (hors périmètre).
30. Room.tsx:80-84 — curseur de volume par participant : libellé `visually-hidden` « Volume — Nom » correct, à conserver comme modèle.
