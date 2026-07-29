import { packCommand, unpackCommand, type Command } from '../sim/commands';
import { cloneState, hashState, type MatchConfig } from '../sim/state';
import { step } from '../sim/sim';
import { TICK_MS, type GameState, type SimEvent, type SimOutput } from '../sim/types';
import type { NetMessage, Transport } from './protocol';

/** How often the two peers compare fingerprints of their worlds. */
const HASH_INTERVAL = 15;
/** Steps allowed in a normal animation frame. */
const MAX_CATCHUP_STEPS = 6;
/** Steps allowed when we are visibly behind (after a hitch or a hidden tab). */
const MAX_CATCHUP_BURST = 40;
/**
 * Largest frame delta we will honour. Generous enough that a backgrounded tab
 * - whose timers browsers clamp to roughly one second - can still keep the
 * simulation at real time, but small enough that waking from a long sleep does
 * not try to replay minutes of game at once.
 */
const MAX_FRAME_MS = 1100;

export interface NetStats {
  tick: number;
  rttMs: number;
  inputDelay: number;
  stalled: boolean;
  stallMs: number;
  desynced: boolean;
  behindTicks: number;
  verifiedTicks: number;
}

/**
 * Deterministic lockstep driver.
 *
 * The contract that makes both screens agree:
 *   - a tick is only ever simulated once every player's commands for that exact
 *     tick are in hand;
 *   - commands are always scheduled `inputDelay` ticks into the future, so
 *     normal latency is absorbed without anyone guessing;
 *   - if a packet is late, we simply wait. Waiting looks like a brief freeze,
 *     which is always better than two players seeing different outcomes.
 */
export class Lockstep {
  state: GameState;
  readonly localPlayer: number;
  readonly playerCount: number;
  readonly inputDelay: number;
  readonly isHost: boolean;
  readonly epoch: number;

  /** tick -> per-player packed command lists (null = not yet received). */
  private inbox = new Map<number, (number[][] | null)[]>();
  private pending: Command[] = [];
  private outbound: { k: number; c: number[][] }[] = [];
  private out: SimOutput = { events: [] };
  private accumulator = 0;
  private lastLocalHash = new Map<number, number>();
  /** tick -> (player -> fingerprint they reported for it). */
  private peerHash = new Map<number, Map<number, number>>();
  /** Latest measured round trip per peer; `rttMs` reports the worst of them. */
  private peerRtt = new Map<number, number>();

  private stalledSince = 0;
  /** Highest tick we have already published local input for. */
  private publishedThrough = -1;
  rttMs = 0;
  stalled = false;
  desynced = false;
  paused = false;
  /** Number of ticks whose state fingerprint the peer confirmed as identical. */
  verifiedTicks = 0;

  onEvents: ((events: readonly SimEvent[], state: GameState) => void) | null = null;
  onDesync: ((tick: number) => void) | null = null;

  constructor(
    state: GameState,
    private readonly transport: Transport | null,
    opts: { localPlayer: number; playerCount: number; inputDelay: number; isHost: boolean; epoch?: number },
  ) {
    this.state = state;
    this.localPlayer = opts.localPlayer;
    this.playerCount = opts.playerCount;
    this.inputDelay = Math.max(1, opts.inputDelay);
    this.isHost = opts.isHost;
    this.epoch = opts.epoch ?? 0;

    // The opening delay window (also used when joining a live snapshot) is,
    // by definition, empty for every participant.
    for (let k = this.state.tick; k < this.state.tick + this.inputDelay; k++) {
      this.inbox.set(k, new Array(this.playerCount).fill([]) as number[][][]);
    }
    this.publishedThrough = this.state.tick + this.inputDelay - 1;
  }

  /** Queue a local action. It will be executed `inputDelay` ticks from now. */
  queue(cmd: Command): void {
    this.pending.push(cmd);
  }

