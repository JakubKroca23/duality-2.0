import './style.css';
import { bindControls, closeSettingsPanel, syncColorsUI } from './ui/controls';
import {
  bootstrapSessions,
  getBleedState,
  getSessions,
  resizeAllSessions,
  tickSessionMeta,
} from './ui/sessions';
import { invalidatePageBleed, updatePageBleed } from './sim/ambient';
import { updateBallPhysics, updateParticles, updateCollisionFlashes, resizeCanvas, resetSimulation } from './sim/physics';
import { draw, tickRunStats, updateScoreboard, updateShaderTrails } from './sim/render';
import { getRendererMode } from './sim/rendererMode';
import { destroyPixi, ensurePixi, getPixi, isPixiFailed, isPixiPending } from './sim/pixi/sessionPixi';
import { createInitialState } from './sim/state';

const canvas = document.getElementById('simCanvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing #simCanvas');
}

const state = createInitialState(canvas);

bootstrapSessions(state, {
  closeSettings: () => closeSettingsPanel(),
  syncActive: (s, root) => {
    syncColorsUI(s);
    updateScoreboard(s, root);
    const scan = root.querySelector<HTMLElement>('[data-role="shader-scanlines"]');
    if (scan) scan.style.opacity = s.gfxOptions.scanlines ? '0.65' : '0';
  },
});

bindControls();

let lastTime = 0;
let lastScoreUpdate = 0;
let lastBleedUpdate = 0;
let bleedNeedsRefresh = true;

function gameLoop(timestamp: number): void {
  if (!lastTime) lastTime = timestamp;
  const deltaSeconds = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  const sessions = getSessions();
  let activeGridDirty = false;

  for (const session of sessions) {
    const s = session.state;
    if (s.isRunning) {
      s.balls.forEach((b) => updateBallPhysics(s, b, deltaSeconds));
      updateParticles(s);
      updateCollisionFlashes(s, deltaSeconds);
      updateShaderTrails(s, deltaSeconds);
      tickRunStats(s, deltaSeconds);
    }

    if (timestamp - lastScoreUpdate > 100) {
      updateScoreboard(s, session.root);
    }

    const gridWasDirty = s.gridDirty;
    const mode = getRendererMode();
    if (mode === 'pixi') {
      const host =
        (session.root.querySelector('[data-role="arena-frame"]') as HTMLElement | null) ??
        s.canvas.parentElement;
      if (host) {
        const ready = getPixi(session.id);
        if (ready?.isReady()) {
          ready.render(s);
        } else if (!isPixiPending(session.id) && !isPixiFailed(session.id)) {
          void ensurePixi({ id: session.id, host }).catch((err) => {
            console.error('[pixi] init failed, falling back to canvas2d for this session', err);
          });
        } else if (isPixiFailed(session.id)) {
          draw(s);
        }
      }
    } else {
      if (getPixi(session.id) || isPixiFailed(session.id)) destroyPixi(session.id);
      draw(s);
    }
    if (!session.minimized && gridWasDirty) activeGridDirty = true;
  }

  if (timestamp - lastScoreUpdate > 100) {
    tickSessionMeta();
    lastScoreUpdate = timestamp;
  }

  const bleedState = getBleedState();
  if (bleedState) {
    const bleedAnimating = updatePageBleed(
      bleedState,
      activeGridDirty || bleedNeedsRefresh,
      timestamp,
    );
    if (bleedAnimating || activeGridDirty || bleedNeedsRefresh || timestamp - lastBleedUpdate > 250) {
      lastBleedUpdate = timestamp;
    }
  }
  if (activeGridDirty || bleedNeedsRefresh) {
    bleedNeedsRefresh = false;
  }

  requestAnimationFrame(gameLoop);
}

const bootSession = getSessions()[0];
if (bootSession) {
  resizeCanvas(bootSession.state);
  resetSimulation(bootSession.state, () => {
    syncColorsUI(bootSession.state);
    updateScoreboard(bootSession.state, bootSession.root);
    bleedNeedsRefresh = true;
  });
  window.setTimeout(() => resizeCanvas(bootSession.state), 50);
}

window.addEventListener('resize', () => {
  invalidatePageBleed();
  resizeAllSessions();
  bleedNeedsRefresh = true;
});
window.addEventListener(
  'scroll',
  () => {
    invalidatePageBleed();
    bleedNeedsRefresh = true;
  },
  { passive: true },
);

requestAnimationFrame(gameLoop);
