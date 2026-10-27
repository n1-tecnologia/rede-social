// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseOverview } from '@rede-social/contracts/projects';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.2-19 Task 1 (UI-D-536, UI-D-539, UI-D-545, UI-D-548, E04) - the overview card of the Banco tab.
 * Real: the card, the pill and the REAL pt-BR catalog through next-intl's translator (a missing key
 * throws). The action is a spy; the toast is the shipped hook's seam.
 *
 * Claims: each state's notice text, tone and role; the Supabase link built only from a ref of twenty
 * lower-case letters; Compartilhado singular, plural and hidden; the plan as a closed set of words;
 * 'Ainda não verificado.'; the `dl` and ref classes that keep 320px from scrolling; no credential-
 * shaped string in the markup; 'Verificar agora' disabled while preparing and `aria-busy` while it
 * runs; no HTML injection from an untrusted string.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join: joinPath } = await import('node:path');
  return { messages: loadMessages(joinPath(process.cwd(), 'messages', 'pt-BR')) };
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

const toast = { show: vi.fn(), dismiss: vi.fn() };
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { DatabaseOverviewCard } = await import('./DatabaseOverviewCard');

const TENANT = '33333333-3333-4333-8333-333333333312';
const REF = 'abcdefghijklmnopqrst';

const STEPS_DONE: DatabaseOverview['steps'] = [
  'verify',
  'roles',
  'schema',
  'auth',
  'buckets',
  'realtime',
  'tenant',
  'invite',
].map((step) => ({
  step: step as DatabaseOverview['steps'][number]['step'],
  status: 'done' as const,
  attempt: 1,
  reasonCode: null,
  startedAt: null,
  finishedAt: null,
}));

function overview(patch: Partial<DatabaseOverview> = {}): DatabaseOverview {
  return {
    ref: REF,
    plan: 'pro',
    state: 'ready',
    steps: STEPS_DONE,
    schema: { applied: 147, required: 147 },
    lastCheckedAt: '2026-10-23T10:00:00.000Z',
    preparationFinishedAt: '2026-10-12T10:00:00.000Z',
    credentials: { held: true, updatedAt: null },
    otherTenants: 0,
    moving: false,
    lastErrorCode: null,
    ...patch,
  };
}

const verifyAction = vi.fn<(tenantId: string) => Promise<{ ok: boolean }>>();

function mount(patch: Partial<DatabaseOverview> = {}, verifiedWhen: string | null = 'há 3 min') {
  return render(
    <DatabaseOverviewCard
      tenantId={TENANT}
      overview={overview(patch)}
      verifiedWhen={verifiedWhen}
      verifyAction={verifyAction as never}
    />,
  );
}

const NOTICES = {
  behind:
    'O esquema deste tenant está atrás da versão exigida. Os membros veem “Comunidade em atualização” até a migração passar. O sistema tenta de novo sozinho.',
  paused:
    'O projeto está pausado no Supabase. Os membros veem “Comunidade indisponível” até você reativá-lo.',
  unreachable:
    'Não conseguimos falar com o projeto. Os membros veem “Comunidade indisponível” até a conexão voltar.',
  preparation_failed: 'A preparação parou numa etapa. Veja a lista abaixo e tente de novo.',
  moving:
    'Este tenant está sendo movido para um projeto próprio. Ele volta a funcionar quando a mudança terminar.',
} as const;

beforeEach(() => {
  verifyAction.mockReset();
  verifyAction.mockResolvedValue({ ok: true });
  toast.show.mockReset();
});
afterEach(cleanup);

