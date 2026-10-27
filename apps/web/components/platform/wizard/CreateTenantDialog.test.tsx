// @vitest-environment happy-dom
import { NEUTRAL_BRAND } from '@rede-social/contracts/branding';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapProgress } from '@/app/(platform)/plataforma/novo/actions';
import { emptyButtonColors, emptyDarkColors, emptyFontColors } from '@/lib/bg-tone';
import type { TenantDraft } from './TenantDraftProvider';

/**
 * The confirmation's `database` task (09.2-18, UI-D-535, D-542, DBT-50, E03). Real: the dialog, the
 * shared reason and step catalogs and the REAL pt-BR catalog through next-intl's own translator (a
 * missing key throws). Stubbed: the router, the server actions (create, progress read, domain), the
 * upload runner and the draft provider, with fake timers, so the claims are about ORDER and WORDS:
 *
 *  1. The list is create → database → logo → icon → domain, and the logo, the icon and the domain wait
 *     for the database; nothing is written into a bucket that does not exist yet.
 *  2. While it runs a second line names the step ("Etapa n de 8: …", `aria-live="polite"`, wrapping);
 *     it follows each read and is gone when the task is done, every row `done` (E03 loading/populated).
 *  3. A failed step is the catalog's sentence under the task; the logo and the icon stay on `Circle`
 *     with "Não enviado…", the domain is still attempted, and the dialog ends in the partial phase whose
 *     "Continuar" is a link to the Banco tab (E03 error / partial).
 *  4. After 60 s the ghost "Continuar em segundo plano" appears with its helper; pressing it attaches
 *     the domain, leaves the logo and icon for the Marca tab, forgets the stored draft and goes to the
 *     Banco tab while the preparation goes on. A read that fails keeps the last state on screen.
 *  5. Two to five tasks render in one geometry (the backstop), and no credential is ever in the markup.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return {
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    draft: null as unknown,
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    create: vi.fn(),
    find: vi.fn(),
    read: vi.fn(),
    attach: vi.fn(),
    upload: vi.fn(),
    forget: vi.fn(),
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    useTranslations: (namespace?: string) => {
      const key = namespace ?? '';
      let tr = byNamespace.get(key);
      if (!tr) {
        tr = actual.createTranslator({
          locale: 'pt-BR',
          messages: harness.messages,
          namespace,
          onError: (error) => {
            throw error;
          },
        });
        byNamespace.set(key, tr);
      }
      return tr;
    },
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => harness.router }));
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement('a', { href, ...rest }, children),
  };
});
vi.mock('@/app/(platform)/plataforma/novo/actions', () => ({
  createTenantFromDraftAction: harness.create,
  findCreatedTenantAction: harness.find,
  readBootstrapProgressAction: harness.read,
}));
vi.mock('@/app/(platform)/plataforma/tenants/[id]/dominios/actions', () => ({
  attachDomainAction: harness.attach,
}));
vi.mock('@/app/(platform)/plataforma/tenants/[id]/marca/actions', () => ({
  completeBrandingUploadAction: vi.fn(),
  startBrandingUploadAction: vi.fn(),
}));
vi.mock('@/lib/branding-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/branding-upload')>()),
  runBrandingUpload: harness.upload,
}));
vi.mock('./TenantDraftProvider', () => ({
  useTenantDraft: () => harness.draft,
  forgetStoredDraft: harness.forget,
}));

MotionGlobalConfig.skipAnimations = true;

const { CreateTenantDialog } = await import('./CreateTenantDialog');

const ID = '44444444-4444-4444-8444-444444444444';
const REF = 'abcdefghijklmnopqrst';
const SECRET = 'pw-s3cr3t-0001';

const BASE: TenantDraft = {
  displayName: 'Clube Aurora',
  slug: 'clube-aurora',
  slugTouched: false,
  primary: NEUTRAL_BRAND.primary,
  secondary: NEUTRAL_BRAND.secondary,
  modules: {},
  adminEmail: 'admin@clube.test',
  projectRef: REF,
  owner: 'platform',
  tokenExpiresAt: '',
  manualAccess: false,
  contrastConfirmed: false,
  titleFont: null,
  lightTone: null,
  darkColors: emptyDarkColors(),
  fontColors: emptyFontColors(),
  buttonColors: emptyButtonColors(),
  host: '',
  hostReady: true,
  dataReady: true,
  fieldErrors: {},
  pendingSlug: null,
  createdId: null,
};

const image = (name: string) => ({
  file: new File(['x'], name, { type: 'image/png' }),
  url: `blob:${name}`,
});

function stage(options: { draft?: Partial<TenantDraft>; logo?: boolean; icon?: boolean } = {}) {
  const draft = { ...BASE, ...options.draft };
  harness.draft = {
    draft,
    colors: { primary: draft.primary, secondary: draft.secondary },
    enabledModules: [],
    logo: options.logo ? image('claro.png') : null,
    logoDark: null,
    icon: options.icon ? image('icone.png') : null,
    appIcon: null,
    access: { databasePassword: SECRET, serviceKey: '', publishableKey: '' },
    clearAccess: vi.fn(),
    token: '',
    clearToken: vi.fn(),
    update: vi.fn(),
    setConfirming: vi.fn(),
  };
}

const KEYS = [
  'verify',
  'roles',
  'schema',
  'auth',
  'buckets',
  'realtime',
  'tenant',
  'invite',
] as const;

/** A read of the preparation: `done` steps finished, one running (or one failed), the rest waiting. */
function reading(options: {
  done: number;
  failed?: boolean;
  reason?: string;
  state?: BootstrapProgress['state'];
}): BootstrapProgress {
  return {
    state: options.state ?? (options.failed ? 'preparation_failed' : 'preparing'),
    steps: KEYS.map((step, index) => ({
      step,
      status:
        index < options.done
          ? 'done'
          : index === options.done
            ? options.failed
              ? 'failed'
              : 'running'
            : 'pending',
      reasonCode: index === options.done && options.failed ? (options.reason ?? 'unknown') : null,
    })) as BootstrapProgress['steps'],
  };
}
const FINISHED = reading({ done: 8, state: 'unchecked' });

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-task]'));
const row = (task: string) => document.querySelector<HTMLElement>(`[data-task="${task}"]`);
const states = () => rows().map((r) => `${r.dataset.task}:${r.dataset.state}`);
const stepLine = () =>
  Array.from(document.querySelectorAll('[aria-live="polite"]'))
    .map((n) => n.textContent)
    .find((text) => /^Etapa \d+ de \d+/.test(text ?? ''));
