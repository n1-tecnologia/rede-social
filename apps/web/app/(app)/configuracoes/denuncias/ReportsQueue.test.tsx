// @vitest-environment happy-dom

import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiItem, MEDIA_ID, queueRow } from './fixtures.test-helper';
import type { ReportsQueueProps } from './ReportsQueue';

/**
 * 11-25 (MODER-04, MODER-05, D-616, D-731, D-732, UI-D-637, UI-D-873, UI-D-874, UI-D-878): the queue on the shipped
 * client, with the REAL pt-BR catalog. `InfiniteScroll` is a button (happy-dom has no scrolling IntersectionObserver),
 * the two server actions are stubbed at the transport, and the toast provider draws the toasts.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
const actions = vi.hoisted(() => ({ resolveReport: vi.fn(), loadMoreReportsAction: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: nav.refresh, replace: nav.replace }),
}));
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
      createElement('a', { href, ...rest }, children as never),
  };
});
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('./actions', () => ({
  resolveReport: (...args: unknown[]) => actions.resolveReport(...args),
  loadMoreReportsAction: (...args: unknown[]) => actions.loadMoreReportsAction(...args),
}));
vi.mock('@rede-social/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rede-social/ui')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    InfiniteScroll: ({
      hasMore,
      enabled = true,
      onLoadMore,
    }: {
      hasMore: boolean;
      enabled?: boolean;
      onLoadMore: () => void;
      skeleton?: ReactNode;
    }) =>
      hasMore && enabled
        ? createElement(
            'button',
            { type: 'button', 'data-load-more': true, onClick: onLoadMore },
            'mais',
          )
        : null,
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

const { ReportsQueue } = await import('./ReportsQueue');

const uuid = (n: number) => `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n: number, over: Parameters<typeof queueRow>[0] = {}) =>
  queueRow({ id: uuid(n), ...over });

function mount(props: Partial<ReportsQueueProps> = {}) {
  return render(
    <ToastProvider>
      <ReportsQueue
        initialItems={[row(1)]}
        initialCursor={null}
        estado="abertas"
        tenantName="Rede Demo"
        {...props}
      />
    </ToastProvider>,
  );
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-report-row]'));
const rowOf = (n: number) => document.querySelector<HTMLElement>(`[data-report-row="${uuid(n)}"]`);

beforeEach(() => {
  nav.refresh.mockReset();
  nav.replace.mockReset();
  actions.resolveReport.mockReset();
  actions.loadMoreReportsAction.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(cleanup);

describe('the tracer: ignore a reported story (Test 1)', () => {
  it('shows the row, opens "Resolver denúncia", ignores once, toasts and reads "Ignorada"', async () => {
    actions.resolveReport.mockResolvedValue({ ok: true, code: 'ok', status: 'dismissed' });
    mount();

    const first = rowOf(1) as HTMLElement;
    expect(within(first).getByText('Story')).toBeTruthy();
    expect(within(first).getByText('Aberta')).toBeTruthy();
    expect(within(first).getByText('Compre agora o curso milagroso')).toBeTruthy();
    expect(
      within(first).getByText('Motivo: Spam ou propaganda · por Larissa Souza · 19/11/2026'),
    ).toBeTruthy();
    expect(within(first).getByText('Autor: Carla Nunes')).toBeTruthy();
    const view = within(first).getByRole('link', { name: 'Ver conteúdo' });
    expect(view.getAttribute('href')).toBe('/stories/0d000000-0000-4000-8000-000000000001');

    fireEvent.click(within(first).getByRole('button', { name: 'Resolver' }));
    expect(await screen.findByRole('heading', { name: 'Resolver denúncia' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ignorar denúncia' }));
    });

    expect(actions.resolveReport).toHaveBeenCalledTimes(1);
    expect(actions.resolveReport).toHaveBeenCalledWith(uuid(1), 'dismiss', undefined);
    expect(await screen.findByText('Denúncia resolvida.')).toBeTruthy();
    const after = rowOf(1) as HTMLElement;
    expect(within(after).getByText('Ignorada')).toBeTruthy();
    expect(within(after).queryByText('Aberta')).toBeNull();
    expect(within(after).queryByRole('button', { name: 'Resolver' })).toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Resolver denúncia' })).toBeNull(),
    );
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('a double tap on a resolve action sends ONE request', async () => {
    let finish: (value: unknown) => void = () => undefined;
    actions.resolveReport.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    const ignore = await screen.findByRole('button', { name: 'Ignorar denúncia' });
    fireEvent.click(ignore);
    fireEvent.click(ignore);
    expect(actions.resolveReport).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, code: 'ok', status: 'dismissed' }));
  });
});

describe('the outcomes (UI-D-874, MODER-04)', () => {
  async function openAndIgnore() {
    fireEvent.click(screen.getAllByRole('button', { name: 'Resolver' })[0] as HTMLElement);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Ignorar denúncia' }));
    });
  }

  it('another administrator resolved it first: the row stops offering Resolver, the toast says so, the page refreshes', async () => {
    actions.resolveReport.mockResolvedValue({ ok: false, code: 'already_resolved' });
    mount({ initialItems: [row(1), row(2)] });
    await openAndIgnore();
    expect(await screen.findByText('Esta denúncia já foi resolvida.')).toBeTruthy();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(within(rowOf(1) as HTMLElement).queryByRole('button', { name: 'Resolver' })).toBeNull();
    // the other row is untouched and nothing was reordered
    expect(within(rowOf(2) as HTMLElement).getByRole('button', { name: 'Resolver' })).toBeTruthy();
    expect(rows().map((r) => r.dataset.reportRow)).toEqual([uuid(1), uuid(2)]);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Resolver denúncia' })).toBeNull(),
    );
  });

  it.each(['not_removable', 'author_unavailable', 'failed'])(
    'a %s answer is the shipped error toast: the report stays open and the sheet stays',
    async (code) => {
      actions.resolveReport.mockResolvedValue({ ok: false, code });
      mount();
      await openAndIgnore();
      expect(await screen.findByText('Não foi possível concluir. Tente novamente.')).toBeTruthy();
      expect(within(rowOf(1) as HTMLElement).getByText('Aberta')).toBeTruthy();
      expect(
        within(rowOf(1) as HTMLElement).getByRole('button', { name: 'Resolver' }),
      ).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Resolver denúncia' })).toBeTruthy();
      expect(nav.refresh).not.toHaveBeenCalled();
    },
  );

  it('a rejected action is a plain failure, never a crash', async () => {
    actions.resolveReport.mockRejectedValue(new Error('offline'));
    mount();
    await openAndIgnore();
    expect(await screen.findByText('Não foi possível concluir. Tente novamente.')).toBeTruthy();
  });

  it('a lost permission toasts and refreshes (the refreshed page is notFound())', async () => {
    actions.resolveReport.mockResolvedValue({ ok: false, code: 'unauthenticated' });
    mount();
    await openAndIgnore();
    expect(await screen.findByText('Você não tem mais permissão para esta ação.')).toBeTruthy();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('archiving a community leaves the row reading "Comunidade arquivada"', async () => {
    actions.resolveReport.mockResolvedValue({ ok: true, code: 'ok', status: 'content_removed' });
    mount({
      initialItems: [
        row(1, { subjectType: 'community', excerpt: 'Clube de leitura\nEncontros às quintas.' }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Arquivar comunidade' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Arquivar' }));
    });
    expect(actions.resolveReport).toHaveBeenCalledWith(uuid(1), 'remove_content', undefined);
    expect(await screen.findByText('Comunidade arquivada')).toBeTruthy();
  });

  it('blocking the author sends the internal reason and the row reads "Autor bloqueado"', async () => {
    actions.resolveReport.mockResolvedValue({ ok: true, code: 'ok', status: 'author_blocked' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Bloquear autor' }));
    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), { target: { value: 'spam' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    });
    expect(actions.resolveReport).toHaveBeenCalledWith(uuid(1), 'block_author', 'spam');
    expect(await screen.findByText('Autor bloqueado')).toBeTruthy();
  });
});

describe('the six subjects (UI-D-873)', () => {
  it('a story with no text reads "Story sem texto."', () => {
    mount({ initialItems: [row(1, { excerpt: '' })] });
    expect(screen.getByText('Story sem texto.')).toBeTruthy();
  });

  it('a story comment, a post and a post comment read as clamped text with their own pill', () => {
    mount({
      initialItems: [
        row(1, { subjectType: 'story_comment', excerpt: 'Que story bonito' }),
        row(2, { subjectType: 'feed_post', excerpt: 'Meu post', ref: undefined }),
        row(3, {
          subjectType: 'post_comment',
          excerpt: 'Meu comentário',
          ref: { postId: uuid(90) },
        }),
      ],
    });
    expect(within(rowOf(1) as HTMLElement).getByText('Comentário de story')).toBeTruthy();
    expect(within(rowOf(2) as HTMLElement).getByText('Publicação')).toBeTruthy();
    expect(within(rowOf(3) as HTMLElement).getByText('Comentário')).toBeTruthy();
    const body = within(rowOf(1) as HTMLElement).getByText('Que story bonito');
    expect(body.className).toContain('line-clamp-3');
    expect(body.className).toContain('break-words');
    expect(
      within(rowOf(3) as HTMLElement)
        .getByRole('link', { name: 'Ver conteúdo' })
        .getAttribute('href'),
    ).toBe(`/post/${uuid(90)}?comentario=${apiItem().subjectId}`);
  });

  it('a community draws the name 14/700 on one line and the description on two', () => {
    mount({
      initialItems: [
        row(1, {
          subjectType: 'community',
          excerpt: 'Clube de leitura da Aurora\nEncontros às quintas.',
          community: { name: 'Clube de leitura da Aurora', description: 'Encontros às quintas.' },
        }),
      ],
    });
    const name = screen.getByText('Clube de leitura da Aurora');
    expect(name.className).toContain('font-bold');
    expect(name.className).toContain('line-clamp-1');
    expect(screen.getByText('Encontros às quintas.').className).toContain('line-clamp-2');
    expect(screen.getByText('Comunidade')).toBeTruthy();
  });

  it('a text message shows whole (280 characters, no clamp) with the note, no link and no conversation', () => {
    const copy = `${'a'.repeat(140)}\n${'b'.repeat(139)}`;
    mount({
      initialItems: [row(1, { subjectType: 'direct_message', excerpt: copy, ref: undefined })],
    });
    const first = rowOf(1) as HTMLElement;
    const text = first.querySelector('[data-report-message-text]') as HTMLElement;
    expect(text.textContent).toBe(copy);
    expect(text.className).toContain('whitespace-pre-wrap');
    expect(text.className).not.toContain('line-clamp');
    expect(within(first).getByText('Só esta mensagem é mostrada.')).toBeTruthy();
    expect(within(first).getByText('Mensagem')).toBeTruthy();
    expect(first.querySelectorAll('a')).toHaveLength(0);
    expect(within(first).queryByText('Ver conteúdo')).toBeNull();
    // the reporter's and the author's names are in the meta lines only, never a conversation name
    expect(first.innerHTML).not.toMatch(/conversa/i);
  });

  it('a voice message draws the player inside the row, with nothing loaded until the first tap', () => {
    mount({
      initialItems: [
        row(1, {
          subjectType: 'direct_message',
          excerpt: '',
          ref: undefined,
          voice: { mediaId: MEDIA_ID, durationSeconds: 42, gone: false },
        }),
      ],
    });
    const first = rowOf(1) as HTMLElement;
    const audio = first.querySelector('audio') as HTMLAudioElement;
    expect(audio.hasAttribute('src')).toBe(false);
    expect(within(first).getByRole('button', { name: 'Tocar mensagem de voz' })).toBeTruthy();
    expect(first.querySelectorAll('a')).toHaveLength(0);
  });

  it('a retired recording reads "Mensagem de voz apagada" with no player and still resolves', () => {
    mount({
      initialItems: [
        row(1, {
          subjectType: 'direct_message',
          excerpt: '',
          ref: undefined,
          voice: { mediaId: MEDIA_ID, durationSeconds: 42, gone: true },
        }),
      ],
    });
    const first = rowOf(1) as HTMLElement;
    expect(within(first).getByText('Mensagem de voz apagada')).toBeTruthy();
    expect(first.querySelectorAll('audio')).toHaveLength(0);
    expect(within(first).getByRole('button', { name: 'Resolver' })).toBeTruthy();
  });

  it('an item that is gone reads "Conteúdo não está mais disponível" with no link, and still resolves', () => {
    mount({ initialItems: [row(1, { contentAvailable: false, excerpt: 'texto antigo' })] });
    const first = rowOf(1) as HTMLElement;
    expect(within(first).getByText('Conteúdo não está mais disponível')).toBeTruthy();
    expect(within(first).queryByText('texto antigo')).toBeNull();
    expect(within(first).queryByRole('link')).toBeNull();
    expect(within(first).getByRole('button', { name: 'Resolver' })).toBeTruthy();
  });

  it('a report with no text and no description renders no blank body and still resolves (MODER-05 empty)', () => {
    mount({ initialItems: [row(1, { subjectType: 'feed_post', excerpt: '', ref: undefined })] });
    const first = rowOf(1) as HTMLElement;
    expect(first.querySelector('[data-report-body]')).toBeNull();
    expect(within(first).getByRole('button', { name: 'Resolver' })).toBeTruthy();
  });

  it('the pill line wraps instead of clipping at 320px', () => {
    mount();
    const pills = (rowOf(1) as HTMLElement).querySelector('.flex-wrap') as HTMLElement;
    expect(pills.className).toContain('flex');
    expect(pills.className).toContain('items-center');
    expect(pills.textContent).toBe('StoryAberta');
  });

  it('every member string is React text, never markup (T-11-16)', () => {
    mount({
      initialItems: [
        row(1, {
          excerpt: '<img src=x onerror=alert(1)>',
          reporter: { displayName: '<b>Ana</b>', avatarAssetId: null },
          author: { displayName: '<i>Bia</i>', avatarAssetId: null, isMember: true },
        }),
      ],
    });
    const first = rowOf(1) as HTMLElement;
    expect(first.querySelector('img, b, i')).toBeNull();
    expect(first.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(first.textContent).toContain('<i>Bia</i>');
  });

  it('a departed reporter and author read "Membro removido"', () => {
    mount({
      initialItems: [
        row(1, {
          reporter: { displayName: null, avatarAssetId: null },
          author: { displayName: null, avatarAssetId: null, isMember: false },
        }),
      ],
    });
    expect(screen.getByText(/por Membro removido/)).toBeTruthy();
    expect(screen.getByText('Autor: Membro removido')).toBeTruthy();
  });
});

describe('filters and states (UI-D-637, UI-D-878)', () => {
  it('draws exactly the three chips and NO filter by subject (A-UI-14)', () => {
    mount();
    const chips = Array.from(document.querySelectorAll('[data-reports-filters] button')).map(
      (b) => b.textContent,
    );
    expect(chips).toEqual(['Abertas', 'Resolvidas', 'Todas']);
    expect(
      (document.querySelector('[data-reports-filters] [aria-pressed="true"]') as HTMLElement)
        .textContent,
    ).toBe('Abertas');
  });

  it('a chip binds the URL: the bare route for "Abertas", the API value otherwise', () => {
    mount({ estado: 'resolvidas' });
    expect(
      (document.querySelector('[data-reports-filters] [aria-pressed="true"]') as HTMLElement)
        .textContent,
    ).toBe('Resolvidas');
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    expect(nav.replace).toHaveBeenLastCalledWith('/configuracoes/denuncias?estado=todas', {
      scroll: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Abertas' }));
    expect(nav.replace).toHaveBeenLastCalledWith('/configuracoes/denuncias', { scroll: false });
    // the chip already chosen does nothing
    nav.replace.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Resolvidas' }));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it.each(['abertas', 'resolvidas', 'todas'] as const)(
    'the "%s" filter with no reports draws the widened empty state',
    (estado) => {
      mount({ initialItems: [], estado });
      const empty = document.querySelector(`[data-reports-empty="${estado}"]`) as HTMLElement;
      expect(empty.textContent).toContain('Nenhuma denúncia por aqui');
      expect(empty.textContent).toContain(
        'Quando um membro denunciar uma publicação, um comentário, um story, uma comunidade ou uma mensagem, ela aparece aqui.',
      );
    },
  );

  it('a failed first read is the error card with a retry, never an empty queue', async () => {
    actions.loadMoreReportsAction.mockResolvedValue({
      ok: true,
      items: [row(1)],
      nextCursor: null,
    });
    mount({ initialItems: [], initialError: true });
    expect(document.querySelector('[data-reports-error]')).not.toBeNull();
    expect(document.querySelector('[data-reports-empty]')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    });
    expect(actions.loadMoreReportsAction).toHaveBeenCalledWith(null, 'abertas');
    expect(rows()).toHaveLength(1);
  });
});

describe('keyset paging (zero-one-many, ordering)', () => {
  it('appends the next page in the API order and never repeats a row', async () => {
    actions.loadMoreReportsAction.mockResolvedValue({
      ok: true,
      items: [row(2), row(1), row(3)],
      nextCursor: null,
    });
    mount({ initialItems: [row(1)], initialCursor: 'c1' });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement);
    });
    expect(actions.loadMoreReportsAction).toHaveBeenCalledWith('c1', 'abertas');
    expect(rows().map((r) => r.dataset.reportRow)).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(document.querySelector('[data-load-more]')).toBeNull();
  });

  it('a failed page keeps every loaded row, shows the inline retry and stands the sentinel down', async () => {
    actions.loadMoreReportsAction.mockResolvedValueOnce({ ok: false, code: 'generic' });
    mount({ initialItems: [row(1), row(2)], initialCursor: 'c1' });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement);
    });
    expect(rows()).toHaveLength(2);
    const failure = document.querySelector('[data-reports-page-error]') as HTMLElement;
    expect(failure.textContent).toContain('Algo deu errado. Tente novamente.');
    expect(document.querySelector('[data-load-more]')).toBeNull();
    // the three filters survive
    expect(document.querySelectorAll('[data-reports-filters] button')).toHaveLength(3);
    fireEvent.click(within(failure).getByRole('button', { name: 'Tentar novamente' }));
    expect(document.querySelector('[data-load-more]')).not.toBeNull();
  });

  it('resolving one row never reorders the others', async () => {
    actions.resolveReport.mockResolvedValue({ ok: true, code: 'ok', status: 'dismissed' });
    mount({ initialItems: [row(1), row(2), row(3)] });
    fireEvent.click(within(rowOf(2) as HTMLElement).getByRole('button', { name: 'Resolver' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Ignorar denúncia' }));
    });
    expect(rows().map((r) => r.dataset.reportRow)).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(within(rowOf(2) as HTMLElement).getByText('Ignorada')).toBeTruthy();
    expect(within(rowOf(1) as HTMLElement).getByText('Aberta')).toBeTruthy();
  });
});

describe('what the screen never does', () => {
  it('nothing in the queue notifies or names an outcome to the author or the reporter', () => {
    mount({
      initialItems: [
        row(1),
        row(2, { subjectType: 'direct_message', excerpt: 'Oi', ref: undefined }),
      ],
    });
    expect(document.body.textContent ?? '').not.toMatch(/notific|avis(ar|ado) (a|o) /i);
  });
});
