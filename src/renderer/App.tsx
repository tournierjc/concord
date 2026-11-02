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
  LobbyStatusDto,
  ParticipantDto,
  RoomStateDto,
  RoomSummaryDto,
  ShortcutConflictDto,
  UpdateStateDto,
} from '../shell/ipc-contract';
import {
  groupDiscoveredRooms,
  lobbyFooterView,
  resolveCreateRoomAction,
} from '../shell/lobby-state';
import {
  NICKNAME_MAX_LENGTH,
  type NicknameError,
  nicknameError,
  nicknameErrorKey,
} from '../shell/nickname';
import {
  AVATAR_GALLERY,
  avatarInitials,
  customAvatarRef,
} from '../shell/avatar';
import { MAX_ROOM_PARTICIPANTS, type Settings, type SettingsPatch } from '../shell/settings-schema';
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
  // Hors salon, aucun port n'a été lu : l'UI dit « aucun » au lieu d'afficher un chiffre supposé.
  signalingPort: null,
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

const EMPTY_LOBBY_STATUS: LobbyStatusDto = { port: null, method: 'mdns', health: 'ok' };

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
  /** Le réglage `avatar` courant (SPEC-002, amendement 2026-10-31). */
  avatar: Settings['avatar'];
  onAvatarChange: (avatar: Settings['avatar']) => void;
}

function IdentityRow({ value, locale, onChange, onSaved, avatar, onAvatarChange }: IdentityRowProps): JSX.Element {
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
      <AvatarPicker locale={locale} avatar={avatar} onChange={onAvatarChange} fallbackSeed={draft} />
    </div>
  );
}

/**
 * AvatarPicker — la grille de la galerie embarquée + le bouton « Choisir une image »
 * (SPEC-002, amendement 2026-10-31). Aucun compte, aucune adresse : la galerie est embarquée
 * dans l'application et une image personnalisée est redimensionnée et stockée LOCALEMENT par le
 * main — l'avatar ne quitte pas le réseau local.
 */
