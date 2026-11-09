import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 12.3-16 (D-697, UI-D-694): the menu editor's two server actions. A server action is a public
 * endpoint, so the SAME Zod and the SAME `validatePhoneMenu` the API runs gate the body BEFORE any
 * request; a refusal is a code the editor maps to copy (`rules` or `generic`), a navigation runs
 * outside any try/catch (Next 16: `redirect()` throws), and a save revalidates the shell.
 */

const mocks = vi.hoisted(() => ({
  savePhoneMenu: vi.fn(),
  clearPhoneMenu: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/phone-menu', () => ({
  savePhoneMenu: mocks.savePhoneMenu,
  clearPhoneMenu: mocks.clearPhoneMenu,
}));

const { clearPhoneMenuAction, savePhoneMenuAction } = await import('./actions');

const MENU = { bar: ['home', 'communities', 'profile'], top: ['events'], hidden: ['store'] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('savePhoneMenuAction', () => {
  it('sends the three lists, answers ok and revalidates the whole shell', async () => {
    mocks.savePhoneMenu.mockResolvedValue({ status: 'ok' });
    expect(await savePhoneMenuAction(MENU)).toEqual({ ok: true });
    expect(mocks.savePhoneMenu).toHaveBeenCalledWith(MENU);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('refuses a malformed body before any request: not an object, bad keys, a forged key, 17 keys', async () => {
    const seventeen = Array.from({ length: 17 }, (_, i) => `k${i}`);
    for (const bad of [
      'x',
      null,
      { bar: 'home' },
      { bar: ['Home'], top: [], hidden: [] },
      { ...MENU, tenantId: 'other' },
      { bar: ['home', 'a'], top: [], hidden: seventeen },
    ]) {
      expect(await savePhoneMenuAction(bad)).toEqual({ ok: false, code: 'generic' });
    }
    expect(mocks.savePhoneMenu).not.toHaveBeenCalled();
  });

  it('refuses a menu that breaks a rule before any request, with the rules code', async () => {
    for (const bad of [
      { bar: ['home'], top: [], hidden: [] },
      { bar: ['communities', 'events'], top: [], hidden: ['home'] },
      { bar: ['home', 'events'], top: ['profile'], hidden: [] },
      { bar: ['home', 'events'], top: ['events'], hidden: [] },
    ]) {
      expect(await savePhoneMenuAction(bad)).toEqual({ ok: false, code: 'rules' });
    }
    expect(mocks.savePhoneMenu).not.toHaveBeenCalled();
  });

  it("answers the API's rule refusal as rules and does not revalidate", async () => {
    mocks.savePhoneMenu.mockResolvedValue({ status: 'rules', issue: 'bar_too_large' });
    expect(await savePhoneMenuAction(MENU)).toEqual({ ok: false, code: 'rules' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('answers any other failure as generic, and navigates for a refusal the app knows', async () => {
    mocks.savePhoneMenu.mockResolvedValue({ status: 'error' });
    expect(await savePhoneMenuAction(MENU)).toEqual({ ok: false, code: 'generic' });
    mocks.savePhoneMenu.mockResolvedValue({ status: 'redirect', path: '/entrar' });
    await expect(savePhoneMenuAction(MENU)).rejects.toThrow('REDIRECT /entrar');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('clearPhoneMenuAction', () => {
  it('clears the saved menu, answers ok and revalidates the shell', async () => {
    mocks.clearPhoneMenu.mockResolvedValue({ status: 'ok' });
    expect(await clearPhoneMenuAction()).toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('answers a failure as generic and navigates for a known refusal', async () => {
    mocks.clearPhoneMenu.mockResolvedValue({ status: 'error' });
    expect(await clearPhoneMenuAction()).toEqual({ ok: false, code: 'generic' });
    mocks.clearPhoneMenu.mockResolvedValue({
      status: 'redirect',
      path: '/configuracoes?erro=sem-permissao',
    });
    await expect(clearPhoneMenuAction()).rejects.toThrow(
      'REDIRECT /configuracoes?erro=sem-permissao',
    );
  });
});
