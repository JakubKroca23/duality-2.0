# Duality 2.0

Canvas 2D yin-yang territory pong + lokální backend pro dlouhodobé sim-běhy.

## Rychlý start (lokálně)

```bash
# 1) Postgres (port 5433)
npm run dev:db

# 2) závislosti (root + workspaces)
npm install

# 3) web + API najednou
npm run dev
```

Nebo zvlášť:

```bash
npm run dev:api   # http://localhost:8787
npm run dev:web   # http://localhost:5173  (proxy /api a /ws)
```

V UI: **Nastavení → Běhy** — spusť kontejner z aktuální fyziky, sleduj graf day %, stop/start více běhů.

## Stack

- **Web** — Vite + Canvas (stávající UI)
- **API** — Hono + WebSocket (`apps/api`)
- **Sim engine** — headless `@duality/sim` (`packages/sim`)
- **DB** — Postgres 16 přes Docker Compose na `localhost:5433`

## API (localhost:8787)

- `GET /api/health`
- `GET/POST /api/presets`, `GET/POST /api/themes`
- `GET/POST /api/runs`, `POST /api/runs/:id/stop|start`, `GET /api/runs/:id/samples`
- `WS /ws` — `{ type: "subscribe", runId }` → sample/status eventy

## Poznámka

Běhy na serveru jedou, dokud je nestopneš (nebo dokud nerestartuješ API). Po restartu API se `running` běhy znovu spustí (nový grid, pokračující `sim_time`).
