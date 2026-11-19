import { describe, expect, it } from 'vitest';
import * as server from '../server/index';

/**
 * 11-05 (D-732, MODER-04): the API tier hands the community remover to the kernel's `resolveReport` as part of
 * `deps.removeContent`, so its name is a contract. A rename here breaks the dispatcher in plan 16 at type-check
 * time; this pin makes it break here first.
 */
describe('communities report remover (D-732)', () => {
  it('1. the server entry exports the community archive remover as a function', () => {
    expect(typeof server.archiveReportedCommunityInTx).toBe('function');
  });

  it('2. the shipped community writes are still exported beside it', () => {
    expect(typeof server.updateCommunity).toBe('function');
    expect(typeof server.deleteCommunity).toBe('function');
  });
});
