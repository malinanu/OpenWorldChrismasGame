import type { MiniGameId, MiniGameInfo } from './MiniGame';
import { SnowballShowdown, THRESHOLDS as SNOWBALL_THRESHOLDS } from './snowball-showdown/SnowballShowdown';

export const MINI_GAMES: Record<MiniGameId, MiniGameInfo> = {
  'snowball-showdown': {
    id: 'snowball-showdown',
    title: 'Snowball Showdown',
    emoji: '❄️',
    blurb: 'Snowmen are popping up all over the frozen lake. Knock them down before time runs out! Golden snowmen are worth 3 — but don\'t hit the presents.',
    controls: 'Mouse to aim · Click to throw · Esc to quit',
    thresholds: SNOWBALL_THRESHOLDS,
    create: (ctx) => new SnowballShowdown(ctx),
  },
  'gingerbread-bakery': {
    id: 'gingerbread-bakery',
    title: 'Gingerbread Bakery Rush',
    emoji: '🍪',
    blurb: 'Bake cookies, pour hot chocolate and serve the queue before the orders melt away.',
    controls: 'Click stations to cook and serve',
    thresholds: [4, 8, 12],
  },
  'santas-express': {
    id: 'santas-express',
    title: "Santa's Express",
    emoji: '🚂',
    blurb: 'Flip the switches so the toy train delivers every present to the right chimney.',
    controls: 'Click tracks to rotate · Space to send the train',
    thresholds: [1, 3, 5],
  },
  'elf-workshop': {
    id: 'elf-workshop',
    title: 'Elf Workshop',
    emoji: '🔨',
    blurb: 'Memorise the blueprint, pick the right materials and build the toy before the shift bell.',
    controls: 'Click materials and tools',
    thresholds: [3, 6, 9],
  },
  'krampus-cellar': {
    id: 'krampus-cellar',
    title: "Krampus' Cellar",
    emoji: '🕯️',
    blurb: 'Sneak through the cellar, dodge the lantern light and rescue the stolen presents.',
    controls: 'WASD to sneak · E to open chests',
    thresholds: [3, 6, 9],
  },
  'advent-dice-race': {
    id: 'advent-dice-race',
    title: 'Advent Dice Race',
    emoji: '🎲',
    blurb: 'Race three cheeky elves along the 24-door advent track.',
    controls: 'Space / click to roll',
    thresholds: [1, 2, 3],
  },
};
