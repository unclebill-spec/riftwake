import { PROP_ART } from "./propsheet";
import { hash2, mulberry32 } from "@/game/rng";
import type { ActorId, Anim } from "@/game/types";

function browserImage(src: string): HTMLImageElement | null {
  if (typeof window === "undefined") return null;
  const img = new Image();
  img.src = src;
  return img;
}

const atlasImg = browserImage(`${import.meta.env.BASE_URL}game/sprites/atlas.png?v=9`);
const iconImg = browserImage(`${import.meta.env.BASE_URL}game/sprites/icons.png`);
// Reused spell FX (Gravewake fx2/gen/wow2): 6 rows x 4 frames of 32x16 art, pointing +x.
const floorImg: Record<string, HTMLImageElement | null> = {};
// Reused Gravewake 16 px floor stones at 3x (48 px), darkened ~35%: FLOOR_VARIANTS cells per biome strip.
const floorVarImg: Record<string, HTMLImageElement | null> = {};
// Texture-only detail (cracks/pebbles/specks) from the same stones, 16 art px per variant, re-based on our floor colour.
const floorDetailImg: Record<string, HTMLImageElement | null> = {};
for (const id of ["rock", "forest", "snow", "ice", "lava"]) {
  floorImg[id] = browserImage(`${import.meta.env.BASE_URL}game/sprites/floor-${id}.png`);
  floorVarImg[id] = browserImage(`${import.meta.env.BASE_URL}game/sprites/floor-var-${id}.png?v=1`);
  floorDetailImg[id] = browserImage(`${import.meta.env.BASE_URL}game/sprites/floor-detail-${id}.png?v=3`);
}
export const FLOOR_VARIANTS = 5;
/** Share of floor cells that get a reused Gravewake variant (seeded per cell, so a map looks the same every load). */
export const FLOOR_VARIANT_RATE = 0.1;
const propImg: Record<"tree" | "boulder", HTMLImageElement | null> = {
  tree: browserImage(`${import.meta.env.BASE_URL}game/sprites/tree.png`),
  boulder: browserImage(`${import.meta.env.BASE_URL}game/sprites/boulder.png`),
};

const SHOT_INDEX = ["bolt", "beam", "wave", "fire", "ice", "water"];

// Boss sheet reused from Will's other games (Gravewake big bosses, Knight's Quest chars), built by
// tools/build_bosses.py: 40x44 art cells, feet on row BOSS_BASE, cols walk0-3/cast0-2/jump0-3,
// rows kind*4 + (0 up, 1 right, 2 down, 3 left). bosses-rim.png is the matching 1 px gold outline.
const bossImg = browserImage(`${import.meta.env.BASE_URL}game/sprites/bosses.png?v=1`);
const bossRimImg = browserImage(`${import.meta.env.BASE_URL}game/sprites/bosses-rim.png?v=1`);
const BOSS_W = 40;
const BOSS_H = 44;
const BOSS_BASE = 42;
const BOSS_ORDER = ["skeleton", "orc", "zombie", "vampire", "ghost", "minotaur", "satyr", "sphinx", "succubus", "incubus", "angel", "spider", "bear", "alligator", "tiger"];
/** Kinds that always use their boss sprite (the specials); every elite uses one too. */
export const SPECIAL_KINDS = new Set(["vampire", "ghost", "minotaur", "satyr", "sphinx", "angel", "spider", "tiger"]);
// 8-way facing (N,NE,E,SE,S,SW,W,NW) -> sheet row (up, right, down, left).
const BOSS_FACE = [0, 1, 1, 1, 2, 3, 3, 3];
const BOSS_COL: Record<Anim, number> = { walk: 0, cast: 4, jump: 7 };

// Spell FX reused from Hearthmoor gamefx, Knight's Quest fx and Gravewake fx2 (tools/build_spellfx.py):
// 48x48 art cells x 8 frames. Rows 0-5 projectiles (SHOT_INDEX order), 6 enemy shot, 7-12 impacts, 13 rage aura.
const spellImg = browserImage(`${import.meta.env.BASE_URL}game/sprites/spell-fx.png?v=2`);
const SPELL = 48;
export const IMPACT_FRAMES = [7, 7, 6, 6, 7, 8];
const IMPACT_ENEMY_ROW = 10; // enemy shots splash with the fire burst
export function spellReady(): boolean {
  return !!spellImg?.complete && (spellImg?.naturalWidth ?? 0) > 0;
}

/** Projectile frame for a shot type ("enemy" for hostile shots), `perArt` screen px per art px. */
export function drawSpell(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, angle: number, f: number, perArt: number): void {
  if (!spellImg || !spellReady()) return;
  const row = type === "enemy" ? 6 : Math.max(0, SHOT_INDEX.indexOf(type));
  spellCell(ctx, row, f & 7, x, y, angle, perArt);
}

/** Impact burst for a shot type at progress t (0..1). */
export function drawImpact(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, t: number, perArt: number): void {
  if (!spellImg || !spellReady()) return;
  const i = SHOT_INDEX.indexOf(type);
  const row = i < 0 ? IMPACT_ENEMY_ROW : 7 + i;
  const n = i < 0 ? 6 : (IMPACT_FRAMES[i] ?? 6);
  spellCell(ctx, row, Math.min(n - 1, Math.floor(t * n)), x, y, 0, perArt);
}

/** Looping hero aura (rage buff) centred on (x, y): HM mp_fx flame_ward, spell row 13. */
export function drawAura(ctx: CanvasRenderingContext2D, x: number, y: number, f: number, perArt: number): void {
  if (!spellImg || !spellReady()) return;
  spellCell(ctx, 13, f & 7, x, y, 0, perArt);
}

