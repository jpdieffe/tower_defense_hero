/**
 * Hand-drawn tower sprites.
 *
 * The tilesheet only ships ten sci-fi turret heads, which is nowhere near
 * enough for twenty-five fantasy towers across five classes. Towers are drawn
 * procedurally instead: a class-themed platform (holy stone, orc palisade,
 * dark-elf obsidian, elven marble, arcane rune ring) plus a per-tower head.
 *
 * Everything is drawn in unit space - the sprite occupies roughly [-0.5, 0.5]
 * and faces "up" (-Y) - so the renderer can keep using the same aim rotation it
 * uses for every other unit. Only the head rotates; the platform stays put.
 */

import { TOWER, TowerClass, towerDef, trackSplit } from '../content/towers';

export interface TowerArtState {
  /** Aim direction in radians, using the same convention as the atlas sprites. */
  rot: number;
  /** Owning player's colour, for the platform trim. */
  team: string;
  /** Free-running clock in ms, for idle motion. */
  time: number;
  /** 1 the instant the tower fires, decaying to 0. */
  fire: number;
  /** Tower level, 1-5. */
  level: number;
  /** Upgrades spent on the Power track. */
  power: number;
}

const OUTLINE = 'rgba(18,13,24,0.9)';
const LW = 0.03;

function rounded(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, w: number, h: number, r: number,
): void {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
}

function poly(ctx: CanvasRenderingContext2D, pts: readonly number[][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Fill the current path, then trace the shared dark outline over it. */
function ink(ctx: CanvasRenderingContext2D, fill: string, lw = LW): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function stroke(ctx: CanvasRenderingContext2D, color: string, lw: number): void {
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ------------------------------------------------------------- platforms

interface Palette {
  slab: string;
  slabDark: string;
  trim: string;
}

const PALETTES: Record<number, Palette> = {
  [TowerClass.Paladin]: { slab: '#e8e2d2', slabDark: '#b6ac96', trim: '#ffd873' },
  [TowerClass.Orc]: { slab: '#8a6440', slabDark: '#5f4429', trim: '#9fd25a' },
  [TowerClass.DarkElf]: { slab: '#3b3350', slabDark: '#241f34', trim: '#b57cff' },
  [TowerClass.HighElf]: { slab: '#dfeaf5', slabDark: '#a9bccf', trim: '#7fd0ff' },
  [TowerClass.Magician]: { slab: '#4a3a6b', slabDark: '#312549', trim: '#ff9ae0' },
};

/** An n-sided platform slab with a raised inner tier. */
function slab(ctx: CanvasRenderingContext2D, p: Palette, sides: number, turn: number): void {
  const pts: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const a = turn + (i * Math.PI * 2) / sides;
    pts.push([Math.cos(a) * 0.47, Math.sin(a) * 0.47]);
  }
  poly(ctx, pts);
  ink(ctx, p.slabDark, 0.035);
  const inner: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const a = turn + (i * Math.PI * 2) / sides;
    inner.push([Math.cos(a) * 0.36, Math.sin(a) * 0.36]);
  }
  poly(ctx, inner);
  ink(ctx, p.slab, 0.024);
}

function drawBase(ctx: CanvasRenderingContext2D, cls: number, team: string): void {
  const p = PALETTES[cls] ?? PALETTES[TowerClass.Paladin];

  switch (cls) {
    case TowerClass.Orc: {
      // Rough timber palisade: a ring of stakes around a dirt platform.
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI * 2) / 8 + 0.4;
        ctx.save();
        ctx.translate(Math.cos(a) * 0.4, Math.sin(a) * 0.4);
        ctx.rotate(a + Math.PI / 2);
        poly(ctx, [[-0.06, 0.09], [0.06, 0.09], [0.045, -0.09], [0, -0.13], [-0.045, -0.09]]);
        ink(ctx, p.slabDark, 0.022);
        ctx.restore();
      }
      circle(ctx, 0, 0, 0.4);
      ink(ctx, p.slab, 0.03);
      circle(ctx, 0, 0, 0.31);
      ink(ctx, '#9a7249', 0.02);
      break;
    }
    case TowerClass.DarkElf: {
      slab(ctx, p, 6, Math.PI / 6);
      // Faint rune arcs.
      ctx.beginPath();
      ctx.arc(0, 0, 0.27, 0.5, 2.2);
      ctx.arc(0, 0, 0.27, 3.6, 5.3);
      stroke(ctx, p.trim, 0.028);
      break;
    }
    case TowerClass.HighElf: {
      circle(ctx, 0, 0, 0.47);
      ink(ctx, p.slabDark, 0.035);
      circle(ctx, 0, 0, 0.38);
      ink(ctx, p.slab, 0.024);
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 2 + Math.PI / 4);
        ctx.beginPath();
        ctx.arc(0, 0, 0.3, -0.5, 0.5);
        stroke(ctx, p.trim, 0.03);
        ctx.restore();
      }
      break;
    }
    case TowerClass.Magician: {
      slab(ctx, p, 8, Math.PI / 8);
      circle(ctx, 0, 0, 0.28);
      stroke(ctx, p.trim, 0.024);
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
        circle(ctx, Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0.035);
        ink(ctx, p.trim, 0.018);
      }
      break;
    }
    default: {
      // Paladin: pale stone with a gold band.
      slab(ctx, p, 8, Math.PI / 8);
      circle(ctx, 0, 0, 0.29);
      stroke(ctx, p.trim, 0.03);
      break;
    }
  }

  // Owner tag: a small coloured wedge at the back of the platform.
  circle(ctx, 0, 0.36, 0.075);
  ink(ctx, team, 0.024);
}

