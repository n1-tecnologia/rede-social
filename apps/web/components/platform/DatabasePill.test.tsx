// @vitest-environment happy-dom
import { DATABASE_STATES, type DatabaseState } from '@rede-social/contracts/projects';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabasePill, databasePillProps } from './DatabasePill';

/**
 * 09.2-19 (UI-D-539) - the ONE state vocabulary of a tenant's database. The tab, the list (plan 20)
 * and the header all read this file, so the claims are on the table itself: eight states, eight
 * words, three tones with a meaning (danger = a person is needed now, warning = it resolves or waits
 * upstream, neutral = nothing to act on), and every label comes from the real pt-BR catalog.
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

const WORDS: Record<DatabaseState, [string, 'success' | 'neutral' | 'warning' | 'danger']> = {
  ready: ['Pronto', 'success'],
  preparing: ['Em preparação', 'neutral'],
  preparation_failed: ['Preparação falhou', 'danger'],
  behind: ['Atrasado', 'warning'],
  paused: ['Pausado', 'warning'],
  unreachable: ['Inacessível', 'danger'],
  moving: ['Em mudança', 'neutral'],
  unchecked: ['Não verificado', 'neutral'],
};

describe('DatabasePill', () => {
  it('maps every one of the eight states to its UI-D-539 word and tone', () => {
    expect(DATABASE_STATES).toHaveLength(8);
    for (const state of DATABASE_STATES) {
      const [word, tone] = WORDS[state];
      cleanup();
      render(<DatabasePill state={state} />);
      const pill = screen.getByTestId('database-pill');
      expect(pill.textContent).toBe(word);
      expect(databasePillProps(state).tone).toBe(tone);
    }
  });

  it('has no state without a label in the catalog (a missing key would throw)', () => {
    for (const state of DATABASE_STATES) {
      expect(() => render(<DatabasePill state={state} />)).not.toThrow();
      cleanup();
    }
  });

  it('uses danger only for preparation_failed and unreachable', () => {
    const danger = DATABASE_STATES.filter((state) => databasePillProps(state).tone === 'danger');
    expect(danger).toEqual(['preparation_failed', 'unreachable']);
  });

  it('uses warning only for behind and paused, and success only for ready', () => {
    const warning = DATABASE_STATES.filter((state) => databasePillProps(state).tone === 'warning');
    const success = DATABASE_STATES.filter((state) => databasePillProps(state).tone === 'success');
    expect(warning).toEqual(['behind', 'paused']);
    expect(success).toEqual(['ready']);
  });

  it('renders the colour AND the word, so the colour is never the only signal', () => {
    render(<DatabasePill state="behind" />);
    const pill = screen.getByTestId('database-pill');
    expect(pill.textContent).toBe('Atrasado');
    expect(pill.className).toContain('warning');
  });

  it('accepts a test id for the header and the list', () => {
    render(<DatabasePill state="ready" data-testid="row-pill" />);
    expect(screen.getByTestId('row-pill').textContent).toBe('Pronto');
  });
});
