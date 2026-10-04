// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_NUDGE_KEY } from '@/lib/profile-nudge';
import { RearmProfileNudge } from './RearmProfileNudge';

/**
 * The entry forms' re-arm of the "Complete seu perfil" popup (D-02 as amended on 2026-10-02).
 * Inside the forms of `/entrar`, `/cadastro` and `/aceitar-convite` it forgets this visit's answer
 * when a sign-in is SUBMITTED, so the next arrival at Início asks again, and never when the page is
 * only shown: Back from Início lands on `/entrar`, and the answer must survive the way Forward.
 * What is real is the component, React's form action (`useFormStatus`) and happy-dom's
 * sessionStorage; the server action is a stub held pending, as a sign-in is until the server
 * answers.
 *
 * The claims a later edit could quietly break:
 *
 *  1. Mounted, it changes nothing and renders nothing: the visit keeps its answer.
 *  2. A submission forgets the answer, and only that key.
 *  3. Storage that cannot be reached never stops the sign-in from going out.
 */

const MEMBER = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

/** An entry form the way the pages render it: the server action, the re-arm, the submit button. */
function entryForm() {
  let answer: () => void = () => {};
  const action = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        answer = () => resolve();
      }),
  );
  render(
    <form action={action} data-testid="entry">
      <RearmProfileNudge />
      <button type="submit">submit</button>
    </form>,
  );
  return {
    action,
    submit: () =>
      act(async () => {
        fireEvent.submit(screen.getByTestId('entry'));
      }),
    /** The server's answer: the pending submission ends. */
    settle: () =>
      act(async () => {
        answer();
      }),
  };
}

describe('RearmProfileNudge — a submitted sign-in starts a new visit', () => {
  it('1. keeps the answer while the entry page is only shown, and renders nothing', () => {
    window.sessionStorage.setItem(PROFILE_NUDGE_KEY, MEMBER);

    entryForm();

    // Only the submit button: the re-arm adds nothing to the form.
    expect(screen.getByTestId('entry').children).toHaveLength(1);
    expect(window.sessionStorage.getItem(PROFILE_NUDGE_KEY)).toBe(MEMBER);
  });

  it('2. forgets the answer as the sign-in is submitted, and only that key', async () => {
    window.sessionStorage.setItem(PROFILE_NUDGE_KEY, MEMBER);
    window.sessionStorage.setItem('rede-social:novo-tenant', '{}');
    const { action, submit, settle } = entryForm();

    await submit();

    expect(action).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(PROFILE_NUDGE_KEY)).toBeNull();
    // Only its own key: the tab's other drafts stay where they are.
    expect(window.sessionStorage.getItem('rede-social:novo-tenant')).toBe('{}');
    await settle();
  });

  it('3. ignores storage that cannot be reached: the sign-in still goes out', async () => {
    const { action, submit, settle } = entryForm();
    // happy-dom hands out its own bound methods, so the getter is what is stubbed.
    const blocked = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    await submit();

    expect(blocked).toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(1);
    await settle();
  });
});
