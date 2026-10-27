import { useEffect, useRef, useState } from "react";
import { DIFF, HERO, shotLabel } from "@/game/balance";
import { renderGame, VIEW_ZOOM } from "@/game/render";
import { DEFAULT_BINDS, loadRun, loadSettings, saveSettings } from "@/game/save";
import { Game } from "@/game/sim";
import { iconURL, whenIcons } from "@/game/sprites";
import type { Binds, HeroId, Hud, Mode, Settings, Slot } from "@/game/types";
import { SLOTS } from "@/game/types";

const SLOT_LABEL: Record<Slot, string> = {
  helm: "Helm",
  chest: "Chest",
  arms: "Arms",
  gloves: "Gloves",
  legs: "Legs",
  shoes: "Shoes",
};

function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fullscreenElement(): Element | null {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function toggleFullscreen(el: HTMLElement) {
  if (fullscreenElement()) {
    const doc = document as Document & { webkitExitFullscreen?: () => void };
    if (document.exitFullscreen) void document.exitFullscreen();
    else doc.webkitExitFullscreen?.();
    return;
  }
  const node = el as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (el.requestFullscreen) void el.requestFullscreen();
  else node.webkitRequestFullscreen?.();
}

export function GameApp() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [mode, setMode] = useState<Mode>("menu");
  const [hero, setHero] = useState<HeroId>("wizard");
  const [panel, setPanel] = useState<"none" | "options">("none");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [hasSave, setHasSave] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [stickOn, setStickOn] = useState(false);
  const [capture, setCapture] = useState<keyof Binds | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [hudTick, setHudTick] = useState(0);
  const [full, setFull] = useState(false);
  const [pauseTab, setPauseTab] = useState<"menu" | "gear">("menu");
  const stickId = useRef<number | null>(null);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    setHasSave(loadRun() !== null);
    const paintIcons = () => {
      const nextIcons: Record<string, string> = {};
      for (const slot of SLOTS) nextIcons[slot] = iconURL(slot);
      nextIcons.sword = iconURL("sword");
      nextIcons.staff = iconURL("staff");
      nextIcons.axe = iconURL("axe");
      nextIcons.bow = iconURL("bow");
      if (nextIcons.helm) setIcons(nextIcons);
    };
    paintIcons();
    whenIcons(paintIcons);
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    setStickOn(coarse && !window.matchMedia("(pointer: fine)").matches);
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const game = new Game(loaded);
    gameRef.current = game;
    game.onMode = (next) => setMode(next);
    window.__controlsTest = {
      getYaw: () => game.player.yaw,
      getSpeed: () => Math.hypot(game.player.vx, game.player.vy),
      setKeys: (codes) => game.setProbe(codes),
      showcaseDrops: () => game.showcaseDrops(),
    };
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const portraitMq = window.matchMedia("(orientation: portrait)");
    const fit = () => {
      const on = portraitMq.matches;
      setPortrait(on);
      game.hold = on;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let w = vw;
      let h = (vw * 9) / 16;
      if (h > vh) {
        h = vh;
        w = (h * 16) / 9;
      }
      stage.style.width = `${w}px`;
      stage.style.height = `${h}px`;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(2, Math.floor(w * dpr));
      canvas.height = Math.max(2, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      game.viewW = w;
      game.viewH = h;
    };
    fit();
    const onResize = () => fit();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      setStickOn(false);
      game.bindKey(e.code, true);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => game.bindKey(e.code, false);
    const onBlur = () => {
      game.clearKeys();
      if (game.mode === "playing") game.togglePause();
    };
    const onHide = () => {
      if (document.hidden && game.mode === "playing") game.togglePause();
    };
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * game.viewW;
      const y = ((e.clientY - rect.top) / rect.height) * game.viewH;
      game.aim(game.camX + (x - game.viewW / 2) / VIEW_ZOOM, game.camY + (y - game.viewH / 2) / VIEW_ZOOM, true, e.type === "pointermove");
    };
    const onLeave = () => game.aim(game.player.x, game.player.y, false, false);
    window.addEventListener("resize", onResize);
    const onFs = () => {
      setFull(Boolean(fullscreenElement()));
      fit();
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHide);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    let last = performance.now();
    let hudAcc = 0;
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      game.hold = portraitMq.matches;
      game.frame(dt);
      renderGame(game, ctx, game.viewW, game.viewH, t);
      hudAcc += dt;
      if (hudAcc > 0.12) {
        hudAcc = 0;
        setHudTick((n) => (n + 1) % 1000);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHide);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      delete window.__controlsTest;
    };
  }, []);

  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === "Escape") {
        setCapture(null);
        return;
      }
      setSettings((prev) => {
        if (!prev) return prev;
        const next = { ...prev, binds: { ...prev.binds, [capture]: e.code } };
        saveSettings(next);
        const game = gameRef.current;
        if (game) game.settings = next;
        return next;
      });
      setCapture(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture]);

  const game = gameRef.current;
  const hud = game?.hud;
  const showPlay = mode === "playing" || mode === "paused";
  void hudTick;

  function commit(next: Settings) {
    setSettings(next);
    saveSettings(next);
    const live = gameRef.current;
    if (!live) return;
    live.settings = next;
    live.audio.setVolumes(next.master / 100, next.music / 100, next.sfx / 100);
  }

  function onStick(e: React.PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const m = Math.hypot(dx, dy) || 1;
    const cap = Math.min(1, m / (rect.width * 0.38));
    gameRef.current?.setStick((dx / m) * cap, (dy / m) * cap, true);
  }

  return (
    <main ref={rootRef} className="fixed inset-0 overflow-hidden bg-bg text-fg">
      <div ref={stageRef} className="rift-stage absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 touch-none">
        <canvas ref={canvasRef} className="h-full w-full" />
        {showPlay && hud && (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-40 rounded-md bg-surface/90 px-3 py-2">
                <p className="font-display text-sm text-accent">Rift {hud.level}</p>
                <p className="text-xs text-muted">
                  Wave {hud.wave} · {clock(hud.time)} · {hud.kills} felled
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-md bg-raised">
                  <div className="h-full bg-danger" style={{ width: `${Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100))}%` }} />
                </div>
                <p className="mt-1 text-xs text-fg">
                  {Math.ceil(hud.hp)} / {hud.maxHp}
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-md bg-raised">
                  <div className={hud.surge >= 1 ? "h-full bg-accent" : "h-full bg-spell"} style={{ width: `${Math.round(hud.surge * 100)}%` }} />
                </div>
                {stickOn ? (
                  <p className="text-xs text-muted">{hud.surge >= 1 ? "Surge ready · E / Space" : `Surge ${Math.floor(hud.surge * 100)}%`}</p>
                ) : (
                  // Keyboard layout: always show the Surge keys so the control is discoverable.
                  <p className={hud.surge >= 1 ? "text-xs font-semibold text-accent" : "text-xs text-fg"}>
                    {hud.surge >= 1 ? "Surge ready! Press E / Space" : `Surge ${Math.floor(hud.surge * 100)}% · E / Space`}
                  </p>
                )}
              </div>
              <div className="rounded-md bg-surface/90 px-3 py-2 text-right">
                <p className="font-display text-sm text-spell">{shotLabel(hud.type)}</p>
                <p className="text-xs text-muted">
                  Speed {hud.speed} · Amount {hud.amount}
                </p>
                <p className="text-xs text-fg">{hud.weapon}</p>
                {hud.combo && <p className="text-xs text-accent">Combo: {hud.combo}</p>}
                {hud.twist && <p className="text-xs text-accent">{hud.twist}</p>}
                {hud.buff && <p className="text-xs text-accent">Shrine: {hud.buff}</p>}
                {hud.rage > 0 && <p className="text-xs text-accent">Rage {hud.rage.toFixed(1)}s</p>}
                {hud.sealed && <p className="text-xs text-muted">Portal sealed until wave 5</p>}
              </div>
            </div>
            {hud.banner && (
              <p className="self-center rounded-md bg-surface/90 px-4 py-2 font-display text-accent">{hud.banner}</p>
            )}
            {/* Armor slots live only in the pause menu's Gear tab. Gear auto-equips by tier, so no swap prompt. */}
            <div />
          </div>
        )}
        {stickOn && showPlay && !portrait && (
          <>
            <div
              className="absolute bottom-4 left-4 h-28 w-28 rounded-full border border-raised bg-surface/70"
              onPointerDown={(e) => {
                stickId.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                onStick(e);
              }}
              onPointerMove={(e) => {
                if (stickId.current === e.pointerId) onStick(e);
              }}
              onPointerUp={(e) => {
                if (stickId.current === e.pointerId) {
                  stickId.current = null;
                  gameRef.current?.setStick(0, 0, false);
                }
              }}
            />
            <button
              type="button"
              className="absolute bottom-4 right-4 min-h-11 rounded-md bg-surface px-3 text-fg"
              onClick={() => gameRef.current?.togglePause()}
            >
              Pause
            </button>
            <button
              type="button"
              disabled={(hud?.surge ?? 0) < 1}
              className="absolute bottom-4 right-24 min-h-11 rounded-md bg-surface px-3 text-accent disabled:text-muted"
              onClick={() => gameRef.current?.surge()}
            >
              Surge {(hud?.surge ?? 0) >= 1 ? "!" : `${Math.floor((hud?.surge ?? 0) * 100)}%`}
            </button>
          </>
        )}
        {mode === "menu" && panel === "none" && (
          <section className="absolute inset-0 overflow-y-auto p-4">
            <div className="mx-auto flex min-h-full w-full max-w-md items-center">
            <div className="w-full rounded-md bg-surface/95 p-5">
              <p className="text-xs uppercase tracking-widest text-muted">Dark fantasy</p>
              <h1 className="font-display text-4xl text-accent">Riftwake</h1>
              <p className="mt-2 text-sm text-muted">Run the rift. The portal stays sealed until the fifth wave breaks.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={hero === "wizard" ? "min-h-11 rounded-md border border-accent bg-raised px-3 py-2 text-left" : "min-h-11 rounded-md border border-raised bg-bg px-3 py-2 text-left"}
                  onClick={() => setHero("wizard")}
                >
                  <span className="block font-display text-fg">Wizard</span>
                  <span className="text-xs text-muted">Bolt, longer reach, lighter frame</span>
                </button>
                <button
                  type="button"
                  className={hero === "warrior" ? "min-h-11 rounded-md border border-accent bg-raised px-3 py-2 text-left" : "min-h-11 rounded-md border border-raised bg-bg px-3 py-2 text-left"}
                  onClick={() => setHero("warrior")}
                >
                  <span className="block font-display text-fg">Warrior</span>
                  <span className="text-xs text-muted">Heavy sword bolt, more vitals</span>
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-md bg-accent px-5 font-display text-ink"
                  onClick={() => {
                    gameRef.current?.audio.ensure();
                    gameRef.current?.start(hero);
                    setHasSave(true);
                  }}
                >
                  Start
                </button>
                {hasSave && (
                  <button
                    type="button"
                    className="min-h-11 rounded-md bg-raised px-5 text-fg"
                    onClick={() => gameRef.current?.continueRun()}
                  >
                    Continue
                  </button>
                )}
                <button type="button" className="min-h-11 rounded-md bg-raised px-5 text-fg" onClick={() => setPanel("options")}>
                  Options
                </button>
                <button type="button" className="min-h-11 rounded-md bg-raised px-5 text-fg" onClick={() => rootRef.current && toggleFullscreen(rootRef.current)}>
                  {full ? "Exit full screen" : "Full screen"}
                </button>
              </div>
              <p className="mt-3 text-xs text-muted">
                {HERO[hero].label} selected. WASD moves. Shots seek the nearest foe. {settings ? settingsLabel(settings) : "Rift"} difficulty.
              </p>
            </div>
            </div>
          </section>
        )}
        {panel === "options" && settings && (
          <section className="absolute inset-0 flex items-center justify-center p-4">
            <div className="max-h-full w-full max-w-md overflow-y-auto rounded-md bg-surface p-5">
              <h2 className="font-display text-2xl text-accent">Options</h2>
              <label className="mt-4 block text-sm text-fg">
                Master volume {settings.master}
                <input
                  className="w-full"
                  type="range"
                  min={0}
                  max={100}
                  value={settings.master}
                  onChange={(e) => commit({ ...settings, master: Number(e.target.value) })}
                />
              </label>
              <label className="mt-2 block text-sm text-fg">
                Music {settings.music}
                <input
                  className="w-full"
                  type="range"
                  min={0}
                  max={100}
                  value={settings.music}
                  onChange={(e) => commit({ ...settings, music: Number(e.target.value) })}
                />
              </label>
              <label className="mt-2 block text-sm text-fg">
                Effects {settings.sfx}
                <input
                  className="w-full"
                  type="range"
                  min={0}
                  max={100}
                  value={settings.sfx}
                  onChange={(e) => commit({ ...settings, sfx: Number(e.target.value) })}
                />
              </label>
              <label className="mt-2 block text-sm text-fg">
                Difficulty · {DIFF[settings.difficulty]?.label}
                <input
                  className="w-full"
                  type="range"
                  min={0}
                  max={4}
                  step={1}
                  value={settings.difficulty}
                  onChange={(e) => commit({ ...settings, difficulty: Number(e.target.value) })}
                />
              </label>
              <p className="text-xs text-muted">Higher steps add health, speed, numbers, and contact damage. Rewards stay the same. Applies on the next rift.</p>
              <ul className="mt-3 space-y-2">
                {(Object.keys(DEFAULT_BINDS) as (keyof Binds)[]).map((key) => (
                  <li key={key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-fg">{key}</span>
                    <button type="button" className="min-h-11 rounded-md bg-raised px-3 text-accent" onClick={() => setCapture(key)}>
                      {capture === key ? "Press a key" : bindLabel(settings.binds[key])}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-md bg-raised px-4 text-fg"
                  onClick={() => commit({ ...settings, binds: { ...DEFAULT_BINDS } })}
                >
                  Reset binds
                </button>
                <button type="button" className="min-h-11 rounded-md bg-accent px-4 text-ink" onClick={() => setPanel("none")}>
                  Back
                </button>
                <button type="button" className="min-h-11 rounded-md bg-raised px-4 text-fg" onClick={() => rootRef.current && toggleFullscreen(rootRef.current)}>
                  {full ? "Exit full screen" : "Full screen"}
                </button>
              </div>
            </div>
          </section>
        )}
        {mode === "paused" && panel === "none" && (
          <section className="absolute inset-0 flex items-center justify-center bg-bg/70 p-4">
            <div className="max-h-full w-full max-w-sm overflow-y-auto rounded-md bg-surface p-5">
              <h2 className="font-display text-2xl text-accent">Paused</h2>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={pauseTab === "menu" ? "min-h-11 rounded-md bg-accent px-4 text-ink" : "min-h-11 rounded-md bg-raised px-4 text-fg"}
                  onClick={() => setPauseTab("menu")}
                >
                  Menu
                </button>
                <button
                  type="button"
                  className={pauseTab === "gear" ? "min-h-11 rounded-md bg-accent px-4 text-ink" : "min-h-11 rounded-md bg-raised px-4 text-fg"}
                  onClick={() => setPauseTab("gear")}
                >
                  Gear
                </button>
              </div>
              {pauseTab === "gear" && hud ? (
                <GearBody hud={hud} icons={icons} />
              ) : (
              <div className="mt-4 flex flex-col gap-2">
                <button type="button" className="min-h-11 rounded-md bg-accent px-4 text-ink" onClick={() => gameRef.current?.togglePause()}>
                  Resume
                </button>
                <button type="button" className="min-h-11 rounded-md bg-raised px-4 text-fg" onClick={() => setPanel("options")}>
                  Options
                </button>
                <button type="button" className="min-h-11 rounded-md bg-raised px-4 text-fg" onClick={() => rootRef.current && toggleFullscreen(rootRef.current)}>
                  {full ? "Exit full screen" : "Full screen"}
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-md bg-raised px-4 text-fg"
                  onClick={() => {
                    gameRef.current?.toMenu();
                    setHasSave(loadRun() !== null);
                  }}
                >
                  Quit to menu
                </button>
              </div>
              )}
              <p className="mt-3 text-xs text-muted">Leaving now drops this attempt. The rift restarts from the last seal.</p>
            </div>
          </section>
        )}
        {mode === "dead" && (
          <section className="absolute inset-0 flex items-center justify-center bg-bg/75 p-4">
            <div className="w-full max-w-sm rounded-md bg-surface p-5">
              <h2 className="font-display text-2xl text-danger">You fell</h2>
              <p className="mt-2 text-sm text-muted">This rift resets. Gear from earlier seals is kept.</p>
              <div className="mt-4 flex gap-2">
                <button type="button" className="min-h-11 rounded-md bg-accent px-4 text-ink" onClick={() => gameRef.current?.retry()}>
                  Retry
                </button>
                <button type="button" className="min-h-11 rounded-md bg-raised px-4 text-fg" onClick={() => gameRef.current?.toMenu()}>
                  Menu
                </button>
              </div>
            </div>
          </section>
        )}
        {mode === "clear" && hud && (
          <section className="absolute inset-0 flex items-center justify-center bg-bg/75 p-4">
            <div className="w-full max-w-sm rounded-md bg-surface p-5">
              <h2 className="font-display text-2xl text-accent">Rift {hud.clearedLevel} sealed</h2>
              <p className="mt-2 text-sm text-fg">
                {clock(hud.time)} · wave {hud.wave} · {hud.kills} felled
              </p>
              <p className="text-sm text-muted">{shotLabel(hud.type)} carried forward with your gear.</p>
              <button type="button" className="mt-4 min-h-11 rounded-md bg-accent px-4 text-ink" onClick={() => gameRef.current?.nextLevel()}>
                Continue
              </button>
            </div>
          </section>
        )}
      </div>
      <div role="alert" className="rotate-gate fixed inset-0 z-50 items-center justify-center bg-[#05060a] p-8 text-center">
        <div className="flex flex-col items-center">
          <svg aria-hidden="true" viewBox="0 0 96 96" className="h-28 w-28 text-accent" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="30" y="14" width="36" height="62" rx="6" />
            <line x1="44" y1="66" x2="52" y2="66" />
            <path d="M14 58 a36 36 0 0 0 26 28" />
            <polyline points="30,88 40,86 38,76" />
          </svg>
          <h2 className="mt-8 font-display text-5xl leading-tight text-accent">Rotate your phone</h2>
          <p className="mt-5 max-w-xs text-2xl leading-snug text-white">Turn it sideways to play Riftwake.</p>
        </div>
      </div>
    </main>
  );
}

function GearBody({ hud, icons }: { hud: Hud; icons: Record<string, string> }) {
  const by = new Map(hud.slots.map((row) => [row.slot, row]));
  const spot = (slot: Slot, className: string) => {
    const row = by.get(slot);
    const filled = row?.filled ?? false;
    return (
      <div className={`absolute flex w-14 -translate-x-1/2 flex-col items-center ${className}`} title={filled ? row?.name : "Empty"}>
        {icons[slot] && <img alt={SLOT_LABEL[slot]} src={icons[slot]} className={filled ? "h-8 w-8" : "h-8 w-8 opacity-30"} />}
        <span className={filled ? "text-center text-[10px] leading-tight text-accent" : "text-center text-[10px] leading-tight text-muted"}>
          {SLOT_LABEL[slot]}
        </span>
      </div>
    );
  };
  const weapon = hud.weaponKind;
  return (
    <div className="relative mx-auto mt-4 h-72 w-52">
      <div className="absolute left-1/2 top-9 h-8 w-8 -translate-x-1/2 rounded-full bg-raised/70" />
      <div className="absolute left-1/2 top-[4.6rem] h-16 w-14 -translate-x-1/2 rounded-md bg-raised/70" />
      <div className="absolute left-7 top-[4.8rem] h-14 w-4 rounded-md bg-raised/70" />
      <div className="absolute right-7 top-[4.8rem] h-14 w-4 rounded-md bg-raised/70" />
      <div className="absolute left-1/2 top-40 h-14 w-10 -translate-x-1/2 rounded-md bg-raised/70" />
      <div className="absolute left-[42%] top-56 h-5 w-3 rounded-sm bg-raised/70" />
      <div className="absolute right-[42%] top-56 h-5 w-3 rounded-sm bg-raised/70" />
      {spot("helm", "left-1/2 top-0")}
      {spot("arms", "left-3 top-16")}
      {spot("chest", "left-1/2 top-16")}
      {spot("gloves", "left-3 top-32")}
      {spot("legs", "left-1/2 top-36")}
      {spot("shoes", "left-1/2 top-52")}
      <div className="absolute right-0 top-28 flex w-14 flex-col items-center" title={weapon ? hud.weapon : "No weapon"}>
        {weapon && icons[weapon] && <img alt={hud.weapon} src={icons[weapon]} className="h-8 w-8" />}
        <span className={weapon ? "text-center text-[10px] leading-tight text-accent" : "text-center text-[10px] leading-tight text-muted"}>
          {weapon ? hud.weapon : "Weapon"}
        </span>
      </div>
    </div>
  );
}

function bindLabel(code: string): string {
  return code.replace("Key", "").replace("Digit", "");
}

function settingsLabel(settings: Settings): string {
  return DIFF[settings.difficulty]?.label ?? "Rift";
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys: (codes: string[]) => void;
      showcaseDrops: () => void;
    };
  }
}
