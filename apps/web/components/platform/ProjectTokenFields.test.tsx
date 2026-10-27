// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectTokenFields, type ProjectTokenValues } from './ProjectTokenFields';

/**
 * 09.4-14 Task 2 (UI-D-550, CTK-32 field half, T-09.4-50) - the write-only token and expiry fields,
 * props-only and shared by the wizard and the "Substituir token" sheet. Real: the component and the
 * REAL pt-BR catalog (a missing key throws). Claims a later edit could quietly break:
 *
 *  1. The token input is `type="password"`, `id="projectToken"`, `autocomplete="off"`, no `name`,
 *     `spellcheck="false"`, `data-1p-ignore`, `maxLength` 4096 (the cap the access bodies use; scoped
 *     tokens are JWT-shaped, so UI-D-550's 256 would silently truncate a real token).
 *  2. The expiry is `type="date"`, `id="projectTokenExpiresAt"`, `min` tomorrow, `max` one year out,
 *     both computed from the `today` prop (YYYY-MM-DD).
 *  3. No show/hide control; the component never displays the token, a prefix or a length.
 *  4. Errors arrive already translated and render under their own field with role="alert".
 *  5. Typing reports the NEW pair; `disabled` locks both.
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

const EMPTY: ProjectTokenValues = { token: '', expiresAt: '' };

function mount(props: Partial<Parameters<typeof ProjectTokenFields>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <ProjectTokenFields values={EMPTY} onChange={onChange} today="2026-10-27" {...props} />,
  );
  return { onChange, ...view };
}

const token = () => document.getElementById('projectToken') as HTMLInputElement;
const expiry = () => document.getElementById('projectTokenExpiresAt') as HTMLInputElement;

afterEach(cleanup);

describe('ProjectTokenFields', () => {
  it('1. the token input is write-only: password, no autofill, no name, 4096 cap', () => {
    mount();
    const input = token();
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.hasAttribute('data-1p-ignore')).toBe(true);
    expect(input.hasAttribute('name')).toBe(false);
    expect(input.maxLength).toBe(4096);
    expect(document.querySelector('label[for="projectToken"]')?.textContent).toBe(
      'Token de acesso do projeto',
    );
  });

  it('2. the expiry is a date input between tomorrow and one year from today', () => {
    mount();
    const input = expiry();
    expect(input.type).toBe('date');
    expect(input.getAttribute('min')).toBe('2026-10-28');
    expect(input.getAttribute('max')).toBe('2027-10-27');
    expect(input.hasAttribute('name')).toBe(false);
    expect(document.querySelector('label[for="projectTokenExpiresAt"]')?.textContent).toBe(
      'Vence em (opcional)',
    );
  });

  it('2. the bounds follow the today prop, across a month, a year and a leap day', () => {
    mount({ today: '2026-12-31' });
    expect(expiry().getAttribute('min')).toBe('2027-01-01');
    expect(expiry().getAttribute('max')).toBe('2027-12-31');
    cleanup();
    mount({ today: '2027-02-28' });
    expect(expiry().getAttribute('min')).toBe('2027-03-01');
    cleanup();
    mount({ today: '2028-02-29' });
    expect(expiry().getAttribute('max')).toBe('2029-02-28');
  });

  it('2. shows the two helpers from the wizard catalog', () => {
    mount();
    const helpers = Array.from(document.querySelectorAll('p')).map((p) => p.textContent);
    expect(helpers).toContain('Fica guardado com segurança e não pode ser lido depois.');
    expect(helpers).toContain(
      'A data escolhida ao criar o token. Com ela, o painel avisa antes de vencer.',
    );
  });

  it('3. has no show/hide control and never displays the token, a prefix or a length', () => {
    const secret = `sbp_fc_${'a'.repeat(5000)}`;
    mount({ values: { token: secret, expiresAt: '' } });
    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(document.querySelector('[aria-pressed]')).toBeNull();
    expect(document.querySelector('input[type="text"]')).toBeNull();
    expect(document.body.textContent).not.toContain('sbp_fc');
    expect(document.body.textContent).not.toContain('5007');
    expect(token().type).toBe('password');
  });

  it('4. shows an error under its own field with role="alert", and none otherwise', () => {
    mount({ errors: { token: 'Cole o token de acesso do projeto.', expiresAt: 'Data ruim.' } });
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map(
      (n) => n.textContent,
    );
    expect(alerts).toEqual(['Cole o token de acesso do projeto.', 'Data ruim.']);
    expect(token().getAttribute('aria-describedby')).toBe('projectToken-error');
    expect(expiry().getAttribute('aria-describedby')).toBe('projectTokenExpiresAt-error');
    cleanup();
    mount();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(token().hasAttribute('aria-invalid')).toBe(false);
  });

  it('4. an error on one field leaves the other without an alert', () => {
    mount({ errors: { expiresAt: 'Data ruim.' } });
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(token().hasAttribute('aria-invalid')).toBe(false);
    expect(expiry().getAttribute('aria-invalid')).toBe('true');
  });

  it('5. typing reports the new pair, each edit keeping the other field', () => {
    const { onChange } = mount({ values: { token: '', expiresAt: '2027-01-01' } });
    fireEvent.change(token(), { target: { value: 'novo' } });
    expect(onChange).toHaveBeenLastCalledWith({ token: 'novo', expiresAt: '2027-01-01' });
    fireEvent.change(expiry(), { target: { value: '2027-02-02' } });
    expect(onChange).toHaveBeenLastCalledWith({ token: '', expiresAt: '2027-02-02' });
  });

  it('5. disabled locks both fields', () => {
    mount({ disabled: true });
    expect(token().disabled).toBe(true);
    expect(expiry().disabled).toBe(true);
  });

  it('5. renders exactly what it is given: a cleared value is an empty field', () => {
    mount({ values: { token: 'segredo', expiresAt: '' } });
    expect(token().value).toBe('segredo');
    cleanup();
    mount();
    expect(token().value).toBe('');
    expect(document.body.innerHTML).not.toContain('segredo');
  });
});
