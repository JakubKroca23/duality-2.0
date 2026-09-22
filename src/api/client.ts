export type RunRow = {
  id: string;
  name: string;
  status: 'running' | 'stopped';
  config: unknown;
  sim_time_s: number;
  started_at: string;
  stopped_at: string | null;
  live?: boolean;
  liveSample?: {
    t: number;
    dayPct: number;
    nightPct: number;
  } | null;
};

export type SampleRow = {
  t_sim: number;
  day_pct: number;
  night_pct: number;
  day_count: number;
  night_count: number;
};

const API_BASE = '';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function apiHealth(): Promise<{ ok: boolean; liveRuns: number }> {
  return json('/api/health');
}

export function listRuns(): Promise<RunRow[]> {
  return json('/api/runs');
}

export function createRun(body: {
  name?: string;
  physics?: {
    speedMps?: number;
    ballsPerSide?: number;
    gridSize?: number;
    ballScale?: number;
  };
  sampleIntervalS?: number;
  speedScale?: number;
}): Promise<{ id: string; name: string; status: string }> {
  return json('/api/runs', { method: 'POST', body: JSON.stringify(body) });
}

export function stopRun(id: string): Promise<{ ok: boolean }> {
  return json(`/api/runs/${id}/stop`, { method: 'POST' });
}

export function startRun(id: string): Promise<{ ok: boolean }> {
  return json(`/api/runs/${id}/start`, { method: 'POST' });
}

export function deleteRun(id: string): Promise<{ ok: boolean }> {
  return json(`/api/runs/${id}`, { method: 'DELETE' });
}

export function fetchSamples(id: string, from = 0): Promise<SampleRow[]> {
  return json(`/api/runs/${id}/samples?from=${from}&limit=3000`);
}

export function savePreset(body: {
  name: string;
  physics: unknown;
  gfx: unknown;
}): Promise<unknown> {
  return json('/api/presets', { method: 'POST', body: JSON.stringify(body) });
}

export function listPresets(): Promise<
  Array<{ id: string; name: string; physics: unknown; gfx: unknown; created_at: string }>
> {
  return json('/api/presets');
}

export type WsSampleEvent = {
  type: 'sample';
  runId: string;
  sample: { t: number; dayPct: number; nightPct: number };
  grid?: number[];
  gridSize?: number;
};

export type WsStatusEvent = {
  type: 'status';
  runId: string;
  status: 'running' | 'stopped';
  simTime: number;
};

export function connectRunSocket(
  runId: string,
  onEvent: (ev: WsSampleEvent | WsStatusEvent | { type: string }) => void,
): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'subscribe', runId }));
  });
  ws.addEventListener('message', (msg) => {
    try {
      onEvent(JSON.parse(String(msg.data)));
    } catch {
      /* ignore */
    }
  });
  return () => {
    ws.close();
  };
}
