import { FX_ONE, fxToFloat } from '../core/fixed';
import { audio } from '../audio/audio';
import { music } from '../audio/music';
import { PLAYER_COLORS, Renderer, type ViewOptions } from '../render/renderer';
import { drawTowerSprite } from '../render/towerart';
import { FXART } from '../content/art';
import { enemyDef } from '../content/enemies';
import { HERO, heroDef } from '../content/heroes';
import { activeSkills, availableSkills, skillDef, SKILLS } from '../content/skills';
import { ItemKind, itemDef, relicDef } from '../content/items';
import {
  MAX_TOWER_LEVEL, TOWERS, TOWER_CLASSES, computeTowerStats, towerDef,
  towerTitle, trackSplit, upgradeCost, type TowerTrack,
} from '../content/towers';
import { WAVE_MOD_INFO } from '../content/waves';
import { getMap } from '../content/maps';
import { hashState } from '../sim/state';
import type { Lockstep } from '../net/lockstep';
import {
  Track, buyShop, chooseSkill, moveHero, sell, setRally, setTargetMode, toggleReady,
  upgrade as upgradeCmd, useAbility, useItem, build as buildCmd,
} from '../sim/commands';
import {
  EventKind, Phase, ProjKind, TARGET_MODE_NAMES, TICK_RATE,
  type GameState, type SimEvent, type Tower,
} from '../sim/types';
import { clear, el, formatNumber, setText, tapButton, toggleClass, vibrate } from './dom';

const TOWER_GLYPH_SIZE = 34;

/** Four upgrade slots, filled in as the track is picked. */
const pips = (n: number): string => '●'.repeat(n) + '○'.repeat(Math.max(0, 4 - n));

export interface GameScreenOptions {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  lockstep: Lockstep;
  localPlayer: number;
  playerNames: string[];
  multiplayer: boolean;
  roomCode?: string;
  onLeave: () => void;
  onRestart: () => void;
}

/**
 * Everything the player touches during a match: the HUD, the map input
 * gestures, and the render/simulate loop.
 */
export class GameScreen {
  private renderer: Renderer;
  private ls: Lockstep;
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private opts: GameScreenOptions;

  private raf = 0;
  private lastFrame = 0;
  private pingTimer = 0;
  private hudTimer = 0;
  private destroyed = false;

  // --- interaction state
  private placingDefId = -1;
  private selectedTowerId = 0;
  private aimingKind: 'none' | 'ability' | 'item' | 'rally' = 'none';
  private aimingSlot = -1;
  private aimingSkillId = -1;
  private aimingTowerId = 0;
  private aim: { x: number; y: number; radius: number } | null = null;
  private placeCell: { x: number; y: number } | null = null;
  private pointerStart: { x: number; y: number; t: number } | null = null;
  private pointerId = -1;
  private shopOpen = false;
  private paused = false;

  // --- HUD nodes
  private hud!: {
    livesVal: HTMLElement;
    waveVal: HTMLElement;
    timerVal: HTMLElement;
    goldSelf: HTMLElement;
    /** One entry per ally, in player-index order. */
    matePills: { idx: number; gold: HTMLElement }[];
    netPill: HTMLElement;
    banner: HTMLElement;
    warning: HTMLElement;
    buildBar: HTMLElement;
    classButtons: HTMLElement[];
    actionRow: HTMLElement;
    readyBtn: HTMLButtonElement;
    inspector: HTMLElement;
    towerButtons: { btn: HTMLElement; defId: number; cls: number }[];
    abilityBtn: HTMLElement;
    abilityCd: HTMLElement;
    powersWrap: HTMLElement;
    itemsWrap: HTMLElement;
    shopBtn: HTMLElement;
  };

  private overlay: HTMLElement | null = null;
  private bannerTimer = 0;
  private lastInspectKey = '';
  /** Which class tab the build bar is showing. */
  private buildClass = 0;

  constructor(options: GameScreenOptions) {
    this.opts = options;
    this.root = options.root;
    this.canvas = options.canvas;
    this.ls = options.lockstep;
    this.renderer = new Renderer(options.canvas, this.ls.state.mapId);

    this.ls.onEvents = (events, state) => this.handleEvents(events, state);
    this.ls.onDesync = (tick) => {
      this.flashWarning(`Re-syncing with your partner… (tick ${tick})`);
    };

    this.buildHud();
    this.bindInput();
    this.handleResize();
    // The HUD needs a layout pass before its height can be measured.
    requestAnimationFrame(() => this.handleResize());
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('orientationchange', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibility);
    // The match can start while this tab is already in the background.
    this.handleVisibility();

    music.start();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);

    if (import.meta.env.DEV) {
      // Dev-only handle so the sync between two browsers can be inspected.
      (window as unknown as { __bulwark?: unknown }).__bulwark = {
        lockstep: this.ls,
        hash: () => hashState(this.ls.state),
        state: () => this.ls.state,
      };
    }
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('orientationchange', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.clearInterval(this.idleTimer);
    this.ls.onEvents = null;
    this.ls.onDesync = null;
    music.stop();
    clear(this.root);
  }

  private get state(): GameState {
    return this.ls.state;
  }

  private get me() {
    return this.state.players[this.opts.localPlayer];
  }

  // ================================================================== loop

  private frame = (now: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(64, now - this.lastFrame);
    this.lastFrame = now;

    // A multiplayer pause is only a local menu; this client must keep
    // simulating and publishing inputs or every other player stalls.
    const alpha = this.paused && !this.opts.multiplayer ? 1 : this.ls.update(dt);

    if (this.opts.multiplayer) {
      this.pingTimer += dt;
      if (this.pingTimer > 2000) {
        this.pingTimer = 0;
        this.ls.sendPing();
      }
    }

    const view: ViewOptions = {
      localPlayer: this.opts.localPlayer,
      selectedTowerId: this.selectedTowerId,
      placingDefId: this.placingDefId,
      placeCell: this.placeCell,
      aiming: this.aim,
      padTop: this.padTop(),
      padBottom: this.padBottom(),
    };
    this.renderer.draw(this.state, alpha, view, dt);

    this.hudTimer += dt;
    if (this.hudTimer > 90) {
      this.hudTimer = 0;
      this.updateHud();
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.hud.banner.classList.remove('show');
    }

    if (this.state.gameOver && !this.overlay) this.showResults();

    this.raf = requestAnimationFrame(this.frame);
  };

  private padTop(): number {
    const top = this.root.querySelector('.hud-top') as HTMLElement | null;
    return (top?.offsetHeight ?? 56) + 6;
  }

  private padBottom(): number {
    const bottom = this.root.querySelector('.hud-bottom') as HTMLElement | null;
    return (bottom?.offsetHeight ?? 150) + 6;
  }

  private handleResize = (): void => {
    const bottomPad = this.padBottom();
    // Keep floating panels anchored above the real HUD height. The bottom bar
    // varies with safe-area insets, screen size, and the number of item slots.
    this.root.style.setProperty('--hud-bottom-height', `${bottomPad}px`);
    this.renderer.resize(this.padTop(), bottomPad);
  };

