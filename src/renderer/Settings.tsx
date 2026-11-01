/**
 * Settings.tsx — panneau de réglages : micro, seuil VAD, mode PTT / détection de voix, périphériques,
 * overlay, raccourci global.
 *
 * Les valeurs manipulées sont celles de `../shell/settings-schema` (validées en amont par le process
 * principal : un patch hors bornes est refusé, pas corrigé en silence). Les bornes affichées
 * proviennent des mêmes constantes, jamais de littéraux locaux.
 *
 * La capture du raccourci se fait au clavier, puis `isValidAccelerator` refuse un raccourci sans
 * modificateur : un PTT sur `F5` seul serait un piège.
 *
 * NON VÉRIFIÉ ici : React non installable dans cet environnement (voir la livraison T3).
 */

import { useEffect, useRef, useState } from 'react';

import {
  DEFAULT_PTT_ACCELERATOR,
  OVERLAY_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  SIGNALING_PORT_DEFAULT,
  type OverlayScale,
  type Settings,
  type SettingsPatch,
  type TalkMode,
} from '../shell/settings-schema';
import { isValidAccelerator, normalizeAccelerator } from '../shell/settings-schema';
import type { LobbyStatusDto, RoomStateDto, UpdateStateDto } from '../shell/ipc-contract';
import { createTranslator, type Locale } from './i18n';
import { lanApi } from './api';

export interface SettingsPanelProps {
  settings: Settings;
  locale: Locale;
  /**
   * L'état du salon, tel que le process principal l'a publié : c'est la SEULE source du port de
   * signalisation (celui qu'on écoute, ou celui lu dans l'annonce de l'hôte) et de l'identité
   * éphémère de session. Rien n'est déduit ici des réglages : SPEC-002 D1 interdit d'afficher un port
   * qu'on n'a pas lu, et `settings.network.signalingPort` n'est pas le port utilisé.
   */
  session: RoomStateDto;
  /**
   * La vue du pied de lobby, lue du main (port, méthode, santé). L'onglet Réseau s'en sert pour la
   * ligne « Découverte » : la méthode RÉELLEMENT en service, jamais une méthode supposée
   * (SPEC-002 S3.15 — hors-ligne, le main rend `'none'`, et c'est ce qui s'affiche).
   */
  lobbyStatus: LobbyStatusDto;
  onChange: (patch: SettingsPatch) => Promise<void> | void;
  onClose: () => void;
}

interface DeviceOption {
  id: string;
  label: string;
}

/** Énumération locale des périphériques (aucune requête réseau). */
async function listDevices(kind: MediaDeviceKind): Promise<DeviceOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === kind)
    .map((device, index) => ({ id: device.deviceId, label: device.label || `#${index + 1}` }));
}

function acceleratorFromEvent(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Super');
  const key = event.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
  const normalizedKey = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
  return [...modifiers, normalizedKey].join('+');
}

/** Traduit un nom de périphérique rendu vide par `enumerateDevices()` (permission manquante). */
function deviceLabelOrNone(label: string, noneLabel: string, index: number): string {
  return label !== '' && label !== `#${index + 1}` ? label : noneLabel;
}

type Translator = (key: string, params?: Record<string, string | number>) => string;

/**
 * L'état de la machine de mise à jour, rendu HONNÊTEMENT depuis la dernière publication du main
 * (avenant SPEC-006b, 2026-11-01). `null` (rien de publié) rend la ligne muette — pas de « à jour »
 * sans mesure (SPEC-002 D1). `downloading` affiche le pourcentage publié ; `failed` dit la raison
 * lisible du main, jamais un code ; `downloaded` avec une raison porte la commande du `.deb`
 * (rendue à côté par l'appelant).
 */
function updateStatusLabel(t: Translator, state: UpdateStateDto | null): string {
  if (state === null) return '';
  switch (state.state) {
    case 'checking':
      return t('update.checking');
    case 'up-to-date':
      return t('update.upToDate');
    case 'available':
      return state.version === null ? '' : t('update.available', { version: state.version });
    case 'downloading':
      return t('update.downloading', { percent: state.percent ?? 0 });
    case 'downloaded':
      return t('update.ready');
    case 'failed':
      return t('update.failed', { reason: state.reason ?? '' });
    case 'disabled':
      // La dérogation est coupée (réglage `auto=false`) : le cycle cadencé ne sort plus du LAN.
      return t('update.settings.auto');
    default:
      // `idle`/`installing` : rien à affirmer tant que la machine ne l'a pas dit autrement.
      return '';
  }
}

