/**
 * overlay-avatar.ts — ce que la pastille de l'overlay dessine.
 *
 * Galerie → emoji embarqué. Image connue (base64 déjà servi par le main) → `<img>`.
 * Rien, ou une empreinte dont l'image n'est pas encore arrivée → initiales. Jamais un
 * carré vide.
 */

import { avatarEmojiFor, avatarInitials, isAvatarRef } from '../shell/avatar';

export type OverlayAvatarView =
  | { readonly kind: 'emoji'; readonly text: string }
  | { readonly kind: 'image'; readonly ref: string; readonly src: string }
  | { readonly kind: 'initials'; readonly text: string };

/** Vrai pour une empreinte d'image (pas une galerie, pas l'absence). */
export function overlayAvatarNeedsImage(avatarRef: string | undefined): avatarRef is string {
  return avatarEmojiFor(avatarRef) === null && typeof avatarRef === 'string' && isAvatarRef(avatarRef);
}

export function resolveOverlayAvatar(
  avatarRef: string | undefined,
  name: string,
  pngBase64: string | null,
): OverlayAvatarView {
  const emoji = avatarEmojiFor(avatarRef);
  if (emoji !== null) return { kind: 'emoji', text: emoji };
  if (typeof avatarRef === 'string' && isAvatarRef(avatarRef) && pngBase64 !== null && pngBase64.length > 0) {
    return { kind: 'image', ref: avatarRef, src: `data:image/png;base64,${pngBase64}` };
  }
  return { kind: 'initials', text: avatarInitials(name) };
}
