import type { Binds, RunSave, Settings } from "@/game/types";
import { emptyGear } from "@/game/types";

const SETTINGS_KEY = "riftwake-settings-v1";
const RUN_KEY = "riftwake-run-v1";

export const DEFAULT_BINDS: Binds = {
  up: "KeyW",
  down: "KeyS",
  left: "KeyA",
  right: "KeyD",
  equip: "KeyE",
  pause: "Escape",
};

export function defaultSettings(): Settings {
  return {
    version: 1,
    difficulty: 2,
    master: 70,
    music: 42,
    sfx: 70,
    binds: { ...DEFAULT_BINDS },
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as Settings;
    if (parsed.version !== 1 || !parsed.binds) return defaultSettings();
    return {
      ...defaultSettings(),
      ...parsed,
      binds: { ...DEFAULT_BINDS, ...parsed.binds },
      difficulty: clamp(parsed.difficulty, 0, 4),
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadRun(): RunSave | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunSave;
    if (parsed.version !== 1 || !parsed.mods || !parsed.gear) return null;
    // Older saves carry a removed "spread" mod; drop it so the run still loads.
    const { spread: _spread, ...mods } = parsed.mods as RunSave["mods"] & { spread?: unknown };
    return { ...parsed, mods };
  } catch {
    return null;
  }
}

export function saveRun(run: RunSave): void {
  localStorage.setItem(RUN_KEY, JSON.stringify(run));
}

export function blankGear() {
  return emptyGear();
}

function clamp(n: number, a: number, b: number): number {
  if (Number.isNaN(n)) return a;
  return Math.max(a, Math.min(b, Math.round(n)));
}
