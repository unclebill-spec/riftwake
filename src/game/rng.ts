export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(seed: number, x: number, y: number): number {
  let n = (seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** 0 faces north (world −Y). Positive yaw turns toward west (screen left). */
export function yawFromVelocity(vx: number, vy: number): number {
  return Math.atan2(-vx, -vy);
}

export function facingFromYaw(yaw: number): number {
  const cw = -yaw;
  const index = Math.round(cw / (Math.PI / 4));
  return ((index % 8) + 8) % 8;
}

/** Keep the current facing when yaw sits on a boundary so the sprite does not flicker. */
export function facingHeld(yaw: number, current: number): number {
  const cw = -yaw / (Math.PI / 4);
  const nearest = Math.round(cw);
  const next = ((nearest % 8) + 8) % 8;
  const frac = Math.abs(cw - nearest);
  if (frac > 0.28) {
    const lo = ((Math.floor(cw) % 8) + 8) % 8;
    const hi = ((Math.ceil(cw) % 8) + 8) % 8;
    const held = ((current % 8) + 8) % 8;
    if (held === lo || held === hi) return held;
  }
  return next;
}

export function dirFromYaw(yaw: number): { x: number; y: number } {
  return { x: -Math.sin(yaw), y: -Math.cos(yaw) };
}
