import { list, type Lang } from '../i18n';
import type { MiniGameId, MiniGameInfo } from './MiniGame';

type Text = { title: string; blurb: string; howTo: (string | [string, string])[] };

/**
 * Each mini-game's name, blurb and how-to steps in English, Sinhala and Tamil.
 * How-to steps that differ by device are [touch, mouse] pairs.
 */
const TEXT: Record<Lang, Record<MiniGameId, Text>> = {
  en: {
    'snowball-showdown': {
      title: 'Snowball Showdown',
      blurb: 'Snowmen keep popping up on the frozen lake. Knock over as many as you can in 60 seconds!',
      howTo: [
        ['👆 Drag to aim: the crosshair floats above your finger. Lift to throw', '🖱️ Aim with the mouse, click to throw'],
        '⛄ Snowman = 1 point · 🟡 golden snowman = 3',
        "🎁 Don't hit the presents (−2)",
      ],
    },
    'gingerbread-bakery': {
      title: 'Cookie Catch',
      blurb: 'The bakery chimney is raining treats! Catch them in your bowl for 60 seconds.',
      howTo: [
        ['👆 Drag anywhere to move the bowl', '🖱️ Hold the mouse and move, or use ← →'],
        '🍪 🍬 +1 · 🧑‍🎄 +2 · 🎁 +3',
        '⚫ Dodge the coal (−2)',
        '✨ A golden cookie pulls everything into your bowl',
      ],
    },
    'santas-express': {
      title: "Santa's Express",
      blurb: 'Five little rail yards. Get every present to the house of its colour.',
      howTo: [
        ['👆 Tap a glowing track piece to turn it', '🖱️ Click a glowing track piece to turn it'],
        "🎁 The present on the train shows which house it's for",
        ['🚂 Tap Go! to send the train', '🚂 Press Space or Go! to send the train'],
        '⭐ Fewer turns and no crashes = more stars',
      ],
    },
    'elf-workshop': {
      title: 'Elf Workshop',
      blurb: 'Build nine toys before the shift bell rings.',
      howTo: [
        '👀 A blueprint shows the parts for a toy — remember them!',
        ['👆 Tap those parts on the bench', '🖱️ Click those parts on the bench'],
        '🔨 Press Build — tap a part in the tray to take it back',
      ],
    },
    'krampus-cellar': {
      title: "Krampus' Cellar",
      blurb: 'Sneak in, grab the 4 stolen presents and escape up the stairs.',
      howTo: [
        ['👆 Tap a floor tile to walk there', '🖱️ Click a floor tile, or use WASD'],
        '✨ Follow the glowing dots to the next chest',
        '🟥 Red tiles are lantern light — wait until they move away',
        '🪜 Then head for the stairs',
      ],
    },
    'advent-dice-race': {
      title: 'Advent Dice Race',
      blurb: 'Race three cheeky elves round the 24-door advent board.',
      howTo: [['🎲 Tap Roll on your turn', '🎲 Press Space or Roll on your turn'], '🎁 +2 steps · 🍬 roll again · ❄️ miss a turn', '🏁 First to door 23 wins'],
    },
  },
  si: {
    'snowball-showdown': {
      title: 'හිම බෝල සටන',
      blurb: 'ශීත වූ විලේ හිම මිනිසුන් මතු වෙනවා. තත්පර 60ක් ඇතුළත පුළුවන් තරම් හිම මිනිසුන් පෙරළන්න!',
      howTo: [
        ['👆 ඉලක්ක කිරීමට ඇදගෙන යන්න: ඉලක්ක ලකුණ ඔබේ ඇඟිල්ලට උඩින් පෙනේ. විසි කිරීමට ඇඟිල්ල ඔසවන්න', '🖱️ මූසිකයෙන් ඉලක්ක කර, විසි කිරීමට ක්ලික් කරන්න'],
        '⛄ හිම මිනිසා = ලකුණු 1 · 🟡 රන් හිම මිනිසා = 3',
        '🎁 තෑගිවලට වදින්න එපා (−2)',
      ],
    },
    'gingerbread-bakery': {
      title: 'කුකී අල්ලමු',
      blurb: 'බේකරියේ චිමිනියෙන් රසකැවිලි වැටෙනවා! තත්පර 60ක් ඒවා ඔබේ බඳුනට අල්ලන්න.',
      howTo: [
        ['👆 බඳුන ගෙන යාමට ඕනෑම තැනක ඇදගෙන යන්න', '🖱️ මූසිකය තදකර ගෙන යන්න, නැත්නම් ← → භාවිතා කරන්න'],
        '🍪 🍬 +1 · 🧑‍🎄 +2 · 🎁 +3',
        '⚫ අඟුරුවලින් බේරෙන්න (−2)',
        '✨ රන් කුකියක් හැම දෙයක්ම ඔබේ බඳුනට ඇදලා ගන්නවා',
      ],
    },
    'santas-express': {
      title: 'සැන්ටාගේ එක්ස්ප්‍රස්',
      blurb: 'පුංචි දුම්රිය අංගන පහක්. හැම තෑග්ගක්ම එකම පාටින් තියෙන ගෙදරට ගෙනියන්න.',
      howTo: [
        ['👆 දිලිසෙන රේල් කොටසක් කරකැවීමට එය තට්ටු කරන්න', '🖱️ දිලිසෙන රේල් කොටසක් කරකැවීමට එය ක්ලික් කරන්න'],
        '🎁 දුම්රියේ තියෙන තෑග්ගෙන් පෙන්වන්නේ එය යන්න ඕන ගෙදර',
        ['🚂 දුම්රිය යැවීමට යමු! තට්ටු කරන්න', '🚂 දුම්රිය යැවීමට Space හෝ යමු! ඔබන්න'],
        '⭐ අඩු කරකැවීම් සහ අනතුරු නැතිනම් = තරු වැඩියි',
      ],
    },
    'elf-workshop': {
      title: 'එල්ෆ් වැඩපොළ',
      blurb: 'වැඩ මුර සීනුව නාද වෙන්න කලින් සෙල්ලම් බඩු නවයක් හදන්න.',
      howTo: [
        '👀 සැලැස්මකින් සෙල්ලම් බඩුවක කොටස් පෙන්වනවා — ඒවා මතක තියාගන්න!',
        ['👆 මේසය මත ඒ කොටස් තට්ටු කරන්න', '🖱️ මේසය මත ඒ කොටස් ක්ලික් කරන්න'],
        '🔨 හදන්න ඔබන්න — ආපසු ගන්න තැටියේ කොටසක් තට්ටු කරන්න',
      ],
    },
    'krampus-cellar': {
      title: 'ක්‍රැම්පස්ගේ බිම් මාළිගය',
      blurb: 'හොරෙන් ඇතුළු වෙලා, සොරකම් කළ තෑගි 4 අරගෙන පඩිපෙළ දිගේ පැනලා යන්න.',
      howTo: [
        ['👆 ඇවිදින්න බිම් ටයිලයක් තට්ටු කරන්න', '🖱️ බිම් ටයිලයක් ක්ලික් කරන්න, නැත්නම් WASD භාවිතා කරන්න'],
        '✨ ඊළඟ පෙට්ටියට දිලිසෙන තිත් අනුගමනය කරන්න',
        '🟥 රතු ටයිල් පහන් එළියයි — ඒවා ඉවත් වෙනකම් ඉන්න',
        '🪜 ඊට පස්සේ පඩිපෙළ දෙසට යන්න',
      ],
    },
    'advent-dice-race': {
      title: 'ඇඩ්වෙන්ට් දාදු තරඟය',
      blurb: 'දොරටු 24ක ඇඩ්වෙන්ට් පුවරුව වටේ දඟකාර එල්ෆ්ලා තුන්දෙනෙක් එක්ක තරඟ කරන්න.',
      howTo: [['🎲 ඔබේ වාරයේදී දමන්න තට්ටු කරන්න', '🎲 ඔබේ වාරයේදී Space හෝ දමන්න ඔබන්න'], '🎁 +පියවර 2 · 🍬 නැවත දමන්න · ❄️ වාරයක් මඟහැරේ', '🏁 මුලින්ම 23 වෙනි දොරට එන කෙනා දිනනවා'],
    },
  },
  ta: {
    'snowball-showdown': {
      title: 'பனிப்பந்து மோதல்',
      blurb: 'உறைந்த ஏரியில் பனிமனிதர்கள் தோன்றிக்கொண்டே இருக்கிறார்கள். 60 விநாடிகளில் முடிந்தவரை அதிகமானவர்களை வீழ்த்துங்கள்!',
      howTo: [
        ['👆 குறிவைக்க இழுங்கள்: குறிக்கோடு உங்கள் விரலுக்கு மேலே தெரியும். எறிய விரலை எடுங்கள்', '🖱️ மவுஸால் குறிவைத்து, எறிய கிளிக் செய்யுங்கள்'],
        '⛄ பனிமனிதன் = 1 புள்ளி · 🟡 தங்கப் பனிமனிதன் = 3',
        '🎁 பரிசுகளை அடிக்காதீர்கள் (−2)',
      ],
    },
    'gingerbread-bakery': {
      title: 'குக்கீ பிடி',
      blurb: 'பேக்கரியின் புகைபோக்கியிலிருந்து இனிப்புகள் மழையாகப் பொழிகின்றன! 60 விநாடிகள் அவற்றை உங்கள் கிண்ணத்தில் பிடியுங்கள்.',
      howTo: [
        ['👆 கிண்ணத்தை நகர்த்த எங்கும் இழுங்கள்', '🖱️ மவுஸைப் பிடித்து நகர்த்துங்கள், அல்லது ← → பயன்படுத்துங்கள்'],
        '🍪 🍬 +1 · 🧑‍🎄 +2 · 🎁 +3',
        '⚫ கரியைத் தவிருங்கள் (−2)',
        '✨ தங்கக் குக்கீ எல்லாவற்றையும் உங்கள் கிண்ணத்திற்குள் இழுக்கும்',
      ],
    },
    'santas-express': {
      title: 'சாண்டாவின் எக்ஸ்பிரஸ்',
      blurb: 'ஐந்து சிறிய ரயில் முற்றங்கள். ஒவ்வொரு பரிசையும் அதே நிற வீட்டுக்குக் கொண்டு சேருங்கள்.',
      howTo: [
        ['👆 ஒளிரும் தண்டவாளத் துண்டைத் திருப்ப அதைத் தொடுங்கள்', '🖱️ ஒளிரும் தண்டவாளத் துண்டைத் திருப்ப அதைக் கிளிக் செய்யுங்கள்'],
        '🎁 ரயிலில் உள்ள பரிசு அது எந்த வீட்டுக்கானது என்று காட்டும்',
        ['🚂 ரயிலை அனுப்ப புறப்படு! என்பதைத் தொடுங்கள்', '🚂 ரயிலை அனுப்ப Space அல்லது புறப்படு! அழுத்துங்கள்'],
        '⭐ குறைந்த திருப்பங்கள், விபத்து இல்லை = அதிக நட்சத்திரங்கள்',
      ],
    },
    'elf-workshop': {
      title: 'எல்ஃப் பட்டறை',
      blurb: 'பணி மணி அடிப்பதற்குள் ஒன்பது பொம்மைகளைச் செய்யுங்கள்.',
      howTo: [
        '👀 வரைபடம் ஒரு பொம்மைக்கான பாகங்களைக் காட்டும் — அவற்றை நினைவில் வையுங்கள்!',
        ['👆 மேசையில் அந்தப் பாகங்களைத் தொடுங்கள்', '🖱️ மேசையில் அந்தப் பாகங்களைக் கிளிக் செய்யுங்கள்'],
        '🔨 உருவாக்கு அழுத்துங்கள் — திரும்ப எடுக்க தட்டில் உள்ள பாகத்தைத் தொடுங்கள்',
      ],
    },
    'krampus-cellar': {
      title: 'க்ராம்பஸின் நிலவறை',
      blurb: 'பதுங்கி உள்ளே சென்று, திருடப்பட்ட 4 பரிசுகளை எடுத்துக்கொண்டு படிக்கட்டு வழியாகத் தப்புங்கள்.',
      howTo: [
        ['👆 நடக்க ஒரு தரை ஓட்டைத் தொடுங்கள்', '🖱️ ஒரு தரை ஓட்டைக் கிளிக் செய்யுங்கள், அல்லது WASD பயன்படுத்துங்கள்'],
        '✨ அடுத்த பெட்டிக்கு ஒளிரும் புள்ளிகளைப் பின்தொடருங்கள்',
        '🟥 சிவப்பு ஓடுகள் விளக்கு வெளிச்சம் — அவை விலகும் வரை காத்திருங்கள்',
        '🪜 பிறகு படிக்கட்டுக்குச் செல்லுங்கள்',
      ],
    },
    'advent-dice-race': {
      title: 'அட்வென்ட் பகடை பந்தயம்',
      blurb: '24 கதவுகள் கொண்ட அட்வென்ட் பலகையைச் சுற்றி மூன்று குறும்புக்கார எல்ஃப்களுடன் போட்டியிடுங்கள்.',
      howTo: [['🎲 உங்கள் முறையில் உருட்டு என்பதைத் தொடுங்கள்', '🎲 உங்கள் முறையில் Space அல்லது உருட்டு அழுத்துங்கள்'], '🎁 +2 அடிகள் · 🍬 மீண்டும் உருட்டு · ❄️ ஒரு முறை தவறும்', '🏁 முதலில் 23ஆம் கதவை அடைபவர் வெற்றி'],
    },
  },
};

