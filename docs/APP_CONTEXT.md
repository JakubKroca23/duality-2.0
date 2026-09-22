# Duality 2.0 — dlouhodobý kontext (agent memory)

> Aktualizováno: 2026-09-22  
> Repo: `/home/jakub/github/duality-2.0`  
> Jazyk UI: čeština; kód/komentáře: angličtina.  
> Údržba: po změnách mechanik/shaderů/API aktualizovat tento soubor (+ mirror do agent store). Rule: `.cursor/rules/update-app-context.mdc`.

---

## Co to je

**Yin-yang territory pong** (Day=0 / Night=1). Míčky přebarvují cizí území a odrážejí se. Simulace v prohlížeči; volitelně headless API (Postgres).

**Dva renderery (A/B):**
- **Canvas 2D** (default) — `src/sim/render.ts` (`draw`)
- **PixiJS v8 WebGL** (experiment) — `src/sim/pixi/`; toggle **Nastavení → Pixi (experiment)**; režim v `localStorage` klíč `duality_renderer_mode_v1`

„Shadery“ = `lightShader` / `collisionShader` / `reflectionShader` (`ShaderConfig`). V 2D: clip + radial + `screen`. V Pixi: GLSL filtry + Graphics.

---

## Stack a monorepo

| Část | Cesta | Tech |
|------|-------|------|
| Web (Vite) | `src/`, `index.html` | TS, Canvas 2D + PixiJS v8, Tone.js |
| API | `apps/api` | Hono, `ws`, pg |
| Headless sim | `packages/sim` | čistá fyzika bez renderu |
| DB | Docker Compose | Postgres 16 na `:5433` |

```bash
npm run dev:db   # Postgres
npm install
npm run dev      # web :5173 + API :8787 (proxy /api, /ws)
```

---

## Herní / fyzikální mechanika

### Arena

- Virtuální šířka: **10 m** (`ARENA_WIDTH_METERS`) — rychlost je v m/s, mapuje se na px přes `boardWidth / 10`.
- Grid: `gridSize × gridSize` (default 20, clamp 3–512). Start: levá polovina Day, pravá Night.
- Míček: jednotkový směr `(vx, vy)`, rychlost z `speedMps`. Poloměr ~ `boardWidth * 0.0055 * (ballScale/100)`.
- Substepping: pohyb se dělí na kroky max `cellSize * 0.16` (min 4 kroky), aby se nepropíchly buňky.

### Kolize

1. **Stěny** — clamp + absolutní odraz `vx`/`vy`, zvuk.
2. **Cizí buňka** (3×3 neighborhood kolem středu míčku):
   - circle–AABB nejbližší bod
   - pokud `distSq < r²` → buňka = `ball.type`, particles + collision flash + bounce
   - odraz podle větší složky `distX` vs `distY`, pak `setDirection` (normalizace)

### Stats

- `runTimeSec` — čas běhu
- `leadTimeDay` / `leadTimeNight` — sekundy, kdy strana měla **většinu** buněk (remíza nepočítá)

Fyzika webu: `src/sim/physics.ts`. Headless klon: `packages/sim/src/engine.ts` (stejná logika, board 1000 px, bez GFX/audio).

---

## Stav (`SimState`)

`src/sim/state.ts` — jeden stav na session:

- `grid`, `balls`, `particles`, `collisionFlashes`
- `lightEchoes`, `reflectionEchoes` — dozvuky shaderů
- `gfxOptions`, `physicsOptions`, `themes`, schéma / custom barvy
- `gridBitmap` + `gridDirty` — 1px-per-cell cache území
- `framePad` — černý chrome kolem playfieldu (reflection svítí jen sem)

---

## Render pipeline (`draw` v `src/sim/render.ts`)

Pořadí (souřadnice playfieldu po `translate(framePad)`):

1. Clear + černý full canvas (včetně frame)
2. `rebuildGridBitmap` pokud dirty → `drawImage` upscale (bez smoothing)
3. Cell outline (jen pokud `gridOpacity > 0` a `gridSize ≤ 128`)
4. **Frontier** — čáry na hranicích Day/Night
5. **Floor light** (`lightShader`) — territory-clipped glow
6. **Reflection** (`reflectionShader`) — offscreen buffer → pouze chrome frame
7. **Collision flash** (`collisionShader`) — krátký flash na frontier hitech
8. Particles
9. Míčky: aura (`glowIntensity`) → trail → body → white core

Scoreboard / lead: `updateScoreboard`, `tickRunStats`.

### Helpery

