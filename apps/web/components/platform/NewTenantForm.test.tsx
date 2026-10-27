// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftValidation } from '@/app/(platform)/plataforma/novo/actions';
import { TenantPreviewProvider } from './preview/TenantPreviewProvider';
import { TenantDraftProvider, useTenantDraft } from './wizard/TenantDraftProvider';

/**
 * Step 1 (Dados): the "Projeto Supabase" group (09.2-18, UI-D-533, DBT-50). Real: the form, the draft
 * provider, the preview provider, the shared `normalizeProjectRef` and the REAL pt-BR catalog through
 * next-intl's own translator (a missing key throws). Stubbed: the router and the server action, so the
 * claims are about what the FORM does with what the action answers, and with what it sends:
 *
 *  1. The group and its field carry the documented copy and attributes (no autofill, no spellcheck,
 *     tabular figures, 200 characters).
 *  2. A pasted dashboard or API address becomes the bare ref at once; blur normalises what was typed
 *     (upper case, spaces, a trailing slash); the field only ever shows the bare ref (P99).
 *  3. What reaches the action is ALWAYS the normalised ref, even when the field was never blurred.
 *  4. Every refusal of the action shows its documented sentence under the field (`role="alert"`) and
 *     keeps the later steps closed (E01 empty / error / partial); a check that could not run is the
 *     top alert, no field error.
 *  5. The pending state ignores a second submit (E01 loading); an edit clears the error and closes the
 *     step again; the ref persists across a reload of the draft.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return {
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    validate: vi.fn(),
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

vi.mock('@/app/(platform)/plataforma/novo/actions', () => ({
  validateTenantDraftAction: harness.validate,
}));

const { NewTenantForm } = await import('./NewTenantForm');

const REF = 'abcdefghijklmnopqrst';
const STORAGE_KEY = 'rede-social:novo-tenant';

let draft: ReturnType<typeof useTenantDraft>;
function Probe() {
  draft = useTenantDraft();
  return null;
}

function mount() {
  return render(
    <TenantPreviewProvider initialTheme="light">
      <TenantDraftProvider moduleKeys={['feed', 'events']}>
        <NewTenantForm />
        <Probe />
      </TenantDraftProvider>
    </TenantPreviewProvider>,
  );
}

const field = () => document.getElementById('projectRef') as HTMLInputElement;
const form = () => document.querySelector('form') as HTMLFormElement;
const alerts = () =>
  Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent);

function type(value: string) {
  fireEvent.change(field(), { target: { value } });
}
function paste(text: string) {
  fireEvent.paste(field(), { clipboardData: { getData: () => text } });
}
async function submit() {
  await act(async () => {
    fireEvent.submit(form());
  });
}

/** The words of the catalog, so a copy edit is made in one place. */
const E = (harness.messages.platform as unknown as { new: { errors: Record<string, string> } }).new
  .errors;

const ok = (): DraftValidation => ({ ok: true, manualAccess: false });
const refused = (key: string): DraftValidation =>
  ({ ok: false, fieldErrors: { projectRef: key } }) as DraftValidation;

beforeEach(() => {
  window.sessionStorage.clear();
  harness.router.push.mockReset();
  harness.validate.mockReset();
  harness.validate.mockResolvedValue(ok());
});
afterEach(cleanup);

