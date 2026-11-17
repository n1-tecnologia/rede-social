// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { INBOX_DEFAULTS, type InboxQueryState, serializeInboxQuery } from '@/lib/inbox-query';
import { InboxFilters } from './InboxFilters';

/**
 * 12.4-14 Task 1 (UI-D-823; UC S01 populated): the team's tabs with the shipped `Tabs`, three of them, 'Em
 * aberto' the default, with no counts. The catalog is the real pt-BR one.
 */

/** The sheet's spring has no frames in happy-dom: skip it, like the other sheet suites do. */
MotionGlobalConfig.skipAnimations = true;

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

const fetchMock = vi.fn();
const ANA = { userId: '11111111-1111-4111-8111-111111111111', name: 'Ana Souza' };
const BRUNO = { userId: '22222222-2222-4222-8222-222222222222', name: 'Bruno' };
let staffAnswer: () => Promise<Response> | Response = () => Response.json({ items: [ANA, BRUNO] });
const staffCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url) === '/api/chat/staff').length;

beforeEach(() => {
  staffAnswer = () => Response.json({ items: [ANA, BRUNO] });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => staffAnswer());
  vi.stubGlobal('fetch', fetchMock);
});

const hasClass = (element: Element | null | undefined, ...names: string[]) =>
  element !== null &&
  element !== undefined &&
  names.every((name) => element.classList.contains(name));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

/** A host that holds the view like the inbox does (the URL), so a tap is visible on the chips. */
function Harness({
  start = INBOX_DEFAULTS,
  onState,
}: {
  start?: InboxQueryState;
  onState?: (state: InboxQueryState) => void;
}) {
  const [query, setQuery] = useState(start);
  return (
    <InboxFilters
      query={query}
      onChange={(next) => {
        onState?.(next);
        setQuery(next);
      }}
    />
  );
}

function renderHarness(start?: InboxQueryState) {
  const onState = vi.fn();
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <Harness start={start} onState={onState} />
    </NextIntlClientProvider>,
  );
  return { onState, last: () => onState.mock.calls.at(-1)?.[0] as InboxQueryState };
}

const chip = (name: string | RegExp) => screen.getByRole('button', { name });
const dialogGone = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

describe('the filter row (UI-D-823; UC S01 overflow)', () => {
  it('never wraps and scrolls sideways', () => {
    renderHarness();
    const row = document.querySelector('[data-inbox-chips]');
    expect(row).not.toBeNull();
    expect(hasClass(row, 'flex', 'gap-2', 'overflow-x-auto', 'px-4', 'py-2')).toBe(true);
    expect(row?.className).not.toMatch(/flex-wrap/);
    for (const control of Array.from(row?.querySelectorAll('button') ?? [])) {
      expect(hasClass(control, 'shrink-0', 'whitespace-nowrap')).toBe(true);
    }
  });

  it('shows Responsável, Prioridade and, on Em aberto, the Aguardando resposta toggle', () => {
    renderHarness();
    expect(chip('Responsável')).toBeTruthy();
    expect(chip('Prioridade')).toBeTruthy();
    expect(chip('Aguardando resposta')).toBeTruthy();
  });
});

