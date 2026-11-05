import { describe, expect, it } from 'vitest';
import {
  ADMIN_SCREENS,
  adminScreenFromAba,
  adminScreenHref,
  coursesAreas,
  MANAGE_PATH,
  MANAGEMENT_PATHS,
  MEMBER_AREA_PATH,
  MEMBER_SCREENS,
  memberAreaTabOverrides,
  memberScreenFromAba,
  memberScreenHref,
  PREVIEW_PARAM,
  PREVIEW_VALUE,
} from './member-area';

describe('MEMBER_AREA_PATH', () => {
  it('is /area-membros, never the staff directory /membros', () => {
    expect(MEMBER_AREA_PATH).toBe('/area-membros');
  });
});

describe('memberAreaTabOverrides (QD-01)', () => {
  it('is exactly one entry for the courses tab: Membros, on the member area, current under /cursos', () => {
    expect(memberAreaTabOverrides({ canManage: false, label: 'Membros' })).toEqual({
      courses: { href: '/area-membros', label: 'Membros', matches: ['/cursos'] },
    });
  });

  it("2026-10-23: is the same tab for a manager (who manages through the menu's Gerenciar)", () => {
    expect(memberAreaTabOverrides({ canManage: true, label: 'Membros' })).toEqual(
      memberAreaTabOverrides({ canManage: false, label: 'Membros' }),
    );
  });
});

/* ── 2026-10-22: one path per screen (the courses redesign) ─────────────────────────────────── */

describe('the screen registries (ORDER IS THE CONTRACT)', () => {
  it('lists the member screens Início, Cursos, Trilhas, Lives, Progresso with their own paths', () => {
    expect(MEMBER_SCREENS.map((screen) => [screen.key, screen.path])).toEqual([
      ['inicio', '/area-membros'],
      ['cursos', '/area-membros/cursos'],
      ['trilhas', '/area-membros/trilhas'],
      ['lives', '/area-membros/lives'],
      ['progresso', '/area-membros/progresso'],
    ]);
    expect(MEMBER_SCREENS.map((screen) => screen.labelKey)).toEqual([
      'courses.member.area.screens.home',
      'courses.member.area.screens.courses',
      'courses.member.area.screens.tracks',
      'courses.member.area.screens.lives',
      'courses.member.area.screens.progress',
    ]);
  });

  it('lists the admin screens Cursos, Trilhas, Lives with their own paths', () => {
    expect(ADMIN_SCREENS.map((screen) => [screen.key, screen.path])).toEqual([
      ['cursos', '/cursos'],
      ['trilhas', '/cursos/trilhas'],
      ['lives', '/cursos/lives'],
    ]);
    expect(ADMIN_SCREENS.map((screen) => screen.labelKey)).toEqual([
      'courses.area.screens.courses',
      'courses.area.screens.tracks',
      'courses.area.screens.lives',
    ]);
  });

  it('keeps the preview flag spelled ver=aluno', () => {
    expect([PREVIEW_PARAM, PREVIEW_VALUE]).toEqual(['ver', 'aluno']);
  });
});

