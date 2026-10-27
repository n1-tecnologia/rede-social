// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantPreviewProvider } from '../preview/TenantPreviewProvider';

/**
 * 09.4-15 Task 3 (CTK-31, CTK-32, CTK-38, T-09.4-53, T-09.4-54): the customer path through the wizard,
 * end to end and token-free. Real: the draft provider, the Dados form, the Resumo and the confirmation
 * dialog, and the REAL pt-BR catalog. Stubbed: the router, the server actions and the upload runner.
 * The path: choose "Projeto do cliente", paste a token and a date, "Continuar", the Resumo, "Criar
 * tenant", and the dialog's `database` task fails with `token_invalid`. The claims:
 *
 *  1. The token reaches the validate action once and the create action once, and nowhere else: not the
 *     rendered text, not an attribute (`aria-label`, `title`...), not `sessionStorage` or `localStorage`,
 *     not a `console` call, not the address of a `fetch`.
 *  2. After the creation answered, the provider's in-memory token is empty.
 *  3. The platform path runs the same sequence with no token field and request bodies without any of
 *     the three new fields.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return {
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    validate: vi.fn(),
    create: vi.fn(),
    find: vi.fn(),
    read: vi.fn(),
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

vi.mock('next/navigation', () => ({
  useRouter: () => harness.router,
  useParams: () => ({}),
}));
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement('a', { href, ...rest }, children),
  };
});
vi.mock('@/app/(platform)/plataforma/novo/actions', () => ({
  validateTenantDraftAction: harness.validate,
  createTenantFromDraftAction: harness.create,
  findCreatedTenantAction: harness.find,
  readBootstrapProgressAction: harness.read,
}));
vi.mock('@/app/(platform)/plataforma/tenants/[id]/dominios/actions', () => ({
  attachDomainAction: vi.fn(),
}));
vi.mock('@/app/(platform)/plataforma/tenants/[id]/marca/actions', () => ({
  completeBrandingUploadAction: vi.fn(),
  startBrandingUploadAction: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;

const { NewTenantForm } = await import('../NewTenantForm');
const { TenantDraftProvider, useTenantDraft } = await import('./TenantDraftProvider');
const { WizardSummary } = await import('./WizardSummary');

const ID = '44444444-4444-4444-8444-444444444444';
const REF = 'abcdefghijklmnopqrst';
const TOKEN = 'sbp_s3cr3t-token-0001';
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

let draft: ReturnType<typeof useTenantDraft>;
let showStep: (step: 'data' | 'summary') => void = () => {};

function Probe() {
  draft = useTenantDraft();
  return null;
}

/** The wizard's steps one at a time over ONE provider, as the App Router layout keeps it. */
function Steps() {
  const [step, setStep] = useState<'data' | 'summary'>('data');
  showStep = setStep;
  return step === 'data' ? <NewTenantForm /> : <WizardSummary />;
}

function mount() {
  return render(
    <TenantPreviewProvider initialTheme="light">
      <TenantDraftProvider moduleKeys={['feed']}>
        <Steps />
        <Probe />
      </TenantDraftProvider>
    </TenantPreviewProvider>,
  );
}

const spies: { name: string; spy: ReturnType<typeof vi.spyOn> }[] = [];
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  for (const mock of [
    harness.router.push,
    harness.validate,
    harness.create,
    harness.find,
    harness.read,
  ]) {
    mock.mockReset();
  }
  harness.validate.mockResolvedValue({ ok: true, manualAccess: false });
  harness.create.mockResolvedValue({ ok: true, id: ID });
  harness.read.mockResolvedValue({
    state: 'preparation_failed',
    steps: KEYS.map((step, index) => ({
      step,
      status: index === 0 ? 'failed' : 'pending',
      reasonCode: index === 0 ? 'token_invalid' : null,
    })),
  });
  spies.length = 0;
  for (const name of ['error', 'log', 'warn', 'info'] as const) {
    spies.push({ name, spy: vi.spyOn(console, name).mockImplementation(() => {}) });
  }
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const owner = (name: string) =>
  Array.from(document.querySelectorAll('button[aria-pressed]')).find(
    (button) => button.textContent?.trim() === name,
  ) as HTMLButtonElement;
