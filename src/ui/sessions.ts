import { createRun, deleteRun } from '../api/client';
import { invalidatePageBleed } from '../sim/ambient';
import { resizeCanvas, resetSimulation } from '../sim/physics';
import { createInitialState, type SimState } from '../sim/state';
import { loadSettings } from '../sim/persistence';
import { destroyPixi } from '../sim/pixi/sessionPixi';

export type RunSession = {
  id: string;
  name: string;
  root: HTMLElement;
  state: SimState;
  minimized: boolean;
  apiRunId: string | null;
  card: HTMLElement | null;
};

type SessionHooks = {
  closeSettings: () => void;
  syncActive: (state: SimState, root: HTMLElement) => void;
};

const ROLE_IDS: Record<string, string> = {
  'btn-play-pause': 'btnPlayPause',
  'icon-pause': 'iconPause',
  'icon-play': 'iconPlay',
  'btn-reset': 'btnReset',
  'btn-sound': 'btnSound',
  'icon-sound-on': 'iconSoundOn',
  'icon-sound-off': 'iconSoundOff',
  'btn-close-arena': 'btnCloseArena',
  'btn-settings': 'btnToggleSettings',
  'label-left': 'labelLeft',
  'dot-left': 'dotLeft',
  'score-day': 'scoreDay',
  'pct-day': 'pctDay',
  'label-right': 'labelRight',
  'pct-night': 'pctNight',
  'score-night': 'scoreNight',
  'dot-right': 'dotRight',
  'bar-day': 'barDay',
  'bar-night': 'barNight',
  'stat-run-time': 'statRunTime',
  'stat-lead-day': 'statLeadDay',
  'stat-lead-night': 'statLeadNight',
  'arena-frame': 'arenaFrame',
  'sim-canvas': 'simCanvas',
  'shader-scanlines': 'shaderScanlines',
};

let sessions: RunSession[] = [];
let activeId: string | null = null;
let lobbyVisible = false;
let hooks: SessionHooks | null = null;
let bootstrapped = false;

