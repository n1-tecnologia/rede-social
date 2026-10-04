// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreviewNudge } from './usePreviewNudge';

/**
 * The wizard phone's visit of the "Complete seu perfil" popup (D-02 as amended on 2026-10-02),
 * the app's rules inside `TenantAppPreview`. Real: the hook and React; faked: the timers.
 * `onHome` is the phone's screen being Início.
 *
 * The claims a later edit could quietly break:
 *
 *  1. Due when the device opens: up 500 ms after Início shows, not before.
 *  2. Either answer ends it for the visit: Início shows again without it.
 *  3. Leaving Início while it is up (only the panel's screen picker can, the keyboard's way through
 *     the device) answers it too; leaving before it rose does not, and the next arrival waits
 *     again.
 *  4. Only a sign-in makes it due again: the login screen merely shown re-arms nothing.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function phone() {
  return renderHook(({ onHome }) => usePreviewNudge(onHome), {
    initialProps: { onHome: true },
  });
}

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('usePreviewNudge — the profile popup in the wizard phone (D-02, 2026-10-02)', () => {
  it('1. is due when the device opens: up 500 ms after Início shows, not before', () => {
    const { result } = phone();
    expect(result.current.open).toBe(false);

    wait(499);
    expect(result.current.open).toBe(false);
    wait(1);
    expect(result.current.open).toBe(true);
  });

  it('2. either answer ends it for the visit', () => {
    const { result, rerender } = phone();
    wait(500);

    act(() => result.current.answer());
    expect(result.current.open).toBe(false);

    // Another screen and back to Início: still down.
    rerender({ onHome: false });
    rerender({ onHome: true });
    wait(2_000);
    expect(result.current.open).toBe(false);
  });

  it('3. leaving Início while it is up answers it; leaving before it rose does not', () => {
    const { result, rerender } = phone();

    // Gone before the 500 ms: never seen, so still due, and the next arrival waits again.
    wait(200);
    rerender({ onHome: false });
    rerender({ onHome: true });
    wait(499);
    expect(result.current.open).toBe(false);
    wait(1);
    expect(result.current.open).toBe(true);

    // The picker leaves Início under it: that is the keyboard's answer for the visit.
    rerender({ onHome: false });
    expect(result.current.open).toBe(false);
    rerender({ onHome: true });
    wait(2_000);
    expect(result.current.open).toBe(false);
  });

  it('4. only a sign-in makes it due again, never the login screen merely shown', () => {
    const { result, rerender } = phone();
    wait(500);
    act(() => result.current.answer());

    // The login screen ("Sair", or the picker) and back to Início: no new visit.
    rerender({ onHome: false });
    rerender({ onHome: true });
    wait(2_000);
    expect(result.current.open).toBe(false);

    // "Entrar" on the login screen lands on Início: a new visit, and the popup rises again.
    rerender({ onHome: false });
    act(() => result.current.signIn());
    rerender({ onHome: true });
    wait(499);
    expect(result.current.open).toBe(false);
    wait(1);
    expect(result.current.open).toBe(true);
  });
});
