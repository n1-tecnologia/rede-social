import { describe, expect, it } from 'vitest';
import { ACCESS_REFUSALS, POST_ACCESS } from '../src/access';

describe('access (08.2, STORE-13, STORE-15, STORE-17): the community access vocabulary', () => {
  it('pins the 403 refusal list to exactly community_locked', () => {
    expect([...ACCESS_REFUSALS]).toEqual(['community_locked']);
  });

  it('pins the post access marker list to exactly sample (absent means full access)', () => {
    expect([...POST_ACCESS]).toEqual(['sample']);
  });
});