describe('DatabaseOverviewCard', () => {
  it('shows the section title, the health pill and when it was last checked', () => {
    mount({ state: 'behind', schema: { applied: 144, required: 147 } });
    expect(screen.getByRole('heading', { name: 'Banco de dados' })).toBeTruthy();
    expect(screen.getByTestId('database-pill').textContent).toBe('Atrasado');
    expect(screen.getByText('Verificado há 3 min.')).toBeTruthy();
  });

  it('says "Ainda não verificado." when no check has run yet', () => {
    mount({ state: 'unchecked', lastCheckedAt: null }, null);
    expect(screen.getByText('Ainda não verificado.')).toBeTruthy();
    expect(screen.queryByText(/^Verificado /)).toBeNull();
  });

  it.each(Object.entries(NOTICES))('%s: the notice carries the exact sentence', (state, text) => {
    const { container } = mount({ state: state as DatabaseOverview['state'] });
    expect(screen.getByText(text)).toBeTruthy();
    expect(container.querySelectorAll('[data-notice]')).toHaveLength(1);
  });

  it('gives the two danger states role="alert" with the bordered row and TriangleAlert', () => {
    for (const state of ['unreachable', 'preparation_failed'] as const) {
      const { container } = mount({ state });
      const row = container.querySelector('[data-notice]') as HTMLElement;
      expect(row.getAttribute('role')).toBe('alert');
      expect(row.className).toContain('border-danger/40');
      expect(row.className).toContain('bg-danger/5');
      expect(row.querySelector('svg')?.getAttribute('class')).toContain('lucide-triangle-alert');
      cleanup();
    }
  });

  it('gives the two warning states the amber row with CircleAlert and no alert role', () => {
    for (const state of ['behind', 'paused'] as const) {
      const { container } = mount({ state });
      const row = container.querySelector('[data-notice]') as HTMLElement;
      expect(row.hasAttribute('role')).toBe(false);
      expect(row.className).toContain('bg-warning/10');
      expect(row.querySelector('svg')?.getAttribute('class')).toContain('lucide-circle-alert');
      cleanup();
    }
  });

  it('gives "Em mudança" the neutral info row (sketch finding F-2)', () => {
    const { container } = mount({ state: 'moving' });
    const row = container.querySelector('[data-notice]') as HTMLElement;
    expect(row.hasAttribute('role')).toBe(false);
    expect(row.className).toContain('bg-bg-tertiary');
  });

  it('has no notice row for Pronto, Em preparação and Não verificado', () => {
    for (const state of ['ready', 'preparing', 'unchecked'] as const) {
      const { container } = mount({ state });
      expect(container.querySelector('[data-notice]')).toBeNull();
      cleanup();
    }
  });

  it('adds "Código {code}" in the notice when the server sends one, and only then', () => {
    mount({ state: 'preparation_failed', lastErrorCode: 'migration_failed' });
    const code = screen.getByText('Código migration_failed');
    expect(code.className).toContain('text-xs');
    expect(code.className).toContain('text-text-tertiary');
    cleanup();
    mount({ state: 'preparation_failed', lastErrorCode: null });
    expect(screen.queryByText(/^Código /)).toBeNull();
  });

  it('builds the Supabase link only from a ref of twenty lower-case letters, in a new tab', () => {
    mount();
    const link = screen.getByRole('link', { name: /Abrir no Supabase/ }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`https://supabase.com/dashboard/project/${REF}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('Abrir no Supabase (abre em uma nova aba)');
    expect(link.querySelector('.sr-only')?.textContent).toBe(' (abre em uma nova aba)');
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([
    'abc',
    'ABCDEFGHIJKLMNOPQRST',
    'abcdefghijklmnopqrs1',
    'abcdefghijklmnopqrstu',
    '../../etc/passwd/aaaa',
    'abcdefghij"onmouseover',
  ])('renders a malformed ref (%s) as text without a link', (ref) => {
    const { container } = mount({ ref });
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('dd span')?.textContent).toBe(ref);
  });

  it('shows Compartilhado only when other tenants share the project, with the ICU plural', () => {
    mount({ otherTenants: 0 });
    expect(screen.queryByText('Compartilhado')).toBeNull();
    cleanup();
    mount({ otherTenants: 1 });
    expect(screen.getByText('Compartilhado')).toBeTruthy();
    expect(
      screen.getByText(
        'Este projeto também atende outro tenant. Isso só é permitido fora de produção.',
      ),
    ).toBeTruthy();
    cleanup();
    mount({ otherTenants: 3 });
    expect(
      screen.getByText(
        'Este projeto também atende 3 outros tenants. Isso só é permitido fora de produção.',
      ),
    ).toBeTruthy();
  });

  it.each([
    ['pro', 'Pro'],
    ['PRO', 'Pro'],
    ['free', 'Free'],
    [null, 'Não informado'],
    ['enterprise <b>x</b>', 'Não informado'],
  ])('shows the plan %s as "%s" (information only, never provider text)', (plan, text) => {
    const { container } = mount({ plan });
    const dds = Array.from(container.querySelectorAll('dd'));
    expect(dds.some((dd) => dd.textContent === text)).toBe(true);
    expect(container.innerHTML).not.toContain('<b>');
    expect(container.textContent).not.toContain('enterprise');
  });

  it.each([
    [{ applied: 147, required: 147 }, 'ready', '147'],
    [{ applied: 144, required: 147 }, 'behind', '144 de 147'],
    [{ applied: 98, required: 147 }, 'preparation_failed', '98 de 147'],
    [{ applied: null, required: 147 }, 'preparing', '0 de 147'],
    [{ applied: null, required: null }, 'unchecked', 'Não informado'],
  ] as const)('shows the schema %j in state %s as "%s"', (schema, state, text) => {
    const { container } = mount({ schema: { ...schema }, state });
    const dts = Array.from(container.querySelectorAll('dt'));
    const index = dts.findIndex((dt) => dt.textContent === 'Esquema');
    expect(container.querySelectorAll('dd')[index]?.textContent).toBe(text);
  });

  it('keeps 320px from scrolling sideways: minmax(0, …) columns, a break-all tabular-nums ref', () => {
    const { container } = mount();
    const dl = container.querySelector('dl') as HTMLElement;
    expect(dl.className).toContain('grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)]');
    expect(dl.className).toContain('gap-x-3');
    expect(dl.className).toContain('gap-y-2');
    expect(dl.className).toContain('text-sm');
    const ref = screen.getByText(REF);
    expect(ref.className).toContain('break-all');
    expect(ref.className).toContain('tabular-nums');
    const notice = mount({ state: 'behind' }).container.querySelector('[data-notice] p');
    expect(notice?.className).toContain('break-words');
  });

  it('renders no credential-shaped string, pooler URL or provider text', () => {
    const { container } = mount({ state: 'unreachable', lastErrorCode: 'access_denied' });
    const html = container.innerHTML;
    expect(html).not.toMatch(/postgres(ql)?:\/\//);
    expect(html).not.toMatch(/sb_secret_|sb_publishable_|eyJ[A-Za-z0-9_-]{10,}/);
    expect(html).not.toMatch(/pooler|\.supabase\.co/);
  });

  it('never uses dangerouslySetInnerHTML in any file of the tab (T-09.2-91)', () => {
    const files = [
      'DatabaseOverviewCard.tsx',
      'DatabasePill.tsx',
      'VerifyDatabaseButton.tsx',
      '../../app/(platform)/plataforma/tenants/[id]/banco/page.tsx',
      '../../app/(platform)/plataforma/tenants/[id]/banco/error.tsx',
      '../../app/(platform)/plataforma/tenants/[id]/banco/loading.tsx',
    ];
    for (const file of files) {
      expect(readFileSync(join(__dirname, file), 'utf8')).not.toContain('dangerouslySetInnerHTML');
    }
  });

  it('shows "Verificar agora" as the outline sm button with the RefreshCw glyph, aria-hidden', () => {
    mount();
    const button = screen.getByRole('button', { name: 'Verificar agora' });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.className).toContain('border-border-secondary');
    expect(button.className).toContain('h-9');
  });

  it('has no "Atualizar agora" and no migrate button (D-544: that is the command)', () => {
    const { container } = mount({ state: 'behind' });
    expect(container.textContent).not.toMatch(/Atualizar agora|Migrar/);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('disables "Verificar agora" while preparing, after a failure, and while a step runs', () => {
    for (const patch of [
      { state: 'preparing' as const },
      { state: 'preparation_failed' as const },
      {
        state: 'ready' as const,
        steps: [{ ...STEPS_DONE[0], status: 'running' as const }] as DatabaseOverview['steps'],
      },
    ]) {
      mount(patch);
      expect(
        (screen.getByRole('button', { name: 'Verificar agora' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      cleanup();
    }
  });

  it('shows aria-busy and "Verificando…" while the check runs, then toasts "Verificação concluída."', async () => {
    let release: (value: { ok: boolean }) => void = () => {};
    verifyAction.mockReturnValue(new Promise((resolve) => (release = resolve)));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Verificar agora' }));
    const busy = await screen.findByRole('button', { name: 'Verificando…' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(verifyAction).toHaveBeenCalledTimes(1);
    expect(verifyAction).toHaveBeenCalledWith(TENANT);
    release({ ok: true });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'success',
        message: 'Verificação concluída.',
      }),
    );
    expect(screen.getByRole('button', { name: 'Verificar agora' })).toBeTruthy();
  });

  it('toasts "Não foi possível verificar agora. Tente novamente." when the check fails or throws', async () => {
    verifyAction.mockResolvedValueOnce({ ok: false });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Verificar agora' }));
    await waitFor(() =>
      expect(toast.show).toHaveBeenLastCalledWith({
        tone: 'error',
        message: 'Não foi possível verificar agora. Tente novamente.',
      }),
    );
    verifyAction.mockRejectedValueOnce(new Error('boom'));
    await screen.findByRole('button', { name: 'Verificar agora' });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar agora' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledTimes(2));
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'error',
      message: 'Não foi possível verificar agora. Tente novamente.',
    });
  });
});

/**
 * 09.4-16 Task 1 (UI-D-552, UI-D-558, CTK-14, CTK-34, CTK-40, E05) - who owns the project. A customer
 * project reads Projeto · Dono · Organização · Esquema · Plano · Compartilhado; a platform project (or an
 * answer from an API that predates the fields) gets only the "Dono: Plataforma" row. The customer-Free
 * notice exists but fires only when the plan reads Free for a customer project.
 */
describe('DatabaseOverviewCard - owner and organisation (09.4-16)', () => {
  const labels = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('dt')).map((dt) => dt.textContent);
  const valueOf = (container: HTMLElement, label: string) => {
    const index = labels(container).indexOf(label);
    return container.querySelectorAll('dd')[index];
  };

  it('lists Projeto, Dono, Organização, Esquema, Plano for a customer project, with the slug breaking', () => {
    const { container } = mount({ owner: 'customer', organization: 'acme-corp' });
    expect(labels(container)).toEqual(['Projeto', 'Dono', 'Organização', 'Esquema', 'Plano']);
    expect(valueOf(container, 'Dono')?.textContent).toBe('Cliente');
    const organization = valueOf(container, 'Organização') as HTMLElement;
    expect(organization.textContent).toBe('acme-corp');
    expect(organization.className).toContain('break-all');
    expect(organization.className).toContain('min-w-0');
  });

  it('keeps a long organisation slug inside the minmax(0,1fr) column (E05 overflow, long-text)', () => {
    const slug = 'a-very-long-organisation-slug-that-would-push-a-320px-card-sideways-0123456789';
    const { container } = mount({ owner: 'customer', organization: slug });
    expect(valueOf(container, 'Organização')?.textContent).toBe(slug);
    const dl = container.querySelector('dl') as HTMLElement;
    expect(dl.className).toContain('grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)]');
  });

  it('lists Projeto, Dono, Esquema, Plano for a platform project: one new row and no Organização', () => {
    const { container } = mount({ owner: 'platform', organization: null });
    expect(labels(container)).toEqual(['Projeto', 'Dono', 'Esquema', 'Plano']);
    expect(valueOf(container, 'Dono')?.textContent).toBe('Plataforma');
  });

  it('renders an answer without the new fields (an older API) as a platform project', () => {
    const { container } = mount();
    expect(labels(container)).toEqual(['Projeto', 'Dono', 'Esquema', 'Plano']);
    expect(valueOf(container, 'Dono')?.textContent).toBe('Plataforma');
    expect(screen.queryByText('Organização')).toBeNull();
  });

  it('keeps Compartilhado after Plano for a customer project', () => {
    const { container } = mount({ owner: 'customer', organization: 'acme', otherTenants: 2 });
    expect(labels(container)).toEqual([
      'Projeto',
      'Dono',
      'Organização',
      'Esquema',
      'Plano',
      'Compartilhado',
    ]);
  });

  it('reads Plano as "Não informado" for a customer project the locked permissions cannot read', () => {
    const { container } = mount({ owner: 'customer', organization: 'acme', plan: null });
    expect(valueOf(container, 'Plano')?.textContent).toBe('Não informado');
    expect(container.querySelector('[data-notice="planNotPro"]')).toBeNull();
  });

  it.each(['free', 'Free', 'FREE'])(
    'warns "O plano deste projeto não é Pro." for a customer project on %s, and nothing blocks',
    (plan) => {
      const { container } = mount({ owner: 'customer', organization: 'acme', plan });
      const notice = container.querySelector('[data-notice="planNotPro"]') as HTMLElement;
      expect(notice.textContent).toBe(
        'O plano deste projeto não é Pro. O projeto do cliente deve estar no plano Pro.',
      );
      expect(notice.hasAttribute('role')).toBe(false);
      expect(notice.className).toContain('bg-warning/10');
      expect(notice.querySelector('svg')?.getAttribute('class')).toContain('lucide-circle-alert');
      expect(
        (screen.getByRole('button', { name: 'Verificar agora' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    },
  );

  it.each([
    ['customer', 'pro'],
    ['customer', null],
    ['platform', 'free'],
    ['platform', 'pro'],
  ] as const)('never shows the customer-Free notice for owner %s on plan %s', (owner, plan) => {
    const { container } = mount({ owner, organization: owner === 'customer' ? 'acme' : null, plan });
    expect(container.querySelector('[data-notice="planNotPro"]')).toBeNull();
  });
});
