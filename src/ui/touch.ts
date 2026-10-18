import { haptic, type Input } from '../core/Input';
import { t } from '../i18n/ui';

const STICK_RADIUS = 56;

function el(cls: string, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
}

/**
 * Overworld touch controls: a floating joystick on the left half of the screen,
 * drag-to-look on the right half, and Jump / Map / Pause buttons.
 * Each zone tracks its own pointer id, so moving and looking work at the same time.
 */
export class TouchControls {
  readonly root = el('touch-ui hidden');
  private stickZone = el('stick-zone');
  private lookZone = el('look-zone');
  private snow: HTMLButtonElement;
  private base = el('stick-base idle', '<div class="stick-knob"></div>');
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private origin = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };

  constructor(parent: HTMLElement, private readonly input: Input) {
    this.knob = this.base.querySelector('.stick-knob')!;
    const jump = this.button('tbtn jump', '', t('jumpAria'));
    jump.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4 L27 15 H20.5 V21 H11.5 V15 H5 Z" /><rect x="11.5" y="24" width="9" height="3.2" rx="1.6" /></svg><span>${t('jump')}</span>`;
    const snow = this.button('tbtn throw', '', t('snowballAria'));
    snow.innerHTML = `<span class="ico">❄️</span><span>${t('throw')}</span>`;
    snow.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.tap('throw');
      snow.classList.add('down');
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) snow.addEventListener(ev, () => snow.classList.remove('down'));
    this.snow = snow;
    const map = this.button('tbtn small tb-map', '🗺️', t('mapAria'));
    const pause = this.button('tbtn small tb-pause', '⚙️', t('settingsAria'));
    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.tap('jump');
      haptic(10);
      jump.classList.add('down');
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) jump.addEventListener(ev, () => jump.classList.remove('down'));
    map.addEventListener('click', () => input.tap('map'));
    pause.addEventListener('click', () => input.tap('pause'));
    this.stickZone.append(this.base);
    this.root.append(this.stickZone, this.lookZone, jump, snow, map, pause);
    // Underneath the rest of the HUD, so prompts, cards and the map receive taps first.
    parent.prepend(this.root);

    this.stickZone.addEventListener('pointerdown', (e) => this.stickStart(e));
    this.stickZone.addEventListener('pointermove', (e) => this.stickMove(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.stickZone.addEventListener(ev, (e) => e.pointerId === this.stickId && this.stickEnd());
      this.lookZone.addEventListener(ev, (e) => e.pointerId === this.lookId && (this.lookId = null));
    }
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      this.lookZone.setPointerCapture(e.pointerId);
      this.last = { x: e.clientX, y: e.clientY };
    });
    this.lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      input.addLook(e.clientX - this.last.x, e.clientY - this.last.y);
      this.last = { x: e.clientX, y: e.clientY };
    });
  }

  /** Throwing needs snow underfoot: the button hides on the cobbled roads. */
  setThrowReady(onSnow: boolean) {
    if (this.snow.classList.contains('off') === !onSnow) return;
    this.snow.classList.toggle('off', !onSnow);
    this.snow.setAttribute('aria-hidden', String(!onSnow));
  }

  private button(cls: string, label: string, title: string) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.setAttribute('aria-label', title);
    return b;
  }

  private stickStart(e: PointerEvent) {
    if (this.stickId !== null) return;
    this.stickId = e.pointerId;
    this.stickZone.setPointerCapture(e.pointerId);
    const r = this.stickZone.getBoundingClientRect();
    this.origin = { x: e.clientX, y: e.clientY };
    this.base.style.left = `${e.clientX - r.left}px`;
    this.base.style.top = `${e.clientY - r.top}px`;
    this.base.classList.remove('idle');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private stickMove(e: PointerEvent) {
    if (e.pointerId !== this.stickId) return;
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.input.setStick(dx / STICK_RADIUS, -dy / STICK_RADIUS);
  }

  private stickEnd() {
    this.stickId = null;
    this.input.setStick(0, 0);
    this.base.classList.add('idle');
    this.base.style.left = '';
    this.base.style.top = '';
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
    if (!v) {
      this.stickEnd();
      this.lookId = null;
      this.input.releaseVirtual();
    }
  }
}
