// @vitest-environment happy-dom

import type { ReportSubjectType } from '@rede-social/contracts/moderation';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiItem, MEDIA_ID, queueRow } from './fixtures.test-helper';

/**
 * 11-25 (MODER-04, D-732, UI-D-638, UI-D-874, T-11-30): the resolve sheet renders EXACTLY the actions legal for the
 * report's subject, never a disabled one: a row that is not legal is absent from the DOM. Removal and archive go
 * through the danger `ConfirmDialog` with the contract copy, and a block opens the Phase 8 block step with its
 * optional internal reason. REAL pt-BR catalog.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
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

const { ResolveSheet } = await import('./ResolveSheet');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Row = ReturnType<typeof queueRow>;

function mount(row: Row, onResolve = vi.fn(async (): Promise<void> => undefined)) {
  const onClose = vi.fn();
  render(
    <ResolveSheet row={row} open onClose={onClose} tenantName="Rede Demo" onResolve={onResolve} />,
  );
  return { onResolve, onClose };
}

const names = () => screen.getAllByRole('button').map((b) => b.textContent?.trim());

describe('ResolveSheet: only the legal rows (UI-D-874)', () => {
  const POST_LIKE: ReportSubjectType[] = ['feed_post', 'post_comment', 'story', 'story_comment'];

  it.each(POST_LIKE)(
    'a %s offers Ignorar, Remover and Bloquear autor, in that order, and no Arquivar',
    (subjectType) => {
      mount(queueRow({ subjectType }));
      expect(screen.getByRole('heading', { name: 'Resolver denúncia' })).toBeTruthy();
      expect(names()).toEqual(['Ignorar denúncia', 'Remover conteúdo', 'Bloquear autor']);
      expect(screen.queryByText('Arquivar comunidade')).toBeNull();
      expect(document.querySelector('[data-resolve-helper]')).toBeNull();
    },
  );

  it('a community offers Ignorar, Arquivar comunidade and Bloquear autor, and NEVER "Remover"', () => {
    mount(queueRow({ subjectType: 'community', excerpt: 'Clube\nDescrição' }));
    expect(names()).toEqual(['Ignorar denúncia', 'Arquivar comunidade', 'Bloquear autor']);
    expect(screen.queryByText(/Remover/)).toBeNull();
    expect(document.querySelector('[data-resolve-sheet] svg.lucide-archive')).not.toBeNull();
  });

  it('a community with a non-member author has no Bloquear autor row at all', () => {
    mount(
      queueRow({
        subjectType: 'community',
        author: { displayName: 'Organização', avatarAssetId: null, isMember: false },
      }),
    );
    expect(names()).toEqual(['Ignorar denúncia', 'Arquivar comunidade']);
    expect(screen.queryByText('Bloquear autor')).toBeNull();
  });

  it('a message offers ONLY Ignorar and Bloquear autor, with the helper line and no Remover, no Arquivar', () => {
    mount(queueRow({ subjectType: 'direct_message', excerpt: 'Oi' }));
    expect(names()).toEqual(['Ignorar denúncia', 'Bloquear autor']);
    expect(screen.queryByText('Remover conteúdo')).toBeNull();
    expect(screen.queryByText('Arquivar comunidade')).toBeNull();
    expect(screen.getByText('Uma mensagem enviada não pode ser removida.')).toBeTruthy();
  });

  it('a message whose sender was deleted has no Bloquear autor, only Ignorar and the helper', () => {
    mount(
      queueRow({
        subjectType: 'direct_message',
        excerpt: 'Oi',
        author: { displayName: null, avatarAssetId: null, isMember: false },
      }),
    );
    expect(names()).toEqual(['Ignorar denúncia']);
    expect(screen.getByText('Uma mensagem enviada não pode ser removida.')).toBeTruthy();
  });

  it('every subject: an illegal row is absent from the DOM, never disabled or hidden by a class', () => {
    const SUBJECTS: ReportSubjectType[] = [
      'feed_post',
      'post_comment',
      'story',
      'story_comment',
      'community',
      'direct_message',
    ];
    for (const subjectType of SUBJECTS) {
      const { unmount } = render(
        <ResolveSheet
          row={queueRow({ subjectType, excerpt: 'a\nb' })}
          open
          onClose={() => undefined}
          tenantName="Rede Demo"
          onResolve={async () => undefined}
        />,
      );
      expect(document.querySelectorAll('[data-resolve-sheet] button:disabled')).toHaveLength(0);
      expect(document.querySelectorAll('[data-resolve-sheet] [class*="hidden"]')).toHaveLength(0);
      const labels = names();
      if (subjectType === 'direct_message') expect(labels).not.toContain('Remover conteúdo');
      if (subjectType === 'community') expect(labels).not.toContain('Remover conteúdo');
      if (subjectType !== 'community') expect(labels).not.toContain('Arquivar comunidade');
      unmount();
    }
  });

  it('a report that is not open has nothing to resolve', () => {
    mount(queueRow({ status: 'dismissed' }));
    expect(screen.queryByText('Ignorar denúncia')).toBeNull();
  });
});

describe('ResolveSheet: the actions', () => {
  it('Ignorar denúncia needs no confirmation and calls the host once, even on a double tap', async () => {
    let release: () => void = () => undefined;
    const onResolve = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const row = queueRow();
    mount(row, onResolve);
    const button = screen.getByRole('button', { name: 'Ignorar denúncia' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(row, 'dismiss', undefined);
    await act(async () => release());
  });

  it('Remover conteúdo opens the danger dialog; Cancelar sends nothing and returns to the sheet', async () => {
    const { onResolve } = mount(queueRow());
    fireEvent.click(screen.getByRole('button', { name: 'Remover conteúdo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remover este conteúdo?' });
    expect(dialog.textContent).toContain(
      'O conteúdo some para todos. A ação fica registrada no histórico de moderação.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Remover este conteúdo?' })).toBeNull(),
    );
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remover conteúdo' })).toBeTruthy();
  });

  it('confirming the removal sends remove_content', async () => {
    const row = queueRow();
    const { onResolve } = mount(row);
    fireEvent.click(screen.getByRole('button', { name: 'Remover conteúdo' }));
    await screen.findByRole('dialog', { name: 'Remover este conteúdo?' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    });
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(row, 'remove_content', undefined);
  });

  it('the archive dialog is verbatim with the log sentence appended; "Manter comunidade" sends nothing', async () => {
    const row = queueRow({ subjectType: 'community', excerpt: 'Clube\nDescrição' });
    const { onResolve } = mount(row);
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar comunidade' }));
    const dialog = await screen.findByRole('dialog', { name: 'Arquivar comunidade?' });
    expect(dialog.textContent).toContain(
      'Ela sai da lista e ninguém mais publica nela. A pessoa que criou não é avisada. A ação fica registrada no histórico de moderação.',
    );
    expect(screen.getByRole('button', { name: 'Manter comunidade' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Manter comunidade' }));
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('confirming the archive sends remove_content (the API archives a community)', async () => {
    const row = queueRow({ subjectType: 'community', excerpt: 'Clube\nDescrição' });
    const { onResolve } = mount(row);
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar comunidade' }));
    await screen.findByRole('dialog', { name: 'Arquivar comunidade?' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    });
    expect(onResolve).toHaveBeenCalledWith(row, 'remove_content', undefined);
  });
});

describe('ResolveSheet: Bloquear autor opens the admin block step', () => {
  it('shows "Bloquear {nome}?", the effect body and the optional reason; Voltar keeps the draft', () => {
    mount(queueRow());
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear autor' }));
    expect(screen.getByRole('heading', { name: 'Bloquear Carla Nunes?' })).toBeTruthy();
    expect(document.body.textContent).toContain('Carla Nunes perde o acesso a Rede Demo');
    const reason = screen.getByLabelText('Motivo (opcional)') as HTMLTextAreaElement;
    expect(reason.maxLength).toBe(500);
    fireEvent.change(reason, { target: { value: 'Spam repetido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('heading', { name: 'Resolver denúncia' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear autor' }));
    expect((screen.getByLabelText('Motivo (opcional)') as HTMLTextAreaElement).value).toBe(
      'Spam repetido',
    );
  });

  it('sends block_author with the trimmed reason, or none for a blank one', async () => {
    const row = queueRow();
    const { onResolve } = mount(row);
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear autor' }));
    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), {
      target: { value: '  ofensas  ' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    });
    expect(onResolve).toHaveBeenLastCalledWith(row, 'block_author', 'ofensas');

    // The host closes the sheet on success; here it stays open, so go back and try again with a blank reason.
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear autor' }));
    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), { target: { value: '   ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    });
    expect(onResolve).toHaveBeenLastCalledWith(row, 'block_author', undefined);
  });

  it('the author name is React text: markup in it is shown, never parsed', () => {
    mount(
      queueRow({
        author: {
          displayName: '<img src=x onerror=alert(1)>',
          avatarAssetId: null,
          isMember: true,
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear autor' }));
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('ResolveSheet: a voice message report', () => {
  it('offers the message rows only (the recording never changes what is legal)', () => {
    mount(
      queueRow({
        subjectType: 'direct_message',
        excerpt: '',
        voice: { mediaId: MEDIA_ID, durationSeconds: 42, gone: false },
        author: apiItem().author,
      }),
    );
    expect(names()).toEqual(['Ignorar denúncia', 'Bloquear autor']);
  });
});