function spellCell(ctx: CanvasRenderingContext2D, row: number, col: number, x: number, y: number, angle: number, perArt: number): void {
  if (!spellImg) return;
  const m = ctx.getTransform();
  const k = Math.max(1, Math.round(perArt));
  const size = SPELL * k;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, Math.round(m.a * x + m.c * y + m.e), Math.round(m.b * x + m.d * y + m.f));
  ctx.imageSmoothingEnabled = false;
  if (angle) ctx.rotate(angle);
  ctx.drawImage(spellImg, col * SPELL, row * SPELL, SPELL, SPELL, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/** Tiles the reused beam strip (spell row 1) along a hitscan beam, `perArt` screen px per art px. */
export function drawSpellBeam(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, f: number, perArt: number): boolean {
  if (!spellImg || !spellReady()) return false;
  const m = ctx.getTransform();
  const zoom = Math.hypot(m.a, m.b) || 1;
  const k = Math.max(1, Math.round(perArt));
  const screenLen = len * zoom;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, Math.round(m.a * x + m.c * y + m.e), Math.round(m.b * x + m.d * y + m.f));
  ctx.rotate(angle);
  ctx.imageSmoothingEnabled = false;
  const seg = SPELL * k;
  for (let d = 0; d < screenLen; d += seg) {
    const w = Math.min(seg, screenLen - d);
    ctx.drawImage(spellImg, (f & 7) * SPELL, SPELL, w / k, SPELL, d, -seg / 2, w, seg);
  }
  ctx.restore();
  return true;
}

// Ground: seamless 256 art px textures per biome built from Hearthmoor texel tiles (tools/build_terrain.py).
const groundImg: Record<string, HTMLImageElement | null> = {};
for (const id of ["rock", "forest", "snow", "ice", "lava", "lavaflow"]) groundImg[id] = browserImage(`${import.meta.env.BASE_URL}game/sprites/ground-${id}.png?v=1`);
const groundPat = new Map<string, CanvasPattern>();

/**
 * Fills world rect (x, y, w, h) with the biome ground, drawn in screen space at a whole number of screen px
 * per art px (`worldPerArt` world px per art px before rounding) anchored to world 0,0 so it never swims.
 */
export function drawGround(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, w: number, h: number, worldPerArt: number): boolean {
  const img = groundImg[id];
  if (!img?.complete || img.naturalWidth === 0) return false;
  let pat = groundPat.get(id);
  if (!pat) {
    const made = ctx.createPattern(img, "repeat");
    if (!made) return false;
    pat = made;
    groundPat.set(id, pat);
  }
  const m = ctx.getTransform();
  const zoom = Math.hypot(m.a, m.b) || 1;
  const k = Math.max(1, Math.round(zoom * worldPerArt));
  const ox = Math.round(m.e);
  const oy = Math.round(m.f);
  pat.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]));
  const sx = Math.round(m.a * x + m.e);
  const sy = Math.round(m.d * y + m.f);
  const ex = Math.round(m.a * (x + w) + m.e);
  const ey = Math.round(m.d * (y + h) + m.f);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = pat;
  ctx.fillRect(sx, sy, ex - sx, ey - sy);
  ctx.restore();
  return true;
}

export function hasBoss(kind: string): boolean {
  return BOSS_ORDER.includes(kind) && !!bossImg?.complete && (bossImg?.naturalWidth ?? 0) > 0;
}

/** Pixel-snapped boss draw: `perArt` screen px per art px (integer), feet at world (dx, dy). */
export function blitBoss(ctx: CanvasRenderingContext2D, kind: string, anim: Anim, facing: number, frame: number, dx: number, dy: number, perArt: number, rim: boolean): void {
  if (!bossImg) return;
  const ki = BOSS_ORDER.indexOf(kind);
  if (ki < 0) return;
  const count = FRAMES[anim];
  const f = ((frame % count) + count) % count;
  const sx = (BOSS_COL[anim] + f) * BOSS_W;
  const sy = (ki * 4 + (BOSS_FACE[((facing % 8) + 8) % 8] ?? 2)) * BOSS_H;
  const m = ctx.getTransform();
  const k = Math.max(1, Math.round(perArt));
  const cx = Math.round(m.a * dx + m.c * dy + m.e);
  const cy = Math.round(m.b * dx + m.d * dy + m.f);
  const x = cx - (BOSS_W / 2) * k;
  const y = cy - BOSS_BASE * k;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (rim && bossRimImg?.complete && bossRimImg.naturalWidth > 0) ctx.drawImage(bossRimImg, sx, sy, BOSS_W, BOSS_H, x, y, BOSS_W * k, BOSS_H * k);
  ctx.drawImage(bossImg, sx, sy, BOSS_W, BOSS_H, x, y, BOSS_W * k, BOSS_H * k);
  ctx.restore();
}

export function whenIcons(cb: () => void): void {
  if (!iconImg) return;
  if (iconImg.complete && iconImg.naturalWidth > 0) cb();
  else iconImg.addEventListener("load", () => cb(), { once: true });
}

export function drawFloorTile(ctx: CanvasRenderingContext2D, biome: string, x: number, y: number, size: number): boolean {
  const img = floorImg[biome];
  if (!img?.complete || img.naturalWidth === 0) return false;
  ctx.drawImage(img, x, y, size, size);
  return true;
}

