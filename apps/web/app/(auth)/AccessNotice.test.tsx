// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-15 (UI-D-522, UI-D-532, D-493, D-302; E09) — the one-sentence no-access notice, with the REAL
 * `Card` and `buttonClasses`. `@/lib/api` is stubbed only because `safeCheckoutUrl` lives beside the
 * server-only subscription reader. The web workspace has no jest-dom.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const { AccessNotice } = await import('./AccessNotice');

const SENTENCE = 'Seu acesso ainda não foi liberado. Use o mesmo e-mail da compra.';

function notice(checkoutUrl: string | null) {
  return render(
    <AccessNotice
      message={SENTENCE}
      subscribeLabel="Assinar"
      newTabLabel="(abre a página de pagamento em uma nova aba)"
      checkoutUrl={checkoutUrl}
    />,
  );
}

afterEach(() => cleanup());

describe('AccessNotice', () => {
  it('without a link renders the sentence in a role="alert" card with the Lock glyph and no anchor', () => {
    notice(null);
    const card = screen.getByRole('alert');
    expect(card.textContent).toContain(SENTENCE);
    expect(card.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(card.querySelector('svg')?.getAttribute('class')).toContain('lucide-lock');
    expect(card.querySelector('a')).toBeNull();
    expect(card.querySelector('h1, h2, h3')).toBeNull();
  });

  it('with a safe https link also renders the outline Assinar anchor, new tab, hidden suffix', () => {
    notice('https://pay.example/c/1');
    const anchor = screen.getByRole('link', { name: /Assinar/ });
    expect(anchor.getAttribute('href')).toBe('https://pay.example/c/1');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor.className).toContain('border-border-secondary');
    expect(anchor.className).toContain('h-11');
    expect(anchor.querySelector('svg')?.getAttribute('class')).toContain('lucide-external-link');
    expect(anchor.querySelector('.sr-only')?.textContent).toContain('nova aba');
  });

  it('renders no anchor for an unsafe link (javascript:, http:, empty, protocol-relative, credentials)', () => {
    for (const value of [
      'javascript:alert(1)',
      'http://pay.example/x',
      '',
      '//evil.example/x',
      'https://user:pw@evil.example/x',
      `https://evil.example/${'a'.repeat(3000)}`,
    ]) {
      notice(value);
      expect(screen.getByRole('alert').querySelector('a'), value).toBeNull();
      expect(document.body.innerHTML).not.toContain('evil.example');
      cleanup();
    }
  });

  it('uses the UnavailableCard geometry and is never red (E09 overflow, long text)', () => {
    notice('https://pay.example/x');
    const card = screen.getByRole('alert');
    for (const cls of ['flex', 'flex-col', 'items-center', 'gap-3', 'p-6', 'text-center']) {
      expect(card.className.split(' ')).toContain(cls);
    }
    expect(card.className).not.toMatch(/danger|red/);
    expect(card.innerHTML).not.toMatch(/text-danger/);
    expect(card.className).not.toMatch(/overflow-(x|y)-(auto|scroll)/);
  });

  it('renders the sentence as text, never as markup', () => {
    render(
      <AccessNotice
        message="<b>negrito</b>"
        subscribeLabel="Assinar"
        newTabLabel="x"
        checkoutUrl={null}
      />,
    );
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('<b>negrito</b>');
  });
});
