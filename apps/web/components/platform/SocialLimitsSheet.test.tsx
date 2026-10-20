// @vitest-environment happy-dom
import { SOCIAL_SETTINGS_DEFAULTS } from '@rede-social/module-social/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveSocialLimitsResult } from '@/app/(platform)/plataforma/tenants/[id]/modulos/actions';

/**
 * 09-12 (UI-D-505 c, D-474, T-09-39) - the limits sheet of the `social` row.
 *
 * Claims:
 *  1. The button "Configurar limites" opens a sheet that shows the SAVED values (the defaults for an
 *     empty blob: 4 photos, 5 MB, video off) - no skeleton, no flash of empty fields.
 *  2. With "Permitir vídeo" off the duration and size fields are absent from the DOM and are not
 *     validated; turning it on reveals them with their saved values.
 *  3. An out-of-range or empty value shows "Informe um valor entre {min} e {max}." under its own
 *     field, the sheet stays open and the action is not called.
 *  4. A valid save calls the action once with the byte patch, toasts "Limites salvos." and closes.
 *  5. A failed save keeps the sheet open and shows the generic error toast.
 *  6. Saving shows "Salvando…" on the primary button.
 *
 * The catalog arrives as `labels` props (the component knows no language); these are the real
 * strings of the UI-SPEC Copywriting Contract.
 */

// The sheet animates in and out; a cancelled spring rejects AFTER the run ends under happy-dom.
MotionGlobalConfig.skipAnimations = true;

const toast = { show: vi.fn(), dismiss: vi.fn() };

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { SocialLimitsSheet } = await import('./SocialLimitsSheet');

const TENANT = '33333333-3333-4333-8333-333333333312';
const MIB = 1024 * 1024;

const labels = {
  open: 'Configurar limites',
  title: 'Limites de mídia dos membros',
  fields: {
    photos: 'Fotos por publicação',
    photoMb: 'Tamanho máximo da foto, em MB',
    allowVideo: 'Permitir vídeo',
    videoSeconds: 'Duração máxima do vídeo, em segundos',
    videoMb: 'Tamanho máximo do vídeo, em MB',
  },
  hint: 'De {min} a {max}. Padrão: {default}.',
  helper: 'Vale só para novos envios. O que já foi publicado não muda.',
  save: 'Salvar limites',
  saving: 'Salvando…',
  saved: 'Limites salvos.',
  range: 'Informe um valor entre {min} e {max}.',
  error: 'Algo deu errado. Tente novamente.',
};

const action = vi.fn<(tenantId: string, patch: unknown) => Promise<SaveSocialLimitsResult>>();

function mount(saved = SOCIAL_SETTINGS_DEFAULTS as Parameters<typeof SocialLimitsSheet>[0]['saved']) {
  return render(<SocialLimitsSheet tenantId={TENANT} saved={saved} labels={labels} action={action} />);
}

const open = () => fireEvent.click(screen.getByRole('button', { name: labels.open }));
const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const typeInto = (name: string, value: string) =>
  fireEvent.change(field(name), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: labels.save }));
const videoSwitch = () => screen.getByRole('switch', { name: labels.fields.allowVideo });