/** Upgrade tiers add a taller foundation, battlements, and track-specific hardware. */
function drawUpgradeStage(
  ctx: CanvasRenderingContext2D, level: number, power: number, accent: string,
): void {
  if (level <= 1) return;
  const speed = Math.max(0, level - 1 - power);
  circle(ctx, 0, 0, 0.32 + Math.min(3, level - 1) * 0.018);
  ctx.lineWidth = 0.025 + level * 0.004;
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55 + level * 0.07;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Every level adds another visible buttress around the platform.
  const count = 2 + level;
  for (let i = 0; i < count; i++) {
    const a = (i * Math.PI * 2) / count;
    ctx.save();
    ctx.translate(Math.cos(a) * 0.37, Math.sin(a) * 0.37);
    ctx.rotate(a);
    rounded(ctx, 0, 0, 0.09 + power * 0.008, 0.15, 0.025);
    ink(ctx, power > speed ? '#66566f' : '#8fa9b8', 0.018);
    ctx.restore();
  }

  // Fully upgraded towers receive an unmistakable glowing crown.
  if (level >= 5) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = i % 2 ? 0.39 : 0.45;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    stroke(ctx, accent, 0.035);
  }

  // Each paid level adds a new, large silhouette landmark.
  if (level >= 2) {
    for (const sx of [-1, 1]) {
      ctx.save(); ctx.translate(sx * .34, .08); ctx.rotate(sx * -.16);
      rounded(ctx, 0, -.08, .055, .42, .018); ink(ctx, '#5a412b', .018);
      poly(ctx, [[0,-.28],[sx*.19,-.22],[0,-.12]]); ink(ctx, accent, .018); ctx.restore();
    }
  }
  if (level >= 3) {
    for (const sx of [-1, 1]) {
      poly(ctx, [[sx*.23,.18],[sx*.34,-.02],[sx*.25,-.22],[sx*.16,-.02]]);
      ink(ctx, speed > power ? '#9feaff' : '#ffb36b', .022);
    }
  }
  if (level >= 4) {
    if (power > speed) {
      for (const sx of [-1, 1]) {
        poly(ctx, [[sx*.3,.23],[sx*.48,.1],[sx*.44,-.19],[sx*.27,-.11]]);
        ink(ctx, '#8d4d3c', .028);
      }
    } else {
      ctx.save(); ctx.rotate(level >= 5 ? Math.PI / 8 : 0);
      for (let i=0;i<4;i++) { ctx.rotate(Math.PI/2); poly(ctx, [[.28,-.05],[.48,-.12],[.43,.08],[.28,.06]]); ink(ctx,'#78b9c9',.02); }
      ctx.restore();
    }
  }
}

