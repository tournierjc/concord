/**
 * preload/index.ts — pont contrôlé entre le renderer et le process principal.
 *
 * Principes (SPEC-001 A15 / CA19) :
 *  - le renderer ne reçoit AUCUNE primitive Node : ni `require`, ni `process`, ni `ipcRenderer`.
 *    Seules les méthodes de `window.lanAPI` sont exposées, une par intention métier ;
 *  - chaque appel sortant est validé par `guardPayload('invoke', …)` AVANT d'être émis, et chaque
 *    événement entrant est validé par `guardPayload('event', …)` AVANT d'être transmis au renderer.
 *    Un canal inconnu ne peut donc pas être invoqué, même par du code exécuté dans la page ;
 *  - `on*` renvoie une fonction de désabonnement : pas de fuite d'écouteur au démontage React.
 *
 * NON VÉRIFIÉ ici : nécessite Electron (`contextBridge`, `ipcRenderer`).
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  IPC,
  guardPayload,
  type ControlStateDto,
  type IpcEventChannel,
  type IpcInvokeChannel,
  type LanAPI,
  type OverlayGeometryDto,
  type OverlayPatchPayload,
  type ParticipantDto,
  type RoomJoinPayload,
  type RoomStateDto,
  type RoomSummaryDto,
  type SettingsChangedDto,
  type ShortcutConflictDto,
  type SignalIn,
  type SignalOut,
  type SpeakingSetPayload,
} from '../shell/ipc-contract';
import type { Settings } from '../shell/settings-schema';

function invoke<T>(channel: IpcInvokeChannel, payload: unknown = {}): Promise<T> {
  const guarded = guardPayload('invoke', channel, payload);
  if (!guarded.ok) {
    return Promise.reject(new Error(`appel IPC refusé — ${guarded.error.message}`));
  }
  return ipcRenderer.invoke(channel, guarded.value) as Promise<T>;
}

function subscribe<T>(channel: IpcEventChannel, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
    const guarded = guardPayload('event', channel, payload);
    if (!guarded.ok) {
      // On ne relaie pas un événement hors contrat : mieux vaut un trou d'UI qu'une donnée fausse.
      console.warn('[preload] événement hors contrat ignoré', guarded.error);
      return;
    }
    listener(guarded.value as T);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const lanAPI: LanAPI = {
  // Charge utile vide : le scan mDNS tourne déjà côté main, on ne fait que lire le registre.
  discoverRooms: () => invoke<RoomSummaryDto[]>(IPC.roomsDiscover),
  joinRoom: (payload: RoomJoinPayload) => invoke<RoomStateDto>(IPC.roomJoin, payload),
  leaveRoom: () => invoke<RoomStateDto>(IPC.roomLeave),
  setMute: (muted: boolean) => invoke<ControlStateDto>(IPC.controlSetMute, { muted }),
  setDeafen: (deafened: boolean) => invoke<ControlStateDto>(IPC.controlSetDeafen, { deafened }),
  setPushToTalk: (active: boolean) => invoke<ControlStateDto>(IPC.controlSetPushToTalk, { active }),
  setGain: async (payload) => {
    await invoke<void>(IPC.controlSetGain, payload);
  },
  openSettings: async () => {
    await invoke<void>(IPC.settingsOpen);
  },
  getSettings: () => invoke<Settings>(IPC.settingsGet),
  setSettings: (patch: Partial<Settings>) => invoke<Settings>(IPC.settingsSet, patch),
  setOverlay: async (patch: OverlayPatchPayload) => {
    await invoke<void>(IPC.overlaySet, patch);
  },
  // AD-19 D1 : une liste d'ids, rien d'autre. La garde refuse un doublon ou un id vide AVANT
  // l'émission — un ensemble mal formé ne doit pas atteindre le relais.
  setSpeaking: async (speaking: readonly string[]) => {
    await invoke<void>(IPC.speakingSet, { speaking });
  },
  onRoomsDiscovered: (listener: (rooms: RoomSummaryDto[]) => void) =>
    subscribe<RoomSummaryDto[]>(IPC.eventRoomsDiscovered, listener),
  onParticipants: (listener: (participants: ParticipantDto[]) => void) =>
    subscribe<ParticipantDto[]>(IPC.eventParticipants, listener),
  onRoomState: (listener: (state: RoomStateDto) => void) =>
    subscribe<RoomStateDto>(IPC.eventRoomState, listener),
  onControlState: (listener: (state: ControlStateDto) => void) =>
    subscribe<ControlStateDto>(IPC.eventControlState, listener),
  onSettingsChanged: (listener: (payload: SettingsChangedDto) => void) =>
    subscribe<SettingsChangedDto>(IPC.eventSettingsChanged, listener),
  onOverlayGeometry: (listener: (geometry: OverlayGeometryDto) => void) =>
    subscribe<OverlayGeometryDto>(IPC.eventOverlayGeometry, listener),
  onShortcutConflict: (listener: (conflict: ShortcutConflictDto) => void) =>
    subscribe<ShortcutConflictDto>(IPC.eventShortcutConflict, listener),
  // T16 / SPEC-007 §4.1 : le tuyau de signalisation et son état.
  sendSignal: async (message: SignalOut) => {
    await invoke<void>(IPC.signalSend, message);
  },
  onSignal: (listener: (message: SignalIn) => void) => subscribe<SignalIn>(IPC.eventSignal, listener),
  onSpeakingSet: (listener: (payload: SpeakingSetPayload) => void) =>
    subscribe<SpeakingSetPayload>(IPC.eventSpeakingSet, listener),
};

// Gel : le renderer ne peut ni ajouter, ni remplacer, ni supprimer une méthode du pont.
Object.freeze(lanAPI);
contextBridge.exposeInMainWorld('lanAPI', lanAPI);
