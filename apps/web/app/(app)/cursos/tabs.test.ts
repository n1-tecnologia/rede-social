import { describe, expect, it } from 'vitest';
import {
  COURSE_HUB_TABS,
  COURSE_MEMBER_TABS,
  DEFAULT_MEMBER_TAB,
  hubTabFromParam,
  hubTabHref,
  memberTabFromParam,
  memberTabHref,
} from './tabs';

/**
 * 08.6-08 — the member area's registry (D-435, UI-D-446, COURSE-28). Início is the entry: no value,
 * an empty value, an unknown value and a repeated param all read as `inicio` (EP-01, EP-02), the
 * Início href is bare `/cursos`, and the manager's D-402 hub is unchanged.
 */

describe('COURSE_MEMBER_TABS (D-435, EP-03)', () => {
  it('lists Início, Cursos, Trilhas, Lives, Progresso in that order (COURSE-28)', () => {
    expect(COURSE_MEMBER_TABS.map((tab) => tab.key)).toEqual([
      'inicio',
      'cursos',
      'trilhas',
      'lives',
      'progresso',
    ]);
    expect(COURSE_MEMBER_TABS.map((tab) => tab.labelKey)).toEqual([
      'courses.hub.tabs.home',
      'courses.hub.tabs.courses',
      'courses.hub.tabs.tracks',
      'courses.hub.tabs.lives',
      'courses.hub.tabs.progress',
    ]);
    expect(DEFAULT_MEMBER_TAB).toBe('inicio');
  });
});

describe('memberTabFromParam (UI-D-446, EP-01, EP-02)', () => {
  it('EP-02: no value and an empty value read as inicio', () => {
    expect(memberTabFromParam(undefined)).toBe('inicio');
    expect(memberTabFromParam('')).toBe('inicio');
  });

  it('EP-01: an unknown value and a repeated param read as inicio', () => {
    expect(memberTabFromParam('xyz')).toBe('inicio');
    expect(memberTabFromParam(['lives', 'cursos'])).toBe('inicio');
    expect(memberTabFromParam(['cursos'])).toBe('inicio');
    expect(memberTabFromParam('CURSOS')).toBe('inicio');
    expect(memberTabFromParam(' cursos')).toBe('inicio');
    expect(memberTabFromParam('PROGRESSO')).toBe('inicio');
    expect(memberTabFromParam(['progresso'])).toBe('inicio');
  });

  it('EP-03: each registered key answers itself; inicio itself is inicio', () => {
    expect(memberTabFromParam('cursos')).toBe('cursos');
    expect(memberTabFromParam('trilhas')).toBe('trilhas');
    expect(memberTabFromParam('lives')).toBe('lives');
    expect(memberTabFromParam('progresso')).toBe('progresso');
    for (const tab of COURSE_MEMBER_TABS) expect(memberTabFromParam(tab.key)).toBe(tab.key);
    expect(memberTabFromParam('inicio')).toBe('inicio');
  });
});

describe('memberTabHref (UI-D-446)', () => {
  it('Início is bare /cursos; the others carry ?aba=', () => {
    expect(memberTabHref('inicio')).toBe('/cursos');
    expect(memberTabHref('cursos')).toBe('/cursos?aba=cursos');
    expect(memberTabHref('trilhas')).toBe('/cursos?aba=trilhas');
    expect(memberTabHref('lives')).toBe('/cursos?aba=lives');
    expect(memberTabHref('progresso')).toBe('/cursos?aba=progresso');
  });

  it('the preview keeps ver=aluno on every item', () => {
    expect(memberTabHref('inicio', true)).toBe('/cursos?ver=aluno');
    expect(memberTabHref('cursos', true)).toBe('/cursos?aba=cursos&ver=aluno');
    expect(memberTabHref('trilhas', true)).toBe('/cursos?aba=trilhas&ver=aluno');
    expect(memberTabHref('lives', true)).toBe('/cursos?aba=lives&ver=aluno');
    expect(memberTabHref('progresso', true)).toBe('/cursos?aba=progresso&ver=aluno');
  });
});

describe('the manager hub (D-402) is unchanged', () => {
  it('keeps cursos · trilhas · lives with cursos as the default', () => {
    expect(COURSE_HUB_TABS.map((tab) => tab.key)).toEqual(['cursos', 'trilhas', 'lives']);
    expect(hubTabFromParam(undefined)).toBe('cursos');
    expect(hubTabFromParam('trilhas')).toBe('trilhas');
    expect(hubTabFromParam(['lives', 'cursos'])).toBe('cursos');
    expect(hubTabHref('cursos')).toBe('/cursos?aba=cursos');
  });
});
