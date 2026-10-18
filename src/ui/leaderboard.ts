import { MINI_GAME_IDS } from '../minigames/MiniGame';
import { MINI_GAMES } from '../minigames/registry';
import { api, CHARACTER_NAMES, type LeaderRow } from '../net/api';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank));

/** Leaderboards (the passport's Leaderboard tab): ⭐ total stars & ornaments, then best score per mini-game. */
export function mountLeaderboard(root: HTMLElement) {
  const tabs = [{ id: 'stars', label: '⭐ Stars' }, ...MINI_GAME_IDS.map((id) => ({ id, label: MINI_GAMES[id].emoji }))];
  root.innerHTML = `<div class="leaders">
      <div class="tabs">${tabs.map((t, i) => `<button type="button" class="chip ${i ? '' : 'on'}" data-board="${t.id}" title="${t.id === 'stars' ? 'Stars & ornaments' : MINI_GAMES[t.id as keyof typeof MINI_GAMES].title}">${t.label}</button>`).join('')}</div>
      <p class="board-title small"></p>
      <div class="board"><p class="small muted">Loading…</p></div>
    </div>`;
  const body = root.querySelector<HTMLElement>('.board')!;
  const title = root.querySelector<HTMLElement>('.board-title')!;
  let token = 0;
  const load = async (board: string) => {
    root.querySelectorAll<HTMLElement>('[data-board]').forEach((b) => b.classList.toggle('on', b.dataset.board === board));
    title.textContent = board === 'stars' ? 'Most stars, then most ornaments' : `${MINI_GAMES[board as keyof typeof MINI_GAMES].title}: best score`;
    if (!api.online) {
      body.innerHTML = '<p class="small muted">Sign in to see the leaderboard and get your name on it.</p>';
      return;
    }
    const mine = ++token;
    body.innerHTML = '<p class="small muted">Loading…</p>';
    try {
      const { rows, me } = await api.leaderboard(board);
      if (mine !== token) return;
      body.innerHTML = rows.length ? table(board, rows, me) : '<p class="small muted">No scores yet. Be the first!</p>';
    } catch (e) {
      if (mine === token) body.innerHTML = `<p class="small muted">${esc((e as Error).message)}</p>`;
    }
  };
  root.querySelectorAll<HTMLButtonElement>('[data-board]').forEach((b) => b.addEventListener('click', () => void load(b.dataset.board!)));
  void load('stars');
}

function table(board: string, rows: LeaderRow[], me: LeaderRow | null): string {
  const myId = api.user?.id;
  const row = (r: LeaderRow) => {
    const value = board === 'stars' ? `⭐ ${r.value} <span class="muted">· 🟡 ${r.ornaments}</span>` : `${r.value} <span class="muted">${'★'.repeat(r.stars ?? 0)}</span>`;
    return `<tr class="${r.userId === myId ? 'me' : ''}"><td class="rank">${medal(r.rank)}</td><td class="who"><b>${esc(r.username)}</b><span class="muted"> · ${esc(CHARACTER_NAMES[r.characterId] ?? r.characterId)}</span></td><td class="val">${value}</td></tr>`;
  };
  const tail = me && !rows.some((r) => r.userId === me.userId) ? `<tr class="gap"><td colspan="3">⋯</td></tr>${row(me)}` : '';
  return `<table>${rows.map(row).join('')}${tail}</table>`;
}
