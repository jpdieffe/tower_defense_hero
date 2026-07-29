import Peer, { type DataConnection } from 'peerjs';
import {
  isRelayed, MAX_PLAYERS, peerIdForRoom, PROTOCOL_VERSION,
  type NetMessage, type Transport,
} from './protocol';

const PEER_OPTIONS = {
  // Public STUN servers are enough for the vast majority of home/mobile networks.
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
  },
  debug: 0,
} as const;

/** The host always occupies slot 0; guests take the lowest free slot. */
export const HOST_SLOT = 0;

function decode(raw: unknown): NetMessage | null {
  try {
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as NetMessage;
  } catch {
    return null;
  }
}

/**
 * Overwrite the sender field on a packet that arrived from a guest.
 *
 * The host is the only authority on who is who: a guest could otherwise claim
 * to be another player and inject commands on their behalf.
 */
function stampSender(msg: NetMessage, slot: number): void {
  switch (msg.t) {
    case 'inp':
    case 'hash':
    case 'ping':
    case 'pong':
    case 'pick':
      msg.from = slot;
      break;
    default:
      break;
  }
}

/**
 * The host's end of the room: one WebRTC data channel per guest, plus a relay.
 *
 * The players form a star rather than a full mesh — every guest talks only to
 * the host, and the host forwards the packets that guests need from each other
 * (`inp` and `hash`). That keeps a phone to a single peer connection, and it
 * means the lobby has exactly one authority for slot numbers and match start.
 */
export class HostTransport implements Transport {
  onMessage: ((msg: NetMessage) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  onError: ((err: string) => void) | null = null;
  /** A guest took a seat, or was moved to a new one after a compaction. */
  onRoster: (() => void) | null = null;

  readonly slot = HOST_SLOT;

  private peer: Peer | null = null;
  private conns = new Map<number, DataConnection>();
  private closed = false;

  get open(): boolean {
    return !this.closed && this.conns.size > 0;
  }

  /** Occupied guest slots, ascending. */
  get guestSlots(): number[] {
    return [...this.conns.keys()].sort((a, b) => a - b);
  }

  bind(peer: Peer): void {
    this.peer = peer;
  }

  private freeSlot(): number {
    for (let s = 1; s < MAX_PLAYERS; s++) if (!this.conns.has(s)) return s;
    return -1;
  }

  /** Returns false when the room is already full. */
  accept(conn: DataConnection): boolean {
    if (this.closed) return false;
    const slot = this.freeSlot();
    if (slot < 0) {
      const bye: NetMessage = {
        t: 'bye',
        why: 'That room is already full.',
      };
      try { conn.send(JSON.stringify(bye)); } catch { /* nothing to do */ }
      window.setTimeout(() => { try { conn.close(); } catch { /* gone */ } }, 300);
      return false;
    }

    this.conns.set(slot, conn);

    conn.on('data', (raw) => {
      if (this.closed) return;
      const msg = decode(raw);
      if (!msg) {
        this.onError?.('Received a malformed packet.');
        return;
      }
      const seat = this.slotOf(conn);
      if (seat < 0) return; // already dropped
      stampSender(msg, seat);
      if (isRelayed(msg)) this.relay(seat, msg);
      this.onMessage?.(msg);
    });
    conn.on('close', () => this.drop(conn));
    conn.on('error', (err) => this.onError?.(String(err?.message ?? err)));

    const seated = (): void => {
      const seat = this.slotOf(conn);
      if (seat < 0) return;
      this.sendTo(seat, { t: 'welcome', v: PROTOCOL_VERSION, slot: seat });
      this.onRoster?.();
      this.onOpen?.();
    };
    if (conn.open) queueMicrotask(seated);
    else conn.on('open', seated);
    return true;
  }

  private slotOf(conn: DataConnection): number {
    for (const [slot, c] of this.conns) if (c === conn) return slot;
    return -1;
  }

  private drop(conn: DataConnection): void {
    const slot = this.slotOf(conn);
    if (slot < 0) return;
    this.conns.delete(slot);
    this.compact();
    this.onRoster?.();
  }

  /**
   * Keep guest slots contiguous (1, then 2) after someone leaves.
   *
   * Dense slots are what let a lobby slot double as the in-match player index,
   * so every layer above this one can stay index-based.
   */
  private compact(): void {
    const ordered = [...this.conns.entries()].sort((a, b) => a[0] - b[0]);
    const moved: number[] = [];
    this.conns.clear();
    ordered.forEach(([oldSlot, conn], i) => {
      const newSlot = i + 1;
      this.conns.set(newSlot, conn);
      if (newSlot !== oldSlot) moved.push(newSlot);
    });
    for (const slot of moved) {
      this.sendTo(slot, { t: 'welcome', v: PROTOCOL_VERSION, slot });
    }
  }

  private relay(fromSlot: number, msg: NetMessage): void {
    const payload = JSON.stringify(msg);
    for (const [slot, conn] of this.conns) {
      if (slot === fromSlot || !conn.open) continue;
      try { conn.send(payload); } catch { /* dropped below by 'close' */ }
    }
  }

  send(msg: NetMessage): void {
    if (this.closed) return;
    const payload = JSON.stringify(msg);
    for (const conn of this.conns.values()) {
      if (!conn.open) continue;
      try { conn.send(payload); } catch { /* dropped below by 'close' */ }
    }
  }

  sendTo(slot: number, msg: NetMessage): void {
    if (this.closed) return;
    const conn = this.conns.get(slot);
    if (!conn || !conn.open) return;
    try { conn.send(JSON.stringify(msg)); } catch { /* dropped below by 'close' */ }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const conn of this.conns.values()) {
      try { conn.close(); } catch { /* already gone */ }
    }
    this.conns.clear();
    try { this.peer?.destroy(); } catch { /* already gone */ }
  }
}

