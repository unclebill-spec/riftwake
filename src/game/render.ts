import { ARENA_SIZE, BUFFS, ELITE_MOVE, SHRINE, SURGE, IMPACT_TIME, NUM_TIME, PLUS_TIME, TWIST, type Game } from "@/game/sim";
import {
  blit,
  drawFloorTile,
  floorDetail,
  FLOOR_DETAIL_PX,
  drawIcon,
  drawPropSprite,
  drawGroundProp,
  drawNamedProp,
  ensureIcons,
  FLOOR_VARIANT_RATE,
  SPECIAL_KINDS,
  blitBoss,
  hasBoss,
  drawSpell,
  drawSpellBeam,
  drawImpact,
  drawAura,
  spellReady,
  drawGround,
} from "@/game/sprites";
import { hash2 } from "@/game/rng";
import type { ShotType } from "@/game/types";
import { monsterName } from "@/game/types";
import { DROP_HALO_WORLD, DROP_ICON_WORLD, GEAR_HEX, POWER_GLYPH, POWER_HEX, powerKey } from "@/game/drops";

const TILE = 48;
/** World drawn smaller so more of the rift fits on screen. */
export const VIEW_ZOOM = 0.58;
const SHOT: Record<ShotType, string> = {
  bolt: "rgba(94,242,255,0.95)",
  beam: "rgba(255,74,216,0.95)",
  wave: "rgba(180,107,255,0.92)",
  fire: "rgba(255,122,41,0.95)",
  ice: "rgba(215,244,255,0.95)",
  water: "rgba(46,224,192,0.95)",
};

const glows = new Map<string, HTMLCanvasElement>();
const sortBuf: { y: number; k: number; i: number }[] = Array.from({ length: 420 }, () => ({ y: 0, k: 0, i: 0 }));

function glow(color: string): HTMLCanvasElement {
  const hit = glows.get(color);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glows.set(color, c);
  return c;
}

