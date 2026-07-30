/**
 * Hand-drawn hero sprites.
 *
 * Kenney's tower-defense pack only ships four toy soldiers with rifles, which
 * looks wrong for a fantasy roster (the Paladin was literally holding a gun).
 * Heroes are the four biggest things on the board, so they get bespoke vector
 * art instead: distinct silhouettes, real weapons, and a little life —
 * a sword swing, a drawn bowstring, a pulsing staff orb, a spinning gear.
 *
 * Everything is drawn as a camera-facing three-quarter miniature. The feet sit
 * on the map plane while the torso, face and weapons rise toward the camera;
 * movement direction only mirrors/leans the figure instead of spinning a flat
 * top-down cutout around the ground.
 */

import { HERO } from '../content/heroes';

export interface HeroArtState {
  /** Facing, in radians (same convention as the atlas sprites). */
  rot: number;
  /** Player colour, used for the ground ring so allies stay readable. */
  team: string;
  /** Free-running clock in ms, for idle motion. */
  time: number;
  /** 1 while walking, 0 while standing. */
  walk: number;
  /** 1 the instant an attack lands, decaying to 0. */
  swing: number;
  /** 1 while an ability is active. */
  cast: number;
  /** Camera-relative pose selected from movement direction. */
  view?: 'front' | 'back' | 'side';
}

const OUTLINE = 'rgba(22,16,30,0.85)';
const LW = 0.035;

const LEG_COLORS: Record<number, readonly [string, string]> = {
  [HERO.Paladin]: ['#8d9ab2', '#59677e'],
  [HERO.Orc]: ['#4e8130', '#49351f'],
  [HERO.DarkElf]: ['#493665', '#241c35'],
  [HERO.HighElf]: ['#b9cee5', '#6d91b5'],
  [HERO.Magician]: ['#55318f', '#2c1b4e'],
};

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

/** Fill the current path, then trace the shared dark outline over it. */
function ink(ctx: CanvasRenderingContext2D, fill: string, lw = LW): void {
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
}

function cloak(ctx: CanvasRenderingContext2D, color: string, shade: string, spread: number): void {
  ctx.beginPath();
  ctx.moveTo(-0.22, -0.06);
  ctx.quadraticCurveTo(-spread, 0.18, -spread * 0.62, 0.46);
  ctx.quadraticCurveTo(0, 0.56, spread * 0.62, 0.46);
  ctx.quadraticCurveTo(spread, 0.18, 0.22, -0.06);
  ctx.closePath();
  ink(ctx, color);
  ctx.beginPath();
  ctx.moveTo(0, -0.04);
  ctx.lineTo(0, 0.48);
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = shade;
  ctx.stroke();
}

