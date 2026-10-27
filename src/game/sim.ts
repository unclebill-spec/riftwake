import { AudioBus } from "@/game/audio";
import {
  ARENA,
  DIFF,
  HERO,
  PORTAL_HP,
  PORTAL_HP_WAVE,
  PORTAL_REGEN,
  PORTAL_REGEN_WAVE,
  freshMods,
  makeGear,
  makeWeapon,
} from "@/game/balance";
import { dirFromYaw, facingHeld, hash2, mulberry32, yawFromVelocity } from "@/game/rng";
import { loadRun, saveRun } from "@/game/save";
import {
  GHOSTLIKE,
  HOPPERS,
  MONSTERS,
  RANGED,
  SHOTS,
  SLOTS,
  emptyGear,
  monsterName,
  type ActorId,
  type Beam,
  type Binds,
  type Drop,
  type Enemy,
  type HeroId,
  type Hud,
  type Mode,
  type MonsterId,
  type Part,
  type Proj,
  type Prop,
  type RunSave,
  type Settings,
  type ShotType,
  type Slot,
  type WeaponKind,
} from "@/game/types";

const MAX_E = 72;
const MAX_P = 200;
const MAX_D = 28;
const MAX_PART = 160;
const MAX_B = 12;
const CELL = 96;
const MAX_FX = 40;
/** Seconds an impact burst plays (render-only; never touches combat timing). */
export const IMPACT_TIME = 0.42;

/** Cosmetic spell impact burst (transient, never saved, no RNG use so sims stay deterministic). */
export type Impact = { alive: boolean; x: number; y: number; type: ShotType | "enemy"; t: number };

function makeEnemy(): Enemy {
  return {
    alive: false,
    kind: "skeleton",
    x: 0,
    y: 0,
    hp: 0,
    maxHp: 0,
    speed: 0,
    radius: 14,
    damage: 0,
    elite: false,
    slow: 0,
    burn: 0,
    kx: 0,
    ky: 0,
    flash: 0,
    hitCd: 0,
    shotCd: 1,
    telegraph: 0,
    anim: "walk",
    frame: 0,
    facing: 4,
    animT: 0,
    hop: 0,
    vx: 0,
    vy: 0,
  };
}

function makeProj(): Proj {
  return {
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    radius: 5,
    damage: 0,
    type: "bolt",
    friendly: true,
    pierce: 0,
    splash: 0,
    h0: -1,
    h1: -1,
    h2: -1,
  };
}

function makeDrop(): Drop {
  return {
    alive: false,
    x: 0,
    y: 0,
    kind: "mod",
    mod: null,
    shot: null,
    gear: null,
    weapon: null,
    grace: 0,
  };
}

function makePart(): Part {
  return { alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, color: "#fff", size: 2 };
}

function makeBeam(): Beam {
  return { alive: false, x: 0, y: 0, dx: 1, dy: 0, len: 10, life: 0, type: "beam" };
}

export class Game {
  readonly audio = new AudioBus();
  readonly enemies: Enemy[] = Array.from({ length: MAX_E }, makeEnemy);
  readonly projs: Proj[] = Array.from({ length: MAX_P }, makeProj);
  readonly drops: Drop[] = Array.from({ length: MAX_D }, makeDrop);
  readonly parts: Part[] = Array.from({ length: MAX_PART }, makePart);
  readonly beams: Beam[] = Array.from({ length: MAX_B }, makeBeam);
  readonly impacts: Impact[] = Array.from({ length: MAX_FX }, () => ({ alive: false, x: 0, y: 0, type: "bolt" as ShotType | "enemy", t: 0 }));
  props: Prop[] = [];
  kinds: MonsterId[] = ["skeleton", "orc", "zombie"];
  biome: "rock" | "forest" | "snow" | "ice" | "lava" = "rock";
  seed = 1;
  level = 1;
  wave = 1;
  mode: Mode = "menu";
  onMode: ((mode: Mode) => void) | null = null;
  settings: Settings;
  hold = false;
  quick = false;

  player = {
    x: 520,
    y: 560,
    vx: 0,
    vy: 0,
    yaw: 0,
    facing: 4,
    hp: 86,
    hero: "wizard" as HeroId,
    fireCd: 0,
    hurtCd: 0,
    rage: 0,
    castT: 0,
    jumpT: 0,
    frame: 0,
    frameT: 0,
    actor: "wizard" as ActorId,
  };

  portal = { x: 3000, y: 3000, hp: PORTAL_HP, maxHp: PORTAL_HP, regen: PORTAL_REGEN, r: 42 };
  camX = 520;
  camY = 560;
  camReady = false;
  shake = 0;
  viewW = 960;
  viewH = 540;
  time = 0;
  kills = 0;
  banner = "";
  bannerT = 0;
  clearedLevel = 1;
  /** Seconds left on the '+' pop over the hero's head after an auto-equip upgrade (transient, never saved). */
  plusT = 0;
  /** Juice (feel only, never saved): seconds of hit-stop left; frame() skips sim steps while > 0. */
  hitStop = 0;
  private comboWordT = 0;
  /** 30-second wave twists (transient, never saved). */
  twist: TwistId | "" = "";
  twistT = 0;
  twistClock = 0;
  twistN = 0;
  private rainT = 0;
  /** Elite boss-move state, parallel to `enemies` (kind "" = idle). */
  readonly emove: { kind: "" | EliteMoveId; cd: number; t: number; x: number; y: number; n: number }[] = Array.from({ length: MAX_E }, () => ({ kind: "" as const, cd: 0, t: 0, x: 0, y: 0, n: 0 }));
  /** Rift shrine (one at a time, own rng so the main stream is untouched) and the timed buff it grants. */
  readonly shrine = { alive: false, x: 0, y: 0, t: 0, kind: "haste" as BuffId };
  shrineClock = 0;
  shrineRng: () => number = mulberry32(1);
  buff: BuffId | "" = "";
  buffT = 0;
  shieldHits = 0;
  /** Rift Surge ultimate meter (0..SURGE.max), filled by kills and combos. */
  surgeMeter = 0;
  /** Seconds left on the cosmetic surge shockwave ring. */
  surgeFx = 0;
  private surgeWas = false;
  readonly rain: { alive: boolean; x: number; y: number; t: number }[] = Array.from({ length: 14 }, () => ({ alive: false, x: 0, y: 0, t: 0 }));
  private lastCombo = "";
  /** Damage-number pops (cosmetic pool). */
  readonly nums: DmgNum[] = Array.from({ length: MAX_NUMS }, () => ({ alive: false, x: 0, y: 0, v: 0, t: 0, color: "#ffffff", text: "" }));

  private run!: RunSave;
  private baseline!: RunSave;
  private rng: () => number = Math.random;
  private keys = new Set<string>();
  private probe: Set<string> | null = null;
  private stick = { x: 0, y: 0, on: false };
  private mouseX = 0;
  private mouseY = 0;
  private mouseInside = false;
  private mouseHot = 0;
  private accum = 0;
  private gap = 0;
  private toSpawn = 0;
  private spawnT = 0;
  private fought = false;
  private eliteLeft = false;
  private diffIndex = 2;
  private pauseWas = false;
  private gw = Math.ceil(ARENA / CELL);
  private buckets: number[][] = [];

  readonly hud: Hud = {
    hp: 86,
    maxHp: 86,
    wave: 1,
    level: 1,
    time: 0,
    type: "bolt",
    speed: 0,
    amount: 0,
    rage: 0,
    sealed: true,
    banner: "",
    weapon: "Unarmed",
    weaponKind: null,
    combo: "",
    twist: "",
    buff: "",
    surge: 0,
    slots: SLOTS.map((slot) => ({ slot, name: "Empty", filled: false })),
    kills: 0,
    portal: 1,
    portalMax: 1,
    showPortal: false,
    px: 0,
    py: 0,
    portalX: 0,
    portalY: 0,
    mode: "menu",
    hero: "wizard",
    clearedLevel: 1,
    diffLabel: "Rift",
  };

  constructor(settings: Settings) {
    this.settings = settings;
    this.run = this.blank(1, 1, "wizard");
    this.baseline = this.run;
    this.buckets = Array.from({ length: this.gw * this.gw }, () => []);
    if (typeof window !== "undefined") {
      this.quick = new URLSearchParams(window.location.search).has("quick");
      if (import.meta.env.DEV) {
        (window as unknown as {
          __riftwake?: {
            killPortal: () => void;
            kills: () => number;
            enemies: () => number;
            debug: () => unknown;
            setShot: (t: ShotType) => void;
            give: (slot: Slot | WeaponKind, tier: number, dx?: number, dy?: number) => void;
            gear: () => unknown;
          };
        }).__riftwake = {
          killPortal: () => {
            this.wave = Math.max(5, this.wave);
            this.portal.hp = -1;
          },
          kills: () => this.kills,
          setShot: (t: ShotType) => {
            this.run.mods.type = t;
          },
          // Lays one gear/weapon drop near the hero (screenshots/QA of auto-equip).
          give: (slot: Slot | WeaponKind, tier: number, dx = 60, dy = 0) => {
            const d = this.drops.find((n) => !n.alive);
            if (!d) return;
            const weapon = ["sword", "staff", "axe", "bow"].includes(slot);
            d.alive = true;
            d.x = this.player.x + dx;
            d.y = this.player.y + dy;
            d.grace = 0.3;
            d.mod = null;
            d.shot = null;
            d.kind = weapon ? "weapon" : "gear";
            d.gear = weapon ? null : makeGear(slot as Slot, tier);
            d.weapon = weapon ? makeWeapon(slot as WeaponKind, tier) : null;
          },
          gear: () => ({
            plusT: this.plusT,
            weapon: this.run.weapon ? `${this.run.weapon.kind}:${this.run.weapon.tier}` : null,
            gear: Object.fromEntries(SLOTS.map((k) => [k, this.run.gear[k]?.tier ?? 0])),
            drops: this.drops.filter((n) => n.alive).length,
          }),
          enemies: () => this.enemies.filter((e) => e.alive).length,
          debug: () => {
            let near = 9999;
            for (const e of this.enemies) {
              if (!e.alive) continue;
              near = Math.min(near, Math.hypot(e.x - this.player.x, e.y - this.player.y));
            }
            const shots = this.projs.filter((p) => p.alive);
            let pnear = 9999;
            for (const p of shots) {
              for (const e of this.enemies) {
                if (!e.alive) continue;
                pnear = Math.min(pnear, Math.hypot(p.x - e.x, p.y - e.y) - p.radius - e.radius);
              }
            }
            let wounded = 0;
            for (const e of this.enemies) {
              if (e.alive && e.hp < e.maxHp - 0.5) wounded += 1;
            }
            return {
              near: Math.round(near),
              shots: shots.length,
              pnear: Math.round(pnear),
              yaw: Number(this.player.yaw.toFixed(2)),
              mode: this.mode,
              hp: Math.round(this.player.hp),
              wounded,
            };
          },
        };
      }
    }
  }

  bindKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  clearKeys(): void {
    this.keys.clear();
  }

  setProbe(codes: string[]): void {
    this.probe = codes.length ? new Set(codes) : null;
  }

  setStick(x: number, y: number, on: boolean): void {
    this.stick.x = x;
    this.stick.y = y;
    this.stick.on = on;
  }

  aim(x: number, y: number, inside: boolean, moved: boolean): void {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseInside = inside;
    if (moved) this.mouseHot = 1.4;
  }

  hasContinue(): boolean {
    return loadRun() !== null;
  }

  start(hero: HeroId): void {
    const seed = (Math.random() * 0x7fffffff) >>> 0;
    const run = this.blank(seed, 1, hero);
    if (hero === "warrior") run.weapon = { kind: "sword", tier: 1, name: "Field Sword" };
    this.baseline = structuredClone(run);
    saveRun(this.baseline);
    this.audio.ensure();
    this.apply(this.baseline);
    this.setMode("playing");
  }

  continueRun(): boolean {
    const run = loadRun();
    if (!run) return false;
    this.baseline = structuredClone(run);
    this.audio.ensure();
    this.apply(this.baseline);
    this.setMode("playing");
    return true;
  }

  retry(): void {
    this.audio.ensure();
    this.apply(this.baseline);
    this.setMode("playing");
  }

  nextLevel(): void {
    this.audio.ensure();
    this.apply(this.baseline);
    this.setMode("playing");
  }

  toMenu(): void {
    this.setMode("menu");
    this.clearKeys();
    this.probe = null;
  }

  togglePause(): void {
    if (this.mode === "playing") this.setMode("paused");
    else if (this.mode === "paused") this.setMode("playing");
  }

  frame(dt: number): void {
    this.pollPause();
    this.pollSurge();
    if (this.mode === "playing" && !this.hold && this.hitStop > 0) {
      // Hit-stop: freeze the sim for a few frames (render keeps going, shake keeps decaying).
      this.hitStop = Math.max(0, this.hitStop - Math.min(0.1, dt));
      this.shake *= Math.exp(-Math.min(0.1, dt) * 7);
    } else if (this.mode === "playing" && !this.hold) {
      this.accum += Math.min(0.1, dt);
      let guard = 0;
      while (this.accum >= 1 / 60 && guard < 5 && this.mode === "playing") {
        this.step(1 / 60);
        this.accum -= 1 / 60;
        guard += 1;
      }
    }
    this.audio.tick();
    this.syncHud();
  }

  totals(): { hp: number; def: number; radius: number } {
    const base = HERO[this.run.hero].hp;
    let hp = base;
    let def = 0;
    let radius = 0;
    for (const slot of SLOTS) {
      const g = this.run.gear[slot];
      if (!g) continue;
      hp += g.hp;
      def += g.def;
      radius += g.radius;
    }
    return { hp, def: Math.min(0.62, def), radius };
  }

  reachMul(): number {
    return HERO[this.run.hero].radiusMul * (1 + this.totals().radius / 90);
  }

  private blank(seed: number, level: number, hero: HeroId): RunSave {
    return {
      version: 1,
      level,
      seed,
      hero,
      gear: emptyGear(),
      weapon: null,
      mods: freshMods(hero),
      difficulty: this.settings.difficulty,
    };
  }

