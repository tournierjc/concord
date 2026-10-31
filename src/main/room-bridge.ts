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
  RoomStateDto,
  TalkModeDto,
} from '../shell/ipc-contract';

/**
 * Union discriminée par la VALEUR de canal du canon (jamais le nom de clé) : le `channel` porte
 * exactement ce que guardEvent() accepte, et chaque `payload` reste corrélé à son canal.
 */
export type BridgeEvent =
  | { channel: typeof IPC.eventParticipants; payload: ParticipantDto[] }
  | { channel: typeof IPC.eventRoomState; payload: RoomStateDto }
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

  getRoomState(): RoomStateDto {
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

  /**
   * Rejoint un salon. Le 9ᵉ participant est refusé, avec une clé de message pour l'UI.
   *
   * `payload.name` est le nom du SALON tel qu'il doit s'afficher ; le nom du participant local
   * arrive séparément (`selfName`, dérivé des réglages par le main — SPEC-001 A6). Les deux
   * venaient auparavant du même champ : l'en-tête du salon affichait donc le pseudo de la personne
   * qui venait de le rejoindre.
   */
  join(payload: RoomJoinPayload, selfName: string): RoomStateDto {
    if (this.participants.length >= IPC_MAX_PARTICIPANTS) {
      this.notice = 'room.row.fullReason';
      this.emitRoomState();
      return this.getRoomState();
    }
    const roomName = payload.name.trim();
    this.roomId = payload.roomId;
    this.roomName = roomName.length > 0 ? roomName : payload.roomId;
    this.phase = 'connected';
    this.notice = null;
    this.selfIdLocal = SELF_ID;
    this.participants = [
      {
        id: SELF_ID,
        name: selfName,
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

  leave(): RoomStateDto {
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

  /**
   * Ajoute un participant distant (appelé au fil de la signalisation, voir `roster-link` ; plafonné
   * à 8). Rend `true` seulement si la liste a réellement changé — un `peer-joined` rejoué ne doit
   * pas faire croire à une arrivée.
   */
  addParticipant(participant: Omit<ParticipantDto, 'gain'> & { gain?: number }): boolean {
    if (this.participants.length >= IPC_MAX_PARTICIPANTS) return false;
    if (this.participants.some((entry) => entry.id === participant.id)) return false;
    this.participants.push({ gain: 1, ...participant });
    this.emitParticipants();
    this.emitRoomState();
    return true;
  }

  /**
   * Retire un participant (départ constaté, `peer-left`). Rend `true` si la liste a changé.
   *
   * Le participant local ne part jamais par ce chemin : on ne quitte pas son propre salon parce
   * qu'un pair a annoncé son départ. Sans cette méthode, un participant parti restait affiché
   * jusqu'à la fermeture du salon — la liste ne pouvait que grandir.
   */
  removeParticipant(peerId: string): boolean {
    if (peerId === SELF_ID) return false;
    const before = this.participants.length;
    this.participants = this.participants.filter((entry) => entry.id !== peerId);
    if (this.participants.length === before) return false;
    this.emitParticipants();
    this.emitRoomState();
    return true;
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