describe('the owner sheet (UI-D-823; UC S01 long-text, S03 partial)', () => {
  it('opens a sheet titled Responsável with the radio list Todos, Eu, Sem responsável and every staff member by name', async () => {
    renderHarness();
    fireEvent.click(chip('Responsável'));
    const dialog = await screen.findByRole('dialog', { name: 'Responsável' });
    const group = within(dialog).getByRole('radiogroup', { name: 'Responsável' });
    await waitFor(() =>
      expect(
        within(group)
          .getAllByRole('radio')
          .map((radio) => radio.textContent),
      ).toEqual(['Todos', 'Eu', 'Sem responsável', 'Ana Souza', 'Bruno']),
    );
    expect(within(group).getByRole('radio', { name: 'Todos' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(staffCalls()).toBe(1);
  });

  it('a tap applies at once, closes the sheet, marks the picked row and the chip reads Responsável: Eu', async () => {
    const { last } = renderHarness();
    fireEvent.click(chip('Responsável'));
    fireEvent.click(await screen.findByRole('radio', { name: 'Eu' }));
    expect(last()).toEqual({ ...INBOX_DEFAULTS, owner: 'eu' });
    await dialogGone();
    const active = chip('Responsável: Eu');
    expect(hasClass(active, 'bg-brand')).toBe(true);

    // Reopened: the picked row carries the check and aria-checked.
    fireEvent.click(active);
    const picked = await screen.findByRole('radio', { name: 'Eu' });
    expect(picked.getAttribute('aria-checked')).toBe('true');
    expect(picked.querySelector('svg[data-radio-check]')).not.toBeNull();
    expect(
      screen.getByRole('radio', { name: 'Todos' }).querySelector('svg[data-radio-check]'),
    ).toBeNull();
  });

  it('Sem responsável and a staff member write their own values', async () => {
    const { last } = renderHarness();
    fireEvent.click(chip('Responsável'));
    fireEvent.click(await screen.findByRole('radio', { name: 'Sem responsável' }));
    expect(last().owner).toBe('sem');
    await dialogGone();
    fireEvent.click(chip('Responsável: Sem responsável'));
    fireEvent.click(await screen.findByRole('radio', { name: 'Bruno' }));
    expect(last().owner).toBe(BRUNO.userId);
    await dialogGone();
    expect(hasClass(chip('Responsável: Bruno'), 'bg-brand')).toBe(true);
  });

  it('a long staff name truncates on one line in its row and in the chip (UC S01 long-text)', async () => {
    const long = 'N'.repeat(60);
    staffAnswer = () => Response.json({ items: [{ userId: ANA.userId, name: long }] });
    renderHarness({ ...INBOX_DEFAULTS, owner: ANA.userId });
    const active = await screen.findByRole('button', { name: `Responsável: ${long}` });
    expect(hasClass(active.querySelector('[data-chip-text]'), 'truncate')).toBe(true);
    fireEvent.click(active);
    const row = await screen.findByRole('radio', { name: long });
    expect(hasClass(row.querySelector('[data-radio-label]'), 'truncate')).toBe(true);
    expect(hasClass(row, 'min-w-0')).toBe(true);
  });

  it('returns the focus to the chip that opened the sheet', async () => {
    renderHarness();
    const opener = chip('Responsável');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole('radio', { name: 'Eu' }));
    await dialogGone();
    await waitFor(() => expect(document.activeElement).toBe(chip('Responsável: Eu')));
  });

  it('a chip that opens a sheet is not a toggle: no aria-pressed, a dialog popup instead', () => {
    renderHarness();
    expect(chip('Responsável').hasAttribute('aria-pressed')).toBe(false);
    expect(chip('Responsável').getAttribute('aria-haspopup')).toBe('dialog');
  });
});

describe('the shared roster states (sketch 023 outcome 7; UC S11 and S03 loading)', () => {
  it('shows three skeleton radio rows while the staff list loads', async () => {
    let release: (response: Response) => void = () => {};
    staffAnswer = () => new Promise<Response>((resolve) => (release = resolve));
    renderHarness();
    fireEvent.click(chip('Responsável'));
    const group = await screen.findByRole('radiogroup', { name: 'Responsável' });
    expect(group.querySelectorAll('[data-roster-skeleton]')).toHaveLength(3);
    // The three fixed rows are already there; only the names wait.
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    await act(async () => release(Response.json({ items: [ANA] })));
    await waitFor(() => expect(group.querySelectorAll('[data-roster-skeleton]')).toHaveLength(0));
  });

  it('a failed read shows the inline line and a ghost "Tentar novamente" that reads again', async () => {
    staffAnswer = () => new Response(null, { status: 500 });
    renderHarness();
    fireEvent.click(chip('Responsável'));
    expect(await screen.findByText('Não foi possível carregar a equipe.')).toBeTruthy();
    staffAnswer = () => Response.json({ items: [ANA] });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('radio', { name: 'Ana Souza' })).toBeTruthy();
    expect(screen.queryByText('Não foi possível carregar a equipe.')).toBeNull();
    expect(staffCalls()).toBe(2);
  });

  it('the sheet is the only reason to read the roster: closed and no staff owner in the URL, no fetch', () => {
    renderHarness();
    expect(staffCalls()).toBe(0);
  });

  it('a staff owner in the URL reads the roster so the chip can say the name', async () => {
    renderHarness({ ...INBOX_DEFAULTS, owner: BRUNO.userId });
    expect(await screen.findByRole('button', { name: 'Responsável: Bruno' })).toBeTruthy();
    expect(staffCalls()).toBe(1);
  });

  it('a staff owner who left the team keeps the chip active with the plain word', async () => {
    renderHarness({ ...INBOX_DEFAULTS, owner: '33333333-3333-4333-8333-333333333333' });
    await waitFor(() => expect(staffCalls()).toBe(1));
    const active = await screen.findByRole('button', { name: 'Responsável' });
    expect(hasClass(active, 'bg-brand')).toBe(true);
  });
});

describe('the priority sheet', () => {
  it('lists Todas, Alta, Normal, Baixa and applies a tap at once', async () => {
    const { last } = renderHarness();
    fireEvent.click(chip('Prioridade'));
    const dialog = await screen.findByRole('dialog', { name: 'Prioridade' });
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Todas', 'Alta', 'Normal', 'Baixa']);
    expect(within(dialog).getByRole('radio', { name: 'Todas' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Alta' }));
    expect(last()).toEqual({ ...INBOX_DEFAULTS, priority: 'alta' });
    await dialogGone();
    expect(hasClass(chip('Prioridade: Alta'), 'bg-brand')).toBe(true);
    // Reading the staff list is not needed for the priorities.
    expect(staffCalls()).toBe(0);
  });

  it('marks the picked row with the check on reopening', async () => {
    renderHarness({ ...INBOX_DEFAULTS, priority: 'baixa' });
    fireEvent.click(chip('Prioridade: Baixa'));
    const picked = await screen.findByRole('radio', { name: 'Baixa' });
    expect(picked.getAttribute('aria-checked')).toBe('true');
    expect(picked.querySelector('svg[data-radio-check]')).not.toBeNull();
  });
});

describe('the awaiting toggle (UI-D-823, A-UI-28)', () => {
  it('has aria-pressed and flips the query', () => {
    const { last } = renderHarness();
    const toggle = chip('Aguardando resposta');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(last()).toEqual({ ...INBOX_DEFAULTS, awaiting: true });
    expect(chip('Aguardando resposta').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip('Aguardando resposta'));
    expect(last().awaiting).toBe(false);
  });

  it('exists only on Em aberto: hidden on Resolvidos and Fechados', () => {
    renderHarness();
    fireEvent.click(screen.getByRole('tab', { name: 'Resolvidos' }));
    expect(screen.queryByRole('button', { name: 'Aguardando resposta' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Fechados' }));
    expect(screen.queryByRole('button', { name: 'Aguardando resposta' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Em aberto' }));
    expect(screen.getByRole('button', { name: 'Aguardando resposta' })).toBeTruthy();
  });

  it('changing to another tab drops the toggle but keeps the owner and the priority', () => {
    const { last } = renderHarness({
      tab: 'em-aberto',
      owner: 'eu',
      priority: 'alta',
      awaiting: true,
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Fechados' }));
    expect(last()).toEqual({ tab: 'fechados', owner: 'eu', priority: 'alta', awaiting: false });
  });
});

describe('Limpar filtros (UI-D-823; UC S03)', () => {
  it('is absent when no filter is on, even on another tab', () => {
    renderHarness({ ...INBOX_DEFAULTS, tab: 'resolvidos' });
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();
  });

  it.each([
    ['an owner', { ...INBOX_DEFAULTS, owner: 'eu' }],
    ['a priority', { ...INBOX_DEFAULTS, priority: 'alta' }],
    ['the toggle', { ...INBOX_DEFAULTS, awaiting: true }],
  ] as const)(
    'appears with %s and resets owner, priority and toggle, keeping the tab',
    (_label, start) => {
      const { last } = renderHarness({ ...start });
      const clear = screen.getByRole('button', { name: 'Limpar filtros' });
      expect(hasClass(clear, 'text-brand')).toBe(true);
      fireEvent.click(clear);
      expect(last()).toEqual(INBOX_DEFAULTS);
      expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();
    },
  );

  it('keeps the current tab when it clears', () => {
    const { last } = renderHarness({
      tab: 'fechados',
      owner: 'sem',
      priority: 'baixa',
      awaiting: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(last()).toEqual({ ...INBOX_DEFAULTS, tab: 'fechados' });
  });
});
