// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LessonPickerSheet } from '../ui';

/**
 * UI-D-403 — the live form's replay picker as an observable contract: "Sem replay" first, one group
 * per course with its `SectionTitle`, every row a radio named by the host, ONE check on the chosen
 * row, select and none handed back, the empty copy and the four loading skeletons. The sheet ships
 * NO words (PWA-03): every string is a prop, sentinel ASCII here so a copy change cannot turn this
 * file red.
 */

MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

const GROUPS = [
  {
    courseId: 'course-a',
    courseTitle: 'course-a-title',
    lessons: [
      {
        id: 'l1',
        title: 'lesson-one',
        thumb: <img data-testid="host-thumb" alt="" src="data:," />,
      },
      { id: 'l2', title: 'lesson-two-with-a-deliberately-long-title' },
    ],
  },
  {
    courseId: 'course-b',
    courseTitle: 'course-b-title',
    lessons: [{ id: 'l3', title: 'lesson-three' }],
  },
  { courseId: 'course-empty', courseTitle: 'course-empty-title', lessons: [] },
] as const;

const LABELS = { row: (lesson: string, course: string) => `${lesson}, of ${course}` };

function renderSheet(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    onClose: () => {},
    title: 'sheet-title',
    helper: 'sheet-helper',
    groups: GROUPS,
    selectedId: null,
    noneLabel: 'none-label',
    onSelect: () => {},
    labels: LABELS,
    empty: { title: 'empty-title', body: 'empty-body' },
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<LessonPickerSheet {...(props as any)} />);
}

describe('LessonPickerSheet (UI-D-403)', () => {
  it('1. is a titled dialog with a radiogroup: "none" first and checked by default, then one group per course WITH lessons, each lesson a radio named by the host', () => {
    renderSheet();
    expect(screen.getByRole('dialog', { name: 'sheet-title' })).toBeInTheDocument();
    expect(screen.getByText('sheet-helper')).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'sheet-title' });
    const radios = within(group).getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('data-testid', 'lesson-picker-none');
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios[0]).toHaveTextContent('none-label');
    expect(radios.slice(1).map((row) => row.getAttribute('data-lesson-id'))).toEqual([
      'l1',
      'l2',
      'l3',
    ]);
    expect(screen.getByRole('radio', { name: 'lesson-one, of course-a-title' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // The groups: a heading per course that HAS lessons; the empty course draws nothing.
    const groups = screen.getAllByTestId('lesson-picker-group');
    expect(groups.map((g) => g.getAttribute('data-course-id'))).toEqual(['course-a', 'course-b']);
    expect(within(groups[0] as HTMLElement).getByRole('heading', { name: 'course-a-title' }));
    expect(screen.queryByText('course-empty-title')).toBeNull();
    // ONE check: on the none row only.
    expect(screen.getAllByTestId('lesson-picker-check')).toHaveLength(1);
  });

  it('2. the chosen lesson carries the one check and aria-checked; the host thumb fills the 16:9 slot, a lesson without one takes the glyph', () => {
    renderSheet({ selectedId: 'l2' });
    const chosen = screen.getByRole('radio', {
      name: 'lesson-two-with-a-deliberately-long-title, of course-a-title',
    });
    expect(chosen).toHaveAttribute('aria-checked', 'true');
    expect(within(chosen).getByTestId('lesson-picker-check')).toBeInTheDocument();
    expect(screen.getAllByTestId('lesson-picker-check')).toHaveLength(1);
    expect(screen.getByTestId('lesson-picker-none')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('host-thumb')).toBeInTheDocument();
    expect(screen.getAllByTestId('lesson-picker-thumb')).toHaveLength(1);
    expect(screen.getAllByTestId('lesson-picker-fallback')).toHaveLength(2);
  });

  it('3. a tap on a lesson hands back its id; a tap on the none row hands back null', () => {
    const onSelect = vi.fn();
    renderSheet({ onSelect, selectedId: 'l1' });
    fireEvent.click(screen.getByRole('radio', { name: 'lesson-three, of course-b-title' }));
    expect(onSelect).toHaveBeenLastCalledWith('l3');
    fireEvent.click(screen.getByTestId('lesson-picker-none'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('4. with no lesson at all the none row stays and the host empty copy is drawn (E13 zero)', () => {
    renderSheet({ groups: [{ courseId: 'c', courseTitle: 'c-title', lessons: [] }] });
    expect(screen.getByTestId('lesson-picker-none')).toBeInTheDocument();
    const empty = screen.getByTestId('lesson-picker-empty');
    expect(within(empty).getByText('empty-title')).toBeInTheDocument();
    expect(within(empty).getByText('empty-body')).toBeInTheDocument();
    expect(screen.queryAllByTestId('lesson-picker-row')).toHaveLength(0);
    expect(screen.queryByText('c-title')).toBeNull();
  });

  it('5. while loading, four wordless row skeletons stand in for the groups (E13 loading)', () => {
    renderSheet({ loading: true });
    const loading = screen.getByTestId('lesson-picker-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('[data-testid="row-skeleton"]')).toHaveLength(4);
    expect(screen.queryAllByTestId('lesson-picker-row')).toHaveLength(0);
    expect(screen.queryByTestId('lesson-picker-empty')).toBeNull();
  });
});
