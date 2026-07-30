import './styles.css';

import { audio } from './audio/audio';
import { music } from './audio/music';
import { atlas } from './render/atlas';
import { HEROES } from './content/heroes';
import { MAPS } from './content/maps';
import { inputDelayForRtt, Lockstep, soloLockstep } from './net/lockstep';
import {
  makeRoomCode, MAX_PLAYERS, normaliseCode, PROTOCOL_VERSION, randomSeed,
  type LobbyInfo, type NetMessage, type RosterEntry, type Transport,
} from './net/protocol';
import { hostRoom, joinRoom } from './net/peer';
import { addPlayerToState, cloneState, createState, type MatchConfig } from './sim/state';
import { GameScreen } from './ui/game';
import {
  lobbyStatusCard, renderHelp, renderHostWaiting, renderJoin, renderSetup, renderTitle,
  type LobbyModel,
} from './ui/menus';
import { clear, el, toast } from './ui/dom';

const PLAYER_NAMES = [
  'Player 1 (blue)', 'Player 2 (orange)', 'Player 3 (green)',
  'Player 4 (purple)', 'Player 5 (pink)', 'Player 6 (teal)',
];
const START_GOLD = 280;
const HERO_COUNT = HEROES.length;

function emptySeat(slot: number): LobbyInfo {
  return { name: PLAYER_NAMES[slot] ?? `Player ${slot + 1}`, heroId: slot, ready: false };
}

type Screen = 'title' | 'solo' | 'host' | 'join' | 'lobby' | 'game' | 'help';

class App {
  private ui = document.getElementById('ui') as HTMLElement;
  private canvas = document.getElementById('stage') as HTMLCanvasElement;

  private screen: Screen = 'title';
  private game: GameScreen | null = null;

  private transport: Transport | null = null;
  private handle: { cancel(): void } | null = null;
  private isHost = false;
  private roomCode = '';
  private pingTimer = 0;
  private rttMs = 0;
  /** Round trip to each peer; the match is paced by the worst of them. */
  private peerRtt = new Map<number, number>();
  private matchEpoch = 0;

  /** Our lobby slot, which is also our in-match player index. */
  private slot = 0;
  /** Every seat in the room, dense and indexed by slot. Seat 0 is the host. */
  private roster: LobbyInfo[] = [emptySeat(0)];
  /** Signature of the last lobby broadcast, so re-announcements cannot loop. */
  private lastLobbySig = '';

  private setup = { heroId: 0, mapId: 0, difficulty: 0 };
  private lastMatch: { cfg: MatchConfig; inputDelay: number } | null = null;
  private joinError: string | null = null;
  private joinStatus: string | null = null;

