// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The "Complete seu perfil" popup (D-02 as amended on 2026-10-02, after the reference app's
 * `ConviteCompletarPerfil`), on its own: what is real is the component, the `Button` primitive and
 * the shared `useFocusTrap`; the catalog is the REAL `profile.json`, so a copy drift fails here.
 *
 * The claims a later edit could quietly break:
 *
 *  1. Closed, it renders nothing.
 *  2. Open, it is ONE modal dialog named by its title and described by its body, with exactly two
 *     answers, "Completar agora" over "Mais tarde", and no third way out.
 *  3. The focus starts on "Completar agora", and Tab / Shift+Tab wrap between the two answers.
 *  4. Escape is "Mais tarde"; each button calls its own handler.
 *  5. The wizard preview's copy is the same card with no dialog semantics, no trap and no focus.
 */

const { catalog } = await vi.hoisted(async () => {
  // `vi.hoisted` runs BEFORE the imports it feeds, so `node:fs` is loaded here rather than above.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return { catalog: read('profile').profile as Record<string, unknown> };
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

const { ProfileNudgeDialog } = await import('./ProfileNudgeDialog');

const N = (catalog as { nudge: Record<'title' | 'body' | 'action' | 'dismiss', string> }).nudge;

afterEach(cleanup);

function open(props: { preview?: boolean } = {}) {
  const onComplete = vi.fn();
  const onLater = vi.fn();
  const view = render(
    <ProfileNudgeDialog open onComplete={onComplete} onLater={onLater} {...props} />,
  );
  return { ...view, onComplete, onLater };
}

const now = () => screen.getByRole('button', { name: N.action });
const later = () => screen.getByRole('button', { name: N.dismiss });

describe('ProfileNudgeDialog — the "Complete seu perfil" popup (D-02, 2026-10-02)', () => {
  it('1. renders nothing while closed', () => {
    const { container } = render(
      <ProfileNudgeDialog open={false} onComplete={() => {}} onLater={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('2. is one modal dialog named by its title and described by its body, with two answers', () => {
    const { onComplete, onLater } = open();

    const dialog = screen.getByRole('dialog', { name: N.title });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const described = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe(N.body);

    // "Completar agora" over "Mais tarde", both full width, and nothing else to press.
    const buttons = Array.from(dialog.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual([N.action, N.dismiss]);
    for (const button of buttons) expect(button.className).toContain('w-full');

    // A tap beside the card is not an answer: the dimmed backdrop does nothing.
    const backdrop = Array.from(dialog.parentElement?.children ?? []).find(
      (element) => element !== dialog && element.hasAttribute('aria-hidden'),
    );
    expect(backdrop).toBeDefined();
    if (backdrop) fireEvent.click(backdrop);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onLater).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('3. focus starts on "Completar agora", and Tab / Shift+Tab wrap between the answers', () => {
    open();
    expect(document.activeElement).toBe(now());

    later().focus();
    fireEvent.keyDown(later(), { key: 'Tab' });
    expect(document.activeElement).toBe(now());

    fireEvent.keyDown(now(), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(later());
  });

  it('4. Escape is "Mais tarde", and each button calls its own handler', () => {
    const { onComplete, onLater } = open();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.click(later());
    expect(onLater).toHaveBeenCalledTimes(2);
    fireEvent.click(now());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('5. the preview copy: absolute in the phone, marked, no dialog semantics, trap or focus', () => {
    const { container, onComplete, onLater } = open({ preview: true });

    const root = container.querySelector('[data-preview-nudge]');
    expect(root).not.toBeNull();
    expect(root?.className).toContain('absolute');
    expect(root?.className).not.toContain('fixed');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('[aria-modal]')).toBeNull();
    expect(document.activeElement).toBe(document.body);

    // The same copy and the same two answers; Escape belongs to the panel, not to the phone.
    expect(container.textContent).toContain(N.title);
    expect(container.textContent).toContain(N.body);
    fireEvent.keyDown(now(), { key: 'Escape' });
    expect(onLater).not.toHaveBeenCalled();
    fireEvent.click(now());
    fireEvent.click(later());
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onLater).toHaveBeenCalledTimes(1);
  });
});
