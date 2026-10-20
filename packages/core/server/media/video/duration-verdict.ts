export type DurationVerdict = 'ok' | 'too_long' | 'unmeasurable';

export function judgeDuration(_input: {
  memberCapSeconds: number | null;
  staticCapSeconds: number | undefined;
  durationSeconds: number | null;
}): DurationVerdict {
  return 'ok';
}
