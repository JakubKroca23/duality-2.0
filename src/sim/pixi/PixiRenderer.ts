import {
  Application,
  BufferImageSource,
  Container,
  Graphics,
  Sprite,
  Texture,
} from 'pixi.js';
import { isShaderOn } from '../../config/constants';
import type { SimState } from '../state';
import { shaderColorFor } from '../render';
import { FrameReflectionFilter, MAX_BOUNCES } from './filters/frameReflection';
import { MAX_LIGHTS, TerritoryLightFilter } from './filters/territoryLight';

function parseHex(hex: string): [number, number, number] {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function hexToRgb01(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex);
  return [r / 255, g / 255, b / 255];
}

function saturatedTile(hex: string, sat: number): [number, number, number] {
  const [r, g, b] = parseHex(hex);
  const t = Math.max(0, Math.min(1, sat / 100));
  const lift = 0.15 + t * 0.85;
  return [Math.round(r * lift), Math.round(g * lift), Math.round(b * lift)];
}

function arenaFrac(boardWidth: number, fraction: number): number {
  return Math.max(0, boardWidth * fraction);
}

function shaderReachPx(boardWidth: number, reach: number, minFrac: number, spanFrac: number): number {
  const r = Math.max(0, Math.min(100, reach)) / 100;
  return arenaFrac(boardWidth, minFrac + r * spanFrac);
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

/**
 * Experimental PixiJS WebGL renderer (parity prototype alongside Canvas 2D).
 * Owns a canvas overlay inside the arena frame; does not replace SimState.
 */
export class PixiRenderer {
  private app: Application | null = null;
  private host: HTMLElement | null = null;
  private ready: Promise<void> | null = null;

  private boardRoot: Container | null = null;
  private territorySprite: Sprite | null = null;
  private frontierGfx: Graphics | null = null;
  private gridGfx: Graphics | null = null;
  private lightOverlay: Sprite | null = null;
  private reflectionOverlay: Sprite | null = null;
  private fxGfx: Graphics | null = null;

  private colorPixels: Uint8Array | null = null;
  private sidePixels: Uint8Array | null = null;
  private colorSource: BufferImageSource | null = null;
  private sideSource: BufferImageSource | null = null;
  private colorTexture: Texture | null = null;
  private sideTexture: Texture | null = null;
  private gridSize = 0;

  private lightFilter: TerritoryLightFilter | null = null;
  private reflectionFilter: FrameReflectionFilter | null = null;

  private lightPos = new Float32Array(MAX_LIGHTS * 2);
  private lightCol = new Float32Array(MAX_LIGHTS * 3);
  private lightInt = new Float32Array(MAX_LIGHTS);
  private lightRad = new Float32Array(MAX_LIGHTS);
  private lightSide = new Float32Array(MAX_LIGHTS);

  private bouncePos = new Float32Array(MAX_BOUNCES * 2);
  private bounceCol = new Float32Array(MAX_BOUNCES * 3);
  private bounceInt = new Float32Array(MAX_BOUNCES);
  private bounceRad = new Float32Array(MAX_BOUNCES);

  private lastFull = 0;

  async init(host: HTMLElement): Promise<void> {
    if (this.app && this.host === host) return;
    if (this.ready) return this.ready;

    this.host = host;
    this.ready = this.boot(host);
    try {
      await this.ready;
    } catch (err) {
      this.ready = null;
      throw err;
    }
  }

  private async boot(host: HTMLElement): Promise<void> {
    // Build filters first — if UniformGroup throws, we must not leave orphan canvases.
    const lightFilter = new TerritoryLightFilter();
    const reflectionFilter = new FrameReflectionFilter();

    const size = Math.max(32, Math.floor(host.clientWidth) || 320);
    const dpr = window.devicePixelRatio || 1;

    const app = new Application();
    await app.init({
      width: size,
      height: size,
      backgroundColor: 0x000000,
      antialias: true,
      resolution: dpr,
      autoDensity: true,
      autoStart: false,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });

    const view = app.canvas;
    view.classList.add('pixi-view');
    view.setAttribute('aria-hidden', 'true');
    host.appendChild(view);
    host.classList.add('is-pixi');

    const boardRoot = new Container();
    app.stage.addChild(boardRoot);

    const territorySprite = new Sprite();
    territorySprite.roundPixels = true;
    boardRoot.addChild(territorySprite);

    const frontierGfx = new Graphics();
    boardRoot.addChild(frontierGfx);

    const gridGfx = new Graphics();
    boardRoot.addChild(gridGfx);

    const lightOverlay = new Sprite(Texture.WHITE);
    lightOverlay.tint = 0xffffff;
    lightOverlay.alpha = 1;
    lightOverlay.filters = [lightFilter];
    lightOverlay.blendMode = 'screen';
    app.stage.addChild(lightOverlay);

    const reflectionOverlay = new Sprite(Texture.WHITE);
    reflectionOverlay.filters = [reflectionFilter];
    reflectionOverlay.blendMode = 'screen';
    app.stage.addChild(reflectionOverlay);

    const fxGfx = new Graphics();
    boardRoot.addChild(fxGfx);

    this.app = app;
    this.boardRoot = boardRoot;
    this.territorySprite = territorySprite;
    this.frontierGfx = frontierGfx;
    this.gridGfx = gridGfx;
    this.lightOverlay = lightOverlay;
    this.reflectionOverlay = reflectionOverlay;
    this.fxGfx = fxGfx;
    this.lightFilter = lightFilter;
    this.reflectionFilter = reflectionFilter;
  }

  isReady(): boolean {
    return this.app !== null;
  }

  resize(fullCssPx: number, framePad: number): void {
    if (!this.app || !this.boardRoot) return;
    const dpr = window.devicePixelRatio || 1;
    const full = Math.max(32, Math.floor(fullCssPx));
    if (full !== this.lastFull) {
      this.app.renderer.resize(full, full, dpr);
      this.lastFull = full;
    }
    this.boardRoot.position.set(framePad, framePad);

    if (this.lightOverlay) {
      this.lightOverlay.width = full;
      this.lightOverlay.height = full;
      this.lightOverlay.position.set(0, 0);
    }
    if (this.reflectionOverlay) {
      this.reflectionOverlay.width = full;
      this.reflectionOverlay.height = full;
      this.reflectionOverlay.position.set(0, 0);
    }
  }

  destroy(): void {
    const host = this.host;
    if (this.app) {
      const view = this.app.canvas;
      this.app.destroy(true, { children: true, texture: true });
      view.remove();
    }
    host?.classList.remove('is-pixi');
    this.app = null;
    this.host = null;
    this.ready = null;
    this.boardRoot = null;
    this.territorySprite = null;
    this.frontierGfx = null;
    this.gridGfx = null;
    this.lightOverlay = null;
    this.reflectionOverlay = null;
    this.fxGfx = null;
    this.lightFilter = null;
    this.reflectionFilter = null;
    this.colorPixels = null;
    this.sidePixels = null;
    this.colorSource = null;
    this.sideSource = null;
    this.colorTexture = null;
    this.sideTexture = null;
    this.gridSize = 0;
    this.lastFull = 0;
  }

  render(state: SimState): void {
    if (!this.app || !this.boardRoot || !this.territorySprite) return;
    const { boardWidth, framePad, cellSize, physicsOptions } = state;
    const gridSize = physicsOptions.gridSize;
    if (boardWidth <= 0 || cellSize <= 0 || gridSize <= 0) return;

    const full = boardWidth + framePad * 2;
    this.resize(full, framePad);

    this.syncTerritory(state);
    this.drawFrontier(state);
    this.drawCellGrid(state);
    this.updateLightFilter(state);
    this.updateReflectionFilter(state);
    this.drawBallsAndParticles(state);

    this.app.render();
  }

  private ensureTextures(n: number): void {
    if (this.gridSize === n && this.colorTexture && this.sideTexture) return;

    this.colorPixels = new Uint8Array(n * n * 4);
    this.sidePixels = new Uint8Array(n * n * 4);

    this.colorSource = new BufferImageSource({
      resource: this.colorPixels,
      width: n,
      height: n,
      format: 'rgba8unorm',
      scaleMode: 'nearest',
      autoGenerateMipmaps: false,
    });
    this.sideSource = new BufferImageSource({
      resource: this.sidePixels,
      width: n,
      height: n,
      format: 'rgba8unorm',
      scaleMode: 'nearest',
      autoGenerateMipmaps: false,
    });

    this.colorTexture = new Texture({ source: this.colorSource });
    this.sideTexture = new Texture({ source: this.sideSource });
    this.gridSize = n;

    if (this.territorySprite) {
      this.territorySprite.texture = this.colorTexture;
    }
    if (this.lightFilter && this.sideSource) {
      this.lightFilter.setSideSource(this.sideSource);
    }
  }

  private syncTerritory(state: SimState): void {
    const n = state.physicsOptions.gridSize;
    this.ensureTextures(n);
    if (!this.colorPixels || !this.sidePixels || !this.colorSource || !this.sideSource) return;
    if (!this.territorySprite) return;

    this.territorySprite.width = state.boardWidth;
    this.territorySprite.height = state.boardWidth;

    if (!state.gridDirty && this.colorTexture) {
      return;
    }

    const sat = state.gfxOptions.areaSaturation;
    const day = saturatedTile(state.themes[0].tileColor, sat);
    const night = saturatedTile(state.themes[1].tileColor, sat);
    const color = this.colorPixels;
    const side = this.sidePixels;

    for (let r = 0; r < n; r++) {
      const row = state.grid[r];
      for (let c = 0; c < n; c++) {
        const i = (r * n + c) * 4;
        const isNight = row[c] === 1;
        const col = isNight ? night : day;
        color[i] = col[0];
        color[i + 1] = col[1];
        color[i + 2] = col[2];
        color[i + 3] = 255;
        side[i] = isNight ? 255 : 0;
        side[i + 1] = 0;
        side[i + 2] = 0;
        side[i + 3] = 255;
      }
    }

    this.colorSource.resource = color;
    this.sideSource.resource = side;
    this.colorSource.update();
    this.sideSource.update();
    state.gridDirty = false;
  }

  private drawFrontier(state: SimState): void {
    const gfx = this.frontierGfx;
    if (!gfx) return;
    gfx.clear();

    const strength = state.gfxOptions.frontierStrength / 100;
    if (strength <= 0) return;

    const { cellSize, physicsOptions, grid, boardWidth } = state;
    const gridSize = physicsOptions.gridSize;
    const [cr, cg, cb] = parseHex(state.gfxOptions.frontierColor);
    const alpha = Math.min(1, strength * 0.95);
    const lw = Math.max(1, Math.min(4, boardWidth * 0.006));
    const color = (cr << 16) | (cg << 8) | cb;

    gfx.setStrokeStyle({ width: lw, color, alpha });

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const t = grid[r][c];
        if (c + 1 < gridSize && grid[r][c + 1] !== t) {
          const x = (c + 1) * cellSize;
          const y0 = r * cellSize;
          gfx.moveTo(x, y0);
          gfx.lineTo(x, y0 + cellSize);
        }
        if (r + 1 < gridSize && grid[r + 1][c] !== t) {
          const y = (r + 1) * cellSize;
          const x0 = c * cellSize;
          gfx.moveTo(x0, y);
          gfx.lineTo(x0 + cellSize, y);
        }
      }
    }
    gfx.stroke();
  }

  private drawCellGrid(state: SimState): void {
    const gfx = this.gridGfx;
    if (!gfx) return;
    gfx.clear();

    const { gfxOptions, physicsOptions, cellSize, themes, grid } = state;
    const gridSize = physicsOptions.gridSize;
    if (gfxOptions.gridOpacity <= 0 || gridSize > 128) return;

    const lw = 0.5;
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const type = grid[r][c] as 0 | 1;
        const [cr, cg, cb] = parseHex(themes[type].ballColor);
        const color = (cr << 16) | (cg << 8) | cb;
        gfx.setStrokeStyle({ width: lw, color, alpha: gfxOptions.gridOpacity });
        gfx.rect(c * cellSize, r * cellSize, cellSize, cellSize);
        gfx.stroke();
      }
    }
  }

  private pushLight(
    count: number,
    x: number,
    y: number,
    rgb: [number, number, number],
    intensity: number,
    radius: number,
    side: number,
  ): number {
    if (count >= MAX_LIGHTS || intensity < 0.02 || radius <= 0) return count;
    const i = count;
    this.lightPos[i * 2] = x;
    this.lightPos[i * 2 + 1] = y;
    this.lightCol[i * 3] = rgb[0];
    this.lightCol[i * 3 + 1] = rgb[1];
    this.lightCol[i * 3 + 2] = rgb[2];
    this.lightInt[i] = intensity;
    this.lightRad[i] = radius;
    this.lightSide[i] = side;
    return count + 1;
  }

  private updateLightFilter(state: SimState): void {
    const filter = this.lightFilter;
    const overlay = this.lightOverlay;
    if (!filter || !overlay) return;

    const { boardWidth, framePad, balls, gfxOptions } = state;
    let count = 0;
    let anyGrid = false;

    const lightCfg = gfxOptions.lightShader;
    if (isShaderOn(lightCfg)) {
      anyGrid = anyGrid || lightCfg.grid;
      const light = lightCfg.strength / 100;
      const lightRadius = shaderReachPx(boardWidth, lightCfg.reach, 0.04, 0.38);
      for (const echo of state.lightEchoes) {
        const t = Math.max(0, echo.life / echo.maxLife);
        const intensity = light * Math.pow(t, 0.9);
        const rgb = hexToRgb01(shaderColorFor(state, 'light', echo.type));
        count = this.pushLight(count, echo.x, echo.y, rgb, intensity, lightRadius, echo.type);
      }
      for (const ball of balls) {
        const rgb = hexToRgb01(shaderColorFor(state, 'light', ball.type));
        count = this.pushLight(count, ball.x, ball.y, rgb, light, lightRadius, ball.type);
      }
    }

    const collCfg = gfxOptions.collisionShader;
    if (isShaderOn(collCfg) && state.collisionFlashes.length > 0) {
      anyGrid = anyGrid || collCfg.grid;
      const coll = collCfg.strength / 100;
      const baseRadius = shaderReachPx(boardWidth, collCfg.reach, 0.05, 0.28);
      for (const flash of state.collisionFlashes) {
        const t = Math.max(0, flash.life / flash.maxLife);
        const intensity = coll * Math.pow(t, 0.85);
        const radius = baseRadius * (0.55 + t * 0.55);
        const rgb = hexToRgb01(shaderColorFor(state, 'collision', flash.type));
        count = this.pushLight(count, flash.x, flash.y, rgb, intensity, radius, flash.type);
      }
    }

    overlay.visible = count > 0;
    if (count === 0) return;

    filter.updateLights({
      positions: this.lightPos,
      colors: this.lightCol,
      intensities: this.lightInt,
      radii: this.lightRad,
      sides: this.lightSide,
      count,
      boardSize: boardWidth,
      framePad,
      gridMode: anyGrid,
    });
  }

  private updateReflectionFilter(state: SimState): void {
    const filter = this.reflectionFilter;
    const overlay = this.reflectionOverlay;
    if (!filter || !overlay) return;

    const cfg = state.gfxOptions.reflectionShader;
    if (!isShaderOn(cfg) || state.framePad <= 0) {
      overlay.visible = false;
      return;
    }

    const { boardWidth, framePad, balls } = state;
    const refl = cfg.strength / 100;
    const falloff = shaderReachPx(boardWidth, cfg.reach, 0.08, 0.42);
    let count = 0;

    const push = (
      x: number,
      y: number,
      rgb: [number, number, number],
      intensity: number,
      radius: number,
    ): void => {
      if (count >= MAX_BOUNCES || intensity < 0.015) return;
      const i = count;
      this.bouncePos[i * 2] = x;
      this.bouncePos[i * 2 + 1] = y;
      this.bounceCol[i * 3] = rgb[0];
      this.bounceCol[i * 3 + 1] = rgb[1];
      this.bounceCol[i * 3 + 2] = rgb[2];
      this.bounceInt[i] = intensity;
      this.bounceRad[i] = radius;
      count++;
    };

    for (const echo of state.reflectionEchoes) {
      const t = Math.max(0, echo.life / echo.maxLife);
      const intensity = echo.strength * Math.pow(t, 0.9);
      const base = shaderReachPx(boardWidth, cfg.reach, 0.05, 0.26);
      const radius = Math.max(base * (0.55 + Math.min(1, intensity) * 0.55), echo.reach ?? 0);
      const rgb = hexToRgb01(shaderColorFor(state, 'reflection', echo.type));
      push(echo.x, echo.y, rgb, intensity, radius);
    }

    for (const ball of balls) {
      const bounces = collectReflectionBounces(state, ball, falloff, refl);
      const rgb = hexToRgb01(shaderColorFor(state, 'reflection', ball.type));
      for (const b of bounces) {
        const base = shaderReachPx(boardWidth, cfg.reach, 0.05, 0.26);
        const radius = Math.max(base * (0.55 + Math.min(1, b.strength) * 0.55), b.reach);
        push(b.x, b.y, rgb, b.strength, radius);
      }
    }

    overlay.visible = count > 0;
    if (count === 0) return;

    filter.updateBounces({
      positions: this.bouncePos,
      colors: this.bounceCol,
      intensities: this.bounceInt,
      radii: this.bounceRad,
      count,
      boardSize: boardWidth,
      framePad,
    });
  }

  private drawBallsAndParticles(state: SimState): void {
    const gfx = this.fxGfx;
    if (!gfx) return;
    gfx.clear();

    const { boardWidth, gfxOptions, themes, balls, particles } = state;

    for (const p of particles) {
      let color = 0xffffff;
      if (p.color.startsWith('#')) {
        const [r, g, b] = parseHex(p.color);
        color = (r << 16) | (g << 8) | b;
      } else if (p.color.startsWith('rgb')) {
        const m = p.color.match(/(\d+)/g);
        if (m && m.length >= 3) {
          color = (Number(m[0]) << 16) | (Number(m[1]) << 8) | Number(m[2]);
        }
      }
      gfx.circle(p.x, p.y, Math.max(0.5, p.size * p.life));
      gfx.fill({ color, alpha: p.life });
    }

    for (const ball of balls) {
      const theme = themes[ball.type];
      const [br, bg, bb] = parseHex(theme.ballColor);
      const ballColor = (br << 16) | (bg << 8) | bb;

      if (gfxOptions.glowIntensity > 0) {
        const auraRadius = arenaFrac(
          boardWidth,
          0.032 + (gfxOptions.glowIntensity / 36) * 0.08,
        );
        gfx.circle(ball.x, ball.y, auraRadius);
        gfx.fill({ color: ballColor, alpha: 0.22 });
        gfx.circle(ball.x, ball.y, auraRadius * 0.45);
        gfx.fill({ color: ballColor, alpha: 0.35 });
      }

      if (gfxOptions.maxTrail > 0 && ball.history.length > 0) {
        if (gfxOptions.trailSolid && ball.history.length > 1) {
          for (let i = 0; i < ball.history.length - 1; i++) {
            const p1 = ball.history[i];
            const p2 = ball.history[i + 1];
            const factor = (i + 1) / ball.history.length;
            const lw = Math.max(boardWidth * 0.0015, ball.radius * factor * 1.5);
            gfx.moveTo(p1.x, p1.y);
            gfx.lineTo(p2.x, p2.y);
            gfx.stroke({ width: lw, color: ballColor, alpha: factor * 0.65 });
          }
          const last = ball.history[ball.history.length - 1];
          gfx.moveTo(last.x, last.y);
          gfx.lineTo(ball.x, ball.y);
          gfx.stroke({
            width: Math.max(boardWidth * 0.0015, ball.radius * 1.5),
            color: ballColor,
            alpha: 0.75,
          });
        } else {
          for (let i = 0; i < ball.history.length; i++) {
            const pos = ball.history[i];
            const factor = (i + 1) / ball.history.length;
            const trailR = Math.max(boardWidth * 0.001, ball.radius * factor * 0.85);
            gfx.circle(pos.x, pos.y, trailR);
            gfx.fill({ color: ballColor, alpha: factor * 0.6 });
          }
        }
      }

      gfx.circle(ball.x, ball.y, ball.radius);
      gfx.fill({ color: ballColor, alpha: 1 });

      if (ball.radius > boardWidth * 0.0015) {
        gfx.circle(ball.x, ball.y, Math.max(boardWidth * 0.0008, ball.radius * 0.5));
        gfx.fill({ color: 0xffffff, alpha: 0.95 });
      }
    }
  }
}
