import type { SimState } from './state';
import { isShaderOn } from '../config/constants';

export function hexToRgba(hex: string, alpha: number): string {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseHex(hex: string): [number, number, number] {
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

/** Mix tile toward black based on areaSaturation (0–100). */
function saturatedTile(hex: string, sat: number): [number, number, number] {
  const [r, g, b] = parseHex(hex);
  const t = Math.max(0, Math.min(1, sat / 100));
  // 0 → near black, 1 → theme tile (already dark honey)
  const lift = 0.15 + t * 0.85;
  return [
    Math.round(r * lift),
    Math.round(g * lift),
    Math.round(b * lift),
  ];
}

function ensureGridBitmap(state: SimState, gridSize: number): HTMLCanvasElement {
  if (!state.gridBitmap || state.gridBitmap.width !== gridSize) {
    const bmp = document.createElement('canvas');
    bmp.width = gridSize;
    bmp.height = gridSize;
    state.gridBitmap = bmp;
    state.gridDirty = true;
  }
  return state.gridBitmap;
}

export function markGridDirty(state: SimState): void {
  state.gridDirty = true;
}

function rebuildGridBitmap(state: SimState): void {
  const gridSize = state.physicsOptions.gridSize;
  const bmp = ensureGridBitmap(state, gridSize);
  const gctx = bmp.getContext('2d', { willReadFrequently: true });
  if (!gctx) return;

  const img = gctx.createImageData(gridSize, gridSize);
  const data = img.data;
  const sat = state.gfxOptions.areaSaturation;
  const day = saturatedTile(state.themes[0].tileColor, sat);
  const night = saturatedTile(state.themes[1].tileColor, sat);

  for (let r = 0; r < gridSize; r++) {
    const row = state.grid[r];
    for (let c = 0; c < gridSize; c++) {
      const i = (r * gridSize + c) * 4;
      const col = row[c] === 0 ? day : night;
      data[i] = col[0];
      data[i + 1] = col[1];
      data[i + 2] = col[2];
      data[i + 3] = 255;
    }
  }
  gctx.putImageData(img, 0, 0);
  state.gridDirty = false;
}

function drawFrontier(state: SimState): void {
  const strength = state.gfxOptions.frontierStrength / 100;
  if (strength <= 0) return;

  const { ctx, cellSize, physicsOptions, grid, boardWidth } = state;
  const gridSize = physicsOptions.gridSize;
  const color = hexToRgba(state.gfxOptions.frontierColor, Math.min(1, strength * 0.95));
  const lw = Math.max(1, Math.min(4, boardWidth * 0.006));

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const t = grid[r][c];
      // right edge
      if (c + 1 < gridSize && grid[r][c + 1] !== t) {
        const x = (c + 1) * cellSize;
        const y0 = r * cellSize;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + cellSize);
      }
      // bottom edge
      if (r + 1 < gridSize && grid[r + 1][c] !== t) {
        const y = (r + 1) * cellSize;
        const x0 = c * cellSize;
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + cellSize, y);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Pixel length as a fraction of arena width (grid-resolution independent). */
function arenaFrac(boardWidth: number, fraction: number): number {
  return Math.max(0, boardWidth * fraction);
}

/** Map shader reach 0–100 → arena-relative radius (px). */
function shaderReachPx(boardWidth: number, reach: number, minFrac: number, spanFrac: number): number {
  const r = Math.max(0, Math.min(100, reach)) / 100;
  return arenaFrac(boardWidth, minFrac + r * spanFrac);
}

function paintTerritoryLight(
  state: SimState,
  ballType: 0 | 1,
  originX: number,
  originY: number,
  lightRadius: number,
  intensity: number,
  lightGrid: boolean,
  color: string,
): void {
  if (intensity <= 0 || lightRadius <= 0) return;

  const { ctx, cellSize, physicsOptions, grid } = state;
  const gridSize = physicsOptions.gridSize;
  // Scan every cell covered by the arena-relative radius (no fixed cell-count caps)
  const cellReach = Math.min(
    gridSize,
    Math.ceil(lightRadius / Math.max(cellSize, 1e-6)) + 1,
  );

  const centerCol = Math.floor(originX / cellSize);
  const centerRow = Math.floor(originY / cellSize);
  const minCol = Math.max(0, centerCol - cellReach);
  const maxCol = Math.min(gridSize - 1, centerCol + cellReach);
  const minRow = Math.max(0, centerRow - cellReach);
  const maxRow = Math.min(gridSize - 1, centerRow + cellReach);

  ctx.save();
  ctx.beginPath();
  let hasClip = false;

  for (let r = minRow; r <= maxRow; r++) {
    const row = grid[r];
    for (let c = minCol; c <= maxCol; c++) {
      if (row[c] !== ballType) continue;

      const tileCenterX = c * cellSize + cellSize * 0.5;
      const tileCenterY = r * cellSize + cellSize * 0.5;
      const dist = Math.hypot(originX - tileCenterX, originY - tileCenterY);
      if (dist >= lightRadius) continue;

      if (lightGrid) {
        const normDist = dist / lightRadius;
        const smoothFactor = Math.cos(normDist * Math.PI * 0.5);
        const specSheen = Math.pow(smoothFactor, 2.5) * intensity;

        ctx.fillStyle = hexToRgba(color, specSheen * 0.38);
        ctx.fillRect(c * cellSize + 0.5, r * cellSize + 0.5, cellSize - 1, cellSize - 1);

        if (specSheen > 0.45 * intensity) {
          ctx.fillStyle = hexToRgba('#ffffff', (specSheen - 0.45 * intensity) * 0.22);
          ctx.fillRect(c * cellSize + 1, r * cellSize + 1, cellSize - 2, cellSize - 2);
        }

        ctx.strokeStyle = hexToRgba(color, smoothFactor * 0.65 * intensity);
        ctx.lineWidth = Math.max(0.5, state.boardWidth * 0.0012);
        ctx.strokeRect(c * cellSize + 0.5, r * cellSize + 0.5, cellSize - 1, cellSize - 1);
      }

      ctx.rect(c * cellSize, r * cellSize, cellSize, cellSize);
      hasClip = true;
    }
  }

  if (hasClip) {
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    const floorAura = ctx.createRadialGradient(originX, originY, 0, originX, originY, lightRadius);
    floorAura.addColorStop(0, hexToRgba(color, 0.45 * intensity));
    floorAura.addColorStop(0.4, hexToRgba(color, 0.18 * intensity));
    floorAura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = floorAura;
    ctx.fillRect(
      minCol * cellSize,
      minRow * cellSize,
      (maxCol - minCol + 1) * cellSize,
      (maxRow - minRow + 1) * cellSize,
    );
  }
  ctx.restore();
}

function ageEchoes(
  echoes: { life: number }[],
  deltaSeconds: number,
): void {
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
  const minLife = 0.72; // only block against fresh samples
  for (let i = echoes.length - 1; i >= 0; i--) {
    const e = echoes[i];
    if (e.life / e.maxLife < minLife) continue;
    if (Math.hypot(e.x - x, e.y - y) < spacing) return true;
  }
  return false;
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
          type: ball.type,
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

/** Soft screen glow on the black chrome; fades out toward the outer rim (do ztracena). */
let frameGlowBuf: HTMLCanvasElement | null = null;
let frameGlowFadeKey = '';
let frameGlowFadeMask: ImageData | null = null;

function getFrameGlowCtx(full: number): CanvasRenderingContext2D {
  if (!frameGlowBuf) frameGlowBuf = document.createElement('canvas');
  if (frameGlowBuf.width !== full || frameGlowBuf.height !== full) {
    frameGlowBuf.width = full;
    frameGlowBuf.height = full;
    frameGlowFadeKey = '';
    frameGlowFadeMask = null;
  }
  const ctx = frameGlowBuf.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('frame glow context unavailable');
  return ctx;
}

/** Cached alpha mask: 1 at playfield edge → 0 at outer canvas edge. */
function getFrameOuterFadeMask(W: number, F: number, full: number): ImageData {
  const key = `${W}|${F}|${full}`;
  if (frameGlowFadeMask && frameGlowFadeKey === key) return frameGlowFadeMask;

  const mask = new ImageData(full, full);
  const data = mask.data;
  for (let py = 0; py < full; py++) {
    for (let px = 0; px < full; px++) {
      const x = px - F;
      const y = py - F;
      const inside = x >= 0 && y >= 0 && x < W && y < W;
      const i = (py * full + px) * 4;
      if (inside) {
        data[i + 3] = 0;
        continue;
      }
      let d = 0;
      if (x < 0) d = Math.max(d, -x);
      if (y < 0) d = Math.max(d, -y);
      if (x > W) d = Math.max(d, x - W);
      if (y > W) d = Math.max(d, y - W);
      // Soft ease-out so rim light dissolves with the black frame
      const u = Math.min(1, Math.max(0, d / Math.max(1, F)));
      const fade = Math.pow(1 - u, 1.75);
      data[i + 3] = Math.round(255 * fade);
    }
  }
  frameGlowFadeKey = key;
  frameGlowFadeMask = mask;
  return mask;
}

function paintFrameGlowBlob(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  radius: number,
  intensity: number,
  color: string,
  F: number,
  W: number,
): void {
  if (intensity < 0.02 || radius <= 0) return;
  const glowR = radius + F * 1.85;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-F, -F, W + F * 2, W + F * 2);
  ctx.rect(0, 0, W, W);
  ctx.clip('evenodd');
  ctx.globalCompositeOperation = 'screen';
  const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, glowR);
  g.addColorStop(0, hexToRgba(color, Math.min(0.95, 0.82 * intensity)));
  g.addColorStop(0.28, hexToRgba(color, 0.42 * intensity));
  g.addColorStop(0.62, hexToRgba(color, 0.14 * intensity));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-F, -F, W + F * 2, W + F * 2);
  ctx.restore();
}

