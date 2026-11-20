// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRowView, ConversationsPageView, SupportRowView } from '@/lib/chat-view';

/**
 * 11-19 Task 1 (CHAT-06, D-719, D-721, UI-D-862, UI-D-866, UI-D-879): the Conversas list draws what the API
 * returned, already finished by the view functions of plan 18: the support row pinned first with its dot, then the
 * direct rows in the given order, each ONE link named by its finished label, with the unread count `Badge`
 * (`99+` above 99), the `Mic` glyph for a voice preview and the neutral "Membro removido". The catalog is the REAL
 * pt-BR one through next-intl's own translator; `InfiniteScroll` and `PullToRefresh` are swapped for buttons
 * (happy-dom has no scroll sentinel and no touch pull).
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    useTranslations: (namespace: string) => {
      let tr = byNamespace.get(namespace);
      if (!tr) {
        tr = actual.createTranslator({ locale: 'pt-BR', messages, namespace });
        byNamespace.set(namespace, tr);
      }
      return tr;
    },
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@rede-social/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rede-social/ui')>();
  const { createElement, Fragment } = await import('react');
  return {
    ...actual,
    InfiniteScroll: () => null,
    PullToRefresh: ({ children }: { children: ReactNode }) =>
      createElement(Fragment, null, children),
  };
});

const { ConversationsList } = await import('./ConversationsList');

const support = (over: Partial<SupportRowView> = {}): SupportRowView => ({
  name: 'Equipe Rede Lab',
  href: '/suporte',
  preview: 'Equipe: Seu ingresso já está liberado.',
  previewKind: 'text',
  idle: false,
  unread: true,
  label: 'Equipe Rede Lab. Equipe: Seu ingresso já está liberado., mensagem nova',
  ...over,
});

let seq = 0;
const row = (over: Partial<ConversationRowView> = {}): ConversationRowView => {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const name = over.name ?? `Membro ${seq}`;
  return {
    conversationId: id,
    href: `/conversas/${id}`,
    name,
    removed: false,
    avatar: null,
    profileHref: `/membros/${id}`,
    preview: `prévia ${seq}`,
    previewKind: 'text',
    time: '14:12',
    lastMessageAt: `2026-11-19T14:${String(59 - seq).padStart(2, '0')}:00.000000Z`,
    unread: null,
    label: `${name}. prévia ${seq}`,
    ...over,
  };
};

const page = (rows: ConversationRowView[], over: Partial<ConversationsPageView> = {}) =>
  ({ support: support(), rows, nextCursor: null, ...over }) satisfies ConversationsPageView;

const renderList = (initial: ConversationsPageView | null) =>
  render(<ConversationsList initial={initial} tenantName="Rede Lab" logoUrl={null} />);

const has = (element: Element | null | undefined, ...names: string[]) =>
  element !== null &&
  element !== undefined &&
  names.every((name) => element.classList.contains(name));
const links = () =>
  within(screen.getByRole('list', { name: 'Suas conversas' })).getAllByRole('link');

beforeEach(() => {
  seq = 0;
  mocks.push.mockReset();
});
afterEach(cleanup);

describe('ConversationsList (UI-D-862, UI-D-879)', () => {
  it('is a list named "Suas conversas" with the support row first and the rows in the given order', () => {
    const carla = row({ name: 'Carla Nunes', unread: { count: 2, text: '2' } });
    const rafael = row({ name: 'Rafael Lima' });
    renderList(page([carla, rafael]));
    const all = links();
    expect(all).toHaveLength(3);
    expect(all[0]?.getAttribute('href')).toBe('/suporte');
    expect(all[1]?.getAttribute('href')).toBe(carla.href);
    expect(all[2]?.getAttribute('href')).toBe(rafael.href);
    expect(all.map((a) => a.querySelector('[data-inbox-name]')?.textContent)).toEqual([
      'Equipe Rede Lab',
      'Carla Nunes',
      'Rafael Lima',
    ]);
  });

  it('every row is ONE link whose accessible name is the finished label (the count clause only when unread)', () => {
    const unread = row({
      name: 'Larissa Souza',
      unread: { count: 7, text: '7' },
      label: 'Larissa Souza, 7 mensagens novas. prévia 1',
    });
    const read = row({ name: 'Bruno', label: 'Bruno. prévia 2' });
    renderList(page([unread, read]));
    expect(
      screen.getByRole('link', { name: 'Larissa Souza, 7 mensagens novas. prévia 1' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bruno. prévia 2' })).toBeTruthy();
    expect(
      screen.getByRole('link', {
        name: 'Equipe Rede Lab. Equipe: Seu ingresso já está liberado., mensagem nova',
      }),
    ).toBeTruthy();
  });

  it('the support row shows the dot (a flag, never a number) and opens /suporte', () => {
    renderList(page([row()]));
    const first = links()[0] as HTMLElement;
    expect(first.querySelector('[data-badge-dot]')).not.toBeNull();
    expect(first.getAttribute('href')).toBe('/suporte');
  });

  it('a read support row draws no dot, and an idle one reads in the tertiary tone', () => {
    renderList(
      page([], {
        support: support({
          unread: false,
          idle: true,
          preview: 'Fale com a equipe de Rede Lab',
          label: 'Equipe Rede Lab. Fale com a equipe de Rede Lab',
        }),
      }),
    );
    const first = links()[0] as HTMLElement;
    expect(first.querySelector('[data-badge-dot]')).toBeNull();
    expect(has(first.querySelector('[data-inbox-preview]'), 'text-text-tertiary')).toBe(true);
  });

  it('draws the count Badge, capped at 99+, and nothing when read', () => {
    renderList(
      page([
        row({ name: 'Cap', unread: { count: 100, text: '99+' } }),
        row({ name: 'Few', unread: { count: 3, text: '3' } }),
        row({ name: 'Read' }),
      ]),
    );
    const byName = (name: string) =>
      links().find(
        (a) => a.querySelector('[data-inbox-name]')?.textContent === name,
      ) as HTMLElement;
    const trailing = (name: string) =>
      byName(name).querySelector('[data-inbox-time]')?.parentElement;
    expect(trailing('Cap')?.textContent).toContain('99+');
    expect(trailing('Few')?.textContent).toContain('3');
    expect(trailing('Read')?.textContent).toBe('14:12');
    expect(byName('Cap').querySelector('[data-inbox-dot]')).toBeNull();
    expect(has(byName('Cap').querySelector('[data-inbox-preview]'), 'text-text')).toBe(true);
    expect(has(byName('Read').querySelector('[data-inbox-preview]'), 'text-text-secondary')).toBe(
      true,
    );
  });

  it('a voice preview carries the Mic glyph before the text and a text preview carries none', () => {
    renderList(
      page([
        row({ name: 'Voz', previewKind: 'voice', preview: 'Mensagem de voz · 0:42' }),
        row({ name: 'Texto' }),
      ]),
    );
    const voz = links().find((a) => a.textContent?.includes('Mensagem de voz')) as HTMLElement;
    expect(voz.querySelector('[data-inbox-preview] svg[aria-hidden]')).not.toBeNull();
    const texto = links().find(
      (a) => a.querySelector('[data-inbox-name]')?.textContent === 'Texto',
    );
    expect(texto?.querySelector('[data-inbox-preview] svg')).toBeNull();
  });

  it('a removed member reads Membro removido, with the neutral avatar, and stays', () => {
    renderList(
      page([row({ name: 'Membro removido', removed: true, avatar: null, profileHref: null })]),
    );
    const removed = links()[1] as HTMLElement;
    const name = removed.querySelector('[data-inbox-name]');
    expect(name?.textContent).toBe('Membro removido');
    expect(has(name, 'text-text-tertiary')).toBe(true);
    expect(removed.querySelector('svg')).not.toBeNull();
  });

  it('long names and previews are one truncated line each, in a min-w-0 column', () => {
    renderList(page([row({ name: 'N'.repeat(90), preview: 'P'.repeat(300) })]));
    const target = links()[1] as HTMLElement;
    expect(has(target.querySelector('[data-inbox-name]'), 'truncate')).toBe(true);
    expect(has(target.querySelector('[data-inbox-preview]'), 'truncate')).toBe(true);
    expect(has(target, 'min-h-18')).toBe(true);
  });

  it('member strings are text nodes: markup in a name or preview never becomes an element', () => {
    renderList(page([row({ name: '<img src=x onerror=alert(1)>', preview: '<b>oi</b>' })]));
    expect(document.querySelector('img[src="x"], b')).toBeNull();
    expect(links()[1]?.querySelector('[data-inbox-name]')?.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('a plain left click is a client navigation (router.push); a modified click keeps the browser', () => {
    const target = row({ name: 'Carla' });
    renderList(page([target]));
    const link = links()[1] as HTMLElement;
    fireEvent.click(link);
    expect(mocks.push).toHaveBeenCalledWith(target.href);
    mocks.push.mockReset();
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('the column is the 680px single column on every breakpoint', () => {
    renderList(page([row()]));
    const column = screen
      .getByRole('list', { name: 'Suas conversas' })
      .closest('[data-conversations]');
    expect(has(column, 'mx-auto', 'w-full', 'max-w-[680px]')).toBe(true);
  });
});