/**
 * A guest's end of the room: a single data channel to the host.
 *
 * Everything is addressed to the host, which either handles it or forwards it
 * to the other guest.
 */
class GuestTransport implements Transport {
  onMessage: ((msg: NetMessage) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  onError: ((err: string) => void) | null = null;

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private closed = false;

  get open(): boolean {
    return !!this.conn && this.conn.open && !this.closed;
  }

  attach(peer: Peer, conn: DataConnection): void {
    this.peer = peer;
    this.conn = conn;

    conn.on('data', (raw) => {
      if (this.closed) return;
      const msg = decode(raw);
      if (!msg) {
        this.onError?.('Received a malformed packet.');
        return;
      }
      this.onMessage?.(msg);
    });
    conn.on('open', () => this.onOpen?.());
    conn.on('close', () => {
      if (this.closed) return;
      this.closed = true;
      this.onClose?.('The host closed the game.');
    });
    conn.on('error', (err) => this.onError?.(String(err?.message ?? err)));

    if (conn.open) queueMicrotask(() => this.onOpen?.());
  }

  send(msg: NetMessage): void {
    if (!this.conn || !this.conn.open || this.closed) return;
    try {
      this.conn.send(JSON.stringify(msg));
    } catch (err) {
      this.onError?.(String(err));
    }
  }

  /** Guests can only address the host, which relays onwards as needed. */
  sendTo(_slot: number, msg: NetMessage): void {
    this.send(msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.conn?.close(); } catch { /* already gone */ }
    try { this.peer?.destroy(); } catch { /* already gone */ }
  }
}

export interface HostHandle {
  transport: Transport;
  cancel(): void;
}

export interface RoomHooks {
  /** Fired whenever the set of connected guests changes. */
  onRoster: (guestSlots: number[]) => void;
  onError: (msg: string) => void;
}

/** Open a room and accept guests until it is full. */
export function hostRoom(code: string, hooks: RoomHooks): { transport: HostTransport; cancel(): void } {
  const transport = new HostTransport();
  const peer = new Peer(peerIdForRoom(code), PEER_OPTIONS);
  transport.bind(peer);

  peer.on('error', (err) => {
    const type = (err as unknown as { type?: string }).type;
    if (type === 'unavailable-id') {
      hooks.onError('That room code is already taken - try creating another room.');
    } else {
      hooks.onError(friendlyPeerError(type, err.message));
    }
  });

  peer.on('connection', (conn) => {
    transport.accept(conn);
  });

  transport.onRoster = () => hooks.onRoster(transport.guestSlots);
  transport.onError = (msg) => hooks.onError(msg);

  return {
    transport,
    cancel(): void {
      transport.onRoster = null;
      transport.close();
    },
  };
}

/** Join an existing room by code. */
export function joinRoom(
  code: string,
  onConnected: (t: Transport) => void,
  onError: (msg: string) => void,
): HostHandle {
  const transport = new GuestTransport();
  const peer = new Peer(PEER_OPTIONS);
  let settled = false;
  let timer = 0;

  peer.on('open', () => {
    const conn = peer.connect(peerIdForRoom(code), {
      reliable: true,
      serialization: 'json',
    });
    transport.attach(peer, conn);
    conn.on('open', () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      onConnected(transport);
    });
    timer = window.setTimeout(() => {
      if (settled) return;
      onError(`No room called "${code}" answered. Check the code and that your friend's room is still open.`);
    }, 15000);
  });

  peer.on('error', (err) => {
    const type = (err as unknown as { type?: string }).type;
    if (type === 'peer-unavailable') {
      onError(`No room called "${code}" is open right now.`);
    } else {
      onError(friendlyPeerError(type, err.message));
    }
  });

  return {
    transport,
    cancel(): void {
      settled = true;
      window.clearTimeout(timer);
      try { peer.destroy(); } catch { /* ignore */ }
    },
  };
}

function friendlyPeerError(type: string | undefined, message: string): string {
  switch (type) {
    case 'browser-incompatible':
      return 'This browser does not support WebRTC. Try Chrome, Safari or Firefox.';
    case 'network':
      return 'Lost contact with the matchmaking server. Check your connection.';
    case 'server-error':
      return 'The matchmaking server is unreachable right now.';
    case 'webrtc':
      return 'The direct connection failed. Both phones may be on very restrictive networks.';
    default:
      return message || 'Connection failed.';
  }
}
