// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessRow, AccessRowSkeleton, AccessStatePill, PaymentsSkeleton } from '../ui';

/**
 * 09.1-14 (UI-D-517, UI-D-520, UI-D-531, MOD-02) — the module's props-only Acessos row and the one
 * status pill. Every word, flag and handler arrives as a prop; the components import neither the store
 * module nor the web app. The web workspace has no jest-dom here either: plain DOM assertions only.
 */

afterEach(cleanup);

function row(over: Partial<Parameters<typeof AccessRow>[0]> = {}) {
  const onOpen = vi.fn();
  render(
    <AccessRow
      email="ana@exemplo.com.br"
      state="active"
      stateLabel="Ativo"
      sourceLabel="Kiwify"
      noAccountLabel="Ainda sem conta"
      validityLabel="Válido até 12 de nov. de 2026"
      onOpen={onOpen}
      {...over}
    />,
  );
  return { onOpen, button: screen.getByRole('button') };
}

describe('AccessStatePill (UI-D-520: one vocabulary, one mapping)', () => {
  const TONE: Record<string, string> = {
    active: 'text-success',
    applied: 'text-success',
    subscription_pending: 'text-warning',
    no_account: 'text-warning',
    unknown_product: 'text-warning',
    blocked: 'text-danger',
    ignored: 'text-text-secondary',
  };

  it.each(Object.entries(TONE))(
    'paints %s with its tone and always prints the label',
    (state, tone) => {
      render(<AccessStatePill state={state as never} label={`rótulo ${state}`} />);
      const pill = screen.getByText(`rótulo ${state}`);
      expect(pill.className).toContain(tone);
      expect(pill.getAttribute('data-state')).toBe(state);
    },
  );

  it('keeps "Bloqueado" (a person decided) and "Assinatura pendente" (money decided) on different tones', () => {
    render(
      <>
        <AccessStatePill state="blocked" label="Bloqueado" />
        <AccessStatePill state="subscription_pending" label="Assinatura pendente" />
      </>,
    );
    expect(screen.getByText('Bloqueado').className).not.toBe(
      screen.getByText('Assinatura pendente').className,
    );
  });
});

describe('AccessRow (UI-D-517)', () => {
  it('is ONE button with the e-mail, the disc glyph and the chevron, all decorative glyphs aria-hidden', () => {
    const { button } = row();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(button.textContent).toContain('ana@exemplo.com.br');
    const glyphs = Array.from(button.querySelectorAll('svg'));
    expect(glyphs).toHaveLength(2);
    for (const glyph of glyphs) expect(glyph.getAttribute('aria-hidden')).toBe('true');
  });

  it('prints the pills in the order state, source, account, then the validity line', () => {
    const { button } = row({ hasAccount: false });
    const pills = Array.from(button.querySelectorAll('[data-access-pills] > span')).map(
      (el) => el.textContent,
    );
    expect(pills).toEqual(['Ativo', 'Kiwify', 'Ainda sem conta']);
    const validity = screen.getByText('Válido até 12 de nov. de 2026');
    expect(validity.className).toContain('tabular-nums');
    expect(validity.className).toContain('text-text-tertiary');
    expect(button.textContent?.indexOf('Ainda sem conta')).toBeLessThan(
      button.textContent?.indexOf('Válido até') ?? -1,
    );
  });

  it('omits the account pill when hasAccount is true or missing, and shows it only for false', () => {
    row({ hasAccount: true });
    expect(screen.queryByText('Ainda sem conta')).toBeNull();
    cleanup();
    row();
    expect(screen.queryByText('Ainda sem conta')).toBeNull();
    cleanup();
    row({ hasAccount: false });
    expect(screen.getByText('Ainda sem conta')).toBeTruthy();
  });

  it('renders the source pill neutral and the blocked state danger', () => {
    row({ state: 'blocked', stateLabel: 'Bloqueado', sourceLabel: 'Manual' });
    expect(screen.getByText('Manual').className).toContain('text-text-secondary');
    expect(screen.getByText('Bloqueado').className).toContain('text-danger');
  });

  it('truncates a very long e-mail and keeps the chevron and the pills inside the row (E05 long-text)', () => {
    const long = `${'a'.repeat(64)}@${'clinica-de-estetica-avancada-integrada'.repeat(2)}.com.br`;
    const { button } = row({ email: long, hasAccount: false });
    const email = screen.getByText(long);
    expect(email.className).toContain('truncate');
    expect(email.parentElement?.className).toContain('min-w-0');
    expect(email.parentElement?.className).toContain('flex-1');
    const chevron = button.querySelector(':scope > svg') as SVGElement;
    expect(chevron.getAttribute('class')).toContain('shrink-0');
    expect(button.querySelector('[data-access-pills]')?.className).toContain('flex-wrap');
  });

  it('opens through the handler and writes its text as plain React text', () => {
    const { onOpen, button } = row({ email: '<img src=x onerror=alert(1)>@x.br' });
    expect(button.querySelector('img')).toBeNull();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('writes no half-step spacing class and is at least the 72px row', () => {
    const { button } = row();
    expect(button.className).toContain('min-h-18');
    // The shipped StatusPill carries its own geometry (`px-3.5 py-1.5`); only the row's own markup counts.
    const own = [button, ...Array.from(button.querySelectorAll('*'))]
      .filter(
        (el) => !el.closest('[data-state]') && !el.parentElement?.matches('[data-access-pills]'),
      )
      .map((el) => el.getAttribute('class') ?? '')
      .join(' ');
    expect(own).not.toMatch(/(gap|p|m|px|py|mt|mb)-(0\.5|1\.5|2\.5|3\.5)/);
  });
});

describe('AccessRowSkeleton (UI-D-528)', () => {
  it('draws the requested count in the row geometry, aria-busy, with no word', () => {
    const { container } = render(<AccessRowSkeleton count={8} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelectorAll('[data-access-skeleton-row]')).toHaveLength(8);
    expect(container.textContent).toBe('');
  });

  it('draws three rows at the sentinel', () => {
    const { container } = render(<AccessRowSkeleton count={3} />);
    expect(container.querySelectorAll('[data-access-skeleton-row]')).toHaveLength(3);
  });
});

describe('PaymentsSkeleton, the access variant (UI-D-528)', () => {
  it('draws the toolbar shape and 8 access rows inside the frame, with no word', () => {
    const { container } = render(<PaymentsSkeleton variant="access" />);
    expect(screen.getByTestId('payments-skeleton').getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('[data-access-skeleton-row]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-testid="payments-skeleton-tab"]')).toHaveLength(3);
    expect(container.textContent).toBe('');
  });

  it('draws no frame when asked for the body alone', () => {
    render(<PaymentsSkeleton variant="access" frame={false} rows={3} />);
    expect(screen.queryByTestId('payments-skeleton-header')).toBeNull();
    expect(document.querySelectorAll('[data-access-skeleton-row]')).toHaveLength(3);
  });
});
