/**
 * room-bridge.ts — état de salon vu par la coquille.
 *
 * RÔLE ET LIMITE, dit franchement : ce module est un adaptateur EN MÉMOIRE, branché sur les canaux
 * IPC de la coquille. Il tient la liste des participants, l'état mute/deafen/PTT et le gain local,
 * pour que l'interface soit utilisable et testable à la main sans le moteur WebRTC. Il ne transporte
 * aucun média et n'ouvre aucune socket : la découverte, la signalisation et l'audio appartiennent au
 * moteur (desk-engine), qui doit remplacer cette implémentation derrière la même interface.
 * Aucun paquet ne sort de la machine du fait de ce fichier.
 *
 * NON VÉRIFIÉ unitairement : c'est un câblage d'état, sans règle de calcul propre.
 */

import { IPC, IPC_MAX_PARTICIPANTS } from '../shell/ipc-contract';
import type {
  ControlStateDto,
  ParticipantDto,
  RoomJoinPayload,
  RoomPhase,
  RoomStateCore,
  TalkModeDto,
} from '../shell/ipc-contract';

/**
 * Union discriminée par la VALEUR de canal du canon (jamais le nom de clé) : le `channel` porte
 * exactement ce que guardEvent() accepte, et chaque `payload` reste corrélé à son canal.
 */
export type BridgeEvent =
  | { channel: typeof IPC.eventParticipants; payload: ParticipantDto[] }
  | { channel: typeof IPC.eventRoomState; payload: RoomStateCore }
  | { channel: typeof IPC.eventControlState; payload: ControlStateDto };

export type BridgeEmitter = (event: BridgeEvent) => void;

/** Identifiant du participant local. */
const SELF_ID = 'self';

export class RoomBridge {
  private readonly emit: BridgeEmitter;
  private participants: ParticipantDto[] = [];
  private phase: RoomPhase = 'idle';
  private roomId: string | null = null;
  private roomName: string | null = null;
  private notice: string | null = null;
  private selfIdLocal: string | null = null;
  private muted = false;
  private deafened = false;
  private pushToTalk = false;
  private mode: TalkModeDto = 'ptt';
  private micLevel = 0;

  constructor(emit: BridgeEmitter) {
    this.emit = emit;
  }

  getRoomState(): RoomStateCore {
    return {
      roomId: this.roomId,
      roomName: this.roomName,
      phase: this.phase,
      participantCount: this.participants.length,
      selfId: this.selfIdLocal,
      notice: this.notice,
    };
  }

  getParticipants(): ParticipantDto[] {
    return this.participants.map((participant) => ({ ...participant }));
  }

  getControlState(): ControlStateDto {
    return {
      muted: this.muted,
      deafened: this.deafened,
      pushToTalk: this.pushToTalk,
      mode: this.mode,
      micLevel: this.micLevel,
    };
  }

  /** Rejoint un salon. Le 9ᵉ participant est refusé, avec une clé de message pour l'UI. */
  join(payload: RoomJoinPayload): RoomStateCore {
    if (this.participants.length >= IPC_MAX_PARTICIPANTS) {
      this.notice = 'room.row.fullReason';
      this.emitRoomState();
      return this.getRoomState();
    }
    this.roomId = payload.roomId;
    this.roomName = payload.name;
    this.phase = 'connected';
    this.notice = null;
    this.selfIdLocal = SELF_ID;
    this.participants = [
      {
        id: SELF_ID,
        name: payload.name,
        muted: this.muted,
        deafened: this.deafened,
        gain: 1,
        connection: 'connected',
      },
    ];
    this.emitParticipants();
    this.emitControlState();
    this.emitRoomState();
    return this.getRoomState();
  }

  leave(): RoomStateCore {
    this.roomId = null;
    this.roomName = null;
    this.phase = 'idle';
    this.notice = null;
    this.selfIdLocal = null;
    this.participants = [];
    this.emitParticipants();
    this.emitRoomState();
    return this.getRoomState();
  }

  setMute(muted: boolean): ControlStateDto {
    this.muted = muted;
    this.updateSelf({ muted });
    this.emitControlState();
    return this.getControlState();
  }

  setPushToTalk(active: boolean): ControlStateDto {
    this.pushToTalk = active;
    // Parler en PTT lève le mute local le temps de l'appui : c'est le sens même du push-to-talk.
    if (active && this.muted) {
      this.muted = false;
      this.updateSelf({ muted: false });
    }
    this.emitControlState();
    return this.getControlState();
  }

  setDeafened(deafened: boolean): ControlStateDto {
    this.deafened = deafened;
    this.updateSelf({ deafened });
    this.emitControlState();
    return this.getControlState();
  }

  setMode(mode: TalkModeDto): ControlStateDto {
    this.mode = mode;
    this.emitControlState();
    return this.getControlState();
  }

  setMicLevel(level: number): void {
    this.micLevel = Math.min(1, Math.max(0, level));
    this.emitControlState();
  }

  /** Gain local appliqué à un participant (0..2). Ignoré si le participant n'existe pas. */
  setGain(participantId: string, gain: number): void {
    const participant = this.participants.find((entry) => entry.id === participantId);
    if (!participant) return;
    participant.gain = gain;
    this.emitParticipants();
  }

  /** Ajoute un participant distant (appelé par le moteur, plafonné à 8). */
  addParticipant(participant: Omit<ParticipantDto, 'gain'> & { gain?: number }): void {
    if (this.participants.length >= IPC_MAX_PARTICIPANTS) return;
    if (this.participants.some((entry) => entry.id === participant.id)) return;
    this.participants.push({ gain: 1, ...participant });
    this.emitParticipants();
    this.emitRoomState();
  }

  private updateSelf(patch: Partial<ParticipantDto>): void {
    const self = this.participants.find((entry) => entry.id === SELF_ID);
    if (!self) return;
    Object.assign(self, patch);
    this.emitParticipants();
  }

  private emitParticipants(): void {
    this.emit({ channel: IPC.eventParticipants, payload: this.getParticipants() });
  }

  private emitRoomState(): void {
    this.emit({ channel: IPC.eventRoomState, payload: this.getRoomState() });
  }

  private emitControlState(): void {
    this.emit({ channel: IPC.eventControlState, payload: this.getControlState() });
  }
}