const tick = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const buttonNamed = (name: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === name);

async function start() {
  render(<CreateTenantDialog open onClose={() => {}} />);
  fireEvent.click(document.querySelector('[data-create-confirm]') as HTMLElement);
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  for (const mock of [
    harness.router.push,
    harness.router.replace,
    harness.create,
    harness.find,
    harness.read,
    harness.attach,
    harness.upload,
    harness.forget,
  ]) {
    mock.mockReset();
  }
  harness.create.mockResolvedValue({ ok: true, id: ID });
  harness.attach.mockResolvedValue({ added: true });
  harness.upload.mockResolvedValue({ ok: true, view: {} });
  harness.read.mockResolvedValue(FINISHED);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the confirmation — the database task', () => {
  it('1. lists create, database, logo, icon, domain in that order', async () => {
    stage({ logo: true, icon: true, draft: { host: 'comunidade.exemplo.com.br' } });
    harness.read.mockResolvedValue(reading({ done: 0 }));
    await start();
    expect(rows().map((r) => r.dataset.task)).toEqual([
      'create',
      'database',
      'logo',
      'icon',
      'domain',
    ]);
    expect(row('database')?.textContent).toContain('Preparar o banco de dados');
  });

  it('1. holds the uploads and the domain until the database is done, then writes in order', async () => {
    stage({ logo: true, icon: true, draft: { host: 'comunidade.exemplo.com.br' } });
    harness.read
      .mockResolvedValueOnce(reading({ done: 2 }))
      .mockResolvedValueOnce(reading({ done: 5 }))
      .mockResolvedValue(FINISHED);
    const order: string[] = [];
    harness.upload.mockImplementation(async ({ kind }: { kind: string }) => {
      order.push(kind);
      return { ok: true, view: {} };
    });
    harness.attach.mockImplementation(async () => {
      order.push('domain');
      return { added: true };
    });

    await start();
    expect(harness.read).toHaveBeenCalledWith(ID);
    expect(states()).toEqual([
      'create:done',
      'database:running',
      'logo:pending',
      'icon:pending',
      'domain:pending',
    ]);
    expect(harness.upload).not.toHaveBeenCalled();
    expect(harness.attach).not.toHaveBeenCalled();

    await tick(2000);
    expect(harness.upload).not.toHaveBeenCalled();
    expect(harness.attach).not.toHaveBeenCalled();

    await tick(2000);
    expect(order).toEqual(['logo', 'icon_art', 'domain']);
    expect(harness.router.replace).toHaveBeenCalledWith(
      `/plataforma/novo/${ID}/convite?toast=created`,
    );
  });

  it('2. E03 loading: narrates the running step and follows each read, announced politely', async () => {
    stage();
    harness.read
      .mockResolvedValueOnce(reading({ done: 2 }))
      .mockResolvedValueOnce(reading({ done: 4 }))
      .mockResolvedValue(reading({ done: 7 }));
    await start();
    expect(stepLine()).toBe('Etapa 3 de 8: Aplicar o esquema do banco');
    const line = Array.from(document.querySelectorAll('[aria-live="polite"]')).find((n) =>
      /^Etapa/.test(n.textContent ?? ''),
    ) as HTMLElement;
    expect(line.className).toContain('text-xs');
    expect(line.className).toContain('text-text-tertiary');
    expect(line.className).toContain('tabular-nums');
    expect(line.className).toContain('mt-1');
    expect(row('database')?.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');

    await tick(2000);
    expect(stepLine()).toBe('Etapa 5 de 8: Criar os buckets de arquivos');
    await tick(2000);
    expect(stepLine()).toBe('Etapa 8 de 8: Agendar o convite do primeiro administrador');
  });

  it('2. E03 populated: when it finishes the line is gone and every row is done', async () => {
    stage({ logo: true, draft: { host: 'comunidade.exemplo.com.br' } });
    harness.read.mockResolvedValueOnce(reading({ done: 6 })).mockResolvedValue(FINISHED);
    harness.router.replace.mockImplementation(() => {});
    await start();
    expect(stepLine()).toBeDefined();
    await tick(2000);
    expect(stepLine()).toBeUndefined();
    expect(document.body.textContent).not.toMatch(/Etapa \d+ de \d+/);
    expect(states()).toEqual(['create:done', 'database:done', 'logo:done', 'domain:done']);
    expect(row('database')?.querySelector('svg')?.getAttribute('class')).toContain('text-brand');
  });

  it('2. a project that is ready at the first read (a shared one) is done at once, with no sub-line', async () => {
    stage();
    harness.read.mockResolvedValue({ state: 'unchecked', steps: [] });
    await start();
    expect(stepLine()).toBeUndefined();
    expect(harness.router.replace).toHaveBeenCalledWith(
      `/plataforma/novo/${ID}/convite?toast=created`,
    );
  });

  it('2. polls the created tenant every two seconds and nothing else', async () => {
    stage();
    harness.read.mockResolvedValue(reading({ done: 1 }));
    await start();
    expect(harness.read).toHaveBeenCalledTimes(1);
    await tick(1999);
    expect(harness.read).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(harness.read).toHaveBeenCalledTimes(2);
    await tick(4000);
    expect(harness.read).toHaveBeenCalledTimes(4);
    for (const call of harness.read.mock.calls) expect(call).toEqual([ID]);
  });

  it('2. a read that fails keeps the last state on screen and asks again at the next tick', async () => {
    stage();
    harness.read
      .mockResolvedValueOnce(reading({ done: 2 }))
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(reading({ done: 3 }));
    await start();
    expect(stepLine()).toBe('Etapa 3 de 8: Aplicar o esquema do banco');
    await tick(2000);
    expect(stepLine()).toBe('Etapa 3 de 8: Aplicar o esquema do banco');
    await tick(2000);
    expect(stepLine()).toBe('Etapa 3 de 8: Aplicar o esquema do banco');
    await tick(2000);
    expect(stepLine()).toBe('Etapa 4 de 8: Configurar a autenticação');
    expect(row('database')?.dataset.state).toBe('running');
  });
});

