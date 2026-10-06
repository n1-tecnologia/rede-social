// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-05 — two logos in the wizard: the light mode's (the one the tenant is created with) and
 * the dark mode's own, optional and PREVIEW ONLY, then the square icon. The real catalog, a stub
 * draft whose `setImage` is spied.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return {
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    value: null as unknown,
  };
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

vi.mock('./TenantDraftProvider', () => ({ useTenantDraft: () => harness.value }));

const { WizardBrandPicker } = await import('./WizardBrandPicker');

type DarkCopy = { title: string; upload: string; hint: string; alt: string };
const W = (
  harness.messages.platform as unknown as {
    wizard: { brand: { logoLight: { title: string }; logoDark: DarkCopy } };
  }
).wizard.brand;

const image = (name: string) => ({
  file: new File(['x'], name, { type: 'image/png' }),
  url: `blob:${name}`,
});

function stage(images: { logo?: boolean; logoDark?: boolean } = {}) {
  const setImage = vi.fn();
  harness.value = {
    draft: { displayName: 'Clube Aurora' },
    logo: images.logo ? image('claro.png') : null,
    logoDark: images.logoDark ? image('escuro.png') : null,
    icon: null,
    setImage,
  };
  render(<WizardBrandPicker />);
  return setImage;
}

const picker = (kind: string) =>
  document.querySelector(`[data-wizard-image="${kind}"]`) as HTMLElement;

afterEach(cleanup);

describe('WizardBrandPicker — a logo per mode', () => {
  it('offers the light logo, the dark logo and the icon, in that order', () => {
    stage();
    const kinds = Array.from(document.querySelectorAll('[data-wizard-image]')).map((node) =>
      node.getAttribute('data-wizard-image'),
    );
    expect(kinds).toEqual(['logo', 'logoDark', 'icon']);
    expect(within(picker('logo')).getByText(W.logoLight.title)).toBeTruthy();
    expect(within(picker('logoDark')).getByText(W.logoDark.title)).toBeTruthy();
    expect(within(picker('logoDark')).getByText(W.logoDark.upload)).toBeTruthy();
    // Honest about it: the dark logo is not sent when the tenant is created.
    expect(within(picker('logoDark')).getByText(W.logoDark.hint)).toBeTruthy();
    expect(W.logoDark.hint).toContain('não é enviado');
  });

  it('a picked dark logo goes to the draft as the dark one, never as the logo', () => {
    const setImage = stage();
    const input = picker('logoDark').querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['png'], 'escuro.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(setImage).toHaveBeenCalledWith('logoDark', file);
    expect(setImage).not.toHaveBeenCalledWith('logo', expect.anything());
  });

  it('shows the dark logo on the dark ground and the light one on the light ground', () => {
    stage({ logo: true, logoDark: true });
    const dark = screen.getByAltText('Logo de Clube Aurora no modo escuro');
    expect(dark.getAttribute('src')).toBe('blob:escuro.png');
    expect(dark.closest('[data-theme]')?.getAttribute('data-theme')).toBe('dark');
    const light = within(picker('logo')).getByRole('img');
    expect(light.getAttribute('src')).toBe('blob:claro.png');
    expect(light.closest('[data-theme]')).toBeNull();
  });
});