/** Draws floor variant `v` (0..FLOOR_VARIANTS-1) over a base tile at `alpha`; false if not loaded. */
export function drawFloorVariant(ctx: CanvasRenderingContext2D, biome: string, v: number, x: number, y: number, size: number, alpha: number): boolean {
  const img = floorVarImg[biome];
  if (!img?.complete || img.naturalWidth === 0) return false;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, v * 48, 0, 48, 48, x, y, size, size);
  ctx.globalAlpha = a;
  return true;
}

export function drawPropSprite(ctx: CanvasRenderingContext2D, kind: "tree" | "boulder", x: number, y: number, size: number): boolean {
  const img = propImg[kind];
  if (!img?.complete || img.naturalWidth === 0) return false;
  ctx.drawImage(img, Math.round(x - size / 2), Math.round(y - size / 2), size, size);
  return true;
}


type RGB = [number, number, number];

type Look = {
  shape: "human" | "brute" | "quad" | "spider" | "long" | "wraith";
  skin: string;
  cloth: string;
  trim: string;
  hair: string;
  gem: string;
  hat: "wizard" | "helm" | "horns" | "halo" | "hood" | "ears" | "none";
  weapon: "staff" | "sword" | "axe" | "claws" | "none";
  beard: boolean;
  cape: boolean;
  goat: boolean;
  wings: "none" | "bat" | "feather";
  snout: boolean;
  stripes: boolean;
  bone: boolean;
};

const LOOKS: Record<ActorId, Look> = {
  wizard: { shape: "human", skin: "#e6d3b3", cloth: "#2c4094", trim: "#d4b15a", hair: "#f2efe8", gem: "#5ef2ff", hat: "wizard", weapon: "staff", beard: true, cape: false, goat: false, wings: "none", snout: false, stripes: false, bone: false },
  warrior: { shape: "brute", skin: "#e0b090", cloth: "#6e2e32", trim: "#c5ccd6", hair: "#3a2a22", gem: "#d7dde6", hat: "helm", weapon: "sword", beard: false, cape: true, goat: false, wings: "none", snout: false, stripes: false, bone: false },
  skeleton: { shape: "human", skin: "#d9d3c7", cloth: "#b7b1a4", trim: "#6a645c", hair: "#ece7dc", gem: "#f4f1ea", hat: "none", weapon: "sword", beard: false, cape: false, goat: false, wings: "none", snout: false, stripes: false, bone: true },
  orc: { shape: "brute", skin: "#6f9a45", cloth: "#3d4a2c", trim: "#8d8a7a", hair: "#2a2418", gem: "#d8d2c2", hat: "none", weapon: "axe", beard: false, cape: false, goat: false, wings: "none", snout: true, stripes: false, bone: false },
  zombie: { shape: "human", skin: "#7f8a62", cloth: "#4a463c", trim: "#6a5a48", hair: "#3a342c", gem: "#9aa07a", hat: "none", weapon: "claws", beard: false, cape: false, goat: false, wings: "none", snout: false, stripes: false, bone: false },
  vampire: { shape: "human", skin: "#e7d7c8", cloth: "#2a1c28", trim: "#8a2438", hair: "#1a1418", gem: "#c43a4a", hat: "hood", weapon: "none", beard: false, cape: true, goat: false, wings: "none", snout: false, stripes: false, bone: false },
  ghost: { shape: "wraith", skin: "#d5e7f2", cloth: "#9ec4d8", trim: "#e8f6ff", hair: "#f4fbff", gem: "#bfefff", hat: "hood", weapon: "none", beard: false, cape: false, goat: false, wings: "none", snout: false, stripes: false, bone: false },
  minotaur: { shape: "brute", skin: "#8a5a32", cloth: "#5a3824", trim: "#c9b48a", hair: "#3a2416", gem: "#e6d2a8", hat: "horns", weapon: "axe", beard: false, cape: false, goat: false, wings: "none", snout: true, stripes: false, bone: false },
  satyr: { shape: "human", skin: "#c48a5a", cloth: "#6a3a28", trim: "#d7c09a", hair: "#4a2c18", gem: "#e8d8b0", hat: "horns", weapon: "none", beard: true, cape: false, goat: true, wings: "none", snout: false, stripes: false, bone: false },
  sphinx: { shape: "quad", skin: "#c2a15a", cloth: "#8a6230", trim: "#e6d2a0", hair: "#3a2a18", gem: "#ffe7a0", hat: "none", weapon: "none", beard: false, cape: false, goat: false, wings: "feather", snout: false, stripes: false, bone: false },
  succubus: { shape: "human", skin: "#d9a0b8", cloth: "#3a2040", trim: "#c46ad4", hair: "#2a1428", gem: "#e070d0", hat: "horns", weapon: "none", beard: false, cape: false, goat: false, wings: "bat", snout: false, stripes: false, bone: false },
  incubus: { shape: "brute", skin: "#b86a7a", cloth: "#2e1830", trim: "#8a5a98", hair: "#1c101c", gem: "#d070c0", hat: "horns", weapon: "sword", beard: false, cape: true, goat: false, wings: "bat", snout: false, stripes: false, bone: false },
  angel: { shape: "human", skin: "#f0e2c8", cloth: "#e6e0d2", trim: "#e0b15a", hair: "#f7f1e4", gem: "#ffe9a8", hat: "halo", weapon: "sword", beard: false, cape: false, goat: false, wings: "feather", snout: false, stripes: false, bone: false },
  spider: { shape: "spider", skin: "#3a2e32", cloth: "#241c20", trim: "#a84838", hair: "#1a1416", gem: "#e05040", hat: "none", weapon: "none", beard: false, cape: false, goat: false, wings: "none", snout: false, stripes: false, bone: false },
  bear: { shape: "quad", skin: "#5a4030", cloth: "#3a2a22", trim: "#c4a07a", hair: "#2a1c14", gem: "#e8d0b0", hat: "ears", weapon: "claws", beard: false, cape: false, goat: false, wings: "none", snout: true, stripes: false, bone: false },
  alligator: { shape: "long", skin: "#3e6a3a", cloth: "#2a4a28", trim: "#c8d08a", hair: "#1c3018", gem: "#dfe8a0", hat: "none", weapon: "none", beard: false, cape: false, goat: false, wings: "none", snout: true, stripes: false, bone: false },
  tiger: { shape: "quad", skin: "#e08a32", cloth: "#c46a20", trim: "#1c140e", hair: "#f2e2c8", gem: "#ffe0b0", hat: "ears", weapon: "claws", beard: false, cape: false, goat: false, wings: "none", snout: true, stripes: true, bone: false },
};