function drawUpgradeHeadgear(ctx: CanvasRenderingContext2D, s: TowerArtState, accent: string): void {
  const t = trackSplit(s.power, s.level);
  // Power upgrades add increasingly massive side blades and cannon housings.
  for (let i = 0; i < t.power; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    ctx.save(); ctx.translate(side * (.2 + row * .07), .1 - row * .1); ctx.rotate(side * .18);
    rounded(ctx, 0, 0, .13 + row * .03, .34, .035); ink(ctx, i >= 2 ? '#7f4050' : '#6f5960', .022);
    poly(ctx, [[0,-.26],[.07,-.14],[-.07,-.14]]); ink(ctx, '#ffd18a', .018);
    ctx.restore();
  }
  // Speed upgrades add bright fins and orbiting accelerator nodes.
  for (let i = 0; i < t.speed; i++) {
    const a = (i / Math.max(1, t.speed)) * Math.PI * 2 + s.time / 850;
    const r = .27 + Math.floor(i / 2) * .035;
    circle(ctx, Math.cos(a) * r, Math.sin(a) * r, .055);
    ctx.globalAlpha = .72 + Math.sin(s.time / 140 + i) * .18; ink(ctx, accent, .016); ctx.globalAlpha = 1;
  }
  if (s.level >= 5) {
    circle(ctx, 0, 0, .43); ctx.globalAlpha=.5; stroke(ctx, accent, .035); ctx.globalAlpha=1;
  }
}

// ----------------------------------------------------------------- heads

type Head = (ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState) => void;

/** Recoil: heads shove backwards along their barrel as they fire. */
const kick = (s: TowerArtState): number => s.fire * 0.06;

function bow(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const draw = 1 - s.fire;
  rounded(ctx, 0, 0.06, 0.16, 0.3, 0.05);
  ink(ctx, '#6b5030');
  ctx.beginPath();
  ctx.moveTo(-0.3, -0.02);
  ctx.quadraticCurveTo(0, -0.24, 0.3, -0.02);
  stroke(ctx, OUTLINE, 0.075);
  stroke(ctx, accent, 0.05);
  ctx.beginPath();
  ctx.moveTo(-0.29, -0.03);
  ctx.quadraticCurveTo(0, 0.06 - draw * 0.02, 0.29, -0.03);
  stroke(ctx, '#f2f6ff', 0.016);
  ctx.beginPath();
  ctx.moveTo(0, 0.04);
  ctx.lineTo(0, -0.34 - s.fire * 0.12);
  stroke(ctx, '#e8d7a8', 0.028);
  poly(ctx, [[0, -0.44 - s.fire * 0.12], [-0.05, -0.34 - s.fire * 0.12], [0.05, -0.34 - s.fire * 0.12]]);
  ink(ctx, '#dfe8f5', 0.018);
}

function cannon(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const k = kick(s);
  rounded(ctx, 0, 0.1 + k, 0.34, 0.24, 0.08);
  ink(ctx, '#5d5a68');
  rounded(ctx, 0, -0.16 + k, 0.19, 0.42, 0.06);
  ink(ctx, '#7b7788');
  rounded(ctx, 0, -0.36 + k, 0.25, 0.1, 0.04);
  ink(ctx, accent, 0.024);
  circle(ctx, 0, 0.1 + k, 0.07);
  ink(ctx, accent, 0.02);
}

function bombard(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const k = kick(s);
  rounded(ctx, 0, 0.12 + k, 0.32, 0.22, 0.07);
  ink(ctx, '#6a5334');
  for (const x of [-0.1, 0.1]) {
    rounded(ctx, x, -0.14 + k, 0.13, 0.36, 0.05);
    ink(ctx, '#8b7145');
    rounded(ctx, x, -0.3 + k, 0.17, 0.07, 0.03);
    ink(ctx, accent, 0.02);
  }
}