describe('the confirmation — a database that fails', () => {
  async function failAt(reason: string) {
    stage({ logo: true, icon: true, draft: { host: 'comunidade.exemplo.com.br' } });
    harness.read.mockResolvedValue(reading({ done: 2, failed: true, reason }));
    await start();
  }

  it('3. E03 error: the task shows the catalog sentence of the reason, never provider text', async () => {
    await failAt('migration_failed');
    expect(row('database')?.dataset.state).toBe('failed');
    expect(row('database')?.textContent).toContain('Uma migração do esquema falhou.');
    expect(row('database')?.querySelector('svg')?.getAttribute('class')).toContain('text-danger');
    expect(stepLine()).toBeUndefined();
  });

  it.each([
    ['unreachable', 'Não foi possível falar com o projeto.'],
    ['access_denied', 'O Supabase recusou o acesso. Confira a senha e as chaves.'],
    ['not_empty', 'O projeto já tem tabelas.'],
    ['auth_config_failed', 'A configuração da autenticação falhou.'],
    ['storage_failed', 'A criação dos buckets falhou.'],
    ['realtime_failed', 'A criação das políticas do Realtime falhou.'],
    ['tenant_failed', 'A criação do tenant falhou.'],
    ['invite_failed', 'O agendamento do convite falhou.'],
    ['unknown', 'Algo deu errado nesta etapa.'],
  ])('3. the reason code %s reads "%s"', async (reason, sentence) => {
    await failAt(reason);
    expect(row('database')?.textContent).toContain(sentence);
  });

  it('3. E03 partial: logo and icon stay on Circle with "Não enviado…", the domain is still attempted', async () => {
    await failAt('migration_failed');
    expect(harness.upload).not.toHaveBeenCalled();
    expect(harness.attach).toHaveBeenCalledTimes(1);
    expect(states()).toEqual([
      'create:done',
      'database:failed',
      'logo:pending',
      'icon:pending',
      'domain:done',
    ]);
    const notSent = 'Não enviado: o banco ainda não está pronto. Envie na aba Marca depois.';
    expect(row('logo')?.textContent).toContain(notSent);
    expect(row('icon')?.textContent).toContain(notSent);
    expect(row('logo')?.querySelector('svg')?.getAttribute('class')).toContain(
      'text-text-tertiary',
    );
    expect(row('domain')?.textContent).not.toContain(notSent);
  });

  it('3. ends in the partial phase, whose Continuar is a link to the Banco tab, not to the invite', async () => {
    await failAt('migration_failed');
    const dialog = document.querySelector('[data-create-dialog]') as HTMLElement;
    expect(dialog.dataset.createDialog).toBe('partial');
    expect(document.body.textContent).toContain('Tenant criado com pendências');
    expect(document.body.textContent).toContain(
      'O tenant foi criado, mas o banco ainda não está pronto. Continue para ver a etapa que falhou e tentar de novo.',
    );
    const link = Array.from(document.querySelectorAll('a')).find(
      (a) => a.textContent === 'Continuar',
    );
    expect(link?.getAttribute('href')).toBe(`/plataforma/tenants/${ID}/banco`);
    expect(link?.className).toContain('bg-button');
    expect(harness.router.replace).not.toHaveBeenCalled();
    fireEvent.click(link as HTMLElement);
    expect(harness.forget).toHaveBeenCalled();
  });

  it('3. a miss that is only a failed upload keeps the shipped wording and the invite hand-off', async () => {
    stage({ logo: true });
    harness.read.mockResolvedValue(FINISHED);
    harness.upload.mockResolvedValue({ ok: false, code: 'generic' });
    await start();
    expect(document.querySelector('[data-create-dialog]')?.getAttribute('data-create-dialog')).toBe(
      'partial',
    );
    expect(document.body.textContent).toContain(
      'O tenant foi criado, mas o que está marcado acima não foi concluído.',
    );
    expect(document.body.textContent).not.toContain('o banco ainda não está pronto. Continue');
    expect(
      Array.from(document.querySelectorAll('a')).some((a) => a.textContent === 'Continuar'),
    ).toBe(false);
    fireEvent.click(buttonNamed('Continuar') as HTMLElement);
    expect(harness.router.replace).toHaveBeenCalledWith(
      `/plataforma/novo/${ID}/convite?toast=created`,
    );
  });
});

