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
      'Não encontramos este projeto. Confira o código e se ele está na organização da plataforma.',
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
