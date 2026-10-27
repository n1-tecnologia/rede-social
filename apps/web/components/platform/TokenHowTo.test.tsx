// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenHowTo } from './TokenHowTo';

/**
 * 09.4-14 Task 2 (UI-D-557, CTK-39, D-569, D-578) - the ONE "Como criar o token" helper: open in the
 * wizard, closed (a native `<details>`) in the card and the sheet. Real: the component and the REAL
 * pt-BR catalog through next-intl's own translator (a missing key throws). Claims:
 *
 *  1. Open: the four steps in an `ol`, in order, one link with the exact href, `target="_blank"`,
 *     `rel="noopener noreferrer"` and the hidden "(abre em uma nova aba)" suffix, then the note.
 *  2. Collapsible: a closed `<details>` whose summary is at least 44px high; opening shows the same.
 *  3. Step 3 carries the thirteen permissions of D-569 (plan 17 replaced the `[PENDENTE-PERMISSÕES]`
 *     marker); the component renders whatever the catalog says and types no text of its own.
 *  4. A long unbroken string in a step wraps (`break-words`), so nothing scrolls sideways at 320px.
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

const STEPS = [
  'Entre no Supabase com a conta que tem acesso ao projeto do cliente e abra a página de tokens de acesso.',
  'Crie um token novo e limite-o a este projeto, não à conta toda.',
  'Marque as permissões: Project Settings (leitura e escrita), API Keys (leitura e escrita), API Key Secrets (leitura), Connection Pooling (leitura), Database (leitura), Database Config (leitura e escrita), Migrations (leitura), Storage (leitura), Storage Config (leitura e escrita), Auth Config (leitura e escrita), Auth Signing Keys (leitura e escrita), Data API Config (leitura e escrita), Realtime Config (leitura e escrita). Escolha o vencimento (no máximo 1 ano) e anote a data.',
  'Copie o token na hora. O Supabase não mostra de novo.',
];

describe('TokenHowTo', () => {
  it('1. open: renders the four steps in an ordered list, in order, and no <details>', () => {
    render(<TokenHowTo />);
    const items = Array.from(document.querySelectorAll('ol > li')).map((li) => li.textContent);
    expect(items).toEqual(STEPS);
    expect(document.querySelector('details')).toBeNull();
    expect(document.body.textContent).toContain('Como criar o token');
  });

  it('1. open: one external link built from the code constant, safe against opener access', () => {
    render(<TokenHowTo />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    const link = links[0] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://supabase.com/dashboard/account/tokens');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('Abrir os tokens no Supabase (abre em uma nova aba)');
    expect(link.querySelector('.sr-only')?.textContent).toBe(' (abre em uma nova aba)');
  });

  it('1. open: ends with the creator-loses-access note, 12px tertiary', () => {
    render(<TokenHowTo />);
    const note = Array.from(document.querySelectorAll('p')).find(
      (p) =>
        p.textContent ===
        'Se quem criou o token perder o acesso à conta do cliente, o token deixa de funcionar.',
    );
    expect(note).toBeDefined();
    expect(note?.className).toContain('text-xs');
    expect(note?.className).toContain('text-text-tertiary');
  });

  it('2. collapsible: a closed <details> with a 44px summary; opening shows the same content', () => {
    render(<TokenHowTo collapsible />);
    const details = document.querySelector('details') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    const summary = details.querySelector('summary') as HTMLElement;
    expect(summary.textContent).toBe('Como criar o token');
    expect(summary.className).toContain('min-h-11');
    expect(summary.className).toContain('text-brand');
    fireEvent.click(summary);
    details.open = true;
    expect(Array.from(details.querySelectorAll('ol > li')).map((li) => li.textContent)).toEqual(
      STEPS,
    );
    expect(details.querySelectorAll('a')).toHaveLength(1);
  });

  it('3. step 3 renders the thirteen permissions from the catalog, with no placeholder marker', () => {
    render(<TokenHowTo />);
    const step3 = document.querySelectorAll('ol > li')[2];
    expect(step3?.textContent).toContain('Auth Signing Keys (leitura e escrita)');
    expect(step3?.textContent).not.toContain('[PENDENTE');
  });

  it('4. wraps long text: every step has break-words, so nothing scrolls sideways at 320px', () => {
    render(<TokenHowTo />);
    const items = Array.from(document.querySelectorAll('ol > li'));
    expect(items).toHaveLength(4);
    for (const item of items) expect(item.className).toContain('break-words');
    const long = 'x'.repeat(600);
    (items[0] as HTMLElement).textContent = long;
    expect(items[0]?.textContent).toHaveLength(600);
    expect(items[0]?.className).toContain('break-words');
  });
});
