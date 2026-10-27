import type { PowerKey } from "@/game/drops";

/**
 * Pickup art (tools/build_pickups.py): potions for lasting power-ups (Hearthmoor alchemy flasks,
 * recoloured per key) and glowing sparkle orbs for timed buffs (Hearthmoor glow orb strip + Kindle
 * Quest pickup ring, recoloured per buff). All pre-tinted offline: no per-frame filter or shadowBlur.
 */
export const POTION_KEYS = ["bolt", "beam", "wave", "fire", "ice", "water", "speed", "amount"] as const;
export type PotionKey = (typeof POTION_KEYS)[number];
export const ORB_KEYS = ["rage", "haste", "fire", "shield", "magnet"] as const;
export type OrbKey = (typeof ORB_KEYS)[number];
const POTION_CELL = 16;
const ORB_CELL = 48;
const ORB_FRAMES = 8;
const RING_CELL = 12;

const load = (src: string) => (typeof Image === "undefined" ? undefined : Object.assign(new Image(), { src }));
const potionImg = load(`${import.meta.env.BASE_URL}game/sprites/potions.png?v=1`);
const orbImg = load(`${import.meta.env.BASE_URL}game/sprites/orbs.png?v=1`);
const ringImg = load(`${import.meta.env.BASE_URL}game/sprites/rings.png?v=1`);
const ready = (i: HTMLImageElement | undefined): i is HTMLImageElement => !!i?.complete && i.naturalWidth > 0;

export function isPotionKey(k: PowerKey | null): k is PotionKey {
  return k !== null && (POTION_KEYS as readonly string[]).includes(k);
}

/** Integer screen scale for pickup art at the current zoom (>= 2 so a 16 px flask stays readable on phones). */
function screenScale(ctx: CanvasRenderingContext2D, worldPx: number, art: number): number {
  const m = ctx.getTransform();
  const zoom = Math.hypot(m.a, m.b) || 1;
  return Math.max(2, Math.round((zoom * worldPx) / art));
}

/** Potion standing with its base at world (x, y). */
export function drawPotion(ctx: CanvasRenderingContext2D, key: PotionKey, x: number, y: number, worldPx: number): boolean {
  if (!ready(potionImg)) return false;
  const i = POTION_KEYS.indexOf(key);
  const k = screenScale(ctx, worldPx, POTION_CELL);
  const m = ctx.getTransform();
  const sx = Math.round(m.a * x + m.e);
  const sy = Math.round(m.d * y + m.f);
  const s = POTION_CELL * k;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(potionImg, i * POTION_CELL, 0, POTION_CELL, POTION_CELL, sx - s / 2, sy - s, s, s);
  ctx.restore();
  return true;
}

/** Sparkling orb centred on world (x, y), animated by time (ms); KQ pickup ring on the ground at groundY. */
export function drawOrb(ctx: CanvasRenderingContext2D, key: OrbKey, x: number, y: number, worldPx: number, now: number, groundY = y): boolean {
  if (!ready(orbImg)) return false;
  const row = ORB_KEYS.indexOf(key);
  const f = Math.floor(now / 110) % ORB_FRAMES;
  // The orb core is ~12 of the 48 px cell; scale so the core is ~worldPx/2.
  const k = screenScale(ctx, worldPx, 24);
  const m = ctx.getTransform();
  const sx = Math.round(m.a * x + m.e);
  const sy = Math.round(m.d * y + m.f);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (ready(ringImg)) {
    const rf = Math.floor(now / 160) % 4;
    // KQ pickup ring pulsing on the ground under the orb (squashed 2:1, integer scale).
    const rs = RING_CELL * k;
    const gy = Math.round(m.d * groundY + m.f);
    ctx.globalAlpha = 0.7;
    ctx.drawImage(ringImg, rf * RING_CELL, row * RING_CELL, RING_CELL, RING_CELL, sx - rs, gy - rs / 2, rs * 2, rs);
    ctx.globalAlpha = 1;
  }
  const s = ORB_CELL * k;
  ctx.drawImage(orbImg, f * ORB_CELL, row * ORB_CELL, ORB_CELL, ORB_CELL, sx - s / 2, sy - s / 2, s, s);
  ctx.restore();
  return true;
}
