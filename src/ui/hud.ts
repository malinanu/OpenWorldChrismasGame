import { gameState } from '../game/GameState';
import { MINI_GAME_IDS, type MiniGameId, type MiniGameResult } from '../minigames/MiniGame';
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

/** All HTML overlay UI: loading, title, prompts, trackers, cards, map. */
export class Hud {
  readonly root: HTMLElement;
  private fade = el('div', 'fade');
  private loading = el('div', 'loading', '<h1>Frostvale</h1><div class="bar"><div></div></div><p>Wrapping presents…</p>');
  private prompt = el('div', 'prompt hidden');
  private tracker = el('div', 'tracker');
  private gameBar = el('div', 'gamebar hidden');
  private toastBox = el('div', 'toasts');
  private card = el('div', 'card-wrap hidden');
  private mapBox = el('div', 'map hidden');
  private hint = el('div', 'hint', 'WASD move · Mouse look · Shift sprint · Space jump · E interact · M map');

  constructor(root: HTMLElement) {
    this.root = root;
    root.append(this.tracker, this.prompt, this.gameBar, this.hint, this.toastBox, this.mapBox, this.card, this.loading, this.fade);
    gameState.events.on('change', () => this.renderTracker());
    this.renderTracker();
  }

  // ---------- loading / title ----------
  setLoading(fraction: number) {
    (this.loading.querySelector('.bar > div') as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
  }

  hideLoading() {
    this.loading.classList.add('gone');
    setTimeout(() => this.loading.remove(), 800);
  }

  showTitle(): Promise<void> {
    const hasSave = gameState.data.discovered.length > 0 || gameState.ornamentCount > 0;
    return this.showCard(`
      <div class="title-card">
        <h1>❄️ Frostvale ❄️</h1>
        <p class="lead">The six golden ornaments of the Great Tree have been scattered across the village.
        Find each festive challenge, win its ornament, and light the tree before Christmas Eve.</p>
        <p class="small">${MINI_GAME_IDS.length} challenges · ${gameState.ornamentCount} ornaments found · ⭐ ${gameState.totalStars}/18</p>
        <button data-ok autofocus>${hasSave ? 'Continue' : 'Start exploring'}</button>
        <p class="small muted">WASD move · Mouse look · Shift sprint · Space jump · E play · M map · Esc pause</p>
      </div>`);
  }

  // ---------- overworld ----------
  showPrompt(text: string) {
    this.prompt.innerHTML = text;
    this.prompt.classList.remove('hidden');
  }

  hidePrompt() {
    this.prompt.classList.add('hidden');
  }

  setWorldHudVisible(v: boolean) {
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
    this.tracker.innerHTML = `<div class="slots">${slots}</div><div class="stars">⭐ ${gameState.totalStars} / 18</div>`;
  }

  toast(html: string, ms = 3000) {
    const t = el('div', 'toast', html);
    this.toastBox.append(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 600);
  }

  // ---------- map ----------
  get mapOpen() {
    return !this.mapBox.classList.contains('hidden');
  }

  toggleMap(markers: MapMarker[], player: { x: number; z: number }, half: number) {
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
    this.mapBox.innerHTML = `<div class="map-inner"><h2>Map of Frostvale</h2><div class="map-area">
      <div class="pin hub" style="${pos(0, 0)}"><span>🎄</span><label>Great Tree</label></div>
      ${pins}<div class="pin me" style="${pos(player.x, player.z)}"><span>📍</span></div></div>
      <p class="small muted">M to close</p></div>`;
    this.mapBox.classList.remove('hidden');
  }

  // ---------- mini-game HUD ----------
  setGameBar(html: string | null) {
    if (html === null) {
      this.gameBar.classList.add('hidden');
      return;
    }
    this.gameBar.innerHTML = html;
    this.gameBar.classList.remove('hidden');
  }

  /** Intro card for a mini-game. Resolves true to play, false to cancel. */
  async showIntro(id: MiniGameId): Promise<boolean> {
    const info = MINI_GAMES[id];
    const best = gameState.data.bestStars[id];
    const [a, b, c] = info.thresholds;
    const html = `<div class="intro-card">
      <div class="emoji">${info.emoji}</div><h2>${info.title}</h2>
      <p>${info.blurb}</p>
      ${info.create ? `<p class="small">⭐ ${a} · ⭐⭐ ${b} · ⭐⭐⭐ ${c}${best !== undefined ? ` — best: ${'★'.repeat(best) || 'no stars yet'}` : ''}</p>
        <p class="small muted">${info.controls}</p>
        <div class="row"><button data-cancel class="ghost">Not now</button><button data-ok autofocus>Play!</button></div>`
      : `<p class="soon">🧝 The elves are still building this one — check back soon!</p><div class="row"><button data-cancel>OK</button></div>`}
    </div>`;
    return this.showCard(html).then(() => true, () => false);
  }

  async showResults(id: MiniGameId, r: MiniGameResult, newOrnament: boolean): Promise<void> {
    const info = MINI_GAMES[id];
    const stars = [1, 2, 3].map((i) => `<span class="${i <= r.stars ? 'on' : ''}" style="animation-delay:${i * 0.25}s">★</span>`).join('');
    const html = `<div class="result-card">
      <h2>${info.emoji} ${info.title}</h2>
      <div class="bigstars">${stars}</div>
      <p class="score">Score: <b>${r.score}</b></p>
      ${r.summary ? `<p>${r.summary}</p>` : ''}
      ${newOrnament ? '<p class="ornament">🟡 You earned a golden ornament!</p>' : r.stars === 0 ? '<p class="muted">Get at least one star to earn the ornament.</p>' : ''}
      <div class="row"><button data-ok autofocus>Back to Frostvale</button></div>
    </div>`;
    return this.showCard(html).catch(() => {});
  }

  /** Shows HTML in the centre card. Resolves on [data-ok], rejects on [data-cancel]. */
  showCard(html: string): Promise<void> {
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