function ballista(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const k = kick(s);
  rounded(ctx, 0, 0.08 + k, 0.14, 0.34, 0.04);
  ink(ctx, '#6b5030');
  for (const sx of [-1, 1]) {
    poly(ctx, [
      [sx * 0.06, -0.06 + k], [sx * 0.34, -0.16 + k],
      [sx * 0.36, -0.08 + k], [sx * 0.07, 0.02 + k],
    ]);
    ink(ctx, '#8a6b41', 0.022);
  }
  ctx.beginPath();
  ctx.moveTo(-0.34, -0.14 + k);
  ctx.lineTo(0, 0.02 + k + s.fire * 0.06);
  ctx.lineTo(0.34, -0.14 + k);
  stroke(ctx, '#f2f6ff', 0.016);
  rounded(ctx, 0, -0.2 - s.fire * 0.1, 0.05, 0.4, 0.02);
  ink(ctx, accent, 0.02);
}

function trebuchet(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const swing = s.fire;
  rounded(ctx, 0, 0.12, 0.3, 0.16, 0.05);
  ink(ctx, '#6b5030');
  for (const sx of [-1, 1]) {
    poly(ctx, [[sx * 0.14, 0.14], [sx * 0.04, -0.06], [sx * 0.1, -0.08], [sx * 0.2, 0.14]]);
    ink(ctx, '#8a6b41', 0.02);
  }
  ctx.save();
  ctx.translate(0, -0.05);
  ctx.rotate(-0.5 + swing * 1.5);
  rounded(ctx, 0, -0.14, 0.06, 0.5, 0.02);
  ink(ctx, '#a58553', 0.022);
  circle(ctx, 0, 0.16, 0.09);
  ink(ctx, '#5d5a68', 0.022);
  circle(ctx, 0, -0.36, 0.07);
  ink(ctx, accent, 0.02);
  ctx.restore();
}

function catapult(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const swing = s.fire;
  rounded(ctx, 0, 0.16, 0.42, 0.2, 0.06);
  ink(ctx, '#6b5030');
  for (const sx of [-1, 1]) {
    circle(ctx, sx * 0.19, 0.16, 0.09);
    ink(ctx, '#3f2f1d', 0.022);
  }
  ctx.save();
  ctx.translate(0, 0.1);
  ctx.rotate(0.55 - swing * 1.3);
  rounded(ctx, 0, -0.16, 0.07, 0.42, 0.03);
  ink(ctx, '#a58553', 0.024);
  // Sling bowl full of rocks.
  ctx.beginPath();
  ctx.moveTo(-0.15, -0.34);
  ctx.quadraticCurveTo(0, -0.22, 0.15, -0.34);
  ctx.lineTo(0.13, -0.44);
  ctx.lineTo(-0.13, -0.44);
  ctx.closePath();
  ink(ctx, '#7b7788', 0.024);
  circle(ctx, 0, -0.4, 0.075);
  ink(ctx, accent, 0.02);
  ctx.restore();
}

function hut(ctx: CanvasRenderingContext2D, accent: string, _s: TowerArtState): void {
  rounded(ctx, 0, 0.06, 0.5, 0.4, 0.06);
  ink(ctx, '#8a6b41');
  poly(ctx, [[-0.3, -0.1], [0, -0.42], [0.3, -0.1]]);
  ink(ctx, accent, 0.03);
  rounded(ctx, 0, 0.16, 0.14, 0.2, 0.03);
  ink(ctx, '#3b2d1c', 0.02);
}

function banner(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const wave = Math.sin(s.time / 260) * 0.03;
  rounded(ctx, 0, 0.16, 0.24, 0.16, 0.05);
  ink(ctx, '#7b7788');
  rounded(ctx, 0, -0.06, 0.05, 0.6, 0.02);
  ink(ctx, '#6b5030', 0.022);
  ctx.beginPath();
  ctx.moveTo(0.02, -0.34);
  ctx.lineTo(0.3, -0.28 + wave);
  ctx.lineTo(0.24, -0.16 + wave);
  ctx.lineTo(0.3, -0.04 + wave);
  ctx.lineTo(0.02, -0.1);
  ctx.closePath();
  ink(ctx, accent, 0.024);
  circle(ctx, 0, -0.38, 0.05);
  ink(ctx, '#ffe9a8', 0.02);
}

