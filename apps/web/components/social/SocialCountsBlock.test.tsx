// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-17 (WR-04, UI-D-501, FOLLOW-05): the profile's counts block, against the REAL pt-BR catalog
 * through next-intl's own translator. Stubbed: the two server actions and the toast. The claims: the
 * follower count follows the SERVER value (a refresh that changes it prints the new number), a
 * follower count the control's answer set survives a rerender with the SAME server value, only a
 * CHANGED server value replaces it (EP-78), zero prints "0" (EP-79), and `own` mode is two links and
 * no control.
 */

const { toast, follow, unfollow, unblock, refresh } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  follow: vi.fn(),
  unfollow: vi.fn(),
  unblock: vi.fn(),
  refresh: vi.fn(),
}));

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
  useToast: () => toast,
}));

vi.mock('./follow-actions', () => ({
  followAction: follow,
  unfollowAction: unfollow,
  unblockMemberAction: unblock,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { SocialCountsBlock } = await import('./SocialCountsBlock');

const ID = '11111111-1111-4111-8111-111111111111';

type Props = React.ComponentProps<typeof SocialCountsBlock>;

const block = (over: Partial<Props> = {}) => (
  <SocialCountsBlock
    mode="member"
    membershipId={ID}
    name="Marcos"
    followerCount={10}
    followingCount={4}
    viewerFollows={false}
    {...over}
  />
);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('SocialCountsBlock', () => {
  it('C1: the counts print in the pt-BR format, compact from 10 000', () => {
    render(block({ followerCount: 1234, followingCount: 12_345 }));
    expect(screen.getByText(/1\.234/)).toBeTruthy();
    expect(screen.getByText(/12\s?mil/)).toBeTruthy();
  });

  it('C2: a rerender with a new followerCount prints the new number (WR-04)', () => {
    const view = render(block({ followerCount: 10 }));
    expect(screen.getByText('10')).toBeTruthy();
    view.rerender(block({ followerCount: 15 }));
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.queryByText('10')).toBeNull();
  });

  it("C3 (EP-78): the control's answer is printed, kept by a same-value rerender, replaced by a changed one", async () => {
    follow.mockResolvedValue({ ok: true, following: true, followerCount: 11 });
    const view = render(block({ followerCount: 10 }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByText('11')).toBeTruthy();

    view.rerender(block({ followerCount: 10 }));
    expect(screen.getByText('11')).toBeTruthy();

    view.rerender(block({ followerCount: 12 }));
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.queryByText('11')).toBeNull();
  });

  it('C4 (EP-79): a follower count of 0 prints "0" with the plural "Seguidores"', () => {
    render(block({ followerCount: 0, followingCount: 0 }));
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText('Seguidores')).toBeTruthy();
  });

  it('C5: the viewerFollows prop resyncs the control below it', () => {
    const view = render(block({ viewerFollows: false }));
    expect(screen.getByRole('button').textContent).toBe('Seguir');
    view.rerender(block({ viewerFollows: true }));
    expect(screen.getByRole('button').textContent).toBe('Seguindo');
  });

  it('C6: own mode renders the two link cells and no control', () => {
    render(block({ mode: 'own', followerCount: 1, followingCount: 4 }));
    expect(screen.queryByRole('button')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/perfil/seguidores',
      '/perfil/seguindo',
    ]);
  });
});

