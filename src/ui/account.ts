import { api, ApiError, CHARACTER_NAMES, type ServerConfig, type User } from '../net/api';
import { mountAvatarStage, type AvatarStage } from './avatar';
import { langChips, switchLanguage } from './language';
import { lang, LANGS, type Lang } from '../i18n';
import { t } from '../i18n/ui';
import type { Hud } from './hud';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Runs a card whose buttons are wired by `mount`; `finish(value)` closes it with that value.
 * Uses a hidden [data-ok] so the HUD's card plumbing (freeze, fade, hidden state) still applies.
 */
function formCard<T>(hud: Hud, html: string, mount: (card: HTMLElement, finish: (v: T) => void) => void): Promise<T> {
  let result!: T;
  return hud
    .showCard(
      `${html}<button data-ok hidden></button>`,
      (card) => mount(card, (v) => {
        result = v;
        card.querySelector<HTMLButtonElement>('[data-ok]')!.click();
      }),
      { keys: false },
    )
    .then(() => result);
}

/** Wires a form: submit on Enter or the primary button, shows server errors inline, disables while busy. */
function wireForm(card: HTMLElement, submit: () => Promise<void>) {
  const form = card.querySelector('form')!;
  const err = card.querySelector<HTMLElement>('.form-error')!;
  const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    try {
      await submit();
    } catch (ex) {
      err.textContent = ex instanceof ApiError || ex instanceof Error ? ex.message : t('wentWrong');
    } finally {
      btn.disabled = false;
    }
  });
  form.querySelector<HTMLInputElement>('input')?.focus();
}

type SignInResult = User | 'offline';

/** Language switch at the top of the sign-in card; switching reloads the game in that language. */
const langRow = () => (LANGS.length > 1 ? `<div class="lang-switch">${langChips(lang())}</div>` : '');
function wireLang(card: HTMLElement) {
  card.querySelectorAll<HTMLButtonElement>('[data-setlang]').forEach((b) => b.addEventListener('click', () => void switchLanguage(b.dataset.setlang as Lang)));
}

/** Email + password sign-in / registration, or phone + SMS code when the server is in phone mode. */
export function signIn(hud: Hud, cfg: ServerConfig): Promise<SignInResult> {
  return cfg.authMode === 'phone' ? phoneSignIn(hud) : emailSignIn(hud);
}

function emailSignIn(hud: Hud): Promise<SignInResult> {
  return formCard<SignInResult>(
    hud,
    `<div class="account">
      ${langRow()}
      <h2>${t('joinTitle')}</h2>
      <div class="tabs"><button type="button" class="chip on" data-tab="login">${t('tabSignIn')}</button><button type="button" class="chip" data-tab="register">${t('tabCreate')}</button></div>
      <form novalidate>
        <label class="reg-only">${t('username')}<input name="username" autocomplete="username" maxlength="16" placeholder="snowy_elf" /></label>
        <label>${t('email')}<input name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" /></label>
        <label>${t('password')}<input name="password" type="password" autocomplete="current-password" placeholder="${t('passwordHint')}" /></label>
        <p class="form-error" role="alert"></p>
        <button type="submit">${t('tabSignIn')}</button>
      </form>
      <button type="button" class="ghost small-btn" data-offline>${t('playOffline')}</button>
    </div>`,
    (card, finish) => {
      wireLang(card);
      let mode: 'login' | 'register' = 'login';
      const root = card.querySelector<HTMLElement>('.account')!;
      const submit = card.querySelector<HTMLButtonElement>('button[type=submit]')!;
      const pw = card.querySelector<HTMLInputElement>('input[name=password]')!;
      const setMode = (m: typeof mode) => {
        mode = m;
        root.classList.toggle('registering', m === 'register');
        card.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === m));
        submit.textContent = m === 'register' ? t('tabCreate') : t('tabSignIn');
        pw.autocomplete = m === 'register' ? 'new-password' : 'current-password';
        card.querySelector<HTMLElement>('.form-error')!.textContent = '';
      };
      card.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.tab as typeof mode)));
      card.querySelector('[data-offline]')!.addEventListener('click', () => finish('offline'));
      wireForm(card, async () => {
        const v = (n: string) => card.querySelector<HTMLInputElement>(`input[name=${n}]`)!.value.trim();
        const user = mode === 'register' ? await api.register(v('email'), pw.value, v('username')) : await api.login(v('email'), pw.value);
        finish(user);
      });
    },
  );
}

