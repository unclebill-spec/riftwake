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
    if (this.mode === "playing" && !this.hold) {
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
    for (const e of this.enemies) e.alive = false;
    for (const p of this.projs) p.alive = false;
    for (const d of this.drops) d.alive = false;
    for (const p of this.parts) p.alive = false;
    for (const b of this.beams) b.alive = false;
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
      this.props.push({ x, y, r: tree ? 22 : 16 + rng() * 14, kind: tree ? "tree" : "boulder" });
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
    this.player.fireCd = Math.max(0.11, cd);
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
      if (distSeg(e.x, e.y, this.player.x, this.player.y, dx, dy, len) < e.radius + 8) this.hurtEnemy(i, dmg, "beam", dx, dy);
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
      e.vx = sx * e.speed * hopBoost * slow + e.kx;
      e.vy = sy * e.speed * hopBoost * slow + e.ky;
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
      if (RANGED.has(e.kind)) this.rangedThink(e, dist, dx, dy, dt);
      if (dist < e.radius + 13 && e.hitCd <= 0) {
        this.hurt(e.damage);
        e.hitCd = 0.7;
      }
      if (e.hp <= 0) this.killEnemy(i);
    }
    this.separate();
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
        continue;
      }
      if (p.friendly) this.friendlyHit(p);
      else if (Math.hypot(p.x - this.player.x, p.y - this.player.y) < p.radius + 12) {
        this.hurt(p.damage);
        p.alive = false;
        this.burst(p.x, p.y, "#d2644a", 4);
      }
    }
  }

  private friendlyHit(p: Proj): void {
    for (let j = 0; j < this.enemies.length; j++) {
      const e = this.enemies[j];
      if (!e?.alive || this.hitAlready(p, j)) continue;
      if (Math.hypot(p.x - e.x, p.y - e.y) > p.radius + e.radius) continue;
      this.markHit(p, j);
      this.hurtEnemy(j, p.damage, p.type, p.vx, p.vy);
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
    e.flash = 0.08;
    if (type === "fire") e.burn = Math.max(e.burn, 2);
    if (type === "ice") e.slow = Math.max(e.slow, 1.5);
    if (type === "water") {
      const m = Math.hypot(vx, vy) || 1;
      e.kx += (vx / m) * 140;
      e.ky += (vy / m) * 140;
    }
    if (e.hp <= 0) this.killEnemy(index);
  }

  private killEnemy(index: number): void {
    const e = this.enemies[index];
    if (!e?.alive) return;
    e.alive = false;
    this.kills += 1;
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
      if (dist >= 24 || d.grace > 0) continue;
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

  private partsStep(dt: number): void {
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
      p.life = 0.25 + Math.random() * 0.25;
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

export const ARENA_SIZE = ARENA;