const ACTORS: ActorId[] = [
  "wizard", "warrior", "skeleton", "orc", "zombie", "vampire", "ghost", "minotaur", "satyr",
  "sphinx", "succubus", "incubus", "angel", "spider", "bear", "alligator", "tiger",
];

const CELL = 64;
const FRAMES: Record<Anim, number> = { walk: 4, cast: 3, jump: 4 };
const ANIMS: Anim[] = ["walk", "cast", "jump"];
const OUT: RGB = [20, 22, 28];

let atlas: HTMLCanvasElement | null = null;
const colorCache = new Map<string, RGB>();

function rgb(hex: string): RGB {
  const hit = colorCache.get(hex);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  const out: RGB = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  colorCache.set(hex, out);
  return out;
}

function rect(buf: Uint8ClampedArray, x: number, y: number, w: number, h: number, fill: RGB, a = 255): void {
  const x0 = Math.max(0, Math.floor(x * 2));
  const y0 = Math.max(0, Math.floor(y * 2));
  const x1 = Math.min(CELL, Math.ceil((x + w) * 2));
  const y1 = Math.min(CELL, Math.ceil((y + h) * 2));
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * CELL + x0) * 4;
    for (let xx = x0; xx < x1; xx++) {
      buf[i] = fill[0];
      buf[i + 1] = fill[1];
      buf[i + 2] = fill[2];
      buf[i + 3] = a;
      i += 4;
    }
  }
}

function blot(buf: Uint8ClampedArray, x: number, y: number, w: number, h: number, fill: RGB, a = 255): void {
  rect(buf, x - 1, y - 1, w + 2, h + 2, OUT, a);
  rect(buf, x, y, w, h, fill, a);
}

function poseOf(anim: Anim, frame: number): { bob: number; leg: number; cast: number; hop: number } {
  if (anim === "jump") return { bob: 0, leg: 0, cast: 0, hop: [1, -5, -8, -2][frame] ?? 0 };
  if (anim === "cast") return { bob: 0, leg: 0, cast: frame + 1, hop: 0 };
  return { bob: [0, -1, 0, 0][frame] ?? 0, leg: [-2, 2, -1, 2][frame] ?? 0, cast: 0, hop: 0 };
}

