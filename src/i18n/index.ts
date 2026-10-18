/**
 * English, Sinhala and Tamil. Each area of the game keeps its text in a small table made with
 * `strings({ en, si, ta })` next to the code that shows it; TypeScript refuses to build if a
 * Sinhala or Tamil entry is missing.
 *
 * Text is looked up when it's shown, so changing language only needs a re-render (the game
 * reloads, which also rebuilds the signposts drawn into textures).
 */

export type Lang = 'en' | 'si' | 'ta';
export const LANGS: Lang[] = ['en', 'si', 'ta'];

/** Each language written in its own script, for the pickers. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்' };
export const LANG_SHORT: Record<Lang, string> = { en: 'EN', si: 'සිං', ta: 'தமி' };

const LOCALE: Record<Lang, string> = { en: 'en-LK', si: 'si-LK', ta: 'ta-LK' };

/** A plain string, or singular/plural forms chosen by the `n` parameter. */
export type Entry = string | { one: string; other: string };
type Params = Record<string, string | number>;

let current: Lang = 'en';
let plural = new Intl.PluralRules(LOCALE.en);

export function lang(): Lang {
  return current;
}

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'si' || v === 'ta';
}

export function setLanguage(l: Lang) {
  current = l;
  plural = new Intl.PluralRules(LOCALE[l]);
  document.documentElement.lang = l;
  loadFonts(l);
}

function fill(e: Entry, params?: Params): string {
  let s = typeof e === 'string' ? e : plural.select(Number(params?.n ?? 0)) === 'one' ? e.one : e.other;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
  return s;
}

/**
 * A table of text in all three languages. Returns `t(key, params?)`; `{name}` placeholders are
 * filled from params, and `{ one, other }` entries pick the plural form for `params.n`.
 */
export function strings<K extends string>(table: { en: Record<K, Entry>; si: Record<K, Entry>; ta: Record<K, Entry> }) {
  const t = (key: K, params?: Params): string => fill(table[current][key] ?? table.en[key], params);
  /** Whether a key exists (for codes that come from outside, e.g. server error codes). */
  const has = (key: string): key is K => key in table.en;
  return Object.assign(t, { has });
}

/** A per-language value that isn't a single string (e.g. a list of names), read when shown. */
export function list<T>(table: Record<Lang, T>): () => T {
  return () => table[current];
}

export function fmtNumber(n: number) {
  return n.toLocaleString(LOCALE[current]);
}

export function fmtMonthYear(d: Date) {
  return d.toLocaleDateString(LOCALE[current], { month: 'short', year: 'numeric' });
}

/** Same stack everywhere: Fredoka draws Latin, Noto draws Sinhala and Tamil. */
export const FONT_STACK = `'Fredoka', 'Noto Sans Sinhala', 'Noto Sans Tamil', system-ui, sans-serif`;

const FONT_URL: Record<Exclude<Lang, 'en'>, string> = {
  si: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Sinhala:wght@400;600;700&display=swap',
  ta: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@400;600;700&display=swap',
};
const FONT_FAMILY: Record<Exclude<Lang, 'en'>, string> = { si: 'Noto Sans Sinhala', ta: 'Noto Sans Tamil' };
const SAMPLE: Record<Exclude<Lang, 'en'>, string> = { si: 'සිංහල', ta: 'தமிழ்' };

/** Adds the Noto stylesheet for a script (once). */
export function loadFonts(...langs: Lang[]) {
  for (const l of langs) {
    if (l === 'en' || document.querySelector(`link[data-font=${l}]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_URL[l];
    link.dataset.font = l;
    document.head.append(link);
  }
}

/**
 * Waits (up to `ms`) until the active script's font can draw, before text is baked into
 * canvases (signposts, name tags). Resolves either way.
 */
export async function fontsReady(ms = 3000): Promise<void> {
  const l = current;
  const loads: Promise<unknown>[] = [document.fonts.load(`bold 46px Fredoka`)];
  if (l !== 'en') {
    // The stylesheet has to arrive before the face is known to document.fonts.
    loads.push(
      (async () => {
        for (let i = 0; i < 30 && ![...document.fonts].some((f) => f.family.replace(/"/g, '') === FONT_FAMILY[l]); i++) await new Promise((r) => setTimeout(r, 100));
        await document.fonts.load(`bold 46px "${FONT_FAMILY[l]}"`, SAMPLE[l]);
      })(),
    );
  }
  await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, ms))]);
}