describe('SocialCountsBlock - the action zone of 11-23 (UI-D-867, D-720)', () => {
  const FACTS = { canFollow: true, canMessage: true, blockedByViewer: false, canChat: true };

  it('Z1 (the path): Seguir (brand) and Enviar mensagem (outline) side by side, the second a link to the conversation entry', () => {
    const { container } = render(block(FACTS));
    const follow = screen.getByRole('button', { name: 'Seguir Marcos' });
    const message = screen.getByRole('link', { name: 'Enviar mensagem para Marcos' });
    expect(message.getAttribute('href')).toBe(`/conversas/com/${ID}`);
    expect(message.textContent).toBe('Enviar mensagem');
    expect(message.className).toContain('border-border-secondary');
    expect(message.className).not.toContain('bg-button');
    expect(follow.className).toContain('bg-button');

    // The pair sits in ONE container that stacks below 360px and sits in a row from there, Seguir first.
    const zone = follow.parentElement as HTMLElement;
    expect(message.parentElement).toBe(zone);
    expect(zone.className).toContain('flex-col');
    expect(zone.className).toContain('gap-2');
    expect(zone.className).toContain('min-[360px]:flex-row');
    expect(zone.className).toContain('md:max-w-[400px]');
    expect(follow.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(follow.className).toContain('min-[360px]:flex-1');
    expect(message.className).toContain('min-[360px]:flex-1');
    // The counts precede the zone.
    const counts = container.querySelector('.grid') as HTMLElement;
    expect(counts.compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Z2: following is not required to message, and the label never carries the name', () => {
    render(
      block({ ...FACTS, viewerFollows: true, name: 'Maximiliano Alexandrino de Oliveira Prado' }),
    );
    const message = screen.getByRole('link', { name: /Enviar mensagem para Maximiliano/ });
    expect(message.textContent).toBe('Enviar mensagem');
    expect(screen.getByRole('button', { name: /^Seguindo Maximiliano/ })).toBeTruthy();
  });

  it('Z3 (an old API): no facts reads as the shipped zone for a viewer without chat.direct', () => {
    render(block({ canChat: false }));
    expect(screen.queryByRole('link')).toBeNull();
    const follow = screen.getByRole('button', { name: 'Seguir Marcos' });
    expect(follow.className).toContain('w-full');
    expect(follow.className).toContain('md:max-w-[400px]');
  });

  it('Z4 (an old API): no facts at all, with chat.direct, is the pair and never an error', () => {
    render(block({ canChat: true }));
    expect(screen.getByRole('button', { name: 'Seguir Marcos' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Enviar mensagem para Marcos' })).toBeTruthy();
  });

  it('Z5: a viewer without chat.direct keeps Seguir alone even when the facts say canMessage', () => {
    render(block({ ...FACTS, canChat: false }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Seguir Marcos' })).toBeTruthy();
  });

  it('Z6: canMessage false hides the link and keeps Seguir', () => {
    render(block({ ...FACTS, canMessage: false }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Seguir Marcos' })).toBeTruthy();
  });

  it('Z7: own mode never draws the zone, whatever the facts say', () => {
    render(block({ ...FACTS, mode: 'own' }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link', { name: /Enviar mensagem/ })).toBeNull();
  });
});

describe('SocialCountsBlock - the blocker and the blocked member (D-722, D-723, D-724, D-725)', () => {
  const BLOCKER = { canFollow: false, canMessage: false, blockedByViewer: true, canChat: true };
  const BLOCKED = { canFollow: false, canMessage: false, blockedByViewer: false, canChat: true };

  it('U1: the blocker sees ONE full-width outline Desbloquear and neither Seguir nor Enviar mensagem', () => {
    render(block(BLOCKER));
    const button = screen.getByRole('button', { name: 'Desbloquear Marcos' });
    expect(button.textContent).toBe('Desbloquear');
    expect(button.className).toContain('w-full');
    expect(button.className).toContain('border-border-secondary');
    expect(button.className).toContain('md:max-w-[400px]');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Seguir')).toBeNull();
  });

  it('U2: one tap sends one request, reads Desbloqueando…, toasts once and re-renders the pair as Seguir', async () => {
    let settle: (value: unknown) => void = () => {};
    unblock.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    render(block(BLOCKER));
    const button = screen.getByRole('button', { name: 'Desbloquear Marcos' });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(unblock).toHaveBeenCalledTimes(1);
    expect(unblock).toHaveBeenCalledWith(ID);
    expect(screen.getByRole('button', { name: 'Desbloquear Marcos' }).textContent).toBe(
      'Desbloqueando…',
    );
    expect(
      screen.getByRole('button', { name: 'Desbloquear Marcos' }).getAttribute('aria-busy'),
    ).toBe('true');

    await act(async () => {
      settle({ ok: true, code: 'ok', changed: true });
    });
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Marcos foi desbloqueado.',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    // The pair is back, and the follow did not come back (D-724).
    expect(screen.getByRole('button', { name: 'Seguir Marcos' }).textContent).toBe('Seguir');
    expect(screen.getByRole('link', { name: 'Enviar mensagem para Marcos' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Desbloquear/ })).toBeNull();
  });

  it('U3 (idempotency): an answer changed false re-renders the pair without a second toast', async () => {
    unblock.mockResolvedValue({ ok: true, code: 'ok', changed: false });
    render(block(BLOCKER));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Desbloquear Marcos' }));
    });
    expect(toast.show).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Seguir Marcos' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Enviar mensagem para Marcos' })).toBeTruthy();
  });

  it('U4: a failure keeps the button and fires the generic error toast', async () => {
    unblock.mockResolvedValue({ ok: false, code: 'failed', changed: false });
    render(block(BLOCKER));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Desbloquear Marcos' }));
    });
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Algo deu errado. Tente novamente.',
    });
    expect(screen.getByRole('button', { name: 'Desbloquear Marcos' }).textContent).toBe(
      'Desbloquear',
    );
    expect(screen.queryByRole('button', { name: 'Seguir Marcos' })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('U5: an action that never reached the server is the same failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    unblock.mockRejectedValue(new Error('network'));
    render(block(BLOCKER));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Desbloquear Marcos' }));
    });
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(screen.getByRole('button', { name: 'Desbloquear Marcos' })).toBeTruthy();
    error.mockRestore();
  });

  it('U6 (T-11-03): the blocked member sees NOTHING in the zone while the counts render as usual', () => {
    const { container } = render(block(BLOCKED));
    expect(screen.getByText('Seguidores')).toBeTruthy();
    // The block's container holds the counts and nothing else: no wrapper, no button, no link, no text.
    const root = container.firstElementChild as HTMLElement;
    expect(root.children).toHaveLength(1);
    expect(container.querySelector('button, a, [aria-label]')).toBeNull();
    expect(container.querySelector('.pt-4')).toBeNull();
    expect(container.textContent).not.toMatch(/bloque|indispon|mensagem|Seguir/i);
  });

  it('U7: the zone follows the facts: a refresh that says the pair is blocked removes the buttons', () => {
    const view = render(block({ canFollow: true, canMessage: true, canChat: true }));
    expect(screen.getByRole('button', { name: 'Seguir Marcos' })).toBeTruthy();
    view.rerender(block(BLOCKED));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