function AvatarPicker({
  locale,
  avatar,
  onChange,
  fallbackSeed,
}: {
  locale: Locale;
  avatar: Settings['avatar'];
  onChange: (avatar: Settings['avatar']) => void;
  fallbackSeed: string;
}): JSX.Element {
  const t = createTranslator(locale);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [customPreview, setCustomPreview] = useState<string | null>(null);
  const customRef = customAvatarRef(avatar);

  // L'aperçu de l'image personnalisée vient du main (PNG validé, encodé en base64). Une empreinte
  // que le main ne connaît pas rend `null` : on retombe sur les initiales, on n'invente rien.
  useEffect(() => {
    if (customRef === null) {
      setCustomPreview(null);
      return;
    }
    let live = true;
    void lanApi()
      .getAvatarImage(customRef)
      .then((png) => {
        if (live) setCustomPreview(png);
      })
      .catch(() => {
        if (live) setCustomPreview(null);
      });
    return () => {
      live = false;
    };
  }, [customRef]);

  const pickImage = (): void => {
    setUploading(true);
    setUploadError(null);
    void lanApi()
      .chooseAvatar()
      .then((result) => {
        setUploading(false);
        if (result.ok) {
          onChange(result.avatar);
          return;
        }
        if (result.reason !== 'cancelled') {
          setUploadError(t(`app.avatar.upload.error.${result.reason}`));
        }
      })
      .catch(() => {
        setUploading(false);
        setUploadError(t('app.avatar.upload.error.unreadable'));
      });
  };

  return (
    <div className="identity__avatars">
      <span className="field__label">{t('app.avatar.label')}</span>
      <div className="avatar-grid" role="group" aria-label={t('app.avatar.label')}>
        {AVATAR_GALLERY.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className="avatar-grid__cell"
            aria-pressed={avatar === choice.id}
            title={choice.id}
            onClick={() => {
              setUploadError(null);
              onChange(choice.id);
            }}
          >
            <span aria-hidden="true">{choice.emoji}</span>
            <span className="visually-hidden">{choice.id}</span>
          </button>
        ))}
        <button
          type="button"
          className="avatar-grid__cell avatar-grid__cell--custom"
          aria-pressed={customRef !== null}
          title={t('app.avatar.upload.button')}
          onClick={pickImage}
          disabled={uploading}
        >
          {customRef !== null && customPreview !== null ? (
            <img className="avatar-grid__image" src={`data:image/png;base64,${customPreview}`} alt="" aria-hidden="true" />
          ) : (
            <span aria-hidden="true">{avatarInitials(fallbackSeed)}</span>
          )}
          <span className="visually-hidden">{t('app.avatar.upload.button')}</span>
        </button>
      </div>
      <div className="identity__avatar-actions">
        <button type="button" className="button button--compact" onClick={pickImage} disabled={uploading}>
          {uploading ? t('app.avatar.upload.busy') : t('app.avatar.upload.button')}
        </button>
        {avatar !== null ? (
          <button
            type="button"
            className="button button--compact button--ghost"
            onClick={() => {
              setUploadError(null);
              onChange(null);
            }}
          >
            {t('app.avatar.clear')}
          </button>
        ) : null}
      </div>
      <span className="field__help">{t('app.avatar.help')}</span>
      {uploadError ? (
        <span className="field__error" role="alert">
          {uploadError}
        </span>
      ) : null}
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
  // Pied de lobby : les trois mesures du main (port lu, méthode, santé), jamais recomposées ici.
  const [lobbyStatus, setLobbyStatus] = useState<LobbyStatusDto>(EMPTY_LOBBY_STATUS);
  // Notification du main : `openProfile()` a été demandé (bouton d'identité, puis panneau complet
  // sur `feature/profile-lobby`). Le champ `IdentityRow` ci-dessous est l'éditeur de pseudo HISTORIQUE
  // de `main` (SPEC-002 S1.11, gardé par tests/identity-row.node.test.ts) : il reste la voie de saisie
  // en attendant le panneau. La branche `feature/profile-lobby` le remplacera par son panneau (pseudo +
  // avatar + upload) — la fusion se fait SUR CE BLOC, pas autour : ne pas dupliquer un second champ ici.
  const openProfile = useCallback(() => {
    void api.openProfile().catch(() => {
      // Le main est absent (document hors application) : rien à ouvrir, rien à crier.
    });
  }, [api]);

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
      api.onDiscoveryStatus(({ health }) => {
        // La santé pilote le bandeau ET la méthode du pied — les deux viennent du même instantané
        // du main. On ne fusionne pas l'objet : `{ port, method, health }` arrive ensemble, et une
        // fusion laisserait `method` en retard d'un tour sur `health`.
        setLobbyStatus((previous) => ({ ...previous, health }));
        void api
          .getLobbyStatus()
          .then((status) => {
            if (active) setLobbyStatus(status);
          })
          .catch(() => {
            // Main injoignable : on garde la dernière vue connue plutôt que d'inventer une méthode.
          });
      }),
      api.onProfileOpen(() => {
        // The profile editor is the lobby's identity card (absent from the room screen).
        const input = document.getElementById('identity-input');
        input?.scrollIntoView({ block: 'nearest' });
        input?.focus();
      }),
      // Mises à jour (avenant SPEC-006b, 2026-11-01) : l'état de la machine du main, suivi en
      // direct. Le renderer ne DÉCIDE rien — il rend ce que le main publie, rien de plus.
      api.onUpdateState(setUpdateState),
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
      // Le pied de lobby suit la même cadence que la liste : le port effectif change quand un
      // salon s'ouvre ou se ferme, et seule la mesure du main le sait. Un pied figé à l'instant
      // du montage afficherait un port mort après un leave — la garantie « mesure » veut « à jour ».
      void api.getLobbyStatus().then((status) => {
        if (active) setLobbyStatus(status);
      }).catch(() => {
        // Main injoignable : on garde la dernière vue connue plutôt que d'inventer un port.
      });
    });
    void refreshRooms();
    // Le pied de lobby se rafraîchit avec la liste : le port effectif change quand un salon
    // s'ouvre ou se ferme, et le main est le seul à le connaître (mesure, jamais réglage).
    void api.getLobbyStatus().then((status) => {
      if (active) setLobbyStatus(status);
    }).catch(() => {
      // Main injoignable : on garde la dernière vue connue plutôt que d'inventer un port.
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api, refreshRooms]);

  // Toast de confirmation (S1.11 : `app.nickname.saved` à la sortie de champ). Il vit dans une
  // région `aria-live="polite"` et se referme tout seul ; l'horloge est celle de la page
  // (`browser-timers`), seul endroit autorisé à poser un minuteur côté renderer.
  const [toast, setToast] = useState<string | null>(null);
  // Mises à jour (avenant SPEC-006b, 2026-11-01) : la dernière publication du main, rien de plus.
  // `null` tant qu'aucun état n'est tombé — un bandeau sans publication serait une affirmation.
  const [updateState, setUpdateState] = useState<UpdateStateDto | null>(null);
  // Le bandeau peut être renvoyé par [Plus tard] sans que la machine du main change d'état :
  // c'est un choix d'affichage local, pas un fait mesuré, et il ne dure pas au-delà de l'état.
  const [updateDismissedAt, setUpdateDismissedAt] = useState<string | null>(null);
  useEffect(() => {
    if (toast === null) return undefined;
    const timers = browserTimers();
    const handle = timers.once(TOAST_MS, () => setToast(null));
    return () => timers.cancel(handle);
  }, [toast]);

  const patchSettings = useCallback(
    async (patch: SettingsPatch) => {
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
    // Le nom est lu AVANT l'appel : après le `leaveRoom()` du main, l'état rendu porte `null` et
    // le toast dirait « Vous avez quitté « » » — un libellé cassé vaut mieux l'éviter que le réparer.
    const leftName = room.roomName;
    const state = await api.leaveRoom();
    setRoom(state);
    setScreen('rooms');
    if (leftName !== null) setToast(t('room.leave.toast', { name: leftName }));
  }, [api, room.roomName, t]);

  // Bandeau de mise à jour (avenant SPEC-006b, 2026-11-01) : non bloquant, réservé aux états qui
  // demandent une attention — `available`, `downloading`, `downloaded`. Masqué PENDANT un salon
  // (la machine, elle, garde ses gardes) et après un [Plus tard] sur le MÊME état (clé = état +
  // version + pourcentage) : changer d'état fait réapparaître le bandeau tout seul.
  const updateBannerKey = (state: UpdateStateDto): string =>
    `${state.state}|${state.version ?? ''}|${state.percent ?? ''}`;
  const updateBannerVisible =
    updateState !== null &&
    (updateState.state === 'available' || updateState.state === 'downloading' || updateState.state === 'downloaded') &&
    room.roomId === null &&
    updateDismissedAt !== updateBannerKey(updateState);

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
          {screen === 'rooms' ? (
            <button type="button" className="button button--ghost identity-chip" onClick={openProfile}>
              {settings.nickname.trim().length > 0 ? settings.nickname.trim() : t('app.nickname.placeholder')}
            </button>
          ) : null}
          <button type="button" className="button" onClick={() => setSettingsOpen(true)}>
            {t('settings.title')}
          </button>
        </div>
      </header>

      {screen === 'rooms' && lobbyStatus.health !== 'ok' ? (
        <div className="banner banner--warning" role="status">
          <p>
            {lobbyStatus.health === 'offline'
              ? `${t('discovery.offline.title')} ${t('discovery.offline.body')}`
              : `${t('discovery.error.mdns.title')} ${t('discovery.error.mdns.body')}`}
          </p>
        </div>
      ) : null}

      {updateBannerVisible && updateState !== null ? (
        <div className="banner banner--info" role="status">
          <UpdateBanner
            locale={locale}
            state={updateState}
            onInstall={() => void api.installUpdateNow()}
            onDismiss={() => setUpdateDismissedAt(updateBannerKey(updateState))}
          />
        </div>
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
        <div className="lobby">
          <aside className="panel lobby__identity">
            <IdentityRow
              locale={locale}
              value={settings.nickname}
              onChange={(nickname) => void patchSettings({ nickname })}
              onSaved={() => setToast(t('app.nickname.saved'))}
              avatar={settings.avatar}
              onAvatarChange={(avatar) => void patchSettings({ avatar })}
            />
          </aside>
          <RoomList
            locale={locale}
            discovery={discovery}
            nickname={(settings?.nickname ?? '').trim()}
            lobbyStatus={lobbyStatus}
            hosting={room.roomId !== null}
            localRoom={{ roomId: room.roomId, participantCount: room.participantCount }}
            onJoin={(roomId, roomName) => void joinRoom(roomId, roomName)}
            onRefresh={() => void refreshRooms()}
          />
        </div>
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
          session={room}
          lobbyStatus={lobbyStatus}
          onChange={patchSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </main>
  );
}

interface UpdateBannerProps {
  locale: Locale;
  /** L'état publié par le main — le bandeau ne rend QUE ce qui a été publié. */
  state: UpdateStateDto;
  onInstall: () => void;
  onDismiss: () => void;
}

/**
 * Bandeau discret des mises à jour (avenant SPEC-006b, 2026-11-01) : il ne bloque rien et ne
 * décide rien. `available` annonce la version, `downloading` affiche le pourcentage publié par le
 * main, `downloaded` propose [Installer maintenant] (la machine refuse elle-même en salon actif —
 * le bandeau est déjà masqué en salon, le main reste l'autorité) et [Plus tard] le renvoie.
 */
function UpdateBanner({ locale, state, onInstall, onDismiss }: UpdateBannerProps): JSX.Element {
  const t = createTranslator(locale);
  return (
    <span className="banner__row">
      {state.state === 'available' && state.version !== null ? (
        <span>{t('update.available', { version: state.version })}</span>
      ) : null}
      {state.state === 'downloading' ? (
        <span>{t('update.downloading', { percent: state.percent ?? 0 })}</span>
      ) : null}
      {state.state === 'downloaded' ? <span>{t('update.ready')}</span> : null}
      {state.state === 'downloaded' ? (
        <button type="button" className="button button--primary button--compact" onClick={onInstall}>
          {t('update.installNow')}
        </button>
      ) : null}
      <button type="button" className="button button--compact" onClick={onDismiss}>
        {t('update.later')}
      </button>
    </span>
  );
}

interface RoomListProps {
  locale: Locale;
  /** État réel de la découverte : `rooms` vient de `discoverRooms()` / `onRoomsDiscovered`. */
  discovery: DiscoveryState;
  /** Pseudo local (rogné, vide si non saisi) : sert la suggestion « Salon de … ». */
  nickname: string;
  /** Les trois mesures du pied de lobby, lues du main (jamais recomposées ici). */
  lobbyStatus: LobbyStatusDto;
  /** Un salon est déjà ouvert sur CETTE machine : `[Créer]` est hors-jeu (S1.8). */
  hosting: boolean;
  /** Population réelle du salon local, substituée à l'annonce pour la ligne de CE poste. */
  localRoom: { roomId: string | null; participantCount: number };
  onJoin: (roomId: string, roomName: string) => void;
  onRefresh: () => void;
}

/**
 * Liste des salons (E1). La découverte appartient au main : cet écran n'affiche que ce que l'IPC
 * lui envoie (`RoomSummaryDto`), et ne fabrique aucun salon fictif. La liste est PERMANENTE —
 * elle reste affichée pendant la recherche et le rafraîchissement (S1.7 : aucune liste qui
 * disparaît sous les yeux), et le champ « créer » est un raccourci de REJOINDRE quand un salon
 * du réseau porte déjà le nom tapé (règle anti-doublon, `resolveCreateRoomAction`).
 */
export function RoomList({
  locale,
  discovery,
  nickname,
  lobbyStatus,
  hosting,
  localRoom,
  onJoin,
  onRefresh,
}: RoomListProps): JSX.Element {
  const t = createTranslator(locale);
  const [draftName, setDraftName] = useState('');
  const { phase, rooms, error: discoveryError } = discovery;
  const busy = phase !== 'ready';
  const offline = lobbyStatus.health === 'offline';
  const grouped = groupDiscoveredRooms(rooms, localRoom);
  // Un salon local déjà ouvert bloque la création (S1.8) — mais JAMAIS un clic « Rejoindre »
  // sur une ligne découverte : rejoindre un autre salon depuis le sien est un geste voulu.
  const action = resolveCreateRoomAction(
    { draft: draftName, alreadyHosting: hosting },
    grouped,
  );
  const footer = lobbyFooterView(lobbyStatus);

  const runCreateAction = (): void => {
    if (action.kind === 'join') {
      // Le nom part tel que le réseau l'affiche, pas tel qu'il a été tapé : deux postes qui
      // écrivent « salon cuisine » et « Salon Cuisine » rejoignent BIEN le même salon.
      onJoin(action.room.roomId, action.room.roomName);
      return;
    }
    if (action.kind === 'create') onJoin(action.name, action.name);
  };

  const status =
    phase === 'loading'
      ? t('discovery.state.searching')
      : phase === 'refreshing'
        ? t('discovery.state.refreshing')
        : grouped.length === 0
          ? t('discovery.empty.title')
          : t(grouped.length === 1 ? 'discovery.state.count.one' : 'discovery.state.count.other', {
              count: grouped.length,
            });

  return (
    <section className="panel" aria-labelledby="rooms-title">
      <div className="panel__heading">
        <h2 id="rooms-title" className="panel__title">
          {t('room.list.title')}
        </h2>
        <button type="button" className="button button--compact" onClick={onRefresh} disabled={busy}>
          {t('common.refresh')}
        </button>
      </div>

      {/* With no rooms the empty card below already says it: keep the live region for screen
          readers, but don't print the same sentence twice. */}
      <p className={grouped.length === 0 ? 'visually-hidden' : 'panel__status'} role="status" aria-live="polite">
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
      ) : grouped.length === 0 ? (
        <div className="empty" role="status">
          <p className="empty__title">
            {phase === 'loading'
              ? t('discovery.state.searching')
              : offline
                ? t('discovery.state.empty.offline')
                : t('discovery.empty.title')}
          </p>
          <p className="empty__body">
            {phase === 'loading'
              ? t('discovery.state.searchingHint')
              : offline
                ? t('discovery.offline.body')
                : t('discovery.empty.body')}
          </p>
        </div>
      ) : (
        // La liste reste rendue telle quelle même pendant un rafraîchissement (S1.7).
        <ul className="room-list">
          {grouped.map((room) => (
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
                aria-disabled={room.full}
                // Le bouton ne dit que « Rejoindre » / « Complet » (20 car. max, SPEC-002 §2.6) :
                // le détail — nom du salon, population réelle, plafond de 8 — passe par l'ARIA.
                aria-label={
                  room.full
                    ? t('room.row.fullAria', { name: room.roomName })
                    : t('room.row.joinAria', { name: room.roomName, count: room.participantCount })
                }
                onClick={() => {
                  if (!room.full) onJoin(room.roomId, room.roomName);
                }}
              >
                {room.full ? t('room.row.full') : t('room.row.join')}
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
            aria-describedby="room-create-help"
            // « Salon de {{name}} » : la moustache est REMPLIE avec le pseudo, ou pas d'indication
            // du tout quand le pseudo est vide (rendre « Salon de » serait un libellé cassé).
            placeholder={
              nickname.length > 0 ? t('room.create.namePlaceholder', { name: nickname }) : undefined
            }
            onChange={(event) => setDraftName(event.target.value)}
          />
          {/* Aide permanente du champ (SPEC-002 E1) : visible sur le réseau, 32 caractères — le
              compteur du pseudo existe déjà (`common.counter`), le plafond ici est statué par le
              `maxLength` ci-dessus, même borne, même message. */}
          <span className="field__help" id="room-create-help">
            {t('room.create.nameHelp')}
          </span>
          {action.kind === 'join' ? (
            // Le nom tapé existe déjà sur le réseau : c'est la promesse anti-hôte-doublon,
            // visible AVANT le clic, pas une erreur après.
            <span className="field__help" role="status">
              {t(action.messageKey)}
            </span>
          ) : null}
        </label>
        {/* Places : le plafond du maillage (8) est une CONSTANTE du schéma, pas une mesure — c'est
            ce que la création garantira, pas ce qu'un salon donné contient. */}
        <span className="field__help">{t('room.create.capacity')}</span>
        <button
          type="button"
          className="button button--primary"
          disabled={action.kind === 'blocked'}
          onClick={runCreateAction}
        >
          {action.kind === 'join' ? t('room.row.join') : t('room.create.confirm')}
        </button>
      </div>

      {/* LobbyFooter (SPEC-002 §3) : 32 px, bordure haute, `bg.surface`. Hors-ligne, le port et la
          recherche disparaissent (S1.10). La recherche est dite en langage clair — le mécanisme
          (mDNS, broadcast, port d'annonce) n'est pas une information utilisateur (0.4.2). */}
      <footer className="lobby-footer" aria-label={t('room.list.title')}>
        {footer.offline ? (
          <p className="lobby-footer__offline">{t(footer.offlineKey)}</p>
        ) : (
          <>
            <p className="lobby-footer__method">{t('discovery.footer.searching')}</p>
            <p className="lobby-footer__port">
              {footer.portKey === 'discovery.footer.port' && footer.port !== null
                ? t('discovery.footer.port', { port: footer.port })
                : t('discovery.footer.port.none')}
            </p>
          </>
        )}
      </footer>
    </section>
  );
}
