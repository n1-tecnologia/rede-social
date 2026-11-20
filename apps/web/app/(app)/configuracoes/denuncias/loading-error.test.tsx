// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 11-25 (UI-D-878, E9 loading and error): `loading.tsx` draws the header, the chips' shape and the row skeletons with
 * the 56px player bar of a voice row and never a "Ver conteúdo"; `error.tsx` is the shipped card whose retry is
 * Next 16.3's `retry` (not `reset`) and which logs the digest only.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('./actions', () => ({ resolveReport: vi.fn(), loadMoreReportsAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    useTranslations: (namespace: string) => {
      let tr = byNamespace.get(namespace);
      if (!tr) {
        tr = actual.createTranslator({ locale: 'pt-BR', messages, namespace });
        byNamespace.set(namespace, tr);
      }
      return tr;
    },
  };
});

const { default: ReportsLoading } = await import('./loading');
const { default: ReportsError } = await import('./error');

afterEach(cleanup);

describe('loading.tsx', () => {
  it('draws the header, three chip placeholders and four rows, the second with the 56px voice bar', async () => {
    const { container } = render(await ReportsLoading());
    expect(screen.getByRole('heading', { name: 'Denúncias' })).toBeTruthy();
    expect(container.querySelectorAll('[data-reports-skeleton] > div')).toHaveLength(4);
    const voice = container.querySelectorAll('[data-reports-skeleton-voice]');
    expect(voice).toHaveLength(1);
    expect(voice[0]?.className).toContain('h-14');
    // nothing is a link or a control while loading ("Ver conteúdo" is never drawn)
    expect(container.querySelectorAll('a, button')).toHaveLength(1); // the header's back link only
    expect(container.textContent).not.toContain('Ver conteúdo');
  });
});

describe('error.tsx', () => {
  it('shows the shipped card with "Tentar novamente" wired to retry, and logs the digest only', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();
    const error = Object.assign(new Error('boom: Carla Nunes escreveu algo'), { digest: 'abc123' });
    render(<ReportsError error={error} retry={retry} />);
    expect(screen.getByText('Algo deu errado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('reports.queue_segment_error', { digest: 'abc123' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Carla Nunes');
    spy.mockRestore();
  });
});
