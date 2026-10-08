# Chaos 2.0 — dlouhodobý kontext (agent memory)

> Aktualizováno: 2026-10-08 (mobile perf)  
> Repo: `/home/jakub/github/duality-2.0` (npm: `chaos-2.0`)  
> Produkce: https://chaos.propoj.app  
> Jazyk UI: čeština; kód/komentáře: angličtina.  
> Údržba: po změnách mechanik/shaderů/API aktualizovat tento soubor (+ mirror do agent store). Rule: `.cursor/rules/update-app-context.mdc`.

---

## Co to je

**Yin-yang territory pong** (Day=0 / Night=1), branding **Chaos 2.0**. Míčky přebarvují cizí území a odrážejí se. Simulace v prohlížeči; volitelně headless API (Postgres).

**Renderer: PixiJS v8 WebGL** (`src/sim/pixi/`) — jediný vizuální backend. Canvas 2D `draw()` odstraněn. `#simCanvas` je jen layout probe; viditelný view je `.pixi-view`.

„Shadery“ = `lightShader` / `collisionShader` / `reflectionShader` (`ShaderConfig`) → GLSL filtry + Graphics. Všechna nastavení vzhledu čte Pixi z `gfxOptions`.

---

## Stack a monorepo

| Část | Cesta | Tech |
|------|-------|------|
| Web (Vite) | `src/`, `index.html` | TS, PixiJS v8, Tone.js |
| API | `apps/api` | Hono, `ws`, pg |
| Headless sim | `packages/sim` | čistá fyzika bez renderu |
| DB / prod stack | Docker Compose + Traefik | Postgres; web nginx; api `:8787`; HTTPS `chaos.propoj.app` |

```bash
npm run docker:up       # lokálně → http://127.0.0.1:8080
npm run docker:up:prod  # Traefik → https://chaos.propoj.app
npm run docker:down
npm run docker:logs
# nebo jen DB pro lokální npm run dev:
npm run dev:db
```

Produkce: `docker-compose.prod.yml` — Traefik labels na `web` → `Host(chaos.propoj.app)`, síť `personal`, certresolver `letsencrypt`. Viz `.env.example`.

Lokalní `vite preview` (`npm run preview`) slouží jen k rychlému náhledu `dist/` — produkční cesta je Docker web image.
---

## Herní / fyzikální mechanika

### Arena

- Virtuální šířka: **10 m** (`ARENA_WIDTH_METERS`) — rychlost v m/s → px přes `boardWidth / 10`.
- Grid: `gridSize × gridSize` (default 20, clamp 3–512). Start: levá Day, pravá Night.
- Míček: jednotkový směr `(vx, vy)`, rychlost `speedMps`. Poloměr ~ `boardWidth * 0.0055 * (ballScale/100)`.
- Substepping: max `cellSize * 0.16` (min 4 kroky).

### Kolize

1. **Stěny** — clamp + odraz, zvuk.
2. **Cizí buňka** (3×3): circle–AABB → přebarvení + particles + collision flash + bounce.

### Stats

- `runTimeSec`, `leadTimeDay` / `leadTimeNight` (většina území).

Fyzika webu: `src/sim/physics.ts`. Headless: `packages/sim/src/engine.ts`.

---

## Stav (`SimState`)

- `grid`, `balls`, `particles`, `collisionFlashes`
- `lightEchoes`, `reflectionEchoes`
- `gfxOptions`, `physicsOptions`, `themes`
- `gridDirty` — territory GPU texture rebuild
- `framePad` — chrome kolem playfieldu
- `canvas` — layout probe (bez 2D/WebGL contextu)

---

## Render pipeline (Pixi)

`main.ts` → `ensurePixi` → `PixiRenderer.render(state)`:

1. Black stage + `boardRoot` na `framePad`
2. Territory `BufferImageSource` (nearest; upload při dirty / look change)
3. Cell outline Graphics (`gridOpacity`, max 128²)
4. Frontier Graphics
5. Light+collision: `TerritoryLightFilter` (GLSL, max **48** lights, side clip)
6. Reflection: `FrameReflectionFilter` (jen chrome, max **16** bounces)
7. Particles + míčky (glow / trail / body) — Graphics

