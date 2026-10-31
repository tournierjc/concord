/**
 * App.tsx — écran principal : liste des salons, salon courant, panneau de réglages.
 *
 * La couche React est volontairement fine : elle n'invente ni règle de géométrie, ni règle de
 * validation, ni libellé. Tout vient de `../shell` (modules testés par node --test), de
 * `design/i18n.json` et de `design/tokens.json`.
 *
 * VÉRIFIÉ (2026-10-30T23:29Z) : `npx tsc --noEmit -p tsconfig.json` — ce fichier ne produit aucune
 * erreur. NON VÉRIFIÉ : exécution réelle du renderer (build Vite + Electron absents) et découverte
 * mDNS sur un vrai réseau ; la liste des salons n'a donc jamais été vue se remplir à l'écran.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ControlStateDto,
  ParticipantDto,
  RoomStateDto,
  RoomSummaryDto,
  ShortcutConflictDto,
} from '../shell/ipc-contract';
import {
  NICKNAME_MAX_LENGTH,
  type NicknameError,
  nicknameError,
  nicknameErrorKey,
} from '../shell/nickname';
import { MAX_ROOM_PARTICIPANTS, type Settings } from '../shell/settings-schema';
import { lanApi } from './api';
import { browserTimers } from './browser-timers';
import { createTranslator, type Locale } from './i18n';
import { Room } from './Room';
import { SettingsPanel } from './Settings';
import { applyTheme, watchSystemTheme } from './theme';

type Screen = 'rooms' | 'room';

/** Durée d'affichage du toast de confirmation (S1.11) : assez pour être lu, pas assez pour gêner. */
const TOAST_MS = 2600;

const EMPTY_CONTROL: ControlStateDto = {
  muted: false,
  deafened: false,
  pushToTalk: false,
  mode: 'ptt',
  micLevel: 0,
};

const EMPTY_ROOM: RoomStateDto = {
  roomId: null,
  roomName: null,
  phase: 'idle',
  participantCount: 0,
  selfId: null,
  notice: null,
};

/** Phase honnête de la découverte : rien n'est affiché avant le premier résultat du main. */
type DiscoveryPhase = 'loading' | 'ready' | 'refreshing';

interface DiscoveryState {
  phase: DiscoveryPhase;
  /** Résultats réels de `discoverRooms()` / `onRoomsDiscovered` — jamais un salon inventé. */
  rooms: RoomSummaryDto[];
  /** Message brut remonté par l'IPC quand le scan échoue (aucun libellé fabriqué). */
  error: string | null;
}

const EMPTY_DISCOVERY: DiscoveryState = { phase: 'loading', rooms: [], error: null };

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * IdentityRow — le pseudo, sous l'en-tête (SPEC-002 S1.11, arbre de composants §3.1).
 *
 * Le pseudo n'est PAS dans la barre de titre : S1.11 explique qu'un champ de 32 caractères dans une
 * barre de 44 px ne peut porter ni le libellé, ni l'aide, ni le compteur `n/32`. Il vit donc ici.
 *
 * Validation NON bloquante (S1.11) : le pseudo précédent valide reste en vigueur, rien n'est
 * désactivé. Le champ porte `aria-invalid` et son message est lié par `aria-describedby`.
 */
interface IdentityRowProps {
  value: string;
  locale: Locale;
  onChange: (nickname: string) => void;
  onSaved: () => void;
}