function arm(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number, color: string, w = 0.11,
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineCap = 'round';
  ctx.lineWidth = w + LW * 1.4;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Foreshortened legs shared by every class, drawn behind its robe/armour. */
function drawIsoLegs(ctx: CanvasRenderingContext2D, defId: number, s: HeroArtState): void {
  const colors = LEG_COLORS[defId] ?? LEG_COLORS[HERO.Paladin];
  const stride = Math.sin(s.time * 0.014) * 0.055 * s.walk;
  for (const side of [-1, 1]) {
    const near = side === 1;
    const step = stride * side;
    // Rear leg first, then the nearer leg for a readable three-quarter stance.
    ctx.save();
    ctx.translate(side * 0.105, 0.25 + step);
    ctx.rotate(side * 0.07);
    rounded(ctx, 0, 0.12, 0.13, 0.34, 0.06);
    ink(ctx, colors[0], 0.028);
    rounded(ctx, side * 0.018, 0.29, 0.17, 0.13, 0.055);
    ink(ctx, colors[1], 0.026);
    if (near) {
      ctx.globalAlpha = 0.22;
      rounded(ctx, -0.025, 0.06, 0.035, 0.22, 0.015);
      ctx.fillStyle = '#fff'; ctx.fill();
    }
    ctx.restore();
  }
}

// --- Paladin --------------------------------------------------------------

function drawPaladin(ctx: CanvasRenderingContext2D, s: HeroArtState): void {
  const steel = '#c6d2e4';
  const darkSteel = '#8d9ab2';
  const tabard = '#2f5fb8';
  const gold = '#f2c14e';

  cloak(ctx, tabard, 'rgba(12,26,60,0.55)', 0.36);

  // Shield arm (left).
  const guard = 0.06 * s.swing;
  ctx.save();
  ctx.translate(-0.26, 0.04);
  ctx.rotate(-0.2 - guard);
  arm(ctx, 0.06, 0.02, 0, -0.08, darkSteel, 0.1);
  ctx.beginPath();
  ctx.moveTo(-0.15, -0.22);
  ctx.lineTo(0.15, -0.22);
  ctx.quadraticCurveTo(0.19, 0.02, 0, 0.2);
  ctx.quadraticCurveTo(-0.19, 0.02, -0.15, -0.22);
  ctx.closePath();
  ink(ctx, gold);
  ctx.beginPath();
  ctx.moveTo(-0.1, -0.18);
  ctx.lineTo(0.1, -0.18);
  ctx.quadraticCurveTo(0.13, 0.01, 0, 0.13);
  ctx.quadraticCurveTo(-0.13, 0.01, -0.1, -0.18);
  ctx.closePath();
  ink(ctx, tabard, 0.02);
  ctx.fillStyle = '#f4f7ff';
  ctx.fillRect(-0.03, -0.16, 0.06, 0.22);
  ctx.fillRect(-0.085, -0.11, 0.17, 0.06);
  ctx.restore();

  // Sword arm (right): chops forward on attack.
  ctx.save();
  ctx.translate(0.24 - s.swing * 0.03, 0.04 - s.swing * 0.07);
  ctx.rotate(0.6 - s.swing * 0.78);
  arm(ctx, -0.06, 0.02, 0.02, -0.1, darkSteel, 0.1);
  // Blade
  ctx.beginPath();
  ctx.moveTo(-0.045, -0.2);
  ctx.lineTo(0.045, -0.2);
  ctx.lineTo(0.035, -0.62);
  ctx.lineTo(0, -0.72);
  ctx.lineTo(-0.035, -0.62);
  ctx.closePath();
  ink(ctx, '#eaf1fb', 0.028);
  ctx.beginPath();
  ctx.moveTo(0, -0.22);
  ctx.lineTo(0, -0.66);
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = 'rgba(120,150,190,0.7)';
  ctx.stroke();
  // Crossguard + grip + pommel
  rounded(ctx, 0, -0.19, 0.26, 0.06, 0.03);
  ink(ctx, gold, 0.022);
  rounded(ctx, 0, -0.11, 0.07, 0.12, 0.03);
  ink(ctx, '#6d4326', 0.022);
  circle(ctx, 0, -0.04, 0.045);
  ink(ctx, gold, 0.022);
  ctx.restore();

  // Torso + pauldrons.
  rounded(ctx, 0, -0.02, 0.44, 0.42, 0.16);
  ink(ctx, steel);
  ctx.save();
  rounded(ctx, 0, -0.02, 0.44, 0.42, 0.16);
  ctx.clip();
  ctx.fillStyle = tabard;
  ctx.fillRect(-0.08, -0.26, 0.16, 0.52);
  ctx.fillStyle = gold;
  ctx.fillRect(-0.11, 0.08, 0.22, 0.035);
  ctx.restore();
  circle(ctx, -0.235, 0.02, 0.115);
  ink(ctx, darkSteel);
  circle(ctx, 0.235, 0.02, 0.115);
  ink(ctx, darkSteel);

  // Helm.
  circle(ctx, 0, -0.17, 0.155);
  ink(ctx, steel);
  if (s.view === 'back') {
    ctx.beginPath(); ctx.moveTo(-0.12, -0.19); ctx.lineTo(0.12, -0.19);
    ctx.lineWidth = 0.025; ctx.strokeStyle = darkSteel; ctx.stroke();
  } else {
    rounded(ctx, s.view === 'side' ? 0.045 : 0, -0.25, s.view === 'side' ? 0.11 : 0.2, 0.06, 0.03);
    ink(ctx, '#2b3346', 0.02);
  }
  // Crest.
  ctx.beginPath();
  ctx.moveTo(0, -0.33);
  ctx.quadraticCurveTo(0.06, -0.18, 0.02, 0.0);
  ctx.quadraticCurveTo(-0.02, -0.18, 0, -0.33);
  ctx.closePath();
  ink(ctx, '#d9433f', 0.022);
}

// --- High Elf -------------------------------------------------------------

function drawHighElf(ctx: CanvasRenderingContext2D, s: HeroArtState): void {
  const leaf = '#dbe7f6';
  const dark = '#9fc4e8';
  const leather = '#e0c477';
  const wood = '#f0e3b8';

  cloak(ctx, '#7fb2dd', 'rgba(30,70,110,0.5)', 0.32);

  // Quiver on the back.
  ctx.save();
  ctx.translate(0.2, 0.14);
  ctx.rotate(0.5);
  rounded(ctx, 0, 0, 0.12, 0.3, 0.05);
  ink(ctx, leather, 0.025);
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 0.035, -0.14);
    ctx.lineTo(i * 0.035, -0.24);
    ctx.lineWidth = 0.022;
    ctx.strokeStyle = i === 0 ? '#f0e6d2' : '#d9433f';
    ctx.stroke();
  }
  ctx.restore();

  // Torso.
  rounded(ctx, 0, 0, 0.34, 0.38, 0.14);
  ink(ctx, leaf);
  rounded(ctx, 0, 0.06, 0.36, 0.07, 0.03);
  ink(ctx, leather, 0.02);

  // Arms reach for the bow.
  const pull = s.swing;
  arm(ctx, -0.16, -0.06, -0.1, -0.28, leaf, 0.09);
  arm(ctx, 0.16, -0.06, 0.05 + pull * 0.02, -0.14 + pull * 0.06, leaf, 0.09);

  // Bow: a C-shaped limb ahead of the archer.
  ctx.save();
  ctx.translate(0, -0.12);
  ctx.beginPath();
  ctx.arc(0, 0, 0.34, Math.PI * 1.16, Math.PI * 1.84);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.075;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = wood;
  ctx.stroke();
  const a0 = Math.PI * 1.16;
  const a1 = Math.PI * 1.84;
  const x0 = Math.cos(a0) * 0.34;
  const y0 = Math.sin(a0) * 0.34;
  const x1 = Math.cos(a1) * 0.34;
  const y1 = Math.sin(a1) * 0.34;
  const draw = 0.06 + pull * 0.16;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(0, -0.3 + draw * 2, x1, y1);
  ctx.lineWidth = 0.018;
  ctx.strokeStyle = '#f2ead6';
  ctx.stroke();
  // Nocked arrow, only while the string is drawn.
  if (pull > 0.05) {
    ctx.globalAlpha = Math.min(1, pull * 2);
    ctx.beginPath();
    ctx.moveTo(0, -0.3 + draw);
    ctx.lineTo(0, -0.56);
    ctx.lineWidth = 0.022;
    ctx.strokeStyle = '#c9a06a';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -0.62);
    ctx.lineTo(-0.04, -0.53);
    ctx.lineTo(0.04, -0.53);
    ctx.closePath();
    ink(ctx, '#dfe7f2', 0.015);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // Hood.
  ctx.beginPath();
  ctx.moveTo(0, 0.1);
  ctx.quadraticCurveTo(-0.17, -0.02, -0.14, -0.16);
  ctx.quadraticCurveTo(0, -0.32, 0.14, -0.16);
  ctx.quadraticCurveTo(0.17, -0.02, 0, 0.1);
  ctx.closePath();
  ink(ctx, dark);
  circle(ctx, s.view === 'side' ? 0.025 : 0, -0.15, 0.085);
  ink(ctx, s.view === 'back' ? '#e7edf6' : '#f2dcc0', 0.02);
  if (s.view !== 'back') {
    ctx.fillStyle = '#2f6fa8'; ctx.beginPath();
    if (s.view === 'side') ctx.arc(0.058, -0.18, 0.019, 0, Math.PI * 2);
    else { ctx.arc(-0.035, -0.18, 0.018, 0, Math.PI * 2); ctx.arc(0.035, -0.18, 0.018, 0, Math.PI * 2); }
    ctx.fill();
  }
  // Circlet.
  ctx.beginPath();
  ctx.moveTo(-0.075, -0.23);
  ctx.lineTo(0.075, -0.23);
  ctx.lineWidth = 0.022;
  ctx.strokeStyle = leather;
  ctx.stroke();
}

