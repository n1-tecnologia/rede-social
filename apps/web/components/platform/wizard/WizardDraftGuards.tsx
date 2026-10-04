'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTenantDraft } from './TenantDraftProvider';

/**
 * The draft steps' gate, checked after the draft was read back from the tab's session (so a reload
 * on a later step stays where it is). Each step needs the ones before it:
 * - a draft that already created its tenant (`createdId`) goes on to that tenant's invite step, on
 *   every draft step, Dados included: the tenant exists, so nothing may offer to create it again
 *   (unless the summary's confirmation is still open: it shows the uploads and moves on itself);
 * - `need="data"` (Personalização): Dados passed its validation (`dataReady`), else Dados;
 * - `need="brand"` (Domínio): also the colours pass (`brandReady`), else Personalização;
 * - `need="host"` (Resumo): also the host was checked by the Domínio step (`hostReady`), else
 *   Domínio, so a host typed and never checked cannot reach the confirmation.
 */
export function RequireDraftData({ need = 'data' }: { need?: 'none' | 'data' | 'brand' | 'host' }) {
  const { draft, brandReady, restored, confirming } = useTenantDraft();
  const router = useRouter();
  const { createdId, dataReady, hostReady } = draft;
  useEffect(() => {
    if (!restored) return;
    if (createdId) {
      if (!confirming) router.replace(`/plataforma/novo/${createdId}/convite`);
      return;
    }
    if (need === 'none') return;
    if (!dataReady) router.replace('/plataforma/novo');
    else if (need !== 'data' && !brandReady) router.replace('/plataforma/novo/marca');
    else if (need === 'host' && !hostReady) router.replace('/plataforma/novo/dominio');
  }, [restored, createdId, confirming, dataReady, brandReady, hostReady, need, router]);
  return null;
}

/**
 * Clears the wizard's draft on the invite step of the tenant THIS draft created: "Criar outro
 * tenant" starts from an empty form, and the created tenant's files are released. Any other draft
 * (another tenant in progress, reached back through the history) is left alone.
 */
export function DraftReset({ tenantId }: { tenantId: string }) {
  const { draft, restored, reset } = useTenantDraft();
  const ours = restored && draft.createdId === tenantId;
  useEffect(() => {
    if (ours) reset();
  }, [ours, reset]);
  return null;
}
