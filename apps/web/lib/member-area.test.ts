import { describe, expect, it } from 'vitest';
import { MEMBER_AREA_PATH, memberAreaTabOverrides } from './member-area';

describe('MEMBER_AREA_PATH', () => {
  it('is /area-membros, never the staff directory /membros', () => {
    expect(MEMBER_AREA_PATH).toBe('/area-membros');
  });
});

describe('memberAreaTabOverrides (QD-01)', () => {
  it('is empty for a manager: the admin keeps the manifest tab as built', () => {
    expect(memberAreaTabOverrides({ canManage: true, label: 'Membros' })).toEqual({});
  });

  it('is exactly one entry for the courses tab for everyone else', () => {
    expect(memberAreaTabOverrides({ canManage: false, label: 'Membros' })).toEqual({
      courses: { href: '/area-membros', label: 'Membros', matches: ['/cursos'] },
    });
  });
});