function applyFrameOuterFade(octx: CanvasRenderingContext2D, W: number, F: number, full: number): void {
  const glow = octx.getImageData(0, 0, full, full);
  const mask = getFrameOuterFadeMask(W, F, full);
  const gd = glow.data;
  const md = mask.data;
  const f = Math.ceil(F);
  // Only the chrome ring carries glow — skip the playfield interior.
  for (let py = 0; py < full; py++) {
    const inVertBand = py < f || py >= full - f;
    for (let px = 0; px < full; px++) {
      if (!inVertBand && px >= f && px < full - f) continue;
      const i = (py * full + px) * 4;
      if (gd[i + 3] === 0) continue;
      gd[i + 3] = Math.round((gd[i + 3] * md[i + 3]) / 255);
    }
  }
  octx.putImageData(glow, 0, 0);
}

function drawFloorLight(state: SimState): void {
  const { balls, boardWidth, gfxOptions } = state;
  const cfg = gfxOptions.lightShader;
  if (!isShaderOn(cfg)) return;

  const light = cfg.strength / 100;
  const lightRadius = shaderReachPx(boardWidth, cfg.reach, 0.04, 0.38);

  for (const echo of state.lightEchoes) {
    const t = Math.max(0, echo.life / echo.maxLife);
    const intensity = light * Math.pow(t, 0.9);
    if (intensity < 0.02) continue;
    paintTerritoryLight(
      state,
      echo.type,
      echo.x,
      echo.y,
      lightRadius,
      intensity,
      cfg.grid,
      shaderColorFor(state, 'light', echo.type),
    );
  }

  balls.forEach((ball) => {
    paintTerritoryLight(
      state,
      ball.type,
      ball.x,
      ball.y,
      lightRadius,
      light,
      cfg.grid,
      shaderColorFor(state, 'light', ball.type),
    );
  });
}

