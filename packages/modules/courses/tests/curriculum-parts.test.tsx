// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LessonRow, ModuleCard, PUBLISH_BLOCKED_MAX_LINKS, PublishBlockedNotice } from '../ui';

/**
 * UI-D-394 / UI-D-395 — the curriculum's building blocks as observable contracts: the module card's
 * numeral and optional lock caption, the lesson row's four thumb states and optional pill, the
 * publish-blocked notice's five-link cap. They ship NO words (PWA-03): sentinel ASCII throughout.
 */

afterEach(cleanup);

const ARROWS = (
  <>
    <button type="button">up-sentinel</button>
    <button type="button">down-sentinel</button>
  </>
);

describe('ModuleCard (UI-D-395)', () => {
  it('1. renders the numeral with its accessible name, the title, the meta, the arrows slot and the edit control', () => {
    const onEdit = vi.fn();
    render(
      <ModuleCard
        id="m1"
        position={3}
        positionLabel="position-sentinel"
        title="title-sentinel"
        meta="meta-sentinel"
        arrows={ARROWS}
        onEdit={onEdit}
        editLabel="edit-sentinel"
      >
        <p>body-sentinel</p>
      </ModuleCard>,
    );
    const numeral = screen.getByTestId('module-card-numeral');
    expect(numeral.textContent).toContain('3');
    expect(numeral.textContent).toContain('position-sentinel');
    for (const token of ['h-8', 'w-8', 'rounded-lg', 'bg-bg-tertiary']) {
      expect(numeral.className).toContain(token);
    }
    expect(screen.getByTestId('module-card-title')).toHaveTextContent('title-sentinel');
    expect(screen.getByTestId('module-card-title').className).toContain('line-clamp-2');
    expect(screen.getByTestId('module-card-meta')).toHaveTextContent('meta-sentinel');
    expect(screen.getByRole('button', { name: 'up-sentinel' })).toBeInTheDocument();
    expect(screen.getByText('body-sentinel')).toBeInTheDocument();

    const edit = screen.getByRole('button', { name: 'edit-sentinel' });
    expect(edit.getAttribute('data-module-edit')).toBe('m1');
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);
    // The card is the shipped Card with no padding of its own; the header is the 56px row.
    expect(screen.getByTestId('module-card').className).toContain('p-0');
  });

  it('2. the lock caption renders ONLY when the host passes it (never on the first module)', () => {
    const base = {
      id: 'm1',
      position: 1,
      positionLabel: 'p',
      title: 't',
      meta: 'm',
      arrows: ARROWS,
      onEdit: () => {},
      editLabel: 'e',
    };
    render(<ModuleCard {...base}>x</ModuleCard>);
    expect(screen.queryByTestId('module-card-lock')).toBeNull();
    cleanup();

    render(
      <ModuleCard {...base} position={2} requiresPreviousLabel="lock-sentinel">
        x
      </ModuleCard>,
    );
    const lock = screen.getByTestId('module-card-lock');
    expect(lock).toHaveTextContent('lock-sentinel');
    expect(lock.querySelectorAll('svg')).toHaveLength(1);
  });
});

