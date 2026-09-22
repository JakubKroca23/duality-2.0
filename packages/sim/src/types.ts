export const ARENA_WIDTH_METERS = 10;
export const TYPE_DAY = 0 as const;
export const TYPE_NIGHT = 1 as const;
export type Side = typeof TYPE_DAY | typeof TYPE_NIGHT;

export const GRID_SIZE_DEFAULT = 20;
export const SPEED_DEFAULT = 6;

export type PhysicsConfig = {
  speedMps: number;
  ballsPerSide: number;
  gridSize: number;
  /** Ball radius scale % (50–200). */
  ballScale: number;
};

export type HeadlessBall = {
  type: Side;
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
};

export type HeadlessState = {
  grid: number[][];
  balls: HeadlessBall[];
  /** Virtual arena size in px (fixed for headless). */
  boardWidth: number;
  cellSize: number;
  physics: PhysicsConfig;
  /** Accumulated simulation seconds. */
  simTime: number;
};

export type TerritorySample = {
  t: number;
  dayPct: number;
  nightPct: number;
  dayCount: number;
  nightCount: number;
};

export function defaultPhysics(): PhysicsConfig {
  return {
    speedMps: SPEED_DEFAULT,
    ballsPerSide: 1,
    gridSize: GRID_SIZE_DEFAULT,
    ballScale: 100,
  };
}
