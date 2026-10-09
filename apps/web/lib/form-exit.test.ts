// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { goBack, goBackTo, replaceAppPath } = vi.hoisted(() => ({
  goBack: vi.fn<(href: string) => boolean>(),
  goBackTo: vi.fn<(href: string) => boolean>(),
  replaceAppPath: vi.fn<(href: string) => void>(),
}));
vi.mock('@rede-social/ui', () => ({ goBack, goBackTo, replaceAppPath }));

const { leaveForm, replaceFormWith, returnAfterSave } = await import('./form-exit');

/**
 * 2026-10-09 — the forms' ways out once "Voltar" follows the history. The back stack itself is
 * covered in packages/ui/tests/back-stack.test.ts; here only what each helper asks it and what it
 * leaves to the router.
 */

afterEach(() => {
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
  it('answers false and touches nothing when the screen behind is another one', () => {
    goBackTo.mockReturnValue(false);
    const router = { refresh: vi.fn() };

    expect(returnAfterSave(router, '/perfil')).toBe(false);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('steps back and refreshes the restored screen once, on the popstate of that step', () => {
    goBackTo.mockReturnValue(true);
    const router = { refresh: vi.fn() };

    expect(returnAfterSave(router, '/comunidades/c1')).toBe(true);
    expect(goBackTo).toHaveBeenCalledWith('/comunidades/c1');
    // Nothing yet: the browser restores the screen asynchronously.
    expect(router.refresh).not.toHaveBeenCalled();

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    // A later traversal is the member's own and refreshes nothing.
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
