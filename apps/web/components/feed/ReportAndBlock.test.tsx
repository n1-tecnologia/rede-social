// @vitest-environment happy-dom

import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 11-20 (MODER-05, D-731, UI-D-871): the shared report sheet, with the REAL pt-BR catalog through next-intl's own
 * translator and the server action stubbed. Every sentence asserted is the catalog's, so a rewording there is
 * caught here.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

const actions = vi.hoisted(() => ({ reportContent: vi.fn() }));

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

const { ReportAndBlock, useReportAndBlock } = await import('./ReportAndBlock');
const { CommentItem } = await import('@rede-social/module-feed/ui');

afterEach(cleanup);
beforeEach(() => {
  actions.reportContent.mockReset();
});

const SUBJECT = '0b9a3c2e-5d1f-4e7a-9c3b-2f6d8e1a4b70';

function mount(subject: Parameters<typeof ReportAndBlock>[0]['report']) {
  const onReportClose = vi.fn();
  render(
    <ToastProvider>
      <ReportAndBlock
        report={subject}
        onReportClose={onReportClose}
        tenantName="Instituto Aurora"
        reportAction={actions.reportContent}
      />
    </ToastProvider>,
  );
  return { onReportClose };
}

const send = () =>
  screen.getByRole('button', { name: /Enviar denúncia|Enviando…/ }) as HTMLButtonElement;
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const noteField = () =>
  screen.getByLabelText('Quer dar mais detalhes? (opcional)') as HTMLTextAreaElement;

