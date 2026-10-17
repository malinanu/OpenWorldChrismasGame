import { isTouchDevice } from '../core/Input';
import { gameState } from '../game/GameState';
import { MINI_GAME_IDS, type MiniGameId, type MiniGameResult, type Stars } from '../minigames/MiniGame';
import { MINI_GAMES } from '../minigames/registry';
import './styles.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MapMarker {
  id: MiniGameId;
  x: number;
  z: number;
}

export interface GameAction {
  id: string;
  label: string;
  enabled: boolean;
}

const DESKTOP_HINT = 'WASD move · Mouse look · Shift sprint · Space jump · E play · M map · Esc pause';
const TOUCH_HINT = 'Left thumb: move (push far to run) · Right thumb: look · ⤒ jump';

/** All HTML overlay UI: loading, title, prompts, trackers, cards, map, mini-game bar. */
export class Hud {
  readonly root: HTMLElement;
  private fade = el('div', 'fade');
  private loading = el('div', 'loading', '<h1>Frostvale</h1><div class="bar"><div></div></div><p>Wrapping presents…</p>');
  private prompt = el('div', 'prompt hidden');
  private tracker = el('div', 'tracker');
  private gameBar = el('div', 'gamebar hidden');
  private actionBtn = el('button', 'action-btn hidden');
  private quitBtn = el('button', 'quit-btn hidden', '✕');
  private toastBox = el('div', 'toasts');
  private card = el('div', 'card-wrap hidden');
  private mapBox = el('div', 'map hidden');
  private hint = el('div', 'hint');
  private gameBarHtml = '';
  private actionHtml = '';
  private worldHudVisible = true;