function phoneSignIn(hud: Hud): Promise<SignInResult> {
  return formCard<SignInResult>(
    hud,
    `<div class="account">
      ${langRow()}
      <h2>${t('joinTitle')}</h2>
      <p class="small">${t('smsInfo')}</p>
      <form novalidate>
        <label class="step-phone">${t('phone')}<input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+94 77 123 4567" /></label>
        <label class="step-code" hidden>${t('code')}<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" /></label>
        <p class="form-error" role="alert"></p>
        <button type="submit">${t('sendCode')}</button>
      </form>
      <button type="button" class="ghost small-btn" data-back hidden>${t('otherNumber')}</button>
      <button type="button" class="ghost small-btn" data-offline>${t('playOffline')}</button>
    </div>`,
    (card, finish) => {
      wireLang(card);
      let phone = '';
      const submit = card.querySelector<HTMLButtonElement>('button[type=submit]')!;
      const codeRow = card.querySelector<HTMLElement>('.step-code')!;
      const phoneRow = card.querySelector<HTMLElement>('.step-phone')!;
      const back = card.querySelector<HTMLButtonElement>('[data-back]')!;
      const showCode = (on: boolean) => {
        codeRow.hidden = !on;
        phoneRow.hidden = on;
        back.hidden = !on;
        submit.textContent = on ? t('verify') : t('sendCode');
        (on ? codeRow : phoneRow).querySelector('input')!.focus();
      };
      back.addEventListener('click', () => showCode(false));
      card.querySelector('[data-offline]')!.addEventListener('click', () => finish('offline'));
      wireForm(card, async () => {
        if (codeRow.hidden) {
          phone = card.querySelector<HTMLInputElement>('input[name=phone]')!.value;
          await api.requestCode(phone);
          showCode(true);
        } else {
          finish(await api.verifyCode(phone, card.querySelector<HTMLInputElement>('input[name=code]')!.value.trim()));
        }
      });
    },
  );
}

/** Phone accounts pick a username after their first sign-in. */
export function chooseUsername(hud: Hud): Promise<User> {
  return formCard<User>(
    hud,
    `<div class="account">
      <h2>${t('pickUsername')}</h2>
      <p class="small">${t('pickUsernameInfo')}</p>
      <form novalidate>
        <label>${t('username')}<input name="username" maxlength="16" autocomplete="username" placeholder="snowy_elf" /></label>
        <p class="form-error" role="alert"></p>
        <button type="submit">${t('next')}</button>
      </form>
    </div>`,
    (card, finish) => wireForm(card, async () => finish(await api.updateMe({ username: card.querySelector<HTMLInputElement>('input')!.value.trim() }))),
  );
}

/**
 * Character select: a small turntable preview of each Adventurer with the idle animation.
 * Resolves with the chosen id. The preview's renderer is disposed when the card closes.
 */
export async function chooseCharacter(hud: Hud, characters: string[], current: string): Promise<string> {
  let index = Math.max(0, characters.indexOf(current));
  let stage: AvatarStage | null = null;
  const choice = await formCard<string>(
    hud,
    `<div class="account">
      <h2>${t('chooseAdventurer')}</h2>
      <div class="char-pick">
        <button type="button" class="chip arrow" data-prev aria-label="${t('previous')}">‹</button>
        <canvas width="240" height="260"></canvas>
        <button type="button" class="chip arrow" data-next aria-label="${t('following')}">›</button>
      </div>
      <p class="char-name"></p>
      <div class="char-dots">${characters.map((_, i) => `<span data-i="${i}"></span>`).join('')}</div>
      <div class="row"><button type="button" data-choose>${t('choose')}</button></div>
    </div>`,
    (card, finish) => {
      const canvas = card.querySelector('canvas')!;
      stage = mountAvatarStage(canvas);
      const show = (i: number) => {
        index = (i + characters.length) % characters.length;
        const id = characters[index];
        card.querySelector('.char-name')!.textContent = CHARACTER_NAMES[id] ?? id;
        card.querySelectorAll<HTMLElement>('.char-dots span').forEach((d) => d.classList.toggle('on', Number(d.dataset.i) === index));
        void stage!.show(id);
      };
      card.querySelector('[data-prev]')!.addEventListener('click', () => show(index - 1));
      card.querySelector('[data-next]')!.addEventListener('click', () => show(index + 1));
      card.querySelector('[data-choose]')!.addEventListener('click', () => finish(characters[index]));
      // Swipe on the preview to browse.
      let downX: number | null = null;
      canvas.addEventListener('pointerdown', (e) => (downX = e.clientX));
      canvas.addEventListener('pointerup', (e) => {
        if (downX !== null && Math.abs(e.clientX - downX) > 30) show(index + (e.clientX < downX ? 1 : -1));
        downX = null;
      });
      show(index);
    },
  );
  (stage as AvatarStage | null)?.dispose();
  return choice;
}

export { esc };
