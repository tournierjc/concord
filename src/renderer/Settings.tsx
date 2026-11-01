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

import { useEffect, useState } from 'react';

import {
  DEFAULT_PTT_ACCELERATOR,
  OVERLAY_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  SIGNALING_PORT_DEFAULT,
  type OverlayScale,
  type Settings,
  type TalkMode,
} from '../shell/settings-schema';
import { isValidAccelerator, normalizeAccelerator } from '../shell/settings-schema';
import type { RoomStateDto } from '../shell/ipc-contract';
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
  onChange: (patch: Partial<Settings>) => Promise<void> | void;
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

export function SettingsPanel({ settings, locale, session, onChange, onClose }: SettingsPanelProps): JSX.Element {
  const t = createTranslator(locale);
  const [inputs, setInputs] = useState<DeviceOption[]>([]);
  const [outputs, setOutputs] = useState<DeviceOption[]>([]);
  const [recording, setRecording] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState<string>(settings.talk.pttAccelerator);
  const [shortcutError, setShortcutError] = useState<string | null>(null);

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
              {inputs.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
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
              {outputs.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
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
            <span className="field__label">{t('control.mode')}</span>
            <div className="segmented" role="group" aria-label={t('control.mode')}>
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
              className="input shortcut__capture"
              aria-label={t('settings.ptt.recording')}
              readOnly
              value={recording ? shortcutDraft : ''}
              placeholder={t('settings.ptt.recording')}
              onKeyDown={(event) => {
                if (!recording) return;
                event.preventDefault();
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
        </section>

        {/* --- Réseau ----------------------------------------------------------------------- */}
        <section className="sheet__section" aria-labelledby="settings-network">
          <h3 id="settings-network" className="sheet__section-title">
            {t('settings.tab.network')}
          </h3>
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
      </div>

      <footer className="sheet__footer">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void lanApi().openSettings()}
        >
          {t('settings.about.local')}
        </button>
        <button type="button" className="button button--primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </footer>
    </div>
  );
}