const text = list(TEXT);

/** Name, blurb and how-to resolve in the current language when read. */
function localised(id: MiniGameId, rest: Omit<MiniGameInfo, 'title' | 'blurb' | 'howTo'>): MiniGameInfo {
  return {
    ...rest,
    get title() {
      return text()[id].title;
    },
    get blurb() {
      return text()[id].blurb;
    },
    get howTo() {
      return text()[id].howTo;
    },
  };
}

export const MINI_GAMES: Record<MiniGameId, MiniGameInfo> = {
  'snowball-showdown': localised('snowball-showdown', {
    id: 'snowball-showdown',
    emoji: '❄️',
    thresholds: [10, 20, 30],
    create: async (ctx) => new (await import('./snowball-showdown/SnowballShowdown')).SnowballShowdown(ctx),
  }),
  // Same id as the old bakery so saves and the village zone carry over.
  'gingerbread-bakery': localised('gingerbread-bakery', {
    id: 'gingerbread-bakery',
    emoji: '🍪',
    thresholds: [15, 35, 55],
    create: async (ctx) => new (await import('./cookie-catch/CookieCatch')).CookieCatch(ctx),
  }),
  'santas-express': localised('santas-express', {
    id: 'santas-express',
    emoji: '🚂',
    thresholds: [5, 10, 14],
    create: async (ctx) => new (await import('./santas-express/SantasExpress')).SantasExpress(ctx),
  }),
  'elf-workshop': localised('elf-workshop', {
    id: 'elf-workshop',
    emoji: '🔨',
    thresholds: [3, 6, 9],
    create: async (ctx) => new (await import('./elf-workshop/ElfWorkshop')).ElfWorkshop(ctx),
  }),
  'krampus-cellar': localised('krampus-cellar', {
    id: 'krampus-cellar',
    emoji: '🕯️',
    thresholds: [2, 4, 6],
    create: async (ctx) => new (await import('./krampus-cellar/KrampusCellar')).KrampusCellar(ctx),
  }),
  'advent-dice-race': localised('advent-dice-race', {
    id: 'advent-dice-race',
    emoji: '🎲',
    thresholds: [1, 2, 3],
    create: async (ctx) => new (await import('./advent-dice-race/AdventDiceRace')).AdventDiceRace(ctx),
  }),
};
