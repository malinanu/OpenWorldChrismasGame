import { audio } from '../core/Audio';
import { gameState } from '../game/GameState';
import { titleFor } from '../game/titles';
import { MINI_GAME_IDS, type MiniGameId } from '../minigames/MiniGame';
import { MINI_GAMES } from '../minigames/registry';
import { api, CHARACTER_NAMES } from '../net/api';
import { esc } from './account';
import { mountAvatarStage, type AvatarStage } from './avatar';
import { INK } from './ink';
import { fmtMonthYear, fmtNumber, type Lang } from '../i18n';
import { t } from '../i18n/ui';
import { mountLeaderboard } from './leaderboard';
import { mountSettings } from './settings';
import type { Quality } from '../core/Engine';
import type { Hud } from './hud';

/** What the player asked for from the passport; the caller runs it once the card has closed. */
export type ProfileNext = 'character' | 'signin' | 'signout' | null;
/** The passport's tabs: one place for your profile, the leaderboards and the settings. */
export type HubTab = 'passport' | 'leaders' | 'settings';

const SEEN_KEY = 'frostvale.passportStamps';

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
    const status = gameState.isDiscovered(id) ? t('stampDiscovered') : t('stampNotVisited');
    return `<div class="stamp empty"><span class="st-emoji">${info.emoji}</span><b>${info.title}</b><small>${status}</small></div>`;
  }
  // A slightly different tilt for each stamp, the same every time.
  const tilt = ((i * 37) % 17) - 8;
  const best = d.bestScore[id];
  return `<div class="stamp got${fresh ? ' fresh' : ''}" style="--ink:${INK[id]};--tilt:${tilt}deg;--delay:${fresh ? 0.35 + i * 0.28 : 0}s">
      <span class="st-ring"></span><span class="st-emoji">${info.emoji}</span><b>${info.title}</b>
      <span class="st-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>${best ? `<small>${t('stampBest', { n: fmtNumber(best) })}</small>` : ''}
    </div>`;
}

/**
 * The Frostvale Passport, the game's one menu, in three tabs:
 * - Passport: your Adventurer live in 3D, your festive title, a stamp for every mini-game
 *   you've won, your snowball record and rank. Renders instantly from local progress; server
 *   stats fill in when they arrive.
 * - Leaderboard: stars & ornaments, then best score per mini-game.
 * - Settings: graphics, day & night, sound.
 * The game is paused while it's open.
 */