function totem(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const bob = Math.sin(s.time / 300) * 0.012;
  rounded(ctx, 0, 0.2, 0.26, 0.14, 0.05);
  ink(ctx, '#5f4429');
  rounded(ctx, 0, 0.02, 0.09, 0.5, 0.03);
  ink(ctx, '#8a6b41', 0.022);
  // Skull.
  circle(ctx, 0, -0.24 + bob, 0.14);
  ink(ctx, '#efe6d2', 0.026);
  for (const sx of [-1, 1]) {
    circle(ctx, sx * 0.055, -0.26 + bob, 0.035);
    ink(ctx, accent, 0.016);
  }
  rounded(ctx, 0, -0.15 + bob, 0.08, 0.06, 0.02);
  ink(ctx, '#c9bda3', 0.016);
  for (const sx of [-1, 1]) {
    poly(ctx, [[sx * 0.13, -0.34 + bob], [sx * 0.26, -0.44 + bob], [sx * 0.15, -0.24 + bob]]);
    ink(ctx, '#c9bda3', 0.018);
  }
}

function flask(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const bubble = Math.sin(s.time / 220) * 0.015;
  rounded(ctx, 0, 0.18, 0.3, 0.16, 0.05);
  ink(ctx, '#4a4356');
  circle(ctx, 0, -0.04, 0.26);
  ink(ctx, '#5b5368');
  circle(ctx, 0, -0.06 + bubble, 0.18);
  ink(ctx, accent, 0.022);
  circle(ctx, -0.06, -0.1 + bubble, 0.045);
  ink(ctx, '#ffffff', 0.014);
  rounded(ctx, 0, -0.3, 0.12, 0.14, 0.04);
  ink(ctx, '#4a4356', 0.022);
}

function nest(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const pulse = 1 + Math.sin(s.time / 200) * 0.05;
  circle(ctx, 0, 0.02, 0.3);
  ink(ctx, '#3b3350');
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8 + s.time / 3000;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 0.1, 0.02 + Math.sin(a) * 0.1);
    ctx.lineTo(Math.cos(a) * 0.32, 0.02 + Math.sin(a) * 0.32);
    stroke(ctx, '#584b74', 0.022);
  }
  circle(ctx, 0, 0.02, 0.14 * pulse);
  ink(ctx, accent, 0.024);
  for (const sx of [-1, 1]) {
    poly(ctx, [[sx * 0.05, -0.14], [sx * 0.11, -0.34 - s.fire * 0.08], [sx * 0.02, -0.16]]);
    ink(ctx, '#d8ff9a', 0.016);
  }
}

function web(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  rounded(ctx, 0, 0.2, 0.28, 0.14, 0.05);
  ink(ctx, '#2f2942');
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8;
    ctx.beginPath();
    ctx.moveTo(0, -0.02);
    ctx.lineTo(Math.cos(a) * 0.36, -0.02 + Math.sin(a) * 0.36);
    stroke(ctx, accent, 0.014);
  }
  for (const r of [0.14, 0.26, 0.36]) {
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const a = (i * Math.PI * 2) / 8;
      const x = Math.cos(a) * r;
      const y = -0.02 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    stroke(ctx, accent, 0.012);
  }
  circle(ctx, 0, -0.02, 0.09 + s.fire * 0.02);
  ink(ctx, '#1d1830', 0.022);
  for (const sx of [-1, 1]) {
    circle(ctx, sx * 0.035, -0.05, 0.022);
    ink(ctx, '#ff5c8a', 0.012);
  }
}

function obelisk(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const glow = 0.5 + Math.sin(s.time / 240) * 0.2 + s.fire * 0.3;
  rounded(ctx, 0, 0.24, 0.34, 0.14, 0.05);
  ink(ctx, '#241f34');
  poly(ctx, [[-0.16, 0.2], [-0.11, -0.3], [0, -0.44], [0.11, -0.3], [0.16, 0.2]]);
  ink(ctx, '#463c63', 0.03);
  poly(ctx, [[-0.05, 0.16], [-0.04, -0.26], [0, -0.36], [0.04, -0.26], [0.05, 0.16]]);
  ctx.globalAlpha = Math.min(1, 0.55 + glow);
  ink(ctx, accent, 0.018);
  ctx.globalAlpha = 1;
}

