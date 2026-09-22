import {
  TYPE_DAY,
  TYPE_NIGHT,
  cloneShaderConfig,
  type GfxOptions,
  type ShaderConfig,
  type Side,
} from './constants';

export type ThemeSide = {
  tileColor: string;
  ballColor: string;
  note: string;
};

/** Visual personality applied when the theme is selected. */
export type SchemeLook = {
  glowIntensity: number;
  maxTrail: number;
  trailSolid: boolean;
  particleCount: number;
  gridOpacity: number;
  scanlines: boolean;
  areaSaturation: number;
  frontierColor: string;
  frontierStrength: number;
  ballScale: number;
  lightShader: ShaderConfig;
  collisionShader: ShaderConfig;
  reflectionShader: ShaderConfig;
};

export type CyberScheme = {
  id: string;
  name: string;
  tag: string;
  [TYPE_DAY]: ThemeSide;
  [TYPE_NIGHT]: ThemeSide;
  look: SchemeLook;
};

function shader(
  strength: number,
  reach: number,
  grid: boolean,
  fadeMs: number,
  colorA: string,
  colorB: string,
  enabled = true,
): ShaderConfig {
  return { enabled, strength, reach, grid, fadeMs, colors: [colorA, colorB] };
}

function look(partial: SchemeLook): SchemeLook {
  return {
    ...partial,
    lightShader: cloneShaderConfig(partial.lightShader),
    collisionShader: cloneShaderConfig(partial.collisionShader),
    reflectionShader: cloneShaderConfig(partial.reflectionShader),
  };
}

export const CYBER_SCHEMES: CyberScheme[] = [
  {
    id: 'night-city',
    name: 'NIGHT CITY',
    tag: 'NEON TRAIL',
    [TYPE_DAY]: { tileColor: '#041724', ballColor: '#00f0ff', note: 'E4' },
    [TYPE_NIGHT]: { tileColor: '#200516', ballColor: '#ff0055', note: 'B3' },
    look: look({
      glowIntensity: 22,
      maxTrail: 18,
      trailSolid: true,
      particleCount: 12,
      gridOpacity: 0.12,
      scanlines: true,
      areaSaturation: 58,
      frontierColor: '#a8f7ff',
      frontierStrength: 40,
      ballScale: 100,
      lightShader: shader(65, 55, true, 380, '#00f0ff', '#ff0055'),
      collisionShader: shader(45, 40, true, 280, '#e8ffff', '#ffe0ec'),
      reflectionShader: shader(50, 48, true, 420, '#7ef9ff', '#ff6b9d'),
    }),
  },
  {
    id: 'matrix',
    name: 'MATRIX',
    tag: 'GRID RAIN',
    [TYPE_DAY]: { tileColor: '#02180c', ballColor: '#00ff66', note: 'F#4' },
    [TYPE_NIGHT]: { tileColor: '#241701', ballColor: '#ffb700', note: 'C#4' },
    look: look({
      glowIntensity: 14,
      maxTrail: 10,
      trailSolid: false,
      particleCount: 6,
      gridOpacity: 0.22,
      scanlines: true,
      areaSaturation: 70,
      frontierColor: '#9affb0',
      frontierStrength: 55,
      ballScale: 95,
      lightShader: shader(80, 40, true, 180, '#39ff14', '#ffcc00'),
      collisionShader: shader(70, 35, true, 160, '#c8ff9a', '#ffe08a'),
      reflectionShader: shader(25, 55, true, 260, '#66ff99', '#ffd24d'),
    }),
  },
  {
    id: 'synthwave',
    name: 'SYNTHWAVE',
    tag: 'CRT BLOOM',
    [TYPE_DAY]: { tileColor: '#170529', ballColor: '#bf00ff', note: 'A4' },
    [TYPE_NIGHT]: { tileColor: '#290e03', ballColor: '#ff5e00', note: 'D4' },
    look: look({
      glowIntensity: 32,
      maxTrail: 26,
      trailSolid: true,
      particleCount: 18,
      gridOpacity: 0.08,
      scanlines: true,
      areaSaturation: 62,
      frontierColor: '#ff9ad5',
      frontierStrength: 35,
      ballScale: 110,
      lightShader: shader(75, 78, false, 650, '#d24dff', '#ff7a29'),
      collisionShader: shader(60, 55, false, 420, '#ffb3f0', '#ffc299'),
      reflectionShader: shader(85, 72, false, 800, '#e080ff', '#ff8f4d'),
    }),
  },
  {
    id: 'crimson',
    name: 'CRIMSON',
    tag: 'SHARP FLASH',
    [TYPE_DAY]: { tileColor: '#101622', ballColor: '#e2f3ff', note: 'G4' },
    [TYPE_NIGHT]: { tileColor: '#26050a', ballColor: '#ff1744', note: 'C4' },
    look: look({
      glowIntensity: 10,
      maxTrail: 4,
      trailSolid: true,
      particleCount: 20,
      gridOpacity: 0.05,
      scanlines: false,
      areaSaturation: 48,
      frontierColor: '#ffffff',
      frontierStrength: 70,
      ballScale: 90,
      lightShader: shader(20, 28, false, 220, '#f2fbff', '#ff4d6d'),
      collisionShader: shader(90, 60, true, 140, '#ffffff', '#ff8a9a'),
      reflectionShader: shader(35, 42, false, 300, '#dcefff', '#ff5c7a'),
    }),
  },
  {
    id: 'hypervolt',
    name: 'VOLT',
    tag: 'WIDE ARC',
    [TYPE_DAY]: { tileColor: '#172202', ballColor: '#d4ff00', note: 'B4' },
    [TYPE_NIGHT]: { tileColor: '#041029', ballColor: '#2979ff', note: 'E3' },
    look: look({
      glowIntensity: 26,
      maxTrail: 14,
      trailSolid: true,
      particleCount: 16,
      gridOpacity: 0.1,
      scanlines: false,
      areaSaturation: 66,
      frontierColor: '#b8ff66',
      frontierStrength: 45,
      ballScale: 105,
      lightShader: shader(55, 90, true, 500, '#e8ff4d', '#4d9fff'),
      collisionShader: shader(50, 70, true, 320, '#f5ffc2', '#a8cfff'),
      reflectionShader: shader(70, 85, true, 560, '#d0ff66', '#66a3ff'),
    }),
  },
  {
    id: 'abyss',
    name: 'ABYSS',
    tag: 'SOFT ECHO',
    [TYPE_DAY]: { tileColor: '#031820', ballColor: '#2ee6d6', note: 'D4' },
    [TYPE_NIGHT]: { tileColor: '#14081f', ballColor: '#8b5cff', note: 'F3' },
    look: look({
      glowIntensity: 16,
      maxTrail: 22,
      trailSolid: true,
      particleCount: 5,
      gridOpacity: 0.04,
      scanlines: false,
      areaSaturation: 42,
      frontierColor: '#7d8cff',
      frontierStrength: 28,
      ballScale: 100,
      lightShader: shader(40, 60, false, 900, '#5ff5e8', '#b08cff'),
      collisionShader: shader(30, 45, false, 550, '#c5fff8', '#d4c2ff'),
      reflectionShader: shader(75, 68, false, 1100, '#6ef0e4', '#a78bff'),
    }),
  },
  {
    id: 'iceberg',
    name: 'ICEBERG',
    tag: 'COOL GRID',
    [TYPE_DAY]: { tileColor: '#0a1520', ballColor: '#9ad8ff', note: 'C5' },
    [TYPE_NIGHT]: { tileColor: '#0c1218', ballColor: '#5b7c99', note: 'G3' },
    look: look({
      glowIntensity: 12,
      maxTrail: 8,
      trailSolid: false,
      particleCount: 4,
      gridOpacity: 0.18,
      scanlines: false,
      areaSaturation: 35,
      frontierColor: '#cfe9ff',
      frontierStrength: 50,
      ballScale: 92,
      lightShader: shader(45, 38, true, 300, '#b9e7ff', '#8eabbf'),
      collisionShader: shader(40, 32, true, 240, '#ffffff', '#c5d6e3'),
      reflectionShader: shader(55, 50, true, 380, '#9fd4ff', '#7a96aa'),
    }),
  },
  {
    id: 'solar',
    name: 'SOLAR',
    tag: 'HEAT HAZE',
    [TYPE_DAY]: { tileColor: '#241803', ballColor: '#ffd166', note: 'A3' },
    [TYPE_NIGHT]: { tileColor: '#1a0604', ballColor: '#ff3d00', note: 'E3' },
    look: look({
      glowIntensity: 28,
      maxTrail: 20,
      trailSolid: true,
      particleCount: 14,
      gridOpacity: 0.06,
      scanlines: true,
      areaSaturation: 72,
      frontierColor: '#ffb347',
      frontierStrength: 38,
      ballScale: 108,
      lightShader: shader(70, 70, false, 480, '#ffe08a', '#ff6138'),
      collisionShader: shader(55, 50, false, 260, '#fff2cc', '#ff9a70'),
      reflectionShader: shader(40, 75, false, 640, '#ffd978', '#ff6a3d'),
    }),
  },
];

