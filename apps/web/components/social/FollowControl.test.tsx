// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-10 (UI-D-498, D-470, T-09-28): the host-owned optimistic follow toggle, against the REAL pt-BR
 * catalog through next-intl's own translator (a copy drift fails here). Stubbed: the two server
 * actions and the toast. The claims: the button flips at once, reconciles with the server's answer,
 * hands the new follower count to the host, reverts and toasts the catalog sentence on a failure,
 * ignores a second tap while one is in flight, and a row whose state has not arrived keeps its slot
 * without a label that could be wrong.
 */

const { toast, follow, unfollow } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  follow: vi.fn(),
  unfollow: vi.fn(),
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

vi.mock('./follow-actions', () => ({ followAction: follow, unfollowAction: unfollow }));

const { FollowControl } = await import('./FollowControl');

const ID = '11111111-1111-4111-8111-111111111111';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function button(): HTMLButtonElement {
  return screen.getByRole('button') as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('FollowControl', () => {
  it('F1: not following reads Seguir, named "Seguir {name}"', () => {
    render(<FollowControl membershipId={ID} name="Marcos" size="md" initialFollowing={false} />);
    expect(button().textContent).toBe('Seguir');
    expect(button().getAttribute('aria-label')).toBe('Seguir Marcos');
  });

  it('F2: following reads Seguindo with the leave-by-tap name', () => {
    render(<FollowControl membershipId={ID} name="Marcos" size="md" initialFollowing />);
    expect(button().textContent).toBe('Seguindo');
    expect(button().getAttribute('aria-label')).toBe(
      'Seguindo Marcos, toque para deixar de seguir',
    );
  });

  it('F3: a tap flips at once, then reconciles with the server and reports the count', async () => {
    const gate = deferred<{ ok: true; following: boolean; followerCount: number }>();
    follow.mockReturnValue(gate.promise);
    const onChange = vi.fn();
    render(
      <FollowControl
        membershipId={ID}
        name="Marcos"
        size="md"
        initialFollowing={false}
        onChange={onChange}
      />,
    );

    fireEvent.click(button());
    // Optimistic: already Seguindo, busy and disabled while the action is in flight.
    expect(button().textContent).toBe('Seguindo');
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().disabled).toBe(true);
    expect(follow).toHaveBeenCalledWith(ID);

    await act(async () => {
      gate.resolve({ ok: true, following: true, followerCount: 5 });
    });
    expect(button().textContent).toBe('Seguindo');
    expect(button().hasAttribute('aria-busy')).toBe(false);
    expect(onChange).toHaveBeenCalledWith(5);
    // No success toast: the flipped button is the feedback.
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('F4: the server answer wins over the optimistic guess', async () => {
    follow.mockResolvedValue({ ok: true, following: false, followerCount: 2 });
    render(<FollowControl membershipId={ID} name="Marcos" size="md" initialFollowing={false} />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().textContent).toBe('Seguir');
  });

  it('F5: following then a tap unfollows with no confirmation and no toast', async () => {
    unfollow.mockResolvedValue({ ok: true, following: false, followerCount: 1 });
    render(<FollowControl membershipId={ID} name="Marcos" size="sm" initialFollowing />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(unfollow).toHaveBeenCalledWith(ID);
    expect(follow).not.toHaveBeenCalled();
    expect(button().textContent).toBe('Seguir');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('F6: a refused follow reverts the button and toasts the catalog sentence', async () => {
    follow.mockResolvedValue({ ok: false, code: 'generic' });
    render(<FollowControl membershipId={ID} name="Marcos" size="md" initialFollowing={false} />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().textContent).toBe('Seguir');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível seguir agora. Tente novamente.',
    });
  });

  it('F7: a refused unfollow reverts to Seguindo with the unfollow sentence', async () => {
    unfollow.mockRejectedValue(new Error('network'));
    render(<FollowControl membershipId={ID} name="Marcos" size="md" initialFollowing />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().textContent).toBe('Seguindo');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível deixar de seguir agora. Tente novamente.',
    });
  });

  it('F8: a second tap while one is in flight is ignored (idempotent end to end)', async () => {
    const gate = deferred<{ ok: true; following: boolean; followerCount: number }>();
    follow.mockReturnValue(gate.promise);
    render(<FollowControl membershipId={ID} name="Marcos" size="md" initialFollowing={false} />);
    fireEvent.click(button());
    fireEvent.click(button());
    expect(follow).toHaveBeenCalledTimes(1);
    expect(unfollow).not.toHaveBeenCalled();
    await act(async () => {
      gate.resolve({ ok: true, following: true, followerCount: 1 });
    });
  });

  it('F9: a row whose state has not arrived renders the fixed slot and no label', () => {
    const { container } = render(
      <FollowControl membershipId={ID} name="Marcos" size="sm" initialFollowing={null} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent).toBe('');
    const slot = container.firstElementChild as HTMLElement;
    expect(slot.className).toContain('w-24');
    expect(slot.className).toContain('shrink-0');
  });
});
