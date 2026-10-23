// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectAccessFields, type ProjectAccessValues } from './ProjectAccessFields';

/**
 * The three write-only fields of a project's manual access (09.2-18, UI-D-534, D-539, PR-4a). Real:
 * the component and the REAL pt-BR catalog through next-intl's own translator (a missing key throws).
 * The claims a later edit could quietly break:
 *
 *  1. Three `type="password"` fields with the documented labels, helper and attributes
 *     (`autoComplete="off"`, `spellCheck={false}`, `data-1p-ignore`) and NO `name` a password
 *     manager could recognise.
 *  2. No show/hide control, no text input: a secret is never displayed.
 *  3. The info row shows only with `requireAll` (the wizard); the replace sheet brings its own intro.
 *  4. The errors it is given appear under their field (`role="alert"`), and a block-level one on top.
 *  5. It renders exactly what it is given: a cleared value is an empty field and the old one is
 *     nowhere in the markup; a long key stays inside its input.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
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

const EMPTY: ProjectAccessValues = { databasePassword: '', serviceKey: '', publishableKey: '' };

function mount(props: Partial<Parameters<typeof ProjectAccessFields>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <ProjectAccessFields values={EMPTY} onChange={onChange} errors={{}} requireAll {...props} />,
  );
  return { onChange, ...view };
}

const inputs = () => Array.from(document.querySelectorAll('input'));

afterEach(cleanup);

describe('ProjectAccessFields', () => {
  it('1. renders the three password fields with the documented labels and helper', () => {
    mount();
    expect(inputs()).toHaveLength(3);
    expect(Array.from(document.querySelectorAll('label')).map((l) => l.textContent)).toEqual([
      'Senha do banco (usuário postgres)',
      'Chave de serviço (service_role)',
      'Chave publicável',
    ]);
    const helpers = Array.from(document.querySelectorAll('p')).filter(
      (p) => p.textContent === 'Fica guardado com segurança e não pode ser lido depois.',
    );
    expect(helpers).toHaveLength(3);
    for (const helper of helpers) {
      expect(helper.className).toContain('text-xs');
      expect(helper.className).toContain('text-text-tertiary');
    }
  });

  it('1. every field is write-only: password type, no autofill, no spellcheck, no recognisable name', () => {
    mount();
    for (const input of inputs()) {
      expect(input.type).toBe('password');
      expect(input.getAttribute('autocomplete')).toBe('off');
      expect(input.getAttribute('spellcheck')).toBe('false');
      expect(input.hasAttribute('data-1p-ignore')).toBe(true);
      expect(input.hasAttribute('name')).toBe(false);
    }
  });

  it('2. has no show/hide control and no text input', () => {
    mount();
    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(document.querySelector('input[type="text"]')).toBeNull();
    expect(document.querySelector('[aria-pressed]')).toBeNull();
  });

  it('3. requireAll shows the info row (KeyRound 16, 12/400) and false leaves it to the caller', () => {
    const { unmount } = mount({ requireAll: true });
    const row = document.querySelector('[data-project-access] > div') as HTMLElement;
    expect(row.textContent).toBe(
      'Não conseguimos obter o acesso a este projeto sozinhos. Cole os dados abaixo, do painel do Supabase (Configurações do projeto).',
    );
    expect(row.className).toContain('bg-bg-tertiary');
    expect(row.querySelector('svg')?.getAttribute('width')).toBe('16');
    expect(row.querySelector('p')?.className).toContain('text-xs');
    unmount();

    mount({ requireAll: false });
    expect(document.body.textContent).not.toContain('Não conseguimos obter o acesso');
    expect(inputs()).toHaveLength(3);
  });

  it('4. shows the four documented errors, each under its own field', () => {
    mount({
      errors: {
        databasePassword: 'Cole a senha do banco.',
        serviceKey: 'Cole a chave de serviço.',
        publishableKey: 'Cole a chave publicável.',
        form: 'Não foi possível entrar no projeto com estes dados. Confira e tente de novo.',
      },
    });
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map(
      (n) => n.textContent,
    );
    expect(alerts).toEqual([
      'Não foi possível entrar no projeto com estes dados. Confira e tente de novo.',
      'Cole a senha do banco.',
      'Cole a chave de serviço.',
      'Cole a chave publicável.',
    ]);
    expect(inputs().every((input) => input.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect(document.getElementById('access-serviceKey')?.getAttribute('aria-describedby')).toBe(
      'access-serviceKey-error',
    );
  });

  it('4. shows no alert when nothing is wrong', () => {
    mount();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(inputs().every((input) => !input.hasAttribute('aria-invalid'))).toBe(true);
  });

  it('5. reports each edit with the field it belongs to', () => {
    const { onChange } = mount();
    fireEvent.change(document.getElementById('access-serviceKey') as HTMLInputElement, {
      target: { value: 'k' },
    });
    fireEvent.change(document.getElementById('access-databasePassword') as HTMLInputElement, {
      target: { value: 'p' },
    });
    fireEvent.change(document.getElementById('access-publishableKey') as HTMLInputElement, {
      target: { value: 'q' },
    });
    expect(onChange.mock.calls).toEqual([
      [{ serviceKey: 'k' }],
      [{ databasePassword: 'p' }],
      [{ publishableKey: 'q' }],
    ]);
  });

  it('5. never renders a value back once the caller cleared it', () => {
    const secrets = {
      databasePassword: 'pw-s3cr3t',
      serviceKey: 'svc-s3cr3t',
      publishableKey: 'pub-s3cr3t',
    };
    const onChange = vi.fn();
    const view = render(
      <ProjectAccessFields values={secrets} onChange={onChange} errors={{}} requireAll />,
    );
    expect(inputs().map((input) => input.value)).toEqual(Object.values(secrets));
    // Not as text either: a value lives in its field and nowhere else.
    expect(document.body.textContent).not.toContain('s3cr3t');

    view.rerender(
      <ProjectAccessFields values={EMPTY} onChange={onChange} errors={{}} requireAll />,
    );
    expect(inputs().map((input) => input.value)).toEqual(['', '', '']);
    expect(view.container.innerHTML).not.toContain('s3cr3t');
  });

  it('5. a long key stays in its password input, never wrapped or shown', () => {
    const long = 'k'.repeat(1500);
    render(
      <ProjectAccessFields
        values={{ ...EMPTY, serviceKey: long }}
        onChange={vi.fn()}
        errors={{}}
        requireAll
      />,
    );
    const input = document.getElementById('access-serviceKey') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe(long);
    expect(document.body.textContent).not.toContain('kkkkk');
    expect(input.className).toContain('min-w-0');
  });

  it('disables the three fields while the caller is busy', () => {
    mount({ disabled: true });
    expect(inputs().every((input) => input.disabled)).toBe(true);
  });

  it('takes the caller’s spacing on the root (the wizard puts mt-4 there)', () => {
    mount({ className: 'mt-4' });
    const root = document.querySelector('[data-project-access]') as HTMLElement;
    expect(root.className).toContain('mt-4');
    expect(root.className).toContain('flex flex-col gap-4');
  });
});