function light(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha = 1): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  ctx.drawImage(glow(color), x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

const FLOOR: Record<Game["biome"], string[]> = {
  rock: ["#14171e", "#171b22", "#1a1e26", "#12151b"],
  forest: ["#101610", "#141c14", "#182018", "#0e140e"],
  snow: ["#222830", "#262d36", "#2a323b", "#1e242c"],
  ice: ["#152028", "#18242e", "#1c2a34", "#121c24"],
  lava: ["#1a1210", "#201614", "#261a16", "#140e0c"],
};

export function renderGame(game: Game, ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0c0e12";
  ctx.fillRect(0, 0, w, h);
  if (game.mode === "menu") {
    drawMenu(ctx, w, h, now);
    return;
  }
  const shake = game.shake;
  const sx = Math.sin(now * 0.04) * shake;
  const sy = Math.cos(now * 0.033) * shake;
  const worldW = w / VIEW_ZOOM;
  const worldH = h / VIEW_ZOOM;
  ctx.save();
  ctx.translate(w / 2 + sx, h / 2 + sy);
  ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
  ctx.translate(-game.camX, -game.camY);
  drawFloor(game, ctx, worldW, worldH);
  // Ground telegraphs (elite moves, shot rain) sit under every actor sprite so they never tint the hero.
  for (let i = 0; i < game.emove.length; i++) {
    const m = game.emove[i];
    const e = game.enemies[i];
    if (!m?.kind || !e?.alive) continue;
    // Elite move telegraph: filled marker plus a closing ring that meets it when the move lands.
    const k = Math.max(0, m.t / ELITE_MOVE.windup);
    const r = m.kind === "slam" ? ELITE_MOVE.slamR : e.radius + 26;
    ctx.strokeStyle = m.kind === "slam" ? "rgba(255,150,40,0.95)" : "rgba(255,70,200,0.95)";
    ctx.fillStyle = m.kind === "slam" ? `rgba(255,120,30,${0.12 + (1 - k) * 0.18})` : `rgba(255,70,200,${0.1 + (1 - k) * 0.15})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r + k * 60, 0, Math.PI * 2);
    ctx.stroke();
    if (m.kind === "volley") {
      const off = ((m.n - 1) % 2) * (Math.PI / ELITE_MOVE.volleyN);
      ctx.beginPath();
      for (let j = 0; j < ELITE_MOVE.volleyN; j++) {
        const a = off + (j / ELITE_MOVE.volleyN) * Math.PI * 2;
        ctx.moveTo(m.x + Math.cos(a) * r, m.y + Math.sin(a) * r);
        ctx.lineTo(m.x + Math.cos(a) * (r + 46), m.y + Math.sin(a) * (r + 46));
      }
      ctx.stroke();
    }
  }
  for (const r of game.rain) {
    if (!r.alive) continue;
    // Shot-rain telegraph: fixed hit circle plus a closing ring (lands when they meet).
    const k = Math.max(0, r.t / TWIST.rainWarn);
    ctx.strokeStyle = "rgba(255,70,60,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, TWIST.rainR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r.x, r.y, TWIST.rainR + k * 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,70,60,0.18)";
    ctx.beginPath();
    ctx.arc(r.x, r.y, TWIST.rainR, 0, Math.PI * 2);
    ctx.fill();
  }
  let n = 0;
  const push = (y: number, k: number, i: number) => {
    const slot = sortBuf[n];
    if (!slot) return;
    slot.y = y;
    slot.k = k;
    slot.i = i;
    n += 1;
  };
  for (let i = 0; i < game.props.length && n < 400; i++) {
    const p = game.props[i];
    if (!p || !onscreen(game, p.x, p.y, worldW, worldH, 80)) continue;
    push(p.y, 0, i);
  }
  for (let i = 0; i < game.drops.length && n < 410; i++) {
    const d = game.drops[i];
    if (!d?.alive || !onscreen(game, d.x, d.y, worldW, worldH, 40)) continue;
    push(d.y, 2, i);
  }
  push(game.portal.y, 4, 0);
  if (game.shrine.alive && onscreen(game, game.shrine.x, game.shrine.y, worldW, worldH, 80)) push(game.shrine.y, 5, 0);
  for (let i = 0; i < game.enemies.length && n < 418; i++) {
    const e = game.enemies[i];
    if (!e?.alive || !onscreen(game, e.x, e.y, worldW, worldH, 80)) continue;
    push(e.y, 1, i);
  }
  push(game.player.y, 3, 0);
  for (let i = n; i < sortBuf.length; i++) {
    const spare = sortBuf[i];
    if (spare) spare.y = 1e9;
  }
  sortBuf.sort((a, b) => a.y - b.y);
  for (let i = 0; i < n; i++) {
    const item = sortBuf[i];
    if (!item || item.y > 1e8) break;
    if (item.k === 0) drawProp(ctx, game.props[item.i], game.biome);
    else if (item.k === 2) drawDrop(ctx, game, item.i, now);
    else if (item.k === 4) drawPortal(ctx, game, now);
    else if (item.k === 5) drawShrine(ctx, game, now);
    else if (item.k === 1) drawEnemy(ctx, game, item.i);
    else drawHero(ctx, game);
  }
  const dark = game.twist === "dark";
  if (dark) {
    // Darkness twist: dim the world except a clear pool around the hero, then redraw every
    // on-screen monster on top (dimmed, with a 1 px neon rim) so they still read as monsters.
    const g = ctx.createRadialGradient(game.player.x, game.player.y, DARK.clearR, game.player.x, game.player.y, DARK.fadeR);
    g.addColorStop(0, "rgba(2,3,10,0)");
    g.addColorStop(1, `rgba(2,3,10,${DARK.alpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(game.camX - worldW / 2 - 40, game.camY - worldH / 2 - 40, worldW + 80, worldH + 80);
    for (const e of game.enemies) {
      if (!e.alive || !onscreen(game, e.x, e.y, worldW, worldH, 80)) continue;
      const d = Math.hypot(e.x - game.player.x, e.y - game.player.y);
      if (d < DARK.clearR) continue;
      ctx.save();
      ctx.filter = e.elite ? "brightness(0) invert(1) sepia(1) saturate(4)" : "brightness(0) invert(1) sepia(1) saturate(6) hue-rotate(270deg)";
      ctx.globalAlpha = 0.85;
      for (const [ox, oy] of RIM) {
        ctx.translate(ox, oy);
        drawEnemyBody(ctx, game, e, true);
        ctx.translate(-ox, -oy);
      }
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = DARK.spriteAlpha;
      drawEnemyBody(ctx, game, e, true);
      ctx.restore();
    }
  }
  if (game.surgeFx > 0) {
    // Rift Surge shockwave: expanding neon ring from the hero (cosmetic).
    const k = 1 - game.surgeFx / SURGE.fxTime;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = "#9fe8ff";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(game.player.x, game.player.y, 40 + k * SURGE.reachX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalCompositeOperation = "lighter";
  if (dark) {
    light(ctx, game.player.x, game.player.y, 120, "#9fd8ff", 0.3);
    if (game.shrine.alive) light(ctx, game.shrine.x, game.shrine.y - 20, 60, BUFFS[game.shrine.kind].color, 0.6);
    for (const e of game.enemies) {
      if (!e.alive || !onscreen(game, e.x, e.y, worldW, worldH, 60)) continue;
      light(ctx, e.x, e.y, e.elite ? 56 : 26, e.elite ? "#ffd27a" : "#ff4fa8", 0.35);
    }
  }
  const spellFrame = Math.floor(now / 80) & 7;
  const spells = spellReady();
  for (const b of game.beams) {
    if (!b.alive) continue;
    ctx.globalAlpha = Math.max(0.3, b.life / 0.12);
    drawSpellBeam(ctx, b.x, b.y, Math.atan2(b.dy, b.dx), b.len, spellFrame, 2);
    light(ctx, b.x + b.dx * b.len * 0.5, b.y + b.dy * b.len * 0.5, 36, SHOT.beam, 0.8);
  }
  for (const p of game.projs) {
    if (!p.alive) continue;
    const color = p.friendly ? SHOT[p.type] : "rgba(255,70,60,0.95)";
    const r = p.type === "wave" ? 46 : p.type === "beam" ? 18 : p.type === "fire" ? 28 : 22;
    light(ctx, p.x, p.y, r, color, 1);
    // Reused HM/KQ spell art only (no old Riftwake shot art or streak fallback), 2 screen px per art px.
    if (spells) drawSpell(ctx, p.friendly ? p.type : "enemy", p.x, p.y, Math.atan2(p.vy, p.vx), spellFrame, 2);
  }
  ctx.globalAlpha = 1;
  for (const f of game.impacts) {
    if (!f.alive) continue;
    const t = f.t / IMPACT_TIME;
    light(ctx, f.x, f.y, 40, f.type === "enemy" ? "rgba(255,70,60,0.95)" : SHOT[f.type], 1 - t);
    drawImpact(ctx, f.type, f.x, f.y, t, 2);
  }
  for (const p of game.parts) {
    if (!p.alive) continue;
    if (p.hard) {
      // Hard pixels: snapped squares, stepped fade (no smooth alpha ramp).
      const t = p.life / p.max;
      const s = Math.round(p.size * 2 * (t > 0.5 ? 1 : 0.75));
      ctx.globalAlpha = t > 0.5 ? 1 : 0.6;
      ctx.fillStyle = "#14161c";
      ctx.fillRect(Math.round(p.x - s / 2) - 2, Math.round(p.y - s / 2) - 2, s + 4, s + 4);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
      continue;
    }
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    light(ctx, p.x, p.y, 8 + p.size, p.color, 0.8);
  }
  drawNums(ctx, game);
  ctx.restore();
  vignette(ctx, w, h);
  if (game.player.hurtCd > 0.5) {
    ctx.fillStyle = "rgba(180, 40, 32, 0.16)";
    ctx.fillRect(0, 0, w, h);
  }
  if (game.player.rage > 0) {
    ctx.strokeStyle = "rgba(224,177,90,0.7)";
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, w - 16, h - 16);
  }
  if (game.wave >= 5) drawArrow(ctx, game, w, h);
}

function drawMenu(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
  for (let i = 0; i < 7; i++) {
    const colors = [SHOT.bolt, SHOT.beam, SHOT.wave, SHOT.fire, SHOT.ice, SHOT.water, SHOT.bolt];
    const x = ((now * 0.04 + i * 180) % (w + 160)) - 80;
    const y = h * 0.35 + Math.sin(now * 0.001 + i) * 80 + i * 18;
    light(ctx, x, y, 28, colors[i] ?? SHOT.bolt, 0.7);
  }
}


function drawFloor(game: Game, ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const colors = FLOOR[game.biome];
  const x0 = Math.floor((game.camX - w / 2) / TILE) - 1;
  const y0 = Math.floor((game.camY - h / 2) / TILE) - 1;
  const x1 = Math.floor((game.camX + w / 2) / TILE) + 2;
  const y1 = Math.floor((game.camY + h / 2) / TILE) + 2;
  // Reused Hearthmoor ground (dark neon recolour): one seamless texture, lava cells in the hot variant.
  const gx = Math.max(0, x0 * TILE);
  const gy = Math.max(0, y0 * TILE);
  const gw = Math.min(ARENA_SIZE, (x1 + 1) * TILE) - gx;
  const gh = Math.min(ARENA_SIZE, (y1 + 1) * TILE) - gy;
  if (gw > 0 && gh > 0 && drawGround(ctx, game.biome, gx, gy, gw, gh, 3)) {
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const px = cx * TILE;
        const py = cy * TILE;
        if (px < 0 || py < 0 || px >= ARENA_SIZE || py >= ARENA_SIZE) continue;
        if (!game.lavaAt(px + 8, py + 8)) continue;
        drawGround(ctx, "lavaflow", px, py, TILE, TILE, 3);
        light(ctx, px + TILE / 2, py + TILE / 2, 30, "rgba(255,110,40,0.9)", 0.7);
      }
    }
    return;
  }
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const px = cx * TILE;
      const py = cy * TILE;
      if (px < -TILE || py < -TILE || px > ARENA_SIZE || py > ARENA_SIZE) continue;
      const lava = game.lavaAt(px + 8, py + 8);
      const painted = drawFloorTile(ctx, game.biome, px, py, TILE);
      if (!painted) {
        const hsh = hash2(game.seed, cx, cy);
        ctx.fillStyle = lava ? "#4a1c10" : (colors[Math.floor(hsh * 3) % colors.length] ?? "#14171e");
        ctx.fillRect(px, py, TILE, TILE);
        const n2 = hash2(game.seed ^ 91, cx, cy);
        ctx.fillStyle = lava ? "#6a2814" : (colors[Math.floor(n2 * colors.length)] ?? "#171b22");
        ctx.fillRect(px + (n2 > 0.5 ? 6 : 22), py + 8, 14, 8);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        if (hsh > 0.84) ctx.fillRect(px + 6, py + 22, 12, 2);
      }
      if (lava) light(ctx, px + TILE / 2, py + TILE / 2, 30, "rgba(255,110,40,0.9)", 0.7);
    }
  }
  // Reused Gravewake stone texture in irregular seeded blobs with a hard dither rim (no tile edges).
  const det = floorDetail(game.seed, game.biome, ARENA_SIZE, TILE, (x, y) => game.lavaAt(x, y), FLOOR_VARIANT_RATE);
  if (det) {
    const P = FLOOR_DETAIL_PX;
    const sx = Math.max(0, x0 * TILE / P);
    const sy = Math.max(0, y0 * TILE / P);
    const sw = Math.min(det.width - sx, ((x1 - x0 + 1) * TILE) / P);
    const sh = Math.min(det.height - sy, ((y1 - y0 + 1) * TILE) / P);
    if (sw > 0 && sh > 0) ctx.drawImage(det, sx, sy, sw, sh, sx * P, sy * P, sw * P, sh * P);
  }
}

