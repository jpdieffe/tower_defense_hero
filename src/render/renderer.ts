import { FX_ONE, fxToFloat } from '../core/fixed';
import { makeLocalRng } from '../core/rng';
import { CRYSTAL, FXART } from '../content/art';
import { buildMapRuntime, isBuildable, isBuildSite, type MapRuntime } from '../content/maps';
import { enemyDef, ENEMY_TINTS } from '../content/enemies';
import { heroDef } from '../content/heroes';
import { itemDef } from '../content/items';
import { towerDef, computeTowerStats } from '../content/towers';
import {
  GroundKind, Phase, ProjKind,
  type Enemy, type GameState,
} from '../sim/types';
import { atlas } from './atlas';
import { Fx } from './fx';
import { drawHeroSprite } from './heroart';
import { drawTowerSprite } from './towerart';

export const PLAYER_COLORS = ['#4aa3ff', '#ff9a3c', '#57e08a', '#d06cff', '#ff5f91', '#45d7d0'];
export const PLAYER_GLOW = [
  'rgba(74,163,255,0.55)',
  'rgba(255,154,60,0.55)',
  'rgba(87,224,138,0.55)',
  'rgba(208,108,255,0.55)',
  'rgba(255,95,145,0.55)',
  'rgba(69,215,208,0.55)',
];

const DMG_COLORS = ['#ffffff', '#ff8a3c', '#7ee8ff', '#c39cff', '#9ff05a', '#ffd447'];

export interface ViewOptions {
  localPlayer: number;
  selectedTowerId: number;
  /** Tower type currently being placed, or -1. */
  placingDefId: number;
  placeCell: { x: number; y: number } | null;
  /** World-space aim reticle while targeting an ability or item. */
  aiming: { x: number; y: number; radius: number } | null;
  padTop: number;
  padBottom: number;
}

export interface Camera {
  ox: number;
  oy: number;
  cell: number;
}

export class Renderer {
  readonly fx = new Fx();
  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private terrainKey = '';
  private rt: MapRuntime;
  private cam: Camera = { ox: 0, oy: 0, cell: 32 };
  private dpr = 1;
  private time = 0;

