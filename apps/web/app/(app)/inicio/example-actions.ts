'use server';

import { createExampleItemSchema } from '@tria/module-example/contracts';
import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';

/**
 * Create an example item (D-19's write path). The SAME Zod schema the API validates with
 * (`@tria/module-example/contracts`) runs here first, so a bad form never becomes a request — and
 * the two can never drift, because there is only one schema.
 *
 * Authorisation is NOT decided here: the widget hides the form for a member, but the API's
 * `requireRole('admin_tenant')` is what actually refuses, and this action surfaces the envelope
 * code if someone posts the form anyway.
 */
export async function createExampleItem(formData: FormData): Promise<void> {
  const parsed = createExampleItemSchema.safeParse({ title: formData.get('title') });
  if (!parsed.success) throw new Error('VALIDATION_FAILED');

  const res = await apiFetch('/v1/example/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new Error(body?.error?.code ?? 'HTTP_ERROR');
  }

  revalidatePath('/inicio');
}