function uid(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function roleEl<T extends HTMLElement>(root: ParentNode, role: string): T | null {
  return root.querySelector(`[data-role="${role}"]`) as T | null;
}

function clearIds(root: HTMLElement): void {
  root.querySelectorAll('[id]').forEach((node) => {
    node.removeAttribute('id');
  });
  root.removeAttribute('id');
}

function assignActiveIds(root: HTMLElement): void {
  for (const s of sessions) {
    if (s.root !== root) clearIds(s.root);
  }
  root.id = 'activeStage';
  root.querySelectorAll<HTMLElement>('[data-role]').forEach((node) => {
    const role = node.dataset.role;
    if (!role) return;
    const id = ROLE_IDS[role];
    if (id) node.id = id;
  });
}

export function getSessions(): RunSession[] {
  return sessions;
}

export function isLobbyVisible(): boolean {
  return lobbyVisible;
}

export function getActiveSessionOrNull(): RunSession | null {
  if (lobbyVisible || !activeId) return null;
  return sessions.find((x) => x.id === activeId) ?? null;
}

export function getActiveSession(): RunSession {
  const s = getActiveSessionOrNull() ?? sessions[0];
  if (!s) throw new Error('No session');
  return s;
}

export function getActiveState(): SimState {
  return getActiveSession().state;
}

/** State used for page bleed — active arena, else first background run. */
export function getBleedState(): SimState | null {
  const active = getActiveSessionOrNull();
  if (active) return active.state;
  return sessions[0]?.state ?? null;
}

function simWrapper(): HTMLElement {
  const el = document.getElementById('simWrapper');
  if (!el) throw new Error('Missing #simWrapper');
  return el;
}

function appLobby(): HTMLElement {
  const el = document.getElementById('appLobby');
  if (!el) throw new Error('Missing #appLobby');
  return el;
}

function setLobbyVisible(visible: boolean): void {
  lobbyVisible = visible;
  const lobby = appLobby();
  const wrap = simWrapper();
  lobby.hidden = !visible;
  wrap.hidden = visible;
  wrap.classList.toggle('is-hidden', visible);
  document.body.classList.toggle('lobby-open', visible);
  if (visible) {
    hooks?.closeSettings();
    wrap.classList.remove('settings-open');
    document.body.classList.remove('settings-drawer-open');
    document.body.classList.remove('settings-open');
  }
  invalidatePageBleed();
}

export function showLobby(): void {
  setLobbyVisible(true);
  activeId = null;
}

export function showArena(): void {
  setLobbyVisible(false);
}

export function findSessionByRoot(root: Element | null): RunSession | null {
  if (!root) return null;
  const stage = root.closest('[data-session-stage]');
  if (!stage) return null;
  return sessions.find((s) => s.root === stage) ?? null;
}

function formatRunName(): string {
  return `Běh ${new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`;
}

function playSlot(): HTMLElement {
  const row = document.querySelector('.play-row');
  if (!row) throw new Error('Missing .play-row');
  return row as HTMLElement;
}

function runsDock(): HTMLElement {
  const dock = document.getElementById('runsDock');
  if (!dock) throw new Error('Missing #runsDock');
  return dock;
}

function updateCardMeta(session: RunSession): void {
  if (!session.card) return;
  const nameEl = session.card.querySelector('.run-card-name');
  const timeEl = session.card.querySelector('.run-card-time');
  const pctEl = session.card.querySelector('.run-card-pct');
  if (nameEl) nameEl.textContent = session.name;

  const { state } = session;
  const gridSize = state.physicsOptions.gridSize;
  if (!state.grid?.length || gridSize <= 0) return;
  let dayCount = 0;
  for (let r = 0; r < gridSize; r++) {
    const row = state.grid[r];
    if (!row) continue;
    for (let c = 0; c < gridSize; c++) {
      if (row[c] === 0) dayCount++;
    }
  }
  const total = Math.max(1, gridSize * gridSize);
  const dayPct = (dayCount / total) * 100;
  const nightPct = 100 - dayPct;

  const totalSec = Math.max(0, Math.floor(state.runTimeSec));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (timeEl) timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
  if (pctEl) pctEl.textContent = `${dayPct.toFixed(0)}% / ${nightPct.toFixed(0)}%`;
}

function buildCardShell(session: RunSession): HTMLElement {
  const card = document.createElement('article');
  card.className = 'run-card';
  card.dataset.sessionId = session.id;
  card.innerHTML = `
    <header class="run-card-bar">
      <div class="run-card-meta">
        <span class="run-card-name">${session.name}</span>
        <span class="run-card-stats mono">
          <span class="run-card-time">0:00</span>
          <span class="run-card-pct">50% / 50%</span>
        </span>
      </div>
      <div class="run-card-actions">
        <button type="button" class="run-card-btn" data-action="expand-run" title="Obnovit" aria-label="Obnovit">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
        </button>
        <button type="button" class="run-card-btn" data-action="close-run" title="Zavřít" aria-label="Zavřít">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </header>
    <div class="run-card-body"></div>
  `;
  return card;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function placeCardInDock(card: HTMLElement): void {
  const dock = runsDock();
  const newBtn = document.getElementById('btnNewArena');
  if (newBtn && newBtn.parentElement === dock) {
    dock.insertBefore(card, newBtn);
  } else {
    dock.appendChild(card);
  }
}

async function flipToDock(
  stage: HTMLElement,
  card: HTMLElement,
  firstRect?: DOMRect,
): Promise<void> {
  const first = firstRect ?? stage.getBoundingClientRect();
  const body = card.querySelector('.run-card-body');
  if (!body) return;
  body.appendChild(stage);
  placeCardInDock(card);

  if (prefersReducedMotion()) return;

  const last = card.getBoundingClientRect();
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = first.width / Math.max(1, last.width);
  const sy = first.height / Math.max(1, last.height);

  card.style.transformOrigin = 'top left';
  card.style.transition = 'none';
  card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  card.style.zIndex = '40';

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.style.transition =
          'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.55s ease';
        card.style.transform = 'translate(0, 0) scale(1, 1)';
        window.setTimeout(() => {
          card.style.transition = '';
          card.style.transform = '';
          card.style.zIndex = '';
          resolve();
        }, 580);
      });
    });
  });
}