describe('the report sheet (UI-D-871)', () => {
  it('title, intro with the tenant and the five reasons; the send button is off until a reason is chosen', () => {
    mount({ subjectType: 'post_comment', subjectId: SUBJECT });
    expect(screen.getByRole('heading', { name: 'Denunciar comentário' })).toBeTruthy();
    expect(
      screen.getByText('Diga o que há de errado. A equipe de Instituto Aurora vai analisar.'),
    ).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(send().disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Spam ou propaganda' }));
    expect(send().disabled).toBe(false);
  });

  it.each([
    ['feed_post', undefined, 'Denunciar publicação'],
    ['story', undefined, 'Denunciar story'],
    ['community', undefined, 'Denunciar comunidade'],
    ['direct_message', false, 'Denunciar mensagem'],
    ['direct_message', true, 'Denunciar mensagem de voz'],
  ] as const)('the title of %s (voice %s) is %s', (subjectType, voice, title) => {
    mount({ subjectType, subjectId: SUBJECT, ...(voice === undefined ? {} : { voice }) });
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
  });

  it('a message adds its one privacy line and no other subject does', () => {
    mount({ subjectType: 'direct_message', subjectId: SUBJECT });
    expect(screen.getByText('A equipe vê só esta mensagem, não o resto da conversa.')).toBeTruthy();
    cleanup();
    mount({ subjectType: 'feed_post', subjectId: SUBJECT });
    expect(document.querySelector('[data-report-privacy]')).toBeNull();
  });

  it('the note counts as the member types and is capped at 500', () => {
    mount({ subjectType: 'feed_post', subjectId: SUBJECT });
    const note = noteField();
    expect(note.getAttribute('maxlength')).toBe('500');
    fireEvent.change(note, { target: { value: 'Anúncio repetido.' } });
    expect(screen.getByText('17/500')).toBeTruthy();
  });

  it('the happy path: one request without a note, Enviando… while pending, then the toast and the close', async () => {
    let finish: (value: unknown) => void = () => undefined;
    actions.reportContent.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const { onReportClose } = mount({ subjectType: 'post_comment', subjectId: SUBJECT });

    fireEvent.click(screen.getByRole('radio', { name: 'Spam ou propaganda' }));
    fireEvent.click(send());
    fireEvent.click(send());

    expect((screen.getByRole('button', { name: 'Enviando…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(radio('Spam ou propaganda').disabled).toBe(true);
    expect(noteField().disabled).toBe(true);

    await act(async () => finish({ ok: true, code: 'ok' }));

    expect(actions.reportContent).toHaveBeenCalledTimes(1);
    expect(actions.reportContent).toHaveBeenCalledWith({
      subjectType: 'post_comment',
      subjectId: SUBJECT,
      reason: 'spam',
    });
    expect(onReportClose).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Denúncia enviada. Obrigado por avisar.')).toBeTruthy();
  });

  it('a note written is sent trimmed', async () => {
    actions.reportContent.mockResolvedValueOnce({ ok: true, code: 'ok' });
    mount({ subjectType: 'feed_post', subjectId: SUBJECT });
    fireEvent.click(screen.getByRole('radio', { name: 'Assédio ou bullying' }));
    fireEvent.change(screen.getByLabelText('Quer dar mais detalhes? (opcional)'), {
      target: { value: '  Insultos repetidos.  ' },
    });
    await act(async () => fireEvent.click(send()));
    expect(actions.reportContent).toHaveBeenCalledWith({
      subjectType: 'feed_post',
      subjectId: SUBJECT,
      reason: 'harassment',
      note: 'Insultos repetidos.',
    });
  });

  it('already_reported closes with its own sentence, once', async () => {
    actions.reportContent.mockResolvedValueOnce({ ok: true, code: 'already_reported' });
    const { onReportClose } = mount({ subjectType: 'feed_post', subjectId: SUBJECT });
    fireEvent.click(screen.getByRole('radio', { name: 'Outro motivo' }));
    await act(async () => fireEvent.click(send()));
    expect(onReportClose).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByText('Você já denunciou isto.')).toHaveLength(1);
  });

  it('unavailable closes with the neutral sentence, which never says why', async () => {
    actions.reportContent.mockResolvedValueOnce({ ok: false, code: 'unavailable' });
    const { onReportClose } = mount({ subjectType: 'direct_message', subjectId: SUBJECT });
    fireEvent.click(screen.getByRole('radio', { name: 'Outro motivo' }));
    await act(async () => fireEvent.click(send()));
    expect(onReportClose).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Este conteúdo não está mais disponível.')).toBeTruthy();
  });

  it.each(['failed', 'rate_limited', 'unauthenticated'])(
    'a %s answer is the alert inside the sheet, with the choices kept for the next try',
    async (code) => {
      actions.reportContent.mockResolvedValueOnce({ ok: false, code });
      const { onReportClose } = mount({ subjectType: 'feed_post', subjectId: SUBJECT });
      fireEvent.click(screen.getByRole('radio', { name: 'Spam ou propaganda' }));
      fireEvent.change(screen.getByLabelText('Quer dar mais detalhes? (opcional)'), {
        target: { value: 'Anúncio repetido.' },
      });
      await act(async () => fireEvent.click(send()));

      expect(screen.getByRole('alert').textContent).toContain(
        'Não foi possível enviar agora. Nada foi alterado. Tente de novo.',
      );
      expect(onReportClose).not.toHaveBeenCalled();
      expect(radio('Spam ou propaganda').checked).toBe(true);
      expect(noteField().value).toBe('Anúncio repetido.');
      expect(send().disabled).toBe(false);
    },
  );

  it('a thrown action is the same alert, never an unhandled rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    actions.reportContent.mockRejectedValueOnce(new Error('boom'));
    mount({ subjectType: 'feed_post', subjectId: SUBJECT });
    fireEvent.click(screen.getByRole('radio', { name: 'Spam ou propaganda' }));
    await act(async () => fireEvent.click(send()));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('the sheet cannot be closed while the request runs', async () => {
    let finish: (value: unknown) => void = () => undefined;
    actions.reportContent.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const { onReportClose } = mount({ subjectType: 'feed_post', subjectId: SUBJECT });
    fireEvent.click(screen.getByRole('radio', { name: 'Spam ou propaganda' }));
    fireEvent.click(send());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onReportClose).not.toHaveBeenCalled();
    await act(async () => finish({ ok: false, code: 'failed' }));
  });

  it('no sentence of the sheet implies the other party is told', () => {
    mount({ subjectType: 'feed_post', subjectId: SUBJECT });
    expect(document.body.textContent ?? '').not.toMatch(/avisad|notific|saber[áa]/i);
  });
});

describe('the path of 11-20 Task 1: report a comment from its menu', () => {
  function Host() {
    const safety = useReportAndBlock({
      tenantName: 'Instituto Aurora',
      safety: { socialOn: false, reportAction: actions.reportContent },
    });
    const labels = safety.commentLabels({
      item: {
        removedAuthor: 'Membro removido',
        like: 'Curtir',
        unlike: 'Descurtir',
        likes: { one: '{count}', other: '{count}' },
        reply: 'Responder',
        delete: 'Excluir comentário',
      },
    } as Parameters<typeof safety.commentLabels>[0]);
    return (
      <>
        <CommentItem
          comment={{
            id: SUBJECT,
            body: 'Um comentário.',
            author: { displayName: 'Carla Nunes', profileHref: '/membros/m1', avatarUrl: null },
            authorRemoved: false,
            createdAtIso: '2026-11-19T10:00:00.000Z',
            createdAtRelative: 'há 1 h',
            createdAtAbsolute: '19/11/2026 10:00',
            likeCount: 0,
            viewerLiked: false,
            replyCount: 0,
            isReply: false,
            canDelete: false,
            removal: null,
            canReport: true,
          }}
          locale="pt-BR"
          labels={labels.item}
          onReport={safety.onReportComment}
        />
        {safety.element}
      </>
    );
  }

  it('Mais ações do comentário, Denunciar comentário, a reason, Enviar denúncia: one call, one toast', async () => {
    actions.reportContent.mockResolvedValueOnce({ ok: true, code: 'ok' });
    render(
      <ToastProvider>
        <Host />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do comentário' }));
    fireEvent.click(screen.getByRole('button', { name: 'Denunciar comentário' }));
    expect(screen.getByRole('heading', { name: 'Denunciar comentário' })).toBeTruthy();
    expect(send().disabled).toBe(true);

    fireEvent.click(radio('Spam ou propaganda'));
    await act(async () => fireEvent.click(send()));

    expect(actions.reportContent).toHaveBeenCalledTimes(1);
    expect(actions.reportContent).toHaveBeenCalledWith({
      subjectType: 'post_comment',
      subjectId: SUBJECT,
      reason: 'spam',
    });
    expect(await screen.findByText('Denúncia enviada. Obrigado por avisar.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Denunciar comentário' })).toBeNull();
  });
});
