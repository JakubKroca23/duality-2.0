import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://chaos:chaos@localhost:5433/chaos';

export const pool = new Pool({ connectionString: DATABASE_URL });

export async function initDb(): Promise<void> {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  } catch {
    /* ignore */
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS themes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS presets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      physics JSONB NOT NULL,
      gfx JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS simulation_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'stopped')),
      config JSONB NOT NULL,
      seed TEXT,
      sim_time_s DOUBLE PRECISION NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      stopped_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS territory_samples (
      id BIGSERIAL PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
      t_sim DOUBLE PRECISION NOT NULL,
      day_pct DOUBLE PRECISION NOT NULL,
      night_pct DOUBLE PRECISION NOT NULL,
      day_count INTEGER NOT NULL,
      night_count INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS territory_samples_run_t_idx
      ON territory_samples (run_id, t_sim);
  `);
}
