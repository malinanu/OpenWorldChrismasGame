import { isTouchDevice } from '../core/Input';
import { gameState } from '../game/GameState';
import { titleFor } from '../game/titles';
import { portrait } from './avatar';
import { t } from '../i18n/ui';
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


/** All HTML overlay UI: loading, title, prompts, trackers, cards, map, mini-game bar. */
export class Hud {
  readonly root: HTMLElement;
  private fade = el('div', 'fade');
  private loading = el('div', 'loading', `<h1>Frostvale</h1><div class="bar"><div></div></div><p>${t('loadingWrap')}</p>`);
  private prompt = el('div', 'prompt hidden');
  private tracker = el('div', 'tracker');
  private gameBar = el('div', 'gamebar hidden');
  private actionBtn = el('button', 'action-btn hidden');
  private quitBtn = el('button', 'quit-btn hidden', '✕');
  private toastBox = el('div', 'toasts');
  private card = el('div', 'card-wrap hidden');
  private mapBox = el('div', 'map hidden');
  private hint = el('div', 'hint');
  private profileBtn = el('button', 'profile-badge guest');
  private profile: { name: string; charId: string } | null = null;
  private gameBarHtml = '';
  private actionHtml = '';
  private worldHudVisible = true;

  /** Mini-games set this to react to the big action button (Go, Roll…). */
  onGameAction?: (action: string) => void;
  /** Tapping the "Play" prompt in a game zone. */
  onPromptTap?: () => void;
  /** The ✕ button shown during mini-games. */
  onQuit?: () => void;
  /** The profile badge in the top-right corner. */
  onProfile?: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.actionBtn.addEventListener('click', () => {
      const id = this.actionBtn.dataset.action;
      if (id && !this.actionBtn.disabled) this.onGameAction?.(id);
    });
    this.quitBtn.setAttribute('aria-label', t('leaveGameAria'));
    this.quitBtn.addEventListener('click', () => this.onQuit?.());
    this.prompt.addEventListener('click', () => this.onPromptTap?.());
    this.profileBtn.setAttribute('aria-label', t('passportAria'));
    this.profileBtn.addEventListener('click', () => this.onProfile?.());
    this.mapBox.addEventListener('click', () => this.mapBox.classList.add('hidden'));
    root.append(this.tracker, this.profileBtn, this.prompt, this.gameBar, this.actionBtn, this.quitBtn, this.hint, this.toastBox, this.mapBox, this.card, this.loading, this.fade);
    gameState.events.on('change', () => {
      this.renderTracker();
      this.renderProfile();
    });
    this.renderTracker();
    this.renderProfile();
    this.refreshDeviceMode();
  }

  /** Re-render device-specific text after switching between mouse and touch. */
  refreshDeviceMode() {
    document.body.classList.toggle('is-touch', isTouchDevice);
    this.hint.textContent = isTouchDevice ? t('hintTouch') : t('hintDesktop');
  }

  // ---------- loading / title ----------
  setLoading(fraction: number) {
    const pct = `${Math.round(fraction * 100)}%`;
    (this.loading.querySelector('.bar > div') as HTMLElement).style.width = pct;
    const start = this.card.querySelector<HTMLButtonElement>('.title-card [data-ok][disabled]');
    if (start) {
      start.style.setProperty('--progress', pct);
      start.querySelector('.label')!.textContent = fraction >= 1 ? t('almostReady') : t('loadingPct', { pct });
    }
  }

  setLoadingText(text: string) {
    const p = this.loading.querySelector('p');
    if (p) p.textContent = text;
  }

  hideLoading() {
    this.loading.classList.add('gone');
    setTimeout(() => this.loading.remove(), 800);
  }

  /** Shown as soon as the page starts: Start stays a progress bar until `ready` resolves. */
  showTitle(ready: Promise<unknown>): Promise<void> {
    // The loading screen becomes a plain backdrop behind the title until the village is ready.
    this.loading.classList.add('backdrop');
    this.card.before(this.loading);
    const hasSave = gameState.data.discovered.length > 0 || gameState.ornamentCount > 0;
    const controls = isTouchDevice
      ? t('titleTouch')
      : t('hintDesktop');
    return this.showCard(`
      <div class="title-card">
        <h1>❄️ Frostvale ❄️</h1>
        <p class="lead">${t('titleLead')}</p>
        <p class="small">${t('titleStats', { games: MINI_GAME_IDS.length, orn: gameState.ornamentCount, stars: gameState.totalStars })}</p>
        <button data-ok class="start" disabled><span class="label">${t('loadingPct', { pct: '0%' })}</span></button>
        <p class="small muted">${controls}</p>
      </div>`,
      (card) => {
        const start = card.querySelector<HTMLButtonElement>('[data-ok]')!;
        ready
          .then(() => {
            start.disabled = false;
            start.querySelector('.label')!.textContent = hasSave ? t('continue') : t('startExploring');
            start.focus();
          })
          .catch(() => {});
      },
    );
  }

  // ---------- overworld ----------
  showPlayPrompt(emoji: string, title: string) {
    const html = isTouchDevice
      ? `<span class="play">${t('playChip')}</span> ${emoji} ${title}`
      : t('pressE', { game: `${emoji} ${title}` });
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
    this.profileBtn.classList.toggle('hidden', !v);
    this.hint.classList.toggle('hidden', !v);
    if (!v) this.hidePrompt();
  }

  /** Signed-in player for the badge, or null for a guest. */
  setProfile(p: { name: string; charId: string } | null) {
    this.profile = p;
    this.renderProfile();
  }

  /** Green dot while connected to the shared village. */
  setOnline(on: boolean) {
    this.profileBtn.classList.toggle('online', on);
  }

  private renderProfile() {
    const p = this.profile;
    const { title } = titleFor(gameState.totalStars);
    this.profileBtn.classList.toggle('guest', !p);
    this.profileBtn.title = p ? `${p.name} · ${title.name}` : t('guestBadge');
    this.profileBtn.innerHTML = `<span class="pf-ava"><img alt="" hidden><span class="pf-ghost">${p ? '🧝' : '👤'}</span><i class="pf-dot"></i></span>
      <span class="pf-txt"><b></b><small>${title.icon} ${title.name}</small></span><kbd>C</kbd>`;
    this.profileBtn.querySelector('b')!.textContent = p ? p.name : t('guest');
    if (!p) return;
    const img = this.profileBtn.querySelector('img')!;
    void portrait(p.charId).then((url) => {
      if (!url || this.profile?.charId !== p.charId) return;
      img.src = url;
      img.hidden = false;
      this.profileBtn.querySelector('.pf-ghost')?.remove();
    });
  }

  renderTracker() {
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
    this.mapBox.innerHTML = `<div class="map-inner"><h2>${t('mapTitle')}</h2><div class="map-area">${svg}
      <div class="pin hub" style="${pos(0, 0)}"><span>🎄</span><label>${t('greatTree')}</label></div>
      ${pins}<div class="pin me" style="${pos(player.x, player.z)}"><span>📍</span></div></div>
      <p class="small muted">${isTouchDevice ? t('mapCloseTouch') : t('mapCloseDesk')}</p></div>`;
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
        <p class="small">⭐ ${a} · ⭐⭐ ${b} · ⭐⭐⭐ ${c}${best !== undefined ? ` — ${t('bestStars', { stars: '★'.repeat(best) || t('noStars') })}` : ''}</p>
        <div class="row"><button data-cancel class="ghost">${t('notNow')}</button><button data-ok autofocus>${t('playBang')}</button></div>`
      : `<p class="soon">${t('elvesBuilding')}</p><div class="row"><button data-cancel>${t('ok')}</button></div>`}
    </div>`;
    return this.showCard(html).then(() => true, () => false);
  }

  async showResults(id: MiniGameId, r: MiniGameResult, earned: Stars, newOrnament: boolean): Promise<void> {
    const info = MINI_GAMES[id];
    const stars = [1, 2, 3].map((i) => `<span class="${i <= earned ? 'on' : ''}" style="animation-delay:${i * 0.25}s">★</span>`).join('');
    const html = `<div class="result-card">
      <h2>${info.emoji} ${info.title}</h2>
      <div class="bigstars">${stars}</div>
      <p class="score">${t('score', { score: r.score })}</p>
      ${r.summary ? `<p>${r.summary}</p>` : ''}
      ${newOrnament ? `<p class="ornament">${t('earnedOrnament')}</p>` : earned === 0 ? `<p class="muted">${t('needStar')}</p>` : ''}
      <div class="row"><button data-ok autofocus>${t('backToFrostvale')}</button></div>
    </div>`;
    return this.showCard(html).catch(() => {});
  }

  /**
   * Shows HTML in the centre card. Resolves on [data-ok], rejects on [data-cancel].
   * `onMount` can wire up any extra buttons in the card.
   */
  /** `keys: false` leaves Enter/Esc to the card itself (forms with text inputs). */
  showCard(html: string, onMount?: (card: HTMLElement) => void, opts: { keys?: boolean } = {}): Promise<void> {
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
          const okBtn = this.card.querySelector<HTMLButtonElement>('[data-ok]');
          if (okBtn?.disabled) return;
          done(!!okBtn);
        } else if (e.code === 'Escape') {
          e.stopPropagation();
          if (this.card.querySelector<HTMLButtonElement>('[data-ok]')?.disabled) return;
          done(!this.card.querySelector('[data-cancel]') && !!this.card.querySelector('[data-ok]'));
        }
      };
      if (opts.keys !== false) window.addEventListener('keydown', onKey, true);
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