function drawProp(ctx: CanvasRenderingContext2D, prop: { x: number; y: number; r: number; kind: "tree" | "boulder" } | undefined, biome = "rock"): void {
  if (!prop) return;
  if (prop.kind === "boulder" && drawGroundProp(ctx, biome, prop.x, prop.y, prop.r)) return;
  if (drawPropSprite(ctx, prop.kind, prop.x, prop.y, prop.r * 2.4)) return;
  if (prop.kind === "tree") {
    ctx.fillStyle = "#2a2118";
    ctx.fillRect(prop.x - 3, prop.y - 4, 6, 16);
    ctx.fillStyle = "#1a2a18";
    ctx.beginPath();
    ctx.arc(prop.x, prop.y - 10, prop.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#10160f";
    ctx.stroke();
  } else {
    ctx.fillStyle = "#3a404a";
    ctx.beginPath();
    ctx.ellipse(prop.x, prop.y, prop.r, prop.r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a5260";
    ctx.beginPath();
    ctx.ellipse(prop.x - 3, prop.y - 3, prop.r * 0.45, prop.r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDrop(ctx: CanvasRenderingContext2D, game: Game, index: number, now: number): void {
  const d = game.drops[index];
  if (!d) return;
  const bob = Math.sin(now * 0.005 + index) * 3;
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.006 + index * 1.7);
  const key = powerKey(d);
  const color = key ? POWER_HEX[key] : GEAR_HEX;
  const size = DROP_ICON_WORLD;
  const cy = d.y - size * 0.55 + bob;
  // Ground halo.
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.25 * pulse;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(d.x, d.y + 2, DROP_HALO_WORLD * (0.9 + 0.1 * pulse), DROP_HALO_WORLD * 0.4, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  // Soft pulsing glow.
  light(ctx, d.x, cy, size * (0.85 + 0.25 * pulse), color, 0.75 + 0.2 * pulse);
  ctx.save();
  if (key) {
    // Power-up: neon orb with a glyph.
    const r = size * 0.42;
    ctx.fillStyle = "#0c0e12";
    ctx.beginPath();
    ctx.arc(d.x, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(r * 1.25)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(POWER_GLYPH[key], d.x, cy + 1);
  } else {
    // Gear / weapon: framed gold plate with its item icon.
    const half = size * 0.5;
    ctx.fillStyle = "#1a140c";
    ctx.fillRect(d.x - half, cy - half, size, size);
    ctx.lineWidth = 3;
    ctx.strokeStyle = GEAR_HEX;
    ctx.strokeRect(d.x - half, cy - half, size, size);
    const icon = d.kind === "gear" && d.gear ? d.gear.slot : d.weapon ? d.weapon.kind : "helm";
    ensureIcons();
    drawIcon(ctx, icon, d.x - half + 4, cy - half + 4, size - 8);
  }
  ctx.restore();
}

function drawPortal(ctx: CanvasRenderingContext2D, game: Game, now: number): void {
  const p = game.portal;
  ctx.fillStyle = "#2a2430";
  ctx.fillRect(p.x - 34, p.y - 48, 68, 64);
  ctx.fillStyle = "#3a3344";
  ctx.fillRect(p.x - 28, p.y - 56, 56, 12);
  const pulse = 0.55 + Math.sin(now * 0.004) * 0.15;
  light(ctx, p.x, p.y - 10, game.wave >= 5 ? 48 : 30, "rgba(180,90,255,0.9)", pulse);
  ctx.fillStyle = game.wave >= 5 ? "#1a1024" : "#120e16";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 8, 16, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ebe6da";
  ctx.font = "12px Outfit, sans-serif";
  ctx.textAlign = "center";
  if (game.wave < 5) ctx.fillText("Sealed", p.x, p.y - 64);
  else {
    const ratio = Math.max(0, p.hp / p.maxHp);
    ctx.fillStyle = "#1a140c";
    ctx.fillRect(p.x - 28, p.y - 70, 56, 5);
    ctx.fillStyle = "#c46bff";
    ctx.fillRect(p.x - 28, p.y - 70, 56 * ratio, 5);
  }
}

function drawEnemy(ctx: CanvasRenderingContext2D, game: Game, index: number): void {
  const e = game.enemies[index];
  if (!e) return;
  drawEnemyBody(ctx, game, e, false);
  if (e.flash > 0) {
    // White hit flash: same sprite redrawn as a solid white silhouette (hard alpha kept).
    ctx.save();
    ctx.filter = "brightness(0) invert(1)";
    ctx.globalAlpha = 0.9;
    drawEnemyBody(ctx, game, e, true);
    ctx.restore();
  }
  drawEnemyExtras(ctx, game, e);
}

function drawEnemyBody(ctx: CanvasRenderingContext2D, game: Game, e: Game["enemies"][number], flat: boolean): void {
  const scale = e.elite ? 3 : 1.35;
  const zoom = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;
  const boss = (e.elite || SPECIAL_KINDS.has(e.kind)) && hasBoss(e.kind);
  // Boss art from Will's other games; feet sit a little below the body centre, like the atlas sprites.
  const feet = e.y + e.radius * 0.7;
  if (boss && e.elite) {
    ctx.save();
    ctx.shadowColor = "#e0b15a";
    ctx.shadowBlur = flat ? 0 : 14;
    blitBoss(ctx, e.kind, e.anim, e.facing, e.frame, e.x, feet, Math.max(2, Math.round(zoom * 5.2)), true);
    ctx.restore();
  } else if (boss) {
    blitBoss(ctx, e.kind, e.anim, e.facing, e.frame, e.x, feet, Math.max(1, Math.round(zoom * 3.4)), false);
  } else if (e.elite) {
    ctx.save();
    ctx.shadowColor = "#e0b15a";
    ctx.shadowBlur = flat ? 0 : 14;
    blit(ctx, e.kind, e.anim, e.facing, e.frame, e.x, e.y, scale);
    ctx.restore();
  } else if (flat) {
    blit(ctx, e.kind, e.anim, e.facing, e.frame, e.x, e.y, scale);
  } else {
    // Readability: faint cool dark-neon under-glow so small brown/grey grunts separate from the floor's crack lines.
    ctx.save();
    ctx.shadowColor = "rgba(70, 225, 255, 0.55)";
    ctx.shadowBlur = 5;
    blit(ctx, e.kind, e.anim, e.facing, e.frame, e.x, e.y, scale);
    ctx.restore();
  }
}

function drawEnemyExtras(ctx: CanvasRenderingContext2D, game: Game, e: Game["enemies"][number]): void {
  const zoom = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;
  const boss = (e.elite || SPECIAL_KINDS.has(e.kind)) && hasBoss(e.kind);
  const feet = e.y + e.radius * 0.7;
  if (e.elite) {
    ctx.fillStyle = "#ebe6da";
    ctx.font = "12px Outfit, sans-serif";
    ctx.textAlign = "center";
    // Boss elites: label just above the tallest boss cell (37 art px of 44 above the feet).
    const labelY = boss ? feet - (38 * Math.max(2, Math.round(zoom * 5.2))) / zoom - 4 : e.y - 58 * 1.6;
    ctx.fillText(`Elite ${monsterName(e.kind)}`, e.x, labelY);
  }
  if (e.telegraph > 0) {
    ctx.strokeStyle = "rgba(210,70,60,0.7)";
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(game.player.x, game.player.y);
    ctx.stroke();
  }
}

function drawHero(ctx: CanvasRenderingContext2D, game: Game): void {
  const p = game.player;
  if (p.rage > 0) {
    light(ctx, p.x, p.y, 36, "rgba(224,177,90,0.85)", 0.7);
    drawAura(ctx, p.x, p.y + 4, Math.floor(performance.now() / 80), 2);
  }
  const anim = p.jumpT > 0 ? "jump" : "walk";
  const frame = anim === "walk" ? p.frame : Math.min(3, Math.floor((0.35 - p.jumpT) * 12));
  blit(ctx, p.actor, anim, p.facing, frame, p.x, p.y, 1.35);
  if (game.plusT > 0) drawPlus(ctx, p.x, p.y - 54, game.plusT / PLUS_TIME);
}

/** Short gold '+' over the hero's head after an auto-equip upgrade: rises ~20 world px and fades. */
function drawShrine(ctx: CanvasRenderingContext2D, game: Game, now: number): void {
  const s = game.shrine;
  const b = BUFFS[s.kind];
  const pulse = 0.5 + 0.5 * Math.sin(now / 220);
  const blink = s.t < 4 && Math.floor(now / 150) % 2 === 0;
  ctx.save();
  ctx.globalAlpha = blink ? 0.45 : 1;
  ctx.strokeStyle = b.color;
  ctx.lineWidth = 2;
  ctx.globalAlpha *= 0.5 + pulse * 0.4;
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, SHRINE.touchR + 6, (SHRINE.touchR + 6) * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  if (blink) ctx.globalAlpha = 0.6;
  if (!drawNamedProp(ctx, b.art, s.x, s.y, b.color, pulse)) {
    ctx.fillStyle = b.color;
    ctx.fillRect(s.x - 8, s.y - 40, 16, 40);
  }
  ctx.restore();
}

/** Darkness twist look (BALANCE.md): clear pool around the hero, dim beyond, monsters redrawn with a neon rim. */
const DARK = { clearR: 120, fadeR: 200, alpha: 0.62, spriteAlpha: 0.8 };
const RIM: [number, number][] = [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]];

/** Damage-number pops: quick scale-up then rise and step-fade (no smooth ramp). */
function drawNums(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.textAlign = "center";
  for (const n of game.nums) {
    if (!n.alive) continue;
    const t = n.t / NUM_TIME;
    const size = n.v === 0 ? 22 : n.v >= 40 ? 21 : 16;
    const pop = t < 0.15 ? 1.35 : 1;
    ctx.font = `bold ${Math.round(size * pop)}px Outfit, sans-serif`;
    ctx.globalAlpha = t > 0.7 ? 0.55 : 1;
    const x = Math.round(n.x);
    const y = Math.round(n.y);
    ctx.fillStyle = "#14161c";
    ctx.fillText(n.text, x + 1, y + 1);
    ctx.fillText(n.text, x - 1, y + 1);
    ctx.fillStyle = n.color;
    ctx.fillText(n.text, x, y);
  }
  ctx.globalAlpha = 1;
}

function drawPlus(ctx: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  const t = 1 - k;
  ctx.save();
  ctx.globalAlpha = Math.min(1, k * 2.2);
  ctx.font = "bold 34px Outfit, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#14161c";
  const yy = Math.round(y - t * 20);
  ctx.strokeText("+", Math.round(x), yy);
  ctx.fillStyle = "#e0b15a";
  ctx.fillText("+", Math.round(x), yy);
  ctx.restore();
}

function vignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.62);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawArrow(ctx: CanvasRenderingContext2D, game: Game, w: number, h: number): void {
  const sx = (game.portal.x - game.camX) * VIEW_ZOOM + w / 2;
  const sy = (game.portal.y - game.camY) * VIEW_ZOOM + h / 2;
  if (sx > 24 && sy > 24 && sx < w - 24 && sy < h - 24) return;
  const ang = Math.atan2(game.portal.y - game.player.y, game.portal.x - game.player.x);
  const cx = w / 2 + Math.cos(ang) * Math.min(w, h) * 0.4;
  const cy = h / 2 + Math.sin(ang) * Math.min(w, h) * 0.34;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.fillStyle = "#c46bff";
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-8, 7);
  ctx.lineTo(-8, -7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function onscreen(game: Game, x: number, y: number, w: number, h: number, pad: number): boolean {
  return Math.abs(x - game.camX) < w / 2 + pad && Math.abs(y - game.camY) < h / 2 + pad;
}