function lance(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const k = kick(s);
  rounded(ctx, 0, 0.18 + k, 0.32, 0.18, 0.05);
  ink(ctx, '#c9c0a8');
  poly(ctx, [[-0.11, 0.14 + k], [-0.07, -0.28 + k], [0, -0.46 + k], [0.07, -0.28 + k], [0.11, 0.14 + k]]);
  ink(ctx, '#f2ecda', 0.028);
  // Cross-guard.
  rounded(ctx, 0, -0.14 + k, 0.3, 0.07, 0.03);
  ink(ctx, accent, 0.022);
  circle(ctx, 0, -0.14 + k, 0.055);
  ink(ctx, '#fff6d6', 0.018);
}

function sentry(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const k = kick(s);
  // Swivel yoke.
  rounded(ctx, 0, 0.16, 0.34, 0.16, 0.05);
  ink(ctx, '#c9c0a8');
  circle(ctx, 0, 0.16, 0.07);
  ink(ctx, accent, 0.02);
  // Twin bolt tubes.
  for (const sx of [-1, 1]) {
    rounded(ctx, sx * 0.11, -0.12 + k, 0.11, 0.5, 0.04);
    ink(ctx, '#e8eef8', 0.026);
    rounded(ctx, sx * 0.11, -0.32 + k, 0.13, 0.08, 0.03);
    ink(ctx, accent, 0.02);
    poly(ctx, [
      [sx * 0.11, -0.5 - s.fire * 0.06 + k],
      [sx * 0.11 - 0.05, -0.4 + k],
      [sx * 0.11 + 0.05, -0.4 + k],
    ]);
    ink(ctx, '#9fd8ff', 0.018);
  }
  rounded(ctx, 0, -0.02 + k, 0.34, 0.08, 0.03);
  ink(ctx, '#b6ac96', 0.022);
}

function bell(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const swing = Math.sin(s.time / 210) * 0.12 * (0.3 + s.fire);
  rounded(ctx, 0, 0.22, 0.36, 0.12, 0.04);
  ink(ctx, '#c9c0a8');
  for (const sx of [-1, 1]) {
    rounded(ctx, sx * 0.19, 0.02, 0.06, 0.42, 0.02);
    ink(ctx, '#b6ac96', 0.022);
  }
  ctx.save();
  ctx.translate(0, -0.2);
  ctx.rotate(swing);
  ctx.beginPath();
  ctx.moveTo(-0.17, 0.2);
  ctx.quadraticCurveTo(-0.18, -0.1, 0, -0.16);
  ctx.quadraticCurveTo(0.18, -0.1, 0.17, 0.2);
  ctx.closePath();
  ink(ctx, accent, 0.028);
  rounded(ctx, 0, 0.2, 0.36, 0.06, 0.02);
  ink(ctx, '#fff3cf', 0.02);
  ctx.restore();
}

function crystal(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const glow = 0.5 + Math.sin(s.time / 260) * 0.25 + s.fire * 0.4;
  rounded(ctx, 0, 0.24, 0.32, 0.14, 0.05);
  ink(ctx, '#5a6b7d');
  for (const [sx, h] of [[-1, 0.24], [1, 0.28]] as const) {
    poly(ctx, [[sx * 0.1, 0.16], [sx * 0.22, 0.0], [sx * 0.16, -h], [sx * 0.06, 0.05]]);
    ink(ctx, accent, 0.022);
  }
  poly(ctx, [[-0.11, 0.18], [-0.13, -0.1], [0, -0.44], [0.13, -0.1], [0.11, 0.18]]);
  ctx.globalAlpha = Math.min(1, 0.6 + glow * 0.4);
  ink(ctx, accent, 0.028);
  ctx.globalAlpha = 1;
  poly(ctx, [[-0.04, 0.1], [-0.05, -0.08], [0, -0.32], [0.02, -0.08], [0.01, 0.1]]);
  ink(ctx, '#ffffff', 0.014);
}