describe('Dados — the Projeto Supabase group', () => {
  it('1. shows the group, the helper and a field with the documented attributes', () => {
    mount();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Projeto Supabase');
    expect(text).toContain(
      'Crie um projeto vazio na organização da plataforma no Supabase e cole aqui só o código dele.',
    );
    expect(text).toContain(
      'São 20 letras minúsculas. Você também pode colar o endereço do projeto no Supabase.',
    );
    expect(document.querySelector('label[for="projectRef"]')?.textContent).toBe(
      'Código do projeto',
    );
    expect(field().name).toBe('projectRef');
    expect(field().getAttribute('autocomplete')).toBe('off');
    expect(field().getAttribute('autocapitalize')).toBe('off');
    expect(field().getAttribute('spellcheck')).toBe('false');
    expect(field().maxLength).toBe(200);
    expect(field().className).toContain('tabular-nums');
    // The Database glyph, 18px, sits inside the field's wrapper.
    expect(field().parentElement?.querySelector('svg')?.getAttribute('width')).toBe('18');
  });

  it('2. P99: a pasted dashboard address (with a path) becomes the bare ref', () => {
    mount();
    paste(`https://supabase.com/dashboard/project/${REF}/settings/api`);
    expect(field().value).toBe(REF);
    expect(draft.draft.projectRef).toBe(REF);
  });

  it('2. P99: a pasted API address becomes the bare ref', () => {
    mount();
    paste(`https://${REF}.supabase.co`);
    expect(field().value).toBe(REF);
  });

  it('2. P99: blur trims, lower-cases and drops a trailing slash or a query string of an address', () => {
    mount();
    type(`  ${REF.toUpperCase()}  `);
    fireEvent.blur(field());
    expect(field().value).toBe(REF);

    type(`https://supabase.com/dashboard/project/${REF}/?tab=api`);
    fireEvent.blur(field());
    expect(field().value).toBe(REF);

    type(`HTTPS://${REF.toUpperCase()}.SUPABASE.CO/`);
    fireEvent.blur(field());
    expect(field().value).toBe(REF);
  });

  it('2. P99: anything else is kept as typed, so it fails the format rule instead of being rewritten', () => {
    mount();
    // A look-alike letter (Cyrillic а) and a 21-letter value are not extracted from.
    const lookAlike = `а${REF.slice(1)}`;
    type(lookAlike);
    fireEvent.blur(field());
    expect(field().value).toBe(lookAlike);
    type(`${REF}u`);
    fireEvent.blur(field());
    expect(field().value).toBe(`${REF}u`);
  });

  it('3. P99: what reaches the action is the normalised ref, even when the field never blurred', async () => {
    mount();
    type(`  ${REF.toUpperCase()}/ `);
    await submit();
    expect(harness.validate).toHaveBeenCalledTimes(1);
    expect(harness.validate.mock.calls[0]?.[0]).toMatchObject({ projectRef: `${REF}/` });
    // A trailing slash on a bare value is not an address: it is kept and refused by the shape rule.
    harness.validate.mockClear();
    type(`https://supabase.com/dashboard/project/${REF.toUpperCase()}/ `);
    await submit();
    expect(harness.validate.mock.calls[0]?.[0]).toMatchObject({ projectRef: REF });
  });

  it('4. E01 empty: an empty ref shows "Informe o código do projeto." and keeps the step closed', async () => {
    harness.validate.mockResolvedValue(refused('projectRefRequired'));
    mount();
    await submit();
    expect(harness.validate.mock.calls[0]?.[0]).toMatchObject({ projectRef: '' });
    await waitFor(() => expect(alerts()).toContain('Informe o código do projeto.'));
    expect(draft.draft.dataReady).toBe(false);
    expect(harness.router.push).not.toHaveBeenCalled();
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it.each([
    ['projectRefInvalid', 'Use o código do projeto: 20 letras minúsculas, sem espaços.'],
    [
      'projectNotFound',
      'Não encontramos este projeto. Confira o código e se ele está na organização da plataforma. Se ele é do cliente, escolha “Projeto do cliente”.',
    ],
    ['projectNotEmpty', 'Este projeto já tem tabelas. Use um projeto novo e vazio.'],
    ['projectInUse', 'Este projeto já está em uso por outro tenant.'],
    ['projectPaused', 'Este projeto está pausado. Reative-o no Supabase e tente de novo.'],
  ])('4. E01 error: %s reads "%s" under the field', async (key, sentence) => {
    harness.validate.mockResolvedValue(refused(key));
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(alerts()).toContain(sentence));
    expect(E[key]).toBe(sentence);
    expect(draft.draft.dataReady).toBe(false);
    expect(harness.router.push).not.toHaveBeenCalled();
  });

  it('4. a pre-check that could not run is the top alert, with no field error', async () => {
    harness.validate.mockResolvedValue({ ok: false, fieldErrors: {}, unchecked: true });
    mount();
    type(REF);
    await submit();
    await waitFor(() =>
      expect(alerts()).toContain('Não foi possível conferir o projeto agora. Tente de novo.'),
    );
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(draft.draft.dataReady).toBe(false);
  });

  it('5. E01 loading: the pending state ignores a second submit', async () => {
    let release: (value: DraftValidation) => void = () => {};
    harness.validate.mockReturnValue(
      new Promise<DraftValidation>((resolve) => {
        release = resolve;
      }),
    );
    mount();
    type(REF);
    await submit();
    const button = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await submit();
    expect(harness.validate).toHaveBeenCalledTimes(1);
    await act(async () => release(ok()));
    expect(harness.router.push).toHaveBeenCalledWith('/plataforma/novo/marca');
  });

  it('5. a passing check opens the next step (dataReady) and keeps the bare ref', async () => {
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(harness.router.push).toHaveBeenCalledWith('/plataforma/novo/marca'));
    expect(draft.draft.dataReady).toBe(true);
    expect(draft.draft.projectRef).toBe(REF);
  });

  it('5. E01 partial: a ref typed and never checked leaves the later steps closed', () => {
    mount();
    type(REF);
    expect(draft.draft.projectRef).toBe(REF);
    expect(draft.draft.dataReady).toBe(false);
    expect(harness.validate).not.toHaveBeenCalled();
  });

  it('5. every edit of the ref clears its error and closes the step again', async () => {
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(draft.draft.dataReady).toBe(true));

    harness.validate.mockResolvedValue(refused('projectNotFound'));
    await submit();
    await waitFor(() => expect(alerts()).toContain(E.projectNotFound));
    act(() => draft.update({ dataReady: true }));
    type(`${REF}x`);
    expect(draft.draft.dataReady).toBe(false);
    expect(alerts()).not.toContain(E.projectNotFound);
    expect(field().getAttribute('aria-invalid')).toBeNull();
  });

  it('5. E01 long-text: a long value is kept (the field stops typing at 200) and is refused by the shape rule', async () => {
    harness.validate.mockResolvedValue(refused('projectRefInvalid'));
    mount();
    const long = 'a'.repeat(300);
    paste(long);
    expect(field().maxLength).toBe(200);
    expect(field().value).toBe(long);
    await submit();
    expect(harness.validate.mock.calls[0]?.[0]).toMatchObject({ projectRef: long });
    await waitFor(() => expect(alerts()).toContain(E.projectRefInvalid));
  });

  it('5. the ref persists across a reload of the draft (it is not secret)', () => {
    const first = mount();
    type(REF);
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    expect(stored.projectRef).toBe(REF);
    first.unmount();
    mount();
    expect(field().value).toBe(REF);
  });

  it('every sentence the form can show exists in the catalog', () => {
    for (const key of [
      'projectRefRequired',
      'projectRefInvalid',
      'projectNotFound',
      'projectNotEmpty',
      'projectInUse',
      'projectPaused',
    ]) {
      expect(typeof E[key]).toBe('string');
      expect((E[key] ?? '').length).toBeGreaterThan(10);
    }
  });
});

