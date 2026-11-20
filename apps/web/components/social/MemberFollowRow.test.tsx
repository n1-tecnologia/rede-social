// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 11-23 (D-720): the message control is an OPT-IN of the row. The two private follow lists build the row without
 * it, so they never grow the control (D-720 names the profile and the `/membros` row only).
 */

vi.mock('./follow-actions', () => ({ followAction: vi.fn(), unfollowAction: vi.fn() }));

vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: vi.fn(), dismiss: vi.fn() }),
}));

const { MemberFollowRow } = await import('./MemberFollowRow');

const ID = '11111111-1111-4111-8111-111111111111';
const base = {
  membershipId: ID,
  displayName: 'Ana Souza',
  avatarAssetId: null,
  bio: null,
  following: false,
};

afterEach(cleanup);

describe('MemberFollowRow - the message control', () => {
  it('F1: by default the row is the shipped one: the name link and Seguir, no message link', () => {
    render(<MemberFollowRow {...base} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /Enviar mensagem/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Seguir Ana Souza' })).toBeTruthy();
  });

  it('F2: with message the link comes before Seguir, to the conversation entry', () => {
    render(<MemberFollowRow {...base} message />);
    const link = screen.getByRole('link', { name: 'Enviar mensagem para Ana Souza' });
    expect(link.getAttribute('href')).toBe(`/conversas/com/${ID}`);
    expect(
      link.compareDocumentPosition(screen.getByRole('button', { name: 'Seguir Ana Souza' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('F3: hideControls leaves the name link alone, with no slot content', () => {
    render(<MemberFollowRow {...base} message hideControls />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('F4: the own row keeps "Você" and never draws the message control', () => {
    render(<MemberFollowRow {...base} message own />);
    expect(screen.getByText('Você')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Enviar mensagem/ })).toBeNull();
  });
});