describe('memberScreenHref', () => {
  it('is each screen path, bare', () => {
    expect(memberScreenHref('inicio')).toBe('/area-membros');
    expect(memberScreenHref('cursos')).toBe('/area-membros/cursos');
    expect(memberScreenHref('trilhas')).toBe('/area-membros/trilhas');
    expect(memberScreenHref('lives')).toBe('/area-membros/lives');
    expect(memberScreenHref('progresso')).toBe('/area-membros/progresso');
  });

  it('keeps categoria only on Cursos and trilha only on Trilhas, encoded', () => {
    expect(memberScreenHref('cursos', { categoria: 'K1' })).toBe(
      '/area-membros/cursos?categoria=K1',
    );
    expect(memberScreenHref('cursos', { categoria: 'a b&c' })).toBe(
      '/area-membros/cursos?categoria=a+b%26c',
    );
    expect(memberScreenHref('trilhas', { trilha: 'T1' })).toBe('/area-membros/trilhas?trilha=T1');
    expect(memberScreenHref('lives', { categoria: 'K1', trilha: 'T1' })).toBe(
      '/area-membros/lives',
    );
    expect(memberScreenHref('inicio', { categoria: 'K1' })).toBe('/area-membros');
  });

  it('drops a repeated or empty value', () => {
    expect(memberScreenHref('cursos', { categoria: ['K1', 'K2'] })).toBe('/area-membros/cursos');
    expect(memberScreenHref('cursos', { categoria: '' })).toBe('/area-membros/cursos');
    expect(memberScreenHref('trilhas', { trilha: null })).toBe('/area-membros/trilhas');
  });

  it('a preview adds ver=aluno last, on every screen', () => {
    expect(memberScreenHref('inicio', {}, true)).toBe('/area-membros?ver=aluno');
    expect(memberScreenHref('cursos', { categoria: 'K1' }, true)).toBe(
      '/area-membros/cursos?categoria=K1&ver=aluno',
    );
    expect(memberScreenHref('trilhas', { trilha: 'T1' }, true)).toBe(
      '/area-membros/trilhas?trilha=T1&ver=aluno',
    );
    expect(memberScreenHref('progresso', {}, true)).toBe('/area-membros/progresso?ver=aluno');
  });

  it('a URL-shaped value stays an encoded value', () => {
    expect(memberScreenHref('cursos', { categoria: 'https://evil.example/x' })).toBe(
      '/area-membros/cursos?categoria=https%3A%2F%2Fevil.example%2Fx',
    );
  });
});

describe('adminScreenHref', () => {
  it('is each admin path, keeping one filtro value', () => {
    expect(adminScreenHref('cursos')).toBe('/cursos');
    expect(adminScreenHref('trilhas')).toBe('/cursos/trilhas');
    expect(adminScreenHref('lives')).toBe('/cursos/lives');
    expect(adminScreenHref('cursos', { filtro: 'rascunhos' })).toBe('/cursos?filtro=rascunhos');
    expect(adminScreenHref('trilhas', { filtro: 'arquivadas' })).toBe(
      '/cursos/trilhas?filtro=arquivadas',
    );
    expect(adminScreenHref('lives', { filtro: ['passadas', 'x'] })).toBe('/cursos/lives');
  });
});

describe('memberScreenFromAba (the old ?aba=, EP-01, EP-02, EP-03)', () => {
  it('EP-02: no value and an empty value read as inicio', () => {
    expect(memberScreenFromAba(undefined)).toBe('inicio');
    expect(memberScreenFromAba('')).toBe('inicio');
  });

  it('EP-01: an unknown value, another case and a repeated param read as inicio', () => {
    expect(memberScreenFromAba('xyz')).toBe('inicio');
    expect(memberScreenFromAba(['lives', 'cursos'])).toBe('inicio');
    expect(memberScreenFromAba(['cursos'])).toBe('inicio');
    expect(memberScreenFromAba('CURSOS')).toBe('inicio');
    expect(memberScreenFromAba(' cursos')).toBe('inicio');
    expect(memberScreenFromAba('https://evil.example')).toBe('inicio');
  });

  it('EP-03: each known key answers itself', () => {
    for (const screen of MEMBER_SCREENS) expect(memberScreenFromAba(screen.key)).toBe(screen.key);
  });
});

describe('adminScreenFromAba', () => {
  it('reads one known admin key, anything else as cursos', () => {
    expect(adminScreenFromAba('trilhas')).toBe('trilhas');
    expect(adminScreenFromAba('lives')).toBe('lives');
    expect(adminScreenFromAba('cursos')).toBe('cursos');
    expect(adminScreenFromAba(undefined)).toBe('cursos');
    expect(adminScreenFromAba('progresso')).toBe('cursos');
    expect(adminScreenFromAba(['trilhas'])).toBe('cursos');
  });
});

