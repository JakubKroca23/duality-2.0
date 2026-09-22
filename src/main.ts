import './style.css';
import { bindControls, syncColorsUI } from './ui/controls';
import { invalidatePageBleed, updatePageBleed } from './sim/ambient';
import { updateBallPhysics, updateParticles, updateCollisionFlashes, resizeCanvas, resetSimulation } from './sim/physics';
import { draw, updateScoreboard, updateShaderTrails } from './sim/render';
import { createInitialState } from './sim/state';

const canvas = document.getElementById('simCanvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing #simCanvas');
}

const state = createInitialState(canvas);
bindControls(state);

let lastTime = 0;
let lastScoreUpdate = 0;
let lastBleedUpdate = 0;
let bleedNeedsRefresh = true;

function gameLoop(timestamp: number): void {
  if (!lastTime) lastTime = timestamp;
  const deltaSeconds = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  if (state.isRunning) {
    state.balls.forEach((b) => updateBallPhysics(state, b, deltaSeconds));
    updateParticles(state);
    updateCollisionFlashes(state, deltaSeconds);
    updateShaderTrails(state, deltaSeconds);

    if (timestamp - lastScoreUpdate > 100) {
      updateScoreboard(state);
      lastScoreUpdate = timestamp;
    }
  }

  const gridWasDirty = state.gridDirty;
  draw(state);

  const bleedAnimating = updatePageBleed(
    state,
    gridWasDirty || bleedNeedsRefresh,
    timestamp,
  );
  if (bleedAnimating || gridWasDirty || bleedNeedsRefresh || timestamp - lastBleedUpdate > 250) {
    lastBleedUpdate = timestamp;
  }
  if (gridWasDirty || bleedNeedsRefresh) {
    bleedNeedsRefresh = false;
  }

  requestAnimationFrame(gameLoop);
}

resizeCanvas(state);
resetSimulation(state, () => {
  syncColorsUI(state);
  updateScoreboard(state);
  bleedNeedsRefresh = true;
});

window.addEventListener('resize', () => {
  invalidatePageBleed();
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