function IdentityRow({ value, locale, onChange, onSaved }: IdentityRowProps): JSX.Element {
  const t = createTranslator(locale);
  const [draft, setDraft] = useState<string>(value);
  const [error, setError] = useState<NicknameError | null>(null);
  const errorId = 'identity-error';

  // Le champ suit la valeur des réglages tant que l'utilisateur ne l'a pas touché : un pseudo
  // venu du prénom du compte OS (SPEC-001 A6) doit s'afficher, pas rester invisible.
  const [touched, setTouched] = useState<boolean>(false);
  useEffect(() => {
    if (!touched) setDraft(value);
  }, [value, touched]);

  const accept = (next: string): void => {
    const found = nicknameError(next);
    setDraft(next);
    // S1.11 distingue les deux déclencheurs : `tooLong` tombe à la frappe (c'est un collage),
    // `empty` tombe à la SORTIE de champ — signaler « Entrez un pseudo. » pendant qu'on efface la
    // ligne pour la réécrire serait un reproche en pleine saisie. Une frappe valide, elle, efface
    // l'erreur immédiatement et met la valeur en vigueur.
    if (found === 'tooLong') setError('tooLong');
    else if (found === null) {
      setError(null);
      onChange(next);
    }
  };

  return (
    <div className="identity">
      <label className="field" htmlFor="identity-input">
        <span className="field__label">
          {t('app.nickname.label')}
          <span className="identity__counter">
            {t('common.counter', { value: draft.length, max: NICKNAME_MAX_LENGTH })}
          </span>
        </span>
        <input
          id="identity-input"
          className={error === null ? 'input' : 'input input--invalid'}
          type="text"
          value={draft}
          maxLength={NICKNAME_MAX_LENGTH}
          placeholder={t('app.nickname.placeholder')}
          aria-invalid={error !== null}
          aria-describedby={error === null ? 'identity-help' : `identity-help ${errorId}`}
          onFocus={() => setTouched(true)}
          onChange={(event) => accept(event.target.value)}
          onBlur={() => {
            // À la sortie de champ : l'erreur reste (le pseudo précédent gouverne), sinon on confirme.
            const found = nicknameError(draft);
            setError(found);
            if (found === null) onSaved();
          }}
        />
        <span className="field__help" id="identity-help">
          {t('app.nickname.help')}
        </span>
        {error === null ? null : (
          <span className="field__error" id={errorId}>
            {t(nicknameErrorKey(error))}
          </span>
        )}
      </label>
    </div>
  );
}

