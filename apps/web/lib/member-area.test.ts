import { describe, expect, it } from 'vitest';
import { MEMBER_AREA_PATH } from './member-area';

describe('MEMBER_AREA_PATH', () => {
  it('is /area-membros, never the staff directory /membros', () => {
    expect(MEMBER_AREA_PATH).toBe('/area-membros');
  });
});