/**
 * 09.2-18 Task 2 (UI-D-534, DBT-21, E02): the manual-access block. Present only after a pre-check that
 * answered `manualAccess`; the first "Continuar" that learns it only reveals it; from then on all three
 * values are required, each with its own error; the values live in memory and never in the session
 * mirror, and they never go to the Dados action.
 */
describe('Dados — the manual access block', () => {
  const SECRETS = {
    databasePassword: 'pw-s3cr3t-0001',
    serviceKey: 'svc-s3cr3t-0002',
    publishableKey: 'pub-s3cr3t-0003',
  };
  const manual = (): DraftValidation => ({ ok: true, manualAccess: true });
  const block = () => document.querySelector('[data-project-access]');
  const secretField = (key: keyof typeof SECRETS) =>
    document.getElementById(`access-${key}`) as HTMLInputElement;
  const fill = (values: Partial<typeof SECRETS>) => {
    for (const [key, value] of Object.entries(values)) {
      fireEvent.change(secretField(key as keyof typeof SECRETS), { target: { value } });
    }
  };
  const mirror = () => window.sessionStorage.getItem(STORAGE_KEY) ?? '';

  it('E02: is absent from the DOM when the platform obtained the access itself', async () => {
    mount();
    expect(block()).toBeNull();
    type(REF);
    await submit();
    await waitFor(() => expect(harness.router.push).toHaveBeenCalled());
    expect(block()).toBeNull();
    expect(document.body.textContent).not.toContain('Chave de serviço');
  });

  it('E02: the first "Continuar" that learns the access is manual reveals the block and stays', async () => {
    harness.validate.mockResolvedValue(manual());
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());
    expect(harness.router.push).not.toHaveBeenCalled();
    expect(draft.draft.dataReady).toBe(false);
    expect(draft.draft.manualAccess).toBe(true);
    // Revealed, not scolded: no "Cole …" yet. The first field takes the focus.
    expect(alerts()).toEqual([]);
    expect(document.activeElement).toBe(secretField('databasePassword'));
    expect(block()?.firstElementChild?.textContent).toContain(
      'Não conseguimos obter o acesso a este projeto sozinhos.',
    );
  });

  it('E02 empty: with the block on screen each empty field shows its own error and the step stays closed', async () => {
    harness.validate.mockResolvedValue(manual());
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());
    await submit();
    await waitFor(() =>
      expect(alerts()).toEqual([
        'Cole a senha do banco.',
        'Cole a chave de serviço.',
        'Cole a chave publicável.',
      ]),
    );
    expect(harness.router.push).not.toHaveBeenCalled();
    expect(draft.draft.dataReady).toBe(false);
  });

  it('E02 partial: any one of the three missing blocks "Continuar" with that field’s error', async () => {
    harness.validate.mockResolvedValue(manual());
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());

    fill({ databasePassword: SECRETS.databasePassword, serviceKey: SECRETS.serviceKey });
    await submit();
    await waitFor(() => expect(alerts()).toEqual(['Cole a chave publicável.']));
    expect(harness.router.push).not.toHaveBeenCalled();

    fill({ publishableKey: SECRETS.publishableKey });
    expect(alerts()).toEqual([]);
    await submit();
    await waitFor(() => expect(harness.router.push).toHaveBeenCalledWith('/plataforma/novo/marca'));
    expect(draft.draft.dataReady).toBe(true);
  });

  it('E02: all three values sit in the draft’s memory and never reach the session mirror', async () => {
    harness.validate.mockResolvedValue(manual());
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());
    fill(SECRETS);
    expect(draft.access).toEqual(SECRETS);
    await submit();
    await waitFor(() => expect(harness.router.push).toHaveBeenCalled());
    for (const secret of Object.values(SECRETS)) expect(mirror()).not.toContain(secret);
    expect(JSON.parse(mirror()).manualAccess).toBe(true);
  });

  it('E02: the Dados action is never handed a secret', async () => {
    harness.validate.mockResolvedValue(manual());
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());
    fill(SECRETS);
    await submit();
    await waitFor(() => expect(harness.router.push).toHaveBeenCalled());
    for (const [arg] of harness.validate.mock.calls) {
      expect(JSON.stringify(arg)).not.toContain('s3cr3t');
      expect(arg).not.toHaveProperty('access');
    }
  });

  it('E02: a reload keeps the ref and the manual flag but asks for the three values again', async () => {
    harness.validate.mockResolvedValue(manual());
    const first = mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());
    fill(SECRETS);
    first.unmount();

    mount();
    expect(field().value).toBe(REF);
    expect(block()).not.toBeNull();
    expect(secretField('databasePassword').value).toBe('');
    expect(secretField('serviceKey').value).toBe('');
    expect(secretField('publishableKey').value).toBe('');
    expect(document.body.innerHTML).not.toContain('s3cr3t');
  });

  it('E02: editing the ref takes the block away and forgets what was pasted', async () => {
    harness.validate.mockResolvedValue(manual());
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());
    fill(SECRETS);
    type(`${REF.slice(0, 19)}z`);
    expect(block()).toBeNull();
    expect(draft.draft.manualAccess).toBe(false);
    expect(draft.access).toEqual({ databasePassword: '', serviceKey: '', publishableKey: '' });
  });

  it('E02: a later pre-check that no longer asks for the access drops the block and the values', async () => {
    harness.validate.mockResolvedValue(manual());
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());
    fill(SECRETS);
    harness.validate.mockResolvedValue(ok());
    await submit();
    await waitFor(() => expect(harness.router.push).toHaveBeenCalled());
    expect(block()).toBeNull();
    expect(draft.access).toEqual({ databasePassword: '', serviceKey: '', publishableKey: '' });
    expect(draft.draft.manualAccess).toBe(false);
  });

  it('E02 loading: the fields share the pending state of "Continuar"', async () => {
    harness.validate.mockResolvedValue(manual());
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());
    fill(SECRETS);
    let release: (value: DraftValidation) => void = () => {};
    harness.validate.mockReturnValue(
      new Promise<DraftValidation>((resolve) => {
        release = resolve;
      }),
    );
    await submit();
    expect(secretField('serviceKey').disabled).toBe(true);
    await act(async () => release(manual()));
    expect(secretField('serviceKey').disabled).toBe(false);
  });

  it('E02 error: a refusal from the project shows its sentence above the block and persists nothing', async () => {
    harness.validate.mockResolvedValue(manual());
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());
    // What the confirmation hands back when the project refuses the values (the dialog's `fixData`).
    act(() => draft.update({ fieldErrors: { access: 'accessInvalid' }, dataReady: false }));
    expect(alerts()).toEqual([
      'Não foi possível entrar no projeto com estes dados. Confira e tente de novo.',
    ]);
    for (const secret of Object.values(SECRETS)) expect(mirror()).not.toContain(secret);
    // Typing in a field clears that block-level error.
    fill({ serviceKey: 'x' });
    expect(alerts()).toEqual([]);
  });

  it('E02 long-text: a long pasted key scrolls inside its password input', async () => {
    harness.validate.mockResolvedValue(manual());
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(block()).not.toBeNull());
    const long = 'k'.repeat(2000);
    fill({ serviceKey: long });
    expect(secretField('serviceKey').value).toBe(long);
    expect(secretField('serviceKey').type).toBe('password');
    expect(document.body.textContent).not.toContain('kkkkkkkk');
  });
});

