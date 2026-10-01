import { describe, expect, it } from 'vitest';
import { cursorAfterOwnSend, cursorAfterPage, isReplayedSignal } from './chat-cursor';

/**
 * 07 review C-CR-01: the catch-up cursor must never skip a message. The race the review found: the
 * staff reply is stored at seq N, the member's own message at N+1, and the send's answer lands before
 * the reply's Realtime signal. The old pane moved its cursor to N+1, dropped the signal for N as a
 * replay, and every later catch-up asked for `afterSeq=N+1`, so N stayed missing until a reload.
 */
describe('chat catch-up cursor', () => {
  it('the lost-reply race: an own send past a gap keeps the cursor and asks for a catch-up', () => {
    const held = 4; // the pane holds seqs 1..4
    const send = cursorAfterOwnSend(held, 6); // staff wrote 5, the member's own message is 6
    expect(send).toEqual({ cursor: 4, catchUp: true });
    // The staff reply's signal (seq 5) lands afterwards: it is NOT a replay, so it fetches.
    expect(isReplayedSignal(send.cursor, 5)).toBe(false);
    // The catch-up asks `afterSeq=4` and answers 5 and 6: the cursor reaches 6 with nothing skipped.
    expect(cursorAfterPage(send.cursor, [5, 6])).toBe(6);
    // The own message's late signal is a replay now.
    expect(isReplayedSignal(6, 6)).toBe(true);
  });

  it('a catch-up in flight when the send answers still delivers the message before it', () => {
    // The catch-up asked `afterSeq=4`; meanwhile the own send answered 6 (gap) and kept the cursor.
    const send = cursorAfterOwnSend(4, 6);
    expect(send.cursor).toBe(4);
    // The in-flight page [5, 6] is applied against the unmoved cursor: nothing is filtered out.
    expect(cursorAfterPage(send.cursor, [5, 6])).toBe(6);
  });

  it('an own send right after the cursor moves it: nothing can be missing', () => {
    expect(cursorAfterOwnSend(4, 5)).toEqual({ cursor: 5, catchUp: false });
    expect(cursorAfterOwnSend(0, 1)).toEqual({ cursor: 1, catchUp: false });
  });

  it('an own send at or below the cursor (a catch-up already delivered it) changes nothing', () => {
    expect(cursorAfterOwnSend(7, 6)).toEqual({ cursor: 7, catchUp: false });
    expect(cursorAfterOwnSend(7, 7)).toEqual({ cursor: 7, catchUp: false });
  });

  it('a page never moves the cursor backwards, and an empty page keeps it', () => {
    expect(cursorAfterPage(9, [])).toBe(9);
    expect(cursorAfterPage(9, [3, 4])).toBe(9);
    // A soft-deleted message leaves a hole in the seqs a page answers; the page still covers it.
    expect(cursorAfterPage(4, [6, 7])).toBe(7);
  });

  it('only a numeric seq at or below the cursor is a replay', () => {
    expect(isReplayedSignal(5, 5)).toBe(true);
    expect(isReplayedSignal(5, 4)).toBe(true);
    expect(isReplayedSignal(5, 6)).toBe(false);
    expect(isReplayedSignal(5, undefined)).toBe(false);
    expect(isReplayedSignal(5, '3')).toBe(false);
  });
});
