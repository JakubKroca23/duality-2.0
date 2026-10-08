# Chaos 2.0

Yin-yang territory pong + backend pro dlouhodobé sim-běhy.

**Produkce:** https://chaos.propoj.app

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

- **Web** — Vite + PixiJS v8
- **API** — Hono + WebSocket (`apps/api`)
- **Sim engine** — headless `@duality/sim` (`packages/sim`)
- **DB** — Postgres 16 přes Docker Compose na `localhost:5433`

## Deploy (chaos.propoj.app)

Docker Compose + Traefik na síti `personal` (Let's Encrypt).

```bash
cp .env.example .env   # nastav silné POSTGRES_PASSWORD
npm run docker:up:prod
# ekvivalent:
# docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Předpoklady na serveru:
1. Docker síť `personal` existuje (Traefik stack)
2. DNS A/AAAA `chaos.propoj.app` → IP serveru
3. Traefik má entrypoint `websecure` a certresolver `letsencrypt`

Lokální náhled celého stacku (bez Traefik): `http://127.0.0.1:8080` (`CHAOS_PORT`).

```bash
npm run docker:up
npm run docker:down
npm run docker:logs
```

## API

- `GET /api/health`
- `GET/POST /api/presets`, `GET/POST /api/themes`
- `GET/POST /api/runs`, `POST /api/runs/:id/stop|start`, `GET /api/runs/:id/samples`
- `WS /ws` — `{ type: "subscribe", runId }` → sample/status eventy

Na produkci jsou `/api` a `/ws` proxované přes nginx ve web kontejneru (stejný origin).

## Poznámka

Běhy na serveru jedou, dokud je nestopneš (nebo dokud nerestartuješ API). Po restartu API se `running` běhy znovu spustí (nový grid, pokračující `sim_time`).
