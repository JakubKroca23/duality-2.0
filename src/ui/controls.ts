import {
  GRID_SIZE_MAX,
  GRID_SIZE_MIN,
  SCHEME_INDEX_DEFAULT,
  SPEED_MAX,
  SPEED_MIN,
  TYPE_DAY,
  TYPE_NIGHT,
  defaultGfxOptions,
  defaultPhysicsOptions,
} from '../config/constants';
import {
  applySchemeLookToGfx,
  cloneSchemeLook,
  cloneSchemeThemes,
  listAllSchemes,
  resolveScheme,
  schemeLookFromGfx,
  tileFromBall,
  type CyberScheme,
} from '../config/themes';
import { initAudio } from '../sim/audio';
import { loadSettings, saveSettings } from '../sim/persistence';
import { applyBallRadii, resetSimulation, resizeCanvas } from '../sim/physics';
import { markGridDirty, updateScoreboard } from '../sim/render';
import { invalidatePageBleed } from '../sim/ambient';
import { destroyAllPixi } from '../sim/pixi/sessionPixi';
import { getRendererMode, setRendererMode } from '../sim/rendererMode';
import {
  addUserScheme,
  getUserSchemes,
  isUserSchemeIndex,
  loadUserSchemes,
  removeUserScheme,
  slugifyThemeName,
} from '../sim/userThemes';
import {
  closeActiveToLobby,
  closeSession,
  expandSession,
  findSessionByRoot,
  getActiveSession,
  getActiveSessionOrNull,
  getActiveState,
  getSessions,
  openNewArena,
  resizeAllSessions,
} from './sessions';
import type { SimState } from '../sim/state';

let settingsCloser: (() => void) | null = null;

/** Close settings from outside (e.g. minimize run). */
export function closeSettingsPanel(): void {
  settingsCloser?.();
}

function formatSpeed(mps: number): string {
  if (mps < 10) return `${mps.toFixed(1)} m/s`;
  if (mps < 100) return `${mps.toFixed(1)} m/s`;
  return `${Math.round(mps)} m/s`;
}

/** Slider positions 0…SPEED_SLIDER_MAX; more track below 10 m/s for finer control. */
const SPEED_SLIDER_MAX = 1000;
const SPEED_BREAK_MPS = 10;
/** Fraction of the track reserved for SPEED_MIN…SPEED_BREAK_MPS. */
const SPEED_BREAK_T = 0.6;

function speedToSlider(mps: number): number {
  const s = Math.max(SPEED_MIN, Math.min(SPEED_MAX, mps));
  if (s <= SPEED_BREAK_MPS) {
    const t = (s - SPEED_MIN) / (SPEED_BREAK_MPS - SPEED_MIN);
    return Math.round(t * SPEED_BREAK_T * SPEED_SLIDER_MAX);
  }
  const t = (s - SPEED_BREAK_MPS) / (SPEED_MAX - SPEED_BREAK_MPS);
  return Math.round((SPEED_BREAK_T + t * (1 - SPEED_BREAK_T)) * SPEED_SLIDER_MAX);
}