  /** Feed a message that arrived on the data channel. */
  receive(msg: NetMessage): void {
    switch (msg.t) {
      case 'inp': {
        if (msg.e !== this.epoch) break;
        if (!this.isPeer(msg.from)) break;
        if (msg.k < this.state.tick) break;
        this.slotFor(msg.k)[msg.from] = msg.c;
        break;
      }
      case 'inps': {
        if (msg.e !== this.epoch) break;
        if (!this.isPeer(msg.from)) break;
        for (const frame of msg.frames) {
          if (frame.k < this.state.tick) continue;
          this.slotFor(frame.k)[msg.from] = frame.c;
        }
        break;
      }
      case 'hash': {
        if (msg.e !== this.epoch) break;
        if (!this.isPeer(msg.from)) break;
        let byPlayer = this.peerHash.get(msg.k);
        if (!byPlayer) {
          byPlayer = new Map();
          this.peerHash.set(msg.k, byPlayer);
        }
        byPlayer.set(msg.from, msg.h);
        this.compareHash(msg.k);
        break;
      }
      case 'ping':
        // Answer the asker directly - a broadcast would give other players
        // a reply to a question they never asked.
        this.transport?.sendTo(msg.from, { t: 'pong', from: this.localPlayer, s: msg.s });
        break;
      case 'pong': {
        if (!this.isPeer(msg.from)) break;
        this.peerRtt.set(msg.from, Math.round(performance.now() - msg.s));
        let worst = 0;
        for (const v of this.peerRtt.values()) worst = Math.max(worst, v);
        this.rttMs = worst;
        break;
      }
      case 'snap':
        this.applySnapshot(msg.k, msg.s);
        break;
      default:
        break;
    }
  }

  /** True for a valid player index that is not us. */
  private isPeer(idx: number): boolean {
    return Number.isInteger(idx) && idx >= 0 && idx < this.playerCount && idx !== this.localPlayer;
  }

  private slotFor(tick: number): (number[][] | null)[] {
    let slot = this.inbox.get(tick);
    if (!slot) {
      slot = new Array(this.playerCount).fill(null);
      this.inbox.set(tick, slot);
    }
    return slot;
  }

  private ready(tick: number): boolean {
    const slot = this.inbox.get(tick);
    if (!slot) return false;
    for (let i = 0; i < this.playerCount; i++) {
      if (slot[i] === null) return false;
    }
    return true;
  }

  /** Publish this client's commands for `tick + inputDelay`. */
  private flushLocal(targetTick: number): void {
    // Never re-publish a tick we already committed to (see `publishIdleAhead`).
    const target = Math.max(targetTick, this.publishedThrough + 1);
    const packed = this.pending.map(packCommand);
    this.pending.length = 0;
    this.slotFor(target)[this.localPlayer] = packed;
    this.publishedThrough = Math.max(this.publishedThrough, target);
    if (this.transport) this.outbound.push({ k: target, c: packed });
  }

  private flushOutbound(): void {
    if (!this.transport || this.outbound.length === 0) return;
    const frames = this.outbound.splice(0);
    this.transport.send({ t: 'inps', from: this.localPlayer, frames, e: this.epoch });
  }

  /**
   * Commit to "no input" for a bounded window ahead of the current tick and
   * tell the peer straight away.
   *
   * Mobile browsers freeze `requestAnimationFrame` the moment the tab is
   * backgrounded or the phone is locked. Without this, a player glancing at a
   * notification would hard-freeze their partner's game. A backgrounded player
   * cannot press anything anyway, so publishing empty input ahead is safe.
   *
   * The window is deliberately bounded: if someone is away for longer than
   * that, the match really should wait for them rather than run a game they
   * cannot influence.
   */
  publishIdleAhead(ticks: number): void {
    if (!this.transport || this.state.gameOver) return;
    const target = this.state.tick + this.inputDelay + ticks;
    for (let k = this.publishedThrough + 1; k <= target; k++) {
      this.slotFor(k)[this.localPlayer] = [];
      this.outbound.push({ k, c: [] });
    }
    if (target > this.publishedThrough) this.publishedThrough = target;
    this.flushOutbound();
  }

  /** Highest tick for which every player's input is already known. */
  private readyFrontier(): number {
    let t = this.state.tick;
    let guard = 0;
    while (this.ready(t) && guard++ < 600) t++;
    return t;
  }

  /**
   * Advance the world by real elapsed time. Returns the interpolation factor
   * (0..1) the renderer should use between the previous and current tick.
   */
  update(deltaMs: number): number {
    if (this.paused || this.state.gameOver) {
      // Still pump the network so the peer does not stall behind us.
      return 1;
    }

    this.accumulator += Math.min(deltaMs, MAX_FRAME_MS);
    let steps = 0;
    let blocked = false;

    // The accumulator is the only source of truth for pacing, so the world can
    // never run faster than real time - it can only work through a backlog
    // faster, and only up to the budget below.
    const budget = this.accumulator > TICK_MS * 8 ? MAX_CATCHUP_BURST : MAX_CATCHUP_STEPS;

    while (steps < budget && this.accumulator >= TICK_MS) {
      const tick = this.state.tick;
      if (!this.ready(tick)) {
        blocked = true;
        break;
      }
      this.flushLocal(tick + this.inputDelay);
      this.simulateOne(tick);
      this.accumulator -= TICK_MS;
      steps++;
    }

    if (blocked) {
      if (!this.stalled) this.stalledSince = performance.now();
      this.stalled = true;
      // Do not let the backlog grow without bound while we wait.
      if (this.accumulator > TICK_MS * 4) this.accumulator = TICK_MS * 4;
    } else if (this.stalled) {
      this.stalled = false;
    }

    if (this.outbound.length >= 2 || blocked) this.flushOutbound();

    return Math.min(1, this.accumulator / TICK_MS);
  }

