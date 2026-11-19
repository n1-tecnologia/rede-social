import { describe, expect, it } from 'vitest';
import * as server from '../server/index';

/**
 * 11-05 (D-732, MODER-04): the API tier hands the story removers to the kernel's `resolveReport` as
 * `deps.removeContent`, so the names below are a contract. A rename here breaks the dispatcher in plan 16 at
 * type-check time; this pin makes it break here first, with the reason in the test name.
 */
describe('stories report removers (D-732)', () => {
  it('1. the server entry exports the story and the story comment removers as functions', () => {
    expect(typeof server.removeReportedStoryInTx).toBe('function');
    expect(typeof server.removeReportedStoryCommentInTx).toBe('function');
  });

  it('2. the shipped public removals are still exported beside them', () => {
    expect(typeof server.deleteStory).toBe('function');
  });
});
