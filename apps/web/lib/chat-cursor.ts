/**
 * The support thread's catch-up cursor (D-240, CHAT-04; 07 review C-CR-01).
 *
 * The cursor is the highest `seq` up to which the pane holds EVERY live message of the conversation.
 * It is what the catch-up asks for (`afterSeq=cursor`) and what tells a Realtime signal apart from a
 * replay, so it must never move past a message the pane has not received. Two rules keep it honest:
 *
 * - **Only a catch-up page moves it freely.** A page answers every live message after the `afterSeq`
 *   it was asked for, in `seq` order, so the cursor may move to the page's last seq.
 * - **The pane's own send moves it only when nothing can be missing.** The send answers the new
 *   message's seq. When that seq is the cursor's very next one, the pane holds everything up to it.
 *   Otherwise something was written in between (the other side's reply whose signal has not landed
 *   yet, a second agent's reply, a soft-deleted message): the cursor stays and a catch-up runs, and
 *   the merge drops by id whatever the pane already holds.
 *
 * The highest seq on screen is NOT a cursor: an own message shown after a gap would make the earlier,
 * still-missing reply look like a replay, and every later catch-up would start past it.
 */

/** The cursor after a catch-up page answered: the page holds every live message after the ask. */
export function cursorAfterPage(cursor: number, pageSeqs: readonly number[]): number {
  return pageSeqs.reduce((max, seq) => Math.max(max, seq), cursor);
}

/** The cursor after the pane's own send answered `seq`, and whether a catch-up must fill a gap. */
export function cursorAfterOwnSend(
  cursor: number,
  seq: number,
): { cursor: number; catchUp: boolean } {
  if (seq <= cursor) return { cursor, catchUp: false };
  if (seq === cursor + 1) return { cursor: seq, catchUp: false };
  return { cursor, catchUp: true };
}

/** An ids-only signal at or below the cursor is a replay: there is nothing to fetch (T-07-64). */
export function isReplayedSignal(cursor: number, seq: unknown): boolean {
  return typeof seq === 'number' && seq <= cursor;
}
