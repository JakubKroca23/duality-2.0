import type { Side } from '../config/constants';

export type TrailPoint = { x: number; y: number };

export class Ball {
  type: Side;
  x: number;
  y: number;
  radius = 0;
  history: TrailPoint[] = [];
  /** Last deposited light-shader trail sample (NaN = none). */
  lightTrailX = Number.NaN;
  lightTrailY = Number.NaN;
  vx: number;
  vy: number;

  constructor(type: Side, x: number, y: number) {
    this.type = type;
    this.x = x;
    this.y = y;

    let angle = Math.random() * Math.PI * 2;
    while (Math.abs(Math.sin(angle)) < 0.25 || Math.abs(Math.cos(angle)) < 0.25) {
      angle = Math.random() * Math.PI * 2;
    }
    this.vx = Math.cos(angle);
    this.vy = Math.sin(angle);
  }

  setDirection(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy) || 1;
    this.vx = dx / len;
    this.vy = dy / len;
  }
}

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  color: string;
};
