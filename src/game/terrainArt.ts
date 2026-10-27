import type { Prop, TerrainZone } from "@/game/types";
import { hash2 } from "@/game/rng";

/**
 * Terrain art (tools/build_terrain.py, pre-tinted offline to the dark-neon palette):
 * terrain-tex.png  = snow / ice / water textures (Gravewake wild-ice + wild-water, recoloured),
 * buildings.png    = Gravewake houses and winter pines in 80x96 cells, bottom-centred.
 * Zones bake once per seed into one canvas (1 px = ZONE_PX world px) with a wide, noise-wandering dithered rim;
 * no per-frame ctx.filter or shadowBlur.
 */
export const TERRAIN_TEX = ["snow", "ice", "water"] as const;
export const BUILDING_ART = ["house-slate", "house-stone", "pine", "pine2", "yew"] as const;
const TEX = 128;
const CELL_W = 80;
const CELL_H = 96;
export const ZONE_PX = 3;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const load = (src: string) => (typeof Image === "undefined" ? undefined : Object.assign(new Image(), { src }));
const texImg = load(`${import.meta.env.BASE_URL}game/sprites/terrain-tex.png?v=1`);
const buildImg = load(`${import.meta.env.BASE_URL}game/sprites/buildings.png?v=1`);
const ready = (i: HTMLImageElement | undefined): i is HTMLImageElement => !!i?.complete && i.naturalWidth > 0;

const RIM = 12;
/** Smooth 2D value noise in [0, 1) (bilinear, smoothstep) over a hash2 lattice. */
function vnoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  let fx = x - x0, fy = y - y0;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, x0, y0), b = hash2(seed, x0 + 1, y0), c = hash2(seed, x0, y0 + 1), d = hash2(seed, x0 + 1, y0 + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

let zoneCache: { key: string; canvas: HTMLCanvasElement } | null = null;

/** Bakes all zones into one arena canvas: texture inside, a wide 4-band ordered-dither rim on a noisy organic edge. */
export function zoneCanvas(seed: number, biome: string, zones: TerrainZone[], arena: number, skip: (x: number, y: number) => boolean): HTMLCanvasElement | null {
  const key = `${seed}:${biome}:${zones.length}`;
  if (zoneCache?.key === key) return zoneCache.canvas;
  if (typeof document === "undefined" || !ready(texImg)) return null;
  const src = document.createElement("canvas");
  src.width = texImg.naturalWidth;
  src.height = texImg.naturalHeight;
  const sctx = src.getContext("2d");
  if (!sctx) return null;
  sctx.drawImage(texImg, 0, 0);
  const sd = sctx.getImageData(0, 0, src.width, src.height).data;
  const P = ZONE_PX;
  const n = Math.ceil(arena / P);
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const out = ctx.createImageData(n, n);
  const od = out.data;
  for (const z of zones) {
    const t = Math.max(0, TERRAIN_TEX.indexOf(z.kind));
    let x0 = n, y0 = n, x1 = 0, y1 = 0;
    for (const [x, y, r] of z.parts) {
      x0 = Math.min(x0, Math.floor((x - r) / P) - 14);
      y0 = Math.min(y0, Math.floor((y - r) / P) - 14);
      x1 = Math.max(x1, Math.ceil((x + r) / P) + 14);
      y1 = Math.max(y1, Math.ceil((y + r) / P) + 14);
    }
    for (let y = Math.max(0, y0); y < Math.min(n, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(n, x1); x++) {
        // Organic edge: two octaves of smooth value noise (no 3x3 blocks), so the rim wanders instead of stair-stepping.
        const j = (vnoise(seed ^ 0x2e7a, x / 14, y / 14) - 0.5) * 16 + (vnoise(seed ^ 0x51c3, x / 4.5, y / 4.5) - 0.5) * 6;
        let s = -1e9;
        for (const [zx, zy, zr] of z.parts) s = Math.max(s, zr / P + j - Math.hypot(x + 0.5 - zx / P, y + 0.5 - zy / P));
        if (s <= 0) continue;
        // Wide 4-band ordered-dither blend (12 art px): 12% / 37% / 62% / 100%. Hard alpha, no AA.
        const b = BAYER4[(y & 3) * 4 + (x & 3)];
        if (s < RIM * 0.25 ? b >= 2 : s < RIM * 0.5 ? b >= 6 : s < RIM * 0.75 ? b >= 10 : s < RIM && b >= 14) continue;
        if (skip(x * P + 1, y * P + 1)) continue;
        const si = ((y % TEX) * src.width + t * TEX + (x % TEX)) * 4;
        const oi = (y * n + x) * 4;
        od[oi] = sd[si];
        od[oi + 1] = sd[si + 1];
        od[oi + 2] = sd[si + 2];
        od[oi + 3] = 255;
      }
    }
  }
  ctx.putImageData(out, 0, 0);
  zoneCache = { key, canvas };
  return canvas;
}

/** Draws the visible slice of the baked zone canvas in world space (nearest-neighbour). */
export function drawZones(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number): void {
  const P = ZONE_PX;
  const sx = Math.max(0, Math.floor(x / P));
  const sy = Math.max(0, Math.floor(y / P));
  const sw = Math.min(canvas.width - sx, Math.ceil(w / P) + 1);
  const sh = Math.min(canvas.height - sy, Math.ceil(h / P) + 1);
  if (sw <= 0 || sh <= 0) return;
  const was = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, sx, sy, sw, sh, sx * P, sy * P, sw * P, sh * P);
  ctx.imageSmoothingEnabled = was;
}