  private idleTimer = 0;
  private idleLast = 0;

  /**
   * Phone browsers stop `requestAnimationFrame` as soon as the tab is hidden or
   * the screen locks. Keep the world ticking (and keep feeding the peer input)
   * from a timer so their battle carries on instead of freezing on
   * "waiting for your partner".
   */
  private handleVisibility = (): void => {
    window.clearInterval(this.idleTimer);
    this.idleTimer = 0;
    if (!this.opts.multiplayer) return;

    if (document.hidden) {
      this.idleLast = performance.now();
      const pump = (): void => {
        const now = performance.now();
        const dt = now - this.idleLast;
        this.idleLast = now;
        // ~2 seconds of grace so a quick glance at a notification is invisible
        // to the other player.
        this.ls.publishIdleAhead(TICK_RATE * 2);
        this.ls.update(dt);
      };
      this.idleTimer = window.setInterval(pump, 400);
      pump();
    } else {
      this.lastFrame = performance.now();
    }
  };

  // ================================================================== input

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerCancel);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (this.paused || this.state.gameOver) return;
    if (this.pointerId !== -1) return;
    this.pointerId = ev.pointerId;
    this.pointerStart = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    this.updateDragTarget(ev);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId) return;
    this.updateDragTarget(ev);
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    const start = this.pointerStart;
    this.pointerStart = null;
    const world = this.renderer.screenToWorld(ev.clientX, ev.clientY);

    if (this.placingDefId >= 0) {
      const cell = this.placeCell;
      this.placingDefId = -1;
      this.placeCell = null;
      this.refreshBuildBar();
      if (cell) {
        this.ls.queue(buildCmd(this.opts.localPlayer, this.pendingBuildId, cell.x, cell.y));
        vibrate(12);
      }
      this.pendingBuildId = -1;
      return;
    }

    if (this.aimingKind !== 'none') {
      const kind = this.aimingKind;
      const slot = this.aimingSlot;
      const towerId = this.aimingTowerId;
      this.aimingKind = 'none';
      this.aimingSlot = -1;
      this.aimingTowerId = 0;
      this.aim = null;
      if (kind === 'ability') {
        this.ls.queue(useAbility(this.opts.localPlayer, this.aimingSkillId, world.x, world.y));
      } else if (kind === 'rally') {
        this.ls.queue(setRally(this.opts.localPlayer, towerId, world.x, world.y));
        this.lastInspectKey = '';
      } else {
        this.ls.queue(useItem(this.opts.localPlayer, slot, world.x, world.y));
      }
      vibrate(12);
      this.refreshActionRow();
      return;
    }

    // Plain tap: select a tower, or order the hero to move.
    const moved = start
      ? Math.hypot(ev.clientX - start.x, ev.clientY - start.y)
      : 0;
    if (moved > 22) return;

    const cell = this.renderer.cellAt(world.x, world.y);
    const tower = this.state.towers.find((t) => t.cx === cell.x && t.cy === cell.y && t.temp === 0);
    if (tower) {
      this.selectedTowerId = this.selectedTowerId === tower.id ? 0 : tower.id;
      audio.play('select', { volume: 0.5 });
      this.lastInspectKey = '';
      this.updateInspector();
      return;
    }

    if (this.selectedTowerId !== 0) {
      this.selectedTowerId = 0;
      this.updateInspector();
      return;
    }

    this.ls.queue(moveHero(this.opts.localPlayer, world.x, world.y));
    audio.play('tap', { volume: 0.25 }, 90);
  };

  private onPointerCancel = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    this.pointerStart = null;
    this.placeCell = null;
    this.aim = null;
  };

  private pendingBuildId = -1;

  private updateDragTarget(ev: PointerEvent): void {
    const world = this.renderer.screenToWorld(ev.clientX, ev.clientY);
    if (this.placingDefId >= 0) {
      this.placeCell = this.renderer.cellAt(world.x, world.y);
    } else if (this.aimingKind !== 'none' && this.aim) {
      this.aim = { x: world.x, y: world.y, radius: this.aim.radius };
    }
  }

  // ================================================================== HUD

  private buildHud(): void {
    clear(this.root);

    const livesVal = el('span', {}, '20');
    const waveVal = el('span', {}, '0');
    const timerVal = el('span', {}, '');
    const goldSelf = el('span', {}, '0');
    const netPill = el('div', { class: 'pill net-pill' }, '');

    const selfColor = PLAYER_COLORS[this.opts.localPlayer];
    const matePills: { idx: number; gold: HTMLElement }[] = [];
    const mateStrip = el('div', { class: 'mate-strip' });
    if (this.opts.multiplayer) {
      for (let idx = 0; idx < this.state.players.length; idx++) {
        if (idx === this.opts.localPlayer) continue;
        const gold = el('span', {}, '0');
        mateStrip.appendChild(el(
          'div',
          { class: `pill mate-pill p${idx + 1}`, title: this.opts.playerNames[idx] ?? 'Ally' },
          el('small', {}, `P${idx + 1}`), '💰', gold,
        ));
        matePills.push({ idx, gold });
      }
    }

    const top = el(
      'div',
      { class: 'hud-top' },
      el('div', { class: 'pill danger' }, '❤', livesVal),
      el('div', { class: 'pill' }, el('small', {}, 'Wave'), waveVal),
      el('div', { class: 'pill' }, timerVal),
      el('div', { class: 'spacer' }),
      el(
        'div',
        { class: `pill self-pill p${this.opts.localPlayer + 1}` },
        el('small', { style: `color:${selfColor}` }, 'You'),
        '💰',
        goldSelf,
      ),
      netPill,
      this.opts.multiplayer ? mateStrip : null,
      this.opts.multiplayer && this.opts.roomCode
        ? el('div', { class: 'pill room-pill', title: 'Room code', 'data-code': this.opts.roomCode }, `ROOM ${this.opts.roomCode}`)
        : null,
      tapButton('icon-btn', () => this.togglePause(), '⏸'),
    );

    const banner = el('div', { class: 'wave-banner' });
    const warning = el('div', { class: 'net-warning' });

    // ---- bottom
    const classTabs = el('div', { class: 'class-tabs' });
    const classButtons: HTMLElement[] = [];
    TOWER_CLASSES.forEach((c, i) => {
      const tab = tapButton(
        'class-tab',
        () => this.setBuildClass(i),
        el('span', { class: 'cg', style: `color:${c.accent}` }, c.glyph),
        el('span', { class: 'cn' }, c.name),
      );
      classButtons.push(tab);
      classTabs.appendChild(tab);
    });

    const buildBar = el('div', { class: 'build-bar' });
    const towerButtons: { btn: HTMLElement; defId: number; cls: number }[] = [];
    for (const t of TOWERS) {
      const btn = tapButton(
        'tower-btn',
        () => this.startPlacing(t.id),
        el('div', { class: 'glyph' }, towerIcon(t.id, this.opts.localPlayer)),
        el('div', { class: 'label' }, t.name),
        el('div', { class: 'cost' }, `${t.cost}`),
      );
      towerButtons.push({ btn, defId: t.id, cls: t.cls });
      buildBar.appendChild(btn);
    }

    const abilityCd = el('div', { class: 'cd' }, '');
    const hd = heroDef(this.me.hero.defId);
    const abilityBtn = tapButton(
      'action-btn power-slot signature',
      () => this.armAbility(-1),
      el('div', { class: 'big' }, abilityIcon(hd.ability.kind)),
      el('div', { class: 'tiny' }, hd.ability.name),
      abilityCd,
    );
    const powersWrap = el('div', { class: 'powers-row' }, abilityBtn);

    const itemsWrap = el('div', { class: 'action-row items-strip' });

    const shopBtn = tapButton(
      'action-btn',
      () => this.toggleShop(),
      el('div', { class: 'big' }, '🛒'),
      el('div', { class: 'tiny' }, 'Shop'),
    );

    const readyBtn = tapButton('btn good ready-btn', () => this.pressReady(), 'READY');

    const actionRow = el('div', { class: 'action-row' }, abilityBtn, itemsWrap, shopBtn, readyBtn);
    const inspector = el('div', { class: 'inspector' });
    const bottom = el('div', { class: 'hud-bottom hero-bottom' }, powersWrap, actionRow);

    this.root.appendChild(top);
    this.root.appendChild(banner);
    this.root.appendChild(warning);
    this.root.appendChild(inspector);
    this.root.appendChild(bottom);

    this.hud = {
      livesVal, waveVal, timerVal, goldSelf, matePills, netPill,
      banner, warning, buildBar, classButtons, actionRow, readyBtn, inspector, towerButtons,
      abilityBtn, abilityCd, powersWrap, itemsWrap, shopBtn,
    };

    // Start on the tab matching the hero the player picked.
    this.buildClass = Math.min(TOWER_CLASSES.length - 1, Math.max(0, this.me.hero.defId));
    this.applyBuildClass();
    this.refreshItems();
    this.refreshPowers();
    this.updateHud();
  }

  private updateHud(): void {
    const s = this.state;
    const me = this.me;

    setText(this.hud.livesVal, String(Math.max(0, s.lives)));
    setText(this.hud.waveVal, String(s.wave));
    setText(this.hud.goldSelf, formatNumber(me.gold));
    for (const pill of this.hud.matePills) {
      const mate = s.players[pill.idx];
      if (mate) setText(pill.gold, `💰${formatNumber(mate.gold)}`);
    }

    if (s.phase === Phase.Build) {
      setText(this.hud.timerVal, '∞ BUILD');
    } else {
      const left = s.spawns.length + s.enemies.length;
      setText(this.hud.timerVal, `👹 ${left}`);
    }

    // Ready button only matters between waves.
    const inBuild = s.phase === Phase.Build;
    this.hud.readyBtn.style.display = inBuild ? '' : 'none';
    this.hud.shopBtn.style.display = inBuild ? '' : 'none';
    if (inBuild) {
      const readyCount = s.players.filter((p) => p.ready).length;
      setText(
        this.hud.readyBtn,
        me.ready
          ? `WAITING ${readyCount}/${s.players.length}`
          : s.wave === 0 ? 'START' : 'READY',
      );
      toggleClass(this.hud.readyBtn, 'ghost', me.ready);
      toggleClass(this.hud.readyBtn, 'good', !me.ready);
    }

    // Ability cooldown
    const h = me.hero;
    if (!h.alive) {
      setText(this.hud.abilityCd, `☠${Math.ceil(h.respawn / TICK_RATE)}`);
      this.hud.abilityCd.style.display = '';
    } else if (h.abilityCd > 0) {
      setText(this.hud.abilityCd, String(Math.ceil(h.abilityCd / TICK_RATE)));
      this.hud.abilityCd.style.display = '';
    } else {
      this.hud.abilityCd.style.display = 'none';
    }
    for (const cd of Array.from(this.hud.powersWrap.querySelectorAll<HTMLElement>('.shared-cd'))) {
      if (!h.alive) { setText(cd, `☠${Math.ceil(h.respawn / TICK_RATE)}`); cd.style.display = ''; }
      else if (h.abilityCd > 0) { setText(cd, String(Math.ceil(h.abilityCd / TICK_RATE))); cd.style.display = ''; }
      else cd.style.display = 'none';
    }
    this.refreshPowers();

    // Affordability shading
    for (const { btn, defId } of this.hud.towerButtons) {
      toggleClass(btn, 'poor', me.gold < towerDef(defId).cost);
      toggleClass(btn, 'selected', this.placingDefId === defId || this.pendingBuildId === defId);
    }

    this.updateNetPill();
    this.updateInspector();
    music.setIntensity(this.musicIntensity());

    // The bottom bar grows and shrinks (ready button, item slots) - keep the
    // battlefield fitted to whatever space is left.
    const pad = this.padBottom();
    if (Math.abs(pad - this.lastPadBottom) > 2) {
      this.lastPadBottom = pad;
      this.handleResize();
    }
  }

  private lastPadBottom = 0;

  private musicIntensity(): number {
    const s = this.state;
    if (s.phase !== Phase.Combat) return 0.12;
    const boss = s.enemies.some((e) => e.boss);
    const pressure = Math.min(1, s.enemies.length / 26);
    const lifeStress = 1 - s.lives / Math.max(1, s.maxLives);
    return Math.min(1, 0.35 + pressure * 0.35 + lifeStress * 0.3 + (boss ? 0.35 : 0));
  }

  private updateNetPill(): void {
    if (!this.opts.multiplayer) {
      this.hud.netPill.style.display = 'none';
      return;
    }
    const st = this.ls.stats();
    setText(this.hud.netPill, st.stalled ? '⏳' : `${st.rttMs}ms`);
    toggleClass(this.hud.netPill, 'danger', st.stalled || st.rttMs > 220);
    toggleClass(this.hud.warning, 'show', st.stalled && st.stallMs > 450);
    if (st.stalled && st.stallMs > 450) {
      setText(this.hud.warning, 'Waiting for your partner…');
    }
  }

  private flashWarning(text: string): void {
    setText(this.hud.warning, text);
    this.hud.warning.classList.add('show');
    window.setTimeout(() => this.hud.warning.classList.remove('show'), 1800);
  }

  private showBanner(title: string, sub = ''): void {
    clear(this.hud.banner);
    this.hud.banner.appendChild(document.createTextNode(title));
    if (sub) this.hud.banner.appendChild(el('span', { class: 'mod' }, sub));
    this.hud.banner.classList.add('show');
    this.bannerTimer = 2600;
  }

  // ------------------------------------------------------------- actions

  private startPlacing(defId: number): void {
    if (this.state.gameOver) return;
    if (this.me.gold < towerDef(defId).cost) {
      audio.play('deny', { volume: 0.6 });
      this.flashWarning('Not enough gold.');
      return;
    }
    if (this.placingDefId === defId) {
      this.placingDefId = -1;
      this.pendingBuildId = -1;
    } else {
      this.placingDefId = defId;
      this.pendingBuildId = defId;
      this.selectedTowerId = 0;
      this.aimingKind = 'none';
      this.aim = null;
      audio.play('click', { volume: 0.4 });
      this.flashWarning('Drag onto a green tile, then release to build.');
      const d = towerDef(defId);
      this.showTowerBrief(d.name, d.desc, d.cost);
    }
    this.placeCell = null;
    this.refreshBuildBar();
    this.updateInspector();
  }

  private showTowerBrief(name: string, desc: string, cost: number): void {
    clear(this.hud.inspector);
    this.hud.inspector.append(
      el('div', { class: 'inspector-head' }, el('div', { class: 'nm' }, name), el('div', { class: 'lv' }, `${cost}g`)),
      el('div', { class: 'placement-desc' }, desc),
      el('div', { class: 'placement-tip' }, 'Drag to a green tile • tap again to cancel'),
    );
    this.hud.inspector.classList.add('show');
  }

  private openSkillTree(): void {
    if (this.me.skillPoints <= 0 || this.overlay) return;
    const choices = availableSkills(this.me.skills);
    let selected = choices[0] ?? SKILLS[0];
    const panel = el('div', { class: 'skill-panel' },
      el('div', { class: 'skill-kicker' }, 'HERO LEVEL UP'),
      el('h2', {}, 'Choose your path'),
      el('p', { class: 'skill-sub' }, `${this.me.skillPoints} skill point${this.me.skillPoints === 1 ? '' : 's'} available`),
    );
    const tree = el('div', { class: 'skill-tree' });
    tree.appendChild(el('div', { class: 'skill-root' }, el('div', { class: 'skill-root-node' }, heroDef(this.me.hero.defId).name)));
    const branches = el('div', { class: 'skill-branches' });
    const nodes = new Map<number, HTMLElement>();
    const detail = el('div', { class: 'skill-detail' });
    const renderDetail = (): void => {
      for (const [id, node] of nodes) toggleClass(node, 'selected', id === selected.id);
      const owned = this.me.skills.includes(selected.id);
      const available = choices.some((v) => v.id === selected.id);
      const requirement = selected.requires >= 0 ? skillDef(selected.requires).name : '';
      clear(detail);
      detail.append(
        el('div', { class: 'skill-detail-icon' }, selected.icon),
        el('div', { class: 'skill-detail-copy' },
          el('div', { class: 'skill-detail-head' },
            el('div', { class: 'skill-name' }, selected.name),
            el('div', { class: `skill-status ${owned ? 'owned' : available ? 'ready' : 'locked'}` }, owned ? 'LEARNED' : available ? 'AVAILABLE' : 'LOCKED'),
          ),
          el('div', { class: 'skill-desc' }, selected.desc),
          !owned && !available && requirement ? el('div', { class: 'skill-requires' }, `Requires ${requirement}`) : null,
        ),
        tapButton(`btn skill-unlock${available ? ' good' : ' ghost'}`, () => {
          if (!available) return;
          this.ls.queue(chooseSkill(this.opts.localPlayer, selected.id));
          this.closeOverlay();
        }, owned ? '✓ Learned' : available ? 'Unlock' : '🔒 Locked'),
      );
    };
    for (const branch of ['Might', 'Survival', 'Tactics'] as const) {
      const path = el('div', { class: `skill-path ${branch.toLowerCase()}` }, el('div', { class: 'branch-name' }, branch));
      for (const sk of SKILLS.filter((v) => v.branch === branch)) {
        const owned = this.me.skills.includes(sk.id);
        const available = choices.some((v) => v.id === sk.id);
        const node = tapButton(`skill-node${owned ? ' owned' : ''}${available ? ' available' : ' locked'}`, () => {
          selected = sk;
          audio.play('click', { volume: 0.35 });
          renderDetail();
        }, el('span', { class: 'skill-node-icon' }, sk.icon), el('span', { class: 'skill-node-tier' }, String(sk.tier)));
        node.title = sk.name;
        nodes.set(sk.id, node);
        path.appendChild(node);
      }
      branches.appendChild(path);
    }
    tree.appendChild(branches);
    panel.append(tree, detail);
    panel.appendChild(tapButton('btn ghost skill-later', () => this.closeOverlay(), 'Choose later'));
    const overlay = el('div', { class: 'overlay skill-overlay' }, panel);
    this.overlay = overlay; this.root.appendChild(overlay);
    renderDetail();
  }

  private refreshBuildBar(): void {
    for (const { btn, defId } of this.hud.towerButtons) {
      toggleClass(btn, 'selected', this.placingDefId === defId);
    }
  }

  private setBuildClass(cls: number): void {
    this.buildClass = cls;
    audio.play('click', { volume: 0.4 });
    this.applyBuildClass();
  }

  private applyBuildClass(): void {
    this.hud.classButtons.forEach((tab, i) => toggleClass(tab, 'active', i === this.buildClass));
    for (const { btn, cls } of this.hud.towerButtons) {
      btn.style.display = cls === this.buildClass ? '' : 'none';
    }
    this.hud.buildBar.scrollLeft = 0;
  }

  private armAbility(skillId: number): void {
    const h = this.me.hero;
    if (!h.alive || h.abilityCd > 0) {
      audio.play('deny', { volume: 0.5 });
      return;
    }
    const learned = skillId >= 0 ? skillDef(skillId) : null;
    const ab = learned?.active ?? heroDef(h.defId).ability;
    this.aimingSkillId = skillId;
    if (!ab.targeted) {
      this.ls.queue(useAbility(this.opts.localPlayer, skillId, h.x, h.y));
      vibrate(16);
      return;
    }
    this.placingDefId = -1;
    this.aimingKind = 'ability';
    this.aim = { x: h.x, y: h.y - FX_ONE * 2, radius: ab.radius };
    this.flashWarning(`Drag to aim ${learned?.name ?? heroDef(h.defId).ability.name}, release to cast.`);
    this.refreshActionRow();
  }

  private armItem(slot: number): void {
    const inv = this.me.items[slot];
    if (!inv) return;
    const d = itemDef(inv.itemId);
    if (!d.targeted) {
      this.ls.queue(useItem(this.opts.localPlayer, slot, this.me.hero.x, this.me.hero.y));
      vibrate(16);
      return;
    }
    this.placingDefId = -1;
    this.aimingKind = 'item';
    this.aimingSlot = slot;
    this.aim = { x: this.me.hero.x, y: this.me.hero.y - FX_ONE * 2, radius: d.radius };
    this.flashWarning(`Drag to aim ${d.name}, release to use.`);
    this.refreshActionRow();
  }

  private refreshActionRow(): void {
    toggleClass(this.hud.abilityBtn, 'armed', this.aimingKind === 'ability');
    for (const node of Array.from(this.hud.powersWrap.querySelectorAll<HTMLElement>('.power-slot'))) {
      toggleClass(node, 'armed', this.aimingKind === 'ability' && Number(node.dataset.skillId) === this.aimingSkillId);
    }
    this.refreshItems();
  }

  private refreshPowers(): void {
    const learned = activeSkills(this.me.skills);
    const key = learned.map((s) => s.id).join(',');
    if (this.hud.powersWrap.dataset.key === key) return;
    this.hud.powersWrap.dataset.key = key;
    const signature = this.hud.abilityBtn;
    signature.dataset.skillId = '-1';
    clear(this.hud.powersWrap);
    this.hud.powersWrap.appendChild(signature);
    for (const sk of learned) {
      const btn = tapButton('action-btn power-slot', () => this.armAbility(sk.id),
        el('div', { class: 'big' }, sk.icon),
        el('div', { class: 'tiny' }, sk.name),
        el('div', { class: 'cd shared-cd' }, ''),
      );
      btn.dataset.skillId = String(sk.id);
      btn.title = sk.desc;
      this.hud.powersWrap.appendChild(btn);
    }
  }

  /** Arm the "move my squad" tap for a barracks-style tower. */
  private armRally(t: Tower): void {
    this.placingDefId = -1;
    this.aimingKind = 'rally';
    this.aimingTowerId = t.id;
    this.aim = { x: t.rx, y: t.ry, radius: FX_ONE };
    this.flashWarning('Drag onto the road, release to post the squad there.');
  }

  private refreshItems(): void {
    clear(this.hud.itemsWrap);
    this.me.items.forEach((inv, i) => {
      const d = itemDef(inv.itemId);
      const btn = tapButton(
        'action-btn',
        () => this.armItem(i),
        el('div', { class: 'big' }, d.icon),
        el('div', { class: 'tiny' }, d.name.split(' ')[0]),
        el('div', { class: 'badge' }, `x${inv.charges}`),
      );
      if (this.aimingKind === 'item' && this.aimingSlot === i) btn.classList.add('armed');
      this.hud.itemsWrap.appendChild(btn);
    });
  }

  private pressReady(): void {
    this.ls.queue(toggleReady(this.opts.localPlayer));
    audio.play('click', { volume: 0.6 });
  }

  // ---------------------------------------------------------- inspector

  private updateInspector(): void {
    if (this.placingDefId >= 0) {
      const d = towerDef(this.placingDefId);
      const key = `placing:${d.id}`;
      if (this.lastInspectKey !== key) {
        this.lastInspectKey = key;
        this.showTowerBrief(d.name, d.desc, d.cost);
      }
      return;
    }
    const t = this.state.towers.find((x) => x.id === this.selectedTowerId);
    if (!t) {
      if (this.hud.inspector.classList.contains('show')) {
        this.hud.inspector.classList.remove('show');
        this.lastInspectKey = '';
      }
      return;
    }
    const key = `${t.id}|${t.level}|${t.power}|${t.targetMode}|${this.me.gold >= this.nextCost(t)}`;
    if (key === this.lastInspectKey) return;
    this.lastInspectKey = key;

    const d = towerDef(t.defId);
    const stats = computeTowerStats(t.defId, t.power, t.level);
    const mine = t.owner === this.opts.localPlayer;
    const maxed = t.level >= MAX_TOWER_LEVEL;
    const split = trackSplit(t.power, t.level);
    const cost = this.nextCost(t);
    const title = towerTitle(t.defId, t.power, t.level);

    const nextStats = maxed
      ? stats
      : computeTowerStats(t.defId, t.power, Math.min(MAX_TOWER_LEVEL, t.level + 1));

    clear(this.hud.inspector);
    this.hud.inspector.classList.add('show');

    this.hud.inspector.appendChild(
      el(
        'div',
        { class: 'inspector-head' },
        el('span', { class: 'nm' }, title),
        el('span', { class: 'lv' }, `Lv ${t.level}${maxed ? ' MAX' : ''}`),
        el(
          'span',
          { class: 'owner', style: `color:${PLAYER_COLORS[t.owner]}` },
          mine ? 'Yours' : (this.opts.playerNames[t.owner] ?? 'Ally'),
        ),
      ),
    );

    const dps = stats.isSupport
      ? 0
      : Math.round((stats.damage * Math.max(1, stats.multiShot) * TICK_RATE) / stats.cooldown);
    const nextDps = stats.isSupport
      ? 0
      : Math.round((nextStats.damage * Math.max(1, nextStats.multiShot) * TICK_RATE) / nextStats.cooldown);

    if (stats.barracks) {
      const squadDps = Math.round((stats.unitDamage * stats.unitCount * TICK_RATE) / stats.unitCooldown);
      const nextSquadDps = Math.round(
        (nextStats.unitDamage * nextStats.unitCount * TICK_RATE) / nextStats.unitCooldown,
      );
      this.hud.inspector.appendChild(
        el(
          'div',
          { class: 'stat-grid' },
          statBox('Squad DPS', formatNumber(squadDps), !maxed && nextSquadDps > squadDps),
          statBox('Soldiers', String(stats.unitCount), !maxed && nextStats.unitCount > stats.unitCount),
          statBox('Unit HP', formatNumber(stats.unitHp), !maxed && nextStats.unitHp > stats.unitHp),
          statBox('Respawn', `${(stats.unitRespawn / TICK_RATE).toFixed(1)}s`, false),
        ),
      );
      this.hud.inspector.appendChild(
        el('div', { class: 'muted', style: 'margin-bottom:8px' },
          'Soldiers hold ground enemies in place at their rally post. They cannot touch flyers.'),
      );
    } else {
      this.hud.inspector.appendChild(
        el(
          'div',
          { class: 'stat-grid' },
          statBox('DPS', stats.isSupport ? '—' : formatNumber(dps), !maxed && nextDps > dps),
          statBox('Damage', stats.isSupport ? '—' : String(stats.damage), !maxed && nextStats.damage > stats.damage),
          statBox('Range', fxToFloat(stats.range).toFixed(1), !maxed && nextStats.range > stats.range),
          statBox('Rate', stats.isSupport ? '—' : `${(TICK_RATE / stats.cooldown).toFixed(1)}/s`, !maxed && nextStats.cooldown < stats.cooldown),
        ),
      );
    }

    if (stats.isSupport) {
      this.hud.inspector.appendChild(
        el('div', { class: 'muted', style: 'margin-bottom:8px' },
          `Aura: +${stats.auraDamagePct}% damage, +${stats.auraRatePct}% fire rate, +${stats.auraRangePct}% range to nearby towers.`
          + (stats.income > 0 ? ` Generates ${stats.income} gold/s.` : '')),
      );
    }

    if (mine && !maxed) {
      const row = el('div', { class: 'track-row' });
      const tracks: Array<[number, string, TowerTrack, number, string]> = [
        [Track.Power, '⚔ Power', d.power, split.power, `+${d.power.pct}% damage`],
        [Track.Speed, '⚡ Speed', d.speed, split.speed, `+${d.speed.pct}% fire rate`],
      ];
      for (const [track, label, def, picks, gain] of tracks) {
        const next = picks + 1;
        const perk = next === 2 ? def.t2Desc : next === 4 ? def.t4Desc : '';
        const btn = tapButton(
          `track-btn ${track === Track.Power ? 'power' : 'speed'}`,
          () => {
            this.ls.queue(upgradeCmd(this.opts.localPlayer, t.id, track));
            this.lastInspectKey = '';
          },
          el('div', { class: 'tn' }, label),
          el('div', { class: 'tp' }, pips(picks)),
          el('div', { class: 'td' }, perk ? `${gain} · ${perk}` : gain),
          el('div', { class: 'tc' }, `${cost}g`),
        );
        if (this.me.gold < cost) btn.setAttribute('aria-disabled', 'true');
        row.appendChild(btn);
      }
      this.hud.inspector.appendChild(row);
    } else if (t.level > 1) {
      this.hud.inspector.appendChild(
        el('div', { class: 'muted', style: 'margin-bottom:8px' },
          `⚔ Power ${pips(split.power)}   ⚡ Speed ${pips(split.speed)}`),
      );
    }

    const buttons: HTMLElement[] = [];
    if (mine) {
      buttons.push(
        stats.barracks
          ? tapButton('btn ghost', () => this.armRally(t), '🚩 Rally')
          : tapButton('btn ghost', () => {
            this.ls.queue(setTargetMode(this.opts.localPlayer, t.id, (t.targetMode + 1) % 4));
            this.lastInspectKey = '';
          }, `🎯 ${TARGET_MODE_NAMES[t.targetMode]}`),
      );      buttons.push(
        tapButton('btn danger', () => {
          this.ls.queue(sell(this.opts.localPlayer, t.id));
          this.selectedTowerId = 0;
          this.lastInspectKey = '';
        }, `Sell ${Math.floor((t.invested * 70) / 100)}g`),
      );
    }
    if (buttons.length) {
      this.hud.inspector.appendChild(el('div', { class: 'btn-row' }, ...buttons));
    } else {
      this.hud.inspector.appendChild(
        el('div', { class: 'muted' }, "This is your partner's tower - only they can upgrade or sell it."),
      );
    }
  }

  private nextCost(t: Tower): number {
    if (t.level >= MAX_TOWER_LEVEL) return 0;
    const raw = upgradeCost(t.defId, t.level);
    const disc = this.discount();
    return Math.max(1, raw - Math.floor((raw * disc) / 100));
  }

  private discount(): number {
    let d = 0;
    for (const r of this.me.relics) d += relicDef(r).mods.upgradeDiscountPct ?? 0;
    return Math.min(60, d);
  }

  // --------------------------------------------------------------- shop

  private toggleShop(): void {
    this.shopOpen = !this.shopOpen;
    if (this.shopOpen) this.openShop();
    else this.closeOverlay();
  }

  private openShop(): void {
    this.closeOverlay();
    const s = this.state;
    const me = this.me;
    const bit = 1 << this.opts.localPlayer;

    const grid = el('div', { class: 'shop-grid' });
    s.shop.forEach((offer, i) => {
      const owned = (offer.soldTo & bit) !== 0;
      const isRelic = offer.kind === 0;
      const info = isRelic ? relicDef(offer.id) : itemDef(offer.id);
      const btn = tapButton(
        `shop-item${owned ? ' owned' : ''}`,
        () => {
          if (owned) return;
          this.ls.queue(buyShop(this.opts.localPlayer, i));
          audio.play('purchase', { volume: 0.8 });
          window.setTimeout(() => this.openShop(), 140);
        },
        el('div', { class: 'ic' }, info.icon),
        el(
          'div',
          {},
          el('div', { class: 'nm' }, `${info.name}${isRelic ? '' : ` ×${(info as ReturnType<typeof itemDef>).charges}`}`),
          el('div', { class: 'ds' }, info.desc),
          el('div', { class: 'pr' }, owned ? 'PURCHASED' : `${offer.cost}g`),
        ),
      );
      if (!owned && me.gold < offer.cost) btn.setAttribute('aria-disabled', 'true');
      grid.appendChild(btn);
    });

    const relicList = me.relics.length
      ? me.relics.map((r) => relicDef(r).icon + ' ' + relicDef(r).name).join(' · ')
      : 'None yet.';

    const panel = el(
      'div',
      { class: 'screen transparent' },
      el(
        'div',
        { class: 'stack' },
        el(
          'div',
          { class: 'card' },
          el('h2', {}, `Quartermaster · Wave ${s.shopWave}`),
          el('div', { class: 'muted', style: 'margin-bottom:10px' },
            `Your gold: ${me.gold}. Each offer can be bought once per player - your partner sees the same stock.`),
          grid,
          el('h3', {}, 'Your relics'),
          el('div', { class: 'muted' }, relicList),
        ),
        tapButton('btn primary', () => { this.shopOpen = false; this.closeOverlay(); }, 'Close'),
      ),
    );
    this.overlay = panel;
    this.root.appendChild(panel);
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  // -------------------------------------------------------------- pause

  private togglePause(): void {
    if (this.state.gameOver) return;
    this.paused = !this.paused;
    // In multiplayer the world must not stop for one player only.
    if (!this.opts.multiplayer) this.ls.paused = this.paused;
    if (this.paused) this.openPause();
    else this.closeOverlay();
  }

  private openPause(): void {
    this.closeOverlay();
    const volRow = (label: string, get: () => number, set: (v: number) => void): HTMLElement => {
      const val = el('span', {}, `${Math.round(get() * 100)}%`);
      return el(
        'div',
        { class: 'btn-row', style: 'align-items:center' },
        el('div', { style: 'flex:1;font-weight:700' }, label),
        tapButton('btn ghost', () => {
          set(Math.max(0, get() - 0.15));
          audio.applyVolumes();
          setText(val, `${Math.round(get() * 100)}%`);
        }, '−'),
        el('div', { style: 'flex:0 0 56px;text-align:center;font-weight:800' }, val),
        tapButton('btn ghost', () => {
          set(Math.min(1, get() + 0.15));
          audio.applyVolumes();
          setText(val, `${Math.round(get() * 100)}%`);
        }, '+'),
      );
    };

    const panel = el(
      'div',
      { class: 'screen transparent' },
      el(
        'div',
        { class: 'stack' },
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Paused'),
          this.opts.multiplayer
            ? el('div', { class: 'muted', style: 'margin-bottom:10px' },
              'The battle keeps running for your partner - co-op cannot pause the world.')
            : null,
          volRow('Sound effects', () => audio.sfxVolume, (v) => { audio.sfxVolume = v; }),
          volRow('Music', () => audio.musicVolume, (v) => { audio.musicVolume = v; }),
          el('h3', {}, 'How to play'),
          el('div', { class: 'muted' },
            'Tap the battlefield to move your hero. Build a power path at each level, '
            + 'use items between attacks, and summon companions that persist for the match.'),
        ),
        tapButton('btn primary', () => this.togglePause(), 'Resume'),
        tapButton('btn danger', () => { this.closeOverlay(); this.opts.onLeave(); }, 'Leave match'),
      ),
    );
    this.overlay = panel;
    this.root.appendChild(panel);
  }

  // ------------------------------------------------------------ results

  private showResults(): void {
    music.setIntensity(0);
    const s = this.state;
    const me = this.me;
    const panel = el(
      'div',
      { class: 'screen transparent' },
      el(
        'div',
        { class: 'stack' },
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'The keep has fallen'),
          el('div', { class: 'muted', style: 'margin-bottom:12px' },
            `You held out for ${s.wave} wave${s.wave === 1 ? '' : 's'}.`),
          el(
            'div',
            { class: 'result-stats' },
            statBox('Waves', String(s.wave), false),
            statBox('Score', formatNumber(s.score), false),
            statBox('Your kills', formatNumber(me.kills), false),
            statBox('Your damage', formatNumber(me.damage), false),
            statBox('Powers learned', String(me.skills.length), false),
            statBox('Gold earned', formatNumber(me.goldEarned), false),
          ),
        ),
        tapButton('btn primary', () => this.opts.onRestart(), 'Play again'),
        tapButton('btn ghost', () => this.opts.onLeave(), 'Back to menu'),
      ),
    );
    this.overlay = panel;
    this.root.appendChild(panel);
  }

  // ============================================================== events

  private handleEvents(events: readonly SimEvent[], state: GameState): void {
    const fx = this.renderer.fx;
    const cell = this.renderer.cellPx;
    const local = this.opts.localPlayer;

    for (const ev of events) {
      const x = this.renderer.toCanvasX(ev.x);
      const y = this.renderer.toCanvasY(ev.y);
      const pan = Math.max(-0.8, Math.min(0.8, (x / this.canvas.width - 0.5) * 1.6));

      switch (ev.kind) {
        case EventKind.Shot: {
          const x2 = this.renderer.toCanvasX(ev.x2);
          const y2 = this.renderer.toCanvasY(ev.y2);
          if (ev.a === -2) {
            // A barracks soldier swinging - a scuffle, not a gunshot.
            fx.beam(x, y, x2, y2, '#ffe9a8', 1.5, 60, 2);
            audio.vary('hit', 1.15, 0.2, { volume: 0.16, pan }, 45);
            break;
          }
          fx.burst(x, y, 2, '#ffe9a8', cell * 0.05, cell * 0.09);
          this.shotSound(ev.b, pan);
          if (ev.b === ProjKind.Shard) fx.ring(x, y, cell * 2.2, '#7ee8ff', 3, 320);
          if (ev.a === -1) fx.beam(x, y, x2, y2, '#ffffff', 1.5, 70, 2);
          break;
        }
        case EventKind.Chain: {
          const x2 = this.renderer.toCanvasX(ev.x2);
          const y2 = this.renderer.toCanvasY(ev.y2);
          fx.beam(x, y, x2, y2, '#c39cff', 3.5, 150, cell * 0.16);
          audio.vary('zap', 1.1, 0.2, { volume: 0.35, pan }, 55);
          break;
        }
        case EventKind.Hit: {
          const color = this.renderer.damageColor(ev.b);
          fx.burst(x, y, 3, color, cell * 0.06, cell * 0.08);
          if (ev.a >= 40) fx.text(x, y - cell * 0.5, String(ev.a), color, Math.min(26, 12 + ev.a / 25));
          if (ev.a >= 25) audio.vary('hit', 1, 0.2, { volume: 0.22, pan }, 60);
          break;
        }
        case EventKind.Explosion: {
          const r = fxToFloat(ev.a) * cell;
          fx.explosion(x, y, Math.max(cell * 0.6, r), this.renderer.damageColor(ev.b));
          audio.vary('boom', 1, 0.18, { volume: 0.5, pan }, 70);
          break;
        }
        case EventKind.EnemyDeath: {
          const boss = ev.b === 1;
          const d = enemyDef(ev.a);
          fx.burst(x, y, boss ? 26 : 8, '#ffd0a0', cell * (boss ? 0.14 : 0.07), cell * 0.12);
          fx.sprites(x, y, boss ? 8 : 3, FXART.smokeA, cell * 0.05, cell * 0.5, 520);
          if (boss) {
            fx.explosion(x, y, cell * 3, '#ff7a3c');
            audio.play('gong', { volume: 0.8, pan });
          } else {
            audio.vary(Math.random() > 0.5 ? 'death' : 'deathAlt', 1, 0.25, { volume: 0.3, pan }, 40);
          }
          void d;
          break;
        }
        case EventKind.Leak: {
          fx.shake = Math.min(20, fx.shake + 10);
          fx.ring(x, y, cell * 3, '#ff5d4a', 5, 520);
          fx.text(x, y - cell, `-${ev.a} ❤`, '#ff5d4a', 26);
          audio.play('error', { volume: 0.7 });
          vibrate([30, 40, 30]);
          break;
        }
        case EventKind.SoldierSpawn:
          fx.ring(x, y, cell * 0.7, PLAYER_COLORS[ev.owner] ?? '#fff', 2, 300);
          break;
        case EventKind.SoldierDeath:
          fx.burst(x, y, 6, '#ffd0a0', cell * 0.06, cell * 0.1);
          audio.vary('thud', 1.2, 0.15, { volume: 0.28, pan }, 60);
          break;
        case EventKind.TowerBuilt:
          fx.ring(x, y, cell * 1.2, '#8effc0', 3, 380);
          audio.play('build', { volume: 0.7, pan });
          break;
        case EventKind.TowerUpgraded:
          fx.ring(x, y, cell * 1.6, '#ffd447', 4, 460);
          fx.sprites(x, y, 6, FXART.sparkle, cell * 0.06, cell * 0.4, 620);
          audio.play('upgrade', { volume: 0.7, pan });
          this.lastInspectKey = '';
          break;
        case EventKind.TowerSold:
          fx.burst(x, y, 8, '#ffd447', cell * 0.06, cell * 0.1);
          audio.play('sell', { volume: 0.6, pan });
          break;
        case EventKind.WaveStart: {
          const modName = ev.b !== 0 ? `${WAVE_MOD_INFO[ev.b].icon} ${WAVE_MOD_INFO[ev.b].name} — ${WAVE_MOD_INFO[ev.b].desc}` : '';
          this.showBanner(ev.owner === 1 ? `WAVE ${ev.a} · BOSS` : `WAVE ${ev.a}`, modName);
          audio.jingle('waveStart', 0.6);
          this.closeOverlayIfShop();
          break;
        }
        case EventKind.WaveCleared:
          this.showBanner(`Wave ${ev.a} cleared`, `+${ev.b} gold each`);
          audio.jingle('waveClear', 0.6);
          break;
        case EventKind.BossSpawn:
          this.showBanner('⚠ BOSS INCOMING', enemyDef(ev.a).name);
          audio.jingle('boss', 0.7);
          vibrate([40, 60, 40]);
          break;
        case EventKind.HeroAbility: {
          if (ev.a === -1) break; // emote
          if (ev.a === -2) {
            fx.ring(x, y, cell * 2.5, '#6bff9a', 2, 400);
            break;
          }
          const r = fxToFloat(ev.b) * cell;
          fx.ring(x, y, Math.max(cell, r), PLAYER_COLORS[ev.owner] ?? '#fff', 5, 520);
          fx.burst(x, y, 14, PLAYER_COLORS[ev.owner] ?? '#fff', cell * 0.1, cell * 0.12);
          this.heroSkillSound(state.players[ev.owner]?.hero.defId ?? -1, pan);
          break;
        }
        case EventKind.HeroDeath:
          fx.explosion(x, y, cell * 1.6, '#ff5d4a');
          if (ev.owner === local) this.flashWarning('You were defeated - respawning…');
          audio.play('thud', { volume: 0.7, pan });
          break;
        case EventKind.HeroLevel:
          fx.ring(x, y, cell * 1.8, '#ffd447', 4, 620);
          fx.text(x, y - cell, `LEVEL ${ev.a}`, '#ffd447', 20);
          if (ev.owner === local) { audio.jingle('levelUp', 0.5); window.setTimeout(() => this.openSkillTree(), 450); }
          break;
        case EventKind.ItemSpawn:
          fx.ring(x, y, cell * 0.65, '#ffd86b', 3, 520);
          break;
        case EventKind.ItemPickup:
          fx.ring(x, y, cell, '#7fffd4', 4, 460);
          fx.text(x, y - cell * 0.6, ev.owner === local ? `${itemDef(ev.a).name} +${ev.b}` : 'ITEM FOUND', '#7fffd4', 15);
          audio.play('item', { volume: 0.75 });
          if (ev.owner === local) this.refreshItems();
          break;
        case EventKind.SkillChosen:
          fx.text(x, y - cell, skillDef(ev.a).name, '#ffd447', 17);
          break;
        case EventKind.GoldGain:
          if (ev.owner === local && ev.a >= 12) {
            fx.text(x, y - cell * 0.3, `+${ev.a}g`, '#ffd447', 14);
          }
          break;
        case EventKind.ItemUsed:
          this.itemUseSound(ev.a, pan);
          this.refreshItems();
          break;
        case EventKind.Purchase:
          if (ev.owner === local) audio.play('purchase', { volume: 0.8 });
          this.refreshItems();
          break;
        case EventKind.Freeze:
          audio.play('shatter', { volume: 0.8 });
          break;
        case EventKind.Denied:
          if (ev.owner === local) {
            audio.play('deny', { volume: 0.6 });
            this.flashWarning('Not enough gold, or that tile is blocked.');
          }
          break;
        case EventKind.Defeat:
          audio.jingle('defeat', 0.8);
          break;
        default:
          break;
      }
    }
    void state;
  }

  private closeOverlayIfShop(): void {
    if (this.shopOpen) {
      this.shopOpen = false;
      this.closeOverlay();
    }
  }

  private shotSound(projKind: number, pan: number): void {
    switch (projKind) {
      case ProjKind.Shell:
      case ProjKind.Rocket:
        audio.vary('shotHeavy', 0.9, 0.15, { volume: 0.32, pan }, 70);
        break;
      case ProjKind.Slug:
        audio.vary('shotSnipe', 0.85, 0.12, { volume: 0.34, pan }, 70);
        break;
      case ProjKind.Spark:
        audio.vary('zap', 1.15, 0.2, { volume: 0.24, pan }, 70);
        break;
      case ProjKind.Ember:
        audio.vary('splat', 1.4, 0.25, { volume: 0.1, pan }, 110);
        break;
      case ProjKind.Glob:
        audio.vary('splat', 1.1, 0.2, { volume: 0.16, pan }, 90);
        break;
      case ProjKind.Shard:
        audio.vary('shatter', 1.2, 0.15, { volume: 0.2, pan }, 120);
        break;
      default:
        audio.vary('shotLight', 1.25, 0.2, { volume: 0.16, pan }, 55);
        break;
    }
  }

  private heroSkillSound(heroId: number, pan: number): void {
    const sounds: Record<number, readonly [string, number, number]> = {
      [HERO.Paladin]: ['magic2', 0.82, 0.95],
      [HERO.Orc]: ['magic7', 0.88, 0.72],
      [HERO.DarkElf]: ['magic6', 0.78, 0.86],
      [HERO.HighElf]: ['magic3', 0.8, 1.18],
      [HERO.Magician]: ['magic4', 0.9, 0.9],
    };
    const [name, volume, rate] = sounds[heroId] ?? ['magic1', 0.8, 1];
    audio.play(name, { volume, rate, pan }, 90);
  }

  private itemUseSound(itemId: number, pan: number): void {
    const sounds: Record<number, readonly [string, number, number]> = {
      [ItemKind.Meteor]: ['magic4', 0.92, 0.78],
      [ItemKind.FrostNova]: ['magic5', 0.88, 1.08],
      [ItemKind.GoldCache]: ['magic3', 0.72, 1.35],
      [ItemKind.RepairKit]: ['magic2', 0.82, 1.18],
      [ItemKind.TimeWarp]: ['magic6', 0.84, 0.7],
      [ItemKind.TurretKit]: ['magic7', 0.78, 1.1],
      [ItemKind.Overload]: ['magic1', 0.86, 1.28],
    };
    const [name, volume, rate] = sounds[itemId] ?? ['magic1', 0.75, 1];
    audio.play(name, { volume, rate, pan }, 90);
  }
}

// ------------------------------------------------------------------ helpers

function statBox(key: string, value: string, improving: boolean): HTMLElement {
  return el(
    'div',
    { class: 'stat' },
    el('div', { class: 'k' }, key),
    el('div', { class: `v${improving ? ' up' : ''}` }, value),
  );
}

function abilityIcon(kind: number): string {
  return ['🛡', '🏹', '☄', '🔧'][kind] ?? '✨';
}

/** Render a small tower portrait for the build bar using the real sprites. */
export function towerIcon(defId: number, owner: number, size = TOWER_GLYPH_SIZE): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = size * dpr;
  c.height = size * dpr;
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  const g = c.getContext('2d');
  if (g) {
    drawTowerSprite(g, defId, c.width / 2, c.height / 2, c.width * 0.96, {
      rot: 0,
      team: PLAYER_COLORS[owner % PLAYER_COLORS.length],
      time: 0,
      fire: 0,
      level: 1,
      power: 0,
    });
  }
  return c;
}

export { getMap };
