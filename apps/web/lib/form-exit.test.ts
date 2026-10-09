// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { goBack, goBackTo, replaceAppPath, flashToast, clearFlashToast } = vi.hoisted(() => ({
  goBack: vi.fn<(href: string) => boolean>(),
  goBackTo: vi.fn<(href: string) => boolean>(),
  replaceAppPath: vi.fn<(href: string) => void>(),
  flashToast: vi.fn(),
  clearFlashToast: vi.fn(),
}));
vi.mock('@rede-social/ui', () => ({
  goBack,
  goBackTo,
  replaceAppPath,
  flashToast,
  clearFlashToast,
}));

const { leaveForm, replaceFormWith, returnAfterSave } = await import('./form-exit');

/**
 * 2026-10-09 — the forms' ways out once "Voltar" follows the history. The back stack itself is
 * covered in packages/ui/tests/back-stack.test.ts and the kept toast in flash-toast.test.tsx; here
 * only what each helper asks them and what it leaves to the router.
 */

const SAVED = { tone: 'success', message: 'saved-toast' } as const;

afterEach(() => {
  // Spends any one-shot popstate listener a case left armed, so it never fires in the next one.
  window.dispatchEvent(new PopStateEvent('popstate'));
  vi.clearAllMocks();
});

describe('leaveForm (the X and "Descartar")', () => {
  it('steps back to the screen the form was opened from without pushing anything', () => {
    goBack.mockReturnValue(true);
    const router = { push: vi.fn() };

    leaveForm(router, '/comunidades/c1');

    expect(goBack).toHaveBeenCalledWith('/comunidades/c1');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('pushes the fallback when nothing is behind the form', () => {
    goBack.mockReturnValue(false);
    const router = { push: vi.fn() };

    leaveForm(router, '/comunidades');

    expect(router.push).toHaveBeenCalledWith('/comunidades');
  });
});

describe("replaceFormWith (a create's success)", () => {
  it('announces the replace to the back stack before the router replaces the form', () => {
    const order: string[] = [];
    replaceAppPath.mockImplementation((href) => {
      order.push(`stack ${href}`);
    });
    const router = { replace: vi.fn((href: string) => order.push(`router ${href}`)) };

    replaceFormWith(router, '/comunidades/c9');

    expect(order).toEqual(['stack /comunidades/c9', 'router /comunidades/c9']);
  });
});

describe("returnAfterSave (an edit's success)", () => {
  it('answers false and keeps nothing when the screen behind is another one', () => {
    goBackTo.mockReturnValue(false);
    const router = { refresh: vi.fn() };

    expect(returnAfterSave(router, '/perfil', SAVED)).toBe(false);
    // Kept before the step (it may unload the page), dropped again when there was no step.
    expect(flashToast).toHaveBeenCalledWith(SAVED, '/perfil');
    expect(clearFlashToast).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('keeps the toast for the screen it steps back to, before the step', () => {
    const order: string[] = [];
    flashToast.mockImplementation(() => order.push('flash'));
    goBackTo.mockImplementation(() => {
      order.push('back');
      return true;
    });
    const router = { refresh: vi.fn() };

    expect(returnAfterSave(router, '/comunidades/c1?aba=1', SAVED)).toBe(true);
    expect(flashToast).toHaveBeenCalledWith(SAVED, '/comunidades/c1');
    expect(order).toEqual(['flash', 'back']);
    expect(clearFlashToast).not.toHaveBeenCalled();
  });

  it('a same-document step refreshes the restored screen once and drops the kept toast', () => {
    goBackTo.mockReturnValue(true);
    const router = { refresh: vi.fn() };

    expect(returnAfterSave(router, '/comunidades/c1', SAVED)).toBe(true);
    expect(goBackTo).toHaveBeenCalledWith('/comunidades/c1');
    // Nothing yet: the browser restores the screen asynchronously.
    expect(router.refresh).not.toHaveBeenCalled();

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(clearFlashToast).toHaveBeenCalledTimes(1);
    // A later traversal is the member's own and refreshes nothing.
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('without a toast it keeps nothing', () => {
    goBackTo.mockReturnValue(true);
    returnAfterSave({ refresh: vi.fn() }, '/comunidades/c1');
    expect(flashToast).not.toHaveBeenCalled();
  });
});