export function SettingsPanel({ settings, locale, session, lobbyStatus, onChange, onClose }: SettingsPanelProps): JSX.Element {
  const t = createTranslator(locale);
  const [inputs, setInputs] = useState<DeviceOption[]>([]);
  const [outputs, setOutputs] = useState<DeviceOption[]>([]);
  const [recording, setRecording] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);
  const [shortcutDraft, setShortcutDraft] = useState<string>(settings.talk.pttAccelerator);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  // Message d'annonce (S3.6 : la séquence finale enregistrée s'annonce). Il vit dans la région
  // `aria-live` du pied du lobby — le panneau ne rend que l'annonce, l'appelant tient la région.
  const [announcement, setAnnouncement] = useState<string | null>(null);
  // Mises à jour (avenant SPEC-006b, 2026-11-01) : la dernière publication du main, rendue
  // honnêtement — `null` tant que rien n'a été publié, jamais un état inventé au montage.
  const [updateState, setUpdateState] = useState<UpdateStateDto | null>(null);
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = lanApi().onUpdateState(setUpdateState);
    } catch {
      // Main absent (document hors application) : rien à publier, la section reste muette.
    }
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    void listDevices('audioinput').then(setInputs);
    void listDevices('audiooutput').then(setOutputs);
  }, []);

  const audioPatch = (patch: Partial<Settings['audio']>): void => {
    void onChange({ audio: { ...settings.audio, ...patch } });
  };
  const talkPatch = (patch: Partial<Settings['talk']>): void => {
    void onChange({ talk: { ...settings.talk, ...patch } });
  };
  const overlayPatch = (patch: Partial<Settings['overlay']>): void => {
    void onChange({ overlay: { ...settings.overlay, ...patch } });
  };
  // Mises à jour (2026-11-01) : patch partiel sans propagation des mesures. `checkedAt` et
  // `lastSeenVersion` sont des MESURES du service : le copier `{...settings.update, ...}` les
  // reciterait au main comme une ecriture du renderer — refusee par `applySettingsPatch`. Seule
  // l'interrupteur `auto` est un reglage ; le patch ne nomme que lui.
  const updatePatch = (auto: boolean): void => {
    void onChange({ update: { auto } });
  };

  // Le PTT global est-il RÉELLEMENT tenu par le système ? L'unique fait mesuré disponible côté
  // renderer est le message publié par le main quand `globalShortcut.register()` a refusé le
  // raccourci demandé (canal `onShortcutConflict`, émis à l'enregistrement puis à chaque
  // changement d'accélérateur). Tant qu'aucune mesure n'est tombée, aucune étiquette : « Actif »
  // sans preuve serait un mensonge (SPEC-002 D1). `lanApi()` est appelé dans un `try/catch` :
  // hors application (document ouvert dans un navigateur de développement), il lève — rien à
  // mesurer, rien à afficher, et le panneau reste utilisable.
  const [pttConflict, setPttConflict] = useState(false);
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = lanApi().onShortcutConflict(() => setPttConflict(true));
    } catch {
      // Main absent : pas de mesure possible, l'étiquette reste éteinte.
    }
    return () => unsubscribe?.();
  }, []);
  useEffect(() => {
    // Un changement d'accélérateur est une nouvelle tentative d'enregistrement : la mesure
    // précédente ne décrit plus le raccourci courant, on repart de « non mesuré ».
    setPttConflict(false);
  }, [settings.talk.pttAccelerator]);
  // Preuve du refus (message du main) → « Inactif ». Aucune preuve → rien. L'étiquette positive
  // (« le raccourci est tenu ») n'est JAMAIS rendue ici : rien, côté renderer, ne mesure qu'un
  // raccourci global est bien enregistré — tant que le main ne publie pas l'état d'enregistrement,
  // un libellé optimiste est supprimé plutôt qu'aligné sur une absence de mesure (SPEC-002 D1).
  const shortcutStatusKey = pttConflict ? 'settings.ptt.inactive' : null;
  useEffect(() => {
    if (recording) captureRef.current?.focus();
  }, [recording]);
  useEffect(() => {
    // Escape cancels a shortcut recording first; only otherwise does it close the panel.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (recording) setRecording(false);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, recording]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="sheet__header">
        <h2 id="settings-title" className="sheet__title">
          {t('settings.title')}
        </h2>
        <button type="button" className="button button--compact" onClick={onClose}>
          {t('settings.close')}
        </button>
      </header>

      <div className="sheet__body">
        {/* --- Périphériques et traitement audio --------------------------------------------- */}
        <section className="sheet__section" aria-labelledby="settings-audio">
          <h3 id="settings-audio" className="sheet__section-title">
            {t('settings.tab.audio')}
          </h3>

          <label className="field">
            <span className="field__label">{t('settings.audio.input')}</span>
            <select
              className="input"
              value={settings.audio.inputDeviceId ?? ''}
              onChange={(event) => audioPatch({ inputDeviceId: event.target.value || null })}
            >
              <option value="">{t('settings.audio.systemDefault')}</option>
              {inputs.map((device, index) => (
                <option key={device.id} value={device.id}>
                  {deviceLabelOrNone(device.label, t('settings.audio.inputNone'), index)}
                </option>
              ))}
            </select>
            {inputs.length === 0 ? <span className="field__help">{t('settings.audio.inputNoneHelp')}</span> : null}
          </label>

          <label className="field">
            <span className="field__label">{t('settings.audio.output')}</span>
            <select
              className="input"
              value={settings.audio.outputDeviceId ?? ''}
              onChange={(event) => audioPatch({ outputDeviceId: event.target.value || null })}
            >
              <option value="">{t('settings.audio.systemDefault')}</option>
              {outputs.map((device, index) => (
                <option key={device.id} value={device.id}>
                  {deviceLabelOrNone(device.label, t('settings.audio.outputNone'), index)}
                </option>
              ))}
            </select>
            {outputs.length === 0 ? <span className="field__help">{t('settings.audio.outputNoneHelp')}</span> : null}
          </label>

          <label className="field field--inline">
            <input
              type="checkbox"
              checked={settings.audio.noiseSuppression}
              onChange={(event) => audioPatch({ noiseSuppression: event.target.checked })}
            />
            <span className="field__label">{t('settings.audio.rnnoise')}</span>
            <span className="field__help">{t('settings.audio.rnnoiseHelp')}</span>
          </label>

          <label className="field field--inline">
            <input
              type="checkbox"
              checked={settings.audio.echoCancellation}
              onChange={(event) => audioPatch({ echoCancellation: event.target.checked })}
            />
            <span className="field__label">{t('settings.audio.aec')}</span>
            <span className="field__help">{t('settings.audio.aecHelp')}</span>
          </label>

          {/* Ducking (2026-11-01) : un seul interrupteur, activé par défaut — rien à régler. */}
          <label className="field field--inline">
            <input
              type="checkbox"
              checked={settings.audio.duckOthers}
              onChange={(event) => audioPatch({ duckOthers: event.target.checked })}
            />
            <span className="field__label">{t('settings.audio.duck.others')}</span>
            <span className="field__help">{t('settings.audio.duck.help')}</span>
          </label>

          <label className="field">
            <span className="field__label">
              {t('settings.audio.level')} — {t('common.percent', { value: Math.round(settings.audio.inputGain * 100) })}
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.audio.inputGain}
              onChange={(event) => audioPatch({ inputGain: Number(event.target.value) })}
            />
          </label>

          <div className="field">
            <span className="field__label">{t('settings.audio.mode')}</span>
            <div className="segmented" role="group" aria-label={t('settings.audio.mode')}>
              {(['ptt', 'vad'] as TalkMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="button button--toggle"
                  aria-pressed={settings.talk.mode === mode}
                  onClick={() => talkPatch({ mode })}
                >
                  {mode === 'ptt' ? t('control.mode.ptt') : t('control.mode.vad')}
                </button>
              ))}
            </div>
            <span className="field__help">{t('settings.audio.modeHelp')}</span>
          </div>
        </section>

        {/* --- Détection de voix ------------------------------------------------------------ */}
        <section className="sheet__section" aria-labelledby="settings-vad">
          <h3 id="settings-vad" className="sheet__section-title">
            {t('settings.vad.title')}
          </h3>
          <label className="field">
            <span className="field__label">
              {t('settings.vad.threshold')} —{' '}
              {t('settings.vad.thresholdValue', { db: settings.talk.vadThresholdDb })}
            </span>
            <input
              type="range"
              min={-80}
              max={-10}
              step={1}
              value={settings.talk.vadThresholdDb}
              disabled={settings.talk.mode !== 'vad'}
              onChange={(event) => talkPatch({ vadThresholdDb: Number(event.target.value) })}
            />
            <span className="field__help">{t('settings.vad.help')}</span>
          </label>
        </section>

        {/* --- Raccourci push-to-talk global ------------------------------------------------ */}
        <section className="sheet__section" aria-labelledby="settings-ptt">
          <h3 id="settings-ptt" className="sheet__section-title">
            {t('settings.ptt.title')}
          </h3>
          <div className="field">
            <span className="field__label">{t('settings.ptt.current')}</span>
            <div className="shortcut">
              <kbd className="shortcut__keys">{settings.talk.pttAccelerator}</kbd>
              {shortcutStatusKey ? (
                // État mesuré du raccourci global (voir le commentaire de l'état plus haut) —
                // jamais une déduction du simple fait que le réglage porte une valeur.
                <span className="field__help">{t(shortcutStatusKey)}</span>
              ) : null}
              <button
                type="button"
                className="button button--compact"
                onClick={() => {
                  setRecording(true);
                  setShortcutError(null);
                }}
              >
                {recording ? t('settings.ptt.recording') : t('settings.ptt.change')}
              </button>
              <button
                type="button"
                className="button button--compact"
                onClick={() => {
                  setShortcutDraft(DEFAULT_PTT_ACCELERATOR);
                  talkPatch({ pttAccelerator: DEFAULT_PTT_ACCELERATOR });
                }}
              >
                {t('settings.ptt.reset', { shortcut: DEFAULT_PTT_ACCELERATOR })}
              </button>
            </div>
            <input
              ref={captureRef}
              className="input shortcut__capture"
              aria-label={t('settings.ptt.recording')}
              readOnly
              value={recording ? shortcutDraft : ''}
              placeholder={t('settings.ptt.recording')}
              onKeyDown={(event) => {
                if (!recording) return;
                event.preventDefault();
                if (event.key === 'Escape') {
                  setRecording(false);
                  setShortcutError(null);
                  return;
                }
                const candidate = acceleratorFromEvent(event);
                if (!candidate) return;
                if (!isValidAccelerator(candidate)) {
                  setShortcutError(t('settings.ptt.needModifier'));
                  return;
                }
                const normalized = normalizeAccelerator(candidate);
                setShortcutDraft(normalized);
                setRecording(false);
                setShortcutError(null);
                // La séquence finale est annoncée (S3.6) : `aria-live="assertive"` inline, comme
                // le prescrit l'état (pas de region live concurrente : l'annonce vit ici).
                setAnnouncement(t('settings.ptt.recorded', { shortcut: normalized }));
                talkPatch({ pttAccelerator: normalized });
              }}
              onBlur={() => setRecording(false)}
            />
            {shortcutError ? (
              <span className="field__error" role="alert">
                {shortcutError}
              </span>
            ) : null}
            <span className="field__help">{t('settings.ptt.globalHelp')}</span>
            {/* S3.6 : la zone de capture annonce la séquence finale dans une région
                `aria-live="assertive"` — ici, inline, sous la zone. */}
            <span className="field__help" aria-live="assertive">
              {announcement ?? ''}
            </span>
          </div>
        </section>

        {/* --- Overlay ---------------------------------------------------------------------- */}
        <section className="sheet__section" aria-labelledby="settings-overlay">
          <h3 id="settings-overlay" className="sheet__section-title">
            {t('settings.tab.overlay')}
          </h3>

          <label className="field field--inline">
            <input
              type="checkbox"
              checked={settings.overlay.enabled}
              onChange={(event) => overlayPatch({ enabled: event.target.checked })}
            />
            <span className="field__label">{t('settings.overlay.enabled')}</span>
          </label>

          <label className="field">
            <span className="field__label">
              {t('settings.overlay.opacity')} —{' '}
              {t('settings.overlay.opacityValue', { percent: Math.round(settings.overlay.opacity * 100) })}
            </span>
            <input
              type="range"
              min={OVERLAY_OPACITY_MIN}
              max={OVERLAY_OPACITY_MAX}
              step={0.05}
              value={settings.overlay.opacity}
              onChange={(event) => overlayPatch({ opacity: Number(event.target.value) })}
            />
          </label>

          <div className="field">
            <span className="field__label">{t('settings.overlay.scale')}</span>
            <div className="segmented" role="group" aria-label={t('settings.overlay.scale')}>
              {(['sm', 'md', 'lg'] as OverlayScale[]).map((scale) => (
                <button
                  key={scale}
                  type="button"
                  className="button button--toggle"
                  aria-pressed={settings.overlay.scale === scale}
                  onClick={() => overlayPatch({ scale })}
                >
                  {t(`settings.overlay.scale.${scale}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">
              {t('settings.overlay.screen')} —{' '}
              {settings.overlay.screenId
                ? t('settings.overlay.screen.n', { n: settings.overlay.screenId })
                : t('settings.overlay.screen.n', { n: 1 })}
            </span>
          </div>

          <div className="field">
            <span className="field__label">{t('settings.overlay.position')}</span>
            <button
              type="button"
              className="button button--compact"
              onClick={() => overlayPatch({ position: null })}
            >
              {t('settings.overlay.positionReset')}
            </button>
            {!settings.overlay.enabled ? (
              <span className="field__help">{t('settings.overlay.disabledHint')}</span>
            ) : null}
          </div>
          {/* Aide permanente de la section (SPEC-002 S3.12) : rappel du contrat de l'incrustat —
              jamais de focus, clics traversants, seule la poignée répond. */}
          <span className="field__help">{t('settings.overlay.help')}</span>
        </section>

        {/* --- Réseau ----------------------------------------------------------------------- */}
        <section className="sheet__section" aria-labelledby="settings-network">
          <h3 id="settings-network" className="sheet__section-title">
            {t('settings.tab.network')}
          </h3>
          {/* Nom sur le réseau : la MÊME source que le champ pseudo de E1 (réglage `nickname`) —
              deux éditeurs d'un même fait, alignés par le réglage, pas recopiés l'un dans l'autre
              (S3.15 : « même source que E1 »). Lecture seule ici : on le change dans le lobby. */}
          <p className="field">
            <span className="field__label">{t('settings.network.name')}</span>
            <span className="field__value">{settings.nickname === '' ? t('common.none') : settings.nickname}</span>
          </p>
          {/* Découverte : l'état RÉEL du service, mesuré par le main (la santé remontée par le
              bridge pilote déjà le bandeau et le pied du lobby). « Activé » dit qu'une interface
              réseau est présente et la découverte en service ; « Désactivé » dit le contraire.
              La MÉTHODE (mDNS) ne s'affiche pas ici : elle est déjà dans le pied du lobby, et la
              répéter sous un libellé « active » sans nommer la méthode serait une promesse de
              plus que la mesure n'en porte (S3.15). */}
          <p className="field">
            <span className="field__label">{t('settings.network.discovery')}</span>
            <span className="field__value">
              {lobbyStatus.health === 'offline' ? t('common.off') : t('common.on')}
            </span>
          </p>
          <p className="field">
            <span className="field__label">{t('settings.network.port')}</span>
            <span className="field__value">
              {session.signalingPort === null
                ? t('common.none')
                : String(session.signalingPort)}
            </span>
            <span className="field__help">{t('settings.network.externalHelp')}</span>
          </p>
          {session.signalingPort !== null &&
          session.signalingPort !== SIGNALING_PORT_DEFAULT ? (
            <p className="field__help field__help--warn">
              {t('settings.network.portBumped', {
                default: String(SIGNALING_PORT_DEFAULT),
                port: String(session.signalingPort),
              })}
            </p>
          ) : null}
          <p className="field field--safe">{t('settings.network.externalNone')}</p>
          {/*
            « Identité de session » = l'identifiant ÉPHÉMÈRE attribué par la signalisation
            (`RoomStateDto.selfId`), pas le pseudo : le pseudo est le nom affiché sur le réseau (déjà
            dans la barre de titre), et SPEC-001 A5/A6 dit que l'identité d'un pair est son identifiant
            d'instance éphémère. La ligne affichait un pseudo suivi de deux CONSTANTES (8, 47821)
            présentées comme des faits de session.
          */}
          <p className="field">
            <span className="field__label">{t('settings.network.identity')}</span>
            <span className="field__value">
              {session.selfId === null ? t('common.none') : session.selfId}
            </span>
            <span className="field__help">{t('settings.network.identityHelp')}</span>
          </p>
        </section>

        {/* --- Mise à jour (avenant SPEC-006b, 2026-11-01) ---------------------------------- */}
        <section className="sheet__section" aria-labelledby="settings-update">
          <h3 id="settings-update" className="sheet__section-title">
            {t('update.settings.title')}
          </h3>

          <label className="field field--inline">
            <input
              type="checkbox"
              checked={settings.update.auto}
              onChange={(event) => {
                // Patch partiel : SEULE la cle modifiee est nommee. Propager les mesures par copie
                // serait une ecriture du renderer — le contrat la refuse (`applySettingsPatch`).
                void onChange({ update: { auto: event.target.checked } });
              }}
            />
            <span className="field__label">{t('update.settings.auto')}</span>
            <span className="field__help">{t('update.settings.help')}</span>
          </label>

          <div className="field">
            <span className="field__label">{updateStatusLabel(t, updateState)}</span>
            {/* Bouton forcer le check : désactivé PENDANT un cycle (checking/downloading) — le main
                ignore la reentrance, l'UI le dit plutôt que de laisser croire à un second essai. */}
            <button
              type="button"
              className="button button--compact"
              disabled={updateState !== null && (updateState.state === 'checking' || updateState.state === 'downloading')}
              onClick={() => {
                try {
                  void lanApi().checkForUpdatesNow();
                } catch {
                  // Main absent : rien à vérifier, le bouton ne ment pas sur ce qu'il n'a pas fait.
                }
              }}
            >
              {t('update.checkNow')}
            </button>
            {/* Installation immédiate quand l'artefact est prêt (la machine refuse elle-même en
                salon actif ; l'UI masque en plus sous le même nez, la mesure vient du main). */}
            {updateState !== null && updateState.state === 'downloaded' ? (
              <button
                type="button"
                className="button button--primary button--compact"
                disabled={session.roomId !== null}
                onClick={() => {
                  try {
                    void lanApi().installUpdateNow();
                  } catch {
                    // Main absent : aucun installateur à lancer.
                  }
                }}
              >
                {t('update.installNow')}
              </button>
            ) : null}
            {/* Le `.deb` téléchargé rend sa commande (publiée par le main dans `reason`), jamais
                un faux « installing » : l'UI ne l'invente pas, elle n'affiche que ce qui l'est. */}
            {updateState !== null && updateState.state === 'downloaded' && updateState.reason !== null ? (
              <code className="field__value">{updateState.reason}</code>
            ) : null}
            <span className="field__help">
              {settings.update.checkedAt === null
                ? t('update.settings.lastCheck', { date: t('common.none') })
                : t('update.settings.lastCheck', {
                    date: new Date(settings.update.checkedAt).toLocaleString(
                      locale === 'fr' ? 'fr-FR' : 'en-US',
                    ),
                  })}
            </span>
          </div>
        </section>
      </div>

      <footer className="sheet__footer">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void lanApi().openSettings()}
        >
          {t('settings.about.local')}
        </button>
      </footer>
    </div>
  );
}
