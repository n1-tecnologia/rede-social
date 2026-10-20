// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetModuleResult } from '@/app/(platform)/plataforma/tenants/[id]/modulos/actions';
import type { ModuleRowExtras, ModuleRowView } from './ModuleToggles';

/**
 * 09-12 (UI-D-505 a-b, D-478, D-482) - the extras `ModuleToggles` gained for the `social` row: the
 * requires note with a disabled switch, the enable confirmation, and a trailing control. The
 * component stays list-agnostic (T-02-97): every extra arrives as a prop, so these cases drive it
 * with an arbitrary key and strings of their own.
 *
 * Claims:
 *  1. A row with `confirmEnable` does not call the action when switched on: the dialog opens;
 *     confirming calls it once with (tenantId, key, true); cancelling leaves the switch off and
 *     calls nothing.
 *  2. Switching that row OFF calls the action at once, with no dialog.
 *  3. A row with `disabled` renders its switch disabled with the note, and calls nothing.
 *  4. A row with no extras renders and behaves as before.
 *  5. A `trailing` node renders inside its row.
 */

// The dialog animates in and out; a cancelled spring rejects AFTER the run ends under happy-dom.
MotionGlobalConfig.skipAnimations = true;

const toast = { show: vi.fn(), dismiss: vi.fn() };

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { ModuleToggles } = await import('./ModuleToggles');

const TENANT = '33333333-3333-4333-8333-333333333312';

const labels = {
  helper: 'Ajuda',
  enabled: 'Ativado',
  disabled: 'Desativado',
  toggle: 'Ativar ou desativar {module}',
  saved: 'Alterações salvas.',
  error: 'Algo deu errado. Tente novamente.',
};

const confirmEnable: NonNullable<ModuleRowExtras['confirmEnable']> = {
  title: 'Ativar a Rede social em Rede Demo?',
  body: 'Revise os termos antes de ativar.',
  confirm: 'Ativar Rede social',
  cancel: 'Cancelar',
};

function rows(socialEnabled: boolean): ModuleRowView[] {
  return [
    { key: 'feed', name: 'Feed', description: 'Publicações', enabled: true },
    { key: 'social', name: 'Rede social', description: 'Membros seguem', enabled: socialEnabled },
  ];
}

const action =
  vi.fn<(tenantId: string, key: string, enabled: boolean) => Promise<SetModuleResult>>();

function mount(socialEnabled: boolean, extras?: Record<string, ModuleRowExtras>) {
  return render(
    <ModuleToggles
      tenantId={TENANT}
      rows={rows(socialEnabled)}
      labels={labels}
      action={action}
      extras={extras}
    />,
  );
}

const socialSwitch = () => screen.getByRole('switch', { name: 'Ativar ou desativar Rede social' });

beforeEach(() => {
  action.mockReset();
  action.mockResolvedValue({ ok: true });
  toast.show.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('09-12 - ModuleToggles: the enable confirmation', () => {
  it('opens the dialog instead of calling the action when a confirmEnable row is switched on', () => {
    mount(false, { social: { confirmEnable } });
    fireEvent.click(socialSwitch());

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: confirmEnable.title })).toBeTruthy();
    expect(screen.getByText(confirmEnable.body)).toBeTruthy();
  });

  it('confirming calls the action once with (tenantId, key, true) and toasts the saved message', async () => {
    mount(false, { social: { confirmEnable } });
    fireEvent.click(socialSwitch());
    fireEvent.click(screen.getByRole('button', { name: confirmEnable.confirm }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(TENANT, 'social', true);
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: labels.saved }),
    );
  });

  it('cancelling closes the dialog, leaves the switch off and calls nothing', async () => {
    mount(false, { social: { confirmEnable } });
    fireEvent.click(socialSwitch());
    fireEvent.click(screen.getByRole('button', { name: confirmEnable.cancel }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(action).not.toHaveBeenCalled();
    expect(socialSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('switching the row OFF calls the action at once, with no dialog', async () => {
    mount(true, { social: { confirmEnable } });
    fireEvent.click(socialSwitch());

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(action).toHaveBeenCalledWith(TENANT, 'social', false));
  });

  it('a row without confirmEnable calls the action at once, as before', async () => {
    mount(false);
    fireEvent.click(socialSwitch());

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(action).toHaveBeenCalledWith(TENANT, 'social', true));
  });
});

describe('09-12 - ModuleToggles: the requires note and the trailing control', () => {
  it('a disabled row shows its note, a disabled switch and calls nothing', () => {
    mount(false, { social: { disabled: true, note: 'Ative Feed para usar a Rede social.' } });

    expect(screen.getByText('Ative Feed para usar a Rede social.')).toBeTruthy();
    const sw = socialSwitch() as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(sw);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });

  it('a row with no extras renders no note and an enabled switch', () => {
    mount(false);

    const sw = socialSwitch() as HTMLButtonElement;
    expect(sw.disabled).toBe(false);
    expect(sw.getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('Ative Feed para usar a Rede social.')).toBeNull();
  });

  it('renders the trailing node inside its own row only', () => {
    mount(true, { social: { trailing: <button type="button">Configurar limites</button> } });

    const row = socialSwitch().closest('li');
    expect(row?.textContent).toContain('Configurar limites');
    expect(screen.getAllByRole('button', { name: 'Configurar limites' })).toHaveLength(1);
  });
});