- `shaderReachPx(board, reach, minFrac, spanFrac)` — reach 0–100 → poloměr v px relative k aréně (nezávislé na grid density).
- `paintTerritoryLight` — světlo **jen na buňkách stejného typu** jako zdroj (clip + screen radial).
- `isShaderOn` = `enabled && strength > 0`.

---

## Tři „shadery“ (klíčová mechanika)

Společný typ `ShaderConfig`:

```ts
{
  enabled: boolean;   // master — vypnutí zachová strength/reach
  strength: 0–100;    // intenzita
  reach: 0–100;       // prostorový dosah (% arény)
  grid: boolean;      // per-cell sheen + stroke místo jen soft glow
  fadeMs: 50–2000;    // jak dlouho lingerují afterimages
  colors: [A, B];     // tint Day / Night
}
```

### 1) Light shader — podlahové světlo u míčku

- Kreslí `paintTerritoryLight` kolem každého míčku + kolem `lightEchoes`.
- Reach: `shaderReachPx(..., 0.04, 0.38)`.
- Trail: `updateShaderTrails` ukládá echo při pohybu o ≥ 1 % šířky arény; cap **72**; life = `fadeMs/1000`.
- `Ball.lightTrailX/Y` — poslední deposit (NaN = žádný).
- Grid mode: cos falloff + specular bílá + stroke buňky.
- Soft mode: clip území + screen radial gradient.

### 2) Collision shader — flash na frontier zásahu

- Spawnuje se v `spawnCollisionFlash` při přebarvení buňky (ne při stěně).
- Fade stejně z `fadeMs`; kreslí se přes `paintTerritoryLight` se shrinkujícím radiusem.
- Reach: `0.05 + reach*0.28` frakce arény.

### 3) Reflection shader — světlo na černém rámu

- **Jen outer walls** (vnitřní hrana černého chrome), **nikdy** frontier / území.
- `collectReflectionBounces` — 4 body (L/R/T/B), strength ~ `(1 - dist/falloff)^1.1 * refl`.
- Kreslí se do offscreen bufferu, clip `evenodd` (full minus playfield) → glow jen v `framePad`.
- `applyFrameOuterFade` — alpha maska: 1 u hranice playfieldu → 0 na vnějším okraji (pow 1.75).
- Echoes: cap **96**, spacing anti-spam; life z `fadeMs`.
- Default: **disabled** (`enabled: false`).

### Co reflection `grid` dělá

UI má checkbox `grid` i pro reflection, ale frame glow cesta (`paintFrameGlowBlob`) **grid mode nepoužívá** — grid flag je relevantní hlavně pro light/collision (`paintTerritoryLight`).

---

## Ostatní GFX

| Param | Význam |
|-------|--------|
| `glowIntensity` | Aura + shadowBlur míčku (0–36) |
| `maxTrail` / `trailSolid` | Historie pozic; solid = čára, jinak tečky |
| `particleCount` | Jiskry při frontier hit |
| `areaSaturation` | Jak silně tile barvy (0 = skoro black) |
| `frontierColor/Strength` | Hraniční čára |
| `scanlines` | CSS overlay opacity |
| `ballScale` | 50–200 % poloměru |

### Page bleed (`ambient.ts`)

Fullscreen soft halo kolem arény barvou **majority** strany (remíza = šedá). Crossfade ~2 s (`GLOW_FADE_MS`). Barvy dimnuté ×0.42.

---

## Témata

`src/config/themes.ts` — 8 built-in `CYBER_SCHEMES` (Night City, Matrix, Synthwave, Crimson, Volt, Abyss, Iceberg, Solar). Každé má:

- `tileColor`, `ballColor`, `note` (Tone.js) per side
- `look: SchemeLook` — kompletní GFX včetně 3 shaderů

Výběr tématu → `applySchemeLookToGfx`. Custom barvy → `tileFromBall` (ball × ~0.12–0.14).

**Uživatelská témata:** v Look dropdownu lze uložit aktuální barvy + GFX/shadery jako nové pojmenované téma (`src/sim/userThemes.ts`, `localStorage` klíč `duality_user_themes_v1`). Picker = built-in + user; user témata jdou smazat (×). Index `currentSchemeIndex` sahá přes `listAllSchemes()`.

---

## Sessions / UI

- Více lokálních arén (`RunSession` v `sessions.ts`): active stage + lobby dock s kartami.
- Minimized session **dál simuje** v game loopu.
- Active stage má HTML `id` mapované z `data-role` (settings cílí na aktivní).
- Settings drawer: fyzika + GFX + shadery; persist `localStorage` klíč `duality_sim_settings_v5` (migrace z v4); user themes zvlášť v `duality_user_themes_v1`.
- Speed slider: nelineární (60 % tracku = 0.1–10 m/s).