export type ThemesMap = Record<Side, ThemeSide>;

export function cloneSchemeThemes(index: number): ThemesMap {
  const scheme = CYBER_SCHEMES[Math.max(0, Math.min(CYBER_SCHEMES.length - 1, index))];
  return {
    [TYPE_DAY]: { ...scheme[TYPE_DAY] },
    [TYPE_NIGHT]: { ...scheme[TYPE_NIGHT] },
  };
}

export function cloneSchemeLook(index: number): SchemeLook {
  const scheme = CYBER_SCHEMES[Math.max(0, Math.min(CYBER_SCHEMES.length - 1, index))];
  return look(scheme.look);
}

/** Apply a theme's visual personality onto gfx options. */
export function applySchemeLookToGfx(gfx: GfxOptions, schemeLook: SchemeLook): void {
  gfx.glowIntensity = schemeLook.glowIntensity;
  gfx.maxTrail = schemeLook.maxTrail;
  gfx.trailSolid = schemeLook.trailSolid;
  gfx.particleCount = schemeLook.particleCount;
  gfx.gridOpacity = schemeLook.gridOpacity;
  gfx.scanlines = schemeLook.scanlines;
  gfx.areaSaturation = schemeLook.areaSaturation;
  gfx.frontierColor = schemeLook.frontierColor;
  gfx.frontierStrength = schemeLook.frontierStrength;
  gfx.ballScale = schemeLook.ballScale;
  gfx.lightShader = cloneShaderConfig(schemeLook.lightShader);
  gfx.collisionShader = cloneShaderConfig(schemeLook.collisionShader);
  gfx.reflectionShader = cloneShaderConfig(schemeLook.reflectionShader);
}

/** Derive a dark tile color from a bright ball/hex color. */
export function tileFromBall(ballHex: string): string {
  const c = ballHex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const num = parseInt(full, 16);
  const r = Math.max(0, Math.round(((num >> 16) & 255) * 0.12));
  const g = Math.max(0, Math.round(((num >> 8) & 255) * 0.12));
  const b = Math.max(0, Math.round((num & 255) * 0.14));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