function drawActor(buf: Uint8ClampedArray, id: ActorId, facing: number, anim: Anim, frame: number): void {
  const look = LOOKS[id];
  const p = poseOf(anim, frame);
  const y0 = p.hop + p.bob;
  const profile = facing === 4 ? "front" : facing === 0 ? "back" : facing === 2 ? "side" : facing === 3 ? "tq" : "tb";
  const skin = rgb(look.bone ? "#e4dfd4" : look.skin);
  const cloth = rgb(look.cloth);
  const trim = rgb(look.trim);
  const hair = rgb(look.hair);
  const gem = rgb(look.gem);
  const alpha = look.shape === "wraith" ? 170 : 255;
  rect(buf, 10, 28 + y0, 12, 3, [12, 14, 18], 90);
  if (look.wings === "bat") {
    blot(buf, 2, 12 + y0, 6, 3, rgb("#2a1830"), alpha);
    blot(buf, 24, 12 + y0, 6, 3, rgb("#2a1830"), alpha);
    blot(buf, 1, 14 + y0, 4, 5, rgb("#3a2044"), alpha);
    blot(buf, 27, 14 + y0, 4, 5, rgb("#3a2044"), alpha);
  } else if (look.wings === "feather") {
    blot(buf, 1, 11 + y0, 7, 8, rgb("#f4f0e6"), alpha);
    blot(buf, 24, 11 + y0, 7, 8, rgb("#e7e0d0"), alpha);
  }
  if (look.shape === "spider") return drawSpider(buf, y0, p.leg, cloth, trim, gem, alpha);
  if (look.shape === "long") return drawLong(buf, profile, y0, p.leg, skin, cloth, trim, alpha);
  if (look.shape === "quad") return drawQuad(buf, profile, y0, p.leg, look, skin, cloth, trim, hair, alpha);
  if (look.shape === "wraith") {
    blot(buf, 11, 8 + y0, 10, 8, hair, alpha);
    blot(buf, 10, 16 + y0, 12, 10, cloth, alpha);
    blot(buf, 12, 24 + y0, 8, 4, skin, 120);
    rect(buf, 13, 11 + y0, 2, 2, [26, 40, 48], alpha);
    rect(buf, 17, 11 + y0, 2, 2, [26, 40, 48], alpha);
    return;
  }
  const wide = look.shape === "brute";
  const bodyW = wide ? 14 : 12;
  const bodyX = 16 - Math.floor(bodyW / 2);
  const side = profile === "side" || profile === "tb";
  const showFace = profile === "front" || profile === "tq";
  if (look.cape && profile !== "front") blot(buf, bodyX - 1, 15 + y0, bodyW + 2, 12, rgb("#4a1824"), alpha);
  if (look.goat) {
    blot(buf, bodyX + 1, 24 + y0, 4, 5, hair, alpha);
    blot(buf, bodyX + bodyW - 5, 24 + y0, 4, 5, hair, alpha);
  } else if (!side) {
    blot(buf, bodyX + 1, 24 + y0, 4, 5, cloth, alpha);
    blot(buf, bodyX + bodyW - 5, 24 + y0, 4, 5, cloth, alpha);
    rect(buf, bodyX + 2, 28 + y0, 3, 2, trim, alpha);
    rect(buf, bodyX + bodyW - 4, 28 + y0, 3, 2, trim, alpha);
  } else {
    blot(buf, 14, 23 + y0, 4, 6, cloth, alpha);
    blot(buf, 18, 24 + y0 + (p.leg > 0 ? -1 : 1), 4, 5, cloth, alpha);
    rect(buf, 14, 28 + y0, 4, 2, trim, alpha);
  }
  blot(buf, side ? 13 : bodyX, 15 + y0, side ? 8 : bodyW, 11, cloth, alpha);
  rect(buf, side ? 13 : bodyX, 24 + y0, side ? 8 : bodyW, 1, trim, alpha);
  if (look.hat === "wizard") {
    blot(buf, 13, 2 + y0, 6, 3, cloth, alpha);
    blot(buf, 14, 5 + y0, 4, 4, cloth, alpha);
    blot(buf, 10, 9 + y0, 12, 2, cloth, alpha);
    rect(buf, 15, 4 + y0, 2, 2, gem, alpha);
  } else if (look.hat === "helm") {
    blot(buf, 11, 6 + y0, 10, 5, trim, alpha);
  } else if (look.hat === "hood") blot(buf, 11, 6 + y0, 10, 6, cloth, alpha);
  else if (look.hat === "horns") {
    blot(buf, 9, 6 + y0, 3, 5, trim, alpha);
    blot(buf, 20, 6 + y0, 3, 5, trim, alpha);
  } else if (look.hat === "halo") rect(buf, 11, 4 + y0, 10, 1, gem, alpha);
  blot(buf, side ? 14 : 12, 9 + y0, side ? 7 : 8, 7, skin, alpha);
  if (look.beard && showFace) blot(buf, 12, 14 + y0, 8, 5, hair, alpha);
  else if (profile === "back") rect(buf, 12, 10 + y0, 8, 3, hair, alpha);
  else rect(buf, 12, 9 + y0, side ? 6 : 8, 2, hair, alpha);
  if (showFace) {
    const eye = look.bone ? ([26, 24, 20] as RGB) : ([28, 20, 14] as RGB);
    rect(buf, 13, 12 + y0, 2, 2, eye, alpha);
    if (!side) rect(buf, 17, 12 + y0, 2, 2, eye, alpha);
    if (look.snout) blot(buf, side ? 18 : 14, 14 + y0, 4, 3, skin, alpha);
    if (look.bone) rect(buf, 14, 15 + y0, 4, 1, [26, 24, 20], alpha);
  }
  drawWeapon(buf, look, profile, y0, p.cast, cloth, trim, gem, alpha, skin);
}

function drawWeapon(buf: Uint8ClampedArray, look: Look, profile: string, y0: number, cast: number, cloth: RGB, trim: RGB, gem: RGB, alpha: number, skin: RGB): void {
  const ext = cast * 2;
  const forward = profile !== "back";
  if (look.weapon === "staff") {
    const x = forward ? 22 : 8;
    blot(buf, x, 8 + y0 - ext, 2, 18, rgb("#6b4423"), alpha);
    blot(buf, x - 1, 6 + y0 - ext, 4, 4, gem, alpha);
  } else if (look.weapon === "sword") {
    const x = forward ? 22 : 7;
    blot(buf, x, 12 + y0 - ext, 2, 10, trim, alpha);
    rect(buf, x - 1, 20 + y0, 4, 2, rgb("#6b4423"), alpha);
  } else if (look.weapon === "axe") {
    const x = forward ? 22 : 6;
    blot(buf, x, 10 + y0 - ext, 2, 14, rgb("#6b4423"), alpha);
    blot(buf, x - 2, 8 + y0 - ext, 5, 4, trim, alpha);
  } else if (look.weapon === "claws") {
    rect(buf, 8, 18 + y0, 3, 2, skin, alpha);
    rect(buf, 21, 18 + y0, 3, 2, skin, alpha);
  } else {
    blot(buf, 8, 16 + y0, 3, 6, cloth, alpha);
    blot(buf, 21, 16 + y0, 3, 6, cloth, alpha);
  }
}

function drawSpider(buf: Uint8ClampedArray, y0: number, leg: number, cloth: RGB, trim: RGB, gem: RGB, a: number): void {
  for (let i = 0; i < 4; i++) {
    const sway = (i % 2 === 0 ? leg : -leg) > 0 ? 1 : -1;
    blot(buf, 4 + i * 2, 14 + y0 + sway, 2, 8, cloth, a);
    blot(buf, 22 + i, 14 + y0 - sway, 2, 8, cloth, a);
  }
  blot(buf, 10, 14 + y0, 12, 10, cloth, a);
  blot(buf, 12, 10 + y0, 8, 6, trim, a);
  rect(buf, 13, 12 + y0, 2, 2, gem, a);
  rect(buf, 17, 12 + y0, 2, 2, gem, a);
}

