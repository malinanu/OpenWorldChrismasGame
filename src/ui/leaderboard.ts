import { MINI_GAME_IDS, type MiniGameId } from '../minigames/MiniGame';
import { MINI_GAMES } from '../minigames/registry';
import { api, CHARACTER_NAMES, type LeaderRow } from '../net/api';
import { portrait } from './avatar';
import { INK } from './ink';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const medal = (rank: number) => (rank <= 3 ? `<span class="lb-medal">${['🥇', '🥈', '🥉'][rank - 1]}</span>` : `<i>${rank}</i>`);
const note = (html: string) => `<div class="pp-invite">${html}</div>`;

/**
 * The passport's Leaders tab, a "Hall of Fame" ledger on the passport paper: ⭐ total stars &
 * ornaments, then best score per mini-game (picked with stamp-like chips in each game's ink).
 */
export function mountLeaderboard(root: HTMLElement) {
  const boards = [{ id: 'stars', label: '⭐', ink: '#d9a520', name: 'Stars & ornaments' }, ...MINI_GAME_IDS.map((id) => ({ id, label: MINI_GAMES[id].emoji, ink: INK[id], name: MINI_GAMES[id].title }))];
  root.innerHTML = `<h3 class="pp-sub">Hall of Fame <span class="lb-count"></span></h3>
    <div class="lb-boards">${boards.map((b) => `<button type="button" class="lb-chip" data-board="${b.id}" style="--ink:${b.ink}" title="${b.name}" aria-label="${b.name}">${b.label}</button>`).join('')}</div>
    <p class="lb-title"></p>
    <div class="lb-list"></div>`;
  const list = root.querySelector<HTMLElement>('.lb-list')!;
  const title = root.querySelector<HTMLElement>('.lb-title')!;
  const count = root.querySelector<HTMLElement>('.lb-count')!;
  let token = 0;
  const load = async (board: string) => {
    root.querySelectorAll<HTMLElement>('[data-board]').forEach((b) => b.classList.toggle('on', b.dataset.board === board));
    title.textContent = board === 'stars' ? 'Most stars, then most ornaments' : `${MINI_GAMES[board as MiniGameId].title} · best score`;
    count.textContent = '';
    if (!api.online) {
      list.innerHTML = note('Sign in to see the leaderboard and get your name in it.');
      return;
    }
    const mine = ++token;
    list.innerHTML = '<p class="lb-wait">Turning the pages…</p>';
    try {
      const { rows, me } = await api.leaderboard(board);
      if (mine !== token) return;
      count.textContent = me ? `You: #${me.rank}` : '';
      list.innerHTML = rows.length ? ledger(board, rows, me) : note('No scores yet. Be the first name in the book!');
      // Little portraits beside each name, filled in as they're ready (cached per character).
      list.querySelectorAll<HTMLImageElement>('img[data-char]').forEach((img) =>
        void portrait(img.dataset.char!).then((url) => {
          if (!url) return;
          img.src = url;
          img.hidden = false;
        }),
      );
    } catch (e) {
      if (mine === token) list.innerHTML = note(esc((e as Error).message));
    }
  };
  root.querySelectorAll<HTMLButtonElement>('[data-board]').forEach((b) => b.addEventListener('click', () => void load(b.dataset.board!)));
  void load('stars');
}

function ledger(board: string, rows: LeaderRow[], me: LeaderRow | null): string {
  const myId = api.user?.id;
  const row = (r: LeaderRow) => {
    const value = board === 'stars' ? `⭐ ${r.value} <small>· 🟡 ${r.ornaments}</small>` : `${r.value.toLocaleString()} <small>${'★'.repeat(r.stars ?? 0)}</small>`;
    return `<div class="lb-row${r.userId === myId ? ' me' : ''}">
        <span class="lb-rank">${medal(r.rank)}</span>
        <span class="lb-ava"><img alt="" hidden data-char="${esc(r.characterId)}"></span>
        <span class="lb-who"><b>${esc(r.username)}</b><small>${esc(CHARACTER_NAMES[r.characterId] ?? r.characterId)}</small></span>
        <span class="lb-val">${value}</span>
      </div>`;
  };
  const tail = me && !rows.some((r) => r.userId === me.userId) ? `<div class="lb-gap">⋯</div>${row(me)}` : '';
  return rows.map(row).join('') + tail;
}
