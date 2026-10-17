export type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'interact' | 'pause' | 'map' | 'fire';

const KEYS: Record<string, Action> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyE: 'interact', Enter: 'interact',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'map',
};

// Standard gamepad mapping: A=0, X=2, LB=4, RT=7, Back=8, Start=9.
const PAD: Partial<Record<Action, number>> = { jump: 0, interact: 2, sprint: 4, map: 8, pause: 9, fire: 7 };

/** Pixels of touch drag are worth more than mouse pixels: phones are small. */
const TOUCH_LOOK_SCALE = 2.4;
/** Pushing the virtual stick past this makes the player run. */
const STICK_SPRINT = 0.9;

/** True on phones/tablets; becomes true on desktop too after the first touch. */
export let isTouchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Short vibration on devices that support it (Android); silently ignored elsewhere. */
export function haptic(pattern: number | number[] = 15) {
  if (isTouchDevice) navigator.vibrate?.(pattern);
}

/**
 * Maps keyboard, mouse, touch and gamepad onto game actions.
 * Mouse and touch both arrive as Pointer Events, so mini-games only read `pointer` + 'fire'.
 * On-screen controls feed in through `setStick`, `addLook`, `tap` and `hold`.
 * Call `beginFrame()` before and `endFrame()` after all systems have read input.
 */
export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  private padDown = new Set<Action>();
  private virtualDown = new Set<Action>();
  private stick = { x: 0, y: 0 };
  private firePointer: number | null = null;
  /** Look delta since last frame, in mouse-pixel units. */
  readonly look = { x: 0, y: 0 };
  /** Last pointer position in normalised device coords (-1..1). */
  readonly pointer = { x: 0, y: 0 };
  wheel = 0;
  enabled = true;
  /** Called the first time a touch is seen, so the UI can switch to touch controls. */
  onTouchDetected?: () => void;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      const a = KEYS[e.code];
      if (!a) return;
      if (a !== 'pause') e.preventDefault();
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYS[e.code];
      if (a) this.down.delete(a);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.virtualDown.clear();
      this.setStick(0, 0);
    });

    canvas.addEventListener('pointerdown', (e) => {
      this.notePointerType(e);
      this.setPointer(e);
      if (e.button !== 0 || this.firePointer !== null) return;
      this.firePointer = e.pointerId;
      this.pressed.add('fire');
      this.down.add('fire');
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.firePointer) return;
      this.firePointer = null;
      this.down.delete('fire');
      this.released.add('fire');
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.look.x += e.movementX;
        this.look.y += e.movementY;
      }
      if (e.pointerType === 'mouse' || e.pointerId === this.firePointer) this.setPointer(e);
    });
    canvas.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    window.addEventListener('touchstart', () => this.markTouch(), { passive: true, capture: true });
  }

  private notePointerType(e: PointerEvent) {
    if (e.pointerType === 'touch') this.markTouch();
  }

  private markTouch() {
    if (isTouchDevice) return;
    isTouchDevice = true;
    this.onTouchDetected?.();
  }

  private setPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  /** Mouse-look needs pointer lock on desktop; touch devices never lock. */
  lockPointer() {
    if (isTouchDevice || this.pointerLocked) return;
    const p = this.canvas.requestPointerLock?.() as Promise<void> | undefined;
    p?.catch?.(() => {});
  }

  unlockPointer() {
    if (this.pointerLocked) document.exitPointerLock();
  }

  // ---------- on-screen controls ----------

  /** Virtual joystick: x = right, y = forward, each -1..1. */
  setStick(x: number, y: number) {
    this.stick.x = x;
    this.stick.y = y;
  }

  /** Touch-drag camera look, in screen pixels. */
  addLook(dx: number, dy: number) {
    this.look.x += dx * TOUCH_LOOK_SCALE;
    this.look.y += dy * TOUCH_LOOK_SCALE;
  }

  /** A one-shot on-screen button press (jump, interact, map, pause). */
  tap(a: Action) {
    this.pressed.add(a);
  }

  /** An on-screen button that is held down. */
  hold(a: Action, isDown: boolean) {
    if (isDown && !this.virtualDown.has(a)) this.pressed.add(a);
    if (isDown) this.virtualDown.add(a);
    else this.virtualDown.delete(a);
  }

  /** Drop any held virtual input (e.g. when the controls are hidden mid-touch). */
  releaseVirtual() {
    this.virtualDown.clear();
    this.setStick(0, 0);
  }

  // ---------- queries ----------

  isDown(a: Action) {
    if (!this.enabled) return false;
    if (a === 'sprint' && Math.hypot(this.stick.x, this.stick.y) > STICK_SPRINT) return true;
    return this.down.has(a) || this.padDown.has(a) || this.virtualDown.has(a);
  }

  justPressed(a: Action) {
    return this.enabled && this.pressed.has(a);
  }

  /** The finger/button came up this frame (a quick tap reports both pressed and released). */
  justReleased(a: Action) {
    return this.enabled && this.released.has(a);
  }

  /** Movement vector from keys, virtual stick or left stick: x = right, y = forward. */
  move(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    let y = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);
    if (Math.hypot(this.stick.x, this.stick.y) > 0.12) {
      x = this.stick.x;
      y = this.stick.y;
    }
    const pad = this.gamepad();
    if (pad) {
      const [lx, ly] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
      if (Math.hypot(lx, ly) > 0.15) {
        x = lx;
        y = -ly;
      }
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  private gamepad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Poll the gamepad; call at the start of each frame. */
  beginFrame() {
    const pad = this.gamepad();
    if (!pad) return;
    for (const [action, idx] of Object.entries(PAD) as [Action, number][]) {
      const isDown = pad.buttons[idx]?.pressed ?? false;
      if (isDown && !this.padDown.has(action)) this.pressed.add(action);
      if (isDown) this.padDown.add(action);
      else this.padDown.delete(action);
    }
    const [rx, ry] = [pad.axes[2] ?? 0, pad.axes[3] ?? 0];
    if (Math.abs(rx) > 0.15) this.look.x += rx * 12;
    if (Math.abs(ry) > 0.15) this.look.y += ry * 8;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.look.x = 0;
    this.look.y = 0;
    this.wheel = 0;
  }
}
