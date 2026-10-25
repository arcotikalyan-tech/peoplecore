/**
 * The weight every piece of text is drawn with. React Native measures text without Android's "Bold text" setting but
 * Android draws plain text with it, so the drawing came out wider than its box and lost its last letters ("12:42 a").
 * Giving every text an explicit weight makes React Native measure and draw with the same font; adding Android's
 * adjustment (300 with Bold text on, 0 otherwise) keeps the setting working.
 */
export type Weight = '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

const NAMED: Record<string, number> = {
  thin: 100, ultralight: 200, light: 300, normal: 400, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900,
};

/** The text's own weight as a number, or null when it has none (it then follows the text around it). */
export function baseWeight(weight: string | number | undefined | null): number | null {
  if (weight == null) return null;
  const n = typeof weight === 'number' ? weight : NAMED[weight] ?? Number(weight);
  return Number.isFinite(n) ? n : null;
}

export function drawnWeight(base: number, adjustment: number): Weight {
  return String(Math.min(900, Math.max(100, Math.round((base + adjustment) / 100) * 100))) as Weight;
}

/** Android formats times as "12:42 am" with a narrow no-break space (U+202F), another cause of clipped text; use a normal one. */
export const plainSpaces = (text: string) => text.replace(/\u202f/g, '\u00a0');
