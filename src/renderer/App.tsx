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
import { MAX_ROOM_PARTICIPANTS, type Settings } from '../shell/settings-schema';
import { lanApi } from './api';
import { createTranslator, type Locale } from './i18n';
import { Room } from './Room';
import { SettingsPanel } from './Settings';
import { applyTheme, watchSystemTheme } from './theme';

type Screen = 'rooms' | 'room';

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
    async (roomId: string) => {
      if (!settings) return;
      try {
        const state = await api.joinRoom({ roomId, name: settings.nickname || roomId });
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
          <span className="titlebar__identity">{settings.nickname || t('common.none')}</span>
          <button type="button" className="button" onClick={() => setSettingsOpen(true)}>
            {t('settings.title')}
          </button>
        </div>
      </header>

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
          onJoin={joinRoom}
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
  onJoin: (roomId: string) => void;
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
                onClick={() => onJoin(room.roomId)}
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
          onClick={() => onJoin(draftName.trim())}
        >
          {t('room.create.confirm')}
        </button>
      </div>
    </section>
  );
}