/** Animate stage from a small source rect (card / + tile) into full arena. */
async function flipExpand(stage: HTMLElement, first: DOMRect): Promise<void> {
  if (prefersReducedMotion()) return;

  const last = stage.getBoundingClientRect();
  if (last.width < 2 || last.height < 2) return;

  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = first.width / Math.max(1, last.width);
  const sy = first.height / Math.max(1, last.height);

  stage.style.transformOrigin = 'top left';
  stage.style.transition = 'none';
  stage.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  stage.style.zIndex = '50';
  stage.style.willChange = 'transform';

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        stage.style.transition = 'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)';
        stage.style.transform = 'translate(0, 0) scale(1, 1)';
        window.setTimeout(() => {
          stage.style.transition = '';
          stage.style.transform = '';
          stage.style.zIndex = '';
          stage.style.willChange = '';
          resolve();
        }, 580);
      });
    });
  });
}

function mountNewActiveFromTemplate(seed?: SimState): RunSession {
  const tpl = document.getElementById('tplArenaStage');
  if (!(tpl instanceof HTMLTemplateElement)) throw new Error('Missing #tplArenaStage');
  const stage = tpl.content.firstElementChild?.cloneNode(true) as HTMLElement;
  if (!stage) throw new Error('Empty arena template');

  const canvas = roleEl<HTMLCanvasElement>(stage, 'sim-canvas');
  if (!canvas) throw new Error('Template missing canvas');

  const settings = playSlot().querySelector('#drawerSettingsContent');
  playSlot().insertBefore(stage, settings);

  const state = createInitialState(canvas);
  if (seed) {
    state.physicsOptions = {
      speedMps: seed.physicsOptions.speedMps,
      ballsPerSide: seed.physicsOptions.ballsPerSide,
      gridSize: seed.physicsOptions.gridSize,
    };
    state.gfxOptions = JSON.parse(JSON.stringify(seed.gfxOptions)) as SimState['gfxOptions'];
    state.themes = JSON.parse(JSON.stringify(seed.themes)) as SimState['themes'];
    state.currentSchemeIndex = seed.currentSchemeIndex;
    state.customColors = seed.customColors;
    state.customDay = seed.customDay;
    state.customNight = seed.customNight;
    state.soundEnabled = seed.soundEnabled;
  } else {
    loadSettings(state);
  }

  const session: RunSession = {
    id: uid(),
    name: formatRunName(),
    root: stage,
    state,
    minimized: false,
    apiRunId: null,
    card: null,
  };
  sessions.push(session);
  activeId = session.id;
  assignActiveIds(stage);

  resizeCanvas(state);
  resetSimulation(state, () => {
    hooks?.syncActive(state, stage);
  });
  invalidatePageBleed();
  return session;
}