describe('the confirmation — a slow preparation', () => {
  const GHOST = 'Continuar em segundo plano';
  const HELPER =
    'O banco continua sendo preparado. O logo e o ícone podem ser enviados depois, na aba Marca.';

  it('4. the ghost button is absent at 59.999 s and present at 60 s, with its helper', async () => {
    stage({ logo: true });
    harness.read.mockResolvedValue(reading({ done: 4 }));
    await start();
    await tick(59_998);
    expect(buttonNamed(GHOST)).toBeUndefined();
    expect(document.body.textContent).not.toContain(HELPER);
    await tick(1);
    expect(buttonNamed(GHOST)).toBeUndefined();
    await tick(1);
    expect(buttonNamed(GHOST)).toBeDefined();
    expect(document.body.textContent).toContain(HELPER);
    // Neutral text, not brand (sketch 014 F-1), and it is not the one brand fill.
    const ghost = buttonNamed(GHOST) as HTMLElement;
    expect(ghost.className).toContain('text-text');
    expect(ghost.className).not.toContain('text-brand');
    expect(ghost.className).not.toContain('bg-button');
  });

  it('4. pressing it attaches the domain, leaves the uploads for later and goes to the Banco tab', async () => {
    stage({ logo: true, icon: true, draft: { host: 'comunidade.exemplo.com.br' } });
    harness.read.mockResolvedValue(reading({ done: 4 }));
    await start();
    await tick(60_000);
    fireEvent.click(buttonNamed(GHOST) as HTMLElement);
    await tick(0);
    expect(harness.upload).not.toHaveBeenCalled();
    expect(harness.attach).toHaveBeenCalledTimes(1);
    expect(harness.forget).toHaveBeenCalled();
    expect(harness.router.replace).toHaveBeenCalledExactlyOnceWith(
      `/plataforma/tenants/${ID}/banco`,
    );
    // The wait stopped: the preparation goes on without us and is not read again from here.
    const reads = harness.read.mock.calls.length;
    await tick(10_000);
    expect(harness.read).toHaveBeenCalledTimes(reads);
  });

  it('4. the option goes away when the database finishes just as it was offered', async () => {
    stage();
    harness.read.mockResolvedValueOnce(reading({ done: 4 })).mockResolvedValue(FINISHED);
    await start();
    await tick(60_000);
    expect(harness.router.replace).toHaveBeenCalledWith(
      `/plataforma/novo/${ID}/convite?toast=created`,
    );
    expect(buttonNamed(GHOST)).toBeUndefined();
  });
});