function drawLong(buf: Uint8ClampedArray, profile: string, y0: number, leg: number, skin: RGB, cloth: RGB, trim: RGB, a: number): void {
  const side = profile === "side" || profile === "tb" || profile === "tq";
  if (!side) {
    blot(buf, 8, 16 + y0, 16, 8, cloth, a);
    blot(buf, 12, 12 + y0, 8, 6, skin, a);
    rect(buf, 14, 14 + y0, 2, 2, [28, 20, 14], a);
    blot(buf, 10, 22 + y0, 3, 4, skin, a);
    blot(buf, 19, 22 + y0, 3, 4, skin, a);
    return;
  }
  blot(buf, 6, 16 + y0, 18, 6, cloth, a);
  blot(buf, 20, 14 + y0, 8, 4, skin, a);
  rect(buf, 24, 15 + y0, 2, 2, [28, 20, 14], a);
  blot(buf, 8, 21 + y0 + (leg > 0 ? 0 : 1), 3, 4, skin, a);
  blot(buf, 14, 21 + y0, 3, 4, trim, a);
  blot(buf, 4, 17 + y0, 4, 3, cloth, a);
}

function drawQuad(buf: Uint8ClampedArray, profile: string, y0: number, leg: number, look: Look, skin: RGB, cloth: RGB, trim: RGB, hair: RGB, a: number): void {
  const side = profile !== "front" && profile !== "back";
  if (!side) {
    blot(buf, 8, 16 + y0, 16, 10, cloth, a);
    if (look.stripes) {
      rect(buf, 10, 18 + y0, 2, 6, trim, a);
      rect(buf, 15, 18 + y0, 2, 6, trim, a);
    }
    blot(buf, 11, 10 + y0, 10, 8, skin, a);
    if (look.hat === "ears") {
      blot(buf, 10, 8 + y0, 3, 3, cloth, a);
      blot(buf, 19, 8 + y0, 3, 3, cloth, a);
    }
    rect(buf, 13, 13 + y0, 2, 2, [28, 20, 14], a);
    rect(buf, 17, 13 + y0, 2, 2, [28, 20, 14], a);
    if (look.snout) blot(buf, 13, 16 + y0, 6, 3, hair, a);
    return;
  }
  blot(buf, 8, 16 + y0, 14, 7, cloth, a);
  if (look.stripes) rect(buf, 12, 17 + y0, 2, 5, trim, a);
  blot(buf, 18, 13 + y0, 8, 7, skin, a);
  if (look.hat === "ears") blot(buf, 20, 11 + y0, 3, 3, cloth, a);
  rect(buf, 22, 15 + y0, 2, 2, [28, 20, 14], a);
  if (look.snout) blot(buf, 24, 16 + y0, 4, 3, hair, a);
  blot(buf, 9, 22 + y0, 3, 5, cloth, a);
  blot(buf, 14, 22 + y0 + (leg > 0 ? -1 : 1), 3, 5, cloth, a);
  blot(buf, 6, 17 + y0, 4, 3, trim, a);
}

function rowOf(actor: number, anim: Anim, frame: number): number {
  let row = actor * 11;
  if (anim === "cast") row += 4;
  else if (anim === "jump") row += 7;
  return row + frame;
}

export function ensureAtlas(): HTMLCanvasElement {
  if (atlas) return atlas;
  const rows = ACTORS.length * 11;
  const canvas = document.createElement("canvas");
  canvas.width = 8 * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const cell = new Uint8ClampedArray(CELL * CELL * 4);
  ACTORS.forEach((id, actor) => {
    for (const anim of ANIMS) {
      for (let frame = 0; frame < FRAMES[anim]; frame++) {
        for (let facing = 0; facing < 8; facing++) {
          const mirror = facing >= 5;
          const src = mirror ? (facing === 6 ? 2 : facing === 5 ? 3 : 1) : facing;
          cell.fill(0);
          drawActor(cell, id, src, anim, frame);
          const ox = facing * CELL;
          const oy = rowOf(actor, anim, frame) * CELL;
          for (let y = 0; y < CELL; y++) {
            for (let x = 0; x < CELL; x++) {
              const sx = mirror ? CELL - 1 - x : x;
              const si = (y * CELL + sx) * 4;
              const di = ((oy + y) * canvas.width + (ox + x)) * 4;
              img.data[di] = cell[si] ?? 0;
              img.data[di + 1] = cell[si + 1] ?? 0;
              img.data[di + 2] = cell[si + 2] ?? 0;
              img.data[di + 3] = cell[si + 3] ?? 0;
            }
          }
        }
      }
    }
  });
  ctx.putImageData(img, 0, 0);
  atlas = canvas;
  return canvas;
}

const INDEX = new Map<ActorId, number>(ACTORS.map((id, i) => [id, i]));

export function blit(
  ctx: CanvasRenderingContext2D,
  id: ActorId,
  anim: Anim,
  facing: number,
  frame: number,
  dx: number,
  dy: number,
  scale = 1,
): void {
  if (!atlasImg?.complete || atlasImg.naturalWidth === 0) return;
  const actor = INDEX.get(id) ?? 0;
  const count = FRAMES[anim];
  const f = ((frame % count) + count) % count;
  const face = ((facing % 8) + 8) % 8;
  const sx = face * CELL;
  const sy = rowOf(actor, anim, f) * CELL;
  // Pixel-snapped draw: one art pixel (2 atlas px) maps to a whole number of
  // screen pixels, at a whole-pixel position. Stops shimmer/twitch from the
  // fractional camera zoom (VIEW_ZOOM) times the sprite scale.
  const m = ctx.getTransform();
  const zoom = Math.hypot(m.a, m.b) || 1;
  const art = Math.max(1, Math.round(2 * zoom * scale));
  const size = (CELL / 2) * art;
  const cx = m.a * dx + m.c * dy + m.e;
  const cy = m.b * dx + m.d * dy + m.f;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlasImg, sx, sy, CELL, CELL, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
  ctx.restore();
}

