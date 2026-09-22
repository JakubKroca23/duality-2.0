export const ARENA_WIDTH_METERS = 10;
export const TYPE_DAY = 0;
export const TYPE_NIGHT = 1;

export const GRID_SIZE_MIN = 3;
export const GRID_SIZE_MAX = 512;
export const GRID_SIZE_DEFAULT = 20;
export const SCHEME_INDEX_DEFAULT = 0;

export const BALLS_MIN = 1;
export const BALLS_MAX = 9;
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 500;

export const SHADER_FADE_MS_MIN = 50;
export const SHADER_FADE_MS_MAX = 2000;

export type Side = typeof TYPE_DAY | typeof TYPE_NIGHT;

/**
 * Shared intensity / reach / grid / fade; tint is per side A/B.
 * Index 0 = day (A), 1 = night (B).
 */
export type ShaderConfig = {
  /** Master on/off — keeps strength/reach when disabled. */
  enabled: boolean;
  /** Intensity 0–100. */
  strength: number;
  /** Spatial reach 0–100 (% of arena-relative glow size). */
  reach: number;
  grid: boolean;
  /** Trail / flash linger (ms). */
  fadeMs: number;
  /** Per-side tint [A, B]. */
  colors: [string, string];
};

export function cloneShaderConfig(s: ShaderConfig): ShaderConfig {
  return {
    enabled: s.enabled,
    strength: s.strength,
    reach: s.reach,
    grid: s.grid,
    fadeMs: s.fadeMs,
    colors: [s.colors[0], s.colors[1]],
  };
}

/** True when the shader should run (toggle on + strength > 0). */
export function isShaderOn(s: ShaderConfig): boolean {
  return s.enabled && s.strength > 0;
}

export type ShaderKind = 'light' | 'collision' | 'reflection';

export type GfxOptions = {
  /** Ball bloom / aura around the point (0 = none). */
  glowIntensity: number;
  maxTrail: number;
  trailSolid: boolean;
  /** Collision spark count (0 = off). */
  particleCount: number;
  /** Cell outline opacity 0–0.35. */
  gridOpacity: number;
  scanlines: boolean;
  /** How vivid territory fill colors are (0–100). */
  areaSaturation: number;
  /** Color of the frontier line between opposing cells. */
  frontierColor: string;
  /** Strength of frontier line (0–100). */
  frontierStrength: number;

  /** Floor lighting around balls. */
  lightShader: ShaderConfig;
  /** Brief flash on dividing-line collisions. */
  collisionShader: ShaderConfig;
  /** Glow on the black arena frame when a ball nears an outer wall. */
  reflectionShader: ShaderConfig;

  /** Ball radius scale % (50–200). */
  ballScale: number;
};

export type PhysicsOptions = {
  speedMps: number;
  ballsPerSide: number;
  gridSize: number;
};

function defaultLightShader(): ShaderConfig {
  return {
    enabled: true,
    strength: 22,
    reach: 32,
    grid: false,
    fadeMs: 220,
    colors: ['#00d4e8', '#e8366a'],
  };
}

function defaultCollisionShader(): ShaderConfig {
  return {
    enabled: true,
    strength: 18,
    reach: 28,
    grid: false,
    fadeMs: 180,
    colors: ['#ffffff', '#ffffff'],
  };
}

function defaultReflectionShader(): ShaderConfig {
  return {
    enabled: false,
    strength: 40,
    reach: 40,
    grid: false,
    fadeMs: 300,
    colors: ['#8ad4e8', '#e89ab0'],
  };
}

/** Clean, lightweight baseline used by Obnovit (and initial boot). */
export const defaultGfxOptions = (): GfxOptions => ({
  glowIntensity: 8,
  maxTrail: 6,
  trailSolid: true,
  particleCount: 3,
  gridOpacity: 0.08,
  scanlines: false,
  areaSaturation: 42,
  frontierColor: '#c8d4dc',
  frontierStrength: 22,

  lightShader: defaultLightShader(),
  collisionShader: defaultCollisionShader(),
  reflectionShader: defaultReflectionShader(),

  ballScale: 100,
});

export const defaultPhysicsOptions = (): PhysicsOptions => ({
  speedMps: 6.0,
  ballsPerSide: 1,
  gridSize: GRID_SIZE_DEFAULT,
});
