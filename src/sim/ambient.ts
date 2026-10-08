import { getPerfProfile } from './perf';
import type { SimState } from './state';

const GLOW_FADE_MS = 2000;

let bleedCanvas: HTMLCanvasElement | null = null;
let lastBleedKey = '';

let glowFrom = { r: 107, g: 114, b: 128 };
let glowTo = { r: 107, g: 114, b: 128 };
let glowRgb = { r: 107, g: 114, b: 128 };
let glowLerpStart = 0;
let glowTargetHex = '';
let glowAnimating = false;

function parseHex(hex: string): { r: number; g: number; b: number } {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgba(rgb: { r: number; g: number; b: number }, alpha: number): string {
  // Keep ambient tints muted so they sit under the dark-gray page base.
  const dim = 0.42;
  return `rgba(${Math.round(rgb.r * dim)}, ${Math.round(rgb.g * dim)}, ${Math.round(rgb.b * dim)}, ${alpha})`;
}

function ensureBleedCanvas(): HTMLCanvasElement {
  if (bleedCanvas && document.body.contains(bleedCanvas)) return bleedCanvas;
  const existing = document.getElementById('pageBleed');
  if (existing instanceof HTMLCanvasElement) {
    bleedCanvas = existing;
    return existing;
  }
  const created = document.createElement('canvas');
  created.id = 'pageBleed';
  created.className = 'page-bleed';
  created.setAttribute('aria-hidden', 'true');
  document.body.prepend(created);
  bleedCanvas = created;
  return created;
}

/** Arena canvas only (not the floating toolbar), with sim-wrapper translate undone. */
function arenaBleedRect(canvas: HTMLCanvasElement): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
} {
  const el =
    canvas.closest('.canvas-container') ??
    canvas.parentElement ??
    canvas;
  const rect = el.getBoundingClientRect();
  const wrapper = document.getElementById('simWrapper');
  if (!wrapper) {
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  const matrix = new DOMMatrixReadOnly(getComputedStyle(wrapper).transform);
  const dx = matrix.m41;
  const dy = matrix.m42;
  return {
    left: rect.left - dx,
    right: rect.right - dx,
    top: rect.top - dy,
    bottom: rect.bottom - dy,
    width: rect.width,
    height: rect.height,
  };
}

function majorityGlowHex(state: SimState): string {
  const n = state.physicsOptions.gridSize;
  if (n <= 0 || !state.grid.length) return '#6b7280';

  let day = 0;
  for (let r = 0; r < n; r++) {
    const row = state.grid[r];
    if (!row) continue;
    for (let c = 0; c < n; c++) {
      if (row[c] === 0) day++;
    }
  }
  const night = n * n - day;
  if (day > night) return state.themes[0].ballColor;
  if (night > day) return state.themes[1].ballColor;
  return '#6b7280';
}

function setGlowTarget(hex: string, now: number): void {
  if (hex === glowTargetHex) return;
  if (!glowTargetHex) {
    glowTargetHex = hex;
    glowTo = parseHex(hex);
    glowFrom = { ...glowTo };
    glowRgb = { ...glowTo };
    glowAnimating = false;
    return;
  }
  glowFrom = { ...glowRgb };
  glowTo = parseHex(hex);
  glowTargetHex = hex;
  glowLerpStart = now;
  glowAnimating = true;
}

function advanceGlow(now: number): void {
  if (!glowAnimating) {
    glowRgb = { ...glowTo };
    return;
  }
  const t = Math.min(1, (now - glowLerpStart) / GLOW_FADE_MS);
  const u = t * t * (3 - 2 * t);
  glowRgb = {
    r: Math.round(glowFrom.r + (glowTo.r - glowFrom.r) * u),
    g: Math.round(glowFrom.g + (glowTo.g - glowFrom.g) * u),
    b: Math.round(glowFrom.b + (glowTo.b - glowFrom.b) * u),
  };
  if (t >= 1) glowAnimating = false;
}

/**
 * Soft majority-colored halo around the arena, fading to black.
 * White when both sides are tied. Color crossfades ~1s when lead changes.
 */
export function updatePageBleed(state: SimState, force = false, now = performance.now()): boolean {
  const perf = getPerfProfile();
  if (!perf.pageBleed) {
    const existing = document.getElementById('pageBleed');
    if (existing) existing.style.display = 'none';
    return false;
  }

  const canvas = ensureBleedCanvas();
  canvas.style.display = '';
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const dpr = perf.bleedDpr;

  const stage = arenaBleedRect(state.canvas);
  const n = state.physicsOptions.gridSize;
  if (n <= 0 || stage.width <= 0) return false;

  setGlowTarget(majorityGlowHex(state), now);
  advanceGlow(now);

  const key = [
    vw,
    vh,
    Math.round(stage.left),
    Math.round(stage.top),
    Math.round(stage.width),
    glowRgb.r,
    glowRgb.g,
    glowRgb.b,
  ].join('|');
  if (!force && !glowAnimating && key === lastBleedKey && canvas.width > 0) return false;
  lastBleedKey = key;

  const cssW = vw;
  const cssH = vh;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return glowAnimating;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const cx = stage.left + stage.width * 0.5;
  const cy = stage.top + stage.height * 0.5;
  const baseR = Math.hypot(stage.width * 0.5, stage.height * 0.5);
  const innerR = baseR * 0.78;
  const outerR = baseR + Math.min(stage.width, stage.height) * 0.48;

  const g = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  g.addColorStop(0, rgba(glowRgb, 0.28));
  g.addColorStop(0.32, rgba(glowRgb, 0.12));
  g.addColorStop(0.62, rgba(glowRgb, 0.035));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cssW, cssH);

  return glowAnimating;
}

export function invalidatePageBleed(): void {
  lastBleedKey = '';
}
