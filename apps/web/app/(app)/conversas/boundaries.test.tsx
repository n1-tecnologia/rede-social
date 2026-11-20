// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 11-19 Task 2 (UI-D-863): the route's two special files. Loading draws the header AT ONCE and three skeleton rows,
 * `aria-busy`; the segment error boundary draws the header and the list's own card with "Tentar novamente"
 * (calling Next's `retry`), never the support row. The catalog is the REAL pt-BR one.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    useTranslations: (namespace: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace }),
  };
});
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { default: ConversationsLoading } = await import('./loading');
const { default: ConversationsError } = await import('./error');

afterEach(cleanup);

describe('/conversas loading (UI-D-863)', () => {
  it('the header renders at once with its back control and title, then three skeleton rows, aria-busy', async () => {
    render((await ConversationsLoading()) as ReactElement);
    expect(screen.getByRole('heading', { name: 'Conversas' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar' }).getAttribute('href')).toBe('/inicio');
    expect(document.querySelector('[data-conversations-loading]')?.hasAttribute('aria-busy')).toBe(
      true,
    );
    expect(document.querySelectorAll('[data-conversations-skeleton-row]')).toHaveLength(3);
    // Nothing that is data: no list, no support row.
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('/conversas error boundary (UI-D-863)', () => {
  it('draws the header and the card with Tentar novamente, calls retry, and logs only the digest', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();
    const error = Object.assign(new Error('boom: Carla Nunes said hi'), { digest: 'abc123' });
    render(<ConversationsError error={error} retry={retry} />);
    expect(screen.getByRole('heading', { name: 'Conversas' })).toBeTruthy();
    expect(screen.getByText('Não foi possível carregar suas conversas.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('list')).toBeNull();
    expect(spy).toHaveBeenCalledWith('chat.conversations_segment_error', { digest: 'abc123' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Carla');
    spy.mockRestore();
  });
});
