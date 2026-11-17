// @vitest-environment happy-dom

import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { INBOX_DEFAULTS, type InboxQueryState, serializeInboxQuery } from '@/lib/inbox-query';
import { InboxFilters } from './InboxFilters';

/**
 * 12.4-14 Task 1 (UI-D-823; UC S01 populated): the team's tabs with the shipped `Tabs`, three of them, 'Em
 * aberto' the default, with no counts. The catalog is the real pt-BR one.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

function renderFilters(query: InboxQueryState = INBOX_DEFAULTS) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <InboxFilters query={query} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return { onChange };
}

afterEach(cleanup);

describe('the tabs (UI-D-823, A-UI-5, A-UI-21)', () => {
  it('shows three tabs by their words and Em aberto selected by default', () => {
    renderFilters();
    const list = screen.getByRole('tablist', { name: 'Chamados por estado' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Em aberto', 'Resolvidos', 'Fechados']);
    expect(screen.getByRole('tab', { name: 'Em aberto' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Resolvidos' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('no tab carries a count', () => {
    renderFilters();
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.textContent).not.toMatch(/\d/);
    }
  });

  it('activating Resolvidos hands the new state up: aba=resolvidos, the rest kept', () => {
    const { onChange } = renderFilters({
      tab: 'em-aberto',
      owner: 'eu',
      priority: 'alta',
      awaiting: false,
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Resolvidos' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as InboxQueryState;
    expect(next).toEqual({ tab: 'resolvidos', owner: 'eu', priority: 'alta', awaiting: false });
    expect(serializeInboxQuery(next)).toBe('aba=resolvidos&resp=eu&prio=alta');
  });

  it('the selected tab follows the state it is given', () => {
    renderFilters({ ...INBOX_DEFAULTS, tab: 'fechados' });
    expect(screen.getByRole('tab', { name: 'Fechados' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});
