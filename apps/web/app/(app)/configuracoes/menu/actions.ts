'use server';

import { phoneMenuSchema, validatePhoneMenu } from '@rede-social/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clearPhoneMenu, type PhoneMenuOutcome, savePhoneMenu } from '@/lib/phone-menu';

/**
 * Configurações › Menu do app, saved through the API (12.3-16, D-697, UI-D-694). A server action is a
 * public endpoint, so the SAME Zod and the SAME `validatePhoneMenu` the API runs gate the body BEFORE
 * any request (the strict schema drops nothing and refuses a forged key; the rules are the contract's
 * own, never redefined here). The refusal is a CODE the editor maps to catalog copy: `rules` (the API's
 * own rule refusal, or the local pre-check) or `generic`. A navigation the app knows runs OUTSIDE any
 * try/catch (Next 16: `redirect()` throws) and a save revalidates the whole shell, so the next
 * navigation renders the phone chrome from a fresh bootstrap.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type PhoneMenuSaveResult = { ok: true } | { ok: false; code: 'rules' | 'generic' };

function result(outcome: PhoneMenuOutcome): PhoneMenuSaveResult {
  if (outcome.status === 'redirect') redirect(outcome.path);
  if (outcome.status === 'ok') {
    revalidatePath('/', 'layout');
    return { ok: true };
  }
  return { ok: false, code: outcome.status === 'rules' ? 'rules' : 'generic' };
}

/** `PUT /v1/admin/branding/phone-menu`: the bar, the top and the hidden items, each in order. */
export async function savePhoneMenuAction(menu: unknown): Promise<PhoneMenuSaveResult> {
  const body = phoneMenuSchema.safeParse(menu);
  if (!body.success) return { ok: false, code: 'generic' };
  if (validatePhoneMenu(body.data) !== null) return { ok: false, code: 'rules' };
  return result(await savePhoneMenu(body.data));
}

/** `DELETE /v1/admin/branding/phone-menu`: back to the shell's own menu ("Restaurar o padrão"). */
export async function clearPhoneMenuAction(): Promise<PhoneMenuSaveResult> {
  return result(await clearPhoneMenu());
}