`src/sim/render.ts`: jen `updateShaderTrails`, scoreboard, `markGridDirty`, helpers.  
Page bleed (`ambient.ts`): Canvas 2D fullscreen mimo arénu — **na mobilu vypnuto** (CSS `blur(64px)` + fullscreen 2D = stutter).

### Mobile perf (`src/sim/perf.ts`)

- Cap DPR (~1.25), `antialias: false`, filter resolution 0.5
- Max ~10 lights / 16 light echoes; frontier + cell grid cache dokud `gridDirty`
- Minimized sessiony jen fyzika (bez Pixi render)
- Pause loop když `document.hidden`

---

## Tři shadery (`ShaderConfig`)

```ts
{ enabled, strength: 0–100, reach: 0–100, grid, fadeMs: 50–2000, colors: [A, B] }
```

`isShaderOn` = `enabled && strength > 0`. Reach = arena-relative.

1. **Light** — floor glow na vlastním území + echoes (cap 72)
2. **Collision** — flash při frontier capture (ne wall)
3. **Reflection** — glow na chrome u stěn (default off); UI `grid` se nepoužívá

---

## Ostatní GFX

| Param | Význam |
|-------|--------|
| `glowIntensity` | Aura míčku (jen z témat / persist — není v UI) |
| `maxTrail` / `trailSolid` | Stopa |
| `particleCount` | Jiskry |
| `areaSaturation` | Sytost territory fill |
| `frontierColor/Strength` | Dělící linka |
| `scanlines` | CSS CRT overlay |
| `ballScale` | 50–200 % |

---

## Témata

`src/config/themes.ts` — built-in `CYBER_SCHEMES` + user themes (`userThemes.ts`, `duality_user_themes_v1`).  
Výběr → `applySchemeLookToGfx` (včetně 3 shaderů).

---

## Sessions / UI

- `RunSession` + lobby dock; minimized dál simuje.
- Settings **vedle arény** (`absolute; left: 100%`), bez panel chrome; `#simWrapper.settings-open` posune layout.
- Persist: `duality_sim_settings_v5`.

Game loop: physics → particles → flashes → shader trails → stats → **Pixi render** → page bleed.

---

## Backend

- Postgres: themes, presets, simulation_runs, territory_samples (Docker user/db default `chaos`)
- API `:8787` + WS `/ws`; headless 30 Hz, `speedScale`
- CORS přes `CORS_ORIGINS` (default inkl. `https://chaos.propoj.app` + localhost Vite)
- Prod: nginx ve web image proxy `/api` + `/ws` (stejný origin)

---

## Mapa souborů

| Účel | Soubor |
|------|--------|
| Defaults / ShaderConfig | `src/config/constants.ts` |
| Témata | `src/config/themes.ts` |
| User themes | `src/sim/userThemes.ts` |
| Stav | `src/sim/state.ts` |
| Fyzika | `src/sim/physics.ts` |
| Trails / scoreboard | `src/sim/render.ts` |
| **Pixi renderer** | `src/sim/pixi/PixiRenderer.ts`, `sessionPixi.ts`, `filters/*` |
| Ambient bleed | `src/sim/ambient.ts` |
| Mobile perf profile | `src/sim/perf.ts` |
| Controls | `src/ui/controls.ts` |
| Sessions | `src/ui/sessions.ts` |
| Headless | `packages/sim/src/engine.ts` |
| API | `apps/api/src/simManager.ts` |

---

## Invarianty

1. Reach/glow arena-relative (ne „N buněk“).
2. Light/collision jen vlastní území; reflection jen frame.
3. `enabled: false` zachová slider hodnoty.
4. Collision flash jen frontier capture.
5. Grid outlines off nad 128².
6. Nikdy `getContext('2d')` na arena canvas — Pixi potřebuje čistý element / vlastní view.
7. Uniform arrays v Pixi: `type: 'vec2<f32>', size: N` (ne `array<…>`).

---

## Defaulty

- Physics: 6 m/s, 1/stranu, grid 20
- Light on 22/32/220; Collision on 18/28/180; Reflection **off**
- Glow 8, trail 6 solid, particles 3, areaSat 42, frontier 22

---

## Preferovaný styl změn

- Nové vizuály přes `ShaderConfig` / `GfxOptions` + Pixi filtry/Graphics.
- Nemá se vracet Canvas 2D arena draw.
- Fyziku webu a `@duality/sim` držet v syncu.
- Česky UI; anglicky kód.
