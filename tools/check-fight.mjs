// The fight tables live in three places: the server (which decides every hit), the game client
// (offline practice, before the server's tables arrive) and the world layout (where the arenas
// are built). This checks they agree. Run: npm run check-fight
import { readFileSync } from 'node:fs';
import * as server from '../server/src/arena.ts';
import * as client from '../src/fight/weapons.ts';

const world = JSON.parse(readFileSync('public/world/frostvale.json', 'utf8'));
let problems = 0;
const same = (what, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.log(`${what} differ:\n  server/world: ${JSON.stringify(a)}\n  client:       ${JSON.stringify(b)}`);
    problems++;
  }
};
same('weapons', server.WEAPONS, client.WEAPONS);
same('arenas (server vs client)', server.ARENAS, client.ARENAS);
same('arenas (world vs client)', world.arenas, client.ARENAS);
same('numbers', [server.MAX_HP, server.KO_TIME, server.FIGHT_COST, server.PREMIUM_EXTRA, server.LIVES], [client.MAX_HP, client.KO_TIME, client.FIGHT_COST, client.PREMIUM_EXTRA, client.LIVES]);
for (const w of client.WEAPONS) if (!client.LOOKS[w.id]) (console.log(`no look (model, clips) for weapon ${w.id}`), problems++);
for (const a of client.ARENAS) {
  const flat = world.flats.find((f) => Math.hypot(f.x - a.x, f.z - a.z) < 1);
  if (!flat || flat.r < a.r + 3) (console.log(`arena ${a.id} needs a level ground circle (flats) of radius ≥ ${a.r + 3}`), problems++);
}
console.log(problems ? `${problems} problem(s)` : `fight tables OK: ${client.WEAPONS.length} weapons, ${client.ARENAS.length} arenas`);
process.exit(problems ? 1 : 0);