function sliderToSpeed(pos: number): number {
  const u = Math.max(0, Math.min(SPEED_SLIDER_MAX, pos)) / SPEED_SLIDER_MAX;
  if (u <= SPEED_BREAK_T) {
    const t = u / SPEED_BREAK_T;
    const mps = SPEED_MIN + t * (SPEED_BREAK_MPS - SPEED_MIN);
    return Math.round(mps * 10) / 10;
  }
  const t = (u - SPEED_BREAK_T) / (1 - SPEED_BREAK_T);
  const mps = SPEED_BREAK_MPS + t * (SPEED_MAX - SPEED_BREAK_MPS);
  if (mps < 100) return Math.round(mps * 2) / 2;
  return Math.round(mps);
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export function syncColorsUI(state: SimState): void {
  const currentScheme = resolveScheme(state.currentSchemeIndex, getUserSchemes());
  const leftCol = state.themes[TYPE_DAY].ballColor;
  const rightCol = state.themes[TYPE_NIGHT].ballColor;

  const themeBtnName = el('themeBtnName');
  themeBtnName.textContent = state.customColors ? 'CUSTOM' : currentScheme.name;

  const themeBtnDotDay = el('themeBtnDotDay');
  themeBtnDotDay.style.backgroundColor = leftCol;
  themeBtnDotDay.style.boxShadow = `0 0 6px ${leftCol}`;

  const themeBtnDotNight = el('themeBtnDotNight');
  themeBtnDotNight.style.backgroundColor = rightCol;
  themeBtnDotNight.style.boxShadow = `0 0 6px ${rightCol}`;

  let root: ParentNode = document;
  try {
    root = getActiveSession().root;
  } catch {
    /* before sessions boot */
  }

  const q = (role: string, id: string): HTMLElement | null =>
    (root.querySelector(`[data-role="${role}"]`) as HTMLElement | null) ??
    document.getElementById(id);

  const labelLeft = q('label-left', 'labelLeft');
  const labelRight = q('label-right', 'labelRight');
  if (labelLeft) labelLeft.style.color = leftCol;
  if (labelRight) labelRight.style.color = rightCol;

  const leadDay = q('stat-lead-day', 'statLeadDay');
  const leadNight = q('stat-lead-night', 'statLeadNight');
  if (leadDay) leadDay.style.color = leftCol;
  if (leadNight) leadNight.style.color = rightCol;

  const dotL = q('dot-left', 'dotLeft');
  if (dotL) {
    dotL.style.backgroundColor = leftCol;
    dotL.style.boxShadow = `0 0 10px ${leftCol}`;
  }

  const dotR = q('dot-right', 'dotRight');
  if (dotR) {
    dotR.style.backgroundColor = rightCol;
    dotR.style.boxShadow = `0 0 10px ${rightCol}`;
  }

  const barDay = q('bar-day', 'barDay');
  if (barDay) {
    barDay.style.backgroundColor = leftCol;
    barDay.style.boxShadow = `0 0 8px ${leftCol}`;
  }

  const barNight = q('bar-night', 'barNight');
  if (barNight) {
    barNight.style.backgroundColor = rightCol;
    barNight.style.boxShadow = `0 0 8px ${rightCol}`;
  }

  const colorDay = document.getElementById('colorDay') as HTMLInputElement | null;
  const colorNight = document.getElementById('colorNight') as HTMLInputElement | null;
  if (colorDay) colorDay.value = state.themes[TYPE_DAY].ballColor;
  if (colorNight) colorNight.value = state.themes[TYPE_NIGHT].ballColor;

  const paintSideDots = (
    ids: [string, string],
    colors: [string, string],
  ): void => {
    const [idA, idB] = ids;
    const a = document.getElementById(idA);
    const b = document.getElementById(idB);
    if (a) {
      a.style.backgroundColor = colors[0];
      (a as HTMLElement).style.boxShadow = `0 0 6px ${colors[0]}`;
    }
    if (b) {
      b.style.backgroundColor = colors[1];
      (b as HTMLElement).style.boxShadow = `0 0 6px ${colors[1]}`;
    }
  };
  paintSideDots(['dotLightA', 'dotLightB'], state.gfxOptions.lightShader.colors);
  paintSideDots(['dotCollisionA', 'dotCollisionB'], state.gfxOptions.collisionShader.colors);
  paintSideDots(['dotReflectionA', 'dotReflectionB'], state.gfxOptions.reflectionShader.colors);
}

export function renderThemeDropdownList(state: SimState): void {
  const container = el('themeListContainer');
  container.innerHTML = '';

  const schemes = listAllSchemes(getUserSchemes());
  schemes.forEach((scheme, index) => {
    const item = document.createElement('div');
    const isActive = !state.customColors && index === state.currentSchemeIndex;
    const isUser = isUserSchemeIndex(index);
    item.className = `theme-item settings-theme-item flex items-center justify-between ${isActive ? 'active' : ''}`;

    item.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <div class="flex items-center -space-x-1 shrink-0">
          <span class="w-2 h-2 rounded-full" style="background-color: ${scheme[TYPE_DAY].ballColor}; box-shadow: 0 0 5px ${scheme[TYPE_DAY].ballColor};"></span>
          <span class="w-2 h-2 rounded-full" style="background-color: ${scheme[TYPE_NIGHT].ballColor}; box-shadow: 0 0 5px ${scheme[TYPE_NIGHT].ballColor};"></span>
        </div>
        <div class="min-w-0">
          <span class="font-bold text-[9px] text-slate-100 mono block tracking-wider leading-tight truncate">${scheme.name}</span>
          <span class="text-[7.5px] text-slate-400 mono opacity-80">${scheme.tag}</span>
        </div>
      </div>
      ${
        isUser
          ? `<button type="button" class="theme-item-delete" data-theme-delete="${scheme.id}" title="Smazat téma" aria-label="Smazat téma">×</button>`
          : ''
      }
    `;

    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-theme-delete]')) return;
      e.stopPropagation();
      selectTheme(state, index);
      closeThemeDropdown();
    });

    const deleteBtn = item.querySelector<HTMLButtonElement>('[data-theme-delete]');
    deleteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteUserTheme(state, scheme.id);
    });

    container.appendChild(item);
  });
}

function closeThemeDropdown(): void {
  el('themeDropdownMenu').classList.add('hidden');
  el('themePickerChevron').classList.remove('rotate-180');
  el('themeSelectorContainer').classList.remove('theme-menu-open');
}

/** Wired from bindControls so theme picks can refresh sliders. */
let refreshSettingsInputs: (() => void) | null = null;

function selectTheme(state: SimState, index: number): void {
  const users = getUserSchemes();
  state.currentSchemeIndex = index;
  state.customColors = false;
  state.themes = cloneSchemeThemes(index, users);
  state.customDay = state.themes[TYPE_DAY].ballColor;
  state.customNight = state.themes[TYPE_NIGHT].ballColor;
  applySchemeLookToGfx(state.gfxOptions, cloneSchemeLook(index, users));
  syncColorsUI(state);
  renderThemeDropdownList(state);
  applyBallRadii(state);
  refreshSettingsInputs?.();
  markGridDirty(state);
  saveSettings(state);
}

function saveCurrentAsTheme(state: SimState): void {
  const input = el<HTMLInputElement>('inputThemeName');
  const name = input.value.trim();
  if (!name) {
    input.focus();
    input.classList.add('theme-save-input-invalid');
    window.setTimeout(() => input.classList.remove('theme-save-input-invalid'), 600);
    return;
  }

  const slug = slugifyThemeName(name);
  const id = `user-${slug}-${Date.now().toString(36)}`;
  const scheme: CyberScheme = {
    id,
    name: name.slice(0, 32).toUpperCase(),
    tag: 'CUSTOM',
    [TYPE_DAY]: { ...state.themes[TYPE_DAY] },
    [TYPE_NIGHT]: { ...state.themes[TYPE_NIGHT] },
    look: schemeLookFromGfx(state.gfxOptions),
  };

  const index = addUserScheme(scheme);
  input.value = '';
  selectTheme(state, index);
  closeThemeDropdown();
}

function deleteUserTheme(state: SimState, id: string): void {
  const before = getUserSchemes();
  const activeId = state.customColors
    ? null
    : resolveScheme(state.currentSchemeIndex, before).id;

  if (!removeUserScheme(id)) return;

  const after = getUserSchemes();
  if (activeId === id) {
    selectTheme(state, SCHEME_INDEX_DEFAULT);
    return;
  }

  if (activeId) {
    const nextIndex = listAllSchemes(after).findIndex((s) => s.id === activeId);
    if (nextIndex >= 0) state.currentSchemeIndex = nextIndex;
  } else if (state.currentSchemeIndex >= listAllSchemes(after).length) {
    state.currentSchemeIndex = SCHEME_INDEX_DEFAULT;
  }

  renderThemeDropdownList(state);
  syncColorsUI(state);
  saveSettings(state);
}

function toggleThemeDropdown(): void {
  const menu = el('themeDropdownMenu');
  const chevron = el('themePickerChevron');
  const container = el('themeSelectorContainer');
  const isHidden = menu.classList.contains('hidden');
  if (isHidden) {
    menu.classList.remove('hidden');
    chevron.classList.add('rotate-180');
    container.classList.add('theme-menu-open');
  } else {
    closeThemeDropdown();
  }
}

export function bindControls(_initial?: SimState): void {
  const state = new Proxy({} as SimState, {
    get(_target, prop) {
      return Reflect.get(getActiveState(), prop);
    },
    set(_target, prop, value) {
      return Reflect.set(getActiveState(), prop, value);
    },
  });

  loadUserSchemes();
  loadSettings(getActiveState());

  const drawerSettingsContent = el('drawerSettingsContent');

  let settingsOpen = false;

  function syncPanelButtons(): void {
    const btn = document.getElementById('btnToggleSettings') as HTMLButtonElement | null;
    if (btn) {
      btn.classList.toggle('nav-btn-active-cyan', settingsOpen);
      btn.setAttribute('aria-expanded', settingsOpen ? 'true' : 'false');
    }
    drawerSettingsContent.classList.toggle('open', settingsOpen);
    drawerSettingsContent.setAttribute('aria-hidden', settingsOpen ? 'false' : 'true');
    document.getElementById('simWrapper')?.classList.toggle('settings-open', settingsOpen);
    document.body.classList.toggle('settings-open', settingsOpen);
    document.body.classList.toggle('settings-drawer-open', settingsOpen);
    invalidatePageBleed();
    const active = getActiveSessionOrNull();
    if (active && !active.minimized) {
      requestAnimationFrame(() => resizeCanvas(active.state));
      window.setTimeout(() => {
        resizeCanvas(active.state);
        invalidatePageBleed();
      }, 700);
    }
  }

  function openSettings(): void {
    const active = getActiveSessionOrNull();
    if (!active || active.minimized) return;
    settingsOpen = true;
    syncPanelButtons();
  }

  function closeSettings(): void {
    settingsOpen = false;
    closeThemeDropdown();
    syncPanelButtons();
  }

  settingsCloser = closeSettings;

  function toggleSettings(): void {
    if (settingsOpen) closeSettings();
    else openSettings();
  }

  function setSettingsTab(tab: string): void {
    const tabs = drawerSettingsContent.querySelectorAll<HTMLButtonElement>('[data-settings-tab]');
    const panels = drawerSettingsContent.querySelectorAll<HTMLElement>('[data-settings-panel]');
    tabs.forEach((btn) => {
      const active = btn.dataset.settingsTab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach((panel) => {
      const active = panel.dataset.settingsPanel === tab;
      panel.classList.toggle('active', active);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    if (tab !== 'look') closeThemeDropdown();
  }

  drawerSettingsContent.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = btn.dataset.settingsTab;
      if (tab) setSettingsTab(tab);
    });
  });

  el('btnCloseSettings').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSettings();
  });

  const workspace = document.getElementById('workspace') ?? document.body;

  function syncPlayIcons(sessionRoot: HTMLElement, running: boolean): void {
    const iconPlay = sessionRoot.querySelector('[data-role="icon-play"]');
    const iconPause = sessionRoot.querySelector('[data-role="icon-pause"]');
    iconPlay?.classList.toggle('hidden', running);
    iconPause?.classList.toggle('hidden', !running);
  }

  function syncSoundIcons(sessionRoot: HTMLElement, on: boolean): void {
    const iconOn = sessionRoot.querySelector('[data-role="icon-sound-on"]');
    const iconOff = sessionRoot.querySelector('[data-role="icon-sound-off"]');
    iconOn?.classList.toggle('hidden', !on);
    iconOff?.classList.toggle('hidden', on);
  }

  workspace.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;

    if (action === 'expand-run' || action === 'close-run') {
      const card = target.closest<HTMLElement>('.run-card');
      const id = card?.dataset.sessionId;
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === 'expand-run') expandSession(id);
      else void closeSession(id);
      return;
    }

    if (action === 'new-arena') {
      e.stopPropagation();
      openNewArena();
      return;
    }

    const session = findSessionByRoot(target);
    if (!session) {
      if (action === 'settings') {
        e.stopPropagation();
        toggleSettings();
      }
      return;
    }

    if (action === 'play-pause') {
      session.state.isRunning = !session.state.isRunning;
      syncPlayIcons(session.root, session.state.isRunning);
      return;
    }
    if (action === 'reset') {
      resetSimulation(session.state, () => {
        syncColorsUI(session.state);
        updateScoreboard(session.state, session.root);
      });
      return;
    }
    if (action === 'sound') {
      session.state.soundEnabled = !session.state.soundEnabled;
      if (session.state.soundEnabled) initAudio();
      syncSoundIcons(session.root, session.state.soundEnabled);
      try {
        saveSettings(getActiveState());
      } catch {
        saveSettings(session.state);
      }
      return;
    }
    if (action === 'close-arena') {
      e.stopPropagation();
      if (session.minimized) return;
      void closeActiveToLobby();
      return;
    }
    if (action === 'settings') {
      e.stopPropagation();
      if (!session.minimized) {
        openSettings();
      }
    }
  });

  // Keep legacy id listeners as no-ops duplicates avoided — play/reset/sound handled above.
  const btnCurrentThemeTrigger = el('btnCurrentThemeTrigger');
  const themeSelectorContainer = el('themeSelectorContainer');

  btnCurrentThemeTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleThemeDropdown();
  });

  const btnSaveTheme = el<HTMLButtonElement>('btnSaveTheme');
  const inputThemeName = el<HTMLInputElement>('inputThemeName');
  btnSaveTheme.addEventListener('click', (e) => {
    e.stopPropagation();
    saveCurrentAsTheme(state);
  });
  inputThemeName.addEventListener('click', (e) => e.stopPropagation());
  inputThemeName.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCurrentAsTheme(state);
    }
  });

  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    if (!themeSelectorContainer.contains(target)) closeThemeDropdown();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeThemeDropdown();
      if (settingsOpen) closeSettings();
    }
  });

  const sliderSpeedPhysics = el<HTMLInputElement>('sliderSpeedPhysics');
  const lblSpeedVal = el('lblSpeedVal');
  sliderSpeedPhysics.min = '0';
  sliderSpeedPhysics.max = String(SPEED_SLIDER_MAX);
  sliderSpeedPhysics.step = '1';
  sliderSpeedPhysics.addEventListener('input', (e) => {
    const pos = parseFloat((e.target as HTMLInputElement).value);
    state.physicsOptions.speedMps = sliderToSpeed(pos);
    lblSpeedVal.textContent = formatSpeed(state.physicsOptions.speedMps);
    saveSettings(state);
  });

  const sliderBallsCount = el<HTMLInputElement>('sliderBallsCount');
  const lblBallsVal = el('lblBallsVal');
  sliderBallsCount.addEventListener('input', (e) => {
    state.physicsOptions.ballsPerSide = parseInt((e.target as HTMLInputElement).value, 10);
    lblBallsVal.textContent = `${state.physicsOptions.ballsPerSide} na tým`;
    resetSimulation(state, () => {
      syncColorsUI(state);
      updateScoreboard(state, getActiveSession().root);
    });
    saveSettings(state);
  });

  const sliderGridSize = el<HTMLInputElement>('sliderGridSize');
  const lblGridSizeVal = el('lblGridSizeVal');
  sliderGridSize.addEventListener('input', (e) => {
    state.physicsOptions.gridSize = parseInt((e.target as HTMLInputElement).value, 10);
    lblGridSizeVal.textContent = `${state.physicsOptions.gridSize}×${state.physicsOptions.gridSize}`;
    resizeCanvas(state);
    resetSimulation(state, () => {
      syncColorsUI(state);
      updateScoreboard(state, getActiveSession().root);
    });
    saveSettings(state);
  });

  const sliderGlow = el<HTMLInputElement>('sliderGlow');
  const lblGlowVal = el('lblGlowVal');
  sliderGlow.addEventListener('input', (e) => {
    state.gfxOptions.glowIntensity = parseInt((e.target as HTMLInputElement).value, 10);
    lblGlowVal.textContent = String(state.gfxOptions.glowIntensity);
    saveSettings(state);
  });

  const sliderTrail = el<HTMLInputElement>('sliderTrail');
  const lblTrailVal = el('lblTrailVal');
  sliderTrail.addEventListener('input', (e) => {
    state.gfxOptions.maxTrail = parseInt((e.target as HTMLInputElement).value, 10);
    lblTrailVal.textContent = String(state.gfxOptions.maxTrail);
    saveSettings(state);
  });

  const chkTrailSolid = el<HTMLInputElement>('chkTrailSolid');
  chkTrailSolid.addEventListener('change', (e) => {
    state.gfxOptions.trailSolid = (e.target as HTMLInputElement).checked;
    saveSettings(state);
  });

  const chkScanlines = el<HTMLInputElement>('chkScanlines');
  const syncScanlinesOverlay = (): void => {
    const on = getActiveState().gfxOptions.scanlines;
    document.querySelectorAll<HTMLElement>('[data-role="shader-scanlines"]').forEach((node) => {
      node.style.opacity = on ? '0.65' : '0';
    });
  };
  chkScanlines.addEventListener('change', (e) => {
    state.gfxOptions.scanlines = (e.target as HTMLInputElement).checked;
    syncScanlinesOverlay();
    saveSettings(state);
  });

  const chkPixiRenderer = el<HTMLInputElement>('chkPixiRenderer');
  chkPixiRenderer.checked = getRendererMode() === 'pixi';
  chkPixiRenderer.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    // Always tear down so a previous failed init can retry.
    destroyAllPixi();
    setRendererMode(on ? 'pixi' : 'canvas2d');
    for (const session of getSessions()) markGridDirty(session.state);
    invalidatePageBleed();
  });

  const sliderGrid = el<HTMLInputElement>('sliderGrid');
  sliderGrid.addEventListener('input', (e) => {
    state.gfxOptions.gridOpacity = parseInt((e.target as HTMLInputElement).value, 10) / 100;
    saveSettings(state);
  });

  const sliderParticles = el<HTMLInputElement>('sliderParticles');
  const lblParticlesVal = el('lblParticlesVal');
  sliderParticles.addEventListener('input', (e) => {
    state.gfxOptions.particleCount = parseInt((e.target as HTMLInputElement).value, 10);
    lblParticlesVal.textContent = String(state.gfxOptions.particleCount);
    saveSettings(state);
  });

  const sliderAreaSat = el<HTMLInputElement>('sliderAreaSat');
  const lblAreaSatVal = el('lblAreaSatVal');
  sliderAreaSat.addEventListener('input', (e) => {
    state.gfxOptions.areaSaturation = parseInt((e.target as HTMLInputElement).value, 10);
    lblAreaSatVal.textContent = `${state.gfxOptions.areaSaturation}%`;
    markGridDirty(state);
    saveSettings(state);
  });

  const colorFrontier = el<HTMLInputElement>('colorFrontier');
  const sliderFrontier = el<HTMLInputElement>('sliderFrontier');
  const lblFrontierVal = el('lblFrontierVal');
  colorFrontier.addEventListener('input', (e) => {
    state.gfxOptions.frontierColor = (e.target as HTMLInputElement).value;
    saveSettings(state);
  });
  sliderFrontier.addEventListener('input', (e) => {
    state.gfxOptions.frontierStrength = parseInt((e.target as HTMLInputElement).value, 10);
    lblFrontierVal.textContent = `${state.gfxOptions.frontierStrength}%`;
    saveSettings(state);
  });

  const bindShader = (
    pair: 'lightShader' | 'collisionShader' | 'reflectionShader',
    ids: {
      enabled: string;
      row: string;
      slider: string;
      lbl: string;
      reach: string;
      reachLbl: string;
      grid: string;
      fade: string;
      colorA: string;
      colorB: string;
      resetA: string;
      resetB: string;
    },
    fadeFallback: number,
  ): void => {
    const enabled = el<HTMLInputElement>(ids.enabled);
    const row = el(ids.row);
    const slider = el<HTMLInputElement>(ids.slider);
    const lbl = el(ids.lbl);
    const reach = el<HTMLInputElement>(ids.reach);
    const reachLbl = el(ids.reachLbl);
    const grid = el<HTMLInputElement>(ids.grid);
    const fade = el<HTMLInputElement>(ids.fade);
    const colorA = el<HTMLInputElement>(ids.colorA);
    const colorB = el<HTMLInputElement>(ids.colorB);
    const resetA = el<HTMLButtonElement>(ids.resetA);
    const resetB = el<HTMLButtonElement>(ids.resetB);

    const syncRowEnabled = (): void => {
      row.classList.toggle('settings-row-shader-off', !state.gfxOptions[pair].enabled);
    };

    const setShaderColor = (side: 0 | 1, hex: string): void => {
      state.gfxOptions[pair].colors[side] = hex;
      if (side === 0) colorA.value = hex;
      else colorB.value = hex;
      syncColorsUI(state);
      saveSettings(state);
    };

    enabled.addEventListener('change', (e) => {
      state.gfxOptions[pair].enabled = (e.target as HTMLInputElement).checked;
      syncRowEnabled();
      saveSettings(state);
    });
    slider.addEventListener('input', (e) => {
      state.gfxOptions[pair].strength = parseInt((e.target as HTMLInputElement).value, 10);
      lbl.textContent = String(state.gfxOptions[pair].strength);
      saveSettings(state);
    });
    reach.addEventListener('input', (e) => {
      state.gfxOptions[pair].reach = parseInt((e.target as HTMLInputElement).value, 10);
      reachLbl.textContent = `${state.gfxOptions[pair].reach}%`;
      saveSettings(state);
    });
    grid.addEventListener('change', (e) => {
      state.gfxOptions[pair].grid = (e.target as HTMLInputElement).checked;
      saveSettings(state);
    });
    fade.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      state.gfxOptions[pair].fadeMs = Math.max(
        50,
        Math.min(2000, Number.isFinite(v) ? v : fadeFallback),
      );
      fade.value = String(state.gfxOptions[pair].fadeMs);
      saveSettings(state);
    });
    colorA.addEventListener('input', (e) => {
      setShaderColor(0, (e.target as HTMLInputElement).value);
    });
    colorB.addEventListener('input', (e) => {
      setShaderColor(1, (e.target as HTMLInputElement).value);
    });
    resetA.addEventListener('click', () => {
      setShaderColor(0, state.themes[TYPE_DAY].ballColor);
    });
    resetB.addEventListener('click', () => {
      setShaderColor(1, state.themes[TYPE_NIGHT].ballColor);
    });
    syncRowEnabled();
  };

  const syncShaderInputs = (
    pair: 'lightShader' | 'collisionShader' | 'reflectionShader',
    ids: {
      enabled: string;
      row: string;
      slider: string;
      lbl: string;
      reach: string;
      reachLbl: string;
      grid: string;
      fade: string;
      colorA: string;
      colorB: string;
    },
  ): void => {
    const cfg = state.gfxOptions[pair];
    el<HTMLInputElement>(ids.enabled).checked = cfg.enabled;
    el(ids.row).classList.toggle('settings-row-shader-off', !cfg.enabled);
    el<HTMLInputElement>(ids.slider).value = String(cfg.strength);
    el(ids.lbl).textContent = String(cfg.strength);
    el<HTMLInputElement>(ids.reach).value = String(cfg.reach);
    el(ids.reachLbl).textContent = `${cfg.reach}%`;
    el<HTMLInputElement>(ids.grid).checked = cfg.grid;
    el<HTMLInputElement>(ids.fade).value = String(cfg.fadeMs);
    el<HTMLInputElement>(ids.colorA).value = cfg.colors[0];
    el<HTMLInputElement>(ids.colorB).value = cfg.colors[1];
  };

  bindShader(
    'lightShader',
    {
      enabled: 'chkLightShaderOn',
      row: 'rowLightShader',
      slider: 'sliderLight',
      lbl: 'lblLightVal',
      reach: 'sliderLightReach',
      reachLbl: 'lblLightReachVal',
      grid: 'chkLightShaderGrid',
      fade: 'inputLightFadeMs',
      colorA: 'colorLightA',
      colorB: 'colorLightB',
      resetA: 'btnLightColorA',
      resetB: 'btnLightColorB',
    },
    400,
  );
  bindShader(
    'collisionShader',
    {
      enabled: 'chkCollisionShaderOn',
      row: 'rowCollisionShader',
      slider: 'sliderCollision',
      lbl: 'lblCollisionVal',
      reach: 'sliderCollisionReach',
      reachLbl: 'lblCollisionReachVal',
      grid: 'chkCollisionShaderGrid',
      fade: 'inputCollisionFadeMs',
      colorA: 'colorCollisionA',
      colorB: 'colorCollisionB',
      resetA: 'btnCollisionColorA',
      resetB: 'btnCollisionColorB',
    },
    350,
  );
  bindShader(
    'reflectionShader',
    {
      enabled: 'chkReflectionShaderOn',
      row: 'rowReflectionShader',
      slider: 'sliderReflection',
      lbl: 'lblReflectionVal',
      reach: 'sliderReflectionReach',
      reachLbl: 'lblReflectionReachVal',
      grid: 'chkReflectionShaderGrid',
      fade: 'inputReflectionFadeMs',
      colorA: 'colorReflectionA',
      colorB: 'colorReflectionB',
      resetA: 'btnReflectionColorA',
      resetB: 'btnReflectionColorB',
    },
    500,
  );

  const sliderBallScale = el<HTMLInputElement>('sliderBallScale');
  const lblBallScaleVal = el('lblBallScaleVal');
  sliderBallScale.addEventListener('input', (e) => {
    state.gfxOptions.ballScale = parseInt((e.target as HTMLInputElement).value, 10);
    lblBallScaleVal.textContent = `${state.gfxOptions.ballScale}%`;
    applyBallRadii(state);
    saveSettings(state);
  });

  const colorDay = el<HTMLInputElement>('colorDay');
  const colorNight = el<HTMLInputElement>('colorNight');

  const applyCustomColor = (side: typeof TYPE_DAY | typeof TYPE_NIGHT, hex: string): void => {
    state.customColors = true;
    if (side === TYPE_DAY) {
      state.customDay = hex;
      state.themes[TYPE_DAY] = {
        ...state.themes[TYPE_DAY],
        ballColor: hex,
        tileColor: tileFromBall(hex),
      };
    } else {
      state.customNight = hex;
      state.themes[TYPE_NIGHT] = {
        ...state.themes[TYPE_NIGHT],
        ballColor: hex,
        tileColor: tileFromBall(hex),
      };
    }
    syncColorsUI(state);
    renderThemeDropdownList(state);
    markGridDirty(state);
    saveSettings(state);
  };

  colorDay.addEventListener('input', (e) => {
    applyCustomColor(TYPE_DAY, (e.target as HTMLInputElement).value);
  });
  colorNight.addEventListener('input', (e) => {
    applyCustomColor(TYPE_NIGHT, (e.target as HTMLInputElement).value);
  });

  function applySettingsToInputs(): void {
    try {
      syncSoundIcons(getActiveSession().root, getActiveState().soundEnabled);
      syncPlayIcons(getActiveSession().root, getActiveState().isRunning);
    } catch {
      /* sessions not ready */
    }

    sliderSpeedPhysics.value = String(speedToSlider(state.physicsOptions.speedMps));
    lblSpeedVal.textContent = formatSpeed(state.physicsOptions.speedMps);

    sliderBallsCount.value = String(state.physicsOptions.ballsPerSide);
    lblBallsVal.textContent = `${state.physicsOptions.ballsPerSide} na tým`;

    sliderGridSize.value = String(state.physicsOptions.gridSize);
    lblGridSizeVal.textContent = `${state.physicsOptions.gridSize}×${state.physicsOptions.gridSize}`;
    sliderGridSize.min = String(GRID_SIZE_MIN);
    sliderGridSize.max = String(GRID_SIZE_MAX);

    sliderGlow.value = String(state.gfxOptions.glowIntensity);
    lblGlowVal.textContent = String(state.gfxOptions.glowIntensity);

    sliderTrail.value = String(state.gfxOptions.maxTrail);
    lblTrailVal.textContent = String(state.gfxOptions.maxTrail);

    chkTrailSolid.checked = state.gfxOptions.trailSolid;

    chkScanlines.checked = state.gfxOptions.scanlines;
    syncScanlinesOverlay();

    chkPixiRenderer.checked = getRendererMode() === 'pixi';

    sliderGrid.value = String(Math.round(state.gfxOptions.gridOpacity * 100));

    sliderParticles.value = String(state.gfxOptions.particleCount);
    lblParticlesVal.textContent = String(state.gfxOptions.particleCount);

    sliderAreaSat.value = String(state.gfxOptions.areaSaturation);
    lblAreaSatVal.textContent = `${state.gfxOptions.areaSaturation}%`;

    colorFrontier.value = state.gfxOptions.frontierColor;
    sliderFrontier.value = String(state.gfxOptions.frontierStrength);
    lblFrontierVal.textContent = `${state.gfxOptions.frontierStrength}%`;

    syncShaderInputs('lightShader', {
      enabled: 'chkLightShaderOn',
      row: 'rowLightShader',
      slider: 'sliderLight',
      lbl: 'lblLightVal',
      reach: 'sliderLightReach',
      reachLbl: 'lblLightReachVal',
      grid: 'chkLightShaderGrid',
      fade: 'inputLightFadeMs',
      colorA: 'colorLightA',
      colorB: 'colorLightB',
    });
    syncShaderInputs('collisionShader', {
      enabled: 'chkCollisionShaderOn',
      row: 'rowCollisionShader',
      slider: 'sliderCollision',
      lbl: 'lblCollisionVal',
      reach: 'sliderCollisionReach',
      reachLbl: 'lblCollisionReachVal',
      grid: 'chkCollisionShaderGrid',
      fade: 'inputCollisionFadeMs',
      colorA: 'colorCollisionA',
      colorB: 'colorCollisionB',
    });
    syncShaderInputs('reflectionShader', {
      enabled: 'chkReflectionShaderOn',
      row: 'rowReflectionShader',
      slider: 'sliderReflection',
      lbl: 'lblReflectionVal',
      reach: 'sliderReflectionReach',
      reachLbl: 'lblReflectionReachVal',
      grid: 'chkReflectionShaderGrid',
      fade: 'inputReflectionFadeMs',
      colorA: 'colorReflectionA',
      colorB: 'colorReflectionB',
    });

    sliderBallScale.value = String(state.gfxOptions.ballScale);
    lblBallScaleVal.textContent = `${state.gfxOptions.ballScale}%`;

    colorDay.value = state.themes[TYPE_DAY].ballColor;
    colorNight.value = state.themes[TYPE_NIGHT].ballColor;
  }

  applySettingsToInputs();
  refreshSettingsInputs = applySettingsToInputs;
  renderThemeDropdownList(state);

  el('btnResetAllDefaults').addEventListener('click', (e) => {
    e.stopPropagation();
    state.physicsOptions = defaultPhysicsOptions();
    state.gfxOptions = defaultGfxOptions();
    state.currentSchemeIndex = SCHEME_INDEX_DEFAULT;
    state.customColors = false;
    state.themes = cloneSchemeThemes(SCHEME_INDEX_DEFAULT);
    state.customDay = state.themes[TYPE_DAY].ballColor;
    state.customNight = state.themes[TYPE_NIGHT].ballColor;
    closeThemeDropdown();
    applySettingsToInputs();
    syncColorsUI(state);
    renderThemeDropdownList(state);
    resizeCanvas(state);
    applyBallRadii(state);
    resetSimulation(state, () => {
      syncColorsUI(state);
      updateScoreboard(state, getActiveSession().root);
    });
    markGridDirty(state);
    saveSettings(state);
  });

  window.addEventListener('resize', () => {
    resizeAllSessions();
  });
}