/**
 * 09.4-15 Task 1 (D-566 journey 1, UI-D-549, UI-D-550, A-UI-1, A-UI-2, CTK-31, CTK-32): the owner choice
 * and the customer's token. The platform choice is today's flow; the customer choice adds the write-only
 * token and the optional expiry, sent ONCE with the pre-check, held in the draft provider's memory.
 */
describe('Dados — the project owner and the customer token', () => {
  const TOKEN = 'sbp_s3cr3t-token-0001';
  const DATE = '2027-03-01';
  const owner = (name: string) =>
    Array.from(document.querySelectorAll('button[aria-pressed]')).find(
      (button) => button.textContent?.trim() === name,
    ) as HTMLButtonElement;
  const tokenField = () => document.getElementById('projectToken') as HTMLInputElement | null;
  const dateField = () =>
    document.getElementById('projectTokenExpiresAt') as HTMLInputElement | null;
  const chooseCustomer = () => fireEvent.click(owner('Projeto do cliente'));
  const fillToken = (value: string) =>
    fireEvent.change(tokenField() as HTMLInputElement, { target: { value } });
  const fillDate = (value: string) =>
    fireEvent.change(dateField() as HTMLInputElement, { target: { value } });
  const tokenRefused = (key: string): DraftValidation =>
    ({ ok: false, fieldErrors: { token: key } }) as DraftValidation;

  it('1. the platform is pressed by default and the customer fields are absent from the DOM', () => {
    mount();
    expect(document.body.textContent).toContain('Onde fica o projeto?');
    expect(owner('Projeto da plataforma').getAttribute('aria-pressed')).toBe('true');
    expect(owner('Projeto do cliente').getAttribute('aria-pressed')).toBe('false');
    expect(tokenField()).toBeNull();
    expect(dateField()).toBeNull();
    expect(document.querySelector('[data-token-howto]')).toBeNull();
    expect(draft.draft.owner).toBe('platform');
  });

  it('1. pressing the customer shows the token, the date and the OPEN how-to, and swaps the helper', () => {
    mount();
    chooseCustomer();
    expect(owner('Projeto do cliente').getAttribute('aria-pressed')).toBe('true');
    expect(owner('Projeto da plataforma').getAttribute('aria-pressed')).toBe('false');
    const token = tokenField() as HTMLInputElement;
    expect(token.type).toBe('password');
    expect(token.maxLength).toBe(4096);
    expect(token.hasAttribute('name')).toBe(false);
    expect(dateField()?.type).toBe('date');
    const howto = document.querySelector('[data-token-howto]');
    expect(howto).not.toBeNull();
    expect(howto?.closest('details')).toBeNull();
    const text = document.body.textContent ?? '';
    expect(text).toContain('O projeto fica na conta do Supabase do cliente');
    expect(text).not.toContain('Crie um projeto vazio na organização da plataforma');
    expect(draft.draft.owner).toBe('customer');
  });

  it('2. E02 empty: an empty token shows the required error under the token and sends NO request', async () => {
    mount();
    chooseCustomer();
    type(REF);
    await submit();
    await waitFor(() => expect(alerts()).toContain(E.tokenRequired));
    expect(harness.validate).not.toHaveBeenCalled();
    expect(tokenField()?.getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(draft.draft.dataReady).toBe(false);
    expect(harness.router.push).not.toHaveBeenCalled();
  });

  it('2. E02 partial: a missing token and a missing ref show both errors and still send nothing', async () => {
    mount();
    chooseCustomer();
    await submit();
    await waitFor(() => expect(alerts()).toContain(E.tokenRequired));
    expect(alerts()).toContain(E.projectRefRequired);
    expect(harness.validate).not.toHaveBeenCalled();
  });

  it('2. with a token, "Continuar" calls the action ONCE with owner, token and date, and opens the next step', async () => {
    mount();
    chooseCustomer();
    type(REF);
    fillToken(TOKEN);
    fillDate(DATE);
    await submit();
    await waitFor(() => expect(harness.router.push).toHaveBeenCalledWith('/plataforma/novo/marca'));
    expect(harness.validate).toHaveBeenCalledTimes(1);
    expect(harness.validate.mock.calls[0]?.[0]).toMatchObject({
      projectRef: REF,
      owner: 'customer',
      token: TOKEN,
      tokenExpiresAt: DATE,
    });
    expect(draft.draft.dataReady).toBe(true);
    // The token stays in memory for the creation; it is not in the persisted draft.
    expect(draft.token).toBe(TOKEN);
  });

  it('2. E02 partial: an empty date is valid (optional)', async () => {
    mount();
    chooseCustomer();
    type(REF);
    fillToken(TOKEN);
    await submit();
    await waitFor(() => expect(harness.router.push).toHaveBeenCalled());
    expect(harness.validate.mock.calls[0]?.[0]).toMatchObject({ owner: 'customer', token: TOKEN });
  });

  it('2. the platform choice sends no new request field', async () => {
    mount();
    type(REF);
    await submit();
    await waitFor(() => expect(harness.router.push).toHaveBeenCalled());
    const sent = harness.validate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('owner');
    expect(sent).not.toHaveProperty('token');
    expect(sent).not.toHaveProperty('tokenExpiresAt');
  });

  it.each([
    ['tokenInvalid', 'token'],
    ['tokenForbidden', 'token'],
    ['tokenOtherProject', 'token'],
    ['tokenAccountWide', 'token'],
  ])('3. E02 error: %s reads its catalog sentence under the token field', async (key, _where) => {
    harness.validate.mockResolvedValue(tokenRefused(key));
    mount();
    chooseCustomer();
    type(REF);
    fillToken(TOKEN);
    await submit();
    await waitFor(() => expect(alerts()).toContain(E[key]));
    expect((E[key] ?? '').length).toBeGreaterThan(10);
    expect(tokenField()?.getAttribute('aria-invalid')).toBe('true');
    expect(dateField()?.getAttribute('aria-invalid')).toBeNull();
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(draft.draft.dataReady).toBe(false);
    expect(harness.router.push).not.toHaveBeenCalled();
  });

  it('3. the date error renders under the date field, not the token', async () => {
    harness.validate.mockResolvedValue({
      ok: false,
      fieldErrors: { tokenExpiresAt: 'tokenExpiryInvalid' },
    } as DraftValidation);
    mount();
    chooseCustomer();
    type(REF);
    fillToken(TOKEN);
    fillDate(DATE);
    await submit();
    await waitFor(() => expect(alerts()).toContain(E.tokenExpiryInvalid));
    expect(dateField()?.getAttribute('aria-invalid')).toBe('true');
    expect(tokenField()?.getAttribute('aria-invalid')).toBeNull();
  });

  it.each(['projectNotFoundCustomer', 'projectNotPro'])(
    '3. the customer ref error %s renders under the ref',
    async (key) => {
      harness.validate.mockResolvedValue(refused(key));
      mount();
      chooseCustomer();
      type(REF);
      fillToken(TOKEN);
      await submit();
      await waitFor(() => expect(alerts()).toContain(E[key]));
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(tokenField()?.getAttribute('aria-invalid')).toBeNull();
    },
  );

  it('3. editing a field clears only that field’s error and closes the later steps', async () => {
    harness.validate.mockResolvedValue({
      ok: false,
      fieldErrors: { token: 'tokenInvalid', tokenExpiresAt: 'tokenExpiryInvalid' },
    } as DraftValidation);
    mount();
    chooseCustomer();
    type(REF);
    fillToken(TOKEN);
    fillDate(DATE);
    await submit();
    await waitFor(() => expect(alerts()).toContain(E.tokenInvalid));
    act(() => draft.update({ dataReady: true }));
    fillToken(`${TOKEN}x`);
    expect(alerts()).not.toContain(E.tokenInvalid);
    expect(alerts()).toContain(E.tokenExpiryInvalid);
    expect(draft.draft.dataReady).toBe(false);
    fillDate('2027-04-01');
    expect(alerts()).not.toContain(E.tokenExpiryInvalid);
  });

  it('4. E01: switching owner clears the token, the date, the errors and the manual access, keeps the ref', async () => {
    harness.validate.mockResolvedValue({
      ok: false,
      fieldErrors: { token: 'tokenInvalid' },
      manualAccess: true,
    } as DraftValidation);
    mount();
    chooseCustomer();
    type(REF);
    fillToken(TOKEN);
    fillDate(DATE);
    await submit();
    await waitFor(() => expect(alerts()).toContain(E.tokenInvalid));
    expect(draft.draft.manualAccess).toBe(true);
    act(() => draft.update({ dataReady: true }));

    fireEvent.click(owner('Projeto da plataforma'));
    expect(draft.draft.owner).toBe('platform');
    expect(draft.token).toBe('');
    expect(draft.draft.tokenExpiresAt).toBe('');
    expect(draft.draft.fieldErrors).toEqual({});
    expect(draft.draft.manualAccess).toBe(false);
    expect(draft.draft.dataReady).toBe(false);
    expect(field().value).toBe(REF);
    expect(tokenField()).toBeNull();

    // And back: the fields are empty again.
    chooseCustomer();
    expect((tokenField() as HTMLInputElement).value).toBe('');
    expect((dateField() as HTMLInputElement).value).toBe('');
  });

  it('4. E01 loading: the control and both fields are disabled while "Continuar" is pending', async () => {
    let release: (value: DraftValidation) => void = () => {};
    harness.validate.mockReturnValue(
      new Promise<DraftValidation>((resolve) => {
        release = resolve;
      }),
    );
    mount();
    chooseCustomer();
    type(REF);
    fillToken(TOKEN);
    await submit();
    expect(owner('Projeto do cliente').disabled).toBe(true);
    expect(owner('Projeto da plataforma').disabled).toBe(true);
    expect(tokenField()?.disabled).toBe(true);
    expect(dateField()?.disabled).toBe(true);
    await act(async () => release(ok()));
    expect(owner('Projeto do cliente').disabled).toBe(false);
    expect(tokenField()?.disabled).toBe(false);
  });

  it('every token sentence the form can show exists in the catalog', () => {
    for (const key of [
      'tokenRequired',
      'tokenInvalid',
      'tokenForbidden',
      'tokenOtherProject',
      'tokenAccountWide',
      'tokenExpiryInvalid',
      'projectNotFoundCustomer',
      'projectNotPro',
    ]) {
      expect(typeof E[key]).toBe('string');
    }
  });
});
