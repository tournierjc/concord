# Licence et signature — arbitrages du 2026-10-31

Décisions du propriétaire du projet (JC), consignées ici pour que la question ne se rouvre pas
par accident.

## 1. Licence : MIT

- `LICENSE` (texte MIT) est versionné à la racine du dépôt.
- `package.json` déclare `"license": "MIT"` : le manifeste et le fichier concordent désormais.
  Avant cet ajout, le dépôt était public et annonçait MIT sans fournir le texte — mismatch visible
  par n'importe qui.
- Titulaire : « Concord contributors ». Si JC veut son nom en clair, c'est une ligne de `LICENSE` à
  changer (aucune autre conséquence).

## 2. Dépôt : public

- `github.com/tournierjc/concord` reste public. Aucun changement.

## 3. Windows : aucun certificat, binaires non signés

- Aucun certificat de signature de code n'est acheté ni utilisé. `win.forceCodeSigning: false` dans
  `electron-builder.yml` : la construction nsis aboutit sans certificat.
- Conséquence assumée, à dire aux utilisateurs : au premier lancement, Windows SmartScreen affiche
  « Éditeur inconnu ». Ce n'est pas un défaut de Concord, c'est l'absence de certificat.
- Ce qui n'est PAS fait, et qui ne doit pas être présenté comme fait : aucune signature Authenticode,
  aucune réputation SmartScreen, aucun binaire Windows vérifié sur une machine Windows.

## 4. Ce qui reste non vérifié

- Rendu de l'icône en mode dev, reproductibilité bit à bit des artefacts, cible deb en x86.
  Voir les VERIF correspondantes.
