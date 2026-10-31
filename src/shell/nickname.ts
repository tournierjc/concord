/**
 * nickname.ts — la règle du pseudo, seule et testable.
 *
 * SPEC-002 **S1.11** (« Pseudo invalide ») fixe la règle d'affichage : le champ d'identité de E1 est
 * validé **sans bloquer** — le pseudo précédent valide reste en vigueur, rien d'autre n'est
 * désactivé. Les deux seuls cas d'erreur sont :
 *   — `empty`   : champ vidé puis quitté (déclencheur S1.11) ;
 *   — `tooLong` : saisie de plus de 32 caractères (collage).
 *
 * Pourquoi ce module existe : la règle vit ici, pure, et les composants ne font que l'afficher. Le
 * schéma de réglages (`settings-schema.ts`) refuse, lui aussi, un pseudo de plus de 32 caractères —
 * mais il n'importe rien (il est sans dépendance, par contrat). Les deux bornes sont donc
 * **vérifiées identiques par un test** (`tests/identity-row.node.test.ts`) plutôt que par un import :
 * un `32` qui bouge d'un côté sans l'autre fait rougir le test, ce qui est le seul vrai garde-fou.
 *
 * Un pseudo fait d'espaces est traité comme vide : «   » n'est pas un nom affiché aux autres
 * participants, et SPEC-001 A6 dit que ce nom vient du prénom du compte OS — jamais de blancs.
 */

/** Longueur maximale d'un pseudo (SPEC-002 S1.11, `app.nickname.error.tooLong`). */
export const NICKNAME_MAX_LENGTH = 32;

/** Les deux seules erreurs de saisie d'un pseudo, dans l'ordre de vérification. */
export type NicknameError = 'empty' | 'tooLong';

/**
 * Rend l'erreur du pseudo saisi, ou `null` s'il est acceptable.
 *
 * L'ordre compte : un collage de 40 espaces est `tooLong` d'abord (c'est ce que l'utilisateur vient
 * de faire), puis `empty` si l'on retire les espaces.
 */
export function nicknameError(value: string): NicknameError | null {
  if (value.length > NICKNAME_MAX_LENGTH) return 'tooLong';
  if (value.trim().length === 0) return 'empty';
  return null;
}

/** Clé i18n du message à afficher pour une erreur donnée (`app.nickname.error.*`). */
export function nicknameErrorKey(error: NicknameError): string {
  return `app.nickname.error.${error}`;
}
