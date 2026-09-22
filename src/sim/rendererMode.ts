/** Global A/B renderer mode (persisted separately from per-sim gfx). */

export type RendererMode = 'canvas2d' | 'pixi';

const STORAGE_KEY = 'duality_renderer_mode_v1';

let mode: RendererMode = 'canvas2d';
let loaded = false;

export function getRendererMode(): RendererMode {
  if (!loaded) {
    loaded = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'pixi' || raw === 'canvas2d') mode = raw;
    } catch {
      /* ignore */
    }
  }
  return mode;
}

export function setRendererMode(next: RendererMode): void {
  mode = next;
  loaded = true;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
}
