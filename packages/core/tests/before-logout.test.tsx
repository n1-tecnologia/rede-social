// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type BeforeLogout,
  BeforeLogoutProvider,
  runBeforeLogout,
  useBeforeLogout,
  useLogoutSubmit,
} from '../ui';

/**
 * 07-07 (T-07-45, T-07-48): the kernel seam that lets the desktop rail's logout form await a
 * host cleanup (forget this device's push) before the sign-out action, bounded to 2 s.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function LogoutHarness({ onSubmitted }: { onSubmitted: () => void }) {
  const onSubmit = useLogoutSubmit(useBeforeLogout());
  return (
    <form
      onSubmit={(event) => {
        onSubmit(event);
        if (!event.defaultPrevented) {
          event.preventDefault();
          onSubmitted();
        }
      }}
    >
      <button type="submit">sair-sentinel</button>
    </form>
  );
}

describe('runBeforeLogout', () => {
  it('settles after the cleanup, after 2 s when it hangs, and never rejects', async () => {
    const done = vi.fn(async () => {});
    await runBeforeLogout(done);
    expect(done).toHaveBeenCalledTimes(1);

    await expect(
      runBeforeLogout(async () => {
        throw new Error('boom');
      }),
    ).resolves.toBeUndefined();
    await expect(runBeforeLogout(null)).resolves.toBeUndefined();

    vi.useFakeTimers();
    const hanging = runBeforeLogout(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(2000);
    await expect(hanging).resolves.toBeUndefined();
  });
});

describe('useLogoutSubmit', () => {
  it('without a provider the submit goes straight through', () => {
    const onSubmitted = vi.fn();
    render(<LogoutHarness onSubmitted={onSubmitted} />);
    fireEvent.click(screen.getByRole('button', { name: 'sair-sentinel' }));
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('with a provider the cleanup runs FIRST, then the form is submitted exactly once', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const cleanupFn: BeforeLogout = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push('cleanup');
          release = () => resolve();
        }),
    );
    const onSubmitted = vi.fn(() => order.push('submitted'));
    render(
      <BeforeLogoutProvider value={cleanupFn}>
        <LogoutHarness onSubmitted={onSubmitted} />
      </BeforeLogoutProvider>,
    );
    const button = screen.getByRole('button', { name: 'sair-sentinel' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSubmitted).not.toHaveBeenCalled();
    // The cleanup starts on the next microtask; nothing submits while it is pending.
    await vi.waitFor(() => expect(order).toEqual(['cleanup']));
    expect(onSubmitted).not.toHaveBeenCalled();
    await act(async () => {
      release();
    });
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    expect(cleanupFn).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['cleanup', 'submitted']);
  });

  it('a hanging cleanup releases the submit after 2 s', async () => {
    vi.useFakeTimers();
    const onSubmitted = vi.fn();
    render(
      <BeforeLogoutProvider value={() => new Promise(() => {})}>
        <LogoutHarness onSubmitted={onSubmitted} />
      </BeforeLogoutProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'sair-sentinel' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(onSubmitted).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });
});