  private simulateOne(tick: number): void {
    const slot = this.inbox.get(tick)!;
    const commands: Command[] = [];
    // Deterministic order: every player's commands in player-index order.
    for (let p = 0; p < this.playerCount; p++) {
      const list = slot[p] ?? [];
      for (const packedCmd of list) {
        const c = unpackCommand(packedCmd);
        c.p = p; // never trust a peer to label commands as someone else
        commands.push(c);
      }
    }
    this.inbox.delete(tick);

    step(this.state, commands, this.out);
    if (this.out.events.length > 0) this.onEvents?.(this.out.events, this.state);

    if (this.playerCount > 1 && tick % HASH_INTERVAL === 0) {
      const h = hashState(this.state);
      this.lastLocalHash.set(tick, h);
      this.transport?.send({ t: 'hash', from: this.localPlayer, k: tick, h, e: this.epoch });
      this.compareHash(tick);
      // Keep the maps small.
      if (this.lastLocalHash.size > 64) {
        const cutoff = tick - HASH_INTERVAL * 32;
        for (const k of this.lastLocalHash.keys()) if (k < cutoff) this.lastLocalHash.delete(k);
        for (const k of this.peerHash.keys()) if (k < cutoff) this.peerHash.delete(k);
      }
    }
  }

  private compareHash(tick: number): void {
    if (this.desynced) return;
    const mine = this.lastLocalHash.get(tick);
    const theirs = this.peerHash.get(tick);
    if (mine === undefined || theirs === undefined) return;

    for (const h of theirs.values()) {
      if (h === mine) continue;

      this.desynced = true;
      this.onDesync?.(tick);
      // The host is the tie-breaker: it ships its authoritative world to
      // everyone, so a three-way disagreement still lands on one truth.
      if (this.isHost) {
        this.transport?.send({ t: 'snap', k: this.state.tick, s: cloneState(this.state) });
        this.desynced = false;
        this.lastLocalHash.clear();
        this.peerHash.clear();
      }
      return;
    }

    // Only count the tick as verified once every peer has vouched for it.
    if (theirs.size >= this.playerCount - 1) {
      this.verifiedTicks++;
      this.peerHash.delete(tick);
      this.lastLocalHash.delete(tick);
    }
  }

  private applySnapshot(tick: number, snap: GameState): void {
    if (this.isHost) return;
    this.state = cloneState(snap);
    this.state.tick = tick;
    this.inbox.clear();
    this.pending.length = 0;
    this.outbound.length = 0;
    this.publishedThrough = tick + this.inputDelay - 1;
    for (let k = tick; k < tick + this.inputDelay; k++) {
      this.inbox.set(k, new Array(this.playerCount).fill([]) as number[][][]);
    }
    this.accumulator = 0;
    this.desynced = false;
    this.lastLocalHash.clear();
    this.peerHash.clear();
  }

  sendPing(): void {
    this.transport?.send({ t: 'ping', from: this.localPlayer, s: performance.now() });
  }

  stats(): NetStats {
    return {
      tick: this.state.tick,
      rttMs: this.rttMs,
      inputDelay: this.inputDelay,
      stalled: this.stalled,
      stallMs: this.stalled ? Math.round(performance.now() - this.stalledSince) : 0,
      desynced: this.desynced,
      behindTicks: Math.max(0, this.readyFrontier() - this.state.tick),
      verifiedTicks: this.verifiedTicks,
    };
  }
}

/**
 * Pick a safe input delay from the measured round trip.
 *
 * Half the round trip is the one-way latency; add two ticks of headroom for
 * jitter and the browser's frame pacing. More delay costs a little input
 * responsiveness but removes stalls entirely.
 */
export function inputDelayForRtt(rttMs: number): number {
  const oneWayTicks = Math.ceil(rttMs / 2 / TICK_MS);
  return Math.max(3, Math.min(12, oneWayTicks + 2));
}

export function soloLockstep(state: GameState): Lockstep {
  return new Lockstep(state, null, {
    localPlayer: 0, playerCount: 1, inputDelay: 1, isHost: true,
  });
}

export type { MatchConfig };