export function App(): JSX.Element {
  const api = useMemo(() => lanApi(), []);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [room, setRoom] = useState<RoomStateDto>(EMPTY_ROOM);
  const [control, setControl] = useState<ControlStateDto>(EMPTY_CONTROL);
  const [shortcutConflict, setShortcutConflict] = useState<ShortcutConflictDto | null>(null);
  const [screen, setScreen] = useState<Screen>('rooms');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryState>(EMPTY_DISCOVERY);

  const locale: Locale = settings?.locale ?? 'fr';
  const t = useMemo(() => createTranslator(locale), [locale]);

  // Chargement initial + abonnements. Chaque `on*` renvoie son désabonnement.
  useEffect(() => {
    let active = true;
    void api.getSettings().then((loaded) => {
      if (!active) return;
      setSettings(loaded);
      applyTheme(document.documentElement, loaded.theme);
    });
    const unsubscribers = [
      api.onParticipants(setParticipants),
      api.onRoomState((state) => {
        setRoom(state);
        setScreen(state.roomId ? 'room' : 'rooms');
      }),
      api.onControlState(setControl),
      api.onSettingsChanged(({ settings: next }) => {
        setSettings(next);
        applyTheme(document.documentElement, next.theme);
      }),
      api.onShortcutConflict(setShortcutConflict),
    ];
    return () => {
      active = false;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [api]);

  // Le thème « système » suit les préférences de l'OS en direct.
  useEffect(() => {
    if (!settings) return undefined;
    applyTheme(document.documentElement, settings.theme);
    return watchSystemTheme(document.documentElement, settings.theme);
  }, [settings]);

  // Découverte réelle des salons : scan mDNS borné côté main, résultats uniquement issus de l'IPC.
  const refreshRooms = useCallback(async () => {
    setDiscovery((previous) => ({
      phase: previous.rooms.length > 0 ? 'refreshing' : 'loading',
      rooms: previous.rooms,
      error: null,
    }));
    try {
      const found = await api.discoverRooms();
      setDiscovery({ phase: 'ready', rooms: found, error: null });
    } catch (cause) {
      setDiscovery((previous) => ({ phase: 'ready', rooms: previous.rooms, error: messageOf(cause) }));
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    // Les annonces mDNS ultérieures (up/down) arrivent par ce canal : le désabonnement est rendu
    // par le preload et appelé au démontage.
    const unsubscribe = api.onRoomsDiscovered((found) => {
      if (!active) return;
      setDiscovery({ phase: 'ready', rooms: found, error: null });
    });
    void refreshRooms();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api, refreshRooms]);

  // Toast de confirmation (S1.11 : `app.nickname.saved` à la sortie de champ). Il vit dans une
  // région `aria-live="polite"` et se referme tout seul ; l'horloge est celle de la page
  // (`browser-timers`), seul endroit autorisé à poser un minuteur côté renderer.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (toast === null) return undefined;
    const timers = browserTimers();
    const handle = timers.once(TOAST_MS, () => setToast(null));
    return () => timers.cancel(handle);
  }, [toast]);

  const patchSettings = useCallback(
    async (patch: Partial<Settings>) => {
      try {
        const next = await api.setSettings(patch);
        setSettings(next);
        applyTheme(document.documentElement, next.theme);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [api],
  );

  const joinRoom = useCallback(
    async (roomId: string, roomName: string) => {
      if (!settings) return;
      try {
        // `name` décrit le SALON : c'est le nom affiché en en-tête. Le nom du participant, lui,
        // vient des réglages côté main (A6) — l'envoyer ici affichait le pseudo comme nom de salon.
        const state = await api.joinRoom({ roomId, name: roomName });
        setRoom(state);
        setScreen(state.roomId ? 'room' : 'rooms');
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [api, settings],
  );

  const leaveRoom = useCallback(async () => {
    const state = await api.leaveRoom();
    setRoom(state);
    setScreen('rooms');
  }, [api]);

  if (!settings) {
    return (
      <main className="app app--loading" aria-busy="true">
        <p>{t('common.loading')}</p>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="titlebar">
        <h1 className="titlebar__title">{t('app.title')}</h1>
        <div className="titlebar__actions">
          <button type="button" className="button" onClick={() => setSettingsOpen(true)}>
            {t('settings.title')}
          </button>
        </div>
      </header>

      {screen === 'rooms' ? (
        <IdentityRow
          locale={locale}
          value={settings.nickname}
          onChange={(nickname) => void patchSettings({ nickname })}
          onSaved={() => setToast(t('app.nickname.saved'))}
        />
      ) : null}

      <div className="toast-region" role="status" aria-live="polite">
        {toast === null ? null : (
          <p className="toast">
            {toast}
            <button type="button" className="button button--compact" onClick={() => setToast(null)}>
              {t('common.close')}
            </button>
          </p>
        )}
      </div>

      {error ? (
        <div className="banner banner--error" role="alert">
          <p>{error}</p>
          <button type="button" className="button button--compact" onClick={() => setError(null)}>
            {t('common.close')}
          </button>
        </div>
      ) : null}

      {shortcutConflict ? (
        <div className="banner banner--warning" role="status">
          <p>
            {t('settings.ptt.conflict', {
              shortcut: shortcutConflict.accelerator,
              previous: shortcutConflict.fallback ?? t('common.none'),
            })}
          </p>
          <button
            type="button"
            className="button button--compact"
            onClick={() => setShortcutConflict(null)}
          >
            {t('common.close')}
          </button>
        </div>
      ) : null}

      {screen === 'rooms' ? (
        <RoomList
          locale={locale}
          discovery={discovery}
          onJoin={(roomId, roomName) => void joinRoom(roomId, roomName)}
          onRefresh={() => void refreshRooms()}
        />
      ) : (
        <Room
          locale={locale}
          room={room}
          participants={participants}
          control={control}
          maxParticipants={MAX_ROOM_PARTICIPANTS}
          shortcut={settings.talk.pttAccelerator}
          onMute={(muted) => void api.setMute(muted)}
          onDeafen={(deafened) => void api.setDeafen(deafened)}
          onPushToTalk={(active) => void api.setPushToTalk(active)}
          onGain={(participantId, gain) => void api.setGain({ participantId, gain })}
          onLeave={() => void leaveRoom()}
        />
      )}

      {settingsOpen ? (
        <SettingsPanel
          settings={settings}
          locale={locale}
          onChange={patchSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </main>
  );
}

interface RoomListProps {
  locale: Locale;
  /** État réel de la découverte : `rooms` vient de `discoverRooms()` / `onRoomsDiscovered`. */
  discovery: DiscoveryState;
  onJoin: (roomId: string, roomName: string) => void;
  onRefresh: () => void;
}

/**
 * Liste des salons (E1). La découverte appartient au main : cet écran n'affiche que ce que l'IPC
 * lui envoie (`RoomSummaryDto`), et ne fabrique aucun salon fictif. Quatre états distincts :
 * chargement, liste vide, N salons, erreur.
 */
export function RoomList({ locale, discovery, onJoin, onRefresh }: RoomListProps): JSX.Element {
  const t = createTranslator(locale);
  const [draftName, setDraftName] = useState('');
  const { phase, rooms, error: discoveryError } = discovery;
  const busy = phase !== 'ready';

  const status =
    phase === 'loading'
      ? t('discovery.state.searching')
      : phase === 'refreshing'
        ? t('discovery.state.refreshing')
        : rooms.length === 0
          ? t('discovery.empty.title')
          : t(rooms.length === 1 ? 'discovery.state.count.one' : 'discovery.state.count.other', {
              count: rooms.length,
            });

  return (
    <section className="panel" aria-labelledby="rooms-title">
      <h2 id="rooms-title" className="panel__title">
        {t('room.list.title')}
      </h2>

      <p className="panel__status" role="status">
        {status}
      </p>

      {discoveryError !== null ? (
        <div className="empty" role="alert">
          <p className="empty__title">{t('discovery.error.alldown.title')}</p>
          <p className="empty__body">{discoveryError}</p>
          <button type="button" className="button" onClick={onRefresh}>
            {t('common.retry')}
          </button>
        </div>
      ) : rooms.length === 0 ? (
        <div className="empty">
          <p className="empty__title">
            {phase === 'loading' ? t('discovery.state.searching') : t('discovery.empty.title')}
          </p>
          <p className="empty__body">
            {phase === 'loading' ? t('discovery.state.searchingHint') : t('discovery.empty.body')}
          </p>
        </div>
      ) : (
        <ul className="room-list">
          {rooms.map((room) => (
            <li key={room.roomId} className="room-list__row">
              <span className="room-list__name" title={t('room.row.host', { name: room.host })}>
                {room.roomName}
              </span>
              <span className="room-list__members">
                {t('room.row.members', { count: room.participantCount })}
              </span>
              <button
                type="button"
                className="button"
                onClick={() => onJoin(room.roomId, room.roomName)}
              >
                {room.participantCount >= MAX_ROOM_PARTICIPANTS
                  ? t('room.row.full')
                  : t('room.row.join')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="panel__footer">
        <label className="field">
          <span className="field__label">{t('room.create.nameLabel')}</span>
          <input
            className="input"
            value={draftName}
            maxLength={32}
            placeholder={t('room.create.namePlaceholder')}
            onChange={(event) => setDraftName(event.target.value)}
          />
        </label>
        <button type="button" className="button" onClick={onRefresh} disabled={busy}>
          {t('common.refresh')}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={draftName.trim().length === 0}
          onClick={() => onJoin(draftName.trim(), draftName.trim())}
        >
          {t('room.create.confirm')}
        </button>
      </div>
    </section>
  );
}