/** Brief post-collision glow — dividing line (frontier) hits only. */
function drawCollisionShader(state: SimState): void {
  if (state.collisionFlashes.length === 0) return;
  const cfg = state.gfxOptions.collisionShader;
  if (!isShaderOn(cfg)) return;

  const { boardWidth } = state;
  const coll = cfg.strength / 100;
  const baseRadius = shaderReachPx(boardWidth, cfg.reach, 0.05, 0.28);

  for (const flash of state.collisionFlashes) {
    const t = Math.max(0, flash.life / flash.maxLife);
    const intensity = coll * Math.pow(t, 0.85);
    const radius = baseRadius * (0.55 + t * 0.55);
    const color = shaderColorFor(state, 'collision', flash.type);
    paintTerritoryLight(
      state,
      flash.type,
      flash.x,
      flash.y,
      radius,
      intensity,
      cfg.grid,
      color,
    );
  }
}

type ReflectionBounce = { x: number; y: number; strength: number; reach: number };

/**
 * Closest points on the four arena outer walls (inner edge of the black frame).
 * Reflection never samples frontiers or open territory.
 */
function collectReflectionBounces(
  state: SimState,
  ball: { x: number; y: number },
  falloff: number,
  refl: number,
): ReflectionBounce[] {
  const W = state.boardWidth;
  const bounces: ReflectionBounce[] = [];
  if (falloff <= 0 || W <= 0) return bounces;

  const clampEdge = (v: number) => Math.max(0, Math.min(W, v));
  const edges: { x: number; y: number; dist: number }[] = [
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

function reflectionGlowRadius(
  boardWidth: number,
  reachSetting: number,
  intensity: number,
  surfaceReach: number | undefined,
): number {
  // Spread along the black frame only (clipped out of the playfield).
  const base = shaderReachPx(boardWidth, reachSetting, 0.05, 0.26);
  const scaled = base * (0.55 + Math.min(1, intensity) * 0.55);
  return Math.max(scaled, surfaceReach ?? 0);
}

/** Lights only the black chrome frame where the ball nears an outer wall. */
function drawReflectionShader(state: SimState): void {
  const { balls, boardWidth, gfxOptions } = state;
  const cfg = gfxOptions.reflectionShader;
  if (!isShaderOn(cfg)) return;

  const F = state.framePad;
  const W = boardWidth;
  if (F <= 0 || W <= 0) return;

  const full = Math.max(1, Math.ceil(W + F * 2));
  const octx = getFrameGlowCtx(full);
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, full, full);
  octx.save();
  octx.translate(F, F);

  const refl = cfg.strength / 100;

  for (const echo of state.reflectionEchoes) {
    const t = Math.max(0, echo.life / echo.maxLife);
    const intensity = echo.strength * Math.pow(t, 0.9);
    if (intensity < 0.015) continue;
    const radius = reflectionGlowRadius(boardWidth, cfg.reach, intensity, echo.reach);
    const color = shaderColorFor(state, 'reflection', echo.type);
    paintFrameGlowBlob(octx, echo.x, echo.y, radius, intensity, color, F, W);
  }

  const falloff = shaderReachPx(boardWidth, cfg.reach, 0.08, 0.42);
  balls.forEach((ball) => {
    const bounces = collectReflectionBounces(state, ball, falloff, refl);
    const color = shaderColorFor(state, 'reflection', ball.type);
    for (const b of bounces) {
      const radius = reflectionGlowRadius(boardWidth, cfg.reach, b.strength, b.reach);
      paintFrameGlowBlob(octx, b.x, b.y, radius, b.strength, color, F, W);
    }
  });

  octx.restore();
  applyFrameOuterFade(octx, W, F, full);

  const { ctx } = state;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(frameGlowBuf!, -F, -F);
  ctx.restore();
}
export function draw(state: SimState): void {
  const { ctx, boardWidth, cellSize, gfxOptions, themes, balls, particles, physicsOptions } =
    state;
  const gridSize = physicsOptions.gridSize;
  const framePad = state.framePad;
  const full = boardWidth + framePad * 2;
  if (boardWidth <= 0 || cellSize <= 0 || gridSize <= 0) return;

  ctx.clearRect(0, 0, full, full);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, full, full);

  ctx.save();
  ctx.translate(framePad, framePad);

  if (state.gridDirty || !state.gridBitmap || state.gridBitmap.width !== gridSize) {
    rebuildGridBitmap(state);
  }

  const bmp = state.gridBitmap!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0, boardWidth, boardWidth);
  ctx.imageSmoothingEnabled = true;

  if (gfxOptions.gridOpacity > 0 && gridSize <= 128) {
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const type = state.grid[r][c] as 0 | 1;
        ctx.strokeStyle = hexToRgba(themes[type].ballColor, gfxOptions.gridOpacity);
        ctx.lineWidth = 0.5;
        ctx.strokeRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }
  }

  drawFrontier(state);
  drawFloorLight(state);
  drawReflectionShader(state);
  drawCollisionShader(state);

  particles.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = boardWidth * 0.01 * p.life;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1.0;
  });

  balls.forEach((ball) => {
    const theme = themes[ball.type];
    ctx.save();

    if (gfxOptions.glowIntensity > 0) {
      const auraRadius = arenaFrac(
        boardWidth,
        0.032 + (gfxOptions.glowIntensity / 36) * 0.08,
      );
      const auraGrad = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, auraRadius);
      auraGrad.addColorStop(0, hexToRgba(theme.ballColor, 0.9));
      auraGrad.addColorStop(0.35, hexToRgba(theme.ballColor, 0.28));
      auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, auraRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    const glowBlur = boardWidth * (gfxOptions.glowIntensity / 36) * 0.025;

    if (gfxOptions.maxTrail > 0 && ball.history.length > 0) {
      if (gfxOptions.trailSolid && ball.history.length > 1) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 0; i < ball.history.length - 1; i++) {
          const p1 = ball.history[i];
          const p2 = ball.history[i + 1];
          const factor = (i + 1) / ball.history.length;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = hexToRgba(theme.ballColor, factor * 0.65);
          ctx.lineWidth = Math.max(boardWidth * 0.0015, ball.radius * factor * 1.5);
          if (gfxOptions.glowIntensity > 0) {
            ctx.shadowColor = theme.ballColor;
            ctx.shadowBlur = glowBlur * 0.4 * factor;
          }
          ctx.stroke();
        }
        const lastPos = ball.history[ball.history.length - 1];
        ctx.beginPath();
        ctx.moveTo(lastPos.x, lastPos.y);
        ctx.lineTo(ball.x, ball.y);
        ctx.strokeStyle = hexToRgba(theme.ballColor, 0.75);
        ctx.lineWidth = Math.max(boardWidth * 0.0015, ball.radius * 1.5);
        if (gfxOptions.glowIntensity > 0) {
          ctx.shadowColor = theme.ballColor;
          ctx.shadowBlur = glowBlur * 0.4;
        }
        ctx.stroke();
        ctx.restore();
      } else {
        for (let i = 0; i < ball.history.length; i++) {
          const pos = ball.history[i];
          const factor = (i + 1) / ball.history.length;
          const trailR = Math.max(boardWidth * 0.001, ball.radius * factor * 0.85);
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, trailR, 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(theme.ballColor, factor * 0.6);
          if (gfxOptions.glowIntensity > 0) {
            ctx.shadowColor = theme.ballColor;
            ctx.shadowBlur = glowBlur * 0.5 * factor;
          }
          ctx.fill();
        }
      }
    }

    if (gfxOptions.glowIntensity > 0) {
      ctx.shadowColor = theme.ballColor;
      ctx.shadowBlur = glowBlur;
    }
    ctx.fillStyle = theme.ballColor;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();

    if (ball.radius > boardWidth * 0.0015) {
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = Math.min(boardWidth * 0.012, glowBlur * 0.5);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, Math.max(boardWidth * 0.0008, ball.radius * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  });

  ctx.restore();
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
  if (!state.grid?.length || gridSize <= 0) return;
  let dayCount = 0;
  for (let r = 0; r < gridSize; r++) {
    const row = state.grid[r];
    if (!row) continue;
    for (let c = 0; c < gridSize; c++) {
      if (row[c] === 0) dayCount++;
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
