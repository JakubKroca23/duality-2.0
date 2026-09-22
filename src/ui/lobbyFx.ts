/** Light lobby logo cursor reaction (no background fluids). */

let bound = false;
let active = false;
let raf = 0;
let lastMx = 0.5;
let lastMy = 0.4;
let mx = 0.5;
let my = 0.4;
let mvx = 0;
let mvy = 0;
let targetX = 0.5;
let targetY = 0.4;

function lobbyRoot(): HTMLElement | null {
  return document.getElementById('appLobby');
}

function logoEl(): HTMLElement | null {
  return document.querySelector('.lobby-logo');
}

function applyLogoVars(): void {
  const logo = logoEl();
  const lobby = lobbyRoot();
  if (!lobby) return;
  lobby.style.setProperty('--lobby-mx', mx.toFixed(4));
  lobby.style.setProperty('--lobby-my', my.toFixed(4));
  if (!logo) return;
  const dx = (mx - 0.5) * 2;
  const dy = (my - 0.5) * 2;
  logo.style.setProperty('--logo-rx', `${(-dy * 4).toFixed(2)}deg`);
  logo.style.setProperty('--logo-ry', `${(dx * 6).toFixed(2)}deg`);
  logo.style.setProperty('--logo-tx', `${(dx * 8).toFixed(2)}px`);
  logo.style.setProperty('--logo-ty', `${(dy * 6).toFixed(2)}px`);
  logo.style.setProperty(
    '--logo-glow',
    `${(0.55 + Math.min(0.4, Math.hypot(mvx, mvy) * 10)).toFixed(3)}`,
  );
}

function tick(): void {
  raf = 0;
  if (!active) return;
  mx += (targetX - mx) * 0.14;
  my += (targetY - my) * 0.14;
  applyLogoVars();
  mvx *= 0.9;
  mvy *= 0.9;
  if (
    Math.abs(targetX - mx) > 0.0008 ||
    Math.abs(targetY - my) > 0.0008 ||
    Math.hypot(mvx, mvy) > 0.0002
  ) {
    raf = requestAnimationFrame(tick);
  }
}

function schedule(): void {
  if (!raf) raf = requestAnimationFrame(tick);
}

function onPointerMove(e: PointerEvent): void {
  if (!active) return;
  const nw = Math.max(1, window.innerWidth);
  const nh = Math.max(1, window.innerHeight);
  const nx = e.clientX / nw;
  const ny = e.clientY / nh;
  mvx = nx - lastMx;
  mvy = ny - lastMy;
  lastMx = nx;
  lastMy = ny;
  targetX = nx;
  targetY = ny;
  schedule();
}

export function setLobbyFxActive(on: boolean): void {
  active = on;
  document.body.classList.toggle('lobby-fx-on', on);
  if (on) {
    targetX = 0.5;
    targetY = 0.4;
    schedule();
  } else if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

export function bindLobbyFx(): void {
  if (bound) return;
  bound = true;
  window.addEventListener('pointermove', onPointerMove, { passive: true });
}
