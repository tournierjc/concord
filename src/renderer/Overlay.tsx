/**
 * Overlay.tsx — avatars flottants avec halo de parole (SPEC-001 E4 / A4 / CA15).
 *
 * La géométrie (taille d'avatar, écart, marge, halo, durée d'animation, poignée) n'est pas écrite
 * ici : elle vient de `../shell/overlay-geometry`, convertie en variables CSS par
 * `overlayCssVariables()`. Le process principal applique les MÊMES valeurs à la fenêtre
 * (`setBounds`), ce qui garantit que les zones cliquables calculées par `hitTest()` correspondent
 * exactement à ce qui est dessiné.
 *
 * NON VÉRIFIÉ ici : React non installable dans cet environnement (voir la livraison T3).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { ParticipantDto } from '../shell/ipc-contract';
import { avatarEmojiFor, isAvatarRef } from '../shell/avatar';
import {
  MAX_OVERLAY_PARTICIPANTS,
  MAX_OVERLAY_WIDTH_PX,
  computeOverlayGeometry,
  overlayCssVariables,
} from '../shell/overlay-geometry';
import { lanApi } from './api';
import { mutedAttr } from './participant-state';
import { createTranslator, type Locale } from './i18n';

export interface OverlayProps {
  locale: Locale;
  participants: ParticipantDto[];
  // Identifiant local : seul participant dont les drapeaux mute/déafen sont réellement connus
  // (`room-bridge` n'écrit que pour soi-même). Absent ⇒ `data-muted="unknown"` partout :
  // l'incrustat n'affirme alors rien qu'il ne sache.
  selfId?: string | null;
  // Ids relayés affichés comme parlants MAINTENANT, tels que rendus par la surface relayée
  // (`speaking-surface.ts`). Défaut vide : l'overlay n'affirme alors aucune parole, plutôt que
  // d'en inventer une. Jamais de `false` : l'absence est un `unknown`.
  speaking?: readonly string[];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

/**
 * La pastille d'un avatar d'overlay (SPEC-002, amendement 2026-10-31) : emoji de la galerie,
 * image locale reçue, ou initiales — les mêmes règles qu'en salle, mêmes replis. L'aperçu d'une
 * image personnalisée passe par le même canal `getAvatarImage` que la salle : si le main ne la
 * connaît pas, ce sont les initiales, jamais un carré vide.
 */