// --- Magician -------------------------------------------------------------

function drawMagician(ctx: CanvasRenderingContext2D, s: HeroArtState): void {
  const robe = '#7a4ec9';
  const deep = '#4a2c86';
  const gold = '#f2c14e';
  const pulse = 0.5 + Math.sin(s.time * 0.005) * 0.5;

  cloak(ctx, deep, 'rgba(20,8,40,0.6)', 0.38);

  // Staff, raised while casting.
  ctx.save();
  ctx.translate(0.26, 0.08);
  ctx.rotate(0.22 - s.cast * 0.5 - s.swing * 0.18);
  ctx.beginPath();
  ctx.moveTo(0, 0.06);
  ctx.lineTo(0, -0.5);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.075;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.lineWidth = 0.048;
  ctx.strokeStyle = '#6b4a2f';
  ctx.stroke();
  // Claw setting + orb.
  ctx.beginPath();
  ctx.moveTo(-0.06, -0.46);
  ctx.lineTo(0, -0.56);
  ctx.lineTo(0.06, -0.46);
  ctx.closePath();
  ink(ctx, gold, 0.02);
  const glow = ctx.createRadialGradient(0, -0.58, 0.01, 0, -0.58, 0.2);
  glow.addColorStop(0, `rgba(255,180,90,${0.55 + pulse * 0.35 + s.cast * 0.2})`);
  glow.addColorStop(1, 'rgba(255,140,60,0)');
  ctx.fillStyle = glow;
  circle(ctx, 0, -0.58, 0.2);
  ctx.fill();
  circle(ctx, 0, -0.58, 0.075 + pulse * 0.008);
  ink(ctx, '#ffb347', 0.022);
  circle(ctx, -0.02, -0.6, 0.028);
  ctx.fillStyle = 'rgba(255,244,214,0.9)';
  ctx.fill();
  ctx.restore();

  // Robe body.
  circle(ctx, 0, 0, 0.23);
  ink(ctx, robe);
  ctx.beginPath();
  ctx.arc(0, 0, 0.16, Math.PI * 0.15, Math.PI * 0.85);
  ctx.lineWidth = 0.028;
  ctx.strokeStyle = gold;
  ctx.stroke();
  arm(ctx, 0.18, -0.05, 0.26, 0.02, robe, 0.09);
  arm(ctx, -0.18, -0.05, -0.24, -0.14, robe, 0.09);

  // Wizard hat: brim, crown, trailing point.
  ctx.beginPath();
  ctx.moveTo(-0.06, 0.04);
  ctx.quadraticCurveTo(-0.02, 0.24, 0.08, 0.3);
  ctx.quadraticCurveTo(0.02, 0.12, 0.06, 0.03);
  ctx.closePath();
  ink(ctx, deep, 0.022);
  circle(ctx, 0, -0.08, 0.2);
  ink(ctx, robe);
  circle(ctx, 0, -0.08, 0.125);
  ink(ctx, deep, 0.022);
  if (s.view === 'back') {
    ctx.beginPath(); ctx.arc(0, -0.06, 0.08, Math.PI * 0.15, Math.PI * 0.85);
    ctx.lineWidth = 0.025; ctx.strokeStyle = 'rgba(210,175,255,.5)'; ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, -0.28);
  ctx.lineTo(0.03, -0.22);
  ctx.lineTo(-0.03, -0.22);
  ctx.closePath();
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,232,170,0.95)';
  circle(ctx, 0.055, -0.13, 0.022);
  ctx.fill();
}