beforeEach(() => {
  action.mockReset();
  action.mockResolvedValue({ ok: true });
  toast.show.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('09-12 - SocialLimitsSheet: the fields', () => {
  it('is closed until the button is pressed, then shows the title and the saved defaults', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();

    open();
    expect(screen.getByRole('dialog', { name: labels.title })).toBeTruthy();
    expect(field(labels.fields.photos).value).toBe('4');
    expect(field(labels.fields.photoMb).value).toBe('5');
    expect(videoSwitch().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(labels.helper)).toBeTruthy();
  });

  it('each number field is numeric, with a hint that names its bounds and default', () => {
    mount();
    open();

    expect(field(labels.fields.photos).getAttribute('inputmode')).toBe('numeric');
    expect(field(labels.fields.photoMb).getAttribute('inputmode')).toBe('numeric');
    expect(screen.getByText('De 1 a 10. Padrão: 4.')).toBeTruthy();
    expect(screen.getByText('De 1 a 15. Padrão: 5.')).toBeTruthy();
  });

  it('with video off the duration and size fields are not in the DOM', () => {
    mount();
    open();

    expect(screen.queryByRole('textbox', { name: labels.fields.videoSeconds })).toBeNull();
    expect(screen.queryByRole('textbox', { name: labels.fields.videoMb })).toBeNull();
  });

  it('turning video on reveals the two fields with their saved values', () => {
    mount();
    open();
    fireEvent.click(videoSwitch());

    expect(field(labels.fields.videoSeconds).value).toBe('60');
    expect(field(labels.fields.videoMb).value).toBe('100');
  });

  it('shows a saved blob in the units of the labels', () => {
    mount({
      media: {
        photoMaxBytes: 1 * MIB,
        photosPerPost: 9,
        video: { enabled: true, maxDurationSeconds: 300, maxBytes: 500 * MIB },
      },
    });
    open();

    expect(field(labels.fields.photos).value).toBe('9');
    expect(field(labels.fields.photoMb).value).toBe('1');
    expect(videoSwitch().getAttribute('aria-checked')).toBe('true');
    expect(field(labels.fields.videoSeconds).value).toBe('300');
    expect(field(labels.fields.videoMb).value).toBe('500');
  });
});

describe('09-12 - SocialLimitsSheet: validation', () => {
  it('an out-of-range photo count shows the range error and keeps the sheet open without saving', () => {
    mount();
    open();
    typeInto(labels.fields.photos, '14');
    save();

    expect(screen.getByText('Informe um valor entre 1 e 10.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: labels.title })).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it('an empty and a fractional value are out of range too', () => {
    mount();
    open();
    typeInto(labels.fields.photoMb, '');
    typeInto(labels.fields.photos, '2.5');
    save();

    expect(screen.getByText('Informe um valor entre 1 e 15.')).toBeTruthy();
    expect(screen.getByText('Informe um valor entre 1 e 10.')).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it('each visible field carries its own error', () => {
    mount();
    open();
    fireEvent.click(videoSwitch());
    typeInto(labels.fields.videoSeconds, '0');
    typeInto(labels.fields.videoMb, '501');
    save();

    expect(screen.getByText('Informe um valor entre 1 e 300.')).toBeTruthy();
    expect(screen.getByText('Informe um valor entre 1 e 500.')).toBeTruthy();
    expect(field(labels.fields.videoSeconds).getAttribute('aria-invalid')).toBe('true');
    expect(field(labels.fields.photos).getAttribute('aria-invalid')).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });

  it('a bad video value does not block the save once video is switched back off', async () => {
    mount();
    open();
    fireEvent.click(videoSwitch());
    typeInto(labels.fields.videoSeconds, '999');
    fireEvent.click(videoSwitch());
    save();

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(TENANT, {
      media: { photosPerPost: 4, photoMaxBytes: 5 * MIB, video: { enabled: false } },
    });
  });
});

describe('09-12 - SocialLimitsSheet: saving', () => {
  it('a valid save sends the byte patch once, toasts and closes the sheet', async () => {
    mount();
    open();
    typeInto(labels.fields.photoMb, '1');
    save();

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(TENANT, {
      media: { photosPerPost: 4, photoMaxBytes: 1 * MIB, video: { enabled: false } },
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: labels.saved }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('with video on the patch carries the duration and the size in bytes', async () => {
    mount();
    open();
    fireEvent.click(videoSwitch());
    typeInto(labels.fields.videoSeconds, '90');
    typeInto(labels.fields.videoMb, '200');
    save();

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(TENANT, {
      media: {
        photosPerPost: 4,
        photoMaxBytes: 5 * MIB,
        video: { enabled: true, maxDurationSeconds: 90, maxBytes: 200 * MIB },
      },
    });
  });

  it('shows "Salvando…" on the primary button while the action runs', async () => {
    let finish: (r: SaveSocialLimitsResult) => void = () => {};
    action.mockReturnValue(new Promise<SaveSocialLimitsResult>((resolve) => (finish = resolve)));
    mount();
    open();
    save();

    const busy = await screen.findByRole('button', { name: labels.saving });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a failed save keeps the sheet open and shows the generic error toast', async () => {
    action.mockResolvedValue({ ok: false, code: 'HTTP_ERROR' });
    mount();
    open();
    save();

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: labels.error }),
    );
    expect(screen.getByRole('dialog', { name: labels.title })).toBeTruthy();
    expect(toast.show).not.toHaveBeenCalledWith({ tone: 'success', message: labels.saved });
  });
});
