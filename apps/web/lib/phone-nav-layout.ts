import {
  PHONE_MENU_BAR_ONLY,
  PHONE_MENU_NEVER_TOP,
  type PhoneMenu,
} from '@rede-social/contracts/branding';
import type { PhoneLayout } from '@rede-social/core/ui';

/**
 * The phone's menu as the tenant's administrator arranges it in Configurações › Menu do app (the
 * product owner: "personalizar hotbar do usuário selecionando quais itens ele quer que entre ali, a
 * ordem dos itens clicando segurando e arrastando, escolhendo se vai ter algum desses itens no header
 * do app", "somente no mobile"): the bottom bar's items in order, the items moved to the top beside
 * Notificações and the support chat, and the items hidden on the phone.
 *
 * 12.3-16 (D-695, D-697): since 12.3 the API keeps it, in the tenant's brand (`branding.phoneMenu`,
 * delivered by the bootstrap to every role). The per-device cookies that stood in for it
 * (the layout cookie and 2026-10-28's bar-order predecessor) are gone: nothing reads, writes or
 * imports them, and a value still set on an admin's device is simply ignored. The place rules (the bar
 * holds two to six, the top two extras at the most, Início stays in the bar, Perfil never goes to the
 * top) are the contract's own constants, `validatePhoneMenu` the server's check; the web redefines none.
 */

export type PhonePlacement = 'bar' | 'top' | 'hidden';

/**
 * The saved menu of a resolved brand as the shell's layout, or `null` for the shell's own menu (no
 * layout saved, or a stored value the contract reads as absent). The shell applies it to every member
 * on the next load (`withPhoneLayout`); an item it does not name keeps its own place after the named
 * ones and a key with no item (a module off) is ignored (`phoneChrome`).
 */
export function savedPhoneLayout(branding: { phoneMenu?: PhoneMenu }): PhoneLayout | null {
  const menu = branding.phoneMenu;
  return menu ? { bar: menu.bar, top: menu.top, hidden: menu.hidden } : null;
}

/** Whether an item may take a place: Início only the bar, Perfil never the top. */
export function placementAllowed(key: string, placement: PhonePlacement): boolean {
  if ((PHONE_MENU_BAR_ONLY as readonly string[]).includes(key)) return placement === 'bar';
  if (placement === 'top') return !(PHONE_MENU_NEVER_TOP as readonly string[]).includes(key);
  return true;
}
