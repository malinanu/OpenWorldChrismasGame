import { gameState } from '../game/GameState';
import type { Overworld } from '../game/Overworld';
import { MINI_GAME_IDS, type MiniGameId } from '../minigames/MiniGame';
import type { Hud } from '../ui/hud';
import { chooseCharacter, chooseUsername, signIn } from '../ui/account';
import { t } from '../i18n/ui';
import { lang } from '../i18n';
import { api, type ServerConfig } from './api';

const OFFLINE_KEY = 'frostvale.offline';
const PICKED_KEY = 'frostvale.characterPicked';

const store = (s: Storage, k: string, v?: string) => {
  try {
    if (v === undefined) return s.getItem(k);
    if (v === '') s.removeItem(k);
    else s.setItem(k, v);
  } catch {
    /* storage blocked */
  }
  return null;
};

/** The server's settings once connected (null = no server, the game runs offline). */
export let serverConfig: ServerConfig | null = null;

/**
 * After the title: restore or create an account, pick a username and character, and merge
 * progress both ways. Resolves true when signed in; false to play offline (no server, or the
 * player chose to).
 */
export async function startSession(hud: Hud, overworld: Overworld): Promise<boolean> {
  serverConfig = await api.config();
  if (!serverConfig) {
    hud.toast(t('offline'), 4000);
    return false;
  }
  let me = await api.me();
  let fresh = false;
  if (!me) {
    if (store(sessionStorage, OFFLINE_KEY) === '1') return false;
    const r = await signIn(hud, serverConfig);
    if (r === 'offline') {
      store(sessionStorage, OFFLINE_KEY, '1');
      return false;
    }
    fresh = true;
    me = await api.me();
    if (!me) return false;
  }
  let user = me.user;
  if (!user.username) user = await chooseUsername(hud);
  // First time on this device for this account: let them pick an Adventurer.
  if (fresh && store(localStorage, `${PICKED_KEY}.${user.id}`) !== '1') {
    const id = await chooseCharacter(hud, serverConfig.characters, user.characterId);
    if (id !== user.characterId) user = await api.updateMe({ characterId: id });
    store(localStorage, `${PICKED_KEY}.${user.id}`, '1');
  }
  // The language chosen on this device is the player's latest choice: keep the account in step.
  if (user.language !== lang()) void api.updateMe({ language: lang() }).catch(() => {});
  await overworld.player.setCharacter(user.characterId);
  refreshBadge(hud);
  await syncProgress(me.progress);
  hud.renderTracker();
  overworld.refreshOrnaments();
  hud.toast(t('welcome', { name: user.username ?? '' }));
  return true;
}

/** Uploads local bests and adopts the server's: both sides end with the max of each. */
async function syncProgress(server: Record<string, { score: number; stars: number }>) {
  const local: Record<string, { score: number }> = {};
  for (const id of MINI_GAME_IDS) {
    const score = gameState.data.bestScore[id];
    if (score) local[id] = { score };
  }
  const merged = (Object.keys(local).length ? await api.saveProgress(local) : null) ?? server;
  const d = gameState.data;
  for (const [id, p] of Object.entries(merged) as [MiniGameId, { score: number; stars: number }][]) {
    d.bestScore[id] = Math.max(d.bestScore[id] ?? 0, p.score);
    d.bestStars[id] = Math.max(d.bestStars[id] ?? 0, p.stars);
    if (p.stars >= 1) d.ornaments[id] = true;
  }
  gameState.save();
}

/** Change character from the pause menu. */
export async function changeCharacter(hud: Hud, overworld: Overworld) {
  if (!api.user || !serverConfig) return;
  const id = await chooseCharacter(hud, serverConfig.characters, api.user.characterId);
  if (id !== api.user.characterId) await api.updateMe({ characterId: id });
  await overworld.player.setCharacter(id);
  refreshBadge(hud);
}

/** The top-right badge follows the signed-in player (or shows a guest). */
export function refreshBadge(hud: Hud) {
  const u = api.user;
  hud.setProfile(u ? { name: u.username ?? t('adventurer'), charId: u.characterId } : null);
}

export async function signOut() {
  await api.logout();
  store(sessionStorage, OFFLINE_KEY, '');
  location.reload();
}

/** From the pause menu while offline: forget "play offline" for this visit and show sign-in. */
export function signInAgain() {
  store(sessionStorage, OFFLINE_KEY, '');
  location.reload();
}