  /** Mini-games set this to react to the big action button (Go, Roll…). */
  onGameAction?: (action: string) => void;
  /** Tapping the "Play" prompt in a game zone. */
  onPromptTap?: () => void;
  /** The ✕ button shown during mini-games. */
  onQuit?: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.actionBtn.addEventListener('click', () => {
      const id = this.actionBtn.dataset.action;
      if (id && !this.actionBtn.disabled) this.onGameAction?.(id);
    });
    this.quitBtn.setAttribute('aria-label', 'Leave game');
    this.quitBtn.addEventListener('click', () => this.onQuit?.());
    this.prompt.addEventListener('click', () => this.onPromptTap?.());
    this.mapBox.addEventListener('click', () => this.mapBox.classList.add('hidden'));
    root.append(this.tracker, this.prompt, this.gameBar, this.actionBtn, this.quitBtn, this.hint, this.toastBox, this.mapBox, this.card, this.loading, this.fade);
    gameState.events.on('change', () => this.renderTracker());
    this.renderTracker();
    this.refreshDeviceMode();
  }

  /** Re-render device-specific text after switching between mouse and touch. */
  refreshDeviceMode() {
    document.body.classList.toggle('is-touch', isTouchDevice);
    this.hint.textContent = isTouchDevice ? TOUCH_HINT : DESKTOP_HINT;
  }

  // ---------- loading / title ----------
  setLoading(fraction: number) {
    (this.loading.querySelector('.bar > div') as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
  }

  setLoadingText(text: string) {
    const p = this.loading.querySelector('p');
    if (p) p.textContent = text;
  }

  hideLoading() {
    this.loading.classList.add('gone');
    setTimeout(() => this.loading.remove(), 800);
  }

  showTitle(): Promise<void> {
    const hasSave = gameState.data.discovered.length > 0 || gameState.ornamentCount > 0;
    const controls = isTouchDevice
      ? 'Left thumb moves · right thumb looks · tap <b>▶ Play</b> at a glowing beacon'
      : DESKTOP_HINT;
    return this.showCard(`
      <div class="title-card">
        <h1>❄️ Frostvale ❄️</h1>
        <p class="lead">The six golden ornaments of the Great Tree have been scattered across the village.
        Find each festive challenge, win its ornament, and light the tree before Christmas Eve.</p>
        <p class="small">${MINI_GAME_IDS.length} challenges · ${gameState.ornamentCount} ornaments found · ⭐ ${gameState.totalStars}/18</p>
        <button data-ok autofocus>${hasSave ? 'Continue' : 'Start exploring'}</button>
        <p class="small muted">${controls}</p>
      </div>`);
  }

  // ---------- overworld ----------
  showPlayPrompt(emoji: string, title: string) {
    const html = isTouchDevice
      ? `<span class="play">▶ Play</span> ${emoji} ${title}`
      : `Press <kbd>E</kbd> to play ${emoji} ${title}`;
    if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
    this.prompt.classList.remove('hidden');
  }

  hidePrompt() {
    this.prompt.classList.add('hidden');
  }

  get worldHud() {
    return this.worldHudVisible;
  }

  setWorldHudVisible(v: boolean) {
    this.worldHudVisible = v;
    this.tracker.classList.toggle('hidden', !v);
    this.hint.classList.toggle('hidden', !v);
    if (!v) this.hidePrompt();
  }

  private renderTracker() {
    const slots = MINI_GAME_IDS.map((id) => {
      const got = gameState.hasOrnament(id);
      const info = MINI_GAMES[id];
      const stars = gameState.data.bestStars[id] ?? 0;
      return `<div class="slot ${got ? 'got' : ''}" title="${info.title}${got ? ` — ${'★'.repeat(stars)}` : ''}">${got ? '🟡' : '○'}</div>`;
    }).join('');
    this.tracker.innerHTML = `<div class="slots">${slots}</div><div class="stars">⭐ ${gameState.totalStars}<span class="of">/18</span></div>`;
  }

  toast(html: string, ms = 3000) {
    const t = el('div', 'toast', html);
    this.toastBox.append(t);
    while (this.toastBox.children.length > 3) this.toastBox.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 600);
  }

  // ---------- map ----------
  get mapOpen() {
    return !this.mapBox.classList.contains('hidden');
  }

  toggleMap(markers: MapMarker[], player: { x: number; z: number }, half: number, roads: [number, number][][] = []) {
    if (this.mapOpen) {
      this.mapBox.classList.add('hidden');
      return;
    }
    const pos = (x: number, z: number) => `left:${((x + half) / (2 * half)) * 100}%;top:${((z + half) / (2 * half)) * 100}%`;
    const pins = markers
      .map((m) => {
        const found = gameState.isDiscovered(m.id);
        const info = MINI_GAMES[m.id];
        const got = gameState.hasOrnament(m.id);
        return `<div class="pin ${found ? '' : 'unknown'}" style="${pos(m.x, m.z)}">
          <span>${found ? info.emoji : '✨'}</span><label>${found ? info.title : '???'}${got ? ' 🟡' : ''}</label></div>`;
      })
      .join('');
    const lines = roads
      .map((r) => `<polyline points="${r.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join(' ')}" />`)
      .join('');
    const svg = `<svg class="map-roads" viewBox="${-half} ${-half} ${half * 2} ${half * 2}" preserveAspectRatio="none">${lines}</svg>`;
    this.mapBox.innerHTML = `<div class="map-inner"><h2>Map of Frostvale</h2><div class="map-area">${svg}
      <div class="pin hub" style="${pos(0, 0)}"><span>🎄</span><label>Great Tree</label></div>
      ${pins}<div class="pin me" style="${pos(player.x, player.z)}"><span>📍</span></div></div>
      <p class="small muted">${isTouchDevice ? 'Tap anywhere to close' : 'M or click to close'}</p></div>`;
    this.mapBox.classList.remove('hidden');
  }

  // ---------- mini-game HUD ----------
  /** Info strip at the top of the screen; `null` hides it along with the action button. */
  setGameBar(html: string | null) {
    if (html === null) {
      this.gameBar.classList.add('hidden');
      this.gameBarHtml = '';
      this.setAction(null);
      this.onGameAction = undefined;
      return;
    }
    if (html !== this.gameBarHtml) {
      this.gameBar.innerHTML = html;
      this.gameBarHtml = html;
    }
    this.gameBar.classList.remove('hidden');
  }

  /** The big thumb-reachable button in the bottom-right corner (🚂 Go!, 🎲 Roll…). */
  setAction(action: GameAction | null) {
    if (!action) {
      this.actionBtn.classList.add('hidden');
      this.actionHtml = '';
      return;
    }
    const key = `${action.id}|${action.label}|${action.enabled}`;
    if (key !== this.actionHtml) {
      this.actionHtml = key;
      this.actionBtn.dataset.action = action.id;
      this.actionBtn.textContent = action.label;
      this.actionBtn.disabled = !action.enabled;
    }
    this.actionBtn.classList.remove('hidden');
  }

  setQuitVisible(v: boolean) {
    this.quitBtn.classList.toggle('hidden', !v);
  }

  /** Intro card for a mini-game. Resolves true to play, false to cancel. */
  async showIntro(id: MiniGameId): Promise<boolean> {
    const info = MINI_GAMES[id];
    const best = gameState.data.bestStars[id];
    const [a, b, c] = info.thresholds;
    const html = `<div class="intro-card">
      <div class="emoji">${info.emoji}</div><h2>${info.title}</h2>
      <p>${info.blurb}</p>
      ${info.create ? `<ol class="howto">${info.howTo.map((step) => `<li>${typeof step === 'string' ? step : isTouchDevice ? step[0] : step[1]}</li>`).join('')}</ol>
        <p class="small">⭐ ${a} · ⭐⭐ ${b} · ⭐⭐⭐ ${c}${best !== undefined ? ` — best: ${'★'.repeat(best) || 'no stars yet'}` : ''}</p>
        <div class="row"><button data-cancel class="ghost">Not now</button><button data-ok autofocus>Play!</button></div>`
      : `<p class="soon">🧝 The elves are still building this one — check back soon!</p><div class="row"><button data-cancel>OK</button></div>`}
    </div>`;
    return this.showCard(html).then(() => true, () => false);
  }

  async showResults(id: MiniGameId, r: MiniGameResult, earned: Stars, newOrnament: boolean): Promise<void> {
    const info = MINI_GAMES[id];
    const stars = [1, 2, 3].map((i) => `<span class="${i <= earned ? 'on' : ''}" style="animation-delay:${i * 0.25}s">★</span>`).join('');
    const html = `<div class="result-card">
      <h2>${info.emoji} ${info.title}</h2>
      <div class="bigstars">${stars}</div>
      <p class="score">Score: <b>${r.score}</b></p>
      ${r.summary ? `<p>${r.summary}</p>` : ''}
      ${newOrnament ? '<p class="ornament">🟡 You earned a golden ornament!</p>' : earned === 0 ? '<p class="muted">Get at least one star to earn the ornament.</p>' : ''}
      <div class="row"><button data-ok autofocus>Back to Frostvale</button></div>
    </div>`;
    return this.showCard(html).catch(() => {});
  }

  /**
   * Shows HTML in the centre card. Resolves on [data-ok], rejects on [data-cancel].
   * `onMount` can wire up any extra buttons in the card.
   */
  showCard(html: string, onMount?: (card: HTMLElement) => void): Promise<void> {
    this.card.innerHTML = `<div class="card">${html}</div>`;
    this.card.classList.remove('hidden');
    return new Promise((resolve, reject) => {
      const done = (ok: boolean) => {
        window.removeEventListener('keydown', onKey, true);
        this.card.classList.add('hidden');
        ok ? resolve() : reject();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'Enter' || e.code === 'KeyE') {
          e.stopPropagation();
          e.preventDefault();
          const okBtn = this.card.querySelector('[data-ok]');
          done(!!okBtn);
        } else if (e.code === 'Escape') {
          e.stopPropagation();
          done(!this.card.querySelector('[data-cancel]') && !!this.card.querySelector('[data-ok]'));
        }
      };
      window.addEventListener('keydown', onKey, true);
      this.card.querySelector('[data-ok]')?.addEventListener('click', () => done(true));
      this.card.querySelector('[data-cancel]')?.addEventListener('click', () => done(false));
      onMount?.(this.card);
    });
  }

  get cardOpen() {
    return !this.card.classList.contains('hidden');
  }

  async fadeOut() {
    this.fade.classList.add('on');
    await wait(350);
  }

  async fadeIn() {
    this.fade.classList.remove('on');
    await wait(350);
  }
}

/** Fullscreen hides the browser bars on Android / iPad. iPhone Safari has no API — "Add to Home Screen" instead. */
export function canFullscreen() {
  return !!document.fullscreenEnabled;
}

export async function setFullscreen(on: boolean) {
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* denied or unsupported */
  }
}
