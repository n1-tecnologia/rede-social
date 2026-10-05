// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_NUDGE_DELAY_MS, PROFILE_NUDGE_KEY } from '@/lib/profile-nudge';

/**
 * The host that raises the "Complete seu perfil" popup when a member arrives at Início (D-02 as
 * amended on 2026-10-02, after the reference app's `ConviteDeEntrada`). What is stubbed is the
 * router; what is real is the host, the popup, `lib/profile-nudge.ts` and happy-dom's
 * sessionStorage, and the catalog is the REAL `profile.json`.
 *
 * The claims a later edit could quietly break:
 *
 *  1. It rises 500 ms after mounting, not before, when this visit has not answered it: the literal
 *     500 ms, which the e2e waits for its absence assume.
 *  2. It stays down for the membership that already answered it in this visit, rises for a
 *     different membership on the same tab, and never rises when sessionStorage cannot be read.
 *  3. "Mais tarde" and Escape end it for the visit (the membership id is stored) and close it;
 *     "Completar agora" does the same and opens `/perfil/editar`.
 *  4. Leaving Início before the 500 ms cancels the rise.
 */

const { catalog, push } = await vi.hoisted(async () => {
  // `vi.hoisted` runs BEFORE the imports it feeds, so `node:fs` is loaded here rather than above.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return { catalog: read('profile').profile as Record<string, unknown>, push: vi.fn() };
});

// The popup animates in and out; a cancelled spring rejects AFTER the run ends under happy-dom.
MotionGlobalConfig.skipAnimations = true;

const lookup = (key: string) =>
  String(
    key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog) ?? key,
  );

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => lookup(key) }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { ProfileNudgeOnArrival } = await import('./ProfileNudgeOnArrival');

const N = (catalog as { nudge: Record<'title' | 'body' | 'action' | 'dismiss', string> }).nudge;
const MEMBER = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const OTHER = '0f9e8d7c-6b5a-4f3e-9d2c-1b0a9f8e7d6c';

const popup = () => screen.queryByRole('dialog', { name: N.title });

beforeEach(() => {
  push.mockReset();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('ProfileNudgeOnArrival — the popup on arrival at Início (D-02, 2026-10-02)', () => {
  it('1. rises 500 ms after Início mounts, not before, when this visit has not answered it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container } = render(<ProfileNudgeOnArrival membershipId={MEMBER} />);
    // Nothing at all before the timer: no server markup to hydrate against, no flash.
    expect(container.innerHTML).toBe('');

    // Literal milliseconds, never the constant: 500 is the reference's `ESPERA`, and the e2e waits
    // that prove the popup's ABSENCE (1 s in the wizard, 1.5 s in PROF-01) only mean something
    // while it holds.
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(popup()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(popup()).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: N.action }));
    // Rising is not answering: the visit is still unmarked.
    expect(window.sessionStorage.getItem(PROFILE_NUDGE_KEY)).toBeNull();
  });

  it('2a. stays down for the membership that already answered it in this visit', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.sessionStorage.setItem(PROFILE_NUDGE_KEY, MEMBER);
    render(<ProfileNudgeOnArrival membershipId={MEMBER} />);

    act(() => {
      vi.advanceTimersByTime(PROFILE_NUDGE_DELAY_MS * 4);
    });
    expect(popup()).toBeNull();
  });

  it('2b. rises for a different membership on the same tab', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.sessionStorage.setItem(PROFILE_NUDGE_KEY, OTHER);
    render(<ProfileNudgeOnArrival membershipId={MEMBER} />);

    act(() => {
      vi.advanceTimersByTime(PROFILE_NUDGE_DELAY_MS);
    });
    expect(popup()).not.toBeNull();
  });

  it('2c. never rises when sessionStorage cannot be read: no popup on every visit', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Blocked storage throws on access (a sandboxed frame, a locked-down browser). happy-dom hands
    // out its own bound methods, so the getter is what is stubbed, not `Storage.prototype`.
    const blocked = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    render(<ProfileNudgeOnArrival membershipId={MEMBER} />);

    act(() => {
      vi.advanceTimersByTime(PROFILE_NUDGE_DELAY_MS * 4);
    });
    expect(blocked).toHaveBeenCalled();
    expect(popup()).toBeNull();
  });

  it('3a. "Mais tarde" ends it for the visit and closes it, writing nothing else', async () => {
    render(<ProfileNudgeOnArrival membershipId={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: N.dismiss }));

    expect(window.sessionStorage.getItem(PROFILE_NUDGE_KEY)).toBe(MEMBER);
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(popup()).toBeNull());
  });

  it('3b. Escape answers like "Mais tarde"', async () => {
    render(<ProfileNudgeOnArrival membershipId={MEMBER} />);
    const dialog = await screen.findByRole('dialog', { name: N.title });
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(window.sessionStorage.getItem(PROFILE_NUDGE_KEY)).toBe(MEMBER);
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(popup()).toBeNull());
  });

  it('3c. "Completar agora" ends it for the visit and opens /perfil/editar', async () => {
    render(<ProfileNudgeOnArrival membershipId={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: N.action }));

    expect(window.sessionStorage.getItem(PROFILE_NUDGE_KEY)).toBe(MEMBER);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/perfil/editar');
    await waitFor(() => expect(popup()).toBeNull());
  });

  it('4. leaving Início before the 500 ms cancels the rise', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { unmount } = render(<ProfileNudgeOnArrival membershipId={MEMBER} />);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(PROFILE_NUDGE_DELAY_MS / 2);
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
