// Verifies every Santa's Express level is solvable and prints its par (fewest clicks).
// Usage: npm run check-levels
import { LEVELS } from '../src/minigames/santas-express/levels.ts';
import { parseLevel, solve, traceRoute } from '../src/minigames/santas-express/logic.ts';

let ok = true;
for (const def of LEVELS) {
  const level = parseLevel(def);
  const par = solve(level);
  const start = traceRoute(level).outcome;
  const startText = start.type === 'house' ? `already reaches ${start.colour}` : start.type;
  console.log(`${def.name.padEnd(22)} ${level.w}x${level.h}  presents=${def.presents.join(',').padEnd(24)} par=${par ?? 'UNSOLVABLE'}  start: ${startText}`);
  if (par === null) ok = false;
}
process.exit(ok ? 0 : 1);