// --- Orc ------------------------------------------------------------------

function drawOrc(ctx: CanvasRenderingContext2D, s: HeroArtState): void {
  const skin = '#75b84a', shadow = '#477a31', leather = '#754827', iron = '#aeb8c4';
  const swing = s.swing;

  // Oversized axe sits behind the body and creates the class silhouette.
  ctx.save(); ctx.translate(-.2, .04); ctx.rotate(-.5 + swing * 1.35);
  rounded(ctx, 0, -.18, .075, .86, .025); ink(ctx, leather, .028);
  ctx.beginPath(); ctx.moveTo(-.05,-.53); ctx.lineTo(.3,-.59); ctx.lineTo(.43,-.45);
  ctx.lineTo(.29,-.27); ctx.lineTo(-.04,-.34); ctx.closePath(); ink(ctx, iron, .036);
  ctx.beginPath(); ctx.moveTo(.03,-.48); ctx.lineTo(.31,-.51); ctx.lineTo(.35,-.44);
  ctx.lineTo(.27,-.36); ctx.lineTo(.03,-.4); ctx.closePath(); ink(ctx, '#e8eef5', .015);
  ctx.restore();

  // Hunched, barrel-shaped body. The forward shoulder is much larger.
  ctx.beginPath(); ctx.moveTo(-.28,.24); ctx.quadraticCurveTo(-.35,-.12,-.12,-.28);
  ctx.quadraticCurveTo(.2,-.34,.34,-.05); ctx.lineTo(.25,.27); ctx.closePath(); ink(ctx, skin);
  ctx.strokeStyle=leather; ctx.lineWidth=.075; ctx.beginPath(); ctx.moveTo(-.18,-.25); ctx.lineTo(.18,.25); ctx.stroke();
  circle(ctx,.25,-.03,.145); ink(ctx, shadow);
  // One huge forward fist, readable even at phone scale.
  arm(ctx,.2,.0,.39,.18,skin,.14); circle(ctx,.42,.2,.105); ink(ctx,skin,.028);
  for(let i=0;i<3;i++){ rounded(ctx,.38+i*.04,.235,.035,.09,.016); ink(ctx,shadow,.012); }

  // True side-profile head: skull at the rear, muzzle projecting right.
  ctx.beginPath(); ctx.moveTo(-.12,-.2); ctx.quadraticCurveTo(-.1,-.48,.16,-.48);
  ctx.quadraticCurveTo(.31,-.43,.29,-.24); ctx.lineTo(.13,-.12); ctx.closePath(); ink(ctx,skin,.032);
  // Long jaw and blunt nose point in the facing direction.
  ctx.beginPath(); ctx.moveTo(.08,-.29); ctx.quadraticCurveTo(.29,-.34,.43,-.23);
  ctx.lineTo(.4,-.1); ctx.quadraticCurveTo(.22,-.06,.06,-.14); ctx.closePath(); ink(ctx,shadow,.028);
  circle(ctx,.39,-.23,.032); ink(ctx,'#26301f',.01);
  // Single side eye under a heavy angled brow.
  ctx.strokeStyle='#315624'; ctx.lineWidth=.065; ctx.beginPath(); ctx.moveTo(.06,-.39); ctx.lineTo(.25,-.34); ctx.stroke();
  circle(ctx,.18,-.34,.035); ink(ctx,'#ffd94a',.012); circle(ctx,.19,-.34,.014); ctx.fillStyle='#18120d'; ctx.fill();
  // Forward tusk and pointed ear reinforce direction.
  ctx.beginPath(); ctx.moveTo(.27,-.12); ctx.quadraticCurveTo(.39,-.04,.42,-.25);
  ctx.quadraticCurveTo(.34,-.13,.23,-.16); ctx.closePath(); ink(ctx,'#fff0c9',.018);
  ctx.beginPath(); ctx.moveTo(-.08,-.39); ctx.lineTo(-.3,-.34); ctx.lineTo(-.11,-.23); ctx.closePath(); ink(ctx,shadow,.022);
  // Chunky topknot trailing backward.
  ctx.strokeStyle='#342316'; ctx.lineWidth=.075; ctx.beginPath(); ctx.moveTo(-.03,-.46); ctx.quadraticCurveTo(-.19,-.63,-.34,-.48); ctx.stroke();
  circle(ctx,-.35,-.47,.065); ink(ctx,'#2f2118',.018);

  // Bright shoulder plate and spikes: simple, high-contrast cartoon shapes.
  ctx.beginPath(); ctx.arc(-.12,-.2,.18,Math.PI,Math.PI*2); ctx.lineTo(.05,-.16); ctx.closePath(); ink(ctx,'#68737f',.028);
  for(const ox of [-.2,-.08,.03]){ ctx.beginPath(); ctx.moveTo(ox,-.34); ctx.lineTo(ox+.035,-.48); ctx.lineTo(ox+.075,-.32); ctx.closePath(); ink(ctx,'#e1e7ed',.015); }
}

