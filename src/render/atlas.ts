import { SHEET_COLS } from '../content/art';

const SHEET_URL = `${import.meta.env.BASE_URL}assets/sprites/towerDefense_tilesheet@2.png`;
/** The @2 sheet is 2944x1664, i.e. 128px tiles in the same 23x13 grid. */
const TILE = 128;

/**
 * Sprite sheet access with an on-demand tint cache.
 *
 * Kenney's pack only ships a handful of unit sprites, so almost every enemy is
 * the same silhouette recoloured. Tints are baked once into small offscreen
 * canvases rather than recomputed per frame.
 */
export class Atlas {
  readonly image = new Image();
  loaded = false;
  private tintCache = new Map<string, HTMLCanvasElement>();

  load(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.image.onload = () => {
        this.loaded = true;
        resolve();
      };
      this.image.onerror = () => reject(new Error('Failed to load the sprite sheet.'));
      this.image.src = SHEET_URL;
    });
  }

  private sx(index: number): number {
    return (index % SHEET_COLS) * TILE;
  }

  private sy(index: number): number {
    return Math.floor(index / SHEET_COLS) * TILE;
  }

  /** Draw a sprite centred on (x, y) at `size` pixels, rotated by `rot` radians. */
  draw(
    ctx: CanvasRenderingContext2D,
    index: number,
    x: number,
    y: number,
    size: number,
    rot = 0,
    alpha = 1,
  ): void {
    if (!this.loaded) return;
    ctx.save();
    if (alpha !== 1) ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    if (rot !== 0) ctx.rotate(rot);
    ctx.drawImage(
      this.image,
      this.sx(index), this.sy(index), TILE, TILE,
      -size / 2, -size / 2, size, size,
    );
    ctx.restore();
  }

  /** Draw a sprite axis-aligned (for terrain, where rotation is never needed). */
  drawTile(
    ctx: CanvasRenderingContext2D,
    index: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (!this.loaded) return;
    ctx.drawImage(this.image, this.sx(index), this.sy(index), TILE, TILE, x, y, w, h);
  }

  drawTinted(
    ctx: CanvasRenderingContext2D,
    index: number,
    x: number,
    y: number,
    size: number,
    rot: number,
    color: string,
    alpha = 1,
  ): void {
    const tinted = this.tinted(index, color);
    if (!tinted) return;
    ctx.save();
    if (alpha !== 1) ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    if (rot !== 0) ctx.rotate(rot);
    ctx.drawImage(tinted, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  private tinted(index: number, color: string): HTMLCanvasElement | null {
    if (!this.loaded) return null;
    const key = `${index}|${color}`;
    const cached = this.tintCache.get(key);
    if (cached) return cached;

    const c = document.createElement('canvas');
    c.width = TILE;
    c.height = TILE;
    const g = c.getContext('2d');
    if (!g) return null;

    g.drawImage(this.image, this.sx(index), this.sy(index), TILE, TILE, 0, 0, TILE, TILE);
    // Multiply keeps the artwork's shading and outline instead of flat-filling it.
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = color;
    g.fillRect(0, 0, TILE, TILE);
    // Restore the original alpha mask that `multiply` just squared.
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(this.image, this.sx(index), this.sy(index), TILE, TILE, 0, 0, TILE, TILE);
    g.globalCompositeOperation = 'source-over';

    this.tintCache.set(key, c);
    return c;
  }
}

export const atlas = new Atlas();
