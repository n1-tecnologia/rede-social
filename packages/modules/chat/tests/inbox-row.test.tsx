// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { InboxRow, type InboxRowProps } from '../ui/index';

/**
 * UI-D-262 as observable contract. The row ships NO words: every string below is a sentinel handed
 * in as a prop, so a copy change cannot turn this file red, and the last case proves no other text
 * reaches the DOM.
 */

afterEach(cleanup);

const base: InboxRowProps = {
  href: '/suporte/c1',
  avatar: 'https://cdn.exemplo/avatar.webp',
  name: 'name-sentinel',
  preview: 'preview-sentinel',
  time: '14:02',
  awaiting: false,
  awaitingSr: ', awaiting-sentinel',
  state: 'active',
  blockedLabel: 'blocked-sentinel',
};

const row = () => screen.getByRole('link');

describe('InboxRow (UI-D-262)', () => {
  it('is one link to the conversation with the name, preview and time', () => {
    render(<InboxRow {...base} />);
    expect(row()).toHaveAttribute('href', '/suporte/c1');
    expect(row()).not.toHaveAttribute('aria-current');
    expect(row().querySelector('[data-inbox-name]')).toHaveTextContent('name-sentinel');
    expect(row().querySelector('[data-inbox-name]')).toHaveClass('font-bold', 'truncate');
    expect(row().querySelector('[data-inbox-preview]')).toHaveClass(
      'truncate',
      'text-text-secondary',
    );
    expect(row().querySelector('[data-inbox-time]')).toHaveTextContent('14:02');
    expect(row().querySelector('[data-inbox-time]')).toHaveClass('tabular-nums');
    expect(row().querySelector('[data-inbox-dot]')).toBeNull();
    // happy-dom reports every image as failed after mount, so the photo is read from the server
    // render (the first paint a phone gets).
    expect(renderToStaticMarkup(<InboxRow {...base} />)).toContain(`src="${base.avatar}"`);
  });

  it('awaiting: the brand dot under the time, the preview in text-text, the sr suffix on the name', () => {
    render(<InboxRow {...base} awaiting />);
    const dot = row().querySelector('[data-inbox-dot]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveClass('h-2', 'w-2', 'rounded-full', 'bg-brand');
    expect(dot).toHaveAttribute('aria-hidden');
    expect(row().querySelector('[data-inbox-preview]')).toHaveClass('text-text');
    expect(row().querySelector('[data-inbox-preview]')).not.toHaveClass('text-text-secondary');
    expect(row().querySelector('[data-inbox-name] .sr-only')).toHaveTextContent(
      ', awaiting-sentinel',
    );
    expect(row()).toHaveAttribute('data-awaiting');
  });

  it('blocked: the neutral pill takes the dot slot, even when awaiting', () => {
    render(<InboxRow {...base} state="blocked" awaiting />);
    const pill = row().querySelector('[data-inbox-blocked]');
    expect(pill).toHaveTextContent('blocked-sentinel');
    expect(pill).toHaveClass('bg-bg-tertiary', 'text-text-secondary');
    expect(row().querySelector('[data-inbox-dot]')).toBeNull();
  });

  it('departed: the removed name 14/400 tertiary and the neutral avatar, whatever src arrives', () => {
    render(<InboxRow {...base} state="removed" name="removed-sentinel" />);
    const name = row().querySelector('[data-inbox-name]');
    expect(name).toHaveTextContent('removed-sentinel');
    expect(name).toHaveClass('font-normal', 'text-text-tertiary');
    expect(name).not.toHaveClass('font-bold');
    expect(renderToStaticMarkup(<InboxRow {...base} state="removed" />)).not.toContain('<img');
    expect(row().querySelector('svg')).not.toBeNull();
  });

  it('no avatar: the User fallback', () => {
    render(<InboxRow {...base} avatar={null} />);
    expect(renderToStaticMarkup(<InboxRow {...base} avatar={null} />)).not.toContain('<img');
    expect(row().querySelector('svg')).not.toBeNull();
  });

  it('active: bg-bg-active with aria-current="page" (UI-D-264)', () => {
    render(<InboxRow {...base} active />);
    expect(row()).toHaveAttribute('aria-current', 'page');
    expect(row()).toHaveClass('bg-bg-active');
  });

  it('overflow: the text column is min-w-0 flex-1 and the trailing column shrink-0', () => {
    render(<InboxRow {...base} name={'N'.repeat(80)} preview={'P'.repeat(200)} />);
    const column = row().querySelector('[data-inbox-name]')?.parentElement;
    expect(column).toHaveClass('min-w-0', 'flex-1');
    const trailing = row().querySelector('[data-inbox-time]')?.parentElement;
    expect(trailing).toHaveClass('shrink-0');
    expect(row()).toHaveClass('min-h-18');
  });

  it('ships no words: every text node comes from a prop', () => {
    render(<InboxRow {...base} awaiting state="blocked" />);
    const text = row().textContent ?? '';
    const stripped = [
      'name-sentinel',
      ', awaiting-sentinel',
      'preview-sentinel',
      '14:02',
      'blocked-sentinel',
    ].reduce((rest, piece) => rest.replace(piece, ''), text);
    expect(stripped).toBe('');
  });
});

/**
 * 12.4-14 Task 1 (UI-D-824, A-UI-7, A-UI-24; UC S06, S07, S08): the case facts. The host hands finished
 * strings and nodes (the module ships no word and imports neither the catalog nor `next/link`), so the
 * pills below are plain sentinels. jsdom has no layout: the "grows with its content" rule is read from
 * the classes (no fixed height, top alignment, `flex-wrap` on the meta line).
 */
const withCase: InboxRowProps = {
  ...base,
  subjectLine: '#42 · subject-sentinel',
  statePill: <span data-testid="state-pill">state-sentinel</span>,
  metaText: 'meta-sentinel',
};

describe('InboxRow with the case facts (UI-D-824)', () => {
  it('renders the subject line, the state pill, the optional priority pill and the meta text', () => {
    render(
      <InboxRow
        {...withCase}
        priorityPill={<span data-testid="priority-pill">priority-sentinel</span>}
      />,
    );
    expect(row().querySelector('[data-inbox-subject]')).toHaveTextContent('#42 · subject-sentinel');
    expect(row().querySelector('[data-inbox-subject]')).toHaveClass(
      'truncate',
      'text-sm',
      'font-normal',
      'text-text',
    );
    const meta = row().querySelector('[data-inbox-meta]');
    expect(meta).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-x-2', 'gap-y-1');
    expect(meta).toContainElement(screen.getByTestId('state-pill'));
    expect(meta).toContainElement(screen.getByTestId('priority-pill'));
    expect(row().querySelector('[data-inbox-meta-text]')).toHaveTextContent('meta-sentinel');
    expect(row().querySelector('[data-inbox-meta-text]')).toHaveClass(
      'text-xs',
      'font-normal',
      'text-text-tertiary',
    );
  });

  it('draws no priority pill when the host passes none (Normal draws nothing, A-UI-7)', () => {
    render(<InboxRow {...withCase} />);
    expect(screen.queryByTestId('priority-pill')).toBeNull();
    expect(row().querySelector('[data-inbox-meta]')).not.toBeNull();
  });

  it('the line order is name, subject, preview, meta; the time column stays last', () => {
    render(<InboxRow {...withCase} />);
    const column = row().querySelector('[data-inbox-name]')?.parentElement;
    const order = Array.from(column?.children ?? []).map((child) =>
      child.hasAttribute('data-inbox-name')
        ? 'name'
        : child.hasAttribute('data-inbox-subject')
          ? 'subject'
          : child.hasAttribute('data-inbox-preview')
            ? 'preview'
            : child.hasAttribute('data-inbox-meta')
              ? 'meta'
              : 'other',
    );
    expect(order).toEqual(['name', 'subject', 'preview', 'meta']);
    expect(row().lastElementChild).toContainElement(row().querySelector('[data-inbox-time]'));
  });

  it('the row grows with its content: top aligned, no fixed height, a padded flex-col column', () => {
    render(<InboxRow {...withCase} metaText={'M'.repeat(200)} />);
    expect(row()).toHaveClass('items-start', 'min-h-18', 'gap-3', 'py-3');
    expect(row()).not.toHaveClass('items-center');
    expect(row().className).not.toMatch(/(^|\s)h-(\d|\[|full|auto)/);
    const avatar = row().firstElementChild;
    expect(avatar).toHaveClass('self-start');
    const column = row().querySelector('[data-inbox-name]')?.parentElement;
    expect(column).toHaveClass('flex', 'min-w-0', 'flex-1', 'flex-col', 'gap-1');
    // The meta line wraps (it never truncates), so a long meta text makes the row taller, not wider.
    expect(row().querySelector('[data-inbox-meta]')).toHaveClass('flex-wrap');
    expect(row().querySelector('[data-inbox-meta-text]')).not.toHaveClass('truncate');
  });

  it('a row with no case facts has no subject line and no meta line', () => {
    render(<InboxRow {...base} />);
    expect(row().querySelector('[data-inbox-subject]')).toBeNull();
    expect(row().querySelector('[data-inbox-meta]')).toBeNull();
  });

  it('awaiting keeps the dot and the screen-reader suffix next to the case facts', () => {
    render(<InboxRow {...withCase} awaiting />);
    expect(row().querySelector('[data-inbox-dot]')).not.toBeNull();
    expect(row().querySelector('[data-inbox-name] .sr-only')).toHaveTextContent(
      ', awaiting-sentinel',
    );
    expect(row().querySelector('[data-inbox-preview]')).toHaveClass('text-text');
  });

  it('a blocked member keeps the neutral pill in the dot slot; a removed one keeps its name', () => {
    const { rerender } = render(<InboxRow {...withCase} state="blocked" awaiting />);
    expect(row().querySelector('[data-inbox-blocked]')).toHaveTextContent('blocked-sentinel');
    expect(row().querySelector('[data-inbox-dot]')).toBeNull();
    rerender(<InboxRow {...withCase} state="removed" name="removed-sentinel" />);
    expect(row().querySelector('[data-inbox-name]')).toHaveTextContent('removed-sentinel');
    expect(row().querySelector('[data-inbox-name]')).toHaveClass('text-text-tertiary');
  });

  it('every new string is React text: angle brackets stay text (T-12.4-67)', () => {
    render(
      <InboxRow
        {...withCase}
        subjectLine={'#7 · <img src=x onerror=alert(1)>'}
        metaText={'<b>x</b> · Com <i>y</i>'}
      />,
    );
    expect(row().querySelector('img')).toBeNull();
    expect(row().querySelector('b, i')).toBeNull();
    expect(row().querySelector('[data-inbox-subject]')?.textContent).toBe(
      '#7 · <img src=x onerror=alert(1)>',
    );
  });

  it('12.5 (D-860, UI-D-853): previewLeading sits inside the preview line before the text, which stays one truncated line', () => {
    render(
      <InboxRow
        {...base}
        preview="Ana: preview-voice-sentinel"
        previewLeading={<svg aria-hidden data-leading-sentinel />}
      />,
    );
    const preview = row().querySelector('[data-inbox-preview]') as HTMLElement;
    const leading = preview.querySelector('[data-leading-sentinel]');
    expect(leading).not.toBeNull();
    // The glyph comes first, then the text node's carrier.
    expect(preview.firstElementChild).toBe(leading);
    expect(preview).toHaveTextContent('Ana: preview-voice-sentinel');
    const text = preview.querySelector('[data-inbox-preview-text]') as HTMLElement;
    expect(text).toHaveClass('truncate', 'min-w-0');
    expect(text).toHaveTextContent('Ana: preview-voice-sentinel');
    expect(preview).toHaveClass('flex', 'min-w-0');
  });

  it('12.5: the preview ink is text-text while awaiting and text-text-secondary otherwise, with a leading node too', () => {
    const leading = <svg aria-hidden />;
    const { rerender } = render(<InboxRow {...base} previewLeading={leading} />);
    expect(row().querySelector('[data-inbox-preview]')).toHaveClass('text-text-secondary');
    expect(row().querySelector('[data-inbox-preview]')).not.toHaveClass('text-text');
    rerender(<InboxRow {...base} awaiting previewLeading={leading} />);
    expect(row().querySelector('[data-inbox-preview]')).toHaveClass('text-text');
    expect(row().querySelector('[data-inbox-preview]')).not.toHaveClass('text-text-secondary');
  });

  it('12.5: a row with no previewLeading renders the markup it always did', () => {
    const html = renderToStaticMarkup(<InboxRow {...base} />);
    expect(html).toContain(
      '<span data-inbox-preview="true" class="truncate text-sm font-normal text-text-secondary">preview-sentinel</span>',
    );
    expect(html).not.toContain('data-inbox-preview-text');
  });

  it('still ships no words: every text node comes from a prop', () => {
    render(<InboxRow {...withCase} awaiting />);
    const stripped = [
      'name-sentinel',
      ', awaiting-sentinel',
      'preview-sentinel',
      '14:02',
      '#42 · subject-sentinel',
      'state-sentinel',
      'meta-sentinel',
    ].reduce((rest, piece) => rest.replace(piece, ''), row().textContent ?? '');
    expect(stripped).toBe('');
  });
});
