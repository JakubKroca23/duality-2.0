import {
  BALLS_MAX,
  BALLS_MIN,
  GRID_SIZE_MAX,
  GRID_SIZE_MIN,
  SHADER_FADE_MS_MAX,
  SHADER_FADE_MS_MIN,
  SPEED_MAX,
  SPEED_MIN,
  TYPE_DAY,
  TYPE_NIGHT,
  cloneShaderConfig,
  defaultGfxOptions,
  type ShaderConfig,
} from '../config/constants';
import { CYBER_SCHEMES, cloneSchemeThemes, tileFromBall } from '../config/themes';
import { applyCustomOrScheme, type SimState } from './state';
import { markGridDirty } from './render';

export const STORAGE_KEY = 'duality_sim_settings_v5';
const LEGACY_STORAGE_KEY = 'duality_sim_settings_v4';

export function saveSettings(state: SimState): void {
  try {
    const payload = {
      physics: {
        speedMps: state.physicsOptions.speedMps,
        ballsPerSide: state.physicsOptions.ballsPerSide,
        gridSize: state.physicsOptions.gridSize,
      },
      gfx: {
        ...state.gfxOptions,
        lightShader: cloneShaderConfig(state.gfxOptions.lightShader),
        collisionShader: cloneShaderConfig(state.gfxOptions.collisionShader),
        reflectionShader: cloneShaderConfig(state.gfxOptions.reflectionShader),
      },
      themeIndex: state.currentSchemeIndex,
      soundEnabled: state.soundEnabled,
      customColors: state.customColors,
      customDay: state.customDay,
      customNight: state.customNight,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

/** Normalize saved shader (new shape or legacy per-side array) into ShaderConfig. */
function parseShaderConfig(raw: unknown, fallback: ShaderConfig): ShaderConfig {
  const out = cloneShaderConfig(fallback);
  if (!raw) return out;

  // Legacy: [sideA, sideB] each with strength/grid/fadeMs/(color)
  if (Array.isArray(raw) && raw.length >= 2) {
    const a = raw[0] as Record<string, unknown> | null;
    const b = raw[1] as Record<string, unknown> | null;
    if (a && typeof a === 'object') {
      if (typeof a.enabled === 'boolean') out.enabled = a.enabled;
      if (typeof a.strength === 'number') out.strength = clamp(a.strength, 0, 100);
      if (typeof a.reach === 'number') out.reach = clamp(a.reach, 0, 100);
      if (typeof a.grid === 'boolean') out.grid = a.grid;
      if (typeof a.fadeMs === 'number') {
        out.fadeMs = clamp(Math.round(a.fadeMs), SHADER_FADE_MS_MIN, SHADER_FADE_MS_MAX);
      }
      if (isHexColor(a.color)) out.colors[0] = a.color;
    }
    if (b && typeof b === 'object' && isHexColor(b.color)) out.colors[1] = b.color;
    out.enabled = out.strength > 0;
    return out;
  }

  if (typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  if (typeof o.enabled === 'boolean') out.enabled = o.enabled;
  if (typeof o.strength === 'number') out.strength = clamp(o.strength, 0, 100);
  if (typeof o.enabled !== 'boolean' && typeof o.strength === 'number') {
    out.enabled = out.strength > 0;
  }
  if (typeof o.reach === 'number') out.reach = clamp(o.reach, 0, 100);
  if (typeof o.grid === 'boolean') out.grid = o.grid;
  if (typeof o.fadeMs === 'number') {
    out.fadeMs = clamp(Math.round(o.fadeMs), SHADER_FADE_MS_MIN, SHADER_FADE_MS_MAX);
  }
  if (Array.isArray(o.colors) && o.colors.length >= 2) {
    if (isHexColor(o.colors[0])) out.colors[0] = o.colors[0];
    if (isHexColor(o.colors[1])) out.colors[1] = o.colors[1];
  } else {
    if (isHexColor(o.colorA)) out.colors[0] = o.colorA;
    if (isHexColor(o.colorB)) out.colors[1] = o.colorB;
  }
  return out;
}

/** Migrate flat v4 shader fields into ShaderConfig. */
function migrateLegacyShaders(
  gfx: Record<string, unknown>,
  defaults: ReturnType<typeof defaultGfxOptions>,
): void {
  const migrateFlat = (
    strengthKey: string,
    gridKey: string,
    fadeKey: string,
    target: ShaderConfig,
  ): void => {
    const hasFlat =
      typeof gfx[strengthKey] === 'number' ||
      typeof gfx[gridKey] === 'boolean' ||
      typeof gfx[fadeKey] === 'number';
    if (!hasFlat) return;

    if (typeof gfx[strengthKey] === 'number') {
      target.strength = clamp(gfx[strengthKey] as number, 0, 100);
    }
    if (typeof gfx[gridKey] === 'boolean') target.grid = gfx[gridKey] as boolean;
    else if (typeof gfx.shaderLightGrid === 'boolean') target.grid = gfx.shaderLightGrid as boolean;
    if (typeof gfx[fadeKey] === 'number') {
      target.fadeMs = clamp(Math.round(gfx[fadeKey] as number), SHADER_FADE_MS_MIN, SHADER_FADE_MS_MAX);
    }
  };

  if (gfx.lightShader !== undefined) {
    defaults.lightShader = parseShaderConfig(gfx.lightShader, defaults.lightShader);
  } else {
    migrateFlat('lightShader', 'lightShaderGrid', 'lightShaderFadeMs', defaults.lightShader);
  }

  if (gfx.collisionShader !== undefined) {
    defaults.collisionShader = parseShaderConfig(gfx.collisionShader, defaults.collisionShader);
  } else {
    migrateFlat(
      'collisionShader',
      'collisionShaderGrid',
      'collisionShaderFadeMs',
      defaults.collisionShader,
    );
  }

  if (gfx.reflectionShader !== undefined) {
    defaults.reflectionShader = parseShaderConfig(gfx.reflectionShader, defaults.reflectionShader);
  } else {
    migrateFlat(
      'reflectionShader',
      'reflectionShaderGrid',
      'reflectionShaderFadeMs',
      defaults.reflectionShader,
    );
  }
}

function applyGfx(state: SimState, gfx: Record<string, unknown>): void {
  if (typeof gfx.glowIntensity === 'number') {
    state.gfxOptions.glowIntensity = clamp(gfx.glowIntensity, 0, 36);
  }
  if (typeof gfx.maxTrail === 'number') {
    state.gfxOptions.maxTrail = clamp(gfx.maxTrail, 0, 30);
  }
  if (typeof gfx.trailSolid === 'boolean') state.gfxOptions.trailSolid = gfx.trailSolid;
  if (typeof gfx.particleCount === 'number') {
    state.gfxOptions.particleCount = clamp(Math.round(gfx.particleCount), 0, 40);
  }
  if (typeof gfx.gridOpacity === 'number') {
    state.gfxOptions.gridOpacity = clamp(gfx.gridOpacity, 0, 0.35);
  }
  if (typeof gfx.scanlines === 'boolean') state.gfxOptions.scanlines = gfx.scanlines;
  if (typeof gfx.areaSaturation === 'number') {
    state.gfxOptions.areaSaturation = clamp(gfx.areaSaturation, 0, 100);
  }
  if (typeof gfx.frontierColor === 'string') state.gfxOptions.frontierColor = gfx.frontierColor;
  if (typeof gfx.frontierStrength === 'number') {
    state.gfxOptions.frontierStrength = clamp(gfx.frontierStrength, 0, 100);
  }
  if (typeof gfx.ballScale === 'number') {
    state.gfxOptions.ballScale = clamp(gfx.ballScale, 50, 200);
  }

  const scratch = defaultGfxOptions();
  scratch.lightShader = cloneShaderConfig(state.gfxOptions.lightShader);
  scratch.collisionShader = cloneShaderConfig(state.gfxOptions.collisionShader);
  scratch.reflectionShader = cloneShaderConfig(state.gfxOptions.reflectionShader);
  migrateLegacyShaders(gfx, scratch);
  state.gfxOptions.lightShader = scratch.lightShader;
  state.gfxOptions.collisionShader = scratch.collisionShader;
  state.gfxOptions.reflectionShader = scratch.reflectionShader;
}

export function loadSettings(state: SimState): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return;
    const data = JSON.parse(saved) as Record<string, unknown>;

    const physics = data.physics as Record<string, unknown> | undefined;
    if (physics) {
      if (typeof physics.speedMps === 'number' && !Number.isNaN(physics.speedMps)) {
        state.physicsOptions.speedMps = clamp(physics.speedMps, SPEED_MIN, SPEED_MAX);
      }
      if (typeof physics.ballsPerSide === 'number' && !Number.isNaN(physics.ballsPerSide)) {
        state.physicsOptions.ballsPerSide = clamp(Math.round(physics.ballsPerSide), BALLS_MIN, BALLS_MAX);
      }
      if (typeof physics.gridSize === 'number' && !Number.isNaN(physics.gridSize)) {
        state.physicsOptions.gridSize = clamp(Math.round(physics.gridSize), GRID_SIZE_MIN, GRID_SIZE_MAX);
      }
    }

    const gfx = data.gfx as Record<string, unknown> | undefined;
    if (gfx) applyGfx(state, gfx);

    if (typeof data.themeIndex === 'number' && data.themeIndex >= 0 && data.themeIndex < CYBER_SCHEMES.length) {
      state.currentSchemeIndex = data.themeIndex;
      state.themes = cloneSchemeThemes(state.currentSchemeIndex);
    }

    if (typeof data.soundEnabled === 'boolean') state.soundEnabled = data.soundEnabled;

    if (typeof data.customDay === 'string') state.customDay = data.customDay;
    if (typeof data.customNight === 'string') state.customNight = data.customNight;
    if (typeof data.customColors === 'boolean') {
      state.customColors = data.customColors;
      if (state.customColors) {
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
    }

    applyCustomOrScheme(state);
    markGridDirty(state);
  } catch {
    /* ignore corrupt */
  }
}