function orb(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const spin = s.time / 700;
  const pulse = 1 + Math.sin(s.time / 200) * 0.06 + s.fire * 0.12;
  rounded(ctx, 0, 0.26, 0.3, 0.12, 0.04);
  ink(ctx, '#312549');
  for (const sx of [-1, 1]) {
    poly(ctx, [[sx * 0.13, 0.22], [sx * 0.2, -0.06], [sx * 0.11, -0.06], [sx * 0.06, 0.22]]);
    ink(ctx, '#4a3a6b', 0.022);
  }
  ctx.save();
  ctx.translate(0, -0.12);
  ctx.rotate(spin);
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.28, 0.09, 0, 0, Math.PI * 2);
  stroke(ctx, accent, 0.022);
  ctx.restore();
  circle(ctx, 0, -0.12, 0.16 * pulse);
  ink(ctx, accent, 0.026);
  circle(ctx, -0.05, -0.17, 0.05);
  ink(ctx, '#ffffff', 0.014);
}

function rune(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const spin = s.time / 1400;
  const glow = 0.4 + Math.sin(s.time / 230) * 0.2 + s.fire * 0.4;
  circle(ctx, 0, 0, 0.34);
  ink(ctx, '#312549');
  ctx.save();
  ctx.rotate(spin);
  circle(ctx, 0, 0, 0.26);
  ctx.globalAlpha = Math.min(1, 0.5 + glow);
  stroke(ctx, accent, 0.03);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 0.13, Math.sin(a) * 0.13);
    ctx.lineTo(Math.cos(a) * 0.26, Math.sin(a) * 0.26);
    stroke(ctx, accent, 0.024);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  poly(ctx, [[0, -0.16], [0.13, 0], [0, 0.16], [-0.13, 0]]);
  ink(ctx, accent, 0.022);
}

function maw(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const spin = -s.time / 900;
  const open = 0.14 + s.fire * 0.06;
  rounded(ctx, 0, 0.28, 0.3, 0.12, 0.04);
  ink(ctx, '#241a3d');
  ctx.save();
  ctx.rotate(spin);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, 0.32 - i * 0.05, i * 1.6, i * 1.6 + 3.6);
    ctx.globalAlpha = 0.85 - i * 0.2;
    stroke(ctx, accent, 0.03);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  circle(ctx, 0, 0, open);
  ink(ctx, '#0b0716', 0.028);
  circle(ctx, 0, 0, open * 0.45);
  ink(ctx, accent, 0.014);
}

function brazier(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const flick = Math.sin(s.time / 120) * 0.03 + s.fire * 0.06;
  rounded(ctx, 0, 0.26, 0.3, 0.12, 0.04);
  ink(ctx, '#4a4356');
  poly(ctx, [[-0.06, 0.24], [-0.1, -0.02], [0.1, -0.02], [0.06, 0.24]]);
  ink(ctx, '#5d5a68', 0.022);
  ctx.beginPath();
  ctx.moveTo(-0.26, -0.04);
  ctx.quadraticCurveTo(0, 0.14, 0.26, -0.04);
  ctx.lineTo(0.2, -0.12);
  ctx.lineTo(-0.2, -0.12);
  ctx.closePath();
  ink(ctx, '#6b6478', 0.026);
  ctx.beginPath();
  ctx.moveTo(-0.15, -0.12);
  ctx.quadraticCurveTo(-0.1, -0.3 - flick, 0, -0.44 - flick * 2);
  ctx.quadraticCurveTo(0.1, -0.3 - flick, 0.15, -0.12);
  ctx.closePath();
  ink(ctx, accent, 0.02);
  ctx.beginPath();
  ctx.moveTo(-0.07, -0.12);
  ctx.quadraticCurveTo(-0.04, -0.24 - flick, 0, -0.32 - flick);
  ctx.quadraticCurveTo(0.04, -0.24 - flick, 0.07, -0.12);
  ctx.closePath();
  ink(ctx, '#ffe9a8', 0.012);
}

function well(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const ripple = (s.time / 1200) % 1;
  circle(ctx, 0, 0, 0.36);
  ink(ctx, '#c3d6e6');
  circle(ctx, 0, 0, 0.29);
  ink(ctx, accent, 0.022);
  ctx.globalAlpha = 1 - ripple;
  circle(ctx, 0, 0, 0.06 + ripple * 0.22);
  stroke(ctx, '#ffffff', 0.02);
  ctx.globalAlpha = 1;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    poly(ctx, [
      [Math.cos(a) * 0.3, Math.sin(a) * 0.3],
      [Math.cos(a + 0.3) * 0.42, Math.sin(a + 0.3) * 0.42],
      [Math.cos(a - 0.3) * 0.42, Math.sin(a - 0.3) * 0.42],
    ]);
    ink(ctx, '#eaf4ff', 0.02);
  }
}

