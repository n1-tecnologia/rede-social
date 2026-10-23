// @vitest-environment happy-dom
import {
  BOOTSTRAP_STEP_KEYS,
  type BootstrapReasonCode,
  type BootstrapStepKey,
  type BootstrapStepStatus,
} from '@rede-social/contracts/projects';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapStepView } from './BootstrapSteps';

/**
 * 09.2-19 Task 2 (UI-D-537, UI-D-544, UI-D-545, E05, P100, P101) - the Preparação card. Real: the
 * component and the REAL pt-BR catalog through next-intl's translator (a missing key throws). Fake
 * timers drive the 3 s refresh; the router, the probe and the resume are spies.
 *
 * Claims: the eight steps in the fixed order whatever the API's order; one glyph, one label and one
 * hidden status word per state; the catalog reason and 'Código …' under a failed step; 'Tentar de
 * novo' only after a failure, one resume per click, a 409 swallowed; the refresh every 3 s only while
 * the run is in progress and never blanking the list; the collapsed done state with a closed
 * `<details>`; wrapping classes that keep 320px from scrolling.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

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

const toast = { show: vi.fn(), dismiss: vi.fn() };
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { BootstrapSteps, POLL_INTERVAL_MS } = await import('./BootstrapSteps');

const TENANT = '33333333-3333-4333-8333-333333333312';
const LABELS: Record<BootstrapStepKey, string> = {
  verify: 'Verificar o projeto',
  roles: 'Criar os papéis de acesso',
  schema: 'Aplicar o esquema do banco',
  auth: 'Configurar a autenticação',
  buckets: 'Criar os buckets de arquivos',
  realtime: 'Criar as políticas do Realtime',
  tenant: 'Criar o tenant e os módulos',
  invite: 'Agendar o convite do primeiro administrador',
};

function steps(
  statuses: Partial<Record<BootstrapStepKey, BootstrapStepStatus>> | BootstrapStepStatus,
  reasons: Partial<Record<BootstrapStepKey, BootstrapReasonCode>> = {},
): BootstrapStepView[] {
  return BOOTSTRAP_STEP_KEYS.map((step) => ({
    step,
    status: typeof statuses === 'string' ? statuses : (statuses[step] ?? 'pending'),
    reasonCode: reasons[step] ?? null,
  }));
}

const resumeAction = vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>();
const pollAction = vi.fn<(id: string) => Promise<boolean>>();

function ui(rows: BootstrapStepView[], finishedAtText: string | null = '12 de outubro de 2026') {
  return (
    <BootstrapSteps
      tenantId={TENANT}
      steps={rows}
      finishedAtText={finishedAtText}
      resumeAction={resumeAction as never}
      pollAction={pollAction}
    />
  );
}
const mount = (rows: BootstrapStepView[], finishedAtText?: string | null) =>
  render(ui(rows, finishedAtText));

const items = () => screen.getAllByRole('listitem');
const labelsOf = () => items().map((li) => li.querySelector('span')?.firstChild?.textContent);

beforeEach(() => {
  router.refresh.mockReset();
  resumeAction.mockReset();
  resumeAction.mockResolvedValue({ ok: true });
  pollAction.mockReset();
  pollAction.mockResolvedValue(true);
  toast.show.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const RUNNING_MID = steps({ verify: 'done', roles: 'done', schema: 'running' });
const FAILED_AT_SCHEMA = steps(
  { verify: 'done', roles: 'done', schema: 'failed' },
  { schema: 'migration_failed' },
);

describe('BootstrapSteps', () => {
  it('names the list "Etapas da preparação" and the card "Preparação"', () => {
    mount(RUNNING_MID);
    expect(screen.getByRole('list', { name: 'Etapas da preparação' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Preparação' })).toBeTruthy();
  });

  it('renders the eight steps in the FIXED order whatever order the API lists them (P101)', () => {
    const shuffled = [...steps({ verify: 'done', roles: 'done' })].reverse();
    mount([
      shuffled[3],
      shuffled[7],
      shuffled[0],
      shuffled[5],
      shuffled[1],
      shuffled[6],
      shuffled[2],
      shuffled[4],
    ] as BootstrapStepView[]);
    expect(labelsOf()).toEqual(BOOTSTRAP_STEP_KEYS.map((key) => LABELS[key]));
  });

  it('reads a step the API does not list as waiting', () => {
    mount(steps({ verify: 'done' }).slice(0, 3));
    expect(items()).toHaveLength(8);
    expect(items()[7]?.getAttribute('data-state')).toBe('pending');
  });

  it('shows eight waiting rows when none has passed, with the "Preparando…" note and no button', () => {
    mount(steps('pending'));
    expect(items().map((li) => li.getAttribute('data-state'))).toEqual(Array(8).fill('pending'));
    expect(screen.getByText('Preparando… esta página se atualiza sozinha.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows passed, running and waiting rows together, each with its glyph and hidden status word (E05 populated)', () => {
    mount(RUNNING_MID);
    const [verify, , schema, auth] = items();
    expect(verify?.querySelector('svg')?.getAttribute('class')).toContain('lucide-circle-check');
    expect(verify?.querySelector('svg')?.getAttribute('class')).toContain('text-brand');
    expect(verify?.querySelector('.sr-only')?.textContent?.trim()).toBe('concluída');
    expect(schema?.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
    expect(schema?.querySelector('svg')?.getAttribute('class')).toContain('text-text-secondary');
    expect(schema?.querySelector('.sr-only')?.textContent?.trim()).toBe('em andamento');
    expect(auth?.querySelector('svg')?.getAttribute('class')).toContain('lucide-circle ');
    expect(auth?.querySelector('svg')?.getAttribute('class')).toContain('text-text-tertiary');
    expect(auth?.querySelector('.sr-only')?.textContent?.trim()).toBe('aguardando');
    for (const li of items()) {
      expect(li.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('shows a failed step with XCircle, the catalog reason and the code, and nothing else', () => {
    mount(FAILED_AT_SCHEMA);
    const failed = items()[2] as HTMLElement;
    expect(failed.querySelector('svg')?.getAttribute('class')).toContain('text-danger');
    expect(failed.querySelector('.sr-only')?.textContent?.trim()).toBe('falhou');
    const reason = screen.getByText('Uma migração do esquema falhou.');
    expect(reason.className).toContain('text-xs');
    expect(reason.className).toContain('text-danger');
    const code = screen.getByText('Código migration_failed');
    expect(code.className).toContain('text-text-tertiary');
    expect(screen.queryAllByText(/^Código /)).toHaveLength(1);
  });

  it.each([
    ['unreachable', 'Não foi possível falar com o projeto.'],
    ['access_denied', 'O Supabase recusou o acesso. Confira a senha e as chaves.'],
    ['storage_failed', 'A criação dos buckets falhou.'],
  ] as const)('maps the reason code %s to its catalog sentence', (code, sentence) => {
    mount(steps({ verify: 'failed' }, { verify: code }));
    expect(screen.getByText(sentence)).toBeTruthy();
  });

  it('falls back to the unknown sentence, and shows no code line, for a failure without a code', () => {
    mount(steps({ verify: 'failed' }));
    expect(screen.getByText('Algo deu errado nesta etapa.')).toBeTruthy();
    expect(screen.queryByText(/^Código /)).toBeNull();
  });

  it('shows "Tentar de novo" and its note only after a failure, never while a step runs', () => {
    mount(RUNNING_MID);
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    cleanup();
    mount(FAILED_AT_SCHEMA);
    const button = screen.getByRole('button', { name: 'Tentar de novo' });
    expect(button.className).toContain('bg-button');
    expect(
      screen.getByText(
        'Continua a partir da etapa que falhou. As etapas concluídas não são refeitas.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Preparando… esta página se atualiza sozinha.')).toBeNull();
  });

  it('sends ONE resume for two quick clicks, shows "Tentando…" and aria-busy meanwhile (P100)', async () => {
    let release: (value: { ok: boolean }) => void = () => {};
    resumeAction.mockReturnValue(new Promise((resolve) => (release = resolve)));
    mount(FAILED_AT_SCHEMA);
    const button = screen.getByRole('button', { name: 'Tentar de novo' });
    fireEvent.click(button);
    fireEvent.click(button);
    const busy = await screen.findByRole('button', { name: 'Tentando…' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(busy);
    expect(resumeAction).toHaveBeenCalledTimes(1);
    expect(resumeAction).toHaveBeenCalledWith(TENANT);
    await act(async () => {
      release({ ok: true });
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  });

  it('keeps the button disabled when a poll refresh re-renders the card during the click (P100)', async () => {
    let release: (value: { ok: boolean }) => void = () => {};
    resumeAction.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const view = mount(FAILED_AT_SCHEMA);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await screen.findByRole('button', { name: 'Tentando…' });
    view.rerender(
      ui(
        steps({ verify: 'done', roles: 'done', schema: 'failed' }, { schema: 'migration_failed' }),
      ),
    );
    const still = screen.getByRole('button', { name: 'Tentando…' }) as HTMLButtonElement;
    expect(still.disabled).toBe(true);
    await act(async () => {
      release({ ok: true });
    });
  });

  it('swallows the 409 of a second resume: no toast, the list refreshes', async () => {
    resumeAction.mockResolvedValue({ ok: false, error: 'conflict' });
    mount(FAILED_AT_SCHEMA);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('toasts the generic error when the resume fails for another reason, and re-enables the button', async () => {
    resumeAction.mockResolvedValue({ ok: false, error: 'generic' });
    mount(FAILED_AT_SCHEMA);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Algo deu errado. Tente novamente.',
      }),
    );
    const again = (await screen.findByRole('button', {
      name: 'Tentar de novo',
    })) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
  });

  it('refreshes every 3 s while a step runs, asking the probe first', async () => {
    vi.useFakeTimers();
    mount(RUNNING_MID);
    expect(POLL_INTERVAL_MS).toBe(3000);
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(pollAction).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(pollAction).toHaveBeenCalledWith(TENANT);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(3);
  });

  it('keeps polling through the gap between two steps (nothing running, nothing failed)', async () => {
    vi.useFakeTimers();
    mount(steps({ verify: 'done', roles: 'done' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('stops refreshing the moment the run ends, or fails', async () => {
    vi.useFakeTimers();
    const view = mount(RUNNING_MID);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    view.rerender(ui(steps('done')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    view.rerender(ui(RUNNING_MID));
    view.rerender(ui(FAILED_AT_SCHEMA));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('never polls for a failed or finished run', async () => {
    vi.useFakeTimers();
    mount(FAILED_AT_SCHEMA);
    cleanup();
    mount(steps('done'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(pollAction).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('keeps the last state, and tries again at the next tick, when the probe says no or throws (E05 loading)', async () => {
    vi.useFakeTimers();
    mount(RUNNING_MID);
    const before = screen.getByRole('list').innerHTML;
    pollAction.mockResolvedValueOnce(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
    pollAction.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('list').innerHTML).toBe(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('survives a router.refresh that throws, with the list unchanged', async () => {
    vi.useFakeTimers();
    router.refresh.mockImplementationOnce(() => {
      throw new Error('refresh failed');
    });
    mount(RUNNING_MID);
    const before = screen.getByRole('list').innerHTML;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole('list').innerHTML).toBe(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it('stops its timer when the card unmounts', async () => {
    vi.useFakeTimers();
    const view = mount(RUNNING_MID);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(pollAction).not.toHaveBeenCalled();
  });

  it('collapses a finished run to one row and a closed "Ver etapas" with the same list inside', () => {
    const { container } = mount(steps('done'));
    expect(screen.getByText('Preparação concluída em 12 de outubro de 2026.')).toBeTruthy();
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const summary = details.querySelector('summary') as HTMLElement;
    expect(summary.textContent).toBe('Ver etapas');
    expect(summary.className).toContain('min-h-11');
    expect(summary.className).toContain('text-brand');
    expect(details.querySelectorAll('li')).toHaveLength(8);
    for (const li of Array.from(details.querySelectorAll('li'))) {
      expect(li.querySelector('svg')?.getAttribute('class')).toContain('lucide-circle-check');
    }
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Preparando… esta página se atualiza sozinha.')).toBeNull();
  });

  it('keeps the full list, with no invented date, when a finished run has no recorded end', () => {
    const { container } = mount(steps('done'), null);
    expect(container.querySelector('details')).toBeNull();
    expect(items()).toHaveLength(8);
    expect(container.textContent).not.toContain('Preparação concluída em');
  });

  it('wraps long labels and reasons under their glyph so 320px never scrolls sideways (E05 overflow, long-text)', () => {
    mount(steps({ invite: 'failed' }, { invite: 'invite_failed' }));
    const invite = items()[7] as HTMLElement;
    const label = invite.querySelector('span') as HTMLElement;
    expect(label.textContent).toContain('Agendar o convite do primeiro administrador');
    expect(label.className).toContain('break-words');
    expect((label.parentElement as HTMLElement).className).toContain('min-w-0');
    expect(screen.getByText('O agendamento do convite falhou.').className).toContain('break-words');
    expect(screen.getByText('Código invite_failed').className).toContain('break-words');
    expect(invite.className).toContain('items-start');
    const list = screen.getByRole('list');
    expect(list.className).toContain('flex-col');
    expect(list.className).toContain('gap-3');
  });

  it('moves focus to the card heading when the run moves on after a resume (UI-D-545)', async () => {
    const view = mount(FAILED_AT_SCHEMA);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    view.rerender(ui(RUNNING_MID));
    const heading = screen.getByRole('heading', { name: 'Preparação' });
    expect(heading.getAttribute('tabindex')).toBe('-1');
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('puts focus back on the button when the resume settles and the step is still failed', async () => {
    mount(FAILED_AT_SCHEMA);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const button = await screen.findByRole('button', { name: 'Tentar de novo' });
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});
