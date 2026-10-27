// @vitest-environment happy-dom

import type { DatabaseOverview, TokenState } from '@rede-social/contracts/projects';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.4-16 Task 1 (UI-D-551, UI-D-552, UI-D-554, UI-D-558, UI-D-561, CTK-34, CTK-36, CTK-40; E06) - the
 * "Token de acesso" card of the Banco tab and the page that places it. Real: the card, the pill, the
 * how-to, the overview card and the REAL pt-BR catalog through next-intl's translator (a missing key
 * throws). Stubbed: the page's reads and its actions.
 *
 * Claims: the seven states each show their pill, expiry line and notice (two have none, one is a warning,
 * four are alerts that say the community keeps running or what to do); the days left come from the `today`
 * the server passes; "Verificado {when}." / "Ainda não verificado."; the card is state-only (no input, no
 * `sbp_`, no digit run that could be a length) and its how-to is a closed `<details>`; the page renders the
 * card only for a customer project, between Preparação and Credenciais.
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

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const platform = vi.hoisted(() => ({ detail: vi.fn(), database: vi.fn() }));
vi.mock('@/lib/platform', async () => {
  const actual = await vi.importActual<typeof import('@/lib/platform')>('@/lib/platform');
  return {
    ...actual,
    requirePlatformTenantDetail: platform.detail,
    requirePlatformTenantDatabase: platform.database,
  };
});

const actions = vi.hoisted(() => ({
  pollDatabaseAction: vi.fn(),
  replaceCredentialsAction: vi.fn(),
  replaceTokenAction: vi.fn(),
  resumeBootstrapAction: vi.fn(),
  verifyDatabaseAction: vi.fn(),
}));
vi.mock('@/app/(platform)/plataforma/tenants/[id]/banco/actions', () => actions);

const { TokenCard } = await import('./TokenCard');
const { default: TenantDatabasePage } = await import(
  '@/app/(platform)/plataforma/tenants/[id]/banco/page'
);

const TENANT = '33333333-3333-4333-8333-333333333312';
const TODAY = '2026-10-27';

function card(
  state: TokenState,
  over: { expiresAt?: string | null; checkedAt?: string | null; verifiedWhen?: string | null } = {},
) {
  return render(
    <TokenCard
      tenantId={TENANT}
      token={{
        state,
        expiresAt: over.expiresAt === undefined ? null : over.expiresAt,
        checkedAt: over.checkedAt === undefined ? '2026-10-27T10:00:00.000Z' : over.checkedAt,
      }}
      today={TODAY}
      verifiedWhen={over.verifiedWhen === undefined ? 'há 3 min' : over.verifiedWhen}
    />,
  );
}

beforeEach(() => {
  router.refresh.mockReset();
  toast.show.mockReset();
});
afterEach(cleanup);

const NOTICES: Record<TokenState, string | null> = {
  valid: null,
  unchecked: null,
  expiring:
    'O token vence em breve. Crie outro no Supabase e use Substituir token antes da data. Sem ele, o sistema deixa de conferir o projeto e de atualizar os endereços de login. A comunidade continua no ar.',
  expired:
    'O token venceu. A comunidade continua no ar, mas o sistema não consegue conferir nem atualizar o projeto. Crie outro token e substitua.',
  invalid:
    'O Supabase não aceita mais este token. Ele foi apagado ou revogado, ou quem o criou perdeu o acesso à conta do cliente. Crie outro e substitua. A comunidade continua no ar.',
  no_permission:
    'Este token não tem as permissões que o sistema precisa. Crie outro seguindo os passos abaixo e substitua.',
  org_mismatch:
    'O projeto agora está em outra organização do Supabase, diferente da registrada. Por segurança, o sistema parou de usá-lo. Confira se o projeto foi transferido.',
};

const WORDS: Record<TokenState, string> = {
  valid: 'Válido',
  expiring: 'Vencendo',
  expired: 'Vencido',
  invalid: 'Inválido',
  no_permission: 'Sem permissão',
  org_mismatch: 'Organização diferente',
  unchecked: 'Não verificado',
};

