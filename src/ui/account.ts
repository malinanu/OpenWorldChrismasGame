import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assets } from '../core/AssetLoader';
import { api, ApiError, CHARACTER_NAMES, type ServerConfig, type User } from '../net/api';
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
      err.textContent = ex instanceof ApiError || ex instanceof Error ? ex.message : 'Something went wrong.';
    } finally {
      btn.disabled = false;
    }
  });
  form.querySelector<HTMLInputElement>('input')?.focus();
}

type SignInResult = User | 'offline';

/** Email + password sign-in / registration, or phone + SMS code when the server is in phone mode. */
export function signIn(hud: Hud, cfg: ServerConfig): Promise<SignInResult> {
  return cfg.authMode === 'phone' ? phoneSignIn(hud) : emailSignIn(hud);
}

function emailSignIn(hud: Hud): Promise<SignInResult> {
  return formCard<SignInResult>(
    hud,
    `<div class="account">
      <h2>❄️ Join Frostvale</h2>
      <div class="tabs"><button type="button" class="chip on" data-tab="login">Sign in</button><button type="button" class="chip" data-tab="register">Create account</button></div>
      <form novalidate>
        <label class="reg-only">Username<input name="username" autocomplete="username" maxlength="16" placeholder="snowy_elf" /></label>
        <label>Email<input name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" placeholder="At least 8 characters" /></label>
        <p class="form-error" role="alert"></p>
        <button type="submit">Sign in</button>
      </form>
      <button type="button" class="ghost small-btn" data-offline>Play offline</button>
    </div>`,
    (card, finish) => {
      let mode: 'login' | 'register' = 'login';
      const root = card.querySelector<HTMLElement>('.account')!;
      const submit = card.querySelector<HTMLButtonElement>('button[type=submit]')!;
      const pw = card.querySelector<HTMLInputElement>('input[name=password]')!;
      const setMode = (m: typeof mode) => {
        mode = m;
        root.classList.toggle('registering', m === 'register');
        card.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === m));
        submit.textContent = m === 'register' ? 'Create account' : 'Sign in';
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
      <h2>❄️ Join Frostvale</h2>
      <p class="small">We'll text you a 6-digit code.</p>
      <form novalidate>
        <label class="step-phone">Phone number<input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+94 77 123 4567" /></label>
        <label class="step-code" hidden>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" /></label>
        <p class="form-error" role="alert"></p>
        <button type="submit">Send code</button>
      </form>
      <button type="button" class="ghost small-btn" data-back hidden>Use another number</button>
      <button type="button" class="ghost small-btn" data-offline>Play offline</button>
    </div>`,
    (card, finish) => {
      let phone = '';
      const submit = card.querySelector<HTMLButtonElement>('button[type=submit]')!;
      const codeRow = card.querySelector<HTMLElement>('.step-code')!;
      const phoneRow = card.querySelector<HTMLElement>('.step-phone')!;
      const back = card.querySelector<HTMLButtonElement>('[data-back]')!;
      const showCode = (on: boolean) => {
        codeRow.hidden = !on;
        phoneRow.hidden = on;
        back.hidden = !on;
        submit.textContent = on ? 'Verify' : 'Send code';
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
      <h2>Pick a username</h2>
      <p class="small">Other players will see it above your head.</p>
      <form novalidate>
        <label>Username<input name="username" maxlength="16" autocomplete="username" placeholder="snowy_elf" /></label>
        <p class="form-error" role="alert"></p>
        <button type="submit">Continue</button>
      </form>
    </div>`,
    (card, finish) => wireForm(card, async () => finish(await api.updateMe({ username: card.querySelector<HTMLInputElement>('input')!.value.trim() }))),
  );
}

/**
 * Character select: a small turntable preview of each Adventurer with the idle animation.
 * Resolves with the chosen id. Uses its own small renderer, disposed when the card closes.
 */
export async function chooseCharacter(hud: Hud, characters: string[], current: string): Promise<string> {
  let index = Math.max(0, characters.indexOf(current));
  const clips = (await assets.model('animations/Frostvale_Clips.glb')).animations;
  const idle = clips.find((c) => c.name === 'Idle_A')!;
  let renderer: THREE.WebGLRenderer | null = null;
  let raf = 0;
  const choice = await formCard<string>(
    hud,
    `<div class="account">
      <h2>Choose your adventurer</h2>
      <div class="char-pick">
        <button type="button" class="chip arrow" data-prev aria-label="Previous">‹</button>
        <canvas width="240" height="260"></canvas>
        <button type="button" class="chip arrow" data-next aria-label="Next">›</button>
      </div>
      <p class="char-name"></p>
      <div class="char-dots">${characters.map((_, i) => `<span data-i="${i}"></span>`).join('')}</div>
      <div class="row"><button type="button" data-choose>Choose</button></div>
    </div>`,
    (card, finish) => {
      const canvas = card.querySelector('canvas')!;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#e8f0ff', '#6a7a99', 2));
      const key = new THREE.DirectionalLight('#fff1dc', 2.2);
      key.position.set(2, 4, 3);
      scene.add(key);
      const camera = new THREE.PerspectiveCamera(30, 240 / 260, 0.1, 50);
      camera.position.set(0, 1.25, 4.6);
      camera.lookAt(0, 0.9, 0);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.95, 0.12, 40), new THREE.MeshStandardMaterial({ color: '#e9f1fb', roughness: 0.9 }));
      stand.position.y = -0.06;
      scene.add(stand);
      const turntable = new THREE.Group();
      scene.add(turntable);
      let mixer: THREE.AnimationMixer | null = null;
      let token = 0;
      const show = async (i: number) => {
        index = (i + characters.length) % characters.length;
        const id = characters[index];
        card.querySelector('.char-name')!.textContent = CHARACTER_NAMES[id] ?? id;
        card.querySelectorAll<HTMLElement>('.char-dots span').forEach((d) => d.classList.toggle('on', Number(d.dataset.i) === index));
        const mine = ++token;
        const model = cloneSkinned((await assets.model(`characters/${id}.glb`)).scene);
        if (mine !== token) return;
        turntable.clear();
        turntable.add(model);
        mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(idle).play();
      };
      card.querySelector('[data-prev]')!.addEventListener('click', () => void show(index - 1));
      card.querySelector('[data-next]')!.addEventListener('click', () => void show(index + 1));
      card.querySelector('[data-choose]')!.addEventListener('click', () => finish(characters[index]));
      // Swipe on the preview to browse.
      let downX: number | null = null;
      canvas.addEventListener('pointerdown', (e) => (downX = e.clientX));
      canvas.addEventListener('pointerup', (e) => {
        if (downX !== null && Math.abs(e.clientX - downX) > 30) void show(index + (e.clientX < downX ? 1 : -1));
        downX = null;
      });
      const clock = new THREE.Clock();
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(clock.getDelta(), 0.05);
        turntable.rotation.y += dt * 0.6;
        mixer?.update(dt);
        renderer!.render(scene, camera);
      };
      void show(index).then(loop);
    },
  );
  cancelAnimationFrame(raf);
  (renderer as THREE.WebGLRenderer | null)?.dispose();
  (renderer as THREE.WebGLRenderer | null)?.forceContextLoss();
  return choice;
}

export { esc };
