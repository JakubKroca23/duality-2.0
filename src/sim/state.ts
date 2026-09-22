import {
  defaultGfxOptions,
  defaultPhysicsOptions,
  SCHEME_INDEX_DEFAULT,
  TYPE_DAY,
  TYPE_NIGHT,
  type GfxOptions,
  type PhysicsOptions,
  type Side,
} from '../config/constants';
import { cloneSchemeThemes, tileFromBall, type ThemesMap } from '../config/themes';
import type { Ball, Particle } from './Ball';

export type CollisionFlash = {
  x: number;
  y: number;
  type: Side;
  life: number;
  maxLife: number;
};

/** Fading afterimage left by light / reflection shaders (linger = FadeMs). */
export type ShaderEcho = {
  x: number;
  y: number;
  type: Side;
  life: number;
  maxLife: number;
  /** Reflection-only strength snapshot (0–1). */
  strength: number;
  /** Reflection: glow reach from wall/frontier toward the ball (px). */
  reach?: number;
};

export type SimState = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  grid: number[][];
  balls: Ball[];
  particles: Particle[];
  collisionFlashes: CollisionFlash[];
  lightEchoes: ShaderEcho[];
  reflectionEchoes: ShaderEcho[];
  isRunning: boolean;
  soundEnabled: boolean;
  cellSize: number;
  boardWidth: number;
  /** Black chrome around the playable board (CSS px); reflection shader lights it. */
  framePad: number;
  gfxOptions: GfxOptions;
  physicsOptions: PhysicsOptions;
  themes: ThemesMap;
  currentSchemeIndex: number;
  customColors: boolean;
  customDay: string;
  customNight: string;
  /** Elapsed simulation time while running (seconds). */
  runTimeSec: number;
  /** Seconds side A (day) held territory majority. */
  leadTimeDay: number;
  /** Seconds side B (night) held territory majority. */
  leadTimeNight: number;
  /** 1px-per-cell cache for large grids */
  gridBitmap: HTMLCanvasElement | null;
  gridDirty: boolean;
};

export function createInitialState(canvas: HTMLCanvasElement): SimState {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  const themes = cloneSchemeThemes(SCHEME_INDEX_DEFAULT);

  return {
    canvas,
    ctx,
    grid: [],
    balls: [],
    particles: [],
    collisionFlashes: [],
    lightEchoes: [],
    reflectionEchoes: [],
    isRunning: true,
    soundEnabled: false,
    cellSize: 0,
    boardWidth: 0,
    framePad: 0,
    gfxOptions: defaultGfxOptions(),
    physicsOptions: defaultPhysicsOptions(),
    themes,
    currentSchemeIndex: SCHEME_INDEX_DEFAULT,
    customColors: false,
    customDay: themes[TYPE_DAY].ballColor,
    customNight: themes[TYPE_NIGHT].ballColor,
    runTimeSec: 0,
    leadTimeDay: 0,
    leadTimeNight: 0,
    gridBitmap: null,
    gridDirty: true,
  };
}

export function applyCustomOrScheme(state: SimState): void {
  if (!state.customColors) return;
  state.themes[TYPE_DAY] = {
    ...state.themes[TYPE_DAY],
    ballColor: state.customDay,
    tileColor: tileFromBall(state.customDay),
  };
  state.themes[TYPE_NIGHT] = {
    ...state.themes[TYPE_NIGHT],
    ballColor: state.customNight,
    tileColor: tileFromBall(state.customNight),
  };
}
