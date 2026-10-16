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

// Standard gamepad mapping: A=0, X=2, LB=4, Back=8, Start=9.
const PAD: Partial<Record<Action, number>> = { jump: 0, interact: 2, sprint: 4, map: 8, pause: 9, fire: 7 };

/**
 * Maps keyboard / mouse / gamepad onto game actions.
 * Call `endFrame()` once per frame after all systems have read input.
 */
export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  private padDown = new Set<Action>();
  /** Mouse movement since last frame (pointer-locked) in pixels. */
  readonly look = { x: 0, y: 0 };
  /** Mouse position in normalised device coords (-1..1), for unlocked mini-games. */
  readonly pointer = { x: 0, y: 0 };
  wheel = 0;
  enabled = true;

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
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.pressed.add('fire');
        this.down.add('fire');
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.down.delete('fire');
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.look.x += e.movementX;
        this.look.y += e.movementY;
      }
      const r = canvas.getBoundingClientRect();
      this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    });
    canvas.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  lockPointer() {
    if (!this.pointerLocked) this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }

  unlockPointer() {
    if (this.pointerLocked) document.exitPointerLock();
  }

  isDown(a: Action) {
    return this.enabled && (this.down.has(a) || this.padDown.has(a));
  }

  justPressed(a: Action) {
    return this.enabled && this.pressed.has(a);
  }

  /** Movement vector from keys or left stick: x = right, y = forward. */
  move(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    let y = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);
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
    this.look.x = 0;
    this.look.y = 0;
    this.wheel = 0;
  }
}
