import { audio } from '../core/Audio';
import type { Quality } from '../core/Engine';
import { gameState } from '../game/GameState';
import { canFullscreen, setFullscreen } from './hud';

/** The passport's Settings tab, "Travel preferences" on the passport paper: graphics, day & night, sound, volume, fullscreen. */
export function mountSettings(root: HTMLElement, opts: { onQuality: (q: Quality) => void }) {
  const s = gameState.data.settings;
  const toggle = (k: 'music' | 'sfx', label: string) => `<button type="button" class="pchip ${s[k] ? 'on' : ''}" data-sound="${k}">${label}</button>`;
  const chip = (q: Quality, label: string) => `<button type="button" class="pchip ${q === s.quality ? 'on' : ''}" data-quality="${q}">${label}</button>`;
  const row = (label: string, controls: string) => `<div class="pref"><span class="pref-l">${label}</span><div class="pref-c">${controls}</div></div>`;
  root.innerHTML = `<h3 class="pp-sub">Travel preferences</h3>
    ${row('🖼️ Graphics', `<div class="seg">${chip('low', 'Fast')}${chip('medium', 'Balanced')}${chip('high', 'Pretty')}</div>`)}
    ${row('🌗 World', `<button type="button" class="pchip ${s.dayNight ? 'on' : ''}" data-daynight>Day &amp; night</button>`)}
    ${row('🔔 Sound', `${toggle('music', '🎵 Music')}${toggle('sfx', '✨ Effects')}`)}
    ${row('🔊 Volume', `<input type="range" class="cane" min="0" max="1" step="0.05" value="${s.volume}" data-volume aria-label="Volume">`)}
    ${canFullscreen() ? row('📱 Screen', `<button type="button" class="pchip" data-fullscreen>${document.fullscreenElement ? '🗗 Exit fullscreen' : '⛶ Fullscreen'}</button>`) : ''}`;
  root.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => b.addEventListener('click', () => opts.onQuality(b.dataset.quality as Quality)));
  // The candy-cane fill follows the volume.
  const paint = (v: HTMLInputElement) => v.style.setProperty('--v', `${Number(v.value) * 100}%`);
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
  paint(vol);
  vol.addEventListener('input', () => {
    paint(vol);
    audio.configure({ volume: (s.volume = Number(vol.value)) });
  });
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
