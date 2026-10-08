/** Runtime quality profile — keeps Chaos smooth on phones. */

export type PerfProfile = {
  /** Cap for Pixi / WebGL resolution. */
  dpr: number;
  antialias: boolean;
  /** Pixi filter render-target scale (1 = full res). */
  filterResolution: number;
  /** Soft cap for light+collision shader points. */
  maxLights: number;
  /** Cap light trail echoes kept in sim state. */
  lightEchoCap: number;
  /** Fullscreen page-bleed canvas (very expensive with CSS blur). */
  pageBleed: boolean;
  bleedDpr: number;
  /** Min ms between bleed redraws while animating. */
  bleedIntervalMs: number;
};

let cached: PerfProfile | null = null;
let cachedKey = '';

function detectMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  if (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024) return true;
  try {
    if (window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 900) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function buildProfile(): PerfProfile {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const mobile = detectMobile();
  const cores = navigator.hardwareConcurrency || 8;
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  const lowEnd = mobile || cores <= 4 || saveData;

  if (lowEnd) {
    return {
      dpr: Math.min(dpr, mobile ? 1.25 : 1.5),
      antialias: false,
      filterResolution: mobile ? 0.5 : 0.75,
      maxLights: mobile ? 10 : 16,
      lightEchoCap: mobile ? 16 : 28,
      pageBleed: !mobile,
      bleedDpr: 1,
      bleedIntervalMs: 120,
    };
  }

  return {
    dpr: Math.min(dpr, 2),
    antialias: true,
    filterResolution: 1,
    maxLights: 48,
    lightEchoCap: 72,
    pageBleed: true,
    bleedDpr: Math.min(dpr, 2),
    bleedIntervalMs: 0,
  };
}

/** Fresh profile when viewport class changes (rotate / resize). */
export function getPerfProfile(): PerfProfile {
  const mobile = detectMobile();
  const key = `${mobile}|${Math.round(window.innerWidth / 160)}|${navigator.hardwareConcurrency || 0}`;
  if (!cached || key !== cachedKey) {
    cached = buildProfile();
    cachedKey = key;
  }
  return cached;
}

export function invalidatePerfProfile(): void {
  cached = null;
  cachedKey = '';
}

export function isMobilePerf(): boolean {
  return detectMobile();
}
