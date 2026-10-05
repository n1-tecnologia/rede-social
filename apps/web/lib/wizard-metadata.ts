import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export type WizardStepKey = 'data' | 'brand' | 'domain' | 'summary' | 'invite';

/**
 * The document title of a tenant wizard step ("Marca · Novo tenant"). Every step renders inside the
 * same layout, so a step change is a soft navigation that moves no focus; the App Router announces
 * it through the document title, and a distinct title per step is what tells a screen reader that
 * the step changed.
 */
export async function wizardStepMetadata(step: WizardStepKey): Promise<Metadata> {
  const t = await getTranslations('platform.wizard');
  return { title: t('documentTitle', { step: t(`steps.${step}`) }) };
}
