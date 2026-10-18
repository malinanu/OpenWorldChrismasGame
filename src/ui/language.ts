import { gameState } from '../game/GameState';
import { LANG_NAMES, LANG_SHORT, LANGS, loadFonts, type Lang } from '../i18n';

const HELLO: Record<Lang, string> = { en: 'Hello!', si: 'ආයුබෝවන්!', ta: 'வணக்கம்!' };

/**
 * First launch: pick English, සිංහල or தமிழ் before anything else is shown. Built straight into
 * #ui (the HUD doesn't exist yet, so everything after it is created in the chosen language).
 */
export function chooseLanguage(root: HTMLElement): Promise<Lang> {
  loadFonts('si', 'ta');
  const wrap = document.createElement('div');
  wrap.className = 'card-wrap lang-wrap';
  wrap.innerHTML = `<div class="card"><div class="passport">
      <div class="pp-cover"><span class="pp-flake">❄</span> FROSTVALE <span class="pp-flake">❄</span></div>
      <div class="pp-page lang-page">
        <h3 class="pp-sub">Choose your language</h3>
        <p class="lang-sub">භාෂාව තෝරන්න · மொழியைத் தேர்ந்தெடுக்கவும்</p>
        <div class="lang-choices">${LANGS.map((l) => `<button type="button" data-lang="${l}" lang="${l}"><b>${LANG_NAMES[l]}</b><small>${HELLO[l]}</small></button>`).join('')}</div>
      </div>
    </div></div>`;
  root.append(wrap);
  return new Promise((resolve) => {
    wrap.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        wrap.remove();
        resolve(b.dataset.lang as Lang);
      }),
    );
  });
}

/** Small EN · සිං · தமி switch (sign-in card, settings). */
export function langChips(current: Lang, cls = 'pchip') {
  return LANGS.map((l) => `<button type="button" class="${cls} ${l === current ? 'on' : ''}" data-setlang="${l}" lang="${l}">${LANG_SHORT[l]}</button>`).join('');
}

/**
 * Switch language for good: saved on this device, then the game reloads so every card,
 * signpost and label is rebuilt in it. `before` runs first (save position, tell the server).
 */
export async function switchLanguage(l: Lang, before?: () => Promise<unknown> | void) {
  if (l === gameState.data.settings.language) return;
  gameState.data.settings.language = l;
  gameState.save();
  try {
    await before?.();
  } catch {
    /* offline: the account catches up next time */
  }
  location.reload();
}
