'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTenantDraft } from './TenantDraftProvider';

/**
 * The draft steps' gate, checked after the draft was read back from the tab's session (so a reload
 * on a later step stays where it is). Each step needs the ones before it:
 * - while the summary's confirmation is open (`confirming`) the gate waits: the dialog owns what
 *   follows (its progress, a partial failure, the hand-off to the invite or the Banco tab), and what
 *   it clears on the way (the manual access once the API answered) must not send the page anywhere;
 * - a draft that already created its tenant (`createdId`) goes on to that tenant's invite step, on
 *   every draft step, Dados included: the tenant exists, so nothing may offer to create it again;
 * - `need="data"` (Personalização): Dados passed its validation (`dataReady`), else Dados;
 * - `need="brand"` (Domínio): also the colours pass (`brandReady`), else Personalização;
 * - `need="host"` (Resumo): also the host was checked by the Domínio step (`hostReady`), else
 *   Domínio, so a host typed and never checked cannot reach the confirmation;
 * - `need="project"` (Resumo, since 09.2-18): everything above, and the Supabase project: a ref
 *   (Dados checked it) and, when the pre-check said the access is manual, the three values. They are
 *   memory only, so a reload on a later step finds the ref without them (UI-D-534): the draft goes
 *   back to Dados, closed, to ask again.
 */
export function RequireDraftData({
  need = 'data',
}: {
  need?: 'none' | 'data' | 'brand' | 'host' | 'project';
}) {
  const { draft, brandReady, restored, confirming, access, update } = useTenantDraft();
  const router = useRouter();
  const { createdId, dataReady, hostReady, projectRef, manualAccess } = draft;
  const accessMissing = Object.values(access).some((value) => value.trim() === '');
  const projectMissing = projectRef.trim() === '' || (manualAccess && accessMissing);
  useEffect(() => {
    if (!restored || confirming) return;
    if (createdId) {
      router.replace(`/plataforma/novo/${createdId}/convite`);
      return;
    }
    if (need === 'none') return;
    if (!dataReady) router.replace('/plataforma/novo');
    else if (need === 'project' && projectMissing) {
      update({ dataReady: false });
      router.replace('/plataforma/novo');
    } else if (need !== 'data' && !brandReady) router.replace('/plataforma/novo/marca');
    else if ((need === 'host' || need === 'project') && !hostReady) {
      router.replace('/plataforma/novo/dominio');
    }
  }, [
    restored,
    createdId,
    confirming,
    dataReady,
    brandReady,
    hostReady,
    projectMissing,
    need,
    router,
    update,
  ]);
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
