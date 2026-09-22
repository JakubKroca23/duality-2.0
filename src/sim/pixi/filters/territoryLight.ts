import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js';
import type { TextureSource } from 'pixi.js';

export const MAX_LIGHTS = 48;

const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uSideTexture;

uniform vec2 uLightPos[48];
uniform vec3 uLightColor[48];
uniform float uLightIntensity[48];
uniform float uLightRadius[48];
uniform float uLightSide[48];
uniform int uLightCount;
uniform float uBoardSize;
uniform float uFramePad;
uniform float uGridMode;

void main() {
  float full = uBoardSize + uFramePad * 2.0;
  float x = vTextureCoord.x * full - uFramePad;
  float y = vTextureCoord.y * full - uFramePad;
  if (x < 0.0 || y < 0.0 || x > uBoardSize || y > uBoardSize) {
    finalColor = vec4(0.0);
    return;
  }

  vec2 playUv = vec2(x / uBoardSize, y / uBoardSize);
  float side = texture(uSideTexture, playUv).r;
  vec3 accum = vec3(0.0);

  for (int i = 0; i < 48; i++) {
    if (i >= uLightCount) break;
    if (abs(side - uLightSide[i]) > 0.5) continue;

    float dist = distance(vec2(x, y), uLightPos[i]);
    float radius = max(1.0, uLightRadius[i]);
    if (dist >= radius) continue;

    float t = dist / radius;
    float fall = (1.0 - t);
    fall *= fall;
    float intensity = uLightIntensity[i] * fall;

    if (uGridMode > 0.5) {
      float cell = max(uBoardSize / 64.0, 2.0);
      vec2 cellCenter = floor(vec2(x, y) / cell) * cell + cell * 0.5;
      float cd = distance(vec2(x, y), cellCenter);
      float edge = smoothstep(cell * 0.55, cell * 0.15, cd);
      intensity *= 0.55 + edge * 0.7;
    }

    accum += uLightColor[i] * intensity;
  }

  float a = clamp(max(max(accum.r, accum.g), accum.b), 0.0, 1.0);
  finalColor = vec4(accum, a);
}
`;

export type TerritoryLightUniformData = {
  positions: Float32Array;
  colors: Float32Array;
  intensities: Float32Array;
  radii: Float32Array;
  sides: Float32Array;
  count: number;
  boardSize: number;
  framePad: number;
  gridMode: boolean;
};

/** Soft territory-clipped lights (light + collision) as a full-frame overlay filter. */
export class TerritoryLightFilter extends Filter {
  readonly maxLights = MAX_LIGHTS;
  private readonly lightUniforms: UniformGroup;

  constructor() {
    const lightUniforms = new UniformGroup({
      uLightPos: { value: new Float32Array(MAX_LIGHTS * 2), type: 'vec2<f32>', size: MAX_LIGHTS },
      uLightColor: { value: new Float32Array(MAX_LIGHTS * 3), type: 'vec3<f32>', size: MAX_LIGHTS },
      uLightIntensity: { value: new Float32Array(MAX_LIGHTS), type: 'f32', size: MAX_LIGHTS },
      uLightRadius: { value: new Float32Array(MAX_LIGHTS), type: 'f32', size: MAX_LIGHTS },
      uLightSide: { value: new Float32Array(MAX_LIGHTS), type: 'f32', size: MAX_LIGHTS },
      uLightCount: { value: 0, type: 'i32' },
      uBoardSize: { value: 1, type: 'f32' },
      uFramePad: { value: 0, type: 'f32' },
      uGridMode: { value: 0, type: 'f32' },
    });

    super({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment,
        name: 'territory-light-filter',
      }),
      resources: {
        lightUniforms,
      },
      padding: 0,
    });

    this.lightUniforms = lightUniforms;
  }

  setSideSource(source: TextureSource): void {
    const resources = this.resources as Record<string, unknown>;
    resources.uSideTexture = source;
    resources.uSideSampler = source.style;
  }

  updateLights(data: TerritoryLightUniformData): void {
    const u = this.lightUniforms.uniforms as Record<string, unknown>;
    (u.uLightPos as Float32Array).set(data.positions);
    (u.uLightColor as Float32Array).set(data.colors);
    (u.uLightIntensity as Float32Array).set(data.intensities);
    (u.uLightRadius as Float32Array).set(data.radii);
    (u.uLightSide as Float32Array).set(data.sides);
    u.uLightCount = data.count;
    u.uBoardSize = data.boardSize;
    u.uFramePad = data.framePad;
    u.uGridMode = data.gridMode ? 1 : 0;
  }
}