  private setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.onMode?.(mode);
  }

  private apply(run: RunSave): void {
    this.run = structuredClone(run);
    this.level = run.level;
    this.seed = run.seed;
    this.diffIndex = Math.max(0, Math.min(4, run.difficulty));
    this.wave = 1;
    this.time = 0;
    this.kills = 0;
    this.fought = false;
    this.eliteLeft = false;
    this.gap = 0.5;
    this.toSpawn = 0;
    this.banner = "Wave 1";
    this.bannerT = 1.8;
    this.shake = 0;
    this.camReady = false;
    this.accum = 0;
    this.plusT = 0;
    this.hitStop = 0;
    this.comboWordT = 0;
    this.lastCombo = "";
    this.twist = "";
    this.twistT = 0;
    this.twistClock = 0;
    this.twistN = 0;
    this.rainT = 0;
    for (const r of this.rain) r.alive = false;
    for (const m of this.emove) m.kind = "";
    this.shrine.alive = false;
    this.shrineClock = SHRINE.every - SHRINE.firstAt;
    this.shrineRng = mulberry32(((this.seed || 1) ^ 0x5a17c3) >>> 0 || 1);
    this.buff = "";
    this.buffT = 0;
    this.shieldHits = 0;
    this.surgeMeter = 0;
    this.surgeFx = 0;
    for (const n of this.nums) n.alive = false;
    for (const e of this.enemies) e.alive = false;
    for (const p of this.projs) p.alive = false;
    for (const d of this.drops) d.alive = false;
    for (const p of this.parts) p.alive = false;
    for (const b of this.beams) b.alive = false;
    for (const f of this.impacts) f.alive = false;
    this.buildWorld();
    const t = this.totals();
    this.player.hero = run.hero;
    this.player.actor = run.hero;
    this.player.hp = t.hp;
    this.player.fireCd = 0.2;
    this.player.hurtCd = 0;
    this.player.rage = 0;
    this.player.castT = 0;
    this.player.jumpT = 0;
    this.player.yaw = 0;
    this.player.facing = 4;
    this.player.vx = 0;
    this.player.vy = 0;
    this.audio.setVolumes(this.settings.master / 100, this.settings.music / 100, this.settings.sfx / 100);
  }

  private buildWorld(): void {
    const rng = mulberry32(this.seed || 1);
    this.rng = rng;
    const biomes = ["rock", "forest", "snow", "ice", "lava"] as const;
    this.biome = this.level === 1 ? "rock" : (biomes[Math.floor(rng() * biomes.length)] ?? "rock");
    this.player.x = 480 + rng() * 80;
    this.player.y = 500 + rng() * 80;
    this.portal.x = ARENA - 620 - rng() * 80;
    this.portal.y = ARENA - 640 - rng() * 80;
    const diff = DIFF[this.diffIndex] ?? DIFF[2];
    const scale = (this.quick ? 0.08 : 1) * (1 + (this.level - 1) * 0.16) * diff.hp;
    this.portal.maxHp = PORTAL_HP * scale;
    this.portal.hp = this.portal.maxHp;
    this.portal.regen = PORTAL_REGEN * (this.quick ? 0.2 : 1) * diff.hp;
    this.props = [];
    const trees = this.biome === "forest" || this.biome === "snow";
    for (let i = 0; i < 110; i++) {
      const x = 100 + rng() * (ARENA - 200);
      const y = 100 + rng() * (ARENA - 200);
      if (Math.hypot(x - this.player.x, y - this.player.y) < 170) continue;
      if (Math.hypot(x - this.portal.x, y - this.portal.y) < 200) continue;
      const tree = trees && rng() > 0.45;
      const r = tree ? 22 : 16 + rng() * 14;
      // Sparse ground props: thin boulders without touching the rng stream, and keep a lane
      // (>= one elite's width) between any two props so nothing overlaps or pins a body.
      if (!tree && Math.imul(i + 1, 2654435761) >>> 24 > 150) continue;
      if (this.props.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + 70)) continue;
      this.props.push({ x, y, r, kind: tree ? "tree" : "boulder" });
    }
    if (this.level === 1) this.kinds = ["skeleton", "orc", "zombie"];
    else {
      const n = 1 + Math.floor(rng() * 4);
      const pool = [...MONSTERS];
      const picked: MonsterId[] = [];
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(rng() * pool.length);
        const id = pool.splice(idx, 1)[0];
        if (id) picked.push(id);
      }
      this.kinds = picked.length ? picked : ["skeleton"];
    }
    this.camX = this.player.x;
    this.camY = this.player.y;
    this.camReady = true;
  }

  private pollPause(): void {
    const code = this.settings.binds.pause;
    const down = this.pressed(code);
    if (down && !this.pauseWas && (this.mode === "playing" || this.mode === "paused")) this.togglePause();
    this.pauseWas = down;
  }

  /** Surge keys (E / Space unless bound to something else); edge-triggered, never touches movement. */
  private pollSurge(): void {
    const b = this.settings.binds;
    const used = new Set(Object.values(b));
    const down = SURGE_KEYS.some((k) => !used.has(k) && this.pressed(k));
    if (down && !this.surgeWas) this.surge();
    this.surgeWas = down;
  }

  /** Fires the Rift Surge when the meter is full: hits every enemy on screen, reused impact FX ring. */
  surge(): boolean {
    if (this.mode !== "playing" || this.surgeMeter < SURGE.max) return false;
    this.surgeMeter = 0;
    this.surgeFx = SURGE.fxTime;
    const diff = DIFF[this.diffIndex] ?? DIFF[2];
    const dmg = 34 * SURGE.mul * diff.hp * (1 + (this.wave - 1) * 0.16) * (1 + (this.level - 1) * 0.2) * (this.quick ? 0.35 : 1);
    const px = this.player.x;
    const py = this.player.y;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e?.alive || Math.abs(e.x - px) > SURGE.reachX || Math.abs(e.y - py) > SURGE.reachY) continue;
      this.spawnImpact(e.x, e.y, "beam");
      this.hurtEnemy(i, dmg, this.run.mods.type, e.x - px, e.y - py);
    }
    const types: (ShotType | "beam")[] = ["bolt", "fire", "ice", "water", "beam"];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      this.spawnImpact(px + Math.cos(a) * 90, py + Math.sin(a) * 90, types[k % types.length] ?? "bolt");
    }
    this.shake = Math.min(JUICE.shakeCap, this.shake + 8);
    this.hitStop = Math.max(this.hitStop, 0.08);
    this.banner = "Rift Surge!";
    this.bannerT = 1.2;
    this.audio.rage();
    return true;
  }

  private pressed(code: string): boolean {
    if (this.probe) return this.probe.has(code);
    return this.keys.has(code);
  }

  private moveAxes(): { x: number; y: number } {
    const b: Binds = this.settings.binds;
    const probe = this.probe;
    const has = (code: string) => (probe ? probe.has(code) : this.keys.has(code));
    let x = 0;
    let y = 0;
    if (has(b.up) || (!probe && has("ArrowUp"))) y -= 1;
    if (has(b.down) || (!probe && has("ArrowDown"))) y += 1;
    if (has(b.left) || (!probe && has("ArrowLeft"))) x -= 1;
    if (has(b.right) || (!probe && has("ArrowRight"))) x += 1;
    if (!probe && x === 0 && y === 0 && this.stick.on) {
      x = this.stick.x;
      y = this.stick.y;
    }
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    return { x, y };
  }

  private step(dt: number): void {
    const ax = this.moveAxes();
    let speed = HERO[this.run.hero].speed;
    if (this.buff === "haste") speed *= SHRINE.haste;
    if (this.biome === "ice") speed *= 0.78;
    else if (this.biome === "snow") speed *= 0.9;
    this.player.vx = ax.x * speed;
    this.player.vy = ax.y * speed;
    this.mouseHot = Math.max(0, this.mouseHot - dt);
    const moving = ax.x * ax.x + ax.y * ax.y > 0.01;
    const steer = !this.probe && this.mouseInside && this.mouseHot > 0 && !this.stick.on;
    if (steer) {
      const dx = this.mouseX - this.player.x;
      const dy = this.mouseY - this.player.y;
      if (dx * dx + dy * dy > 16) this.player.yaw = yawFromVelocity(dx, dy);
    } else if (moving) {
      this.player.yaw = yawFromVelocity(this.player.vx, this.player.vy);
    }
    const moveYaw = moving ? yawFromVelocity(this.player.vx, this.player.vy) : this.player.yaw;
    const x0 = this.player.x;
    const y0 = this.player.y;
    this.moveBody(this.player, 13, dt, false);
    const movedX = this.player.x - x0;
    const movedY = this.player.y - y0;
    if (movedX * movedX + movedY * movedY > 0.04) {
      // Face the input direction so prop slides and knockback don't twitch the sprite.
      this.player.facing = facingHeld(moving ? moveYaw : yawFromVelocity(movedX, movedY), this.player.facing);
      this.player.frameT += dt;
      if (this.player.frameT > 0.14) {
        this.player.frame = (this.player.frame + 1) % 4;
        this.player.frameT = 0;
      }
    } else if (!moving) {
      this.player.facing = facingHeld(moveYaw, this.player.facing);
    }
    if (this.lavaAt(this.player.x, this.player.y)) this.player.hp -= 16 * dt * (1 - this.totals().def);
    this.time += dt;
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.player.fireCd = Math.max(0, this.player.fireCd - dt);
    this.player.hurtCd = Math.max(0, this.player.hurtCd - dt);
    this.player.rage = Math.max(0, this.player.rage - dt);
    this.player.castT = Math.max(0, this.player.castT - dt);
    this.player.jumpT = Math.max(0, this.player.jumpT - dt);
    if (this.player.fireCd <= 0) this.fire();
    this.comboWordT = Math.max(0, this.comboWordT - dt);
    const cname = this.combo()?.name ?? "";
    if (cname !== this.lastCombo) {
      this.lastCombo = cname;
      if (cname) {
        this.banner = `Combo: ${cname}!`;
        this.bannerT = 1.6;
      }
    }

    if (!this.camReady) {
      this.camX = this.player.x;
      this.camY = this.player.y;
      this.camReady = true;
    } else {
      const k = 1 - Math.exp(-dt * 8);
      this.camX += (this.player.x - this.camX) * k;
      this.camY += (this.player.y - this.camY) * k;
    }
    this.shake *= Math.exp(-dt * 7);

    this.spawnStep(dt);
    this.twistStep(dt);
    this.shrineStep(dt);
    this.hashEnemies();
    this.moveEnemies(dt);
    this.moveProjs(dt);
    this.beamsStep(dt);
    this.dropsStep(dt);
    this.partsStep(dt);
    if (this.wave >= 5) {
      this.portal.hp = Math.min(this.portal.maxHp, this.portal.hp + this.portal.regen * dt);
    }
    if (this.portal.hp <= 0) {
      this.win();
      return;
    }
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.audio.die();
      this.setMode("dead");
      return;
    }
    if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.openWave();
    } else if (this.fought && this.toSpawn <= 0 && !this.anyEnemy()) {
      this.clearWave();
    }
  }

  private moveBody(body: { x: number; y: number; vx: number; vy: number }, radius: number, dt: number, ghost: boolean): void {
    if (ghost) {
      body.x += body.vx * dt;
      body.y += body.vy * dt;
    } else {
      this.freeFromProps(body, radius);
      const startX = body.x;
      const startY = body.y;
      const nx = body.x + body.vx * dt;
      const ny = body.y + body.vy * dt;
      // A step is allowed if it is clear, or if it reduces overlap (so a body
      // squeezed between two rocks can always back out instead of locking up).
      if (this.canStep(body.x, body.y, nx, body.y, radius)) body.x = nx;
      if (this.canStep(body.x, body.y, body.x, ny, radius)) body.y = ny;
      if (body.x === startX && body.y === startY && this.canStep(startX, startY, nx, ny, radius)) {
        // Each axis alone is blocked (wedge between two rocks) but the diagonal is clear.
        body.x = nx;
        body.y = ny;
      }
      if (body.x === startX && body.y === startY) this.slideAround(body, radius, dt);
    }
    body.x = Math.max(radius, Math.min(ARENA - radius, body.x));
    body.y = Math.max(radius, Math.min(ARENA - radius, body.y));
  }

  private freeFromProps(body: { x: number; y: number }, radius: number): void {
    for (let n = 0; n < 4; n++) {
      let stuck = false;
      for (const p of this.props) {
        const dx = body.x - p.x;
        const dy = body.y - p.y;
        const min = radius + p.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        stuck = true;
        const d = Math.sqrt(d2) || 0.01;
        const push = min - d + 0.8;
        body.x += (dx / d) * push;
        body.y += (dy / d) * push;
      }
      if (!stuck) return;
    }
  }

  private slideAround(body: { x: number; y: number; vx: number; vy: number }, radius: number, dt: number): void {
    let closest: { x: number; y: number; r: number } | null = null;
    let best = Infinity;
    for (const p of this.props) {
      const d2 = (body.x - p.x) * (body.x - p.x) + (body.y - p.y) * (body.y - p.y);
      if (d2 < best) {
        best = d2;
        closest = p;
      }
    }
    if (!closest) return;
    const dx = body.x - closest.x;
    const dy = body.y - closest.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = Math.hypot(body.vx, body.vy);
    const tx = -dy / len;
    const ty = dx / len;
    const prefer = tx * body.vx + ty * body.vy >= 0 ? 1 : -1;
    for (const sign of [prefer, -prefer]) {
      const sx = body.x + tx * sign * speed * dt;
      const sy = body.y + ty * sign * speed * dt;
      const ox = body.x;
      const oy = body.y;
      if (!this.hitsProp(sx, body.y, radius)) body.x = sx;
      if (!this.hitsProp(body.x, sy, radius)) body.y = sy;
      if (body.x !== ox || body.y !== oy) return;
    }
  }

  // Look ahead along the wanted direction; if a rock/tree blocks it, commit to
  // walking round one side (kept for a short time so monsters don't dither).
  private steerAroundProps(e: Enemy, sx: number, sy: number, dt: number): { x: number; y: number } {
    const len = Math.hypot(sx, sy);
    if (len < 1e-6) return { x: sx, y: sy };
    const ux = sx / len;
    const uy = sy / len;
    e.detourT = Math.max(0, (e.detourT ?? 0) - dt);
    // Progress watchdog: if wedged (e.g. between two rocks), try the other side for a while.
    e.checkT = (e.checkT ?? 0) + dt;
    if (e.checkT > 0.75) {
      const moved = Math.hypot(e.x - (e.checkX ?? e.x), e.y - (e.checkY ?? e.y));
      if (moved < 10 && e.detour) {
        e.fails = (e.fails ?? 0) + 1;
        e.detour = -e.detour;
        e.forceT = 1.4;
        if (e.fails >= 2) {
          // Both sides blocked: back out of the pocket, away from the rocks touching us.
          let ax = 0;
          let ay = 0;
          for (const p of this.props) {
            const qx = e.x - p.x;
            const qy = e.y - p.y;
            const q = Math.hypot(qx, qy) || 1;
            if (q < p.r + e.radius + 10) {
              ax += qx / q;
              ay += qy / q;
            }
          }
          const al = Math.hypot(ax, ay);
          e.escX = al > 0.1 ? ax / al : -uy;
          e.escY = al > 0.1 ? ay / al : ux;
          e.escapeT = 0.7;
          e.fails = 0;
        }
      } else e.fails = 0;
      e.checkT = 0;
      e.checkX = e.x;
      e.checkY = e.y;
    }
    e.forceT = Math.max(0, (e.forceT ?? 0) - dt);
    if ((e.escapeT ?? 0) > 0) {
      e.escapeT = (e.escapeT ?? 0) - dt;
      return { x: (e.escX ?? 0) * len, y: (e.escY ?? 0) * len };
    }
    let block: { x: number; y: number; r: number } | null = null;
    let bestAlong = Infinity;
    const look = e.radius + 46;
    for (const p of this.props) {
      const px = p.x - e.x;
      const py = p.y - e.y;
      const along = px * ux + py * uy;
      if (along < -p.r || along > look + p.r) continue;
      const side = Math.abs(px * uy - py * ux);
      if (side >= p.r + e.radius + 3) continue;
      if (along < bestAlong) {
        bestAlong = along;
        block = p;
      }
    }
    if (!block) {
      if (e.detourT <= 0 && e.forceT <= 0) e.detour = 0;
      if (!e.detour) return { x: sx, y: sy };
    }
    const target = block ?? null;
    if (target) {
      const ox = e.x - target.x;
      const oy = e.y - target.y;
      const ol = Math.hypot(ox, oy) || 1;
      // Go round the side the goal is on; only keep the old side while it is a near tie.
      const d = (-oy * ux + ox * uy) / ol;
      if (!e.detour || (e.forceT <= 0 && Math.abs(d) > 0.25)) e.detour = d >= 0 ? 1 : -1;
      e.detourT = 0.6;
      const tx = (-oy / ol) * e.detour;
      const ty = (ox / ol) * e.detour;
      const gap = ol - target.r - e.radius;
      const w = gap < 8 ? 1 : Math.min(1, Math.max(0.35, 1 - bestAlong / (look + target.r)));
      const nx = ux * (1 - w) + tx * w;
      const ny = uy * (1 - w) + ty * w;
      const nl = Math.hypot(nx, ny) || 1;
      return { x: (nx / nl) * len, y: (ny / nl) * len };
    }
    return { x: sx, y: sy };
  }

  private canStep(x0: number, y0: number, x1: number, y1: number, radius: number): boolean {
    if (!this.hitsProp(x1, y1, radius)) return true;
    return this.penetration(x1, y1, radius) < this.penetration(x0, y0, radius) - 1e-3;
  }

  private penetration(x: number, y: number, radius: number): number {
    let worst = 0;
    for (const p of this.props) {
      const over = radius + p.r - Math.hypot(x - p.x, y - p.y);
      if (over > worst) worst = over;
    }
    return worst;
  }

  private hitsProp(x: number, y: number, radius: number): boolean {
    for (const p of this.props) {
      if (Math.hypot(x - p.x, y - p.y) < radius + p.r) return true;
    }
    return false;
  }

  lavaAt(x: number, y: number): boolean {
    if (this.biome !== "lava") return false;
    if (Math.hypot(x - 520, y - 540) < 240) return false;
    if (Math.hypot(x - this.portal.x, y - this.portal.y) < 240) return false;
    return hash2(this.seed, Math.floor(x / 48), Math.floor(y / 48)) < 0.16;
  }

  private nearestAim(): { x: number; y: number } {
    let best = Infinity;
    let dx = 0;
    let dy = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const ex = e.x - this.player.x;
      const ey = e.y - this.player.y;
      const d = ex * ex + ey * ey;
      if (d < best) {
        best = d;
        dx = ex;
        dy = ey;
      }
    }
    if (best === Infinity) return dirFromYaw(this.player.yaw);
    const m = Math.hypot(dx, dy) || 1;
    return { x: dx / m, y: dy / m };
  }

  private fire(): void {
    const mods = this.run.mods;
    const weapon = this.run.weapon;
    let cd = 0.4;
    let dmg = 13;
    let speed = 340;
    let life = 0.95;
    let pierce = 0;
    let splash = 0;
    const type = mods.type;
    if (weapon?.kind === "sword") {
      cd *= 0.78;
      life *= 0.82;
      dmg *= 1.2;
    } else if (weapon?.kind === "axe") {
      cd *= 1.28;
      dmg *= 1.75;
      splash = 26;
      speed *= 0.82;
    } else if (weapon?.kind === "bow") {
      cd *= 0.9;
      speed *= 1.38;
      pierce = 2;
      life *= 1.28;
    } else if (weapon?.kind === "staff" && (type === "beam" || type === "wave")) dmg *= 1.5;
    else if (weapon?.kind === "staff") dmg *= 1.12;
    if (this.player.rage > 0) dmg *= 2;
    const reach = this.reachMul();
    life *= reach;
    speed *= 1 + mods.speed * 0.12;
    if (type === "wave") {
      speed *= 0.62;
      life *= 1.35;
    }
    const count = Math.min(8, 1 + mods.amount);
    const spread = (6 * Math.PI) / 180;
    this.player.fireCd = Math.max(0.11, cd * (this.buff === "fire" ? SHRINE.fireCd : 1));
    this.player.castT = 0.2;
    const base = this.nearestAim();
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
      const a = t * spread;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = base.x * c - base.y * s;
      const dy = base.x * s + base.y * c;
      if (type === "beam") this.castBeam(dx, dy, dmg * 1.35, 78 * reach);
      else this.spawnProj(this.player.x, this.player.y, dx, dy, dmg, speed, life, pierce, splash, type, true, type === "wave" ? 20 : 12);
    }
    this.audio.shoot(type);
  }

  private castBeam(dx: number, dy: number, dmg: number, len: number): void {
    const b = this.beams.find((n) => !n.alive);
    if (b) {
      b.alive = true;
      b.x = this.player.x + dx * 16;
      b.y = this.player.y + dy * 16;
      b.dx = dx;
      b.dy = dy;
      b.len = len;
      b.life = 0.12;
      b.type = "beam";
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e?.alive) continue;
      if (distSeg(e.x, e.y, this.player.x, this.player.y, dx, dy, len) < e.radius + 8) {
        this.spawnImpact(e.x, e.y, "beam");
        const primed = e.burn > 0 && e.slow > 0;
        this.hurtEnemy(i, dmg, "beam", dx, dy);
        this.comboHit(i, dmg, "beam", primed);
      }
    }
    if (this.wave >= 5 && distSeg(this.portal.x, this.portal.y, this.player.x, this.player.y, dx, dy, len) < this.portal.r + 8) {
      this.portal.hp -= dmg;
      this.burst(this.portal.x, this.portal.y, "#c46bff", 4);
    }
  }

  private spawnProj(
    x: number,
    y: number,
    dx: number,
    dy: number,
    dmg: number,
    speed: number,
    life: number,
    pierce: number,
    splash: number,
    type: ShotType,
    friendly: boolean,
    radius: number,
  ): void {
    const p = this.projs.find((n) => !n.alive);
    if (!p) return;
    p.alive = true;
    p.x = x + dx * 12;
    p.y = y + dy * 12;
    p.vx = dx * speed;
    p.vy = dy * speed;
    p.life = life;
    p.damage = dmg;
    p.type = type;
    p.friendly = friendly;
    p.pierce = pierce;
    p.splash = splash;
    p.radius = radius;
    p.h0 = -1;
    p.h1 = -1;
    p.h2 = -1;
  }

  private spawnStep(dt: number): void {
    if (!this.fought || this.toSpawn <= 0) return;
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 0.16;
    this.spawnOne(this.eliteLeft);
    this.eliteLeft = false;
    this.toSpawn -= 1;
  }

  private openWave(): void {
    const diff = DIFF[this.diffIndex] ?? DIFF[2];
    let count = Math.round((16 + this.wave * 6) * diff.count * (1 + (this.level - 1) * 0.04));
    if (this.quick) count = Math.min(6, Math.max(4, count));
    count = Math.max(4, Math.min(MAX_E - 4, count));
    this.toSpawn = count;
    this.eliteLeft = this.wave >= 2;
    this.spawnT = 0.02;
    this.fought = true;
    this.gap = 0;
    this.banner = this.wave === 5 ? "The seal cracks" : `Wave ${this.wave}`;
    this.bannerT = 1.5;
  }

  private spawnOne(elite: boolean): void {
    const e = this.enemies.find((n) => !n.alive);
    if (!e) return;
    const kind = this.kinds[Math.floor(this.rng() * this.kinds.length)] ?? "skeleton";
    let x = this.player.x;
    let y = this.player.y;
    let placed = false;
    for (let n = 0; n < 16; n++) {
      const ang = this.rng() * Math.PI * 2;
      const dist = 240 + this.rng() * 160;
      x = this.player.x + Math.cos(ang) * dist;
      y = this.player.y + Math.sin(ang) * dist;
      if (x > 40 && y > 40 && x < ARENA - 40 && y < ARENA - 40 && !this.hitsProp(x, y, 18)) {
        placed = true;
        break;
      }
    }
    if (!placed) return;
    const diff = DIFF[this.diffIndex] ?? DIFF[2];
    const hp = (elite ? 9 : 1) * 34 * diff.hp * (1 + (this.wave - 1) * 0.16) * (1 + (this.level - 1) * 0.2) * (this.quick ? 0.35 : 1);
    e.alive = true;
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.hp = hp;
    e.maxHp = hp;
    e.speed = (elite ? 70 : 88) * diff.speed * (kind === "ghost" ? 1.15 : 1);
    e.radius = elite ? 30 : kind === "spider" || kind === "satyr" ? 12 : 14;
    e.damage = (elite ? 16 : 9) * diff.dmg;
    e.elite = elite;
    const em = this.emove[this.enemies.indexOf(e)];
    if (em) {
      em.kind = "";
      em.t = 0;
      em.n = 0;
      em.cd = ELITE_MOVE.firstCd;
    }
    e.slow = 0;
    e.burn = 0;
    e.kx = 0;
    e.ky = 0;
    e.flash = 0;
    e.hitCd = 0;
    e.shotCd = 0.8 + this.rng();
    e.telegraph = 0;
    e.anim = "walk";
    e.frame = 0;
    e.facing = 4;
    e.animT = 0;
    e.hop = 0;
  }

  private anyEnemy(): boolean {
    return this.enemies.some((e) => e.alive);
  }

  private clearWave(): void {
    this.portal.maxHp *= PORTAL_HP_WAVE;
    this.portal.hp = Math.min(this.portal.hp, this.portal.maxHp);
    this.portal.regen *= PORTAL_REGEN_WAVE;
    this.wave += 1;
    this.gap = 1.15;
    this.fought = false;
    this.banner = this.wave === 5 ? "The seal cracks" : `Wave ${this.wave}`;
    this.bannerT = 1.4;
    if (this.wave === 5) this.audio.portal();
  }

  private hashEnemies(): void {
    for (const b of this.buckets) b.length = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e?.alive) continue;
      const ix = Math.max(0, Math.min(this.gw - 1, Math.floor(e.x / CELL)));
      const iy = Math.max(0, Math.min(this.gw - 1, Math.floor(e.y / CELL)));
      this.buckets[iy * this.gw + ix]?.push(i);
    }
  }

  private moveEnemies(dt: number): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e?.alive) continue;
      if (e.burn > 0) {
        e.burn -= dt;
        e.hp -= 9 * dt;
      }
      if (e.slow > 0) e.slow -= dt;
      e.flash = Math.max(0, e.flash - dt);
      e.hitCd = Math.max(0, e.hitCd - dt);
      e.kx *= Math.exp(-dt * 5);
      e.ky *= Math.exp(-dt * 5);
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const held = e.elite && this.eliteMove(i, e, dist, dt);
      let sx = dx / dist;
      let sy = dy / dist;
      if (RANGED.has(e.kind) && dist < 200) {
        sx *= -0.4;
        sy *= -0.4;
      }
      if (HOPPERS.has(e.kind)) {
        e.shotCd -= dt;
        if (e.shotCd <= 0 && e.hop <= 0) {
          e.hop = 0.42;
          e.shotCd = 2.2;
        }
      }
      const hopBoost = e.hop > 0.12 ? 1.7 : 1;
      if (e.hop > 0) e.hop -= dt;
      const slow = e.slow > 0 ? 0.55 : 1;
      if (!GHOSTLIKE.has(e.kind)) {
        const steer = this.steerAroundProps(e, sx, sy, dt);
        sx = steer.x;
        sy = steer.y;
      }
      const go = held ? 0 : 1;
      e.vx = sx * e.speed * hopBoost * slow * go + e.kx;
      e.vy = sy * e.speed * hopBoost * slow * go + e.ky;
      const x0 = e.x;
      const y0 = e.y;
      this.moveBody(e, e.radius, dt, GHOSTLIKE.has(e.kind));
      const mx = e.x - x0;
      const my = e.y - y0;
      if (mx * mx + my * my > 0.04) {
        // Face where the monster means to go (not the collision-jittered delta).
        e.facing = facingHeld(yawFromVelocity(sx, sy), e.facing);
        e.animT += dt;
        if (e.animT > 0.14) {
          e.frame = (e.frame + 1) % 4;
          e.animT = 0;
        }
      }
      if (e.hop > 0) e.anim = "jump";
      else e.anim = "walk";
      if (held) e.anim = this.emove[i]?.kind === "slam" ? "jump" : "cast";
      if (RANGED.has(e.kind)) this.rangedThink(e, dist, dx, dy, dt);
      if (dist < e.radius + 13 && e.hitCd <= 0) {
        this.hurt(e.damage);
        e.hitCd = 0.7;
      }
      if (e.hp <= 0) this.killEnemy(i);
    }
    this.separate();
  }

  /** Elite telegraphed moves: wind-up (elite holds still, ground marker) then the attack. True while winding up. */
  private eliteMove(i: number, e: Enemy, dist: number, dt: number): boolean {
    const m = this.emove[i];
    if (!m) return false;
    if (m.kind) {
      m.t -= dt;
      if (m.kind === "volley") {
        m.x = e.x;
        m.y = e.y;
      }
      if (m.t > 0) return true;
      const kind = m.kind;
      m.kind = "";
      if (kind === "slam") {
        this.spawnImpact(m.x, m.y, "enemy");
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          this.spawnImpact(m.x + Math.cos(a) * ELITE_MOVE.slamR * 0.6, m.y + Math.sin(a) * ELITE_MOVE.slamR * 0.6, "enemy");
        }
        this.burst(m.x, m.y, "#d2644a", 8);
        this.shake = Math.min(JUICE.shakeCap, this.shake + 4);
        if (Math.hypot(this.player.x - m.x, this.player.y - m.y) < ELITE_MOVE.slamR) this.hurt(e.damage * ELITE_MOVE.slamMul);
      } else {
        const off = (m.n % 2) * (Math.PI / ELITE_MOVE.volleyN);
        for (let k = 0; k < ELITE_MOVE.volleyN; k++) {
          const a = off + (k / ELITE_MOVE.volleyN) * Math.PI * 2;
          this.spawnProj(e.x, e.y, Math.cos(a), Math.sin(a), e.damage * ELITE_MOVE.volleyMul, ELITE_MOVE.volleySpeed, 2.4, 0, 0, "bolt", false, 6);
        }
        this.spawnImpact(e.x, e.y, "enemy");
      }
      m.cd = ELITE_MOVE.cd + (i % 3) * 0.5;
      return false;
    }
    m.cd -= dt;
    if (m.cd > 0 || dist > ELITE_MOVE.range || this.mode !== "playing") return false;
    const first = hash2(7, e.kind.length, e.kind.charCodeAt(0)) < 0.5 ? 0 : 1;
    m.kind = (m.n + first) % 2 === 0 ? "slam" : "volley";
    m.n++;
    m.t = ELITE_MOVE.windup;
    m.x = m.kind === "slam" ? this.player.x : e.x;
    m.y = m.kind === "slam" ? this.player.y : e.y;
    return true;
  }

  /** Spawns a shrine every SHRINE.every s near the hero (clear of props/lava), grants its buff on touch, ticks the buff. */
  private shrineStep(dt: number): void {
    if (this.buffT > 0) {
      this.buffT -= dt;
      if (this.buffT <= 0) {
        this.buff = "";
        this.shieldHits = 0;
      }
    }
    const s = this.shrine;
    if (s.alive) {
      s.t -= dt;
      if (s.t <= 0) s.alive = false;
      else if (Math.hypot(s.x - this.player.x, s.y - this.player.y) < SHRINE.touchR) this.takeShrine();
      return;
    }
    this.shrineClock += dt;
    if (this.shrineClock < SHRINE.every) return;
    this.shrineClock = 0;
    this.placeShrine(BUFF_ORDER[Math.floor(this.shrineRng() * BUFF_ORDER.length)] ?? "haste");
  }

  /** Places a shrine on open ground near the hero (also the test/screenshot hook). False if no clear spot. */
  placeShrine(kind: BuffId): boolean {
    const r = this.shrineRng;
    for (let k = 0; k < 16; k++) {
      const a = r() * Math.PI * 2;
      const d = SHRINE.minD + r() * (SHRINE.maxD - SHRINE.minD);
      const x = this.player.x + Math.cos(a) * d;
      const y = this.player.y + Math.sin(a) * d;
      if (x < 80 || y < 80 || x > ARENA - 80 || y > ARENA - 80) continue;
      if (this.hitsProp(x, y, SHRINE.propClear) || this.lavaAt(x, y)) continue;
      if (Math.hypot(x - this.portal.x, y - this.portal.y) < this.portal.r + 80) continue;
      Object.assign(this.shrine, { alive: true, x, y, t: SHRINE.life, kind });
      return true;
    }
    return false;
  }

  private takeShrine(): void {
    const s = this.shrine;
    s.alive = false;
    this.buff = s.kind;
    this.buffT = SHRINE.buffT;
    this.shieldHits = s.kind === "shield" ? SHRINE.shieldHits : 0;
    this.banner = `Shrine: ${BUFFS[s.kind].name}!`;
    this.bannerT = 1.6;
    this.spawnImpact(s.x, s.y, "beam");
    this.burst(s.x, s.y, BUFFS[s.kind].color, 8);
    this.audio.pickup();
  }

  private rangedThink(e: Enemy, dist: number, dx: number, dy: number, dt: number): void {
    if (e.telegraph > 0) {
      e.telegraph -= dt;
      if (e.telegraph <= 0) {
        const len = dist || 1;
        this.spawnProj(e.x, e.y, dx / len, dy / len, e.damage * 0.85, 150, 1.6, 0, 0, "bolt", false, 6);
      }
      return;
    }
    if (dist < 480 && e.shotCd <= 0) {
      e.telegraph = 0.42;
      e.shotCd = 2.3;
    } else e.shotCd -= dt;
  }

  private separate(): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e?.alive) continue;
      const ix = Math.max(0, Math.min(this.gw - 1, Math.floor(e.x / CELL)));
      const iy = Math.max(0, Math.min(this.gw - 1, Math.floor(e.y / CELL)));
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const bx = ix + ox;
          const by = iy + oy;
          if (bx < 0 || by < 0 || bx >= this.gw || by >= this.gw) continue;
          const bucket = this.buckets[by * this.gw + bx];
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const o = this.enemies[j];
            if (!o?.alive) continue;
            const dx = o.x - e.x;
            const dy = o.y - e.y;
            const min = e.radius + o.radius;
            const d2 = dx * dx + dy * dy;
            if (d2 > 1 && d2 < min * min) {
              const d = Math.sqrt(d2);
              const push = (min - d) * 0.5;
              const nx = (dx / d) * push;
              const ny = (dy / d) * push;
              const ex = e.x - nx;
              const ey = e.y - ny;
              const ox2 = o.x + nx;
              const oy2 = o.y + ny;
              if (!this.hitsProp(ex, ey, e.radius)) {
                e.x = ex;
                e.y = ey;
              }
              if (!this.hitsProp(ox2, oy2, o.radius)) {
                o.x = ox2;
                o.y = oy2;
              }
            }
          }
        }
      }
    }
  }

  private moveProjs(dt: number): void {
    for (const p of this.projs) {
      if (!p.alive) continue;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0 || p.x < 0 || p.y < 0 || p.x > ARENA || p.y > ARENA) {
        p.alive = false;
        continue;
      }
      if (this.hitsProp(p.x, p.y, p.radius * 0.4)) {
        p.alive = false;
        this.burst(p.x, p.y, "#9aa0aa", 2);
        this.spawnImpact(p.x, p.y, p.friendly ? p.type : "enemy");
        continue;
      }
      if (p.friendly) this.friendlyHit(p);
      else if (Math.hypot(p.x - this.player.x, p.y - this.player.y) < p.radius + 12) {
        this.hurt(p.damage);
        p.alive = false;
        this.burst(p.x, p.y, "#d2644a", 4);
        this.spawnImpact(p.x, p.y, "enemy");
      }
    }
  }

  private friendlyHit(p: Proj): void {
    for (let j = 0; j < this.enemies.length; j++) {
      const e = this.enemies[j];
      if (!e?.alive || this.hitAlready(p, j)) continue;
      if (Math.hypot(p.x - e.x, p.y - e.y) > p.radius + e.radius) continue;
      this.markHit(p, j);
      this.spawnImpact(p.x, p.y, p.type);
      const primed = e.burn > 0 && e.slow > 0;
      this.hurtEnemy(j, p.damage, p.type, p.vx, p.vy);
      this.comboHit(j, p.damage, p.type, primed);
      if (p.splash > 0) this.splashAt(e.x, e.y, p.splash, p.damage * 0.45, j);
      const hits = (p.h0 >= 0 ? 1 : 0) + (p.h1 >= 0 ? 1 : 0) + (p.h2 >= 0 ? 1 : 0);
      if (hits > p.pierce) {
        p.alive = false;
        break;
      }
    }
    if (!p.alive) return;
    if (Math.hypot(p.x - this.portal.x, p.y - this.portal.y) < this.portal.r + p.radius) {
      if (this.wave >= 5) {
        this.portal.hp -= p.damage;
        this.burst(p.x, p.y, "#c46bff", 3);
      } else this.burst(p.x, p.y, "#6a6478", 2);
      p.alive = false;
    }
  }

  private splashAt(x: number, y: number, radius: number, dmg: number, ignore: number): void {
    for (let i = 0; i < this.enemies.length; i++) {
      if (i === ignore) continue;
      const e = this.enemies[i];
      if (!e?.alive) continue;
      if (Math.hypot(e.x - x, e.y - y) < radius + e.radius) this.hurtEnemy(i, dmg, "bolt", 0, 0);
    }
  }

  private hitAlready(p: Proj, id: number): boolean {
    return p.h0 === id || p.h1 === id || p.h2 === id;
  }

  private markHit(p: Proj, id: number): void {
    if (p.h0 < 0) p.h0 = id;
    else if (p.h1 < 0) p.h1 = id;
    else p.h2 = id;
  }

  private hurtEnemy(index: number, dmg: number, type: ShotType, vx: number, vy: number): void {
    const e = this.enemies[index];
    if (!e?.alive) return;
    e.hp -= dmg;
    e.flash = JUICE.flash;
    this.hitJuice(e, dmg, vx, vy, type);
    if (type === "fire") e.burn = Math.max(e.burn, 2);
    if (type === "ice") e.slow = Math.max(e.slow, 1.5);
    if (type === "water") {
      const m = Math.hypot(vx, vy) || 1;
      e.kx += (vx / m) * 140;
      e.ky += (vy / m) * 140;
    }
    if (e.hp <= 0) this.killEnemy(index);
  }

  /** Every TWIST.every seconds of play, starts the next twist in a fixed order, shown with a banner. */
  private twistStep(dt: number): void {
    if (this.twist) {
      this.twistT -= dt;
      if (this.twist === "rain") this.rainStep(dt);
      if (this.twistT <= 0) this.twist = "";
    } else {
      this.twistClock += dt;
      if (this.twistClock >= TWIST.every && this.wave < 5) this.startTwist(TWIST_ORDER[this.twistN % TWIST_ORDER.length] ?? "swarm");
    }
    for (const r of this.rain) {
      if (!r.alive) continue;
      r.t -= dt;
      if (r.t > 0) continue;
      r.alive = false;
      this.spawnImpact(r.x, r.y, "enemy");
      this.burst(r.x, r.y, "#d2644a", 4);
      if (Math.hypot(r.x - this.player.x, r.y - this.player.y) < TWIST.rainR + 10) {
        const diff = DIFF[this.diffIndex] ?? DIFF[2];
        this.hurt(9 * diff.dmg * TWIST.rainMul);
      }
    }
  }

  /** Starts a twist now (also the test/screenshot hook). */
  startTwist(id: TwistId): void {
    if (id === "elites" && this.wave < 2) id = "swarm";
    this.twist = id;
    this.twistT = TWISTS[id].time;
    this.twistClock = 0;
    this.twistN += 1;
    this.banner = `Twist: ${TWISTS[id].name}!`;
    this.bannerT = 2;
    this.rainT = 0.6;
    const free = () => this.enemies.filter((e) => !e.alive).length > 4;
    if (id === "swarm") {
      for (let n = 0; n < TWIST.swarmCount && free(); n++) {
        const e = this.enemies.find((q) => !q.alive);
        this.spawnOne(false);
        if (e?.alive) {
          e.hp *= TWIST.swarmHp;
          e.maxHp = e.hp;
          e.speed *= TWIST.swarmSpeed;
        }
      }
    } else if (id === "elites") {
      for (let n = 0; n < 2 && free(); n++) this.spawnOne(true);
    }
  }

  private rainStep(dt: number): void {
    this.rainT -= dt;
    if (this.rainT > 0) return;
    this.rainT = TWIST.rainGap;
    const r = this.rain.find((q) => !q.alive);
    if (!r) return;
    const a = this.rng() * Math.PI * 2;
    const d = 30 + this.rng() * 200;
    r.alive = true;
    r.x = Math.max(40, Math.min(ARENA - 40, this.player.x + Math.cos(a) * d));
    r.y = Math.max(40, Math.min(ARENA - 40, this.player.y + Math.sin(a) * d));
    r.t = TWIST.rainWarn;
  }

  /** Gear x spell combo from the equipped weapon's element and the current shot type (gear rule untouched). */
  combo(): (typeof COMBOS)[number] | null {
    const el = this.run?.weapon ? WEAPON_ELEMENT[this.run.weapon.kind] : null;
    const type = this.run?.mods.type;
    if (!el || !type || el === type) return null;
    return COMBOS.find((c) => (c.a === el && c.b === type) || (c.b === el && c.a === type)) ?? null;
  }

  /** Applies the active combo's extra effect after a direct hit (never recurses into itself). */
  private comboHit(index: number, dmg: number, type: ShotType, primed: boolean): void {
    const c = this.combo();
    const e = this.enemies[index];
    if (!c || !e || type !== this.run.mods.type) return;
    const word = (text: string, color: string) => {
      if (this.comboWordT > 0) return;
      this.comboWordT = COMBO.wordGap;
      this.surgeMeter = Math.min(SURGE.max, this.surgeMeter + SURGE.combo);
      this.popNum(e.x, spriteTop(e) - 38, text, color);
    };
    if (c.id === "shatter") {
      // Fire + ice: a hit chills and scorches; hitting a target that is already both shatters it.
      if (e.alive && primed) {
        e.burn = 0;
        e.slow = 0;
        this.spawnImpact(e.x, e.y, "ice");
        this.spawnImpact(e.x + 10, e.y - 6, "fire");
        this.burst(e.x, e.y, "#bfe9ff", 10, 1.4, true);
        this.shake = Math.min(JUICE.shakeCap, this.shake + 2);
        word("SHATTER!", "#9fe8ff");
        for (let i = 0; i < this.enemies.length; i++) {
          const o = this.enemies[i];
          if (i === index || !o?.alive) continue;
          if (Math.hypot(o.x - e.x, o.y - e.y) < COMBO.shatterR + o.radius) this.hurtEnemy(i, dmg * COMBO.shatterMul, "ice", o.x - e.x, o.y - e.y);
        }
        this.hurtEnemy(index, dmg * COMBO.shatterMul, "bolt", 0, 0);
      } else if (e.alive) {
        e.burn = Math.max(e.burn, 2);
        e.slow = Math.max(e.slow, 1.5);
      }
    } else if (c.id === "chain") {
      // Water + bolt: the hit arcs to the nearest few foes.
      let from = e;
      const hit = new Set<number>([index]);
      for (let n = 0; n < COMBO.chainJumps; n++) {
        let best = -1;
        let bd = COMBO.chainR;
        for (let i = 0; i < this.enemies.length; i++) {
          const o = this.enemies[i];
          if (!o?.alive || hit.has(i)) continue;
          const d = Math.hypot(o.x - from.x, o.y - from.y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        const o = this.enemies[best];
        if (!o) break;
        hit.add(best);
        const b = this.beams.find((q) => !q.alive);
        if (b) Object.assign(b, { alive: true, x: from.x, y: from.y, dx: (o.x - from.x) / (bd || 1), dy: (o.y - from.y) / (bd || 1), len: bd, life: 0.12, type: "beam" });
        this.spawnImpact(o.x, o.y, "water");
        this.hurtEnemy(best, dmg * COMBO.chainMul, "bolt", o.x - from.x, o.y - from.y);
        from = o;
      }
      if (hit.size > 1) word("CHAIN!", "#7fd8ff");
    } else if (c.id === "frostbind") {
      // Ice + water: the chill lasts longer.
      if (e.alive) e.slow = Math.max(e.slow, COMBO.frostSlow);
      word("FROSTBIND", "#c8f0ff");
    } else if (c.id === "steam") {
      // Fire + water: a small steam puff scalds neighbours.
      this.spawnImpact(e.x, e.y, "water");
      let any = false;
      for (let i = 0; i < this.enemies.length; i++) {
        const o = this.enemies[i];
        if (i === index || !o?.alive) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) < COMBO.steamR + o.radius) {
          this.hurtEnemy(i, dmg * COMBO.steamMul, "bolt", o.x - e.x, o.y - e.y);
          any = true;
        }
      }
      if (any) word("STEAM!", "#e8e4ff");
    }
  }

  /** Feel-only hit feedback: knockback nudge, shake scaled by hit size, damage number. */
  private hitJuice(e: Enemy, dmg: number, vx: number, vy: number, type: ShotType): void {
    let dx = vx;
    let dy = vy;
    if (dx === 0 && dy === 0) {
      dx = e.x - this.player.x;
      dy = e.y - this.player.y;
    }
    const m = Math.hypot(dx, dy) || 1;
    if (type !== "water") {
      const k = JUICE.knock * (e.elite ? JUICE.knockElite : 1);
      e.kx += (dx / m) * k;
      e.ky += (dy / m) * k;
    }
    const size = Math.min(1, dmg / JUICE.bigHit);
    this.shake = Math.min(JUICE.shakeCap, this.shake + size * (e.elite ? JUICE.shakeElite : JUICE.shakeHit));
    if (e.elite) this.hitStop = Math.max(this.hitStop, JUICE.stopElite);
    this.popNum(e.x, spriteTop(e) - 14, Math.max(1, Math.round(dmg)), dmg >= JUICE.bigHit ? "#ffd27a" : "#ffffff");
  }

  /** Spawns a floating number/word; reuses the oldest when full. */
  popNum(x: number, y: number, value: number | string, color: string): void {
    let n = this.nums.find((q) => !q.alive);
    if (!n) n = this.nums.reduce((a, b) => (b.t > a.t ? b : a));
    n.alive = true;
    n.x = x + ((this.kills * 7 + (typeof value === "number" ? value : 3) * 13) % 17) - 8;
    n.y = y;
    n.t = 0;
    n.v = typeof value === "number" ? value : 0;
    n.text = String(value);
    n.color = color;
  }

  private killEnemy(index: number): void {
    const e = this.enemies[index];
    if (!e?.alive) return;
    e.alive = false;
    this.hitStop = Math.max(this.hitStop, e.elite ? JUICE.stopEliteKill : JUICE.stopKill);
    this.shake = Math.min(JUICE.shakeCap, this.shake + (e.elite ? JUICE.shakeEliteKill : JUICE.shakeKill));
    this.kills += 1;
    this.surgeMeter = Math.min(SURGE.max, this.surgeMeter + (e.elite ? SURGE.elite : SURGE.kill));
    this.audio.hit();
    this.burst(e.x, e.y, e.elite ? "#e0b15a" : "#c8c2b4", e.elite ? 10 : 5);
    const elite = e.elite;
    if (elite || this.rng() < 0.18) this.spawnDrop(e.x, e.y, elite);
  }

  /** Test/screenshot hook: lays one of every drop kind in a ring around the player (not auto-collected). */
  showcaseDrops(): void {
    const tier = 2;
    const list: Array<Partial<Drop> & { kind: Drop["kind"] }> = [
      { kind: "mod", mod: "speed" },
      { kind: "mod", mod: "amount" },
      ...SHOTS.map((shot) => ({ kind: "type" as const, shot })),
      { kind: "rage" },
      { kind: "gear", gear: makeGear("helm", tier) },
      { kind: "weapon", weapon: makeWeapon("staff", tier) },
    ];
    list.forEach((item, i) => {
      const d = this.drops.find((n) => !n.alive);
      if (!d) return;
      const a = (i / list.length) * Math.PI * 2;
      d.alive = true;
      d.x = this.player.x + Math.cos(a) * 150;
      d.y = this.player.y + Math.sin(a) * 110;
      d.grace = 9999;
      d.kind = item.kind;
      d.mod = item.mod ?? null;
      d.shot = item.shot ?? null;
      d.gear = item.gear ?? null;
      d.weapon = item.weapon ?? null;
    });
  }

  private spawnDrop(x: number, y: number, elite: boolean): void {
    const d = this.drops.find((n) => !n.alive);
    if (!d) return;
    const roll = this.rng();
    const tier = Math.min(6, 1 + Math.floor((this.wave + this.level) / 3) + (elite ? 1 : 0));
    d.alive = true;
    d.x = x;
    d.y = y;
    d.grace = 0.25;
    d.mod = null;
    d.shot = null;
    d.gear = null;
    d.weapon = null;
    if (roll < (elite ? 0.32 : 0.28)) {
      d.kind = "gear";
      const slot = SLOTS[Math.floor(this.rng() * SLOTS.length)] ?? "helm";
      d.gear = makeGear(slot, tier);
    } else if (roll < (elite ? 0.52 : 0.4)) {
      d.kind = "weapon";
      const kinds: WeaponKind[] = ["sword", "staff", "axe", "bow"];
      d.weapon = makeWeapon(kinds[Math.floor(this.rng() * 4)] ?? "sword", tier);
    } else if (roll < (elite ? 0.78 : 0.72)) {
      d.kind = "mod";
      const mods = ["speed", "amount"] as const;
      d.mod = mods[Math.floor(this.rng() * mods.length)] ?? "speed";
    } else if (roll < (elite ? 0.9 : 0.88)) {
      d.kind = "type";
      d.shot = SHOTS[Math.floor(this.rng() * SHOTS.length)] ?? "bolt";
    } else d.kind = "rage";
  }

  private dropsStep(dt: number): void {
    this.plusT = Math.max(0, this.plusT - dt);
    for (const d of this.drops) {
      if (!d?.alive) continue;
      d.grace = Math.max(0, d.grace - dt);
      const dist = Math.hypot(d.x - this.player.x, d.y - this.player.y);
      if (dist >= 24 * (this.buff === "magnet" ? SHRINE.magnet : 1) || d.grace > 0) continue;
      if (d.kind === "gear" || d.kind === "weapon") this.autoEquip(d);
      else this.takeInstant(d);
    }
  }

  private takeInstant(d: Drop): void {
    if (d.kind === "rage") this.player.rage = 8;
    else if (d.kind === "type" && d.shot) this.run.mods.type = d.shot;
    else if (d.kind === "mod" && d.mod === "speed") this.run.mods.speed = Math.min(8, this.run.mods.speed + 1);
    else if (d.kind === "mod" && d.mod === "amount") this.run.mods.amount = Math.min(7, this.run.mods.amount + 1);
    d.alive = false;
    this.audio.pickup();
    if (d.kind === "rage") {
      this.audio.rage();
      this.player.jumpT = 0.35;
    }
    this.burst(this.player.x, this.player.y, "#e0b15a", 6);
  }

  /**
   * Auto-equip by tier only (Will, Oct 26). A higher tier than the item in that slot (or the
   * current weapon, whatever its kind) equips and pops a '+' over the hero. Equal or lower tier
   * is destroyed on pickup. Nothing is ever dropped back on the floor.
   */
  private autoEquip(d: Drop): void {
    d.alive = false;
    if (d.gear) {
      const cur = this.run.gear[d.gear.slot];
      if (cur && d.gear.tier <= cur.tier) return this.destroyPoof(d);
      this.run.gear[d.gear.slot] = d.gear;
      const max = this.totals().hp;
      if (this.player.hp < max) this.player.hp = Math.min(max, this.player.hp + d.gear.hp);
    } else if (d.weapon) {
      const cur = this.run.weapon;
      if (cur && d.weapon.tier <= cur.tier) return this.destroyPoof(d);
      this.run.weapon = d.weapon;
    } else return;
    this.plusT = PLUS_TIME;
    this.player.jumpT = 0.32;
    this.audio.pickup();
    this.burst(this.player.x, this.player.y - 30, "#e0b15a", 8);
  }

  private destroyPoof(d: Drop): void {
    // ~2x the old poof: more, bigger, faster hard grey pixels; still short-lived.
    this.burst(d.x, d.y, "#9aa0ac", 10, 2, true);
  }

  private hurt(amount: number): void {
    if (this.player.hurtCd > 0 || this.mode !== "playing") return;
    if (this.buff === "shield" && this.shieldHits > 0) {
      this.shieldHits--;
      this.player.hurtCd = 0.62;
      this.spawnImpact(this.player.x, this.player.y, "water");
      this.audio.pickup();
      if (this.shieldHits <= 0) {
        this.buff = "";
        this.buffT = 0;
      }
      return;
    }
    this.player.hp -= amount * (1 - this.totals().def);
    this.player.hurtCd = 0.62;
    this.shake = Math.min(12, this.shake + 5);
    this.audio.hurt();
  }

  private beamsStep(dt: number): void {
    for (const b of this.beams) {
      if (!b.alive) continue;
      b.life -= dt;
      if (b.life <= 0) b.alive = false;
    }
  }

  /** Starts a cosmetic impact burst; reuses the oldest slot when the pool is full. */
  spawnImpact(x: number, y: number, type: ShotType | "enemy"): void {
    let slot = this.impacts.find((f) => !f.alive);
    if (!slot) slot = this.impacts.reduce((a, b) => (b.t > a.t ? b : a));
    slot.alive = true;
    slot.x = x;
    slot.y = y;
    slot.type = type;
    slot.t = 0;
  }

  /** Advances impact bursts (also used by the screenshot harness). */
  stepFx(dt: number): void {
    this.surgeFx = Math.max(0, this.surgeFx - dt);
    for (const n of this.nums) {
      if (!n.alive) continue;
      n.t += dt;
      n.y -= 38 * dt;
      if (n.t >= NUM_TIME) n.alive = false;
    }
    for (const f of this.impacts) {
      if (!f.alive) continue;
      f.t += dt;
      if (f.t >= IMPACT_TIME) f.alive = false;
    }
  }

  private partsStep(dt: number): void {
    this.stepFx(dt);
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) p.alive = false;
    }
  }

  private burst(x: number, y: number, color: string, n: number, scale = 1, hard = false): void {
    let left = n;
    for (const p of this.parts) {
      if (left <= 0) break;
      if (p.alive) continue;
      const a = Math.random() * Math.PI * 2;
      const s = (20 + Math.random() * 70) * scale;
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      // Hard poof: a fixed ~400 ms (two-step fade at half life); soft sparks keep 250-500 ms.
      p.life = hard ? POOF_TIME : 0.25 + Math.random() * 0.25;
      p.max = p.life;
      p.color = color;
      p.size = (2 + Math.random() * 2) * scale;
      p.hard = hard;
      left -= 1;
    }
  }

  private win(): void {
    this.clearedLevel = this.run.level;
    this.run.level += 1;
    this.run.seed = (Math.imul(this.run.seed, 1664525) + 1013904223) >>> 0;
    this.run.difficulty = this.settings.difficulty;
    this.player.hp = this.totals().hp;
    saveRun(this.run);
    this.baseline = structuredClone(this.run);
    this.audio.portal();
    this.setMode("clear");
  }

  private syncHud(): void {
    const t = this.mode === "menu" ? { hp: 1, def: 0, radius: 0 } : this.totals();
    const h = this.hud;
    h.hp = this.player.hp;
    h.maxHp = this.mode === "menu" ? 1 : t.hp;
    h.wave = this.wave;
    h.level = this.level;
    h.time = this.time;
    h.type = this.run.mods.type;
    h.speed = this.run.mods.speed;
    h.amount = this.run.mods.amount;
    h.rage = this.player.rage;
    h.sealed = this.wave < 5;
    h.banner = this.bannerT > 0 ? this.banner : "";
    h.weapon = this.run.weapon?.name ?? "Plain bolt";
    h.weaponKind = this.run.weapon?.kind ?? null;
    h.combo = this.combo()?.name ?? "";
    h.buff = this.buff ? `${BUFFS[this.buff].name} ${Math.ceil(this.buffT)}s${this.buff === "shield" ? ` (${this.shieldHits})` : ""}` : "";
    h.surge = this.surgeMeter / SURGE.max;
    h.twist = this.twist ? `${TWISTS[this.twist].name} ${Math.ceil(this.twistT)}s` : "";
    h.kills = this.kills;
    h.portal = Math.max(0, this.portal.hp);
    h.portalMax = this.portal.maxHp;
    h.showPortal = this.wave >= 5 && this.mode === "playing";
    h.px = this.player.x;
    h.py = this.player.y;
    h.portalX = this.portal.x;
    h.portalY = this.portal.y;
    h.mode = this.mode;
    h.hero = this.run.hero;
    h.clearedLevel = this.clearedLevel;
    h.diffLabel = DIFF[this.settings.difficulty]?.label ?? "Rift";
    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i];
      const row = h.slots[i];
      if (!slot || !row) continue;
      const g = this.run.gear[slot];
      row.filled = !!g;
      row.name = g?.name ?? "Empty";
    }
  }
}