Game loop (`main.ts`): pro každou session physics → particles → flashes → shader trails → stats → draw → page bleed.

---

## Backend

### DB tabulky

- `themes`, `presets` — JSON payloady
- `simulation_runs` — status running/stopped, config, `sim_time_s`
- `territory_samples` — time series day/night %

### Sim manager

- 30 Hz wall clock; `simDt = tickDt * speedScale` (0.1–50×)
- Sample interval default 1 s → WS + Postgres
- Resume po restartu API: **nový grid**, zachovaný `sim_time` (full grid se nepersistuje)

### API

- REST: health, presets, themes, runs CRUD/start/stop, samples
- WS `/ws`: `{ type: "subscribe", runId }` → sample/status

Web client: `src/api/client.ts` (fetch + WebSocket přes Vite proxy).

---

## Mapa souborů (kde sahat)

| Účel | Soubor |
|------|--------|
| Defaults / ShaderConfig | `src/config/constants.ts` |
| Témata | `src/config/themes.ts` |
| Uživatelská témata | `src/sim/userThemes.ts` |
| Stav | `src/sim/state.ts` |
| Fyzika + reset/resize | `src/sim/physics.ts` |
| Render Canvas 2D + shadery | `src/sim/render.ts` |
| Renderer mode A/B | `src/sim/rendererMode.ts` |
| Pixi WebGL prototyp | `src/sim/pixi/PixiRenderer.ts`, `sessionPixi.ts`, `filters/*` |
| Ambient bleed | `src/sim/ambient.ts` |
| Persist UI | `src/sim/persistence.ts` |
| Controls / shader bind | `src/ui/controls.ts` |
| Multi-run sessions | `src/ui/sessions.ts` |
| Headless engine | `packages/sim/src/engine.ts` |
| API runners | `apps/api/src/simManager.ts` |
| HTML shell / UI | `index.html` (velký) |

---

## Pixi prototyp (WebGL)

- Toggle: `#chkPixiRenderer` → `getRendererMode()` / `setRendererMode()` (`duality_renderer_mode_v1`)
- Game loop větev v `main.ts`: pixi → `ensurePixi` + `render`; jinak `draw` + destroy pixi
- Territory: `BufferImageSource` RGBA (upload jen při `gridDirty`); side texture R=0/1
- Light+collision: `TerritoryLightFilter` (GLSL, max 12 lights, clip podle side texture)
- Reflection: `FrameReflectionFilter` (jen chrome frame, max 16 bounces)
- Balls/trails/particles/frontier: Pixi `Graphics`
- Overlay canvas `.pixi-view` v `#arenaFrame`; 2D canvas skrytý při `is-pixi`
- Page bleed zůstává Canvas 2D; default renderer **canvas2d**

---

## Invarianty / pastičky

1. Reach/glow jsou **arena-relative**, ne „N buněk“ — měnit gridSize nemá měnit fyzický vzhled glow velikosti.
2. Light/collision svítí jen na **vlastní území** (clip). Reflection jen na **frame**.
3. `enabled: false` vypne efekt, ale UI hodnoty zůstávají (Obnovit / theme je nepřepíše jen vypnutím).
4. Collision flash jen při frontier capture, ne při wall bounce.
5. Headless resume = fresh territory, continuous time.
6. Grid outlines vypnuté nad 128² kvůli perf.
7. Při resize se škálují x/y míčků, trails, echoes, particles.
8. Storage migrace: legacy flat fields + starý array `[sideA, sideB]` → `ShaderConfig`.
9. Při přepnutí rendereru označit `gridDirty` na všech sessions (Pixi potřebuje reupload territory).

---

## Defaulty (Obnovit / boot)

- Physics: 6 m/s, 1 míček/stranu, grid 20
- Light: on, strength 22, reach 32, fade 220, cyan/magenta
- Collision: on, 18 / 28 / 180, white/white
- Reflection: **off**, 40 / 40 / 300
- Glow 8, trail 6 solid, particles 3, areaSat 42, frontier 22
- Renderer: canvas2d

---

## Preferovaný styl změn

- Default zůstává Canvas 2D; Pixi je experimentální větev — nemazat `draw()` dokud neproběhne cutover.
- Nové vizuály spíš jako rozšíření `ShaderConfig` / `GfxOptions`; Pixi filtry čtou stejné options.
- Fyziku webu a `packages/sim` držet v syncu při změnách bounce/capture.
- Česky UI labely; anglicky kód.