describe('TokenCard', () => {
  it('is a card titled "Token de acesso" with the key glyph and the plain body', () => {
    const { container } = card('valid');
    expect(screen.getByRole('heading', { name: 'Token de acesso' })).toBeTruthy();
    expect(
      screen.getByText(
        'O sistema usa este token para falar com o projeto no Supabase. Ele vale só para este projeto, fica guardado com segurança e não é mostrado de novo.',
      ),
    ).toBeTruthy();
    expect(container.querySelector('svg.lucide-key-round')).toBeTruthy();
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).toContain('flex-col');
    expect(frame.className).toContain('gap-4');
    expect(frame.className).toContain('p-4');
    expect(frame.className).toContain('md:p-6');
  });

  it.each(Object.entries(WORDS))('shows the %s pill with the plain word', (state, word) => {
    card(state as TokenState);
    expect(screen.getByTestId('token-pill').textContent).toBe(word);
  });

  it.each(Object.entries(NOTICES))('%s: the notice is %s', (state, text) => {
    const { container } = card(state as TokenState, { expiresAt: '2026-11-08' });
    const notice = container.querySelector('[data-notice]');
    if (text === null) {
      expect(notice).toBeNull();
      return;
    }
    expect(notice?.textContent).toContain(text);
    expect(container.querySelectorAll('[data-notice]')).toHaveLength(1);
  });

  it('gives Vencendo the amber row with CircleAlert and no alert role', () => {
    const { container } = card('expiring', { expiresAt: '2026-11-08' });
    const row = container.querySelector('[data-notice]') as HTMLElement;
    expect(row.hasAttribute('role')).toBe(false);
    expect(row.className).toContain('bg-warning/10');
    expect(row.querySelector('svg')?.getAttribute('class')).toContain('lucide-circle-alert');
  });

  it.each(['expired', 'invalid', 'no_permission', 'org_mismatch'] as const)(
    'gives %s the bordered danger row with TriangleAlert and role="alert"',
    (state) => {
      const { container } = card(state);
      const row = container.querySelector('[data-notice]') as HTMLElement;
      expect(row.getAttribute('role')).toBe('alert');
      expect(row.className).toContain('border-danger/40');
      expect(row.className).toContain('bg-danger/5');
      expect(row.querySelector('svg')?.getAttribute('class')).toContain('lucide-triangle-alert');
    },
  );

  it('says in plain words that the community keeps running where it is true (A-UI-7)', () => {
    for (const state of ['expiring', 'expired', 'invalid'] as const) {
      const { container } = card(state, { expiresAt: '2026-11-08' });
      expect(container.textContent).toContain('A comunidade continua no ar');
      cleanup();
    }
  });

  it('reads "Vence em 12 dias, em 8 de novembro de 2026." for a token 12 days away, counted from the server date', () => {
    card('expiring', { expiresAt: '2026-11-08' });
    expect(screen.getByText('Vence em 12 dias, em 8 de novembro de 2026.')).toBeTruthy();
  });

  it('uses the singular for one day', () => {
    card('expiring', { expiresAt: '2026-10-28' });
    expect(screen.getByText('Vence em 1 dia, em 28 de outubro de 2026.')).toBeTruthy();
  });

  it('reads "Vence em {date}." for a valid token with a typed date', () => {
    card('valid', { expiresAt: '2027-03-05' });
    expect(screen.getByText('Vence em 5 de março de 2027.')).toBeTruthy();
  });

  it('reads "Venceu em {date}." for an expired token', () => {
    card('expired', { expiresAt: '2026-10-20' });
    expect(screen.getByText('Venceu em 20 de outubro de 2026.')).toBeTruthy();
  });

  it('reads "Sem data de vencimento informada." when no date was typed', () => {
    card('valid', { expiresAt: null });
    expect(screen.getByText('Sem data de vencimento informada.')).toBeTruthy();
  });

  it('formats the typed date by splitting the string, so no timezone can move it a day', () => {
    card('valid', { expiresAt: '2027-01-01' });
    expect(screen.getByText('Vence em 1 de janeiro de 2027.')).toBeTruthy();
  });

  it('follows the check time: "Verificado {when}." or "Ainda não verificado."', () => {
    card('valid', { verifiedWhen: 'há 3 min' });
    expect(screen.getByText('Verificado há 3 min.')).toBeTruthy();
    cleanup();
    card('unchecked', { checkedAt: null, verifiedWhen: null });
    expect(screen.getByText('Ainda não verificado.')).toBeTruthy();
    expect(screen.queryByText(/^Verificado /)).toBeNull();
  });

  it('keeps the pill row wrapping and the lines wrapping so 320px never scrolls sideways (E06 long-text)', () => {
    const { container } = card('expiring', { expiresAt: '2026-11-08' });
    const row = screen.getByTestId('token-pill').parentElement as HTMLElement;
    expect(row.className).toContain('flex-wrap');
    expect(row.className).toContain('gap-3');
    const notice = container.querySelector('[data-notice] p') as HTMLElement;
    expect(notice.className).toContain('break-words');
    expect(screen.getByText('Vence em 12 dias, em 8 de novembro de 2026.').className).toContain(
      'break-words',
    );
  });

  it('shows no input, no token-looking string and no length, and keeps the how-to closed (UI-D-561)', () => {
    const { container } = card('valid', { expiresAt: '2027-03-05' });
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).not.toMatch(/sbp_|sb_secret_|eyJ/);
    expect(container.textContent).not.toMatch(/\d{5,}/);
    expect(container.innerHTML).not.toContain('dangerouslySetInnerHTML');
    const details = container.querySelector('details[data-token-howto]') as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.hasAttribute('open')).toBe(false);
    expect(within(details).getByText('Como criar o token')).toBeTruthy();
  });
});

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
  finishedAt: '2026-10-12T10:00:00.000Z',
}));