describe('the confirmation — text safety and geometry', () => {
  it('5. E03 long-text: the step line and the task labels wrap inside the sheet', async () => {
    stage({ logo: true });
    harness.read.mockResolvedValue(reading({ done: 7 }));
    await start();
    const line = Array.from(document.querySelectorAll('[aria-live="polite"]')).find((n) =>
      /^Etapa/.test(n.textContent ?? ''),
    ) as HTMLElement;
    expect(line.textContent).toBe('Etapa 8 de 8: Agendar o convite do primeiro administrador');
    expect(line.className).toContain('break-words');
    expect(line.parentElement?.className).toContain('min-w-0');
    expect(document.querySelector('ol')?.className).toContain('flex-col');
  });

  it('5. E03 overflow: the 20-letter ref in the review breaks anywhere', () => {
    stage({ draft: { manualAccess: true } });
    render(<CreateTenantDialog open onClose={() => {}} />);
    const dd = document.querySelector('[data-confirm-project]') as HTMLElement;
    expect(dd.className).toContain('min-w-0');
    expect(dd.firstElementChild?.className).toContain('break-all');
  });

  it('5. backstop: two tasks and five tasks render in one geometry', async () => {
    const shape = (li: Element) => ({
      cls: li.className,
      icon: li
        .querySelector('svg')
        ?.getAttribute('class')
        ?.replace(/lucide\S*|text-\S+|animate-spin/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      body: li.querySelector('div')?.className,
      label: li
        .querySelector('div > span')
        ?.className.replace(/text-\S+/g, '')
        .trim(),
    });
    harness.read.mockResolvedValue(reading({ done: 3 }));

    stage();
    await start();
    const two = rows().map(shape);
    expect(two).toHaveLength(2);
    cleanup();

    stage({ logo: true, icon: true, draft: { host: 'comunidade.exemplo.com.br' } });
    await start();
    const five = rows().map(shape);
    expect(five).toHaveLength(5);

    for (const one of [...two, ...five]) expect(one).toEqual(two[0]);
    expect(new Set(five.map((s) => JSON.stringify(s))).size).toBe(1);
  });

  it('5. no credential of the manual access is in the markup, whatever the memory holds', async () => {
    stage({ draft: { manualAccess: true } });
    harness.read.mockResolvedValue(reading({ done: 2, failed: true, reason: 'access_denied' }));
    const { container } = render(<CreateTenantDialog open onClose={() => {}} />);
    expect(container.innerHTML).not.toContain(SECRET);
    fireEvent.click(document.querySelector('[data-create-confirm]') as HTMLElement);
    await tick();
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain(SECRET);
    // It went to the action once, with the creation, and nowhere else.
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.create.mock.calls[0]?.[0].access.databasePassword).toBe(SECRET);
    expect(JSON.stringify(harness.read.mock.calls)).not.toContain(SECRET);
  });

  it('stops reading when the dialog goes away', async () => {
    stage();
    harness.read.mockResolvedValue(reading({ done: 1 }));
    const view = render(<CreateTenantDialog open onClose={() => {}} />);
    fireEvent.click(document.querySelector('[data-create-confirm]') as HTMLElement);
    await tick();
    view.unmount();
    const reads = harness.read.mock.calls.length;
    await tick(10_000);
    expect(harness.read).toHaveBeenCalledTimes(reads);
    expect(harness.router.replace).not.toHaveBeenCalled();
  });
});