describe('LessonRow (UI-D-395)', () => {
  const base = {
    id: 'l1',
    href: '/cursos/c1/aulas/l1',
    title: 'title-sentinel',
    meta: 'meta-sentinel',
    ariaLabel: 'aria-sentinel',
  };

  it('3. is ONE link with the host href and name, the title, the meta, and the trailing slot OUTSIDE the link', () => {
    render(
      <LessonRow
        {...base}
        thumb={{ kind: 'practice' }}
        trailing={<button type="button">arrow-sentinel</button>}
      />,
    );
    const link = screen.getByRole('link', { name: 'aria-sentinel' });
    expect(link).toHaveAttribute('href', '/cursos/c1/aulas/l1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByTestId('lesson-row-title')).toHaveTextContent('title-sentinel');
    expect(screen.getByTestId('lesson-row-title').className).toContain('line-clamp-2');
    expect(screen.getByTestId('lesson-row-meta')).toHaveTextContent('meta-sentinel');
    const arrow = screen.getByRole('button', { name: 'arrow-sentinel' });
    expect(link.contains(arrow)).toBe(false);
    expect(screen.getByTestId('lesson-row').contains(arrow)).toBe(true);
    expect(screen.getByTestId('lesson-row').getAttribute('data-lesson-row')).toBe('l1');
  });

  it('4. the thumb is a 64px 16:9 box on bg-bg-tertiary in four states: poster, processing spinner, practice file, failed camera', () => {
    render(<LessonRow {...base} thumb={{ kind: 'poster', src: 'data:,' }} />);
    let thumb = screen.getByTestId('lesson-row-thumb');
    for (const token of ['w-16', 'aspect-video', 'rounded-lg', 'bg-bg-tertiary', 'shrink-0']) {
      expect(thumb.className).toContain(token);
    }
    expect(thumb.getAttribute('data-thumb')).toBe('poster');
    expect(thumb.querySelector('img')).toHaveAttribute('src', 'data:,');
    expect(thumb.querySelector('img')?.className).toContain('object-cover');
    expect(thumb.querySelector('svg')).toBeNull();
    cleanup();

    render(<LessonRow {...base} thumb={{ kind: 'processing' }} />);
    thumb = screen.getByTestId('lesson-row-thumb');
    expect(thumb.getAttribute('data-thumb')).toBe('processing');
    expect(thumb.querySelector('img')).toBeNull();
    expect(thumb.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
    cleanup();

    render(<LessonRow {...base} thumb={{ kind: 'practice' }} />);
    thumb = screen.getByTestId('lesson-row-thumb');
    expect(thumb.getAttribute('data-thumb')).toBe('practice');
    expect(thumb.querySelectorAll('svg')).toHaveLength(1);
    expect(thumb.querySelector('svg')?.getAttribute('class')).not.toContain('animate-spin');
    cleanup();

    render(<LessonRow {...base} thumb={{ kind: 'failed' }} />);
    thumb = screen.getByTestId('lesson-row-thumb');
    expect(thumb.getAttribute('data-thumb')).toBe('failed');
    expect(thumb.querySelectorAll('svg')).toHaveLength(1);
  });

  it('5. a poster that fails to load falls back to a glyph, never a broken image', () => {
    render(<LessonRow {...base} thumb={{ kind: 'poster', src: 'data:,' }} />);
    const img = screen.getByTestId('lesson-row-thumb').querySelector('img');
    if (!img) throw new Error('no poster');
    fireEvent.error(img);
    const thumb = screen.getByTestId('lesson-row-thumb');
    expect(thumb.querySelector('img')).toBeNull();
    expect(thumb.getAttribute('data-thumb')).toBe('poster-missing');
    expect(thumb.querySelectorAll('svg')).toHaveLength(1);
  });

  it('6. the pill renders ONLY when given, as words with its tone, inside the link and never shrinking', () => {
    render(<LessonRow {...base} thumb={{ kind: 'practice' }} />);
    expect(screen.queryByTestId('lesson-row-pill')).toBeNull();
    cleanup();

    render(
      <LessonRow
        {...base}
        thumb={{ kind: 'processing' }}
        pill={{ label: 'pill-sentinel', tone: 'warning' }}
      />,
    );
    const pill = screen.getByTestId('lesson-row-pill');
    expect(pill).toHaveTextContent('pill-sentinel');
    expect(pill).toHaveAttribute('data-tone', 'warning');
    expect(pill.className).toContain('shrink-0');
    expect(screen.getByRole('link').contains(pill)).toBe(true);
  });
});

describe('PublishBlockedNotice (UI-D-394)', () => {
  const links = Array.from({ length: 7 }, (_, index) => ({
    href: `/cursos/c1/aulas/l${index + 1}`,
    label: `lesson-${index + 1}`,
  }));

  it('7. is a role=status warning card with the sentence and the glyph, focusable by the host', () => {
    render(<PublishBlockedNotice sentence="sentence-sentinel" links={links.slice(0, 1)} />);
    const notice = screen.getByRole('status');
    expect(notice.getAttribute('tabindex')).toBe('-1');
    expect(notice.className).toContain('bg-warning/10');
    expect(notice.querySelector('svg')?.getAttribute('class')).toContain('text-warning');
    expect(screen.getByTestId('publish-blocked-sentence')).toHaveTextContent('sentence-sentinel');
    expect(within(notice).getAllByRole('link')).toHaveLength(1);
    expect(within(notice).getByRole('link', { name: 'lesson-1' })).toHaveAttribute(
      'href',
      '/cursos/c1/aulas/l1',
    );
    expect(screen.queryByTestId('publish-blocked-more')).toBeNull();
  });

  it('8. renders at most five lesson links, then the more link, for seven items', () => {
    render(
      <PublishBlockedNotice
        sentence="s"
        links={links}
        moreHref="/cursos/c1#modulos"
        moreLabel="more-sentinel"
      />,
    );
    expect(PUBLISH_BLOCKED_MAX_LINKS).toBe(5);
    expect(screen.getAllByTestId('publish-blocked-link')).toHaveLength(5);
    expect(screen.getAllByTestId('publish-blocked-link').map((a) => a.textContent)).toEqual([
      'lesson-1',
      'lesson-2',
      'lesson-3',
      'lesson-4',
      'lesson-5',
    ]);
    const more = screen.getByTestId('publish-blocked-more');
    expect(more).toHaveTextContent('more-sentinel');
    expect(more).toHaveAttribute('href', '/cursos/c1#modulos');
  });

  it('9. five items or fewer render every link and NO more link even when the host passes one', () => {
    render(
      <PublishBlockedNotice
        sentence="s"
        links={links.slice(0, 5)}
        moreHref="/x"
        moreLabel="more-sentinel"
      />,
    );
    expect(screen.getAllByTestId('publish-blocked-link')).toHaveLength(5);
    expect(screen.queryByTestId('publish-blocked-more')).toBeNull();
  });
});
