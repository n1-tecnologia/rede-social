// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.2-21 (UI-D-542, DBT-53, A-UI-7, UI-D-547; T-09.2-94; P104; E09 backstop) — "Comunidade em preparação" is a calm,
 * branded, stateless public screen: Hourglass 28, one sentence, ONE outline action back to `/inicio`, no
 * timer, no refresh, no cookie / header / param read, and none of the platform's words. Real pt-BR catalog.
 */

const mocks = vi.hoisted(() => ({ touched: [] as string[] }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
// The screen must read NOTHING per request: each of these throws if it is ever called.
vi.mock('next/headers', () => ({
  cookies: async () => {
    mocks.touched.push('cookies');
    throw new Error('cookies() must not be read');
  },
  headers: async () => {
    mocks.touched.push('headers');
    throw new Error('headers() must not be read');
  },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    mocks.touched.push('useSearchParams');
    throw new Error('useSearchParams() must not be read');
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: Page } = await import('./page');

const FORBIDDEN = [/banco/i, /projeto/i, /esquema/i, /migra[cç][aã]o/i, /supabase/i, /tenant/i];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.touched.length = 0;
});

describe('Comunidade em preparação', () => {
  it('renders the glyph, the title, the sentence and the single outline action to /inicio', async () => {
    const { container } = render(await Page());
    expect(screen.getByRole('heading', { name: 'Comunidade em preparação' })).toBeTruthy();
    expect(
      screen.getByText('Esta comunidade ainda está sendo preparada. Volte em breve.'),
    ).toBeTruthy();
    expect(container.querySelector('svg.lucide-hourglass')).not.toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('28');

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe('Verificar de novo');
    expect(links[0]?.getAttribute('href')).toBe('/inicio');
    expect(links[0]?.className).toContain('border-border-secondary');
    expect(links[0]?.className).toContain('h-13');
    expect(links[0]?.className).toContain('w-full');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('has no auto-refresh and no countdown: no meta refresh, no timer, nothing changes with time', async () => {
    vi.useFakeTimers();
    const { container } = render(await Page());
    const before = container.innerHTML;
    expect(vi.getTimerCount()).toBe(0);
    expect(document.head.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    expect(container.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(container.innerHTML).toBe(before);
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('reads no prop, cookie, header or search param (P104: a reload, a second press and a second device see the same)', async () => {
    const first = render(await Page());
    const html = first.container.innerHTML;
    cleanup();
    const second = render(await Page());
    expect(second.container.innerHTML).toBe(html);
    expect(mocks.touched).toEqual([]);
    expect(Page.length).toBe(0);
  });

  it('never says why, where or for how long: the platform vocabulary is absent (T-09.2-94, UI-D-547)', async () => {
    const { container } = render(await Page());
    for (const word of FORBIDDEN) expect(container.textContent ?? '').not.toMatch(word);
  });

  it('E09 backstop: the title and the sentence wrap inside the column, centred, never truncated', async () => {
    const { container } = render(await Page());
    const title = screen.getByRole('heading', { name: 'Comunidade em preparação' });
    const body = screen.getByText('Esta comunidade ainda está sendo preparada. Volte em breve.');
    for (const node of [title, body]) {
      expect(node.className).not.toMatch(/whitespace-nowrap|truncate|overflow-hidden/);
    }
    expect(body.className).toContain('max-w-[260px]');
    expect(title.parentElement?.className).toContain('text-center');
    expect(title.parentElement?.className).toContain('items-center');
    expect(container.firstElementChild?.className).toContain('w-full');
  });
});
