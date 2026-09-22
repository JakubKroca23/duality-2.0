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
import { CYBER_SCHEMES, applySchemeLookToGfx, cloneSchemeLook, cloneSchemeThemes, tileFromBall } from '../config/themes';
import { initAudio } from '../sim/audio';
import { loadSettings, saveSettings } from '../sim/persistence';
import { applyBallRadii, resetSimulation, resizeCanvas } from '../sim/physics';
import { markGridDirty, updateScoreboard } from '../sim/render';
import { invalidatePageBleed } from '../sim/ambient';
import { bindRunsPanel } from './runsPanel';
import type { SimState } from '../sim/state';

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
  const currentScheme = CYBER_SCHEMES[state.currentSchemeIndex];
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

  el('labelLeft').style.color = leftCol;
  el('labelRight').style.color = rightCol;

  const dotL = el('dotLeft');
  dotL.style.backgroundColor = leftCol;
  dotL.style.boxShadow = `0 0 10px ${leftCol}`;

  const dotR = el('dotRight');
  dotR.style.backgroundColor = rightCol;
  dotR.style.boxShadow = `0 0 10px ${rightCol}`;

  const barDay = el('barDay');
  barDay.style.backgroundColor = leftCol;
  barDay.style.boxShadow = `0 0 8px ${leftCol}`;

  const barNight = el('barNight');
  barNight.style.backgroundColor = rightCol;
  barNight.style.boxShadow = `0 0 8px ${rightCol}`;

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

  CYBER_SCHEMES.forEach((scheme, index) => {
    const item = document.createElement('div');
    const isActive = !state.customColors && index === state.currentSchemeIndex;
    item.className = `theme-item settings-theme-item flex items-center justify-between ${isActive ? 'active' : ''}`;

    item.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="flex items-center -space-x-1">
          <span class="w-2 h-2 rounded-full" style="background-color: ${scheme[TYPE_DAY].ballColor}; box-shadow: 0 0 5px ${scheme[TYPE_DAY].ballColor};"></span>
          <span class="w-2 h-2 rounded-full" style="background-color: ${scheme[TYPE_NIGHT].ballColor}; box-shadow: 0 0 5px ${scheme[TYPE_NIGHT].ballColor};"></span>
        </div>
        <div>
          <span class="font-bold text-[9px] text-slate-100 mono block tracking-wider leading-tight">${scheme.name}</span>
          <span class="text-[7.5px] text-slate-400 mono opacity-80">${scheme.tag}</span>
        </div>
      </div>
    `;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectTheme(state, index);
      closeThemeDropdown();
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
  state.currentSchemeIndex = index;
  state.customColors = false;
  state.themes = cloneSchemeThemes(index);
  state.customDay = state.themes[TYPE_DAY].ballColor;
  state.customNight = state.themes[TYPE_NIGHT].ballColor;
  applySchemeLookToGfx(state.gfxOptions, cloneSchemeLook(index));
  syncColorsUI(state);
  renderThemeDropdownList(state);
  applyBallRadii(state);
  refreshSettingsInputs?.();
  markGridDirty(state);
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

export function bindControls(state: SimState): void {
  loadSettings(state);

  const drawerSettingsContent = el('drawerSettingsContent');
  const btnToggleSettings = el<HTMLButtonElement>('btnToggleSettings');

  let settingsOpen = false;

  function syncPanelButtons(): void {
    btnToggleSettings.classList.toggle('nav-btn-active-cyan', settingsOpen);
    btnToggleSettings.setAttribute('aria-expanded', settingsOpen ? 'true' : 'false');
    drawerSettingsContent.classList.toggle('open', settingsOpen);
    drawerSettingsContent.setAttribute('aria-hidden', settingsOpen ? 'false' : 'true');
    document.getElementById('simWrapper')?.classList.toggle('settings-open', settingsOpen);
    document.body.classList.toggle('settings-drawer-open', settingsOpen);
    invalidatePageBleed();
  }

  function openSettings(): void {
    settingsOpen = true;
    syncPanelButtons();
  }

  function closeSettings(): void {
    settingsOpen = false;
    closeThemeDropdown();
    syncPanelButtons();
  }

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

  btnToggleSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSettings();
  });

  el('btnCloseSettings').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSettings();
  });

  const btnCurrentThemeTrigger = el('btnCurrentThemeTrigger');
  const themeSelectorContainer = el('themeSelectorContainer');

  btnCurrentThemeTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleThemeDropdown();
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

  const btnPlayPause = el('btnPlayPause');
  const iconPlay = el('iconPlay');
  const iconPause = el('iconPause');

  btnPlayPause.addEventListener('click', () => {
    state.isRunning = !state.isRunning;
    if (state.isRunning) {
      iconPause.classList.remove('hidden');
      iconPlay.classList.add('hidden');
    } else {
      iconPause.classList.add('hidden');
      iconPlay.classList.remove('hidden');
    }
  });

  el('btnReset').addEventListener('click', () => {
    resetSimulation(state, () => {
      syncColorsUI(state);
      updateScoreboard(state);
    });
  });

  const btnSound = el('btnSound');
  const iconSoundOn = el('iconSoundOn');
  const iconSoundOff = el('iconSoundOff');

  btnSound.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    if (state.soundEnabled) {
      initAudio();
      iconSoundOn.classList.remove('hidden');
      iconSoundOff.classList.add('hidden');
    } else {
      iconSoundOn.classList.add('hidden');
      iconSoundOff.classList.remove('hidden');
    }
    saveSettings(state);
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
      updateScoreboard(state);
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
      updateScoreboard(state);
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
  const shaderScanlines = el('shaderScanlines');
  chkScanlines.addEventListener('change', (e) => {
    state.gfxOptions.scanlines = (e.target as HTMLInputElement).checked;
    shaderScanlines.style.opacity = state.gfxOptions.scanlines ? '0.65' : '0';
    saveSettings(state);
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
    if (state.soundEnabled) {
      iconSoundOn.classList.remove('hidden');
      iconSoundOff.classList.add('hidden');
    } else {
      iconSoundOn.classList.add('hidden');
      iconSoundOff.classList.remove('hidden');
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
    shaderScanlines.style.opacity = state.gfxOptions.scanlines ? '0.65' : '0';

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
  bindRunsPanel(state);

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
      updateScoreboard(state);
    });
    markGridDirty(state);
    saveSettings(state);
  });

  window.addEventListener('resize', () => resizeCanvas(state));
}