const ICONS = ["helm", "chest", "arms", "gloves", "legs", "shoes", "sword", "staff", "axe", "bow"] as const;

let iconSheet: HTMLCanvasElement | null = null;

export function ensureIcons(): HTMLCanvasElement {
  if (iconSheet) return iconSheet;
  const c = document.createElement("canvas");
  c.width = ICONS.length * 16;
  c.height = 16;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.imageSmoothingEnabled = false;
  ICONS.forEach((name, i) => drawIcon(ctx, name, i * 16, 0, 16));
  iconSheet = c;
  return c;
}

export function drawIcon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size = 16): void {
  if (iconImg?.complete && iconImg.naturalWidth > 0) {
    const i = ICONS.indexOf(name as (typeof ICONS)[number]);
    if (i >= 0) {
      const col = i % 5;
      const row = Math.floor(i / 5);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(iconImg, col * 64, row * 64, 64, 64, x, y, size, size);
      return;
    }
  }
  const sheet = iconSheet;
  if (sheet && size === 16) {
    const i = ICONS.indexOf(name as (typeof ICONS)[number]);
    if (i >= 0) {
      ctx.drawImage(sheet, i * 16, 0, 16, 16, x, y, size, size);
      return;
    }
  }
  ctx.fillStyle = "#e0b15a";
  if (name === "helm") {
    ctx.fillRect(x + 4, y + 4, 8, 6);
    ctx.fillRect(x + 3, y + 9, 10, 3);
  } else if (name === "chest") {
    ctx.fillRect(x + 4, y + 3, 8, 10);
    ctx.fillStyle = "#3ec8e8";
    ctx.fillRect(x + 7, y + 6, 2, 2);
  } else if (name === "arms") {
    ctx.fillRect(x + 3, y + 4, 3, 8);
    ctx.fillRect(x + 10, y + 4, 3, 8);
  } else if (name === "gloves") {
    ctx.fillRect(x + 3, y + 6, 4, 6);
    ctx.fillRect(x + 9, y + 6, 4, 6);
  } else if (name === "legs") {
    ctx.fillRect(x + 4, y + 3, 3, 10);
    ctx.fillRect(x + 9, y + 3, 3, 10);
  } else if (name === "shoes") {
    ctx.fillRect(x + 3, y + 8, 4, 4);
    ctx.fillRect(x + 9, y + 8, 4, 4);
  } else if (name === "sword") {
    ctx.fillRect(x + 7, y + 2, 2, 9);
    ctx.fillRect(x + 5, y + 10, 6, 2);
  } else if (name === "staff") {
    ctx.fillRect(x + 7, y + 4, 2, 10);
    ctx.fillStyle = "#3ec8e8";
    ctx.fillRect(x + 5, y + 2, 6, 4);
  } else if (name === "axe") {
    ctx.fillRect(x + 8, y + 3, 2, 11);
    ctx.fillRect(x + 4, y + 3, 6, 4);
  } else {
    ctx.strokeStyle = "#e0b15a";
    ctx.beginPath();
    ctx.arc(x + 6, y + 8, 4, Math.PI * 0.8, Math.PI * 1.7);
    ctx.stroke();
  }
}

export function iconURL(name: string): string {
  if (iconImg?.complete && iconImg.naturalWidth > 0) {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.imageSmoothingEnabled = false;
    const i = Math.max(0, ICONS.indexOf(name as (typeof ICONS)[number]));
    ctx.drawImage(iconImg, (i % 5) * 64, Math.floor(i / 5) * 64, 64, 64, 0, 0, 32, 32);
    return c.toDataURL();
  }
  ensureIcons();
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = false;
  const sheet = ensureIcons();
  const i = Math.max(0, ICONS.indexOf(name as (typeof ICONS)[number]));
  ctx.drawImage(sheet, i * 16, 0, 16, 16, 0, 0, 32, 32);
  return c.toDataURL();
}

/** Floor detail overlay: 1 canvas px = FLOOR_DETAIL_PX world px. */
export const FLOOR_DETAIL_PX = 3;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
let detailCache: { key: string; canvas: HTMLCanvasElement } | null = null;

/**
 * Irregular seeded detail patches: blobs grown 2-4 cells from mulberry32(seed), each a union of jittered
 * circles, edged by a hard 3-band ordered dither (100% / 50% / 25%). Opaque pixels only, no alpha, no AA.
 * Built once per seed+biome so the map is identical every load. Returns null until the art has loaded.
 */