export function bootstrapSessions(initialState: SimState, sessionHooks: SessionHooks): void {
  if (bootstrapped) return;
  bootstrapped = true;
  hooks = sessionHooks;

  const stage = document.getElementById('activeStage');
  const canvas = document.getElementById('simCanvas');
  if (!(stage instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Missing initial arena stage');
  }

  const session: RunSession = {
    id: uid(),
    name: formatRunName(),
    root: stage,
    state: initialState,
    minimized: false,
    apiRunId: null,
    card: null,
  };
  sessions = [session];
  activeId = session.id;
  assignActiveIds(stage);

  // App opens on lobby; park the boot arena as a background run card.
  const card = buildCardShell(session);
  session.card = card;
  session.minimized = true;
  clearIds(session.root);
  updateCardMeta(session);
  const body = card.querySelector('.run-card-body');
  body?.appendChild(session.root);
  placeCardInDock(card);
  activeId = null;
  setLobbyVisible(true);
}

/** Park the active arena into the lobby dock (keeps simulating) and show lobby. */
export async function closeActiveToLobby(): Promise<void> {
  const active = getActiveSessionOrNull();
  if (!active || active.minimized) {
    showLobby();
    return;
  }

  hooks?.closeSettings();

  const name = formatRunName();
  active.name = name;

  const card = buildCardShell(active);
  active.card = card;
  active.minimized = true;
  clearIds(active.root);
  updateCardMeta(active);
  activeId = null;

  const first = active.root.getBoundingClientRect();

  void createRun({
    name,
    physics: {
      speedMps: active.state.physicsOptions.speedMps,
      ballsPerSide: active.state.physicsOptions.ballsPerSide,
      gridSize: active.state.physicsOptions.gridSize,
      ballScale: active.state.gfxOptions.ballScale,
    },
    sampleIntervalS: 1,
    speedScale: 5,
  })
    .then((created) => {
      active.apiRunId = created.id;
    })
    .catch(() => {
      active.apiRunId = null;
    });

  setLobbyVisible(true);
  await flipToDock(active.root, card, first);

  window.setTimeout(() => {
    for (const s of sessions) {
      if (s.minimized) resizeCanvas(s.state);
    }
    invalidatePageBleed();
  }, 50);
}

/** Start a fresh arena from lobby. */
export async function openNewArena(): Promise<void> {
  hooks?.closeSettings();
  const source = document.getElementById('btnNewArena')?.getBoundingClientRect();
  showArena();
  const session = mountNewActiveFromTemplate();
  resizeCanvas(session.state);
  hooks?.syncActive(session.state, session.root);
  invalidatePageBleed();
  if (source) await flipExpand(session.root, source);
  resizeCanvas(session.state);
  invalidatePageBleed();
}

export async function expandSession(id: string): Promise<void> {
  const target = sessions.find((s) => s.id === id);
  if (!target || !target.minimized || !target.card) return;

  hooks?.closeSettings();

  const first = target.card.getBoundingClientRect();

  const current = getActiveSessionOrNull();
  if (current && current.id !== target.id && !current.minimized) {
    current.name = formatRunName();
    const card = buildCardShell(current);
    current.card = card;
    current.minimized = true;
    clearIds(current.root);
    updateCardMeta(current);
    const body = card.querySelector('.run-card-body');
    body?.appendChild(current.root);
    placeCardInDock(card);
  }

  const settings = playSlot().querySelector('#drawerSettingsContent');
  playSlot().insertBefore(target.root, settings);
  target.card.remove();
  target.card = null;
  target.minimized = false;
  activeId = target.id;
  assignActiveIds(target.root);

  showArena();
  resizeCanvas(target.state);
  hooks?.syncActive(target.state, target.root);
  invalidatePageBleed();

  await flipExpand(target.root, first);
  resizeCanvas(target.state);
  invalidatePageBleed();
}

export async function closeSession(id: string): Promise<void> {
  const target = sessions.find((s) => s.id === id);
  if (!target) return;

  if (!target.minimized) {
    if (sessions.length === 1) {
      await closeActiveToLobby();
      return;
    }
    const other = sessions.find((s) => s.id !== id && s.minimized);
    if (other) {
      await expandSession(other.id);
    } else {
      await closeActiveToLobby();
      return;
    }
  }

  if (target.apiRunId) {
    try {
      await deleteRun(target.apiRunId);
    } catch {
      /* ignore offline */
    }
  }

  target.state.isRunning = false;
  destroyPixi(target.id);
  target.card?.remove();
  if (!target.minimized) target.root.remove();
  sessions = sessions.filter((s) => s.id !== id);

  if (activeId === id) {
    activeId = null;
    const next = sessions.find((s) => !s.minimized);
    if (next) {
      activeId = next.id;
      assignActiveIds(next.root);
      hooks?.syncActive(next.state, next.root);
      showArena();
    } else {
      showLobby();
    }
  }
  invalidatePageBleed();
}

export function tickSessionMeta(): void {
  for (const s of sessions) {
    if (s.minimized) updateCardMeta(s);
  }
}

export function resizeAllSessions(): void {
  for (const s of sessions) resizeCanvas(s.state);
}
