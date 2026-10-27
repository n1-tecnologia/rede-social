// @vitest-environment happy-dom
import { TOKEN_STATES, type TokenState } from '@rede-social/contracts/projects';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenPill, tokenNeedsAttention, tokenPillProps } from './TokenPill';

/**
 * 09.4-14 Task 1 (UI-D-553, CTK-35) - the ONE vocabulary of a customer token's state. The card, the
 * tenant header and the list all read this file, so "Vencendo" cannot be amber in one place and red
 * in another. The claims are on the table itself: seven states, seven words, four tones with a
 * meaning (success = fine, warning = will become a problem, danger = a person must act, neutral =
 * nothing checked yet), every label from the REAL pt-BR catalog (a missing key throws), and the
 * header and list variant reads "Token: {state}".
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({
        locale: 'pt-BR',
        messages: harness.messages,
        namespace,
        onError: (error) => {
          throw error;
        },
      }),
  };
});

afterEach(cleanup);

const WORDS: Record<TokenState, [string, 'success' | 'neutral' | 'warning' | 'danger']> = {
  valid: ['Válido', 'success'],
  expiring: ['Vencendo', 'warning'],
  expired: ['Vencido', 'danger'],
  invalid: ['Inválido', 'danger'],
  no_permission: ['Sem permissão', 'danger'],
  org_mismatch: ['Organização diferente', 'danger'],
  unchecked: ['Não verificado', 'neutral'],
};

describe('TokenPill', () => {
  it('maps every one of the seven states to its UI-D-553 word and tone', () => {
    expect(TOKEN_STATES).toHaveLength(7);
    for (const state of TOKEN_STATES) {
      const [word, tone] = WORDS[state];
      cleanup();
      render(<TokenPill state={state} />);
      expect(screen.getByTestId('token-pill').textContent).toBe(word);
      expect(tokenPillProps(state).tone).toBe(tone);
    }
  });

  it('prefixes the word with "Token: " for the header and the list', () => {
    render(<TokenPill state="expiring" prefixed />);
    expect(screen.getByTestId('token-pill').textContent).toBe('Token: Vencendo');
  });

  it('gives the tones a meaning: one warning, one success, one neutral, four danger', () => {
    const by = (tone: string) => TOKEN_STATES.filter((s) => tokenPillProps(s).tone === tone);
    expect(by('warning')).toEqual(['expiring']);
    expect(by('success')).toEqual(['valid']);
    expect(by('neutral')).toEqual(['unchecked']);
    expect(by('danger')).toEqual(['expired', 'invalid', 'no_permission', 'org_mismatch']);
  });

  it('renders the tone AND the word, so the colour is never the only signal', () => {
    render(<TokenPill state="expiring" />);
    const pill = screen.getByTestId('token-pill');
    expect(pill.textContent).toBe('Vencendo');
    expect(pill.className).toContain('warning');
  });

  it('accepts a test id for the header and the list', () => {
    render(<TokenPill state="valid" data-testid="row-token-pill" />);
    expect(screen.getByTestId('row-token-pill').textContent).toBe('Válido');
  });
});

/**
 * 09.4-16 Task 3 (UI-D-560, CTK-41; E08 partial) - which states earn a pill on the tenant header and the list.
 * A token is the one thing in this phase that fails slowly and silently on a date, so the five states that
 * need a person get a signal; Válido and Não verificado stay quiet.
 */
describe('tokenNeedsAttention', () => {
  it.each(['expiring', 'expired', 'invalid', 'no_permission', 'org_mismatch'] as const)(
    'is true for %s',
    (state) => {
      expect(tokenNeedsAttention(state)).toBe(true);
    },
  );

  it.each(['valid', 'unchecked'] as const)('is false for %s', (state) => {
    expect(tokenNeedsAttention(state)).toBe(false);
  });

  it('covers every one of the seven states with an answer', () => {
    expect(TOKEN_STATES.filter(tokenNeedsAttention)).toHaveLength(5);
  });
});