function star(ctx: CanvasRenderingContext2D, accent: string, s: TowerArtState): void {
  const spin = s.time / 1100;
  const pulse = 1 + Math.sin(s.time / 210) * 0.08 + s.fire * 0.15;
  rounded(ctx, 0, 0.26, 0.3, 0.12, 0.04);
  ink(ctx, '#8fa6c4');
  for (const sx of [-1, 1]) {
    poly(ctx, [[sx * 0.12, 0.22], [sx * 0.22, -0.1], [sx * 0.12, -0.1], [sx * 0.05, 0.22]]);
    ink(ctx, '#c3d6e6', 0.022);
  }
  ctx.save();
  ctx.translate(0, -0.16);
  ctx.rotate(spin);
  ctx.scale(pulse, pulse);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const r = i % 2 === 0 ? 0.2 : 0.08;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ink(ctx, accent, 0.022);
  circle(ctx, 0, 0, 0.06);
  ink(ctx, '#ffffff', 0.014);
  ctx.restore();
}

const HEADS: Record<number, Head> = {
  [TOWER.Guard]: bow,
  [TOWER.Cannon]: cannon,
  [TOWER.Frost]: crystal,
  [TOWER.Arcane]: orb,
  [TOWER.Plague]: flask,
  [TOWER.Hunter]: ballista,
  [TOWER.Brazier]: brazier,
  [TOWER.Altar]: banner,
  [TOWER.Barracks]: hut,
  [TOWER.Kennel]: hut,
  [TOWER.Sanctum]: bell,
  [TOWER.Trebuchet]: trebuchet,
  [TOWER.Templar]: lance,
  [TOWER.Slinger]: catapult,
  [TOWER.Totem]: totem,
  [TOWER.Bombard]: bombard,
  [TOWER.VenomNest]: nest,
  [TOWER.Nightweb]: web,
  [TOWER.Siphon]: obelisk,
  [TOWER.Moonwell]: well,
  [TOWER.Sentinel]: sentry,
  [TOWER.Starfall]: star,
  [TOWER.Prism]: crystal,
  [TOWER.Rune]: rune,
  [TOWER.VoidMaw]: maw,
};

/** Heads that represent a static building rather than an aimed weapon. */
const FIXED = new Set<number>([
  TOWER.Barracks, TOWER.Kennel, TOWER.Altar, TOWER.Totem, TOWER.Moonwell,
  TOWER.Rune, TOWER.VoidMaw, TOWER.Nightweb, TOWER.Sanctum, TOWER.Brazier,
]);

/**
 * Paint a whole tower: class platform, then the head aimed at its target.
 * `size` is the width of one grid cell.
 */
export function drawTowerSprite(
  ctx: CanvasRenderingContext2D,
  defId: number,
  x: number,
  y: number,
  size: number,
  s: TowerArtState,
): void {
  const d = towerDef(defId);
  const head = HEADS[defId] ?? bow;
  const t = trackSplit(s.power, s.level);
  // Power builds bulk, Speed stays lean.
  const grow = 1 + t.power * 0.035 + t.speed * 0.012;

  ctx.save();
  ctx.translate(x, y);
  ctx.save();
  ctx.scale(size, size);
  ctx.lineJoin = 'round';
  drawBase(ctx, d.cls, s.team);
  drawUpgradeStage(ctx, s.level, s.power, d.accent);
  ctx.restore();

  ctx.save();
  if (!FIXED.has(defId)) ctx.rotate(s.rot);
  ctx.scale(size * grow, size * grow);
  ctx.lineJoin = 'round';
  ctx.translate(0, -0.03);
  drawUpgradeHeadgear(ctx, s, d.accent);
  head(ctx, d.accent, s);
  ctx.restore();
  ctx.restore();
}