function overview(patch: Partial<DatabaseOverview> = {}): DatabaseOverview {
  return {
    ref: 'abcdefghijklmnopqrst',
    plan: 'pro',
    state: 'ready',
    steps: STEPS_DONE,
    schema: { applied: 147, required: 147 },
    lastCheckedAt: '2026-10-27T10:00:00.000Z',
    preparationFinishedAt: '2026-10-12T10:00:00.000Z',
    credentials: { held: true, updatedAt: null },
    otherTenants: 0,
    moving: false,
    lastErrorCode: null,
    ...patch,
  };
}

async function page(patch: Partial<DatabaseOverview>) {
  platform.detail.mockResolvedValue({ tenant: { id: TENANT } });
  platform.database.mockResolvedValue(overview(patch));
  return render(await TenantDatabasePage({ params: Promise.resolve({ id: TENANT }) }));
}

const titles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('h2, h3')).map((heading) => heading.textContent);

describe('Banco page - the Token de acesso card (UI-D-554, UI-D-558)', () => {
  beforeEach(() => {
    platform.detail.mockReset();
    platform.database.mockReset();
  });

  it('renders four cards for a customer project: Banco de dados, Preparação, Token de acesso, Credenciais', async () => {
    const { container } = await page({
      owner: 'customer',
      organization: 'acme-corp',
      token: { state: 'expiring', expiresAt: '2026-11-08', checkedAt: '2026-10-27T10:00:00.000Z' },
    });
    expect(titles(container)).toEqual([
      'Banco de dados',
      'Preparação',
      'Token de acesso',
      'Credenciais',
    ]);
    expect(screen.getByTestId('token-pill').textContent).toBe('Vencendo');
  });

  it('renders only the 09.2 cards for a platform project', async () => {
    const { container } = await page({ owner: 'platform', organization: null, token: null });
    expect(titles(container)).toEqual(['Banco de dados', 'Preparação', 'Credenciais']);
    expect(screen.queryByTestId('token-pill')).toBeNull();
  });

  it('renders only the 09.2 cards for an answer from an API that predates the fields', async () => {
    const { container } = await page({});
    expect(titles(container)).toEqual(['Banco de dados', 'Preparação', 'Credenciais']);
  });

  it('shows no Token card for a customer project whose answer carries no token summary', async () => {
    const { container } = await page({ owner: 'customer', organization: 'acme-corp' });
    expect(titles(container)).not.toContain('Token de acesso');
  });

  it('hides Preparação and the Token card for a tenant on the central project', async () => {
    const { container } = await page({ steps: [], state: 'ready' });
    expect(titles(container)).toEqual(['Banco de dados', 'Credenciais']);
  });
});
