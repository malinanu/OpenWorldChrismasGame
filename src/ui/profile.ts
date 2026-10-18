import { audio } from '../core/Audio';
import { gameState } from '../game/GameState';
import { titleFor } from '../game/titles';
import { MINI_GAME_IDS, type MiniGameId } from '../minigames/MiniGame';
import { MINI_GAMES } from '../minigames/registry';
import { api, CHARACTER_NAMES } from '../net/api';
import { esc } from './account';
import { mountAvatarStage, type AvatarStage } from './avatar';
import type { Hud } from './hud';

/** What the player asked for from the passport; the caller runs it once the card has closed. */
export type ProfileNext = 'character' | 'leaders' | 'signin' | 'signout' | null;

const SEEN_KEY = 'frostvale.passportStamps';
/** Each mini-game's stamp ink. */
const INK: Record<MiniGameId, string> = {
  'snowball-showdown': '#2f6fd6',
  'gingerbread-bakery': '#b5651d',
  'santas-express': '#c62f3a',
  'elf-workshop': '#2e8b57',
  'krampus-cellar': '#6b3fa0',
  'advent-dice-race': '#d4881a',
};

function seenStamps(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function rememberStamps(ids: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    /* storage blocked */
  }
}

/** "s•••y@example.com" / "+94 •• ••• 4567": enough to recognise, not enough to copy. */
function masked(email: string | null, phone: string | null) {
  if (email) {
    const [u, d] = email.split('@');
    return `${u[0]}•••${u.length > 1 ? u[u.length - 1] : ''}@${d}`;
  }
  if (phone) return `${phone.slice(0, 3)} •• ••• ${phone.slice(-4)}`;
  return '';
}

function stamp(id: MiniGameId, i: number, fresh: boolean) {
  const info = MINI_GAMES[id];
  const d = gameState.data;
  const got = gameState.hasOrnament(id);
  const stars = d.bestStars[id] ?? 0;
  if (!got) {
    const status = gameState.isDiscovered(id) ? 'Discovered' : 'Not visited';
    return `<div class="stamp empty"><span class="st-emoji">${info.emoji}</span><b>${info.title}</b><small>${status}</small></div>`;
  }
  // A slightly different tilt for each stamp, the same every time.
  const tilt = ((i * 37) % 17) - 8;
  const best = d.bestScore[id];
  return `<div class="stamp got${fresh ? ' fresh' : ''}" style="--ink:${INK[id]};--tilt:${tilt}deg;--delay:${fresh ? 0.35 + i * 0.28 : 0}s">
      <span class="st-ring"></span><span class="st-emoji">${info.emoji}</span><b>${info.title}</b>
      <span class="st-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>${best ? `<small>Best ${best.toLocaleString()}</small>` : ''}
    </div>`;
}

/**
 * The Frostvale Passport: your Adventurer live in 3D, your festive title, a stamp for every
 * mini-game you've won, your snowball record and rank. Renders instantly from local progress;
 * server stats fill in when they arrive.
 */
