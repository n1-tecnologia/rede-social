// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberMaterials } from './MemberMaterials';

/**
 * Quick 261016-aqc (08.5 review WR-02) — the member material download opens its tab INSIDE the tap,
 * the 08.3 WR-07 pattern of `LessonForm.tsx`: iOS Safari and the installed PWA drop a `window.open`
 * that runs after an await. Real pt-BR catalogs through next-intl's own `createTranslator`; stubbed:
 * the server action, the lesson session and the toast. The web workspace has no jest-dom: plain DOM
 * assertions only.
 */

const { toast, mint, session } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  mint: vi.fn(),
  session: {
    completed: false,
    markCompleted: vi.fn(),
    consumeFocusRequest: vi.fn(() => false),
    refuse: vi.fn(() => false),
    stopped: vi.fn(() => false),
  },
}));

vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('@/app/(app)/cursos/learn-actions', () => ({ learnMaterialUrlAction: mint }));

vi.mock('./LessonSession', () => ({ useLessonSession: () => session }));

const LESSON_ID = '11111111-1111-4111-8111-111111111111';
const MATERIAL_ID = '22222222-2222-4222-8222-222222222222';
const URL_MINTED = 'https://storage.local/x?token=abc';
const ERROR_TOAST = 'Não foi possível abrir o material. Tente novamente.';

function renderMaterials() {
  render(
    <MemberMaterials
      lessonId={LESSON_ID}
      countLabel="1 arquivo"
      materials={[
        {
          id: MATERIAL_ID,
          name: 'Apostila.pdf',
          meta: 'PDF · 10 KB',
          kind: 'pdf',
          downloadLabel: 'Baixar Apostila.pdf',
        },
      ]}
    />,
  );
  return screen.getByRole('button', { name: 'Baixar Apostila.pdf' });
}

function tabDouble() {
  return { opener: window as unknown, close: vi.fn(), location: { href: '' } };
}

beforeEach(() => {
  mint.mockReset();
  toast.show.mockReset();
  session.refuse.mockReset();
  session.refuse.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MemberMaterials download (WR-02)', () => {
  it('WR-02: the blank tab opens INSIDE the tap (before the action resolves), loses its opener at once and is navigated to the fresh URL', async () => {
    let resolveUrl: (value: unknown) => void = () => undefined;
    mint.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUrl = resolve;
        }),
    );
    const tab = tabDouble();
    const opened = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
    const button = renderMaterials();

    fireEvent.click(button);
    // Synchronously, in the gesture: a blank tab, already cut off from this one.
    expect(opened).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(mint).toHaveBeenCalledWith(LESSON_ID, MATERIAL_ID);
    // While the call runs, the button is disabled and busy.
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveUrl({ ok: true, url: URL_MINTED, expiresAt: '' });
    });
    await waitFor(() => expect(tab.location.href).toBe(URL_MINTED));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(tab.close).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it('WR-02: a lock refusal closes the blank tab and hands the code to the session, which handles it (no toast)', async () => {
    mint.mockResolvedValue({ ok: false, code: 'lesson_locked' });
    session.refuse.mockReturnValue(true);
    const tab = tabDouble();
    vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);

    fireEvent.click(renderMaterials());
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(session.refuse).toHaveBeenCalledWith('lesson_locked');
    expect(tab.location.href).toBe('');
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('WR-02: a refusal the session does not handle closes the blank tab and toasts the material error', async () => {
    mint.mockResolvedValue({ ok: false, code: 'generic' });
    session.refuse.mockReturnValue(false);
    const tab = tabDouble();
    vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);

    fireEvent.click(renderMaterials());
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(session.refuse).toHaveBeenCalledWith('generic');
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: ERROR_TOAST }),
    );
  });

  it('WR-02: a thrown action closes the blank tab and toasts the material error', async () => {
    mint.mockRejectedValue(new Error('network'));
    const tab = tabDouble();
    vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);

    fireEvent.click(renderMaterials());
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: ERROR_TOAST }),
    );
    expect(session.refuse).not.toHaveBeenCalled();
  });

  it('WR-02: a blocked blank tab (null) falls back to the noopener open once the URL arrives', async () => {
    mint.mockResolvedValue({ ok: true, url: URL_MINTED, expiresAt: '' });
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);

    fireEvent.click(renderMaterials());
    expect(opened).toHaveBeenNthCalledWith(1, '', '_blank');
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
    expect(opened).toHaveBeenNthCalledWith(2, URL_MINTED, '_blank', 'noopener,noreferrer');
    expect(toast.show).not.toHaveBeenCalled();
  });
});