function OverlayAvatar({ avatarRef, name }: { avatarRef: string | undefined; name: string }): JSX.Element {
  const emoji = avatarEmojiFor(avatarRef);
  const ref = avatarRef !== undefined && isAvatarRef(avatarRef) ? avatarRef : null;
  const [png, setPng] = useState<string | null>(null);
  useEffect(() => {
    if (ref === null) {
      setPng(null);
      return;
    }
    let live = true;
    void lanApi()
      .getAvatarImage(ref)
      .then((image) => {
        if (live) setPng(image);
      })
      .catch(() => {
        if (live) setPng(null);
      });
    return () => {
      live = false;
    };
  }, [ref]);
  if (emoji !== null) {
    return (
      <span className="overlay__initials" aria-hidden="true">
        {emoji}
      </span>
    );
  }
  if (ref !== null && png !== null) {
    return (
      <span className="overlay__initials overlay__initials--image" aria-hidden="true">
        <img className="overlay__avatar-image" src={`data:image/png;base64,${png}`} alt="" />
      </span>
    );
  }
  return (
    <span className="overlay__initials" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Overlay({
  locale,
  participants,
  selfId = null,
  speaking = [],
}: OverlayProps): JSX.Element {
  const t = createTranslator(locale);
  // Au plus 8 participants en salon ; la marge supérieure (10) évite toute surprise.
  const visible = participants.slice(0, MAX_OVERLAY_PARTICIPANTS);

  const style = useMemo<CSSProperties>(() => {
    // Zone de travail large : sur l'overlay, on ne veut jamais de retour à la ligne (le process
    // principal a déjà dimensionné la fenêtre pour une rangée).
    const geometry = computeOverlayGeometry({
      participantCount: Math.max(1, visible.length),
      workArea: { x: 0, y: 0, width: MAX_OVERLAY_WIDTH_PX * 4, height: 480 },
    });
    return overlayCssVariables(geometry) as CSSProperties;
  }, [visible.length]);

  const dragOrigin = useRef<{ pointerX: number; pointerY: number; windowX: number; windowY: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // La parole affichée ici est RELAYÉE (AD-25 §6) : elle vient de `lan:event:speaking-set` via
  // `createSpeakingSurface`, qui estampille l'ARRIVÉE et éteint par échéancier à 2000 ms.
  //
  // Cette fenêtre n'a AUCUNE mesure à elle (autre renderer : ni plan média, ni flux distant) : elle
  // ne lit donc ni la table de 250 ms du producteur (`SPEAKING_STALE_MS` / `PEER_LEVELS`), ni une
  // horloge de péremption. `speaking` ne contient que des ids déjà affichés « parlant » par la
  // surface ; un id absent vaut `unknown`, jamais `false`.

  return (
    <div
      className="overlay"
      style={{ ...style, transform: `translate(${offset.x}px, ${offset.y}px)` }}
      data-empty={visible.length === 0 ? 'true' : 'false'}
    >
      <ul className="overlay__avatars" aria-label={t('overlay.group')}>
        {visible.map((participant) => {
          const speaks = speaking.includes(participant.id) ? 'true' : 'unknown';
          // « Muet » n'est affiché que sur un `true` MESURÉ : une seule porte, `mutedAttr`, la même
          // que `data-muted`, plutôt que `participant.muted` brut doublé d'un garde (T21, SPEC-011 §3).
          // Pour un pair, `muted: false` ne veut pas dire « non muet » mais « non renseigné ».
          const flagsKnown = mutedAttr(participant, selfId) === 'true';
          return (
          <li
            key={participant.id}
            className="overlay__avatar"
            data-speaking={speaks}
            data-muted={mutedAttr(participant, selfId)}
            title={participant.name}
          >
            <span className="overlay__halo" aria-hidden="true" />
            <OverlayAvatar avatarRef={participant.avatarRef} name={participant.name} />
            {flagsKnown ? <span className="overlay__mute" aria-hidden="true" /> : null}
            <span className="visually-hidden">
              {participant.name}
              {speaks === 'true' ? ` — ${t('overlay.speaking')}` : ''}
              {flagsKnown ? ` — ${t('overlay.muted')}` : ''}
            </span>
          </li>
          );
        })}
      </ul>

      {visible.length === 0 ? <p className="overlay__empty">{t('overlay.empty')}</p> : null}

      {/*
        Poignée de déplacement : seule zone, avec les avatars, où l'overlay capte les clics
        (setIgnoreMouseEvents est désactivé sur ces rectangles par overlay-controller.ts).
      */}
      <div
        className="overlay__handle"
        role="button"
        tabIndex={-1}
        aria-label={t('overlay.handle')}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragOrigin.current = {
            pointerX: event.screenX,
            pointerY: event.screenY,
            windowX: window.screenX,
            windowY: window.screenY,
          };
        }}
        onPointerMove={(event) => {
          const origin = dragOrigin.current;
          if (!origin) return;
          setOffset({ x: event.screenX - origin.pointerX, y: event.screenY - origin.pointerY });
        }}
        onPointerUp={(event) => {
          const origin = dragOrigin.current;
          dragOrigin.current = null;
          if (!origin) return;
          const position = {
            x: origin.windowX + (event.screenX - origin.pointerX),
            y: origin.windowY + (event.screenY - origin.pointerY),
          };
          setOffset({ x: 0, y: 0 });
          // Le process principal borne la position à l'écran et la persiste.
          void lanApi().setOverlay({ position });
        }}
        onPointerCancel={() => {
          dragOrigin.current = null;
          setOffset({ x: 0, y: 0 });
        }}
      >
        <span className="overlay__dots" aria-hidden="true" />
      </div>
    </div>
  );
}
