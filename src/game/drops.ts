import type { Drop, ShotType } from "@/game/types";

/**
 * World-drop look. Every power-up that changes projectile function or type has its own
 * neon hue (shot types match their spell colour in render.ts). Gear and weapons use a
 * framed gold plate instead of a neon orb, so they never read as power-ups.
 */
export const DROP_ICON_WORLD = 40; // ≈23 CSS px at VIEW_ZOOM 0.58
export const DROP_HALO_WORLD = 30;

export const SHOT_HEX: Record<ShotType, string> = {
  bolt: "#5ef2ff",
  beam: "#ff4ad8",
  wave: "#b46bff",
  fire: "#ff7a29",
  ice: "#d7f4ff",
  water: "#2ee0c0",
};

export type PowerKey = ShotType | "speed" | "amount" | "rage";

export const POWER_HEX: Record<PowerKey, string> = {
  ...SHOT_HEX,
  speed: "#ffe94a",
  amount: "#7dff5a",
  rage: "#ff2e4d",
};

export const POWER_GLYPH: Record<PowerKey, string> = {
  bolt: "B",
  beam: "|",
  wave: "~",
  fire: "F",
  ice: "*",
  water: "W",
  speed: "»",
  amount: "+",
  rage: "!",
};

export const GEAR_HEX = "#e0b15a";

export function powerKey(d: Pick<Drop, "kind" | "mod" | "shot">): PowerKey | null {
  if (d.kind === "rage") return "rage";
  if (d.kind === "type" && d.shot) return d.shot;
  if (d.kind === "mod" && d.mod) return d.mod;
  return null;
}
