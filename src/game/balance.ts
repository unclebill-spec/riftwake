import type { Gear, HeroId, Mods, ShotType, Slot, Weapon, WeaponKind } from "@/game/types";

export const ARENA = 3800;
export const TILE = 48;
export const STEP = 1 / 60;

export const DIFF = [
  { label: "Gentle", hp: 0.82, speed: 0.9, count: 0.78, dmg: 0.8 },
  { label: "Steady", hp: 0.92, speed: 0.96, count: 0.9, dmg: 0.92 },
  { label: "Rift", hp: 1, speed: 1, count: 1, dmg: 1 },
  { label: "Brutal", hp: 1.2, speed: 1.06, count: 1.14, dmg: 1.16 },
  { label: "Nightmare", hp: 1.42, speed: 1.12, count: 1.28, dmg: 1.34 },
] as const;

export const HERO = {
  wizard: { hp: 86, speed: 176, radiusMul: 1.18, label: "Wizard" },
  warrior: { hp: 128, speed: 164, radiusMul: 0.86, label: "Warrior" },
} as const;

/** Tuned so a default Rift clear lands near 10–16 minutes, not a scripted clock. */
export const PORTAL_HP = 46000;
export const PORTAL_REGEN = 26;
export const PORTAL_HP_WAVE = 0.86;
export const PORTAL_REGEN_WAVE = 0.74;

const GEAR_WORD: Record<Slot, string[]> = {
  helm: ["Dented Helm", "Banded Helm", "Rift Helm", "Astral Crown", "Eclipse Helm", "Star Helm"],
  chest: ["Threadbare Mail", "Riveted Chest", "Rift Plate", "Astral Cuirass", "Eclipse Plate", "Star Plate"],
  arms: ["Frayed Sleeves", "Banded Arms", "Rift Vambrace", "Astral Sleeves", "Eclipse Arms", "Star Vambrace"],
  gloves: ["Worn Gloves", "Grip Gloves", "Rift Gauntlets", "Astral Gloves", "Eclipse Grasp", "Star Gauntlets"],
  legs: ["Torn Leggings", "Banded Legs", "Rift Greaves", "Astral Legs", "Eclipse Greaves", "Star Greaves"],
  shoes: ["Soft Shoes", "Nail Boots", "Rift Treads", "Astral Shoes", "Eclipse Boots", "Star Treads"],
};

const WEAPON_WORD: Record<WeaponKind, string[]> = {
  sword: ["Notched Sword", "Keen Sword", "Rift Blade", "Astral Edge", "Eclipse Sword", "Star Blade"],
  staff: ["Split Staff", "Channel Staff", "Rift Staff", "Astral Rod", "Eclipse Staff", "Star Rod"],
  axe: ["Chipped Axe", "Cleaving Axe", "Rift Axe", "Astral Cleaver", "Eclipse Axe", "Star Cleaver"],
  bow: ["Short Bow", "Recurve Bow", "Rift Bow", "Astral Bow", "Eclipse Bow", "Star Bow"],
};

function tierIndex(tier: number): number {
  return Math.max(0, Math.min(5, tier - 1));
}

export function makeGear(slot: Slot, tier: number): Gear {
  const t = Math.max(1, Math.min(6, tier));
  const big = 6 + t * 8;
  const small = 2 + t * 2;
  let hp = small;
  let def = 0.012 + t * 0.008;
  let radius = 4 + t * 2;
  if (slot === "chest") {
    hp = big * 2;
    def = 0.01 + t * 0.006;
    radius = 2 + t;
  } else if (slot === "legs") {
    hp = small;
    def = 0.045 + t * 0.028;
    radius = 2 + t;
  } else if (slot === "helm") {
    hp = small;
    def = 0.01 + t * 0.005;
    radius = 14 + t * 10;
  }
  return {
    slot,
    tier: t,
    name: GEAR_WORD[slot][tierIndex(t)] ?? "Gear",
    hp,
    def,
    radius,
  };
}

export function makeWeapon(kind: WeaponKind, tier: number): Weapon {
  const t = Math.max(1, Math.min(6, tier));
  return { kind, tier: t, name: WEAPON_WORD[kind][tierIndex(t)] ?? "Weapon" };
}

export function gearLines(g: Gear | null): string {
  if (!g) return "Empty";
  const def = Math.round(g.def * 100);
  return `+${g.hp} vitals · ${def}% defense · +${g.radius} reach`;
}

export function weaponLine(w: Weapon | null): string {
  if (!w) return "Bare hands — plain shots";
  if (w.kind === "sword") return "Faster, shorter shots";
  if (w.kind === "staff") return "Beams and waves hit harder";
  if (w.kind === "axe") return "Slow, heavy, small cleave";
  return "Fast shots that pierce";
}

export function shotLabel(t: ShotType): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function freshMods(hero: HeroId): Mods {
  return { speed: hero === "warrior" ? 0 : 1, amount: 0, type: "bolt" };
}

export function describeMods(mods: Mods): string {
  return `${shotLabel(mods.type)} · speed ${mods.speed} · amount ${mods.amount}`;
}