// --- Dark Elf -------------------------------------------------------------

function drawDarkElf(ctx: CanvasRenderingContext2D, s: HeroArtState): void {
  const cloth = '#5a4380';
  const dark = '#3b2b58';
  const trim = '#c78dff';
  const steel = '#a394c4';
  const pull = s.swing;

  cloak(ctx, dark, 'rgba(16,8,30,0.7)', 0.3);

  // Torso.
  rounded(ctx, 0, 0, 0.32, 0.38, 0.13);
  ink(ctx, cloth);
  rounded(ctx, 0, 0.06, 0.34, 0.06, 0.03);
  ink(ctx, trim, 0.02);

  // Both hands on the crossbow.
  arm(ctx, -0.15, -0.06, -0.06, -0.2, cloth, 0.085);
  arm(ctx, 0.15, -0.06, 0.06, -0.12 - pull * 0.04, cloth, 0.085);

  // Crossbow: prod across the front, stock running back to the shoulder.
  ctx.save();
  ctx.translate(0, -0.06);
  ctx.beginPath();
  ctx.moveTo(-0.28, -0.3);
  ctx.lineTo(-0.05, -0.26);
  ctx.lineTo(0.05, -0.26);
  ctx.lineTo(0.28, -0.3);
  ctx.lineTo(0.28, -0.22);
  ctx.lineTo(0.05, -0.19);
  ctx.lineTo(-0.05, -0.19);
  ctx.lineTo(-0.28, -0.22);
  ctx.closePath();
  ink(ctx, steel, 0.026);
  // String: snaps forward as the shot goes off.
  const rest = -0.24 + (1 - pull) * 0.2;
  ctx.beginPath();
  ctx.moveTo(-0.27, -0.26);
  ctx.lineTo(0, rest);
  ctx.lineTo(0.27, -0.26);
  ctx.lineWidth = 0.016;
  ctx.strokeStyle = '#e6dcff';
  ctx.stroke();
  if (pull < 0.4) {
    ctx.beginPath();
    ctx.moveTo(0, -0.02);
    ctx.lineTo(0, -0.36);
    ctx.lineWidth = 0.022;
    ctx.strokeStyle = '#9ff05a';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -0.42);
    ctx.lineTo(-0.035, -0.33);
    ctx.lineTo(0.035, -0.33);
    ctx.closePath();
    ink(ctx, '#d5ffb0', 0.015);
  }
  rounded(ctx, 0, -0.08, 0.08, 0.36, 0.025);
  ink(ctx, '#4a3a2e', 0.024);
  ctx.restore();

  // Hood with a long trailing point and glowing eyes.
  ctx.beginPath();
  ctx.moveTo(0, 0.16);
  ctx.quadraticCurveTo(-0.16, -0.02, -0.13, -0.16);
  ctx.quadraticCurveTo(0, -0.32, 0.13, -0.16);
  ctx.quadraticCurveTo(0.16, -0.02, 0, 0.16);
  ctx.closePath();
  ink(ctx, dark);
  circle(ctx, s.view === 'side' ? 0.025 : 0, -0.16, 0.08);
  ink(ctx, s.view === 'back' ? '#493762' : '#cfc3e0', 0.02);
  if (s.view !== 'back') {
    ctx.fillStyle = '#ff5fd0'; ctx.beginPath();
    if (s.view === 'side') ctx.arc(0.058, -0.19, 0.02, 0, Math.PI * 2);
    else { ctx.arc(-0.033, -0.19, 0.019, 0, Math.PI * 2); ctx.arc(0.033, -0.19, 0.019, 0, Math.PI * 2); }
    ctx.fill();
  }

  // Poison vial on the hip.
  circle(ctx, -0.19, 0.14, 0.045);
  ink(ctx, '#9ff05a', 0.02);
}

