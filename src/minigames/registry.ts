import type { MiniGameId, MiniGameInfo } from './MiniGame';

export const MINI_GAMES: Record<MiniGameId, MiniGameInfo> = {
  'snowball-showdown': {
    id: 'snowball-showdown',
    title: 'Snowball Showdown',
    emoji: '❄️',
    blurb: 'Snowmen keep popping up on the frozen lake. Knock over as many as you can in 60 seconds!',
    howTo: [
      ['👆 Drag to aim: the crosshair floats above your finger. Lift to throw', '🖱️ Aim with the mouse, click to throw'],
      '⛄ Snowman = 1 point · 🟡 golden snowman = 3',
      '🎁 Don\'t hit the presents (−2)',
    ],
    thresholds: [10, 20, 30],
    create: async (ctx) => new (await import('./snowball-showdown/SnowballShowdown')).SnowballShowdown(ctx),
  },
  // Same id as the old bakery so saves and the village zone carry over.
  'gingerbread-bakery': {
    id: 'gingerbread-bakery',
    title: 'Cookie Catch',
    emoji: '🍪',
    blurb: 'The bakery chimney is raining treats! Catch them in your bowl for 60 seconds.',
    howTo: [
      ['👆 Drag anywhere to move the bowl', '🖱️ Hold the mouse and move, or use ← →'],
      '🍪 🍬 +1 · 🧑‍🎄 +2 · 🎁 +3',
      '⚫ Dodge the coal (−2)',
      '✨ A golden cookie pulls everything into your bowl',
    ],
    thresholds: [15, 35, 55],
    create: async (ctx) => new (await import('./cookie-catch/CookieCatch')).CookieCatch(ctx),
  },
  'santas-express': {
    id: 'santas-express',
    title: "Santa's Express",
    emoji: '🚂',
    blurb: 'Five little rail yards. Get every present to the house of its colour.',
    howTo: [
      ['👆 Tap a glowing track piece to turn it', '🖱️ Click a glowing track piece to turn it'],
      '🎁 The present on the train shows which house it\'s for',
      ['🚂 Tap Go! to send the train', '🚂 Press Space or Go! to send the train'],
      '⭐ Fewer turns and no crashes = more stars',
    ],
    thresholds: [5, 10, 14],
    create: async (ctx) => new (await import('./santas-express/SantasExpress')).SantasExpress(ctx),
  },
  'elf-workshop': {
    id: 'elf-workshop',
    title: 'Elf Workshop',
    emoji: '🔨',
    blurb: 'Build nine toys before the shift bell rings.',
    howTo: [
      '👀 A blueprint shows the parts for a toy — remember them!',
      ['👆 Tap those parts on the bench', '🖱️ Click those parts on the bench'],
      '🔨 Press Build — tap a part in the tray to take it back',
    ],
    thresholds: [3, 6, 9],
    create: async (ctx) => new (await import('./elf-workshop/ElfWorkshop')).ElfWorkshop(ctx),
  },
  'krampus-cellar': {
    id: 'krampus-cellar',
    title: "Krampus' Cellar",
    emoji: '🕯️',
    blurb: 'Sneak in, grab the 4 stolen presents and escape up the stairs.',
    howTo: [
      ['👆 Tap a floor tile to walk there', '🖱️ Click a floor tile, or use WASD'],
      '✨ Follow the glowing dots to the next chest',
      '🟥 Red tiles are lantern light — wait until they move away',
      '🪜 Then head for the stairs',
    ],
    thresholds: [2, 4, 6],
    create: async (ctx) => new (await import('./krampus-cellar/KrampusCellar')).KrampusCellar(ctx),
  },
  'advent-dice-race': {
    id: 'advent-dice-race',
    title: 'Advent Dice Race',
    emoji: '🎲',
    blurb: 'Race three cheeky elves round the 24-door advent board.',
    howTo: [
      ['🎲 Tap Roll on your turn', '🎲 Press Space or Roll on your turn'],
      '🎁 +2 steps · 🍬 roll again · ❄️ miss a turn',
      '🏁 First to door 23 wins',
    ],
    thresholds: [1, 2, 3],
    create: async (ctx) => new (await import('./advent-dice-race/AdventDiceRace')).AdventDiceRace(ctx),
  },
};