/** House / pine standing with its base just below the collider centre, in integer screen pixels (1x at phone zoom). */
/** Art rows at the bottom of a building cell kept opaque when its roof fades (doorstep/footprint stays readable). */
const BASE_ROWS = 24;
/** Roof alpha while an actor stands behind a house. */
export const ROOF_FADE = 0.4;

/** True when (x, y) is hidden behind a house sprite (north of its footprint, inside the drawn art). World units. */
export function behindBuilding(prop: Prop, x: number, y: number): boolean {
  if (prop.kind !== "house") return false;
  const k = 1.72; // world px per art px (matches drawTerrainProp at zoom 1)
  return y < prop.y && y > prop.y + prop.r * 0.45 - CELL_H * k + 12 && Math.abs(x - prop.x) < (CELL_W * k) / 2 - 10;
}

export function drawTerrainProp(ctx: CanvasRenderingContext2D, prop: Prop, fade = false): boolean {
  if (!ready(buildImg)) return false;
  const art = prop.art ?? (prop.kind === "pine" ? 2 : 0);
  const m = ctx.getTransform();
  const zoom = Math.hypot(m.a, m.b) || 1;
  const k = Math.max(1, Math.round(zoom * 1.72));
  const sx = Math.round(m.a * prop.x + m.e - (CELL_W * k) / 2);
  const sy = Math.round(m.d * (prop.y + prop.r * 0.45) + m.f - CELL_H * k);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (fade) {
    // Roof/walls at 40% so an actor behind reads through; footprint rows opaque. Two plain blits, no filter.
    const top = CELL_H - BASE_ROWS;
    ctx.globalAlpha = ROOF_FADE;
    ctx.drawImage(buildImg, art * CELL_W, 0, CELL_W, top, sx, sy, CELL_W * k, top * k);
    ctx.globalAlpha = 1;
    ctx.drawImage(buildImg, art * CELL_W, top, CELL_W, BASE_ROWS, sx, sy + top * k, CELL_W * k, BASE_ROWS * k);
  } else ctx.drawImage(buildImg, art * CELL_W, 0, CELL_W, CELL_H, sx, sy, CELL_W * k, CELL_H * k);
  ctx.restore();
  return true;
}