describe('coursesAreas (the TopBar "· Membros" and the rail; 2026-10-23: one area, Gerenciar last for a manager)', () => {
  // The words are the keys themselves: the test pins which key names what, not the catalog.
  const t = (key: string) => `«${key}»`;

  it('a member gets ONE area, Membros, with the five member screens on their own paths', () => {
    const areas = coursesAreas({ canManage: false, t });
    expect(areas).toHaveLength(1);
    const [area] = areas;
    expect(area?.label).toBe('«courses.member.area.label»');
    expect(area?.menuLabel).toBe('«courses.member.area.menu»');
    expect(area?.within).toBeUndefined();
    expect(
      area?.screens.map((screen) => [screen.key, screen.href, screen.icon, screen.label]),
    ).toEqual([
      ['member-inicio', '/area-membros', 'home', '«courses.member.area.screens.home»'],
      [
        'member-cursos',
        '/area-membros/cursos',
        'graduation-cap',
        '«courses.member.area.screens.courses»',
      ],
      ['member-trilhas', '/area-membros/trilhas', 'route', '«courses.member.area.screens.tracks»'],
      ['member-lives', '/area-membros/lives', 'radio', '«courses.member.area.screens.lives»'],
      [
        'member-progresso',
        '/area-membros/progresso',
        'trending-up',
        '«courses.member.area.screens.progress»',
      ],
    ]);
  });

  it('a manager gets the same ONE area: the five member screens in the preview, then Gerenciar', () => {
    const areas = coursesAreas({ canManage: true, t });
    expect(areas).toHaveLength(1);
    const [area] = areas;
    expect(area?.label).toBe('«courses.member.area.label»');
    expect(area?.menuLabel).toBe('«courses.member.area.menu»');
    expect(area?.within).toBeUndefined();
    // Every member row keeps ver=aluno: the shared course, lesson and live pages open the member's
    // side with it, so the menu never drops the manager out of the preview.
    expect(area?.screens.map((screen) => [screen.key, screen.href])).toEqual([
      ['member-inicio', '/area-membros?ver=aluno'],
      ['member-cursos', '/area-membros/cursos?ver=aluno'],
      ['member-trilhas', '/area-membros/trilhas?ver=aluno'],
      ['member-lives', '/area-membros/lives?ver=aluno'],
      ['member-progresso', '/area-membros/progresso?ver=aluno'],
      ['manage', '/cursos/gerenciar'],
    ]);
    const manage = area?.screens.at(-1);
    expect(manage?.icon).toBe('sliders-horizontal');
    expect(manage?.label).toBe('«courses.manage.title»');
    // Current on the hub and the four management lists, exact paths (detail pages and forms mark none).
    expect(manage?.matches).toEqual([
      '/cursos/gerenciar',
      '/cursos',
      '/cursos/trilhas',
      '/cursos/lives',
      '/cursos/categorias',
    ]);
  });

  it('a member never gets Gerenciar', () => {
    const [area] = coursesAreas({ canManage: false, t });
    expect(area?.screens.some((screen) => screen.key === 'manage')).toBe(false);
    expect(area?.screens.some((screen) => screen.href.startsWith('/cursos'))).toBe(false);
  });

  it('the screens follow the registries, in their order (ORDER IS THE CONTRACT)', () => {
    const [member] = coursesAreas({ canManage: false, t });
    expect(member?.screens.map((screen) => screen.key)).toEqual(
      MEMBER_SCREENS.map((screen) => `member-${screen.key}`),
    );
    const [manager] = coursesAreas({ canManage: true, t });
    expect(manager?.screens.map((screen) => screen.key)).toEqual([
      ...MEMBER_SCREENS.map((screen) => `member-${screen.key}`),
      'manage',
    ]);
  });
});

describe('MANAGE_PATH and MANAGEMENT_PATHS (2026-10-23)', () => {
  it('Gerenciar lives under /cursos, and gathers itself and the four management lists', () => {
    expect(MANAGE_PATH).toBe('/cursos/gerenciar');
    expect([...MANAGEMENT_PATHS]).toEqual([
      MANAGE_PATH,
      ...ADMIN_SCREENS.map((screen) => screen.path),
      '/cursos/categorias',
    ]);
  });
});