export async function showProfile(hud: Hud, online: { server: boolean }): Promise<ProfileNext> {
  const user = api.user;
  const stars = gameState.totalStars;
  const { title, next, progress } = titleFor(stars);
  const seen = seenStamps();
  const earned = MINI_GAME_IDS.filter((id) => gameState.hasOrnament(id));
  const fresh = new Set(earned.filter((id) => !seen.includes(id)));
  const charId = user?.characterId ?? 'Rogue_Hooded';
  const since = user?.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '';
  let result: ProfileNext = null;
  let stage: AvatarStage | null = null;
  const timers: number[] = [];

  const header = user
    ? `<h2 class="pp-name"></h2>
       <p class="pp-line">${CHARACTER_NAMES[charId] ?? charId}${since ? ` · Resident since ${since}` : ''}</p>
       <p class="pp-line muted">${esc(masked(user.email, user.phone))}</p>
       <p class="pp-rank hidden"></p>`
    : `<h2 class="pp-name">Guest traveller</h2>
       <p class="pp-line">Your progress lives on this device only.</p>`;

  const actions = user
    ? `<button class="chip" data-act="character">🎭 Change adventurer</button>
       <button class="chip" data-act="leaders">🏆 Leaderboard</button>
       <button class="chip ghosty" data-signout>Sign out</button>`
    : online.server
      ? `<button class="chip on" data-act="signin">✨ Sign in</button>`
      : '';

  await hud
    .showCard(
      `<div class="passport">
        <div class="pp-cover"><span class="pp-flake">❄</span> FROSTVALE PASSPORT <span class="pp-flake">❄</span></div>
        <div class="pp-page">
          <div class="pp-head">
            <div class="pp-photo" title="Tap me!"><canvas width="132" height="150"></canvas></div>
            <div class="pp-who">${header}</div>
          </div>
          <div class="pp-title">
            <div class="pp-title-row"><span class="pp-badge">${title.icon} ${title.name}</span><span class="pp-stars">⭐ ${stars}/18</span></div>
            <div class="pp-bar"><i style="width:${Math.round(progress * 100)}%"></i></div>
            <p class="pp-next">${next ? `${next.stars - stars} ⭐ to <b>${next.icon} ${next.name}</b>` : 'Every star in Frostvale is yours. 🎄'}</p>
          </div>
          <h3 class="pp-sub">Stamps <span>${earned.length}/6</span></h3>
          <div class="stamps">${MINI_GAME_IDS.map((id, i) => stamp(id, i, fresh.has(id))).join('')}</div>
          ${
            user
              ? `<h3 class="pp-sub">Snowball record</h3>
                 <div class="tickets">
                   <div class="ticket"><b data-stat="hits">–</b><small>Hits</small></div>
                   <div class="ticket"><b data-stat="taken">–</b><small>Splatted</small></div>
                   <div class="ticket"><b data-stat="ratio">–</b><small>Hits per splat</small></div>
                 </div>`
              : `<div class="pp-invite">${online.server ? 'Sign in to keep your passport safe, play with friends and get on the leaderboard.' : 'Online play is unavailable right now. Your stamps are saved on this device.'}</div>`
          }
        </div>
        <div class="row pp-actions">${actions}</div>
        <div class="row"><button data-ok>Close</button></div>
      </div>`,
      (card) => {
        if (user) card.querySelector('.pp-name')!.textContent = user.username ?? 'Adventurer';
        const close = () => card.querySelector<HTMLButtonElement>('[data-ok]')!.click();
        card.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
          b.addEventListener('click', () => {
            result = b.dataset.act as ProfileNext;
            close();
          }),
        );
        // Two taps to sign out, so a stray tap doesn't log you out.
        const out = card.querySelector<HTMLButtonElement>('[data-signout]');
        out?.addEventListener('click', () => {
          if (out.dataset.armed) {
            result = 'signout';
            close();
          } else {
            out.dataset.armed = '1';
            out.textContent = 'Tap again to sign out';
          }
        });

        // Live portrait: idle and turning slowly; tap it for a cheer.
        const photo = card.querySelector<HTMLElement>('.pp-photo')!;
        stage = mountAvatarStage(photo.querySelector('canvas')!, { spin: 0.35, stand: false });
        void stage.show(charId);
        photo.addEventListener('click', () => stage?.play('Cheering'));

        // New stamps thump down one after another.
        [...fresh].forEach((_, i) => timers.push(window.setTimeout(() => audio.sfx('step', 0.8), (0.35 + i * 0.28) * 1000 + 180)));
        rememberStamps(earned);

        if (!user) return;
        // The card element is reused; this passport is still showing while its root is attached.
        const root = card.querySelector<HTMLElement>('.passport')!;
        void api.me().then((me) => {
          if (!me || !root.isConnected) return;
          const { snowballHits: h, snowballTaken: t } = me.stats;
          card.querySelector('[data-stat=hits]')!.textContent = String(h);
          card.querySelector('[data-stat=taken]')!.textContent = String(t);
          card.querySelector('[data-stat=ratio]')!.textContent = h + t === 0 ? '–' : t === 0 ? `${h}` : (h / t).toFixed(1);
        });
        void api
          .leaderboard('stars')
          .then(({ me }) => {
            const el = card.querySelector<HTMLElement>('.pp-rank');
            if (!me || !el || !root.isConnected) return;
            el.textContent = `${me.rank <= 3 ? ['🥇', '🥈', '🥉'][me.rank - 1] : '🏅'} #${me.rank} in Frostvale`;
            el.classList.remove('hidden');
          })
          .catch(() => {});
      },
    )
    .catch(() => {});
  timers.forEach(clearTimeout);
  (stage as AvatarStage | null)?.dispose();
  return result;
}
