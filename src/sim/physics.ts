import {
  ARENA_WIDTH_METERS,
  TYPE_DAY,
  TYPE_NIGHT,
} from '../config/constants';
import { Ball } from './Ball';
import { playBounceSound } from './audio';
import { markGridDirty } from './render';
import type { SimState } from './state';

export function ballRadiusFor(state: SimState): number {
  const scale = Math.max(0.25, (state.gfxOptions.ballScale || 100) / 100);
  // Arena-relative (matches former look at ~20×20 grid)
  return Math.max(1.2, state.boardWidth * 0.0055 * scale);
}

export function applyBallRadii(state: SimState): void {
  const r = ballRadiusFor(state);
  state.balls.forEach((ball) => {
    ball.radius = r;
  });
}

export function spawnParticles(state: SimState, x: number, y: number, color: string): void {
  if (state.gfxOptions.particleCount <= 0) return;
  const w = Math.max(1, state.boardWidth);
  for (let i = 0; i < state.gfxOptions.particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = w * (0.0018 + Math.random() * 0.0042);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: w * (0.002 + Math.random() * 0.0035),
      life: 1.0,
      color,
    });
  }
}

export function spawnCollisionFlash(
  state: SimState,
  x: number,
  y: number,
  type: number,
): void {
  const side = (type === 1 ? 1 : 0) as 0 | 1;
  const cfg = state.gfxOptions.collisionShader;
  if (!cfg.enabled || cfg.strength <= 0) return;
  const maxLife = Math.max(0.05, cfg.fadeMs / 1000);
  state.collisionFlashes.push({
    x,
    y,
    type: side,
    life: maxLife,
    maxLife,
  });
}

export function updateCollisionFlashes(state: SimState, deltaSeconds: number): void {
  for (let i = state.collisionFlashes.length - 1; i >= 0; i--) {
    state.collisionFlashes[i].life -= deltaSeconds;
    if (state.collisionFlashes[i].life <= 0) state.collisionFlashes.splice(i, 1);
  }
}

export function updateParticles(state: SimState): void {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.045;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}

export function resizeCanvas(state: SimState): void {
  const { canvas, ctx } = state;
  const container = canvas.parentElement;
  if (!container) return;
  const size = Math.floor(container.clientWidth);
  if (size <= 0) return;

  const oldWidth = state.boardWidth;
  const dpr = window.devicePixelRatio || 1;
  const framePad = Math.max(8, Math.min(18, Math.round(size * 0.022)));
  const board = Math.max(32, size - framePad * 2);

  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.resetTransform();
  ctx.scale(dpr, dpr);

  state.framePad = framePad;
  state.boardWidth = board;
  state.cellSize = state.boardWidth / state.physicsOptions.gridSize;

  if (oldWidth > 0 && oldWidth !== state.boardWidth) {
    const scale = state.boardWidth / oldWidth;
    state.balls.forEach((ball) => {
      ball.x *= scale;
      ball.y *= scale;
      ball.history.forEach((p) => {
        p.x *= scale;
        p.y *= scale;
      });
    });
    state.particles.forEach((p) => {
      p.x *= scale;
      p.y *= scale;
    });
    state.collisionFlashes.forEach((f) => {
      f.x *= scale;
      f.y *= scale;
    });
    state.lightEchoes.forEach((e) => {
      e.x *= scale;
      e.y *= scale;
    });
    state.reflectionEchoes.forEach((e) => {
      e.x *= scale;
      e.y *= scale;
    });
    state.balls.forEach((ball) => {
      if (Number.isFinite(ball.lightTrailX)) {
        ball.lightTrailX *= scale;
        ball.lightTrailY *= scale;
      }
    });
  }

  state.balls.forEach((ball) => {
    ball.radius = ballRadiusFor(state);
  });
}

