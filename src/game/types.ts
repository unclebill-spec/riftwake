export type HeroId = "wizard" | "warrior";

export type MonsterId =
  | "skeleton"
  | "orc"
  | "zombie"
  | "vampire"
  | "ghost"
  | "minotaur"
  | "satyr"
  | "sphinx"
  | "succubus"
  | "incubus"
  | "angel"
  | "spider"
  | "bear"
  | "alligator"
  | "tiger";

export type ActorId = HeroId | MonsterId;

export type ShotType = "bolt" | "beam" | "wave" | "fire" | "ice" | "water";

export type Slot = "helm" | "chest" | "arms" | "gloves" | "legs" | "shoes";

export type WeaponKind = "sword" | "staff" | "axe" | "bow";

export type Mode = "menu" | "playing" | "paused" | "dead" | "clear";

export type Gear = {
  slot: Slot;
  tier: number;
  name: string;
  hp: number;
  def: number;
  radius: number;
};

export type Weapon = {
  kind: WeaponKind;
  tier: number;
  name: string;
};

export type Mods = {
  speed: number;
  amount: number;
  type: ShotType;
};

export type Binds = {
  up: string;
  down: string;
  left: string;
  right: string;
  pause: string;
};

export type Settings = {
  version: 1;
  difficulty: number;
  master: number;
  music: number;
  sfx: number;
  binds: Binds;
};

export type RunSave = {
  version: 1;
  level: number;
  seed: number;
  hero: HeroId;
  gear: Record<Slot, Gear | null>;
  weapon: Weapon | null;
  mods: Mods;
  difficulty: number;
};

export type Anim = "walk" | "cast" | "jump";

export type Enemy = {
  detour?: number;
  detourT?: number;
  forceT?: number;
  checkT?: number;
  checkX?: number;
  checkY?: number;
  fails?: number;
  escapeT?: number;
  escX?: number;
  escY?: number;
  alive: boolean;
  kind: MonsterId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  damage: number;
  elite: boolean;
  slow: number;
  burn: number;
  kx: number;
  ky: number;
  flash: number;
  hitCd: number;
  shotCd: number;
  telegraph: number;
  anim: Anim;
  frame: number;
  facing: number;
  animT: number;
  hop: number;
  vx: number;
  vy: number;
};

export type Proj = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  radius: number;
  damage: number;
  type: ShotType;
  friendly: boolean;
  pierce: number;
  splash: number;
  h0: number;
  h1: number;
  h2: number;
};

export type Beam = {
  alive: boolean;
  x: number;
  y: number;
  dx: number;
  dy: number;
  len: number;
  life: number;
  type: ShotType;
};

export type DropKind = "mod" | "type" | "rage" | "gear" | "weapon";

export type Drop = {
  alive: boolean;
  x: number;
  y: number;
  kind: DropKind;
  mod: "speed" | "amount" | null;
  shot: ShotType | null;
  gear: Gear | null;
  weapon: Weapon | null;
  grace: number;
};

export type Part = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  /** Hard square pixels (destroy poof) instead of a soft glow. Transient, never saved. */
  hard?: boolean;
};

export type Prop = {
  x: number;
  y: number;
  r: number;
  kind: "tree" | "boulder" | "pine" | "house";
  /** Art cell for pine/house (terrainArt BUILDING_ART index). */
  art?: number;
};

/** Visual-only ground area (no movement effect): a union of circles [x, y, r]. */
export type TerrainZone = {
  kind: "snow" | "ice" | "water";
  parts: [number, number, number][];
};

export type Hud = {
  hp: number;
  maxHp: number;
  wave: number;
  level: number;
  time: number;
  type: ShotType;
  speed: number;
  amount: number;
  rage: number;
  sealed: boolean;
  banner: string;
  weapon: string;
  weaponKind: WeaponKind | null;
  /** Active gear x spell combo name, or "". */
  combo: string;
  /** Active 30-second wave twist label with seconds left, or "". */
  twist: string;
  /** Active shrine buff label with seconds left, or "". */
  buff: string;
  /** Rift Surge meter 0..1 (1 = ready). */
  surge: number;
  slots: { slot: Slot; name: string; filled: boolean }[];
  kills: number;
  portal: number;
  portalMax: number;
  showPortal: boolean;
  px: number;
  py: number;
  portalX: number;
  portalY: number;
  mode: Mode;
  hero: HeroId;
  clearedLevel: number;
  diffLabel: string;
};

export const MONSTERS: MonsterId[] = [
  "skeleton",
  "orc",
  "zombie",
  "vampire",
  "ghost",
  "minotaur",
  "satyr",
  "sphinx",
  "succubus",
  "incubus",
  "angel",
  "spider",
  "bear",
  "alligator",
  "tiger",
];

export const SLOTS: Slot[] = ["helm", "chest", "arms", "gloves", "legs", "shoes"];

export const SHOTS: ShotType[] = ["bolt", "beam", "wave", "fire", "ice", "water"];

export const RANGED: ReadonlySet<MonsterId> = new Set(["vampire", "angel", "sphinx"]);

export const GHOSTLIKE: ReadonlySet<MonsterId> = new Set(["ghost"]);

export const HOPPERS: ReadonlySet<MonsterId> = new Set(["satyr", "tiger", "spider", "minotaur"]);

export function emptyGear(): Record<Slot, Gear | null> {
  return { helm: null, chest: null, arms: null, gloves: null, legs: null, shoes: null };
}

export function monsterName(id: MonsterId): string {
  if (id === "alligator") return "Alligator";
  return id.charAt(0).toUpperCase() + id.slice(1);
}
