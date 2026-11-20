import { join } from 'node:path';
import { type NavItem, type ShellNav, slotAccessibleName } from '@rede-social/core/ui';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { CONVERSATIONS_HREF, chatSlotLabel, withConversationsDestination } from './chat-nav';

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

/**
 * 11-19 (D-719, UI-D-861): the host points the chat slot at Conversas from the viewer's PERMISSION
 * (`chat.direct`), never from a role comparison. Without it the nav is returned untouched, so the support
 * destination, label and badge stay exactly as before for staff, for a member with `social` off and for
 * everyone else.
 */

const slot = (key: string, over: Partial<NavItem> = {}): NavItem => ({
  key,
  href: `/${key}`,
  icon: 'bell',
  label: key,
  ...over,
});

const nav = (): ShellNav => ({
  tabs: [slot('home', { href: '/inicio' }), slot('profile', { href: '/perfil' })],
  topbar: [
    slot('notifications', { badge: 'unreadNotifications' }),
    slot('chat', {
      href: '/suporte',
      icon: 'message-circle',
      label: 'Suporte',
      badge: 'unreadConversations',
    }),
    slot('store', { href: '/loja', railMain: true }),
  ],
});

describe('withConversationsDestination (UI-D-861)', () => {
  it('points the chat slot at /conversas with the Conversas label when the viewer holds chat.direct', () => {
    const result = withConversationsDestination(
      nav(),
      ['chat.support.contact', 'chat.direct'],
      'Conversas',
    );
    const chat = result.topbar.find((item) => item.key === 'chat');
    expect(chat?.href).toBe(CONVERSATIONS_HREF);
    expect(CONVERSATIONS_HREF).toBe('/conversas');
    expect(chat?.label).toBe('Conversas');
    // The rest of the slot is the shipped one: the icon, the counter it reads, its place.
    expect(chat?.icon).toBe('message-circle');
    expect(chat?.badge).toBe('unreadConversations');
  });

  it('leaves every other slot, the tabs and the order alone, and never mutates its input', () => {
    const input = nav();
    const before = JSON.stringify(input);
    const result = withConversationsDestination(input, ['chat.direct'], 'Conversas');
    expect(JSON.stringify(input)).toBe(before);
    expect(result.tabs).toEqual(input.tabs);
    expect(result.topbar.map((item) => item.key)).toEqual(['notifications', 'chat', 'store']);
    expect(result.topbar[0]).toEqual(input.topbar[0]);
    expect(result.topbar[2]).toEqual(input.topbar[2]);
  });

  it('returns the nav untouched for a member without chat.direct (social off) and for staff', () => {
    for (const permissions of [
      ['chat.support.contact'],
      ['chat.support', 'chat.support.assign'],
      [],
    ]) {
      const result = withConversationsDestination(nav(), permissions, 'Conversas');
      expect(result).toEqual(nav());
      const chat = result.topbar.find((item) => item.key === 'chat');
      expect(chat?.href).toBe('/suporte');
      expect(chat?.label).toBe('Suporte');
    }
  });

  it('is a no-op when the tenant has no chat slot (the module is off)', () => {
    const noChat: ShellNav = {
      ...nav(),
      topbar: nav().topbar.filter((item) => item.key !== 'chat'),
    };
    expect(withConversationsDestination(noChat, ['chat.direct'], 'Conversas')).toEqual(noChat);
  });

  it('ignores an empty label and keeps the slot name', () => {
    const chat = withConversationsDestination(nav(), ['chat.direct'], '').topbar.find(
      (item) => item.key === 'chat',
    );
    expect(chat?.href).toBe('/conversas');
    expect(chat?.label).toBe('Suporte');
  });
});

/**
 * 11-19 Task 3 (UI-D-861, D-220, D-237, D-238, D-803): the chat slot's accessible name with a number. A viewer who
 * holds chat.direct reads the ICU sentence "Conversas, {count} conversa(s) com mensagem nova" (the count is the
 * number of CONVERSATIONS with something unread); everyone else keeps the shipped sentences, the member's dot
 * and the staff count of "Suporte". With nothing unread the name is the plain label.
 */
describe('chatSlotLabel (UI-D-861)', () => {
  const t = createTranslator({ locale: 'pt-BR', messages, namespace: 'chat' });
  const label = (over: Partial<Parameters<typeof chatSlotLabel>[1]> = {}) =>
    chatSlotLabel(t as never, { count: 1, style: 'count', conversations: true, ...over });

  it('one conversation and many use the ICU plural of the catalog', () => {
    expect(label({ count: 1 })).toBe('Conversas, 1 conversa com mensagem nova');
    expect(label({ count: 3 })).toBe('Conversas, 3 conversas com mensagem nova');
    expect(label({ count: 120 })).toBe('Conversas, 120 conversas com mensagem nova');
  });

  it('without conversations the shipped sentences stay: the member dot and the staff count', () => {
    expect(label({ conversations: false, style: 'dot' })).toBe('Suporte, nova resposta da equipe');
    expect(label({ conversations: false, style: 'count', count: 2 })).toBe(
      'Suporte, 2 aguardando resposta',
    );
  });

  it('through the shell helper, nothing unread is the plain slot label', () => {
    const labelFor = (badge: string, count: number, style: 'dot' | 'count') =>
      badge === 'unreadConversations' ? label({ count, style }) : undefined;
    expect(slotAccessibleName('Conversas', 'unreadConversations', 0, labelFor, 'count')).toBe(
      'Conversas',
    );
    expect(slotAccessibleName('Conversas', 'unreadConversations', 2, labelFor, 'count')).toBe(
      'Conversas, 2 conversas com mensagem nova',
    );
  });
});
