// @vitest-environment happy-dom

import { join } from 'node:path';
import {
  LiveCountersProvider,
  type NavItem,
  SlotBadgeLabelsProvider,
  TopBar,
} from '@rede-social/core/ui';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { chatSlotLabel, withConversationsDestination } from './chat-nav';

/**
 * 11-19 Task 3 (UI-D-861, D-220, D-237, D-238, D-803, A-UI-2): the shipped TopBar with the host's label function,
 * the real catalog and the nav the layout builds. A member who holds chat.direct sees the chat slot as "Conversas"
 * pointing at /conversas, with the shipped count `Badge` (99+ above 99) and the plural name; a member without it
 * (social off) and staff keep the slot exactly as before: /suporte, "Suporte", the dot for the member and the
 * count for staff.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/inicio' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({ locale: 'pt-BR', messages, namespace: 'chat' });

const chat: NavItem = {
  key: 'chat',
  href: '/suporte',
  icon: 'message-circle',
  label: 'Suporte',
  badge: 'unreadConversations',
};

function bar(
  permissions: string[],
  counters: { unreadConversations: number; conversationsBadge: 'dot' | 'count' },
) {
  const nav = withConversationsDestination(
    { tabs: [], topbar: [chat] },
    permissions,
    t('navConversations'),
  );
  const conversations = permissions.includes('chat.direct');
  return (
    <LiveCountersProvider
      initial={{ unreadNotifications: 0, ...counters }}
      countersUrl="/api/me/counters"
      topics={[]}
    >
      <SlotBadgeLabelsProvider
        value={(badge, count, style) =>
          badge === 'unreadConversations'
            ? chatSlotLabel(t as never, { count, style, conversations })
            : undefined
        }
      >
        <TopBar
          brand={{ displayName: 'Rede Lab', logoUrl: null }}
          slots={nav.topbar}
          counters={{ unreadNotifications: 0, unreadConversations: 0 }}
          avatar={{ src: null, alt: 'Maria' }}
          profileLabel="Meu perfil"
        />
      </SlotBadgeLabelsProvider>
    </LiveCountersProvider>
  );
}

afterEach(cleanup);

describe('the chat bubble in the TopBar (UI-D-861)', () => {
  it('a member with chat.direct: Conversas, /conversas, the count Badge and the plural name', () => {
    render(
      bar(['chat.support.contact', 'chat.direct'], {
        unreadConversations: 3,
        conversationsBadge: 'count',
      }),
    );
    const link = screen.getByRole('link', { name: 'Conversas, 3 conversas com mensagem nova' });
    expect(link.getAttribute('href')).toBe('/conversas');
    expect(link.textContent).toBe('3');
    expect(link.querySelector('[data-badge-dot]')).toBeNull();
  });

  it('one conversation says "1 conversa com mensagem nova"; above 99 the badge draws 99+', () => {
    const { rerender } = render(
      bar(['chat.direct'], { unreadConversations: 1, conversationsBadge: 'count' }),
    );
    expect(
      screen.getByRole('link', { name: 'Conversas, 1 conversa com mensagem nova' }),
    ).toBeTruthy();
    rerender(bar(['chat.direct'], { unreadConversations: 120, conversationsBadge: 'count' }));
    const link = screen.getByRole('link', { name: 'Conversas, 120 conversas com mensagem nova' });
    expect(link.textContent).toBe('99+');
  });

  it('with nothing unread the name is just Conversas and no badge draws', () => {
    render(bar(['chat.direct'], { unreadConversations: 0, conversationsBadge: 'count' }));
    const link = screen.getByRole('link', { name: 'Conversas' });
    expect(link.getAttribute('href')).toBe('/conversas');
    expect(link.textContent).toBe('');
  });

  it('a member without chat.direct (social off): the slot opens /suporte, reads Suporte, keeps the dot', () => {
    render(bar(['chat.support.contact'], { unreadConversations: 1, conversationsBadge: 'dot' }));
    const link = screen.getByRole('link', { name: 'Suporte, nova resposta da equipe' });
    expect(link.getAttribute('href')).toBe('/suporte');
    expect(link.querySelector('[data-badge-dot]')).not.toBeNull();
    expect(link.textContent).toBe('');
  });

  it('staff: the slot opens /suporte, reads Suporte and keeps the awaiting count', () => {
    render(bar(['chat.support'], { unreadConversations: 2, conversationsBadge: 'count' }));
    const link = screen.getByRole('link', { name: 'Suporte, 2 aguardando resposta' });
    expect(link.getAttribute('href')).toBe('/suporte');
    expect(link.textContent).toBe('2');
  });
});