/**
 * 09.4-15 Task 2 (UI-D-556, CTK-32, CTK-38, T-09.4-53, T-09.4-54): the customer project in the
 * confirmation. The creation carries owner, token and date ONCE and only for a customer draft; the
 * memory-only token is dropped the moment the API answers; a first-step failure of a customer project
 * reads one of the three new sentences with its code; nothing of the token is ever in the markup.
 */
describe('the confirmation — the customer project', () => {
  const TOKEN = 'sbp_s3cr3t-token-0001';
  const customer = (extra: Partial<TenantDraft> = {}): Partial<TenantDraft> => ({
    owner: 'customer',
    tokenExpiresAt: '2027-03-01',
    ...extra,
  });
  const stageCustomer = (extra: Partial<TenantDraft> = {}) => {
    stage({ draft: customer(extra) });
    Object.assign(harness.draft as object, { token: TOKEN });
  };
  const clearToken = () => (harness.draft as { clearToken: ReturnType<typeof vi.fn> }).clearToken;

  it.each([
    [
      'token_invalid',
      'O Supabase não aceitou o token de acesso. Substitua o token e tente de novo.',
    ],
    [
      'token_forbidden',
      'O token de acesso não tem permissão para esta etapa. Substitua por um token com as permissões certas.',
    ],
    ['org_mismatch', 'O projeto está em outra organização do Supabase. Nada foi alterado.'],
  ])(
    '3. the first-step failure %s reads its sentence and the code line',
    async (reason, sentence) => {
      stageCustomer();
      harness.read.mockResolvedValue(reading({ done: 0, failed: true, reason }));
      await start();
      expect(row('database')?.dataset.state).toBe('failed');
      expect(row('database')?.textContent).toContain(sentence);
      expect(row('database')?.textContent).not.toContain('O Supabase recusou o acesso');
      const dialog = document.querySelector('[data-create-dialog]') as HTMLElement;
      expect(dialog.dataset.createDialog).toBe('partial');
    },
  );

  it('3. a platform draft still reads the shipped access_denied sentence', async () => {
    stage();
    harness.read.mockResolvedValue(reading({ done: 2, failed: true, reason: 'access_denied' }));
    await start();
    expect(row('database')?.textContent).toContain(
      'O Supabase recusou o acesso. Confira a senha e as chaves.',
    );
  });

  it('1. sends owner, token and date ONCE with the creation, and drops the token when the API answers', async () => {
    stageCustomer();
    await start();
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
      owner: 'customer',
      token: TOKEN,
      tokenExpiresAt: '2027-03-01',
    });
    expect(clearToken()).toHaveBeenCalled();
  });

  it('1. a refusal with a field to blame drops the token too; a generic failure keeps it for the retry', async () => {
    stageCustomer();
    harness.create.mockResolvedValue({ ok: false, fieldErrors: { token: 'tokenInvalid' } });
    await start();
    expect(clearToken()).toHaveBeenCalled();

    stageCustomer();
    harness.create.mockResolvedValue({ ok: false, error: 'generic' });
    await start();
    expect(clearToken()).not.toHaveBeenCalled();
  });

  it('1. a platform draft sends no new field and has nothing to drop', async () => {
    stage();
    await start();
    const sent = harness.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('owner');
    expect(sent).not.toHaveProperty('token');
    expect(sent).not.toHaveProperty('tokenExpiresAt');
  });

  it('1. a refused token sends the operator back to Dados, where the field is', async () => {
    stageCustomer();
    harness.create.mockResolvedValue({ ok: false, fieldErrors: { token: 'tokenInvalid' } });
    await start();
    fireEvent.click(buttonNamed('Corrigir os dados') ?? document.body);
    const update = (harness.draft as { update: ReturnType<typeof vi.fn> }).update;
    expect(update).toHaveBeenCalledWith({
      fieldErrors: { token: 'tokenInvalid' },
      dataReady: false,
    });
    expect(harness.router.push).toHaveBeenCalledWith('/plataforma/novo');
  });

  it('5. nothing of the token is in the markup, a spy or a read', async () => {
    stageCustomer();
    harness.read.mockResolvedValue(reading({ done: 0, failed: true, reason: 'token_invalid' }));
    const { container } = render(<CreateTenantDialog open onClose={() => {}} />);
    expect(container.innerHTML).not.toContain(TOKEN);
    fireEvent.click(document.querySelector('[data-create-confirm]') as HTMLElement);
    await tick();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(document.body.textContent).not.toContain('s3cr3t');
    expect(JSON.stringify(harness.read.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(TOKEN);
  });
});