function distSeg(px: number, py: number, x: number, y: number, dx: number, dy: number, len: number): number {
  const t = Math.max(0, Math.min(len, (px - x) * dx + (py - y) * dy));
  const qx = x + dx * t;
  const qy = y + dy * t;
  return Math.hypot(px - qx, py - qy);
}

export const PLUS_TIME = 0.9;
export const NUM_TIME = 0.6;
/** Rift Surge ultimate (BALANCE.md "Fun batch 2"). mul scales the burst to a wave-scaled normal enemy's base HP (flagged). */
export const SURGE = { max: 100, kill: 2, elite: 10, combo: 2, mul: 1.5, reachX: 760, reachY: 360, fxTime: 0.5 };
export const SURGE_KEYS = ["KeyE", "Space"];
export type BuffId = "haste" | "fire" | "shield" | "magnet";
/** Rift shrines (BALANCE.md "Fun batch 2"). fireCd and shieldHits touch DPS / damage taken (flagged). */
export const SHRINE = { every: 35, firstAt: 20, life: 20, minD: 200, maxD: 400, propClear: 60, touchR: 34, buffT: 10, haste: 1.3, fireCd: 0.7, shieldHits: 2, magnet: 3 };
export const BUFFS: Record<BuffId, { name: string; art: string; color: string }> = {
  haste: { name: "Haste", art: "crystal_ice", color: "#8fe3ff" },
  fire: { name: "Rapid Fire", art: "crystal_violet", color: "#c38bff" },
  shield: { name: "Rift Shield", art: "rune_pillar", color: "#7dffb0" },
  magnet: { name: "Magnet", art: "rune_stone", color: "#ffd27a" },
};
export const BUFF_ORDER: BuffId[] = ["haste", "fire", "shield", "magnet"];
export type EliteMoveId = "slam" | "volley";
/** Elite boss moves (BALANCE.md "Fun batch 2"). slamMul / volleyMul scale the elite's own contact damage (flagged). */
export const ELITE_MOVE = { windup: 0.9, firstCd: 3, cd: 5, range: 420, slamR: 70, slamMul: 1, volleyN: 8, volleyMul: 0.7, volleySpeed: 140 };
/** Boss-sheet world px per art px for elites (render: max(2, round(zoom*5.2))/zoom) and the tallest boss cell above the feet. */
export const ELITE_ART_PX = 5.2;
/** World y of the top of an enemy's drawn sprite (elites: tallest boss cell + "Elite X" label). */
export function spriteTop(e: Enemy): number {
  if (e.elite) return e.y + e.radius * 0.7 - 38 * ELITE_ART_PX - 16;
  return e.y - 36;
}
export type TwistId = "swarm" | "elites" | "dark" | "rain";
export const TWISTS: Record<TwistId, { name: string; time: number }> = {
  swarm: { name: "Fast Swarm", time: 10 },
  elites: { name: "Elite Pair", time: 10 },
  dark: { name: "Darkness", time: 12 },
  rain: { name: "Shot Rain", time: 8 },
};
export const TWIST_ORDER: TwistId[] = ["swarm", "elites", "dark", "rain"];
/** Twist numbers (BALANCE.md "Wave twists"; swarmHp and rainMul touch HP/damage — flagged for Will). */
export const TWIST = { every: 30, swarmCount: 10, swarmHp: 0.5, swarmSpeed: 1.3, rainGap: 0.5, rainWarn: 0.9, rainR: 26, rainMul: 0.85 };
/** Element each weapon kind brings to a combo (BALANCE.md "Combos"). */
export const WEAPON_ELEMENT: Record<WeaponKind, ShotType> = { sword: "bolt", axe: "fire", bow: "ice", staff: "water" };
export const COMBOS = [
  { id: "shatter", name: "Shatter", a: "fire", b: "ice" },
  { id: "chain", name: "Chain", a: "water", b: "bolt" },
  { id: "frostbind", name: "Frostbind", a: "ice", b: "water" },
  { id: "steam", name: "Steam", a: "fire", b: "water" },
] as const;
/** Combo effect numbers (BALANCE.md; shatterMul/chainMul/steamMul add damage — flagged for Will). */
export const COMBO = { shatterR: 72, shatterMul: 0.6, chainJumps: 2, chainR: 150, chainMul: 0.5, frostSlow: 3, steamR: 44, steamMul: 0.3, wordGap: 0.45 };
const MAX_NUMS = 40;
export type DmgNum = { alive: boolean; x: number; y: number; v: number; t: number; color: string; text: string };
/** Hit-feel tuning (BALANCE.md "Juice"); none of these change damage or HP. */
export const JUICE = {
  flash: 0.09,
  knock: 38,
  knockElite: 0.35,
  bigHit: 40,
  shakeHit: 1.2,
  shakeElite: 2.5,
  shakeKill: 1.5,
  shakeEliteKill: 7,
  shakeCap: 9,
  stopKill: 0.033,
  stopElite: 0.033,
  stopEliteKill: 0.1,
};
export const POOF_TIME = 0.4;

export const ARENA_SIZE = ARENA;
