import { isShaderOn, type Side } from '../config/constants';
import type { SimState } from './state';

export function hexToRgba(hex: string, alpha: number): string {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function parseHex(hex: string): [number, number, number] {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Per-side tint from shader settings. */
export function shaderColorFor(
  state: SimState,
  kind: 'light' | 'collision' | 'reflection',
  side: 0 | 1,
): string {
  const key =
    kind === 'light'
      ? 'lightShader'
      : kind === 'collision'
        ? 'collisionShader'
        : 'reflectionShader';
  return state.gfxOptions[key].colors[side];
}

export function markGridDirty(state: SimState): void {
  state.gridDirty = true;
}

function arenaFrac(boardWidth: number, fraction: number): number {
  return Math.max(0, boardWidth * fraction);
}

function shaderReachPx(boardWidth: number, reach: number, minFrac: number, spanFrac: number): number {
  const r = Math.max(0, Math.min(100, reach)) / 100;
  return arenaFrac(boardWidth, minFrac + r * spanFrac);
}

function ageEchoes(echoes: { life: number }[], deltaSeconds: number): void {
  for (let i = echoes.length - 1; i >= 0; i--) {
    echoes[i].life -= deltaSeconds;
    if (echoes[i].life <= 0) echoes.splice(i, 1);
  }
}

function echoNear(
  echoes: { x: number; y: number; life: number; maxLife: number }[],
  x: number,
  y: number,
  spacing: number,
): boolean {
  const minLife = 0.72;
  for (let i = echoes.length - 1; i >= 0; i--) {
    const e = echoes[i];
    if (e.life / e.maxLife < minLife) continue;
    if (Math.hypot(e.x - x, e.y - y) < spacing) return true;
  }
  return false;
}

function collectReflectionBounces(
  state: SimState,
  ball: { x: number; y: number },
  falloff: number,
  refl: number,
): Array<{ x: number; y: number; strength: number; reach: number }> {
  const W = state.boardWidth;
  const bounces: Array<{ x: number; y: number; strength: number; reach: number }> = [];
  if (falloff <= 0 || W <= 0) return bounces;

  const clampEdge = (v: number) => Math.max(0, Math.min(W, v));
  const edges = [
    { x: 0, y: clampEdge(ball.y), dist: ball.x },
    { x: W, y: clampEdge(ball.y), dist: W - ball.x },
    { x: clampEdge(ball.x), y: 0, dist: ball.y },
    { x: clampEdge(ball.x), y: W, dist: W - ball.y },
  ];
  const minReach = Math.max(state.framePad * 0.9, arenaFrac(W, 0.014));

  for (const e of edges) {
    if (e.dist > falloff) continue;
    const near = Math.max(0, 1 - e.dist / falloff);
    const strength = refl * Math.pow(near, 1.1);
    if (strength <= 0.02) continue;
    bounces.push({ x: e.x, y: e.y, strength, reach: minReach });
  }
  return bounces;
}

const LIGHT_ECHO_CAP = 72;
const REFLECTION_ECHO_CAP = 96;

/** Deposit fading shader trails; FadeMs = how long afterimages linger. */
export function updateShaderTrails(state: SimState, deltaSeconds: number): void {
  ageEchoes(state.lightEchoes, deltaSeconds);
  ageEchoes(state.reflectionEchoes, deltaSeconds);

  const { boardWidth, balls, gfxOptions } = state;
  if (boardWidth <= 0) return;

  const spacing = arenaFrac(boardWidth, 0.01);

  const lightCfg = gfxOptions.lightShader;
  if (!isShaderOn(lightCfg)) {
    state.lightEchoes.length = 0;
    balls.forEach((b) => {
      b.lightTrailX = Number.NaN;
      b.lightTrailY = Number.NaN;
    });
  } else {
    const maxLife = Math.max(0.05, lightCfg.fadeMs / 1000);
    const light = lightCfg.strength / 100;
    for (const ball of balls) {
      const moved = Number.isFinite(ball.lightTrailX)
        ? Math.hypot(ball.x - ball.lightTrailX, ball.y - ball.lightTrailY)
        : Infinity;
      if (moved < spacing) continue;
      ball.lightTrailX = ball.x;
      ball.lightTrailY = ball.y;
      state.lightEchoes.push({
        x: ball.x,
        y: ball.y,
        type: ball.type,
        life: maxLife,
        maxLife,
        strength: light,
      });
      while (state.lightEchoes.length > LIGHT_ECHO_CAP) state.lightEchoes.shift();
    }
  }

  const reflCfg = gfxOptions.reflectionShader;
  if (!isShaderOn(reflCfg)) {
    state.reflectionEchoes.length = 0;
  } else {
    const refl = reflCfg.strength / 100;
    const maxLife = Math.max(0.05, reflCfg.fadeMs / 1000);
    const falloff = shaderReachPx(boardWidth, reflCfg.reach, 0.08, 0.42);
    for (const ball of balls) {
      const bounces = collectReflectionBounces(state, ball, falloff, refl);
      for (const b of bounces) {
        if (echoNear(state.reflectionEchoes, b.x, b.y, spacing * 0.85)) continue;
        state.reflectionEchoes.push({
          x: b.x,
          y: b.y,
          type: ball.type as Side,
          life: maxLife,
          maxLife,
          strength: b.strength,
          reach: b.reach,
        });
      }
      while (state.reflectionEchoes.length > REFLECTION_ECHO_CAP) {
        state.reflectionEchoes.shift();
      }
    }
  }
}

function scoreRoot(root?: ParentNode | null): ParentNode {
  return root ?? document;
}

function scoreNode(root: ParentNode, role: string, id: string): HTMLElement | null {
  return (
    (root.querySelector(`[data-role="${role}"]`) as HTMLElement | null) ??
    (root === document ? document.getElementById(id) : null)
  );
}

export function updateScoreboard(state: SimState, root?: ParentNode | null): void {
  const scope = scoreRoot(root);
  const gridSize = state.physicsOptions.gridSize;
  let dayCount = 0;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (state.grid[r][c] === 0) dayCount++;
    }
  }
  const total = Math.max(1, gridSize * gridSize);
  const nightCount = total - dayCount;

  const scoreDay = scoreNode(scope, 'score-day', 'scoreDay');
  const scoreNight = scoreNode(scope, 'score-night', 'scoreNight');
  const pctDay = scoreNode(scope, 'pct-day', 'pctDay');
  const pctNight = scoreNode(scope, 'pct-night', 'pctNight');
  const barDay = scoreNode(scope, 'bar-day', 'barDay');
  const barNight = scoreNode(scope, 'bar-night', 'barNight');
  if (!scoreDay || !scoreNight || !pctDay || !pctNight || !barDay || !barNight) return;

  scoreDay.textContent = String(dayCount);
  scoreNight.textContent = String(nightCount);

  const dayPct = ((dayCount / total) * 100).toFixed(1);
  const nightPct = ((nightCount / total) * 100).toFixed(1);

  pctDay.textContent = `(${dayPct}%)`;
  pctNight.textContent = `(${nightPct}%)`;
  barDay.style.width = `${dayPct}%`;
  barNight.style.width = `${nightPct}%`;

  const runTimeEl = scoreNode(scope, 'stat-run-time', 'statRunTime');
  const leadDayEl = scoreNode(scope, 'stat-lead-day', 'statLeadDay');
  const leadNightEl = scoreNode(scope, 'stat-lead-night', 'statLeadNight');
  if (runTimeEl) runTimeEl.textContent = formatRunTime(state.runTimeSec);

  const denom = Math.max(state.runTimeSec, 1e-6);
  const leadDayPct = (state.leadTimeDay / denom) * 100;
  const leadNightPct = (state.leadTimeNight / denom) * 100;
  if (leadDayEl) leadDayEl.textContent = `▲ ${formatLeadPct(leadDayPct)}`;
  if (leadNightEl) leadNightEl.textContent = `▲ ${formatLeadPct(leadNightPct)}`;
}

function formatRunTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatLeadPct(pct: number): string {
  if (pct >= 9.95) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}

/** Accumulate run/lead timers for the current frame (call only while running). */
export function tickRunStats(state: SimState, deltaSeconds: number): void {
  if (deltaSeconds <= 0) return;
  state.runTimeSec += deltaSeconds;

  const gridSize = state.physicsOptions.gridSize;
  if (gridSize <= 0 || !state.grid.length) return;

  let dayCount = 0;
  const total = gridSize * gridSize;
  for (let r = 0; r < gridSize; r++) {
    const row = state.grid[r];
    if (!row) continue;
    for (let c = 0; c < gridSize; c++) {
      if (row[c] === 0) dayCount++;
    }
  }
  const nightCount = total - dayCount;
  if (dayCount > nightCount) state.leadTimeDay += deltaSeconds;
  else if (nightCount > dayCount) state.leadTimeNight += deltaSeconds;
}
