import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js';

export const MAX_BOUNCES = 16;

const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

uniform vec2 uBouncePos[16];
uniform vec3 uBounceColor[16];
uniform float uBounceIntensity[16];
uniform float uBounceRadius[16];
uniform int uBounceCount;
uniform float uBoardSize;
uniform float uFramePad;

void main() {
  float full = uBoardSize + uFramePad * 2.0;
  float px = vTextureCoord.x * full;
  float py = vTextureCoord.y * full;
  float x = px - uFramePad;
  float y = py - uFramePad;

  bool inside = x >= 0.0 && y >= 0.0 && x <= uBoardSize && y <= uBoardSize;
  if (inside) {
    finalColor = vec4(0.0);
    return;
  }

  float d = 0.0;
  if (x < 0.0) d = max(d, -x);
  if (y < 0.0) d = max(d, -y);
  if (x > uBoardSize) d = max(d, x - uBoardSize);
  if (y > uBoardSize) d = max(d, y - uBoardSize);
  float u = clamp(d / max(1.0, uFramePad), 0.0, 1.0);
  float rimFade = pow(1.0 - u, 1.75);

  vec3 accum = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= uBounceCount) break;
    float dist = distance(vec2(x, y), uBouncePos[i]);
    float radius = max(1.0, uBounceRadius[i]) + uFramePad * 1.85;
    if (dist >= radius) continue;
    float t = dist / radius;
    float fall = (1.0 - t);
    fall *= fall;
    accum += uBounceColor[i] * (uBounceIntensity[i] * fall);
  }

  accum *= rimFade;
  float a = clamp(max(max(accum.r, accum.g), accum.b), 0.0, 1.0);
  finalColor = vec4(accum, a);
}
`;

export type FrameReflectionUniformData = {
  positions: Float32Array;
  colors: Float32Array;
  intensities: Float32Array;
  radii: Float32Array;
  count: number;
  boardSize: number;
  framePad: number;
};

/** Soft glow on the black chrome frame near outer walls. */
export class FrameReflectionFilter extends Filter {
  readonly maxBounces = MAX_BOUNCES;
  private readonly bounceUniforms: UniformGroup;

  constructor() {
    const bounceUniforms = new UniformGroup({
      uBouncePos: { value: new Float32Array(MAX_BOUNCES * 2), type: 'vec2<f32>', size: MAX_BOUNCES },
      uBounceColor: { value: new Float32Array(MAX_BOUNCES * 3), type: 'vec3<f32>', size: MAX_BOUNCES },
      uBounceIntensity: { value: new Float32Array(MAX_BOUNCES), type: 'f32', size: MAX_BOUNCES },
      uBounceRadius: { value: new Float32Array(MAX_BOUNCES), type: 'f32', size: MAX_BOUNCES },
      uBounceCount: { value: 0, type: 'i32' },
      uBoardSize: { value: 1, type: 'f32' },
      uFramePad: { value: 0, type: 'f32' },
    });

    super({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment,
        name: 'frame-reflection-filter',
      }),
      resources: {
        bounceUniforms,
      },
      padding: 0,
    });

    this.bounceUniforms = bounceUniforms;
  }

  updateBounces(data: FrameReflectionUniformData): void {
    const u = this.bounceUniforms.uniforms as Record<string, unknown>;
    (u.uBouncePos as Float32Array).set(data.positions);
    (u.uBounceColor as Float32Array).set(data.colors);
    (u.uBounceIntensity as Float32Array).set(data.intensities);
    (u.uBounceRadius as Float32Array).set(data.radii);
    u.uBounceCount = data.count;
    u.uBoardSize = data.boardSize;
    u.uFramePad = data.framePad;
  }
}
