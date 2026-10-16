// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemberLessonRow, MemberLessonThumb, ModuleCover, ProgressRing } from '../ui';

/**
 * 08.5-07 — the member curriculum's ported parts as an observable contract (UI-D-429, UI-D-430,
 * UI-D-443, A-UI-3, PR-3). No words ship in the module (PWA-03): every string is a sentinel prop.
 */

afterEach(cleanup);

const COVER = '11111111-1111-4111-8111-111111111111';
const WIDTHS = [320, 640] as const;

function Band({
  state = { kind: 'ring', percent: 40 } as const,
  metaLocked = false,
}: {
  state?: { kind: 'done' } | { kind: 'locked' } | { kind: 'ring'; percent: number };
  metaLocked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ModuleCover
        id="m1"
        ariaLabel="band-aria"
        expanded={open}
        controlsId="list-m1"
        onToggle={() => setOpen((value) => !value)}
        numeral="01"
        pill="pill-sentinel"
        title="title-sentinel"
        meta="meta-sentinel"
        metaLocked={metaLocked}
        state={state}
        coverAssetId={COVER}
        coverWidths={WIDTHS}
      />
      {open ? <ol id="list-m1" data-testid="list" /> : null}
    </>
  );
}

describe('ModuleCover (UI-D-429)', () => {
  it('1. is a never-disabled button whose aria-expanded toggles and which names its list', () => {
    render(<Band state={{ kind: 'locked' }} />);
    const band = screen.getByRole('button', { name: 'band-aria' });
    expect(band).not.toBeDisabled();
    expect(band).toHaveAttribute('type', 'button');
    expect(band).toHaveAttribute('aria-controls', 'list-m1');
    expect(band).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(band);
    expect(band).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('list')).toBeInTheDocument();
    fireEvent.click(band);
    expect(band).toHaveAttribute('aria-expanded', 'false');
  });

  it('2. 16:6, the pill, the title, the meta and the numeral; nothing desaturated', () => {
    const { container } = render(<Band state={{ kind: 'locked' }} metaLocked />);
    const band = screen.getByTestId('module-cover');
    expect(band.className).toContain('aspect-[16/6]');
    expect(screen.getByTestId('module-cover-pill')).toHaveTextContent('pill-sentinel');
    expect(screen.getByTestId('module-cover-title')).toHaveTextContent('title-sentinel');
    expect(screen.getByTestId('module-cover-meta')).toHaveTextContent('meta-sentinel');
    expect(container.innerHTML).not.toMatch(/grayscale|bg-black\/55/);
  });

  it('3. the 32px state: done disc, lock disc, or the ring', () => {
    const { rerender } = render(<Band state={{ kind: 'done' }} />);
    expect(screen.getByTestId('module-cover')).toHaveAttribute('data-state', 'done');
    expect(screen.queryByTestId('progress-ring')).toBeNull();
    rerender(<Band state={{ kind: 'ring', percent: 40 }} />);
    expect(screen.getByTestId('progress-ring')).toHaveAttribute('data-percent', '40');
  });

  it('4. the band title is one line below 360px and two from 360px (sketch 010 finding 1)', () => {
    render(<Band />);
    const title = screen.getByTestId('module-cover-title');
    expect(title.className).toContain('line-clamp-1');
    expect(title.className).toContain('min-[360px]:line-clamp-2');
  });
});

describe('ProgressRing (UI-D-429, UI-D-443)', () => {
  it('is aria-hidden, 32px, clamps its value and carries no animation', () => {
    const { container } = render(<ProgressRing percent={140} />);
    const ring = screen.getByTestId('progress-ring');
    expect(ring).toHaveAttribute('aria-hidden', 'true');
    expect(ring).toHaveAttribute('width', '32');
    expect(ring).toHaveAttribute('data-percent', '100');
    expect(container.innerHTML).not.toMatch(/animate|transition/);
  });
});

const row = {
  id: 'l1',
  href: '/cursos/c1/aulas/l1',
  title: 'title-sentinel',
  coverAssetId: COVER,
  coverWidths: WIDTHS,
};

describe('MemberLessonRow (UI-D-430, A-UI-3)', () => {
  it('1. a LOCKED row is still a link to the lesson URL, with the lock meta and the trailing lock', () => {
    render(
      <MemberLessonRow
        {...row}
        ariaLabel="row-aria"
        meta="lock-sentinel"
        metaLocked
        trailing="locked"
        thumbState="locked"
      />,
    );
    const link = screen.getByRole('link', { name: 'row-aria' });
    expect(link).toHaveAttribute('href', '/cursos/c1/aulas/l1');
    expect(screen.getByTestId('member-lesson-meta')).toHaveTextContent('lock-sentinel');
    expect(link).toHaveAttribute('data-trailing', 'locked');
    expect(screen.getByTestId('member-lesson-thumb')).toHaveAttribute('data-state', 'locked');
    expect(link).not.toHaveAttribute('aria-current');
  });

  it('2. no grayscale anywhere in a locked row or thumb', () => {
    const { container } = render(
      <MemberLessonRow
        {...row}
        ariaLabel="row-aria"
        meta="m"
        metaLocked
        trailing="locked"
        thumbState="locked"
      />,
    );
    expect(container.innerHTML).not.toMatch(/grayscale/);
  });

  it('3. the current row carries aria-current="page" and the tertiary ground', () => {
    render(
      <MemberLessonRow
        {...row}
        ariaLabel="row-aria"
        meta="current-sentinel"
        trailing="chevron"
        thumbState="open"
        current
      />,
    );
    const link = screen.getByRole('link', { name: 'row-aria' });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link.className).toContain('bg-bg-tertiary');
    expect(link.className).toContain('rounded-xl');
  });

  it('4. min-h-14 row, line-clamp-2 title, done → the trailing check', () => {
    render(
      <MemberLessonRow {...row} ariaLabel="row-aria" meta="m" trailing="done" thumbState="done" />,
    );
    const link = screen.getByRole('link', { name: 'row-aria' });
    expect(link.className).toContain('min-h-14');
    expect(screen.getByTestId('member-lesson-title').className).toContain('line-clamp-2');
    expect(link).toHaveAttribute('data-trailing', 'done');
  });
});

describe('MemberLessonThumb (UI-D-430)', () => {
  it('80px 16:9, the resume bar only in progress, the gradient without a cover', () => {
    const { rerender } = render(
      <MemberLessonThumb
        state="progress"
        resumePercent={30}
        coverAssetId={null}
        coverWidths={WIDTHS}
      />,
    );
    const thumb = screen.getByTestId('member-lesson-thumb');
    expect(thumb.className).toContain('w-20');
    expect(thumb.className).toContain('aspect-video');
    expect(thumb).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('member-lesson-thumb-resume')).toBeInTheDocument();
    expect(screen.getByTestId('member-lesson-thumb-fallback').getAttribute('style')).toContain(
      '--brand-gradient',
    );
    rerender(<MemberLessonThumb state="open" coverAssetId={null} coverWidths={WIDTHS} />);
    expect(screen.queryByTestId('member-lesson-thumb-resume')).toBeNull();
  });
});
