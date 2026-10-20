/**
 * What a `video.asset.ready` event means for the duration cap of the row it names (WR-06, D-474).
 *
 *  - `ok`: the upload may go `ready`;
 *  - `too_long`: the measured duration is strictly greater than the cap, so the upload is rejected;
 *  - `unmeasurable`: a MEMBER upload whose provider reported no duration at all. Fail closed: a
 *    member's cap exists to bound cost and the publish-time guard reads the stored duration, so a
 *    ready video nobody could measure would slip past both. An ADMIN upload (no snapshot) with no
 *    duration stays `ok`, exactly as before.
 *
 * Pure on purpose, so the unit test needs no database; `applyReady` stays the only writer.
 */
export type DurationVerdict = 'ok' | 'too_long' | 'unmeasurable';

export type DurationVerdictInput = {
  /** The cap snapshotted at `start` for a member's `post` video; null for every other upload. */
  memberCapSeconds: number | null;
  /** The static per-purpose cap of `MEDIA_LIMITS`; undefined when the purpose has none. */
  staticCapSeconds: number | undefined;
  /** What the provider measured; null when it reported nothing. */
  durationSeconds: number | null;
};

export function judgeDuration(input: DurationVerdictInput): DurationVerdict {
  const { memberCapSeconds, staticCapSeconds, durationSeconds } = input;
  if (durationSeconds === null) return memberCapSeconds !== null ? 'unmeasurable' : 'ok';
  // The member snapshot wins over the static cap; strictly `>`, so exactly the cap is accepted.
  const cap = memberCapSeconds ?? staticCapSeconds;
  if (cap !== undefined && durationSeconds > cap) return 'too_long';
  return 'ok';
}
