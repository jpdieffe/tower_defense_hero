import { makeLocalRng } from '../core/rng';
import { FXART } from '../content/art';
import { atlas } from './atlas';

/**
 * Purely cosmetic particles and floating text.
 *
 * None of this touches the simulation - it is driven by the event list the sim
 * emits, so both players see the same explosions without either of them being
 * able to influence the other's world.
 */

const rand = makeLocalRng(0xc0ffee);

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  rot: number; spin: number;
  sprite: number;
  color: string;
  kind: number;
  drag: number;
}

export interface FloatText {
  x: number; y: number;
  vy: number;
  life: number; maxLife: number;
  text: string;
  color: string;
  size: number;
}

export interface Shockwave {
  x: number; y: number;
  radius: number;
  maxRadius: number;
  life: number; maxLife: number;
  color: string;
  width: number;
}

export interface Beam {
  x1: number; y1: number;
  x2: number; y2: number;
  life: number; maxLife: number;
  color: string;
  width: number;
  jitter: number;
}

const PART_SPRITE = 0;
const PART_DOT = 1;

export class Fx {
  particles: Particle[] = [];
  texts: FloatText[] = [];
  waves: Shockwave[] = [];
  beams: Beam[] = [];
  shake = 0;

  clear(): void {
    this.particles.length = 0;
    this.texts.length = 0;
    this.waves.length = 0;
    this.beams.length = 0;
    this.shake = 0;
  }

  update(dt: number): void {
    const k = dt / 16.67;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vx *= Math.pow(p.drag, k);
      p.vy *= Math.pow(p.drag, k);
      p.rot += p.spin * k;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) { this.texts.splice(i, 1); continue; }
      t.y += t.vy * k;
      t.vy *= Math.pow(0.94, k);
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.life -= dt;
      if (w.life <= 0) { this.waves.splice(i, 1); continue; }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) this.beams.splice(i, 1);
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 0.012);
  }

  /** Cap the particle budget so a huge wave cannot tank the frame rate. */
  private room(n: number): number {
    const free = 420 - this.particles.length;
    return Math.max(0, Math.min(n, free));
  }

  burst(x: number, y: number, count: number, color: string, speed: number, size: number): void {
    const n = this.room(count);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const s = speed * (0.35 + rand() * 0.85);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 260 + rand() * 320,
        maxLife: 580,
        size: size * (0.6 + rand() * 0.7),
        rot: rand() * Math.PI * 2,
        spin: (rand() - 0.5) * 0.3,
        sprite: 0,
        color,
        kind: PART_DOT,
        drag: 0.9,
      });
    }
  }

  sprites(x: number, y: number, count: number, sprite: number, speed: number, size: number, life = 600): void {
    const n = this.room(count);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const s = speed * (0.3 + rand() * 0.9);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * (0.6 + rand() * 0.7),
        maxLife: life,
        size: size * (0.7 + rand() * 0.6),
        rot: rand() * Math.PI * 2,
        spin: (rand() - 0.5) * 0.25,
        sprite,
        color: '#fff',
        kind: PART_SPRITE,
        drag: 0.88,
      });
    }
  }

  explosion(x: number, y: number, radius: number, color: string): void {
    this.waves.push({
      x, y, radius: radius * 0.25, maxRadius: radius,
      life: 320, maxLife: 320, color, width: Math.max(2, radius * 0.14),
    });
    this.sprites(x, y, 6, FXART.smokeB, radius * 0.055, radius * 0.75, 520);
    this.burst(x, y, 10, color, radius * 0.06, radius * 0.16);
  }

  ring(x: number, y: number, radius: number, color: string, width = 3, life = 420): void {
    this.waves.push({ x, y, radius: radius * 0.2, maxRadius: radius, life, maxLife: life, color, width });
  }

  beam(x1: number, y1: number, x2: number, y2: number, color: string, width = 3, life = 130, jitter = 6): void {
    if (this.beams.length > 80) return;
    this.beams.push({ x1, y1, x2, y2, life, maxLife: life, color, width, jitter });
  }

  text(x: number, y: number, text: string, color: string, size = 16): void {
    if (this.texts.length > 60) return;
    this.texts.push({
      x: x + (rand() - 0.5) * 10,
      y,
      vy: -1.15,
      life: 850,
      maxLife: 850,
      text,
      color,
      size,
    });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // Beams first so particles sparkle on top of them.
    for (const b of this.beams) {
      const t = b.life / b.maxLife;
      ctx.save();
      ctx.globalAlpha = t;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.width * (0.5 + t * 0.5);
      ctx.lineCap = 'round';
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      const segs = 4;
      for (let i = 1; i < segs; i++) {
        const f = i / segs;
        ctx.lineTo(
          b.x1 + (b.x2 - b.x1) * f + (rand() - 0.5) * b.jitter,
          b.y1 + (b.y2 - b.y1) * f + (rand() - 0.5) * b.jitter,
        );
      }
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.restore();
    }

    for (const w of this.waves) {
      const t = 1 - w.life / w.maxLife;
      const r = w.radius + (w.maxRadius - w.radius) * easeOut(t);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = w.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const p of this.particles) {
      const a = Math.min(1, p.life / (p.maxLife * 0.6));
      if (p.kind === PART_SPRITE) {
        atlas.draw(ctx, p.sprite, p.x, p.y, p.size, p.rot, a);
      } else {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawText(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const a = Math.min(1, t.life / (t.maxLife * 0.5));
      ctx.globalAlpha = a;
      ctx.font = `900 ${t.size}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(6,8,14,0.85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
