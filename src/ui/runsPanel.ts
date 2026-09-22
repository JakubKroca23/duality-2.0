import {
  apiHealth,
  connectRunSocket,
  createRun,
  deleteRun,
  fetchSamples,
  listRuns,
  savePreset,
  startRun,
  stopRun,
  type RunRow,
  type SampleRow,
} from '../api/client';
import type { SimState } from '../sim/state';

let selectedRunId: string | null = null;
let unsubSocket: (() => void) | null = null;
let chartPoints: Array<{ t: number; dayPct: number }> = [];

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function drawChart(canvas: HTMLCanvasElement, points: Array<{ t: number; dayPct: number }>): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(148,163,184,0.25)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (points.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText('Žádná data', 8, h / 2);
    return;
  }

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = Math.max(1e-6, t1 - t0);

  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = ((p.t - t0) / span) * (w - 4) + 2;
    const y = h - 2 - (p.dayPct / 100) * (h - 4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

async function loadChart(runId: string): Promise<void> {
  const samples = await fetchSamples(runId);
  chartPoints = samples.map((s: SampleRow) => ({ t: Number(s.t_sim), dayPct: Number(s.day_pct) }));
  drawChart(el<HTMLCanvasElement>('runsChart'), chartPoints);
  const last = chartPoints[chartPoints.length - 1];
  el('lblRunChartMeta').textContent = last
    ? `${last.dayPct.toFixed(1)}% @ ${last.t.toFixed(0)}s`
    : '—';
}

function appendChartPoint(t: number, dayPct: number): void {
  chartPoints.push({ t, dayPct });
  if (chartPoints.length > 3000) chartPoints = chartPoints.slice(-2500);
  drawChart(el<HTMLCanvasElement>('runsChart'), chartPoints);
  el('lblRunChartMeta').textContent = `${dayPct.toFixed(1)}% @ ${t.toFixed(0)}s`;
}

function selectRun(runId: string): void {
  selectedRunId = runId;
  unsubSocket?.();
  unsubSocket = connectRunSocket(runId, (ev) => {
    if (ev.type === 'sample' && 'runId' in ev && ev.runId === runId && 'sample' in ev) {
      appendChartPoint(ev.sample.t, ev.sample.dayPct);
    }
  });
  void loadChart(runId).catch(() => {
    chartPoints = [];
    drawChart(el<HTMLCanvasElement>('runsChart'), chartPoints);
  });
}

function renderRunsList(runs: RunRow[]): void {
  const list = el('runsList');
  list.innerHTML = '';
  if (!runs.length) {
    list.innerHTML = `<div class="settings-hint-block">Žádné běhy. Spusť nový z aktuální fyziky.</div>`;
    return;
  }

  for (const run of runs) {
    const row = document.createElement('div');
    row.className = `runs-item${selectedRunId === run.id ? ' active' : ''}`;
    const pct =
      run.liveSample != null
        ? `${run.liveSample.dayPct.toFixed(1)}% / ${run.liveSample.nightPct.toFixed(1)}%`
        : `${Number(run.sim_time_s).toFixed(0)}s`;
    row.innerHTML = `
      <button type="button" class="runs-item-main" data-select="${run.id}">
        <span class="runs-item-name">${escapeHtml(run.name)}</span>
        <span class="runs-item-meta">${run.status}${run.live ? ' · live' : ''} · ${pct}</span>
      </button>
      <div class="runs-item-actions">
        ${
          run.status === 'running'
            ? `<button type="button" data-stop="${run.id}" class="settings-modal-reset">Stop</button>`
            : `<button type="button" data-start="${run.id}" class="settings-modal-reset">Start</button>`
        }
        <button type="button" data-del="${run.id}" class="settings-modal-reset">Smazat</button>
      </div>
    `;
    list.appendChild(row);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export async function refreshRunsPanel(): Promise<void> {
  try {
    const health = await apiHealth();
    el('lblApiStatus').textContent = `OK · ${health.liveRuns} live`;
    el('lblApiStatus').style.color = '#34d399';
  } catch {
    el('lblApiStatus').textContent = 'offline';
    el('lblApiStatus').style.color = '#f87171';
    el('runsList').innerHTML =
      `<div class="settings-hint-block">API neběží. Spusť <code>npm run dev:db</code> a <code>npm run dev:api</code>.</div>`;
    return;
  }

  const runs = await listRuns();
  renderRunsList(runs);
  if (selectedRunId && !runs.some((r) => r.id === selectedRunId)) {
    selectedRunId = null;
    unsubSocket?.();
    unsubSocket = null;
  }
  if (!selectedRunId && runs[0]) selectRun(runs[0].id);
}

export function bindRunsPanel(state: SimState): void {
  el('btnRefreshRuns').addEventListener('click', () => {
    void refreshRunsPanel();
  });

  el('btnStartRun').addEventListener('click', () => {
    void (async () => {
      const name = el<HTMLInputElement>('inputRunName').value.trim() || `Run ${new Date().toLocaleTimeString()}`;
      const speedScale = Number(el<HTMLInputElement>('inputRunSpeedScale').value) || 5;
      const created = await createRun({
        name,
        physics: {
          speedMps: state.physicsOptions.speedMps,
          ballsPerSide: state.physicsOptions.ballsPerSide,
          gridSize: state.physicsOptions.gridSize,
          ballScale: state.gfxOptions.ballScale,
        },
        sampleIntervalS: 1,
        speedScale,
      });
      selectedRunId = created.id;
      await refreshRunsPanel();
      selectRun(created.id);
    })().catch((err) => {
      console.error(err);
      el('lblApiStatus').textContent = 'chyba start';
      el('lblApiStatus').style.color = '#f87171';
    });
  });

  el('btnSavePreset').addEventListener('click', () => {
    void (async () => {
      const name = prompt('Název presetu', 'Preset') || 'Preset';
      await savePreset({
        name,
        physics: state.physicsOptions,
        gfx: state.gfxOptions,
      });
      el('lblApiStatus').textContent = 'preset uložen';
    })().catch(console.error);
  });

  el('runsList').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const select = t.closest<HTMLElement>('[data-select]')?.dataset.select;
    const stop = t.closest<HTMLElement>('[data-stop]')?.dataset.stop;
    const start = t.closest<HTMLElement>('[data-start]')?.dataset.start;
    const del = t.closest<HTMLElement>('[data-del]')?.dataset.del;

    if (select) selectRun(select);
    if (stop) {
      void stopRun(stop).then(refreshRunsPanel).catch(console.error);
    }
    if (start) {
      void startRun(start).then(refreshRunsPanel).catch(console.error);
    }
    if (del) {
      void deleteRun(del).then(refreshRunsPanel).catch(console.error);
    }
  });

  // Refresh when opening runs tab
  document.querySelectorAll<HTMLButtonElement>('[data-settings-tab="runs"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void refreshRunsPanel();
    });
  });

  void refreshRunsPanel();
}
