const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `YYYY-MM-DD` string the operator typed, as `DD/MM/YYYY` (09.4-15, UI-D-556). Plain string
 * surgery: the date is never turned into a `Date`, so no timezone can move it a day. Anything that is
 * not that exact shape reads `null` and is simply not shown.
 */
export function typedDateLabel(value: string | null | undefined): string | null {
  const match = DATE_ONLY.exec((value ?? '').trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}
