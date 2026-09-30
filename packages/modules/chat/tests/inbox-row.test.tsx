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
