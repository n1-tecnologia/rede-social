// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.2-20 Task 1 (UI-D-540) - the four chips of the tenant list toolbar are ONE single-select row:
 * Todos, Ativos, Suspensos and "Banco com problema". Each chip is a link that carries only its own
 * filter, so choosing one clears the other and "Todos" clears both; `q` and `limit` travel, `cursor`
 * never does. The toolbar builds links and replaces the URL; the filtering itself is the API's.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

const nav = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
}));

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

const { TenantToolbar } = await import('./TenantToolbar');

beforeEach(() => nav.replace.mockReset());
afterEach(cleanup);

const chips = () =>
  Array.from(
    screen.getByRole('navigation', { name: 'Filtrar por status' }).querySelectorAll('a'),
  ) as HTMLAnchorElement[];
const hrefOf = (label: string) =>
  chips()
    .find((chip) => chip.textContent === label)
    ?.getAttribute('href');

describe('TenantToolbar - the single-select chip row', () => {
  it('shows four chips in one row in the order Todos, Ativos, Suspensos, Banco com problema', () => {
    render(<TenantToolbar />);
    expect(chips().map((chip) => chip.textContent)).toEqual([
      'Todos',
      'Ativos',
      'Suspensos',
      'Banco com problema',
    ]);
    const row = screen.getByRole('navigation', { name: 'Filtrar por status' });
    expect(row.querySelectorAll('a')).toHaveLength(4);
  });

  it('links each chip to its own filter only', () => {
    render(<TenantToolbar />);
    expect(hrefOf('Todos')).toBe('/plataforma');
    expect(hrefOf('Ativos')).toBe('/plataforma?status=active');
    expect(hrefOf('Suspensos')).toBe('/plataforma?status=suspended');
    expect(hrefOf('Banco com problema')).toBe('/plataforma?banco=problema');
  });

  it('is exclusive: from a status filter the database chip drops status, and the reverse', () => {
    render(<TenantToolbar status="suspended" />);
    expect(hrefOf('Banco com problema')).toBe('/plataforma?banco=problema');
    expect(hrefOf('Banco com problema')).not.toContain('status');
    cleanup();
    render(<TenantToolbar banco="problema" />);
    expect(hrefOf('Ativos')).toBe('/plataforma?status=active');
    expect(hrefOf('Ativos')).not.toContain('banco');
  });

  it('makes "Todos" clear both ?status and ?banco', () => {
    render(<TenantToolbar status="active" />);
    expect(hrefOf('Todos')).toBe('/plataforma');
    cleanup();
    render(<TenantToolbar banco="problema" />);
    expect(hrefOf('Todos')).toBe('/plataforma');
  });

  it('preserves q and limit on every chip and never carries a cursor', () => {
    render(<TenantToolbar q="ana" banco="problema" limit={50} />);
    expect(hrefOf('Todos')).toBe('/plataforma?q=ana&limit=50');
    expect(hrefOf('Ativos')).toBe('/plataforma?q=ana&status=active&limit=50');
    expect(hrefOf('Suspensos')).toBe('/plataforma?q=ana&status=suspended&limit=50');
    expect(hrefOf('Banco com problema')).toBe('/plataforma?q=ana&banco=problema&limit=50');
    for (const chip of chips()) expect(chip.getAttribute('href')).not.toContain('cursor');
  });

  it('marks exactly one chip active with aria-current: Todos by default, the database chip under ?banco', () => {
    render(<TenantToolbar />);
    expect(
      chips()
        .filter((chip) => chip.getAttribute('aria-current') === 'page')
        .map((chip) => chip.textContent),
    ).toEqual(['Todos']);
    cleanup();
    render(<TenantToolbar banco="problema" />);
    expect(
      chips()
        .filter((chip) => chip.getAttribute('aria-current') === 'page')
        .map((chip) => chip.textContent),
    ).toEqual(['Banco com problema']);
    cleanup();
    render(<TenantToolbar status="active" />);
    expect(
      chips()
        .filter((chip) => chip.getAttribute('aria-current') === 'page')
        .map((chip) => chip.textContent),
    ).toEqual(['Ativos']);
  });

  it('keeps the row inside the screen by letting the chips wrap', () => {
    render(<TenantToolbar />);
    expect(screen.getByRole('navigation', { name: 'Filtrar por status' }).className).toContain(
      'flex-wrap',
    );
  });

  it('keeps ?banco and limit when the search box changes q', async () => {
    vi.useFakeTimers();
    try {
      render(<TenantToolbar banco="problema" limit={10} />);
      fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar' }), {
        target: { value: 'ana' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(nav.replace).toHaveBeenLastCalledWith('/plataforma?q=ana&banco=problema&limit=10');
    } finally {
      vi.useRealTimers();
    }
  });
});
