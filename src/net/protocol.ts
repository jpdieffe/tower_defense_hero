import type { MatchConfig } from '../sim/state';
import type { GameState } from '../sim/types';

export const PROTOCOL_VERSION = 9;

/** Host plus five guests. */
export const MAX_PLAYERS = 6;

export interface LobbyInfo {
  name: string;
  heroId: number;
  ready: boolean;
}

/**
 * A lobby seat. `slot` is stable for as long as a client stays connected, and
 * is what the host stamps onto that client's packets.
 */
export interface RosterEntry extends LobbyInfo {
  slot: number;
}

export type NetMessage =
  | { t: 'hello'; v: number; name: string }
  /** Host -> one guest, first thing after the channel opens. */
  | { t: 'welcome'; v: number; slot: number }
  | { t: 'lobby'; roster: RosterEntry[]; mapId: number; difficulty: number }
  | { t: 'pick'; from: number; heroId: number; name: string; ready: boolean }
  /**
   * Slots are kept dense (the host compacts them when someone leaves), so a
   * client's in-match player index is simply its lobby slot.
   */
  | { t: 'start'; match: MatchConfig; inputDelay: number }
  /** Host restarts lockstep from one live snapshot when a late player joins. */
  | { t: 'resume'; match: MatchConfig; inputDelay: number; state: GameState; epoch: number }
  /** Commands for a future tick. Sent every tick, even when empty. */
  | { t: 'inp'; from: number; k: number; c: number[][]; e: number }
  | { t: 'inps'; from: number; frames: { k: number; c: number[][] }[]; e: number }
  | { t: 'hash'; from: number; k: number; h: number; e: number }
  | { t: 'ping'; from: number; s: number }
  | { t: 'pong'; from: number; s: number }
  | { t: 'snap'; k: number; s: GameState }
  | { t: 'bye'; why: string };

/** Messages the host forwards between guests so the mesh looks fully connected. */
export function isRelayed(msg: NetMessage): boolean {
  return msg.t === 'inp' || msg.t === 'inps' || msg.t === 'hash';
}

export interface Transport {
  readonly open: boolean;
  /** Send to every other participant. */
  send(msg: NetMessage): void;
  /**
   * Send to a single participant. Guests can only address the host, so for
   * them this is the same as `send`.
   */
  sendTo(slot: number, msg: NetMessage): void;
  close(): void;
  onMessage: ((msg: NetMessage) => void) | null;
  onOpen: (() => void) | null;
  onClose: ((reason: string) => void) | null;
  onError: ((err: string) => void) | null;
}

/** Human-friendly, unambiguous room codes (no O/0/I/1 confusion). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(len = 4): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
}

/** PeerJS ids are global, so namespace them to avoid clashing with other apps. */
export function peerIdForRoom(code: string): string {
  return `bulwark-td-v${PROTOCOL_VERSION}-${code}`;
}

export function randomSeed(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return (b[0] >>> 0) || 1;
}