  constructor(private canvas: HTMLCanvasElement, mapId: number) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = ctx;
    this.rt = buildMapRuntime(mapId);
  }

  setMap(mapId: number): void {
    this.rt = buildMapRuntime(mapId);
    this.terrain = null;
  }

  get camera(): Camera {
    return this.cam;
  }

  resize(padTop: number, padBottom: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.terrain = null;
    }

    const top = padTop * this.dpr;
    const bottom = padBottom * this.dpr;
    const availW = w;
    const availH = Math.max(80, h - top - bottom);
    const { w: mw, h: mh } = this.rt.def;
    const cell = Math.floor(Math.min(availW / mw, availH / mh));
    this.cam.cell = Math.max(8, cell);
    this.cam.ox = Math.round((availW - this.cam.cell * mw) / 2);
    this.cam.oy = Math.round(top + (availH - this.cam.cell * mh) / 2);
  }

  /** Convert a CSS pixel position (e.g. a touch) into fixed-point world units. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * this.dpr;
    const py = (clientY - rect.top) * this.dpr;
    return {
      x: Math.round(((px - this.cam.ox) / this.cam.cell) * FX_ONE),
      y: Math.round(((py - this.cam.oy) / this.cam.cell) * FX_ONE),
    };
  }

  worldToScreenCss(fxX: number, fxY: number): { x: number; y: number } {
    return {
      x: (this.cam.ox + fxToFloat(fxX) * this.cam.cell) / this.dpr,
      y: (this.cam.oy + fxToFloat(fxY) * this.cam.cell) / this.dpr,
    };
  }
  cellAt(fxX: number, fxY: number): { x: number; y: number } {
    return { x: Math.floor(fxX / FX_ONE), y: Math.floor(fxY / FX_ONE) };
  }

  /** World (fixed-point) -> canvas device pixels, matching the FX layer. */
  toCanvasX(fxVal: number): number {
    return this.cam.ox + fxToFloat(fxVal) * this.cam.cell;
  }

  toCanvasY(fxVal: number): number {
    return this.cam.oy + fxToFloat(fxVal) * this.cam.cell;
  }

  /** Pixels per world cell, in canvas device pixels. */
  get cellPx(): number {
    return this.cam.cell;
  }

  // ------------------------------------------------------------------ draw

  draw(state: GameState, alpha: number, view: ViewOptions, dt: number): void {
    this.time += dt;
    this.fx.update(dt);

    const ctx = this.ctx;
    const { width, height } = this.canvas;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0f18';
    ctx.fillRect(0, 0, width, height);

    this.ensureTerrain();

    let shakeX = 0;
    let shakeY = 0;
    if (this.fx.shake > 0) {
      const s = this.fx.shake * this.dpr;
      shakeX = (Math.sin(this.time * 0.09) + Math.sin(this.time * 0.17)) * s * 0.5;
      shakeY = (Math.cos(this.time * 0.11) + Math.sin(this.time * 0.23)) * s * 0.5;
    }
    ctx.translate(shakeX, shakeY);

    if (this.terrain) ctx.drawImage(this.terrain, 0, 0);

    this.drawBuildSites(state);
    this.drawBuildOverlay(state, view);
    this.drawGrounds(state);
    this.drawWorldItems(state);
    this.drawCore(state);
    this.drawTowers(state, view);
    this.drawEnemies(state, alpha);
    this.drawSoldiers(state, alpha);
    this.drawHeroes(state, alpha, view);
    this.drawProjectiles(state, alpha);
    this.fx.draw(ctx);
    this.drawAimReticle(view);
    this.fx.drawText(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawVignette();
    if (state.phase === Phase.Defeat) this.drawDefeatWash();
  }

  private px(fxVal: number): number {
    return this.cam.ox + fxToFloat(fxVal) * this.cam.cell;
  }

  private py(fxVal: number): number {
    return this.cam.oy + fxToFloat(fxVal) * this.cam.cell;
  }

  private lerpPx(prev: number, cur: number, alpha: number): number {
    return this.cam.ox + (fxToFloat(prev) + (fxToFloat(cur) - fxToFloat(prev)) * alpha) * this.cam.cell;
  }

  private lerpPy(prev: number, cur: number, alpha: number): number {
    return this.cam.oy + (fxToFloat(prev) + (fxToFloat(cur) - fxToFloat(prev)) * alpha) * this.cam.cell;
  }

  // ------------------------------------------------------------- terrain

  private ensureTerrain(): void {
    const key = `${this.rt.def.id}|${this.canvas.width}x${this.canvas.height}|${this.cam.cell}|${this.cam.ox},${this.cam.oy}`;
    if (this.terrain && this.terrainKey === key) return;

    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d');
    if (!g) return;

    const def = this.rt.def;
    const cell = this.cam.cell;
    const rng = makeLocalRng(0x51ed + def.id * 977);

    g.fillStyle = '#0b0f18';
    g.fillRect(0, 0, c.width, c.height);

    // Ground bed
    for (let y = 0; y < def.h; y++) {
      for (let x = 0; x < def.w; x++) {
        const sx = this.cam.ox + x * cell;
        const sy = this.cam.oy + y * cell;
        const r = rng();
        const tile = r > 0.88 ? def.groundAlt : def.ground;
        atlas.drawTile(g, tile, sx, sy, cell + 1, cell + 1);
      }
    }

    // Road
    const isRoad = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < def.w && y < def.h && this.rt.pathCells[y * def.w + x];

    for (let y = 0; y < def.h; y++) {
      for (let x = 0; x < def.w; x++) {
        if (!isRoad(x, y)) continue;
        const sx = this.cam.ox + x * cell;
        const sy = this.cam.oy + y * cell;
        atlas.drawTile(g, def.road, sx, sy, cell + 1, cell + 1);
      }
    }

    // Outline the lane so the route reads instantly on a small screen.
    g.strokeStyle = def.roadEdge;
    g.lineWidth = Math.max(2, this.dpr * 2);
    g.beginPath();
    for (let y = 0; y < def.h; y++) {
      for (let x = 0; x < def.w; x++) {
        if (!isRoad(x, y)) continue;
        const sx = this.cam.ox + x * cell;
        const sy = this.cam.oy + y * cell;
        if (!isRoad(x, y - 1)) { g.moveTo(sx, sy); g.lineTo(sx + cell, sy); }
        if (!isRoad(x, y + 1)) { g.moveTo(sx, sy + cell); g.lineTo(sx + cell, sy + cell); }
        if (!isRoad(x - 1, y)) { g.moveTo(sx, sy); g.lineTo(sx, sy + cell); }
        if (!isRoad(x + 1, y)) { g.moveTo(sx + cell, sy); g.lineTo(sx + cell, sy + cell); }
      }
    }
    g.stroke();

    // Scenery on blocked cells, plus scattered decoration on spare ground.
    for (const [bx, by] of def.blocked) {
      const sx = this.cam.ox + (bx + 0.5) * cell;
      const sy = this.cam.oy + (by + 0.5) * cell;
      const prop = def.propTiles[Math.floor(rng() * def.propTiles.length)];
      atlas.draw(g, prop, sx, sy, cell * 1.05, rng() * Math.PI * 2);
    }
    for (let i = 0; i < def.w * def.h * 0.05; i++) {
      const x = Math.floor(rng() * def.w);
      const y = Math.floor(rng() * def.h);
      if (!isBuildable(this.rt, x, y)) continue;
      const prop = def.propTiles[Math.floor(rng() * def.propTiles.length)];
      g.save();
      g.globalAlpha = 0.32;
      atlas.draw(g, prop, this.cam.ox + (x + 0.5) * cell, this.cam.oy + (y + 0.5) * cell,
        cell * 0.6, rng() * Math.PI * 2);
      g.restore();
    }

    // Subtle grid so buildable cells read clearly on a small screen.
    g.strokeStyle = 'rgba(255,255,255,0.045)';
    g.lineWidth = Math.max(1, this.dpr * 0.5);
    g.beginPath();
    for (let x = 0; x <= def.w; x++) {
      g.moveTo(this.cam.ox + x * cell, this.cam.oy);
      g.lineTo(this.cam.ox + x * cell, this.cam.oy + def.h * cell);
    }
    for (let y = 0; y <= def.h; y++) {
      g.moveTo(this.cam.ox, this.cam.oy + y * cell);
      g.lineTo(this.cam.ox + def.w * cell, this.cam.oy + y * cell);
    }
    g.stroke();

    // Frame the play area.
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = Math.max(2, this.dpr * 2);
    g.strokeRect(this.cam.ox, this.cam.oy, def.w * cell, def.h * cell);

    this.terrain = c;
    this.terrainKey = key;
  }

  // ------------------------------------------------------------- overlays

  private drawBuildOverlay(state: GameState, view: ViewOptions): void {
    if (view.placingDefId < 0) return;
    const ctx = this.ctx;
    const def = this.rt.def;
    const cell = this.cam.cell;
    const occupied = new Set(state.towers.map((t) => t.cy * def.w + t.cx));

    ctx.save();
    ctx.globalAlpha = 0.18 + Math.sin(this.time * 0.005) * 0.05;
    ctx.fillStyle = '#8effc0';
    for (let y = 0; y < def.h; y++) {
      for (let x = 0; x < def.w; x++) {
        if (!isBuildSite(this.rt, x, y) || occupied.has(y * def.w + x)) continue;
        ctx.fillRect(this.cam.ox + x * cell + 1, this.cam.oy + y * cell + 1, cell - 2, cell - 2);
      }
    }
    ctx.restore();

    const c = view.placeCell;
    if (!c) return;
    const valid = isBuildSite(this.rt, c.x, c.y) && !occupied.has(c.y * def.w + c.x);
    const cx = this.cam.ox + (c.x + 0.5) * cell;
    const cy = this.cam.oy + (c.y + 0.5) * cell;
    const stats = computeTowerStats(view.placingDefId, 0, 1);

    ctx.save();
    ctx.fillStyle = valid ? 'rgba(140,255,190,0.85)' : 'rgba(255,90,90,0.8)';
    ctx.fillRect(this.cam.ox + c.x * cell, this.cam.oy + c.y * cell, cell, cell);
    ctx.restore();

    if (valid) {
      this.drawRange(cx, cy, fxToFloat(stats.range) * cell, towerDef(view.placingDefId).accent);
      ctx.save();
      ctx.globalAlpha = 0.85;
      drawTowerSprite(ctx, view.placingDefId, cx, cy, cell, {
        rot: 0,
        team: PLAYER_COLORS[view.localPlayer % PLAYER_COLORS.length],
        time: this.time,
        fire: 0,
        level: 1,
        power: 0,
      });
      ctx.restore();
    }
  }

  private drawRange(cx: number, cy: number, radius: number, color: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = Math.max(1.5, this.dpr * 1.5);
    ctx.setLineDash([this.cam.cell * 0.25, this.cam.cell * 0.18]);
    ctx.stroke();
    ctx.restore();
  }

  private drawAimReticle(view: ViewOptions): void {
    if (!view.aiming) return;
    const ctx = this.ctx;
    const x = this.px(view.aiming.x);
    const y = this.py(view.aiming.y);
    const r = fxToFloat(view.aiming.radius) * this.cam.cell;
    const pulse = 0.75 + Math.sin(this.time * 0.008) * 0.25;
    ctx.save();
    ctx.strokeStyle = '#ffd447';
    ctx.lineWidth = Math.max(2, this.dpr * 2);
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,212,71,0.14)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.35, y);
    ctx.lineTo(x + r * 0.35, y);
    ctx.moveTo(x, y - r * 0.35);
    ctx.lineTo(x, y + r * 0.35);
    ctx.stroke();
    ctx.restore();
  }

  // --------------------------------------------------------------- world

  private drawCore(state: GameState): void {
    const ctx = this.ctx;
    const cell = this.cam.cell;
    const x = this.px(this.rt.coreX);
    const y = this.py(this.rt.coreY);
    const health = state.maxLives > 0 ? state.lives / state.maxLives : 0;
    const pulse = 1 + Math.sin(this.time * 0.004) * 0.05;

    ctx.save();
    const grad = ctx.createRadialGradient(x, y, cell * 0.2, x, y, cell * 2.2);
    const tint = health > 0.5 ? '90,220,255' : health > 0.25 ? '255,200,80' : '255,90,90';
    grad.addColorStop(0, `rgba(${tint},0.35)`);
    grad.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, cell * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    atlas.draw(ctx, CRYSTAL.octagon, x, y, cell * 1.5 * pulse, this.time * 0.0004);
    atlas.draw(ctx, CRYSTAL.diamond, x, y, cell * 0.8 * pulse, -this.time * 0.0008, 0.8);

    // Life ring
    ctx.save();
    ctx.lineWidth = Math.max(3, this.dpr * 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(x, y, cell * 1.0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = health > 0.5 ? '#5fd36b' : health > 0.25 ? '#ffd447' : '#ff5d4a';
    ctx.beginPath();
    ctx.arc(x, y, cell * 1.0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * health);
    ctx.stroke();
    ctx.restore();
  }

  private drawGrounds(state: GameState): void {
    const ctx = this.ctx;
    for (const g of state.grounds) {
      const x = this.px(g.x);
      const y = this.py(g.y);
      const r = fxToFloat(g.radius) * this.cam.cell;
      const t = g.life / Math.max(1, g.maxLife);
      let color = '255,140,60';
      if (g.kind === GroundKind.PoisonCloud) color = '150,240,90';
      else if (g.kind === GroundKind.FrostField) color = '120,230,255';
      else if (g.kind === GroundKind.ArrowStorm) color = '220,220,255';

      ctx.save();
      ctx.globalAlpha = 0.32 * Math.min(1, t * 2.2);
      const grad = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
      grad.addColorStop(0, `rgba(${color},0.9)`);
      grad.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (g.kind === GroundKind.Napalm) {
        const n = 5;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + this.time * 0.001;
          const rr = r * 0.55;
          atlas.draw(ctx, FXART.flameMed,
            x + Math.cos(a) * rr, y + Math.sin(a) * rr,
            this.cam.cell * 0.5, 0, 0.55 * t);
        }
      }
    }
  }

  private drawBuildSites(state: GameState): void {
    const occupied = new Set(state.towers.filter((t) => t.temp === 0).map((t) => `${t.cx},${t.cy}`));
    const ctx = this.ctx;
    const cell = this.cam.cell;
    ctx.save();
    for (const [cx, cy] of this.rt.def.buildSites) {
      if (occupied.has(`${cx},${cy}`)) continue;
      const x = this.cam.ox + (cx + 0.5) * cell;
      const y = this.cam.oy + (cy + 0.5) * cell;
      ctx.fillStyle = 'rgba(55,38,22,.72)';
      ctx.beginPath(); ctx.ellipse(x, y + cell * .2, cell * .38, cell * .18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ead9a5'; ctx.lineWidth = Math.max(2, cell * .055);
      ctx.beginPath(); ctx.moveTo(x - cell * .12, y + cell * .18); ctx.lineTo(x - cell * .12, y - cell * .45); ctx.stroke();
      ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.moveTo(x - cell * .1, y - cell * .42); ctx.lineTo(x + cell * .32, y - cell * .28); ctx.lineTo(x - cell * .1, y - cell * .12); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#5c351d'; ctx.lineWidth = Math.max(1, cell * .025); ctx.stroke();
    }
    ctx.restore();
  }

  private drawWorldItems(state: GameState): void {
    const ctx = this.ctx;
    const cell = this.cam.cell;
    for (const it of state.worldItems) {
      const x = this.px(it.x), y = this.py(it.y);
      const bob = Math.sin((this.time + it.id * 91) * 0.005) * cell * 0.08;
      const pulse = 0.8 + Math.sin((this.time + it.id * 47) * 0.008) * 0.15;
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.shadowColor = '#ffd86b'; ctx.shadowBlur = cell * 0.35;
      ctx.fillStyle = 'rgba(25,20,38,0.9)'; ctx.strokeStyle = '#ffd86b'; ctx.lineWidth = Math.max(2, cell * 0.045);
      ctx.beginPath(); ctx.arc(0, 0, cell * 0.34 * pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.font = `${Math.round(cell * 0.42)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(itemDef(it.itemId).icon, 0, 1);
      ctx.restore();
    }
  }

  private drawTowers(state: GameState, view: ViewOptions): void {
    const ctx = this.ctx;
    const cell = this.cam.cell;

    for (const t of state.towers) {
      const x = this.px(t.x);
      const y = this.py(t.y);
      const d = towerDef(t.defId);
      const selected = t.id === view.selectedTowerId;

      if (selected) {
        const stats = computeTowerStats(t.defId, t.power, t.level);
        this.drawRange(x, y, fxToFloat(stats.range) * cell, d.accent);
        if (stats.barracks) this.drawRallyPost(t.rx, t.ry, x, y, d.accent);
      }

      // Ownership ring
      ctx.save();
      ctx.globalAlpha = t.temp > 0 ? 0.45 : 0.9;
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.47, 0, Math.PI * 2);
      ctx.fillStyle = PLAYER_GLOW[t.owner % PLAYER_GLOW.length];
      ctx.fill();
      ctx.restore();

      const rot = Math.atan2(fxToFloat(t.dy), fxToFloat(t.dx)) + Math.PI / 2;
      ctx.save();
      if (t.temp > 0) ctx.globalAlpha = 0.7;
      drawTowerSprite(ctx, t.defId, x, y, cell, {
        rot,
        team: PLAYER_COLORS[t.owner % PLAYER_COLORS.length],
        time: this.time,
        fire: t.fireAnim > 0 ? Math.min(1, t.fireAnim / 6) : 0,
        level: t.level,
        power: t.power,
      });
      ctx.restore();

      // Level pips
      this.drawLevelPips(x, y + cell * 0.42, t.level, d.accent);

      if (t.pulse > 0) {
        const stats = computeTowerStats(t.defId, t.power, t.level);
        const rr = fxToFloat(stats.splash) * cell * (1 - t.pulse / 10);
        ctx.save();
        ctx.globalAlpha = t.pulse / 10 * 0.6;
        ctx.strokeStyle = d.accent;
        ctx.lineWidth = Math.max(2, this.dpr * 2);
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (selected) {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, this.dpr * 2);
        ctx.globalAlpha = 0.8 + Math.sin(this.time * 0.008) * 0.2;
        ctx.strokeRect(x - cell * 0.5, y - cell * 0.5, cell, cell);
        ctx.restore();
      }
    }
  }

  private drawLevelPips(x: number, y: number, level: number, color: string): void {    const ctx = this.ctx;
    const r = Math.max(1.5, this.cam.cell * 0.045);
    const gap = r * 2.8;
    const total = (level - 1) * gap;
    ctx.save();
    for (let i = 0; i < level; i++) {
      ctx.beginPath();
      ctx.arc(x - total / 2 + i * gap, y, r, 0, Math.PI * 2);
      ctx.fillStyle = i >= 3 ? '#ffd447' : color;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Flag on the road showing where a barracks squad is holding the line. */
  private drawRallyPost(rx: number, ry: number, tx: number, ty: number, color: string): void {
    const ctx = this.ctx;
    const cell = this.cam.cell;
    const x = this.px(rx);
    const y = this.py(ry);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1.5, this.dpr * 1.5);
    ctx.setLineDash([cell * 0.15, cell * 0.12]);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, this.dpr * 2);
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.42 + Math.sin(this.time * 0.006) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - cell * 0.55);
    ctx.lineTo(x + cell * 0.34, y - cell * 0.4);
    ctx.lineTo(x, y - cell * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(1, this.dpr);
    ctx.beginPath();
    ctx.moveTo(x, y - cell * 0.6);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
  }

  private drawSoldiers(state: GameState, alpha: number): void {
    if (state.soldiers.length === 0) return;
    const ctx = this.ctx;
    const cell = this.cam.cell;

    for (const sd of state.soldiers) {
      const t = state.towers.find((x) => x.id === sd.towerId);
      if (!t) continue;
      const stats = computeTowerStats(t.defId, t.power, t.level);
      const x = this.lerpPx(sd.px, sd.x, alpha);
      const y = this.lerpPy(sd.py, sd.y, alpha);
      const size = cell * fxToFloat(stats.unitScale);
      const rot = Math.atan2(fxToFloat(sd.dy), fxToFloat(sd.dx)) + Math.PI / 2;
      const color = PLAYER_COLORS[sd.owner % PLAYER_COLORS.length];

      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, y + size * 0.14, size * 0.3, size * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      atlas.drawTinted(ctx, stats.unitArt, x, y, size, rot, color, sd.spawnT > 0 ? 0.5 : 1);

      if (sd.hp < sd.maxHp) {
        const w = size * 0.7;
        const h = Math.max(2, cell * 0.055);
        const top = y - size * 0.58;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, h + 2);
        ctx.fillStyle = color;
        ctx.fillRect(x - w / 2, top, w * Math.max(0, sd.hp / Math.max(1, sd.maxHp)), h);
        ctx.restore();
      }
    }
  }

  private drawEnemies(state: GameState, alpha: number): void {
    const ctx = this.ctx;
    const cell = this.cam.cell;

    for (const e of state.enemies) {
      const x = this.lerpPx(e.px, e.x, alpha);
      const y = this.lerpPy(e.py, e.y, alpha);
      const d = enemyDef(e.defId);
      const size = cell * fxToFloat(e.scale) * 0.92;
      const rot = Math.atan2(fxToFloat(e.dy), fxToFloat(e.dx)) + Math.PI / 2;

      // Shadow (and altitude offset for flyers).
      const lift = e.flying ? cell * 0.35 : 0;
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, y + size * 0.12, size * 0.32, size * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      let color = ENEMY_TINTS[e.tint % ENEMY_TINTS.length];
      if (e.stunT > 0) color = '#9fd8ff';
      else if (e.slowT > 0) color = '#7fc4ff';

      const bob = e.flying ? Math.sin((this.time + e.id * 137) * 0.006) * cell * 0.06 : 0;
      const spawnFade = e.spawnT > 0 ? 0.45 : 1;

      if (e.boss) {
        ctx.save();
        ctx.globalAlpha = 0.5 + Math.sin(this.time * 0.005) * 0.2;
        const grad = ctx.createRadialGradient(x, y - lift, size * 0.2, x, y - lift, size * 0.95);
        grad.addColorStop(0, 'rgba(255,80,60,0.5)');
        grad.addColorStop(1, 'rgba(255,80,60,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y - lift, size * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      atlas.drawTinted(ctx, d.art, x, y - lift + bob, size, rot, color, spawnFade);

      if (e.burnT > 0) {
        atlas.draw(ctx, FXART.flameSmall, x, y - lift - size * 0.35 + bob,
          size * 0.5, 0, 0.55 + Math.sin(this.time * 0.02 + e.id) * 0.2);
      }
      if (e.poisonT > 0) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#9ff05a';
        ctx.beginPath();
        ctx.arc(x, y - lift + bob, size * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (e.stunT > 0) {
        atlas.draw(ctx, FXART.sparkle, x, y - lift - size * 0.5 + bob,
          size * 0.42, this.time * 0.006, 0.9);
      }

      this.drawEnemyBars(e, x, y - lift + bob, size);
    }
  }

  private drawEnemyBars(e: Enemy, x: number, y: number, size: number): void {
    const damaged = e.hp < e.maxHp || e.shield < e.maxShield;
    if (!damaged && !e.boss) return;
    const ctx = this.ctx;
    const w = e.boss ? size * 1.05 : size * 0.8;
    const h = Math.max(2.5, this.cam.cell * (e.boss ? 0.1 : 0.07));
    const top = y - size * 0.62;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, h + 2);
    const hpFrac = Math.max(0, e.hp / Math.max(1, e.maxHp));
    ctx.fillStyle = e.boss ? '#ff5d4a' : '#66e06f';
    ctx.fillRect(x - w / 2, top, w * hpFrac, h);
    if (e.maxShield > 0) {
      const sFrac = Math.max(0, e.shield / e.maxShield);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - w / 2 - 1, top - h - 2, w + 2, h * 0.7 + 2);
      ctx.fillStyle = '#66d9ff';
      ctx.fillRect(x - w / 2, top - h - 1, w * sFrac, h * 0.7);
    }
    ctx.restore();
  }

  private drawHeroes(state: GameState, alpha: number, view: ViewOptions): void {
    const ctx = this.ctx;
    const cell = this.cam.cell;

    for (const p of state.players) {
      const h = p.hero;
      const d = heroDef(h.defId);
      const color = PLAYER_COLORS[p.idx % PLAYER_COLORS.length];

      if (!h.alive) {
        const x = this.px(h.x);
        const y = this.py(h.y);
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, this.dpr * 2);
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = `700 ${Math.round(cell * 0.42)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.ceil(h.respawn / 30)}`, x, y + cell * 0.15);
        ctx.restore();
        continue;
      }

      const x = this.lerpPx(h.px, h.x, alpha);
      const y = this.lerpPy(h.py, h.y, alpha);
      const size = cell * 0.95;
      const rot = Math.atan2(fxToFloat(h.dy), fxToFloat(h.dx)) + Math.PI / 2;
      // Attacks decay over ~0.3s so the swing/draw animation has time to read.
      const sinceAttack = Math.max(0, d.attackCd - h.attackCd);
      const swing = h.attackCd > 0 ? Math.max(0, 1 - sinceAttack / 9) : 0;

      // Move order marker
      if (h.moving && p.idx === view.localPlayer) {
        const mx = this.px(h.mx);
        const my = this.py(h.my);
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, this.dpr * 1.5);
        ctx.beginPath();
        ctx.arc(mx, my, cell * 0.25 + Math.sin(this.time * 0.01) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Aura footprint
      ctx.save();
      ctx.globalAlpha = 0.24;
      const grad = ctx.createRadialGradient(x, y, cell * 0.1, x, y, cell * 0.9);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      drawHeroSprite(ctx, h.defId, x, y, size, {
        rot,
        team: color,
        time: this.time,
        walk: h.moving ? 1 : 0,
        swing,
        cast: h.abilityT > 0 ? 1 : 0,
      });

      // Health + level
      const w = size * 0.48;
      const bh = Math.max(3, cell * 0.08);
      const top = y - size * 0.42;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, bh + 2);
      ctx.fillStyle = color;
      ctx.fillRect(x - w / 2, top, w * Math.max(0, h.hp / h.maxHp), bh);
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(cell * 0.3)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(`L${h.level}`, x, top - bh * 1.4);
      ctx.fillText(`L${h.level}`, x, top - bh * 1.4);
      ctx.restore();
    }
  }

  private drawProjectiles(state: GameState, alpha: number): void {
    const ctx = this.ctx;
    const cell = this.cam.cell;

    for (const p of state.projectiles) {
      const x = this.lerpPx(p.px, p.x, alpha);
      const y = this.lerpPy(p.py, p.y, alpha);
      const rot = Math.atan2(fxToFloat(p.vy), fxToFloat(p.vx)) + Math.PI / 2;

      switch (p.kind) {
        case ProjKind.Shell:
        case ProjKind.Rocket:
          atlas.draw(ctx, FXART.rocketSmall, x, y, cell * 0.5, rot);
          break;
        case ProjKind.Meteor: {
          atlas.draw(ctx, FXART.flameBig, x, y, cell * 1.5, rot, 0.95);
          atlas.draw(ctx, FXART.rocketLarge, x, y, cell * 0.9, rot);
          // Impact marker on the ground so both players can read the landing spot.
          const tx = this.px(p.tx);
          const ty = this.py(p.ty);
          ctx.save();
          ctx.strokeStyle = 'rgba(255,120,60,0.8)';
          ctx.lineWidth = Math.max(2, this.dpr * 2);
          ctx.beginPath();
          ctx.arc(tx, ty, fxToFloat(p.splash) * cell, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          break;
        }
        case ProjKind.Glob:
          this.dot(x, y, cell * 0.16, '#9ff05a');
          break;
        case ProjKind.Ember:
          atlas.draw(ctx, FXART.flameSmall, x, y, cell * 0.45, rot, 0.9);
          break;
        case ProjKind.Slug:
          atlas.draw(ctx, FXART.bulletPale, x, y, cell * 0.34, rot);
          break;
        case ProjKind.HeroShot:
          atlas.draw(ctx, FXART.bulletWhite, x, y, cell * 0.3, rot);
          break;
        case ProjKind.Spark:
          this.dot(x, y, cell * 0.13, '#c39cff');
          break;
        case ProjKind.Bolt:
        default:
          atlas.draw(ctx, FXART.bulletBronze, x, y, cell * 0.3, rot);
          break;
      }
    }
  }

  private dot(x: number, y: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawVignette(): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const grad = ctx.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.35,
      width / 2, height / 2, Math.max(width, height) * 0.75,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  private drawDefeatWash(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(90,0,10,0.35)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  damageColor(type: number): string {
    return DMG_COLORS[type] ?? '#fff';
  }

  get runtime(): MapRuntime {
    return this.rt;
  }
}
