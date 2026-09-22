import {
  ARENA_WIDTH_METERS,
  TYPE_DAY,
  TYPE_NIGHT,
  type HeadlessBall,
  type HeadlessState,
  type PhysicsConfig,
  type Side,
  type TerritorySample,
} from './types.js';

const VIRTUAL_BOARD = 1000;

function ballRadius(boardWidth: number, ballScale: number): number {
  const scale = Math.max(0.25, (ballScale || 100) / 100);
  return Math.max(1.2, boardWidth * 0.0055 * scale);
}

function makeBall(type: Side, x: number, y: number, radius: number): HeadlessBall {
  let angle = Math.random() * Math.PI * 2;
  while (Math.abs(Math.sin(angle)) < 0.25 || Math.abs(Math.cos(angle)) < 0.25) {
    angle = Math.random() * Math.PI * 2;
  }
  return {
    type,
    x,
    y,
    radius,
    vx: Math.cos(angle),
    vy: Math.sin(angle),
  };
}

function setDirection(ball: HeadlessBall, dx: number, dy: number): void {
  const len = Math.hypot(dx, dy) || 1;
  ball.vx = dx / len;
  ball.vy = dy / len;
}

export function createHeadlessState(
  physics: Partial<PhysicsConfig> = {},
  boardWidth = VIRTUAL_BOARD,
): HeadlessState {
  const cfg: PhysicsConfig = {
    speedMps: physics.speedMps ?? 6,
    ballsPerSide: Math.max(1, Math.min(9, Math.round(physics.ballsPerSide ?? 1))),
    gridSize: Math.max(3, Math.min(512, Math.round(physics.gridSize ?? 20))),
    ballScale: Math.max(50, Math.min(200, physics.ballScale ?? 100)),
  };

  const cellSize = boardWidth / cfg.gridSize;
  const grid: number[][] = [];
  for (let r = 0; r < cfg.gridSize; r++) {
    const row: number[] = [];
    for (let c = 0; c < cfg.gridSize; c++) {
      row.push(c < cfg.gridSize / 2 ? TYPE_DAY : TYPE_NIGHT);
    }
    grid.push(row);
  }

  const r = ballRadius(boardWidth, cfg.ballScale);
  const leftCenterX = (cfg.gridSize / 4) * cellSize + cellSize / 2;
  const rightCenterX = ((3 * cfg.gridSize) / 4) * cellSize + cellSize / 2;
  const centerY = (cfg.gridSize / 2) * cellSize;

  const balls: HeadlessBall[] = [];
  for (let i = 0; i < cfg.ballsPerSide; i++) {
    const offset =
      cfg.ballsPerSide > 1
        ? (i / (cfg.ballsPerSide - 1) - 0.5) * (cfg.gridSize * cellSize * 0.45)
        : 0;
    balls.push(makeBall(TYPE_DAY, leftCenterX, centerY + offset, r));
    balls.push(makeBall(TYPE_NIGHT, rightCenterX, centerY - offset, r));
  }

  return {
    grid,
    balls,
    boardWidth,
    cellSize,
    physics: cfg,
    simTime: 0,
  };
}

function tickBall(state: HeadlessState, ball: HeadlessBall, deltaSeconds: number): void {
  const gridSize = state.physics.gridSize;
  const { boardWidth, cellSize } = state;
  const pxPerMeter = boardWidth / ARENA_WIDTH_METERS;
  const totalDistPx = state.physics.speedMps * pxPerMeter * deltaSeconds;

  const maxStepSize = cellSize * 0.16;
  const steps = Math.max(4, Math.ceil(totalDistPx / maxStepSize));
  const stepDist = totalDistPx / steps;

  for (let step = 0; step < steps; step++) {
    ball.x += ball.vx * stepDist;
    ball.y += ball.vy * stepDist;

    if (ball.x - ball.radius <= 0) {
      ball.x = ball.radius;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + ball.radius >= boardWidth) {
      ball.x = boardWidth - ball.radius;
      ball.vx = -Math.abs(ball.vx);
    }

    if (ball.y - ball.radius <= 0) {
      ball.y = ball.radius;
      ball.vy = Math.abs(ball.vy);
    } else if (ball.y + ball.radius >= boardWidth) {
      ball.y = boardWidth - ball.radius;
      ball.vy = -Math.abs(ball.vy);
    }

    const centerCol = Math.floor(ball.x / cellSize);
    const centerRow = Math.floor(ball.y / cellSize);
    let collided = false;

    for (let r = Math.max(0, centerRow - 1); r <= Math.min(gridSize - 1, centerRow + 1); r++) {
      for (let c = Math.max(0, centerCol - 1); c <= Math.min(gridSize - 1, centerCol + 1); c++) {
        if (state.grid[r][c] === ball.type) continue;

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
          collided = true;

          if (Math.abs(distX) > Math.abs(distY)) {
            ball.vx = distX > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx);
            ball.x = closestX + (distX > 0 ? ball.radius : -ball.radius);
          } else {
            ball.vy = distY > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy);
            ball.y = closestY + (distY > 0 ? ball.radius : -ball.radius);
          }

          setDirection(ball, ball.vx, ball.vy);
          break;
        }
      }
      if (collided) break;
    }
  }
}

/** Advance headless simulation by deltaSeconds of sim time. */
export function tickHeadless(state: HeadlessState, deltaSeconds: number): void {
  const dt = Math.max(0, Math.min(0.1, deltaSeconds));
  if (dt <= 0) return;
  for (const ball of state.balls) {
    tickBall(state, ball, dt);
  }
  state.simTime += dt;
}

export function measureTerritory(state: HeadlessState): TerritorySample {
  const n = state.physics.gridSize;
  let dayCount = 0;
  const total = Math.max(1, n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (state.grid[r][c] === TYPE_DAY) dayCount++;
    }
  }
  const nightCount = total - dayCount;
  return {
    t: state.simTime,
    dayCount,
    nightCount,
    dayPct: (dayCount / total) * 100,
    nightPct: (nightCount / total) * 100,
  };
}

/** Downsample grid to at most maxSize×maxSize (row-major 0/1). */
export function downsampleGrid(state: HeadlessState, maxSize = 32): number[] {
  const n = state.physics.gridSize;
  const outN = Math.min(n, maxSize);
  const cells: number[] = [];
  for (let r = 0; r < outN; r++) {
    const srcR = Math.min(n - 1, Math.floor((r / outN) * n));
    for (let c = 0; c < outN; c++) {
      const srcC = Math.min(n - 1, Math.floor((c / outN) * n));
      cells.push(state.grid[srcR][srcC] === TYPE_NIGHT ? 1 : 0);
    }
  }
  return cells;
}
