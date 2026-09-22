import {
  TYPE_DAY,
  TYPE_NIGHT,
  cloneShaderConfig,
  defaultGfxOptions,
  type ShaderConfig,
} from '../config/constants';
import {
  CYBER_SCHEMES,
  cloneCyberScheme,
  type CyberScheme,
  type SchemeLook,
  type ThemeSide,
} from '../config/themes';

export const USER_THEMES_KEY = 'duality_user_themes_v1';

let cached: CyberScheme[] = [];
let loaded = false;

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function parseThemeSide(raw: unknown, fallback: ThemeSide): ThemeSide {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const o = raw as Record<string, unknown>;
  return {
    tileColor: isHexColor(o.tileColor) ? o.tileColor : fallback.tileColor,
    ballColor: isHexColor(o.ballColor) ? o.ballColor : fallback.ballColor,
    note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : fallback.note,
  };
}

function parseShader(raw: unknown, fallback: ShaderConfig): ShaderConfig {
  const out = cloneShaderConfig(fallback);
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  if (typeof o.enabled === 'boolean') out.enabled = o.enabled;
  if (typeof o.strength === 'number') out.strength = clamp(o.strength, 0, 100);
  if (typeof o.reach === 'number') out.reach = clamp(o.reach, 0, 100);
  if (typeof o.grid === 'boolean') out.grid = o.grid;
  if (typeof o.fadeMs === 'number') out.fadeMs = clamp(Math.round(o.fadeMs), 50, 2000);
  if (Array.isArray(o.colors) && o.colors.length >= 2) {
    if (isHexColor(o.colors[0])) out.colors[0] = o.colors[0];
    if (isHexColor(o.colors[1])) out.colors[1] = o.colors[1];
  }
  return out;
}

function parseLook(raw: unknown): SchemeLook {
  const d = defaultGfxOptions();
  const base: SchemeLook = {
    glowIntensity: d.glowIntensity,
    maxTrail: d.maxTrail,
    trailSolid: d.trailSolid,
    particleCount: d.particleCount,
    gridOpacity: d.gridOpacity,
    scanlines: d.scanlines,
    areaSaturation: d.areaSaturation,
    frontierColor: d.frontierColor,
    frontierStrength: d.frontierStrength,
    ballScale: d.ballScale,
    lightShader: cloneShaderConfig(d.lightShader),
    collisionShader: cloneShaderConfig(d.collisionShader),
    reflectionShader: cloneShaderConfig(d.reflectionShader),
  };
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.glowIntensity === 'number') base.glowIntensity = clamp(o.glowIntensity, 0, 36);
  if (typeof o.maxTrail === 'number') base.maxTrail = clamp(o.maxTrail, 0, 30);
  if (typeof o.trailSolid === 'boolean') base.trailSolid = o.trailSolid;
  if (typeof o.particleCount === 'number') {
    base.particleCount = clamp(Math.round(o.particleCount), 0, 40);
  }
  if (typeof o.gridOpacity === 'number') base.gridOpacity = clamp(o.gridOpacity, 0, 0.35);
  if (typeof o.scanlines === 'boolean') base.scanlines = o.scanlines;
  if (typeof o.areaSaturation === 'number') base.areaSaturation = clamp(o.areaSaturation, 0, 100);
  if (isHexColor(o.frontierColor)) base.frontierColor = o.frontierColor;
  if (typeof o.frontierStrength === 'number') {
    base.frontierStrength = clamp(o.frontierStrength, 0, 100);
  }
  if (typeof o.ballScale === 'number') base.ballScale = clamp(o.ballScale, 50, 200);
  base.lightShader = parseShader(o.lightShader, base.lightShader);
  base.collisionShader = parseShader(o.collisionShader, base.collisionShader);
  base.reflectionShader = parseShader(o.reflectionShader, base.reflectionShader);
  return base;
}

function parseScheme(raw: unknown): CyberScheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id.trim()) return null;
  if (typeof o.name !== 'string' || !o.name.trim()) return null;
  const id = o.id.trim();
  if (CYBER_SCHEMES.some((s) => s.id === id)) return null;
  const fallbackDay = CYBER_SCHEMES[0][TYPE_DAY];
  const fallbackNight = CYBER_SCHEMES[0][TYPE_NIGHT];
  return {
    id,
    name: o.name.trim().slice(0, 32).toUpperCase(),
    tag: typeof o.tag === 'string' && o.tag.trim() ? o.tag.trim().slice(0, 24).toUpperCase() : 'CUSTOM',
    [TYPE_DAY]: parseThemeSide(o[TYPE_DAY] ?? o['0'], fallbackDay),
    [TYPE_NIGHT]: parseThemeSide(o[TYPE_NIGHT] ?? o['1'], fallbackNight),
    look: parseLook(o.look),
  };
}

function writeCache(schemes: CyberScheme[]): void {
  cached = schemes.map(cloneCyberScheme);
  loaded = true;
  try {
    localStorage.setItem(USER_THEMES_KEY, JSON.stringify(cached));
  } catch {
    /* ignore quota */
  }
}

/** Load user themes from localStorage (idempotent). */
export function loadUserSchemes(): CyberScheme[] {
  if (loaded) return cached;
  try {
    const raw = localStorage.getItem(USER_THEMES_KEY);
    if (!raw) {
      cached = [];
      loaded = true;
      return cached;
    }
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) {
      cached = [];
      loaded = true;
      return cached;
    }
    const seen = new Set<string>();
    const out: CyberScheme[] = [];
    for (const item of data) {
      const scheme = parseScheme(item);
      if (!scheme || seen.has(scheme.id)) continue;
      seen.add(scheme.id);
      out.push(scheme);
    }
    cached = out;
  } catch {
    cached = [];
  }
  loaded = true;
  return cached;
}

export function getUserSchemes(): CyberScheme[] {
  return loadUserSchemes();
}

/** Append a user theme; returns index in built-in+user list. */
export function addUserScheme(scheme: CyberScheme): number {
  const list = loadUserSchemes().filter((s) => s.id !== scheme.id);
  list.push(cloneCyberScheme(scheme));
  writeCache(list);
  return CYBER_SCHEMES.length + list.length - 1;
}

/** Remove by id. Returns true if removed. */
export function removeUserScheme(id: string): boolean {
  const list = loadUserSchemes();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return false;
  writeCache(next);
  return true;
}

export function isUserSchemeIndex(index: number): boolean {
  return index >= CYBER_SCHEMES.length;
}

export function slugifyThemeName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return base || 'theme';
}
