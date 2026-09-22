import { PixiRenderer } from './PixiRenderer';

const renderers = new Map<string, PixiRenderer>();
const pending = new Map<string, Promise<PixiRenderer>>();
const failed = new Set<string>();

type PixiSessionRef = {
  id: string;
  host: HTMLElement;
};

/** Get or create a PixiRenderer for a session (async init). */
export async function ensurePixi(ref: PixiSessionRef): Promise<PixiRenderer> {
  if (failed.has(ref.id)) {
    throw new Error('Pixi init previously failed for this session');
  }

  const existing = renderers.get(ref.id);
  if (existing?.isReady()) return existing;

  const inflight = pending.get(ref.id);
  if (inflight) return inflight;

  const promise = (async () => {
    const renderer = existing ?? new PixiRenderer();
    try {
      await renderer.init(ref.host);
      renderers.set(ref.id, renderer);
      return renderer;
    } catch (err) {
      failed.add(ref.id);
      renderer.destroy();
      renderers.delete(ref.id);
      throw err;
    } finally {
      pending.delete(ref.id);
    }
  })();

  pending.set(ref.id, promise);
  return promise;
}

export function getPixi(sessionId: string): PixiRenderer | null {
  return renderers.get(sessionId) ?? null;
}

export function destroyPixi(sessionId: string): void {
  const r = renderers.get(sessionId);
  if (r) {
    r.destroy();
    renderers.delete(sessionId);
  }
  pending.delete(sessionId);
  failed.delete(sessionId);
}

export function destroyAllPixi(): void {
  for (const id of [...renderers.keys(), ...failed]) destroyPixi(id);
  failed.clear();
}

/** True while a session is still booting Pixi (avoid spawning parallel inits). */
export function isPixiPending(sessionId: string): boolean {
  return pending.has(sessionId);
}

export function isPixiFailed(sessionId: string): boolean {
  return failed.has(sessionId);
}