  async boot(): Promise<void> {
    const savedStage = Number.parseInt(localStorage.getItem('bulwark-campaign-stage') ?? '0', 10);
    this.setup.mapId = Math.max(0, Math.min(MAPS.length - 1, Number.isFinite(savedStage) ? savedStage : 0));
    // Any first touch unlocks audio on iOS/Android.
    const unlock = (): void => {
      audio.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) music.setIntensity(0);
    });

    this.showLoading();
    try {
      await atlas.load();
    } catch {
      toast('Could not load the sprite sheet - check that /assets is deployed.');
    }

    const hashCode = normaliseCode(location.hash.replace('#', ''));
    if (hashCode.length >= 3) {
      this.showJoin(hashCode);
      window.setTimeout(() => this.doJoin(hashCode), 200);
    } else {
      this.showTitle();
    }
  }

  private showLoading(): void {
    clear(this.ui);
    this.ui.appendChild(
      el('div', { class: 'screen' },
        el('div', { class: 'stack' },
          el('div', { class: 'title' }, el('h1', {}, 'BULWARK')),
          el('div', { class: 'spinner' }),
          el('div', { class: 'muted', style: 'text-align:center' }, 'Loading…'))),
    );
  }

  // ================================================================ screens

  private showTitle(): void {
    this.teardownNet();
    this.screen = 'title';
    renderTitle(this.ui, {
      campaignStage: this.setup.mapId,
      onSolo: () => this.showSoloSetup(),
      onHost: () => this.startHosting(),
      onJoin: () => this.showJoin(''),
      onResetCampaign: () => {
        if (this.setup.mapId === 0) {
          toast('Campaign is already at Stage 1.');
          return;
        }
        if (!window.confirm('Reset all campaign progress and return to Stage 1?')) return;
        this.setup.mapId = 0;
        localStorage.setItem('bulwark-campaign-stage', '0');
        this.showTitle();
        toast('Campaign reset to Stage 1.');
      },
      onHelp: () => {
        this.screen = 'help';
        renderHelp(this.ui, () => this.showTitle());
      },
    });
  }

  private showSoloSetup(): void {
    this.screen = 'solo';
    renderSetup(this.ui, {
      title: 'Solo run',
      confirmLabel: 'Start defending',
      model: this.setup,
      canEditMap: true,
      onChange: () => { /* local only */ },
      onBack: () => this.showTitle(),
      onConfirm: () => this.startSolo(),
    });
  }

  private showJoin(initial: string): void {
    this.screen = 'join';
    renderJoin(
      this.ui,
      initial,
      (code) => this.doJoin(code),
      () => this.showTitle(),
      this.joinStatus,
      this.joinError,
    );
  }

  // ================================================================ solo

  private startSolo(): void {
    const cfg: MatchConfig = {
      seed: randomSeed(),
      mapId: this.setup.mapId,
      players: [{ name: PLAYER_NAMES[0], heroId: this.setup.heroId }],
      startGold: START_GOLD,
      startLives: 0,
      difficulty: this.setup.difficulty,
    };
    const ls = soloLockstep(createState(cfg));
    this.lastMatch = { cfg, inputDelay: 1 };
    this.enterGame(ls, 0, false);
  }

  // ================================================================ hosting

  private startHosting(): void {
    this.teardownNet();
    this.isHost = true;
    this.slot = 0;
    this.roomCode = makeRoomCode(4);
    this.roster = [emptySeat(0)];
    this.setup.heroId = 0;
    this.roster[0].heroId = 0;
    this.screen = 'host';
    renderHostWaiting(this.ui, this.roomCode, () => this.showTitle(), null);

    const room = hostRoom(this.roomCode, {
      onRoster: (guestSlots) => this.onGuestsChanged(guestSlots),
      onError: (msg) => {
        if (this.screen === 'host') {
          renderHostWaiting(this.ui, this.roomCode, () => this.showTitle(), msg);
        }
      },
    });
    this.handle = room;
    this.attachTransport(room.transport);
    this.startPingLoop();
  }

  /**
   * A guest joined or left. Slots are kept dense by the transport, so we just
   * resize the roster and let everyone re-announce themselves.
   */
  private onGuestsChanged(guestSlots: number[]): void {
    const previous = this.roster;
    const next: LobbyInfo[] = [previous[0] ?? emptySeat(0)];
    for (const slot of guestSlots) next[slot] = previous[slot] ?? emptySeat(slot);
    for (let i = 1; i <= guestSlots.length; i++) next[i] = next[i] ?? emptySeat(i);
    this.roster = next.slice(0, guestSlots.length + 1);

    if (this.game) {
      // Losing anyone mid-match means the remaining players can never complete
      // a tick, so end it for everybody rather than freezing them.
      if (this.roster.length < (this.lastMatch?.cfg.players.length ?? 2)) {
        this.transport?.send({ t: 'bye', why: 'A player left the match.' });
        this.onDisconnected('A player left the match.');
      }
      if (this.roster.length > (this.lastMatch?.cfg.players.length ?? 0)) {
        this.admitLatePlayers();
      }
      return;
    }

    if (guestSlots.length === 0) {
      this.screen = 'host';
      renderHostWaiting(this.ui, this.roomCode, () => this.showTitle(), null);
      return;
    }
    this.broadcastLobby(true);
    this.showLobby();
  }

  /** Re-seat the running match from one host snapshot when guests join late. */
  private admitLatePlayers(): void {
    if (!this.isHost || !this.currentLockstep || !this.lastMatch) return;
    const state = cloneState(this.currentLockstep.state);
    const cfg: MatchConfig = { ...this.lastMatch.cfg, players: [...this.lastMatch.cfg.players] };
    while (cfg.players.length < this.roster.length) {
      const idx = cfg.players.length;
      const seat = this.roster[idx] ?? emptySeat(idx);
      const player = { name: PLAYER_NAMES[idx] ?? seat.name, heroId: seat.heroId % HERO_COUNT };
      cfg.players.push(player);
      addPlayerToState(state, player);
    }
    const inputDelay = Math.max(this.lastMatch.inputDelay, inputDelayForRtt(this.rttMs));
    this.lastMatch = { cfg, inputDelay };
    const epoch = ++this.matchEpoch;
    this.transport?.send({ t: 'resume', match: cfg, inputDelay, state: cloneState(state), epoch });
    this.beginResumedMatch(state, cfg, inputDelay, epoch);
  }

  private doJoin(rawCode: string): void {
    const code = normaliseCode(rawCode);
    this.teardownNet();
    this.isHost = false;
    this.slot = 1;
    this.roomCode = code;
    this.roster = [emptySeat(0), emptySeat(1)];
    this.joinError = null;
    this.joinStatus = `Connecting to ${code}…`;
    this.showJoin(code);

    this.handle = joinRoom(
      code,
      (t) => this.onConnected(t),
      (msg) => {
        this.joinStatus = null;
        this.joinError = msg;
        if (this.screen === 'join') this.showJoin(code);
      },
    );
  }

  private attachTransport(t: Transport): void {
    this.transport = t;
    t.onMessage = (msg) => this.onMessage(msg);
    t.onClose = (why) => this.onDisconnected(why);
    t.onError = () => { /* surfaced via onClose */ };
  }

  /** Guest side: the channel to the host is open. */
  private onConnected(t: Transport): void {
    this.attachTransport(t);
    this.joinStatus = 'Joining the room…';
    if (this.screen === 'join') this.showJoin(this.roomCode);
    t.send({ t: 'hello', v: PROTOCOL_VERSION, name: PLAYER_NAMES[1] });
    this.startPingLoop();
  }

  /** Guest side: the host told us which seat we are in. */
  private onWelcome(slot: number): void {
    this.slot = slot;
    this.joinStatus = null;
    if (this.roster.length <= slot) {
      while (this.roster.length <= slot) this.roster.push(emptySeat(this.roster.length));
    }
    this.setup.heroId = this.avoidHeroClash(this.setup.heroId);
    this.roster[slot] = { name: this.myName(), heroId: this.setup.heroId, ready: false };
    this.announcePick();
    this.showLobby();
  }

  private myName(): string {
    return PLAYER_NAMES[this.slot] ?? `Player ${this.slot + 1}`;
  }

  private me(): LobbyInfo {
    let seat = this.roster[this.slot];
    if (!seat) {
      seat = emptySeat(this.slot);
      this.roster[this.slot] = seat;
    }
    return seat;
  }

  /** Heroes are exclusive, so slide off one an ally already claimed. */
  private avoidHeroClash(heroId: number): number {
    const taken = new Set<number>();
    this.roster.forEach((p, i) => { if (i !== this.slot && p) taken.add(p.heroId); });
    if (!taken.has(heroId)) return heroId;
    for (let id = 0; id < HERO_COUNT; id++) if (!taken.has(id)) return id;
    return heroId;
  }

  private onDisconnected(why: string): void {
    if (this.game) {
      toast(why);
      this.game.destroy();
      this.game = null;
    }
    this.teardownNet();
    this.joinError = why;
    this.showTitle();
    toast(why, 3500);
  }

  private startPingLoop(): void {
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      if (this.game) return; // the lockstep driver takes over in-match
      this.transport?.send({ t: 'ping', from: this.slot, s: performance.now() });
    }, 1000);
  }

  private teardownNet(): void {
    window.clearInterval(this.pingTimer);
    this.pingTimer = 0;
    if (this.transport) {
      this.transport.onMessage = null;
      this.transport.onClose = null;
      this.transport.onError = null;
    }
    this.handle?.cancel();
    this.transport?.close();
    this.handle = null;
    this.transport = null;
    this.lastLobbySig = '';
    this.peerRtt.clear();
    this.rttMs = 0;
  }

  // ================================================================ lobby

  private showLobby(): void {
    // Remote picks rebuild the lobby so ally/ready states stay current. Keep
    // that DOM refresh from yanking this player's independently scrolled
    // chooser back to the hero cards at the top.
    const previousScreen = this.screen === 'lobby'
      ? this.ui.querySelector<HTMLElement>('.screen')
      : null;
    const savedScroll = previousScreen
      ? { top: previousScreen.scrollTop, left: previousScreen.scrollLeft }
      : null;
    this.screen = 'lobby';
    const me = this.me();
    const model: LobbyModel = {
      code: this.roomCode,
      isHost: this.isHost,
      selfSlot: this.slot,
      seats: this.roster.map((p, i) => ({ slot: i, name: p.name, ready: p.ready })),
      freeSeats: this.isHost ? MAX_PLAYERS - this.roster.length : 0,
      rttMs: this.rttMs,
    };

    const everyoneReady = this.roster.length > 1 && this.roster.every((p) => p.ready);
    const confirmLabel = this.isHost
      ? (everyoneReady ? '▶ Start the battle' : (me.ready ? 'Waiting for your allies…' : 'Ready up'))
      : (me.ready ? 'Waiting for the host…' : 'Ready up');

    const takenHeroIds = this.roster
      .filter((_, i) => i !== this.slot)
      .map((p) => p.heroId);

    renderSetup(this.ui, {
      title: 'Co-op lobby',
      confirmLabel,
      model: this.setup,
      canEditMap: this.isHost,
      takenHeroIds,
      extra: lobbyStatusCard(model),
      onChange: () => this.announcePick(),
      onBack: () => this.showTitle(),
      onConfirm: () => {
        if (this.isHost && everyoneReady) {
          this.hostStartMatch();
          return;
        }
        me.ready = !me.ready;
        this.announcePick();
        this.showLobby();
      },
    });

    if (savedScroll) {
      const restoreScroll = (): void => {
        const screen = this.ui.querySelector<HTMLElement>('.screen');
        if (screen) screen.scrollTo(savedScroll.left, savedScroll.top);
      };
      // Restore once immediately and again after layout. Mobile browsers can
      // run focus/scroll anchoring after the old pressed button is removed.
      restoreScroll();
      window.requestAnimationFrame(restoreScroll);
    }
  }

  /** Publish our own seat, and (as host) the whole roster. */
  private announcePick(): void {
    const me = this.me();
    me.heroId = this.setup.heroId;
    me.name = this.myName();
    if (this.isHost) {
      this.broadcastLobby(false);
      return;
    }
    this.transport?.send({
      t: 'pick',
      from: this.slot,
      heroId: me.heroId,
      name: me.name,
      ready: me.ready,
    });
  }

  /**
   * Host only. Guests answer a lobby update with their own `pick`, so this is
   * skipped when nothing actually changed - otherwise the two would ping-pong
   * forever.
   */
  private broadcastLobby(force: boolean): void {
    if (!this.isHost) return;
    const roster: RosterEntry[] = this.roster.map((p, i) => ({ ...p, slot: i }));
    const sig = JSON.stringify([roster, this.setup.mapId, this.setup.difficulty]);
    if (!force && sig === this.lastLobbySig) return;
    this.lastLobbySig = sig;
    this.transport?.send({
      t: 'lobby',
      roster,
      mapId: this.setup.mapId,
      difficulty: this.setup.difficulty,
    });
  }

  private hostStartMatch(): void {
    const cfg: MatchConfig = {
      seed: randomSeed(),
      mapId: this.setup.mapId,
      players: this.roster.map((p, i) => ({ name: PLAYER_NAMES[i] ?? p.name, heroId: p.heroId })),
      startGold: START_GOLD,
      startLives: 0,
      difficulty: this.setup.difficulty,
    };
    const inputDelay = inputDelayForRtt(this.rttMs);
    this.transport?.send({ t: 'start', match: cfg, inputDelay });
    this.beginNetworkedMatch(cfg, inputDelay);
  }

  private beginNetworkedMatch(cfg: MatchConfig, inputDelay: number): void {
    this.matchEpoch = 0;
    this.lastMatch = { cfg, inputDelay };
    const local = Math.min(this.slot, cfg.players.length - 1);
    const ls = new Lockstep(createState(cfg), this.transport, {
      localPlayer: local,
      playerCount: cfg.players.length,
      inputDelay,
      isHost: this.isHost,
    });
    this.enterGame(ls, local, true);
  }

  private beginResumedMatch(state: ReturnType<typeof createState>, cfg: MatchConfig, inputDelay: number, epoch: number): void {
    this.matchEpoch = epoch;
    this.lastMatch = { cfg, inputDelay };
    this.roster = cfg.players.map((p) => ({ name: p.name, heroId: p.heroId, ready: false }));
    const local = Math.min(this.slot, cfg.players.length - 1);
    const ls = new Lockstep(state, this.transport, {
      localPlayer: local, playerCount: cfg.players.length, inputDelay, isHost: this.isHost, epoch,
    });
    this.enterGame(ls, local, true);
    toast(`${cfg.players.length} players defending`);
  }

  // ================================================================ match

  private enterGame(ls: Lockstep, localPlayer: number, multiplayer: boolean): void {
    this.screen = 'game';
    this.currentLockstep = ls;
    this.game?.destroy();
    clear(this.ui);
    audio.unlock();

    this.game = new GameScreen({
      root: this.ui,
      canvas: this.canvas,
      lockstep: ls,
      localPlayer,
      playerNames: PLAYER_NAMES,
      multiplayer,
      roomCode: multiplayer ? this.roomCode : undefined,
      onLeave: () => {
        this.game?.destroy();
        this.game = null;
        this.currentLockstep = null;
        if (multiplayer) this.transport?.send({ t: 'bye', why: 'Your partner left the match.' });
        this.showTitle();
      },
      onRestart: () => this.restart(multiplayer),
      onAdvance: () => this.advanceCampaign(multiplayer),
    });
  }

  private advanceCampaign(multiplayer: boolean): void {
    if (multiplayer && !this.isHost) {
      toast('The host continues the campaign for the party.');
      return;
    }
    const current = this.lastMatch?.cfg.mapId ?? this.setup.mapId;
    const next = Math.min(MAPS.length - 1, current + 1);
    this.setup.mapId = next;
    localStorage.setItem('bulwark-campaign-stage', String(next));
    const prev = this.lastMatch;
    if (!prev) return;
    const state = this.currentLockstep?.state;
    const players = prev.cfg.players.map((player, i) => {
      const progress = state?.players[i];
      return progress ? {
        ...player,
        heroLevel: progress.hero.level,
        heroXp: progress.hero.xp,
        skills: [...progress.skills],
        skillPoints: progress.skillPoints,
      } : player;
    });
    const cfg: MatchConfig = { ...prev.cfg, players, mapId: next, seed: randomSeed() };
    if (!multiplayer) {
      this.game?.destroy(); this.game = null;
      const ls = soloLockstep(createState(cfg));
      this.lastMatch = { cfg, inputDelay: 1 };
      this.enterGame(ls, 0, false);
      return;
    }
    const inputDelay = inputDelayForRtt(this.rttMs);
    this.transport?.send({ t: 'start', match: cfg, inputDelay });
    this.game?.destroy(); this.game = null;
    this.beginNetworkedMatch(cfg, inputDelay);
  }

  private restart(multiplayer: boolean): void {
    if (!multiplayer) {
      this.game?.destroy();
      this.game = null;
      this.startSolo();
      return;
    }
    if (!this.isHost) {
      toast('Only the host can start a new match.');
      return;
    }
    const prev = this.lastMatch;
    if (!prev) return;
    const cfg: MatchConfig = { ...prev.cfg, seed: randomSeed() };
    const inputDelay = inputDelayForRtt(this.rttMs);
    this.transport?.send({ t: 'start', match: cfg, inputDelay });
    this.game?.destroy();
    this.game = null;
    this.beginNetworkedMatch(cfg, inputDelay);
  }

  // ============================================================== messages

  private onMessage(msg: NetMessage): void {
    switch (msg.t) {
      case 'hello':
        // The host answers with the full picture; the guest's seat number was
        // already sent by the transport as `welcome`.
        if (this.isHost && !this.game) this.broadcastLobby(true);
        break;

      case 'welcome':
        if (!this.isHost) this.onWelcome(msg.slot);
        break;

      case 'pick': {
        if (!this.isHost) break;
        const seat = this.roster[msg.from];
        if (!seat || msg.from === this.slot) break;
        seat.heroId = msg.heroId;
        seat.name = msg.name;
        seat.ready = msg.ready;
        this.broadcastLobby(false);
        if (this.screen === 'lobby') this.showLobby();
        break;
      }

      case 'lobby': {
        if (this.isHost) break;
        this.roster = msg.roster.map((p) => ({ name: p.name, heroId: p.heroId, ready: p.ready }));
        this.setup.mapId = msg.mapId;
        this.setup.difficulty = msg.difficulty;
        // Our own seat is authoritative locally: re-assert it so the host's
        // view converges even if our last pick crossed with this update.
        const me = this.me();
        this.setup.heroId = this.avoidHeroClash(this.setup.heroId);
        if (me.heroId !== this.setup.heroId || me.name !== this.myName()) {
          me.heroId = this.setup.heroId;
          me.name = this.myName();
          this.announcePick();
        }
        if (this.screen === 'lobby') this.showLobby();
        else if (this.screen === 'join') this.showLobby();
        break;
      }

      case 'start':
        if (!this.isHost) this.beginNetworkedMatch(msg.match, msg.inputDelay);
        break;

      case 'resume':
        if (!this.isHost) this.beginResumedMatch(msg.state, msg.match, msg.inputDelay, msg.epoch);
        break;

      case 'ping':
        // Answer the asker only. The lockstep driver owns pings once the match
        // has started, so it must not also see this one.
        this.transport?.sendTo(msg.from, { t: 'pong', from: this.slot, s: msg.s });
        break;

      case 'pong':
        this.peerRtt.set(msg.from, Math.round(performance.now() - msg.s));
        this.rttMs = Math.max(0, ...this.peerRtt.values());
        if (this.game) this.gameLockstep()?.receive(msg);
        break;

      case 'bye':
        this.onDisconnected(msg.why);
        break;

      default:
        this.gameLockstep()?.receive(msg);
        break;
    }
  }

  private gameLockstep(): Lockstep | null {
    return this.currentLockstep;
  }

  private currentLockstep: Lockstep | null = null;
}

const app = new App();
void app.boot();

// Keep the canvas sized to the visual viewport (mobile browser chrome moves).
window.visualViewport?.addEventListener('resize', () => {
  window.dispatchEvent(new Event('resize'));
});
