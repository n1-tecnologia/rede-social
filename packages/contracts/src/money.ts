import { z } from 'zod';

/**
 * Money, as the store prices it (08.2, STORE-02, D-361). `@rede-social/contracts/money`, a subpath:
 * the root barrel is frozen.
 *
 * THREE THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **Money is integer CENTS end to end.** The API body, the `store_products.price_cents` column, the
 *    `store_orders.amount_cents` snapshot and every comparison are integers. The division by 100
 *    happens in ONE place, `formatBrl`, at the display edge.
 * 2. **`parseBrlToCents` never calls `parseFloat`.** "19,90" is split into its reais and centavos
 *    digits and added as integers, so no binary fraction (0.1 + 0.2) can ever reach a price.
 * 3. **The cap is the schema's job, not the parser's.** A value above `STORE_MAX_PRICE_CENTS` still
 *    parses, so the form can say "too expensive" rather than "not a number".
 */

/** R$ 100.000,00, mirrored by `store_products_price_chk` (`price_cents between 0 and 10000000`). */
export const STORE_MAX_PRICE_CENTS = 10_000_000;

/**
 * A price in integer cents: 0 ("Grátis", from the catalog) up to the cap, never a fraction. Every
 * refusal carries the ONE machine code `price_invalid`, which a route's `defaultHook` lifts into its
 * module's `details` (the store's `STORE_ISSUES`).
 */
const PRICE_INVALID = { error: 'price_invalid' } as const;
export const priceCentsSchema = z
  .number(PRICE_INVALID)
  .int(PRICE_INVALID)
  .min(0, PRICE_INVALID)
  .max(STORE_MAX_PRICE_CENTS, PRICE_INVALID);

/** One formatter for the process (constructing `Intl.NumberFormat` per call is not free). */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * `1990` -> `R$ 19,90`. The separator after `R$` is U+00A0 (a no-break space), which is what
 * `Intl` emits: tests compare against `formatBrl(…)` or spell the U+00A0, never an ASCII space
 * (RESEARCH Pitfall 12). "Grátis" for `0` comes from the catalog, never from here.
 */
export function formatBrl(cents: number): string {
  return BRL.format(cents / 100);
}

/**
 * Digits with optional `.` thousand groups, an optional `,` and one or two decimals, an optional
 * leading `R$`. `\s` also matches U+00A0, so a pasted `formatBrl` string parses back.
 */
const BRL_INPUT = /^\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*$/;

/**
 * The price an admin typed -> integer cents, or `null` when it is not a price.
 * `'19'` -> 1900, `'19,9'` -> 1990, `'19,90'` -> 1990, `'1.234,50'` -> 123450, `'1234,50'` -> 123450;
 * `'-1'`, `'19.90'` (a dot is a thousands separator in pt-BR, so this is ambiguous), `'19,999'`,
 * `''` and `'abc'` -> null. Integer arithmetic only.
 */
export function parseBrlToCents(raw: string): number | null {
  const match = BRL_INPUT.exec(raw);
  if (!match) return null;
  const reais = Number((match[1] ?? '').replaceAll('.', ''));
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const total = reais * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}