export function floorDetail(seed: number, biome: string, arena: number, cell: number, skip: (x: number, y: number) => boolean, rate: number): HTMLCanvasElement | null {
  const key = `${seed}:${biome}`;
  if (detailCache?.key === key) return detailCache.canvas;
  const img = floorDetailImg[biome];
  if (typeof document === "undefined" || !img?.complete || img.naturalWidth === 0) return null;
  const src = document.createElement("canvas");
  src.width = img.naturalWidth;
  src.height = img.naturalHeight;
  const sctx = src.getContext("2d");
  if (!sctx) return null;
  sctx.drawImage(img, 0, 0);
  const sd = sctx.getImageData(0, 0, src.width, src.height).data;
  const P = FLOOR_DETAIL_PX;
  const n = Math.ceil(arena / P);
  const cpx = cell / P; // art px per cell (16)
  const cells = Math.ceil(arena / cell);
  const level = new Uint8Array(n * n);
  const varOf = new Uint16Array(n * n); // variant*256 + offset seed
  const rng = mulberry32((seed ^ 0x5eed) >>> 0);
  const blobs = Math.round((cells * cells * rate) / 3);
  for (let b = 0; b < blobs; b++) {
    let cx = Math.floor(rng() * cells);
    let cy = Math.floor(rng() * cells);
    const size = 2 + Math.floor(rng() * 3);
    const tag = (Math.floor(rng() * FLOOR_VARIANTS) << 8) | Math.floor(rng() * 256);
    const parts: [number, number, number][] = [];
    for (let k = 0; k < size; k++) {
      parts.push([(cx + 0.2 + rng() * 0.6) * cpx, (cy + 0.2 + rng() * 0.6) * cpx, cpx * (0.55 + rng() * 0.3)]);
      const dir = Math.floor(rng() * 4);
      cx += dir === 0 ? 1 : dir === 1 ? -1 : 0;
      cy += dir === 2 ? 1 : dir === 3 ? -1 : 0;
    }
    for (const [ox, oy, r] of parts) {
      const R = r + 3;
      for (let y = Math.max(0, Math.floor(oy - R)); y < Math.min(n, Math.ceil(oy + R)); y++) {
        for (let x = Math.max(0, Math.floor(ox - R)); x < Math.min(n, Math.ceil(ox + R)); x++) {
          // Coarse 3x3-px jitter keeps the rim organic without single-pixel noise.
          const j = (hash2(seed ^ 0x7a11, Math.floor(x / 3), Math.floor(y / 3)) - 0.5) * 5;
          const s = r + j - Math.hypot(x + 0.5 - ox, y + 0.5 - oy);
          const lv = s > 5 ? 3 : s > 2.5 ? 2 : s > 0 ? 1 : 0;
          const i = y * n + x;
          if (lv > level[i]) {
            level[i] = lv;
            varOf[i] = tag;
          }
        }
      }
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const out = ctx.createImageData(n, n);
  const od = out.data;
  const sw = src.width;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const lv = level[i];
      if (!lv) continue;
      const t = BAYER4[(y & 3) * 4 + (x & 3)];
      if (lv === 2 && t >= 8) continue;
      if (lv === 1 && t >= 4) continue;
      if (skip(x * P + 1, y * P + 1)) continue;
      const tag = varOf[i];
      const v = tag >> 8;
      const off = tag & 255;
      const u = (x + off) % 16;
      const w = (y + (off >> 4)) % 16;
      const si = (w * sw + v * 16 + u) * 4;
      if (sd[si + 3] < 128) continue;
      od[i * 4] = sd[si];
      od[i * 4 + 1] = sd[si + 1];
      od[i * 4 + 2] = sd[si + 2];
      od[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  detailCache = { key, canvas };
  return canvas;
}

// Reused ground props (tools/build_props.py): crystals, gravestones, glowing mushrooms, ruins.
const propSheet = typeof Image === "undefined" ? undefined : Object.assign(new Image(), { src: `${import.meta.env.BASE_URL}game/sprites/props.png?v=1` });

/** Draw the reused prop for a boulder at (x, y) with collision radius r; base sits on the circle's foot. */
/** Draws one named prop-sheet sprite standing on (x, y) with a pulsing glow (rift shrines). */
export function drawNamedProp(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, glow: string, pulse: number): boolean {
  if (!propSheet?.complete || propSheet.naturalWidth === 0) return false;
  const a = PROP_ART.find((p) => p.name === name);
  if (!a) return false;
  const t = ctx.getTransform();
  const sx = Math.round(t.a * x + t.e);
  const sy = Math.round(t.d * y + t.f);
  const w = a.w * a.k, hh = a.h * a.k;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(sx, sy - 1, w * 0.42, Math.max(2, w * 0.12), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 10 + pulse * 10;
  ctx.drawImage(propSheet, a.x, a.y, a.w, a.h, sx - Math.floor(w / 2), sy - hh, w, hh);
  ctx.restore();
  return true;
}

export function drawGroundProp(ctx: CanvasRenderingContext2D, biome: string, x: number, y: number, r: number): boolean {
  if (!propSheet?.complete || propSheet.naturalWidth === 0) return false;
  const cls = r < 22 ? "s" : "l";
  let pool = PROP_ART.filter((p) => p.cls === cls && p.biomes.includes(biome));
  if (!pool.length) pool = PROP_ART.filter((p) => p.biomes.includes(biome));
  if (!pool.length) return false;
  const h = (Math.imul(Math.round(x) * 73856093 ^ Math.round(y) * 19349663, 2654435761) >>> 0) % pool.length;
  const a = pool[h];
  const t = ctx.getTransform();
  const sx = Math.round(t.a * x + t.e);
  const sy = Math.round(t.d * (y + r * 0.5) + t.f);
  const w = a.w * a.k, hh = a.h * a.k;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(sx, sy - 1, w * 0.42, Math.max(2, w * 0.12), 0, 0, Math.PI * 2);
  ctx.fill();
  if (a.glow) { ctx.shadowColor = a.glow; ctx.shadowBlur = 12; }
  ctx.drawImage(propSheet, a.x, a.y, a.w, a.h, sx - Math.floor(w / 2), sy - hh, w, hh);
  ctx.restore();
  return true;
}
