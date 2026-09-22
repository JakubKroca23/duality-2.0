import {
  createHeadlessState,
  downsampleGrid,
  measureTerritory,
  tickHeadless,
  type HeadlessState,
  type PhysicsConfig,
  type TerritorySample,
} from '@duality/sim';
import { pool } from './db.js';

export type RunConfig = {
  physics: Partial<PhysicsConfig>;
  sampleIntervalS?: number;
  /** Real-time speed multiplier (1 = realtime). */
  speedScale?: number;
};

type Subscriber = (event: WsEvent) => void;

export type WsEvent =
  | { type: 'sample'; runId: string; sample: TerritorySample; grid?: number[]; gridSize?: number }
  | { type: 'status'; runId: string; status: 'running' | 'stopped'; simTime: number };

type Runner = {
  id: string;
  name: string;
  state: HeadlessState;
  config: RunConfig;
  timer: NodeJS.Timeout | null;
  lastSampleAt: number;
  sampleIntervalS: number;
  speedScale: number;
};

const runners = new Map<string, Runner>();
const subscribers = new Map<string, Set<Subscriber>>();

function emit(runId: string, event: WsEvent): void {
  const set = subscribers.get(runId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      /* ignore bad subscriber */
    }
  }
}

export function subscribeRun(runId: string, fn: Subscriber): () => void {
  let set = subscribers.get(runId);
  if (!set) {
    set = new Set();
    subscribers.set(runId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) subscribers.delete(runId);
  };
}

async function persistSample(runId: string, sample: TerritorySample): Promise<void> {
  await pool.query(
    `INSERT INTO territory_samples (run_id, t_sim, day_pct, night_pct, day_count, night_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [runId, sample.t, sample.dayPct, sample.nightPct, sample.dayCount, sample.nightCount],
  );
  await pool.query(
    `UPDATE simulation_runs SET sim_time_s = $2, updated_at = NOW() WHERE id = $1`,
    [runId, sample.t],
  );
}

function pushSample(runner: Runner, includeGrid: boolean): void {
  const sample = measureTerritory(runner.state);
  const gridSize = Math.min(32, runner.state.physics.gridSize);
  const event: WsEvent = {
    type: 'sample',
    runId: runner.id,
    sample,
    ...(includeGrid
      ? { grid: downsampleGrid(runner.state, gridSize), gridSize }
      : {}),
  };
  emit(runner.id, event);
  void persistSample(runner.id, sample).catch((err) => {
    console.error('[sim] sample persist failed', err);
  });
}

function startLoop(runner: Runner): void {
  if (runner.timer) return;
  const tickDt = 1 / 30; // 30 Hz wall clock
  runner.timer = setInterval(() => {
    const simDt = tickDt * runner.speedScale;
    tickHeadless(runner.state, simDt);
    if (runner.state.simTime - runner.lastSampleAt >= runner.sampleIntervalS) {
      runner.lastSampleAt = runner.state.simTime;
      pushSample(runner, true);
    }
  }, tickDt * 1000);
}

function stopLoop(runner: Runner): void {
  if (runner.timer) {
    clearInterval(runner.timer);
    runner.timer = null;
  }
}

export async function createAndStartRun(
  name: string,
  config: RunConfig,
): Promise<{ id: string; name: string; status: string }> {
  const physics = config.physics ?? {};
  const sampleIntervalS = Math.max(0.25, config.sampleIntervalS ?? 1);
  const speedScale = Math.max(0.1, Math.min(50, config.speedScale ?? 1));

  const state = createHeadlessState(physics);
  const confPayload = { physics: state.physics, sampleIntervalS, speedScale };

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO simulation_runs (name, status, config)
     VALUES ($1, 'running', $2)
     RETURNING id`,
    [name || 'Run', JSON.stringify(confPayload)],
  );
  const id = rows[0].id;

  const runner: Runner = {
    id,
    name: name || 'Run',
    state,
    config: confPayload,
    timer: null,
    lastSampleAt: -Infinity,
    sampleIntervalS,
    speedScale,
  };
  runners.set(id, runner);
  startLoop(runner);
  pushSample(runner, true);
  emit(id, { type: 'status', runId: id, status: 'running', simTime: state.simTime });
  return { id, name: runner.name, status: 'running' };
}

export async function stopRun(id: string): Promise<boolean> {
  const runner = runners.get(id);
  if (runner) {
    stopLoop(runner);
    pushSample(runner, true);
    runners.delete(id);
  }
  const res = await pool.query(
    `UPDATE simulation_runs
     SET status = 'stopped', stopped_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'running'
     RETURNING id, sim_time_s`,
    [id],
  );
  if (res.rowCount && res.rowCount > 0) {
    emit(id, {
      type: 'status',
      runId: id,
      status: 'stopped',
      simTime: Number(res.rows[0].sim_time_s) || 0,
    });
    return true;
  }
  return Boolean(runner);
}

export async function resumeRun(id: string): Promise<boolean> {
  if (runners.has(id)) return true;
  const { rows } = await pool.query<{
    id: string;
    name: string;
    config: RunConfig;
    sim_time_s: number;
    status: string;
  }>(`SELECT id, name, config, sim_time_s, status FROM simulation_runs WHERE id = $1`, [id]);
  if (!rows[0]) return false;

  const row = rows[0];
  const conf = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
  const state = createHeadlessState(conf.physics ?? {});
  // Fresh grid on resume (we don't persist full grid yet) — keep sim_time continuity for samples.
  state.simTime = Number(row.sim_time_s) || 0;

  const runner: Runner = {
    id: row.id,
    name: row.name,
    state,
    config: conf,
    timer: null,
    lastSampleAt: state.simTime,
    sampleIntervalS: Math.max(0.25, conf.sampleIntervalS ?? 1),
    speedScale: Math.max(0.1, Math.min(50, conf.speedScale ?? 1)),
  };

  await pool.query(
    `UPDATE simulation_runs SET status = 'running', stopped_at = NULL, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  runners.set(id, runner);
  startLoop(runner);
  emit(id, { type: 'status', runId: id, status: 'running', simTime: state.simTime });
  return true;
}

export async function resumeAllRunning(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM simulation_runs WHERE status = 'running'`,
  );
  for (const row of rows) {
    await resumeRun(row.id);
  }
  if (rows.length) console.log(`[sim] resumed ${rows.length} run(s)`);
}

export function listLiveRunIds(): string[] {
  return [...runners.keys()];
}

export function getLiveSnapshot(id: string): TerritorySample | null {
  const runner = runners.get(id);
  if (!runner) return null;
  return measureTerritory(runner.state);
}