export async function showProfile(hud: Hud, opts: { server: boolean; tab?: HubTab; onQuality: (q: Quality) => void; onLanguage: (l: Lang) => void }): Promise<ProfileNext> {
  const startTab = opts.tab ?? 'passport';
  const user = api.user;
  const stars = gameState.totalStars;
  const { title, next, progress } = titleFor(stars);
  const seen = seenStamps();
  const earned = MINI_GAME_IDS.filter((id) => gameState.hasOrnament(id));
  // New stamps thump in only when the passport is what you opened (not hidden behind another tab).
  const fresh = new Set(startTab === 'passport' ? earned.filter((id) => !seen.includes(id)) : []);
  const charId = user?.characterId ?? 'Rogue_Hooded';
  const since = user?.createdAt ? fmtMonthYear(new Date(user.createdAt)) : '';
  let result: ProfileNext = null;
  let stage: AvatarStage | null = null;
  const timers: number[] = [];

  const header = user
    ? `<h2 class="pp-name"></h2>
       <p class="pp-line">${CHARACTER_NAMES[charId] ?? charId}${since ? ` · ${t('resident', { date: since })}` : ''}</p>
       <p class="pp-line muted">${esc(masked(user.email, user.phone))}</p>
       <p class="pp-rank hidden"></p>`
    : `<h2 class="pp-name">${t('guestName')}</h2>
       <p class="pp-line">${t('guestLine')}</p>`;

  const actions = user
    ? `<button class="chip" data-act="character">${t('changeAdventurer')}</button>
       <button class="chip ghosty" data-signout>${t('signOut')}</button>`
    : opts.server
      ? `<button class="chip on" data-act="signin">${t('signInChip')}</button>`
      : '';

  await hud
    .showCard(
      `<div class="passport">
        <div class="pp-cover"><span class="pp-flake">❄</span> ${t('cover')} <span class="pp-flake">❄</span></div>
        <div class="hub-tabs" role="tablist">
          <button type="button" class="chip" data-tab="passport">${t('tabPassport')}</button>
          <button type="button" class="chip" data-tab="leaders">${t('tabLeaders')}</button>
          <button type="button" class="chip" data-tab="settings">${t('tabSettings')}</button>
        </div>
        <div class="hub-panes">
        <div class="hub-pane" data-pane="passport">
        <div class="pp-page">
          <div class="pp-head">
            <div class="pp-photo" title="${t('tapMe')}"><canvas width="132" height="150"></canvas></div>
            <div class="pp-who">${header}</div>
          </div>
          <div class="pp-title">
            <div class="pp-title-row"><span class="pp-badge">${title.icon} ${title.name}</span><span class="pp-stars">⭐ ${stars}/18</span></div>
            <div class="pp-bar"><i style="width:${Math.round(progress * 100)}%"></i></div>
            <p class="pp-next">${next ? t('toNext', { n: next.stars - stars, title: `${next.icon} ${next.name}` }) : t('allStars')}</p>
          </div>
          <h3 class="pp-sub">${t('stamps')} <span>${earned.length}/6</span></h3>
          <div class="stamps">${MINI_GAME_IDS.map((id, i) => stamp(id, i, fresh.has(id))).join('')}</div>
          ${
            user
              ? `<h3 class="pp-sub">${t('record')}</h3>
                 <div class="tickets">
                   <div class="ticket"><b data-stat="hits">–</b><small>${t('hits')}</small></div>
                   <div class="ticket"><b data-stat="taken">–</b><small>${t('splatted')}</small></div>
                   <div class="ticket"><b data-stat="ratio">–</b><small>${t('ratio')}</small></div>
                 </div>`
              : `<div class="pp-invite">${opts.server ? t('inviteServer') : t('inviteOffline')}</div>`
          }
        </div>
        ${actions ? `<div class="row pp-actions">${actions}</div>` : ''}
        </div>
        <div class="hub-pane fill" data-pane="leaders"><div class="pp-page pane-page"></div></div>
        <div class="hub-pane fill" data-pane="settings"><div class="pp-page pane-page"></div></div>
        </div>
        <div class="row"><button data-ok>${t('close')}</button></div>
      </div>`,
      (card) => {
        if (user) card.querySelector('.pp-name')!.textContent = user.username ?? t('adventurer');
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
            out.textContent = t('signOutConfirm');
          }
        });

        // Tabs. All three panes are stacked in one grid cell, so the card keeps the passport's
        // size whichever tab is showing; Leaders and Settings fill it and scroll inside.
        const photo = card.querySelector<HTMLElement>('.pp-photo')!;
        mountLeaderboard(card.querySelector<HTMLElement>('[data-pane=leaders] .pane-page')!);
        mountSettings(card.querySelector<HTMLElement>('[data-pane=settings] .pane-page')!, { onQuality: opts.onQuality, onLanguage: opts.onLanguage });
        const showTab = (tab: HubTab) => {
          card.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
          card.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => p.classList.toggle('off', p.dataset.pane !== tab));
          // Live portrait (idle, turning slowly; tap it for a cheer), started once the passport shows.
          if (tab === 'passport' && !stage) {
            stage = mountAvatarStage(photo.querySelector('canvas')!, { spin: 0.35, stand: false });
            void stage.show(charId);
          }
        };
        card.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab as HubTab)));
        photo.addEventListener('click', () => stage?.play('Cheering'));
        showTab(startTab);

        // New stamps thump down one after another.
        [...fresh].forEach((_, i) => timers.push(window.setTimeout(() => audio.sfx('step', 0.8), (0.35 + i * 0.28) * 1000 + 180)));
        if (startTab === 'passport') rememberStamps(earned);

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
            el.textContent = `${me.rank <= 3 ? ['🥇', '🥈', '🥉'][me.rank - 1] : '🏅'} ${t('rank', { rank: me.rank })}`;
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
