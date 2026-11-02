/**
 * Room.tsx — écran du salon : participants, halo de parole, mute, déafen, push-to-talk.
 *
 * Toute la présentation vient des variables CSS issues de `design/tokens.json` et tous les
 * libellés de `design/i18n.json` : ce fichier ne contient ni couleur, ni taille, ni texte visible.
 *
 * NON VÉRIFIÉ ici : React non installable dans cet environnement (voir la livraison T3).
 */

import { useEffect, useState } from 'react';
import type { ControlStateDto, ParticipantDto, RoomStateDto } from '../shell/ipc-contract';
import { avatarEmojiFor, isAvatarRef } from '../shell/avatar';
import { createTranslator, type Locale } from './i18n';
import { lanApi } from './api';
import { HeadphonesIcon, HeadphonesOffIcon, LeaveIcon, MicIcon, MicOffIcon } from './icons';
import { setTransmitting, SPEAKING_LEVEL, useVoicePlane, type VoiceSnapshot } from './voice';
import {
  joinStates,
  mutedAttr,
  peerSpeaking,
  PEER_LEVELS,
  selfFlagKnown,
  selfSpeakingAttr,
  type Tri,
} from './participant-state';

export interface RoomProps {
  locale: Locale;
  room: RoomStateDto;
  participants: ParticipantDto[];
  control: ControlStateDto;
  maxParticipants: number;
  /** Raccourci push-to-talk effectif, affiché tel quel (ex. `Alt+Space`). */
  shortcut: string;
  onMute: (muted: boolean) => void;
  onDeafen: (deafened: boolean) => void;
  onPushToTalk: (active: boolean) => void;
  onGain: (participantId: string, gain: number) => void;
  onLeave: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

/**
 * La pastille d'un participant (SPEC-002, amendement 2026-10-31) : emoji de la galerie embarquée,
 * image locale reçue du pair, ou initiales. Une empreinte dont le PNG n'est pas encore arrivé (ou
 * n'arrivera jamais) rend les initiales — jamais un carré vide, jamais une image inventée.
 */
function AvatarOrInitials({ avatarRef, name }: { avatarRef: string | undefined; name: string }): JSX.Element {
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
      <span className="participant__avatar" aria-hidden="true">
        {emoji}
      </span>
    );
  }
  if (ref !== null && png !== null) {
    return (
      <span className="participant__avatar participant__avatar--image" aria-hidden="true">
        <img className="participant__avatar-image" src={`data:image/png;base64,${png}`} alt="" />
      </span>
    );
  }
  return (
    <span className="participant__avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Room({
  locale,
  room,
  participants,
  control,
  maxParticipants,
  shortcut,
  onMute,
  onDeafen,
  onPushToTalk,
  onGain,
  onLeave,
}: RoomProps): JSX.Element {
  const t = createTranslator(locale);

  // La voix entre en scène ici : le plan média naît à l'entrée en salon et meurt au départ
  // (`useVoicePlane` → `createMediaPlane` / `close`). Si le plan média ou le micro manquent,
  // l'état vaut `unavailable` et l'interface le dit — bandeau plus bas, jamais un silence.
  const voice: VoiceSnapshot = useVoicePlane({
    enabled: room.roomId !== null,
    localId: room.selfId ?? '',
    roomId: room.roomId,
    wantTransmit: control.pushToTalk && !control.muted && !control.deafened,
    // SPEC-009 §1(e) : `retrying` détruit la session (mesh compris), `connected` en recrée une.
    phase: room.phase,
  });

  // Anneau « parle » alimenté par `level()` du plan média, pour le participant local.
  const selfSpeaking = voice.status === 'live' && voice.level >= SPEAKING_LEVEL;
  const micLevel = voice.status === 'live' ? Math.max(control.micLevel, voice.level) : control.micLevel;
  // Une seule lecture d'horloge par rendu, même origine que `PeerSpeakingSample.at`
  // (`performance.now()` du renderer) : la péremption de 250 ms se juge sur cette valeur.
  const speakingClock = performance.now();

  return (
    <section className="panel room" aria-labelledby="room-title">
      <header className="room__header">
        <h2 id="room-title" className="panel__title">
          {room.roomName ?? t('common.none')}
        </h2>
        <span className="room__members">
          {t('room.header.members', { count: participants.length, max: maxParticipants })}
        </span>
        <button
          type="button"
          className="button button--compact button--icon"
          aria-label={t('room.leave')}
          title={t('room.leave')}
          onClick={onLeave}
        >
          <LeaveIcon />
        </button>
      </header>

      {/* Un salon refusé (9ᵉ participant, port occupé) s'annonce ici, jamais par un silence. */}
      {room.notice ? (
        <p className="banner banner--warning" role="alert">
          {t(room.notice)}
        </p>
      ) : null}

      {voice.status === 'unavailable' ? (
        <p className="banner banner--warning" role="alert" data-voice="unavailable">
          {t('voice.unavailable.title')} — {voice.error ?? t('voice.unavailable.unknown')}
        </p>
      ) : null}

      {/* Signalisation (T16b) : l'état du TUYAU, puis celui de chaque pair distant.
          Rien n'est supposé ici : un pair dont aucun flux n'arrive est annoncé « muet », et aucun
          anneau ne tourne sur du vide — l'anneau n'est branché que sur `data-peer-stream="true"`. */}
      {voice.status === 'live' && voice.link === null ? (
        <p className="banner" data-voice="link-absent">
          {t('voice.link.absent')}
        </p>
      ) : null}

      {voice.link?.state === 'connecting' ? (
        <p className="banner" data-voice="link-connecting">
          {t('voice.link.connecting')}
        </p>
      ) : null}

      {voice.link?.state === 'refused' ? (
        <p className="banner banner--warning" role="alert" data-voice="link-refused">
          {t('voice.link.refused')} — {voice.link.detail ?? t('voice.unavailable.unknown')}
        </p>
      ) : null}

      {voice.link?.state === 'closed' ? (
        <p className="banner" data-voice="link-closed">
          {t('voice.link.closed')}
        </p>
      ) : null}

      {voice.peers.length > 0 ? (
        <ul className="participants" aria-label={t('voice.peers.title')} data-voice="peers">
          {voice.peers.map((peer) => (
            <li
              key={peer.peerId}
              className="participant"
              data-peer-id={peer.peerId}
              data-peer-state={peer.state}
              data-peer-cause={peer.cause ?? 'none'}
              data-peer-stream={peer.hasStream ? 'true' : 'false'}
              data-speaking={peerSpeaking(peer.peerId, PEER_LEVELS, speakingClock)}
            >
              <AvatarOrInitials avatarRef={peer.avatarRef} name={peer.name ?? peer.peerId} />
              <span className="participant__name">{peer.name ?? peer.peerId}</span>
              <span className="participant__state">
                {peer.state === 'connecting' ? t('voice.peer.connecting') : null}
                {peer.state === 'noFlow' ? t('voice.peer.noFlow') : null}
                {peer.state === 'failed' ? t('voice.peer.failed') : null}
                {peer.state === 'connected'
                  ? peer.hasStream
                    ? t('voice.peer.audio')
                    : t('voice.peer.pending')
                  : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="participants">
        {participants.map((participant) => {
          const isSelf = participant.id === room.selfId;
          const flagsKnown = selfFlagKnown(participant, room.selfId);
          // Soi-même : mesure locale réelle. Un pair : table du plan média, `unknown` sans
          // échantillon. Jamais `participant.speaking` — l'annuaire ne mesure rien (AD-17 D2).
          const speaks: Tri = isSelf
            ? selfSpeakingAttr(voice.status === 'live', selfSpeaking)
            : peerSpeaking(participant.id, PEER_LEVELS, speakingClock);
          return (
          <li
            key={participant.id}
            className="participant"
            data-speaking={speaks}
            data-muted={mutedAttr(participant, room.selfId)}
            data-self={isSelf ? 'true' : 'false'}
          >
            <AvatarOrInitials avatarRef={participant.avatarRef} name={participant.name} />
            <span className="participant__halo" aria-hidden="true" />
            <span className="participant__name">
              {participant.name}
              {participant.id === room.selfId ? <span className="participant__you"> ({t('participant.you')})</span> : null}
            </span>
            <span className="participant__state">
              {joinStates([
                flagsKnown && participant.muted ? t('participant.muted') : null,
                flagsKnown && participant.deafened ? t('participant.deafened') : null,
                speaks === 'true' ? t('participant.speaking') : null,
                participant.connection !== 'connected'
                  ? t(participant.connection === 'failed' ? 'participant.iceFailed' : 'participant.iceRetrying')
                  : null,
              ])}
            </span>
            <label className="participant__gain">
              <span className="visually-hidden">
                {t('participant.volume', { name: participant.name })}
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={participant.gain}
                onChange={(event) => onGain(participant.id, Number(event.target.value))}
              />
              <output className="participant__gain-value">
                {t('participant.volumeValue', { percent: Math.round(participant.gain * 100) })}
              </output>
            </label>
          </li>
          );
        })}
      </ul>

      {participants.length <= 1 ? (
        <div className="empty">
          <p className="empty__title">{t('room.empty.title')}</p>
          <p className="empty__body">{t('room.empty.body', { name: room.roomName ?? '' })}</p>
        </div>
      ) : null}

      <footer className="controls">
        <button
          type="button"
          className="button button--icon"
          aria-pressed={control.muted}
          aria-label={control.muted ? t('control.mute.off') : t('control.mute.on')}
          title={control.muted ? t('control.mute.off') : t('control.mute.on')}
          onClick={() => onMute(!control.muted)}
        >
          {/* The label names the action the click performs: `mute.on` = "Mute my mic". */}
          {control.muted ? <MicOffIcon /> : <MicIcon />}
        </button>

        <button
          type="button"
          className="button button--icon"
          aria-pressed={control.deafened}
          aria-label={control.deafened ? t('control.deafen.off') : t('control.deafen.on')}
          title={control.deafened ? t('control.deafen.off') : t('control.deafen.on')}
          onClick={() => onDeafen(!control.deafened)}
        >
          {control.deafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
        </button>

        <div className="controls__mode">
          <span className="controls__label">{t('control.mode')}</span>
          <span className="controls__value">
            {control.mode === 'ptt' ? t('control.mode.ptt') : t('control.mode.vad')}
          </span>
        </div>

        <button
          type="button"
          className="button button--primary controls__ptt"
          aria-pressed={control.pushToTalk}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            // Push-to-talk réel : la piste micro s'ouvre maintenant, pas dans un rendu ultérieur.
            setTransmitting(true);
            onPushToTalk(true);
          }}
          onPointerUp={() => {
            setTransmitting(false);
            onPushToTalk(false);
          }}
          onPointerCancel={() => {
            setTransmitting(false);
            onPushToTalk(false);
          }}
          onPointerLeave={() => {
            setTransmitting(false);
            onPushToTalk(false);
          }}
        >
          {control.pushToTalk ? t('control.ptt.active') : t('control.ptt.hold', { shortcut })}
        </button>

        <span
          className="controls__voice"
          data-voice-status={voice.status}
          data-voice-tx={voice.transmitting ? 'true' : 'false'}
        >
          {voice.status === 'live' ? t('voice.state.live') : null}
          {voice.status === 'starting' ? t('voice.state.starting') : null}
          {voice.status === 'unavailable' ? t('voice.state.unavailable') : null}
        </span>

        <div className="controls__meter" aria-hidden="true">
          <span className="controls__label">{t('control.micLevel')}</span>
          <span className="meter">
            <span className="meter__fill" style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </span>
        </div>
      </footer>
    </section>
  );
}
