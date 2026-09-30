/**
 * `@rede-social/contracts/text` — client-safe text helpers shared by the server (notification facts,
 * push bodies) and the web. A subpath for the same reason as `./realtime`: the package index
 * re-exports the server-only `legal` module.
 */

const ELLIPSIS = '…';

/**
 * `text` cut to at most `maxGraphemes` user-perceived characters, on a word boundary, with `…`
 * appended ONLY when something was cut. Grapheme clusters come from `Intl.Segmenter`, so an emoji
 * ZWJ sequence or a flag is never split in half. Newlines collapse to single spaces (a notification
 * row and a push banner are one line of prose), and an empty or whitespace-only input gives `''`.
 *
 * The `…` counts toward the limit, so the result never exceeds `maxGraphemes`. When the text has no
 * word boundary inside the limit (one very long word), it is cut at the grapheme limit instead.
 */
export function cutOnWord(text: string, maxGraphemes: number): string {
  const normalised = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (normalised === '' || maxGraphemes <= 0) return '';

  const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });
  const graphemes = Array.from(segmenter.segment(normalised), (s) => s.segment);
  if (graphemes.length <= maxGraphemes) return normalised;

  // Room for the ellipsis inside the limit.
  const budget = Math.max(maxGraphemes - 1, 0);
  const head = graphemes.slice(0, budget);
  // Cut at the last whitespace inside the budget when the next grapheme does not already start one.
  const nextIsSpace = /\s/.test(graphemes[budget] ?? '');
  let cut = head.length;
  if (!nextIsSpace) {
    for (let i = head.length - 1; i > 0; i--) {
      if (/\s/.test(head[i] ?? '')) {
        cut = i;
        break;
      }
    }
  }
  const kept = head.slice(0, cut).join('').trimEnd();
  return `${kept === '' ? head.join('').trimEnd() : kept}${ELLIPSIS}`;
}
