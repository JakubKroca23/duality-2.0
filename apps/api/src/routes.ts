import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pool } from './db.js';
import {
  createAndStartRun,
  getLiveSnapshot,
  listLiveRunIds,
  resumeRun,
  stopRun,
  type RunConfig,
} from './simManager.js';

export const app = new Hono();

app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }),
);

app.get('/api/health', (c) => c.json({ ok: true, liveRuns: listLiveRunIds().length }));

// --- presets ---
app.get('/api/presets', async (c) => {
  const { rows } = await pool.query(
    `SELECT id, name, physics, gfx, created_at FROM presets ORDER BY created_at DESC`,
  );
  return c.json(rows);
});

app.post('/api/presets', async (c) => {
  const body = await c.req.json<{ name?: string; physics?: unknown; gfx?: unknown }>();
  const { rows } = await pool.query(
    `INSERT INTO presets (name, physics, gfx) VALUES ($1, $2, $3)
     RETURNING id, name, physics, gfx, created_at`,
    [body.name || 'Preset', JSON.stringify(body.physics ?? {}), JSON.stringify(body.gfx ?? {})],
  );
  return c.json(rows[0], 201);
});

app.delete('/api/presets/:id', async (c) => {
  await pool.query(`DELETE FROM presets WHERE id = $1`, [c.req.param('id')]);
  return c.json({ ok: true });
});

// --- themes ---
app.get('/api/themes', async (c) => {
  const { rows } = await pool.query(
    `SELECT id, name, payload, created_at FROM themes ORDER BY created_at DESC`,
  );
  return c.json(rows);
});

app.post('/api/themes', async (c) => {
  const body = await c.req.json<{ name?: string; payload?: unknown }>();
  const { rows } = await pool.query(
    `INSERT INTO themes (name, payload) VALUES ($1, $2)
     RETURNING id, name, payload, created_at`,
    [body.name || 'Theme', JSON.stringify(body.payload ?? {})],
  );
  return c.json(rows[0], 201);
});

app.delete('/api/themes/:id', async (c) => {
  await pool.query(`DELETE FROM themes WHERE id = $1`, [c.req.param('id')]);
  return c.json({ ok: true });
});

// --- runs ---
app.get('/api/runs', async (c) => {
  const { rows } = await pool.query(
    `SELECT id, name, status, config, sim_time_s, started_at, stopped_at, updated_at
     FROM simulation_runs
     ORDER BY started_at DESC
     LIMIT 100`,
  );
  const live = new Set(listLiveRunIds());
  return c.json(
    rows.map((r) => ({
      ...r,
      live: live.has(r.id),
      liveSample: live.has(r.id) ? getLiveSnapshot(r.id) : null,
    })),
  );
});

app.post('/api/runs', async (c) => {
  const body = await c.req.json<{
    name?: string;
    physics?: RunConfig['physics'];
    sampleIntervalS?: number;
    speedScale?: number;
  }>();
  const run = await createAndStartRun(body.name || 'Run', {
    physics: body.physics ?? {},
    sampleIntervalS: body.sampleIntervalS,
    speedScale: body.speedScale,
  });
  return c.json(run, 201);
});

app.post('/api/runs/:id/stop', async (c) => {
  const ok = await stopRun(c.req.param('id'));
  return c.json({ ok });
});

app.post('/api/runs/:id/start', async (c) => {
  const ok = await resumeRun(c.req.param('id'));
  return c.json({ ok });
});

app.get('/api/runs/:id/samples', async (c) => {
  const id = c.req.param('id');
  const from = Number(c.req.query('from') ?? 0);
  const limit = Math.min(5000, Math.max(1, Number(c.req.query('limit') ?? 2000)));
  const { rows } = await pool.query(
    `SELECT t_sim, day_pct, night_pct, day_count, night_count, created_at
     FROM territory_samples
     WHERE run_id = $1 AND t_sim >= $2
     ORDER BY t_sim ASC
     LIMIT $3`,
    [id, from, limit],
  );
  return c.json(rows);
});

app.delete('/api/runs/:id', async (c) => {
  await stopRun(c.req.param('id'));
  await pool.query(`DELETE FROM simulation_runs WHERE id = $1`, [c.req.param('id')]);
  return c.json({ ok: true });
});
