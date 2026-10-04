const ratioFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/**
 * A WCAG contrast ratio as the contrast pills and warnings print it, one decimal in pt-BR ("4,5").
 * A FAILING ratio rounds down (2026-10-03, review BTN-CARD-3): rounded as usual, 4.48 against a
 * 4.5:1 floor read "Baixo 4,5:1", a warning that names the very floor it misses; floored it reads
 * "Baixo 4,4:1". A passing ratio rounds as usual (it is at or above its floor either way). `ok` is
 * the check's own verdict, so every floor (4.5 for text, 3 for a surface) is honoured as checked.
 */
export function formatContrastRatio(ratio: number, ok: boolean): string {
  return ratioFormat.format(ok ? ratio : Math.floor(ratio * 10) / 10);
}