export function resetSimulation(state: SimState, onAfter?: () => void): void {
  const gridSize = state.physicsOptions.gridSize;
  state.grid = [];
  for (let r = 0; r < gridSize; r++) {
    const row: number[] = [];
    for (let c = 0; c < gridSize; c++) {
      row.push(c < gridSize / 2 ? TYPE_DAY : TYPE_NIGHT);
    }
    state.grid.push(row);
  }
  markGridDirty(state);

  state.particles = [];
  state.collisionFlashes = [];
  state.lightEchoes = [];
  state.reflectionEchoes = [];

  const leftCenterX = (gridSize / 4) * state.cellSize + state.cellSize / 2;
  const rightCenterX = ((3 * gridSize) / 4) * state.cellSize + state.cellSize / 2;
  const centerY = (gridSize / 2) * state.cellSize;

  state.balls = [];
  const count = state.physicsOptions.ballsPerSide;
  for (let i = 0; i < count; i++) {
    const offset =
      count > 1 ? (i / (count - 1) - 0.5) * (gridSize * state.cellSize * 0.45) : 0;
    state.balls.push(new Ball(TYPE_DAY, leftCenterX, centerY + offset));
    state.balls.push(new Ball(TYPE_NIGHT, rightCenterX, centerY - offset));
  }

  applyBallRadii(state);

  onAfter?.();
}

export function updateBallPhysics(state: SimState, ball: Ball, deltaSeconds: number): void {
  const gridSize = state.physicsOptions.gridSize;
  const { boardWidth, cellSize, gfxOptions } = state;
  const pxPerMeter = boardWidth / ARENA_WIDTH_METERS;
  const totalDistPx = state.physicsOptions.speedMps * pxPerMeter * deltaSeconds;

  const maxStepSize = cellSize * 0.16;
  const steps = Math.max(4, Math.ceil(totalDistPx / maxStepSize));
  const stepDist = totalDistPx / steps;

  for (let step = 0; step < steps; step++) {
    ball.x += ball.vx * stepDist;
    ball.y += ball.vy * stepDist;

    if (ball.x - ball.radius <= 0) {
      ball.x = ball.radius;
      ball.vx = Math.abs(ball.vx);
      playBounceSound(state, ball.type);
    } else if (ball.x + ball.radius >= boardWidth) {
      ball.x = boardWidth - ball.radius;
      ball.vx = -Math.abs(ball.vx);
      playBounceSound(state, ball.type);
    }

    if (ball.y - ball.radius <= 0) {
      ball.y = ball.radius;
      ball.vy = Math.abs(ball.vy);
      playBounceSound(state, ball.type);
    } else if (ball.y + ball.radius >= boardWidth) {
      ball.y = boardWidth - ball.radius;
      ball.vy = -Math.abs(ball.vy);
      playBounceSound(state, ball.type);
    }

    const centerCol = Math.floor(ball.x / cellSize);
    const centerRow = Math.floor(ball.y / cellSize);
    let collided = false;

    for (let r = Math.max(0, centerRow - 1); r <= Math.min(gridSize - 1, centerRow + 1); r++) {
      for (let c = Math.max(0, centerCol - 1); c <= Math.min(gridSize - 1, centerCol + 1); c++) {
        if (state.grid[r][c] !== ball.type) {
          const tileLeft = c * cellSize;
          const tileTop = r * cellSize;
          const tileRight = tileLeft + cellSize;
          const tileBottom = tileTop + cellSize;

          const closestX = Math.max(tileLeft, Math.min(ball.x, tileRight));
          const closestY = Math.max(tileTop, Math.min(ball.y, tileBottom));

          const distX = ball.x - closestX;
          const distY = ball.y - closestY;
          const distSq = distX * distX + distY * distY;

          if (distSq < ball.radius * ball.radius) {
            state.grid[r][c] = ball.type;
            markGridDirty(state);
            collided = true;

            spawnParticles(state, closestX, closestY, state.themes[ball.type].ballColor);
            spawnCollisionFlash(state, closestX, closestY, ball.type);
            playBounceSound(state, ball.type);

            if (Math.abs(distX) > Math.abs(distY)) {
              ball.vx = distX > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx);
              ball.x = closestX + (distX > 0 ? ball.radius : -ball.radius);
            } else {
              ball.vy = distY > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy);
              ball.y = closestY + (distY > 0 ? ball.radius : -ball.radius);
            }

            ball.setDirection(ball.vx, ball.vy);
            break;
          }
        }
      }
      if (collided) break;
    }
  }

  if (gfxOptions.maxTrail > 0) {
    ball.history.push({ x: ball.x, y: ball.y });
    while (ball.history.length > gfxOptions.maxTrail) ball.history.shift();
  } else {
    ball.history = [];
  }
}
