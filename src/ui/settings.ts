import { audio } from '../core/Audio';
import type { Quality } from '../core/Engine';
import { gameState } from '../game/GameState';
import { canFullscreen, setFullscreen } from './hud';

/** Graphics, day & night, sound, volume and fullscreen: the Settings tab of the passport. */
export function mountSettings(root: HTMLElement, opts: { onQuality: (q: Quality) => void }) {
  const s = gameState.data.settings;
  const toggle = (k: 'music' | 'sfx', label: string) => `<button type="button" class="chip ${s[k] ? 'on' : ''}" data-sound="${k}">${label}</button>`;
  const chip = (q: Quality, label: string) => `<button type="button" class="chip ${q === s.quality ? 'on' : ''}" data-quality="${q}">${label}</button>`;
  const fs = canFullscreen()
    ? `<div class="row"><span class="small">Screen</span><button type="button" class="chip" data-fullscreen>${document.fullscreenElement ? '🗗 Exit fullscreen' : '⛶ Fullscreen'}</button></div>`
    : '';
  root.innerHTML = `<div class="settings">
      <div class="row"><span class="small">Graphics</span>${chip('low', 'Fast')}${chip('medium', 'Balanced')}${chip('high', 'Pretty')}</div>
      <div class="row"><span class="small">World</span><button type="button" class="chip ${s.dayNight ? 'on' : ''}" data-daynight>🌗 Day &amp; night</button></div>
      <div class="row"><span class="small">Sound</span>${toggle('music', '🎵 Music')}${toggle('sfx', '🔔 Effects')}</div>
      <div class="row"><span class="small">Volume</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-volume aria-label="Volume"></div>
      ${fs}
    </div>`;
  root.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => b.addEventListener('click', () => opts.onQuality(b.dataset.quality as Quality)));
  root.querySelectorAll<HTMLButtonElement>('[data-sound]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.sound as 'music' | 'sfx';
      s[k] = !s[k];
      b.classList.toggle('on', s[k]);
      audio.configure({ [k]: s[k] });
      gameState.save();
    }),
  );
  root.querySelector<HTMLButtonElement>('[data-daynight]')!.addEventListener('click', (e) => {
    s.dayNight = !s.dayNight;
    (e.currentTarget as HTMLElement).classList.toggle('on', s.dayNight);
    gameState.save();
  });
  const vol = root.querySelector<HTMLInputElement>('[data-volume]')!;
  vol.addEventListener('input', () => audio.configure({ volume: (s.volume = Number(vol.value)) }));
  vol.addEventListener('change', () => {
    gameState.save();
    audio.sfx('catch');
  });
  root.querySelector('[data-fullscreen]')?.addEventListener('click', (e) => {
    const on = !document.fullscreenElement;
    void setFullscreen(on);
    (e.currentTarget as HTMLElement).textContent = on ? '🗗 Exit fullscreen' : '⛶ Fullscreen';
  });
}
