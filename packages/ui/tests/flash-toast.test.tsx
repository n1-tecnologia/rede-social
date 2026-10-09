import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearFlashToast, flashToast, ToastProvider, takeFlashToast } from '../src/index';

/**
 * 2026-10-09 — the toast a form's save keeps for the screen it steps back to across documents (a
 * form opened by a full load): the page that showed it goes away, and the screen the step lands on
 * shows it when its `ToastProvider` mounts.
 */

const KEY = 'rede-social:flash-toast';
const SAVED = { tone: 'success', message: 'Alterações salvas.' } as const;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('flash toast', () => {
  it('is read once, for the screen it was kept for', () => {
    flashToast(SAVED, '/eventos/e1');
    expect(takeFlashToast('/eventos/e1')).toEqual(SAVED);
    expect(takeFlashToast('/eventos/e1')).toBeNull();
  });

  it('another screen, a stale one or a value it did not write is dropped', () => {
    flashToast(SAVED, '/eventos/e1');
    expect(takeFlashToast('/inicio')).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    flashToast(SAVED, '/eventos/e1');
    vi.setSystemTime(new Date('2026-10-09T12:00:16Z'));
    expect(takeFlashToast('/eventos/e1')).toBeNull();

    window.sessionStorage.setItem(KEY, '{"tone":"loud","message":1,"pathname":"/x","at":0}');
    expect(takeFlashToast('/x')).toBeNull();
    window.sessionStorage.setItem(KEY, 'not json');
    expect(takeFlashToast('/x')).toBeNull();
  });

  it('clearFlashToast drops it, and a storage that throws never throws here', () => {
    flashToast(SAVED, '/eventos/e1');
    clearFlashToast();
    expect(takeFlashToast('/eventos/e1')).toBeNull();

    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => flashToast(SAVED, '/eventos/e1')).not.toThrow();
    expect(takeFlashToast('/eventos/e1')).toBeNull();
    expect(() => clearFlashToast()).not.toThrow();
  });

  it('the ToastProvider shows the toast kept for its screen when it mounts, once', () => {
    window.history.replaceState(null, '', '/eventos/e1');
    flashToast(SAVED, '/eventos/e1');
    render(
      <ToastProvider>
        <p>tela</p>
      </ToastProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Alterações salvas.');
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('POSITIVE CONTROL: with nothing kept the provider mounts without a toast', () => {
    window.history.replaceState(null, '', '/eventos/e1');
    render(
      <ToastProvider>
        <p>tela</p>
      </ToastProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});