const PAINTERS: Record<number, (ctx: CanvasRenderingContext2D, s: HeroArtState) => void> = {
  [HERO.Paladin]: drawPaladin,
  [HERO.Orc]: drawOrc,
  [HERO.DarkElf]: drawDarkElf,
  [HERO.HighElf]: drawHighElf,
  [HERO.Magician]: drawMagician,
};

/** Draw hero `defId` centred on (x, y), `size` pixels tall, facing `rot`. */
export function drawHeroSprite(
  ctx: CanvasRenderingContext2D,
  defId: number,
  x: number,
  y: number,
  size: number,
  state: HeroArtState,
): void {
  const paint = PAINTERS[defId] ?? drawPaladin;
  const bob = state.walk > 0 ? Math.sin(state.time * 0.014) * size * 0.018 : 0;

  // Contact shadow + team ring stay axis-aligned on the ground. Their vertical
  // squash establishes the same isometric ground plane as the battlefield.
  ctx.save();
  ctx.translate(x, y);
  // Layered isometric base: a small diamond plate visually anchors the upright
  // miniature to the same 2:1 ground plane as tiles and scenery.
  ctx.globalAlpha = 0.48;
  const plate = ctx.createLinearGradient(-size * 0.34, 0, size * 0.34, size * 0.3);
  plate.addColorStop(0, '#dff8ff');
  plate.addColorStop(0.45, state.team);
  plate.addColorStop(1, '#10192a');
  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.17);
  ctx.lineTo(size * 0.34, size * 0.3);
  ctx.lineTo(0, size * 0.43);
  ctx.lineTo(-size * 0.34, size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = state.team;
  ctx.lineWidth = Math.max(1.2, size * 0.018);
  ctx.stroke();
  if (state.cast > 0) {
    ctx.globalAlpha = 0.22 + state.cast * 0.28;
    ctx.strokeStyle = '#e9fbff';
    ctx.lineWidth = size * 0.035;
    ctx.beginPath();
    ctx.ellipse(0, size * 0.3, size * (0.42 + state.cast * 0.08), size * (0.19 + state.cast * 0.03), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, size * 0.28, size * 0.27, size * 0.105, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = state.team;
  ctx.lineWidth = size * 0.026;
  ctx.beginPath();
  ctx.ellipse(0, size * 0.3, size * 0.43, size * 0.2, -0.08, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y + bob - size * 0.13);
  // Camera-facing three-quarter presentation: mirror when travelling left,
  // then add a small directional lean. Crucially, the body remains upright.
  const facingX = Math.sin(state.rot);
  // Gameplay sprites use strong left/right silhouettes at every angle.
  const view: HeroArtState['view'] = 'side';
  const pose: HeroArtState = { ...state, view };
  const mirror = facingX < -0.08 ? -1 : 1;
  ctx.scale(size * mirror * 0.94, size * 1.08);
  ctx.transform(1, 0, -0.04, 1, Math.abs(facingX) * 0.025, 0);
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  // A cool key light and warm ground bounce add depth without flattening each
  // class's own palette or silhouette.
  ctx.shadowColor = state.cast > 0 ? 'rgba(150,235,255,.8)' : 'rgba(8,12,25,.55)';
  ctx.shadowBlur = state.cast > 0 ? 0.09 : 0.035;
  ctx.shadowOffsetY = 0.025;
  drawIsoLegs(ctx, defId, pose);
  paint(ctx, pose);
  ctx.restore();
}
