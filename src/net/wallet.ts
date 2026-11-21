/**
 * The signed-in player's fight tokens, as last told by the server (null for guests and offline).
 * The HUD chip, the weapon picker and the shop all read it and redraw when it changes.
 */
type Listener = (tokens: number | null) => void;
const listeners: Listener[] = [];

export const wallet = {
  tokens: null as number | null,
  /** Whether the server can take payments (PayHere is set up). */
  payments: false,
  set(n: number | null) {
    if (n === this.tokens) return;
    this.tokens = n;
    for (const fn of listeners) fn(n);
  },
  on(fn: Listener) {
    listeners.push(fn);
  },
};
