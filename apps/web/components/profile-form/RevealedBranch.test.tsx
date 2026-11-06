// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RevealedBranch } from './RevealedBranch';

/**
 * 12.2-14 (D-641, D-644, UI-D-679, UI-D-682): the motion wrapper of a block of questions. One rail for the
 * whole block, a plain `div` with no landmark, instant under `prefers-reduced-motion`, and it never moves focus.
 */

const mocks = vi.hoisted(() => ({ reduced: true }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => mocks.reduced,
}));

beforeEach(() => {
  mocks.reduced = true;
});
afterEach(cleanup);

const RAIL = 'flex flex-col gap-6 border-l-2 border-border pl-3';

describe('RevealedBranch: the wrapper of a block', () => {
  it('draws the children inside ONE plain div with the shared rail', () => {
    render(
      <RevealedBranch show>
        <p>Primeira</p>
        <p>Segunda</p>
      </RevealedBranch>,
    );
    const wrappers = document.querySelectorAll('[data-revealed-branch]');
    expect(wrappers).toHaveLength(1);
    const wrapper = wrappers[0] as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.className).toBe(RAIL);
    expect(wrapper.getAttribute('role')).toBeNull();
    expect(wrapper.getAttribute('aria-label')).toBeNull();
    expect(wrapper.getAttribute('aria-labelledby')).toBeNull();
    expect(wrapper.textContent).toBe('PrimeiraSegunda');
  });

  it('under prefers-reduced-motion a closed block is simply absent, and an open one is instantly there', () => {
    const { rerender } = render(
      <RevealedBranch show={false}>
        <p>Dentro</p>
      </RevealedBranch>,
    );
    expect(document.querySelector('[data-revealed-branch]')).toBeNull();
    rerender(
      <RevealedBranch show>
        <p>Dentro</p>
      </RevealedBranch>,
    );
    expect(screen.getByText('Dentro')).toBeTruthy();
    rerender(
      <RevealedBranch show={false}>
        <p>Dentro</p>
      </RevealedBranch>,
    );
    expect(screen.queryByText('Dentro')).toBeNull();
  });

  it('with the motion on, the block leaves only after its exit, as one piece', async () => {
    mocks.reduced = false;
    const { rerender } = render(
      <RevealedBranch show>
        <p>Um</p>
        <p>Dois</p>
      </RevealedBranch>,
    );
    rerender(
      <RevealedBranch show={false}>
        <p>Um</p>
        <p>Dois</p>
      </RevealedBranch>,
    );
    await waitFor(() => expect(document.querySelector('[data-revealed-branch]')).toBeNull(), {
      timeout: 3000,
    });
    expect(screen.queryByText('Um')).toBeNull();
    expect(screen.queryByText('Dois')).toBeNull();
  });

  it('the first render never animates: a block that is open on arrival is there at once', () => {
    mocks.reduced = false;
    render(
      <RevealedBranch show>
        <p>Já aberto</p>
      </RevealedBranch>,
    );
    const outer = document.querySelector('[data-revealed-branch]')?.parentElement as HTMLElement;
    expect(screen.getByText('Já aberto')).toBeTruthy();
    expect(outer.style.opacity).not.toBe('0');
    expect(outer.style.height).not.toBe('0px');
  });

  it('a nested block is another wrapper inside the outer one, right after its opener', () => {
    render(
      <RevealedBranch show>
        <p>Abridora</p>
        <RevealedBranch show>
          <p>Filha</p>
        </RevealedBranch>
      </RevealedBranch>,
    );
    const outer = document.querySelector('[data-revealed-branch]') as HTMLElement;
    const inner = outer.querySelector('[data-revealed-branch]') as HTMLElement;
    expect(inner).not.toBeNull();
    expect(outer.querySelectorAll('[data-revealed-branch]')).toHaveLength(1);
    expect(outer.firstElementChild?.textContent).toBe('Abridora');
    expect(inner.textContent).toBe('Filha');
  });

  it('revealing a block never takes focus from the control that is focused', () => {
    const { rerender } = render(
      <>
        <button type="button">Abridora</button>
        <RevealedBranch show={false}>
          <input aria-label="Revelada" />
        </RevealedBranch>
      </>,
    );
    const opener = screen.getByRole('button', { name: 'Abridora' });
    opener.focus();
    rerender(
      <>
        <button type="button">Abridora</button>
        <RevealedBranch show>
          <input aria-label="Revelada" />
        </RevealedBranch>
      </>,
    );
    expect(document.activeElement).toBe(opener);
    expect(screen.getByLabelText('Revelada')).toBeTruthy();
  });
});
