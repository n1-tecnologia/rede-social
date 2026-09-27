// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AttendeeRow } from '../ui/AttendeeRow';
import { CheckinCodeCard } from '../ui/CheckinCodeCard';

/**
 * 06-07 — the `Participantes` pieces (UI-D-213, sketch 006 Surface 6), as observable contract. Every
 * string is a sentinel prop (PWA-03): the module ships no words, and it never fetches the code.
 */

afterEach(cleanup);

const card = {
  label: 'label-sentinel',
  codeAriaLabel: 'aria-sentinel K, 7, Q, M',
  helper: 'helper-sentinel',
  onlineNote: 'online-sentinel',
};

describe('CheckinCodeCard (UI-D-213)', () => {
  it('1. with a code: label, the 24/700 spaced code in text-text with the spelled aria-label, helper, then the action slot', () => {
    render(<CheckinCodeCard {...card} code="K7QM" action={<button type="button">act</button>} />);
    const root = screen.getByTestId('checkin-code-card');
    expect(root).toHaveAttribute('data-kind', 'code');
    expect(root.className).toContain('mx-4');
    expect(root.className).toContain('text-center');
    const glyphs = screen.getByTestId('checkin-code');
    expect(glyphs).toHaveTextContent('K7QM');
    // A screen reader hears the spelled name, never "K7QM" read as a word.
    expect(glyphs).toHaveAttribute('aria-hidden', 'true');
    const spelled = screen.getByTestId('checkin-code-spelled');
    expect(spelled).toHaveTextContent('aria-sentinel K, 7, Q, M');
    expect(spelled.className).toContain('sr-only');
    const code = glyphs.parentElement as HTMLElement;
    for (const token of [
      'text-2xl',
      'font-bold',
      'uppercase',
      'tracking-[0.3em]',
      'tabular-nums',
      'text-text',
    ]) {
      expect(code.className).toContain(token);
    }
    // The code is NOT the brand colour: the only brand fill on the screen is the active chip.
    expect(code.className).not.toContain('brand');
    expect(screen.getByText('label-sentinel')).toBeInTheDocument();
    expect(screen.getByText('helper-sentinel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'act' })).toBeInTheDocument();
    expect(screen.queryByText('online-sentinel')).toBeNull();
  });

  it('2. online (code null): the Video icon and the online note, no code, no label, no action', () => {
    render(<CheckinCodeCard {...card} code={null} action={<button type="button">act</button>} />);
    const root = screen.getByTestId('checkin-code-card');
    expect(root).toHaveAttribute('data-kind', 'online');
    expect(screen.getByText('online-sentinel')).toBeInTheDocument();
    expect(root.querySelector('svg')).not.toBeNull();
    expect(screen.queryByTestId('checkin-code')).toBeNull();
    expect(screen.queryByText('label-sentinel')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('3. no action: nothing renders under the helper', () => {
    render(<CheckinCodeCard {...card} code="K7QM" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('AttendeeRow (UI-D-213)', () => {
  it('4. a row: avatar, a truncating 14/700 name, the tabular meta, and no link', () => {
    render(
      <AttendeeRow name="name-sentinel" removed={false} avatarUrl={null} meta="meta-sentinel" />,
    );
    const row = screen.getByTestId('attendee-row');
    for (const token of ['min-h-14', 'border-b', 'border-divider', 'items-center', 'gap-3']) {
      expect(row.className).toContain(token);
    }
    const name = screen.getByText('name-sentinel');
    expect(name.className).toContain('truncate');
    expect(name.className).toContain('font-bold');
    expect(screen.getByText('meta-sentinel').className).toContain('tabular-nums');
    expect(row.querySelector('a')).toBeNull();
    expect(row).not.toHaveAttribute('data-removed');
    expect(screen.getByRole('img', { name: 'name-sentinel' })).toBeInTheDocument();
  });

  it('5. a removed member: the label is 14/400 tertiary and the avatar is the neutral icon even if a URL leaks in', () => {
    render(
      <AttendeeRow
        name="removed-sentinel"
        removed
        avatarUrl="/v1/media/a1111111-1111-4111-8111-111111111111/w128"
        meta="meta-sentinel"
      />,
    );
    const row = screen.getByTestId('attendee-row');
    expect(row).toHaveAttribute('data-removed', 'true');
    const label = screen.getByText('removed-sentinel');
    expect(label.className).toContain('font-normal');
    expect(label.className).toContain('text-text-tertiary');
    expect(row.querySelector('img')).toBeNull();
  });

  it('6. the tag slot is a shrink-0 trailing child, after the name column', () => {
    render(
      <AttendeeRow
        name={'n'.repeat(80)}
        removed={false}
        avatarUrl={null}
        meta="meta-sentinel"
        tag={<span>tag-sentinel</span>}
      />,
    );
    const row = screen.getByTestId('attendee-row');
    const tag = screen.getByText('tag-sentinel').parentElement;
    expect(tag?.className).toContain('shrink-0');
    expect(row.lastElementChild).toBe(tag);
    expect(row.querySelector('.min-w-0.flex-1')).not.toBeNull();
  });
});
