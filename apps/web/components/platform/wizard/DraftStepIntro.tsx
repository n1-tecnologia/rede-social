'use client';

import { useTranslations } from 'next-intl';
import { WizardStepIntro } from '../WizardStep';
import { useTenantDraft } from './TenantDraftProvider';

/**
 * The heading of a step before the tenant exists: its copy names the tenant, and the name lives in
 * the browser's draft until the confirmation (the catalog placeholder while it is still empty).
 */
export function DraftStepIntro({ step }: { step: 'brand' | 'domain' | 'summary' }) {
  const t = useTranslations('platform.wizard');
  const tb = useTranslations('platformBranding');
  const { draft } = useTenantDraft();
  const tenant = draft.displayName.trim() || tb('preview.namePlaceholder');
  return <WizardStepIntro title={t(`${step}.title`)} body={t(`${step}.body`, { tenant })} />;
}