const change = (id: string, value: string) =>
  fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });
const buttonNamed = (name: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === name);

async function continuar() {
  await act(async () => {
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
  });
  await waitFor(() => expect(draft.draft.dataReady).toBe(true));
}

/** Everything a reader or a script could pick the token out of, apart from the field that holds it. */
function leaks(secret: string) {
  const found: string[] = [];
  if (document.body.textContent?.includes(secret)) found.push('text');
  if (document.body.innerHTML.includes(secret)) found.push('html');
  for (const node of Array.from(document.querySelectorAll('*'))) {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.value.includes(secret)) found.push(`attribute ${attribute.name}`);
    }
  }
  if (JSON.stringify({ ...window.sessionStorage }).includes(secret)) found.push('sessionStorage');
  if (JSON.stringify({ ...window.localStorage }).includes(secret)) found.push('localStorage');
  for (const { name, spy } of spies) {
    if (JSON.stringify(spy.mock.calls).includes(secret)) found.push(`console.${name}`);
  }
  if (fetchSpy.mock.calls.some((call: unknown[]) => String(call[0]).includes(secret)))
    found.push('fetch');
  return found;
}

async function create() {
  showStep('summary');
  await waitFor(() => expect(buttonNamed('Criar tenant')).toBeDefined());
  fireEvent.click(buttonNamed('Criar tenant') as HTMLElement);
  fireEvent.click(document.querySelector('[data-create-confirm]') as HTMLElement);
  await waitFor(() =>
    expect(document.querySelector('[data-create-dialog="partial"]')).not.toBeNull(),
  );
}

describe('the customer path through the wizard', () => {
  it('1. the token travels to the validate action and the create action, once each, and leaks nowhere', async () => {
    mount();
    fireEvent.click(owner('Projeto do cliente'));
    change('projectRef', REF);
    change('projectToken', TOKEN);
    change('projectTokenExpiresAt', '2027-03-01');
    await continuar();
    expect(harness.validate).toHaveBeenCalledTimes(1);
    expect(harness.validate.mock.calls[0]?.[0]).toMatchObject({
      owner: 'customer',
      token: TOKEN,
      tokenExpiresAt: '2027-03-01',
    });
    // Between the steps the draft is mirrored into the tab's session: without the token.
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('s3cr3t');
    expect(draft.token).toBe(TOKEN);

    await create();
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
      owner: 'customer',
      token: TOKEN,
      tokenExpiresAt: '2027-03-01',
    });
    expect(document.body.textContent).toContain(
      'O Supabase não aceitou o token de acesso. Substitua o token e tente de novo.',
    );
    expect(leaks(TOKEN)).toEqual([]);
    expect(leaks('s3cr3t')).toEqual([]);
  });

  it('2. after the creation answered, the provider’s in-memory token is empty', async () => {
    mount();
    fireEvent.click(owner('Projeto do cliente'));
    change('projectRef', REF);
    change('projectToken', TOKEN);
    await continuar();
    expect(draft.token).toBe(TOKEN);
    await create();
    expect(draft.token).toBe('');
    expect(draft.draft.createdId).toBe(ID);
    // The owner and the ref stay (they are not secret); a reload would ask for the token again.
    expect(draft.draft.owner).toBe('customer');
  });

  it('3. the platform path has no token field and its requests carry none of the three new fields', async () => {
    mount();
    expect(document.getElementById('projectToken')).toBeNull();
    change('projectRef', REF);
    await continuar();
    await create();
    for (const call of [harness.validate.mock.calls[0]?.[0], harness.create.mock.calls[0]?.[0]]) {
      expect(call).toMatchObject({ projectRef: REF });
      expect(call).not.toHaveProperty('owner');
      expect(call).not.toHaveProperty('token');
      expect(call).not.toHaveProperty('tokenExpiresAt');
    }
    expect(document.body.textContent).toContain('Plataforma');
    expect(document.body.textContent).not.toContain('Token informado');
  });
});
