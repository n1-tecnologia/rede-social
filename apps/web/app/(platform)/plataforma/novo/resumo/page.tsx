import { DraftStepIntro } from '@/components/platform/wizard/DraftStepIntro';
import { RequireDraftData } from '@/components/platform/wizard/WizardDraftGuards';
import { WizardSummary } from '@/components/platform/wizard/WizardSummary';
import { requirePlatformAccess } from '@/lib/platform';
import { wizardStepMetadata } from '@/lib/wizard-metadata';

export const generateMetadata = () => wizardStepMetadata('summary');

/**
 * `/plataforma/novo/resumo` — step 4 (Resumo): everything collected, with previews and a way back to
 * each step, and "Criar tenant", whose confirmation is the only moment the wizard writes (the tenant,
 * then its logo, icon and domain), before the invite step.
 */
export default async function NewTenantSummaryStepPage() {
  await requirePlatformAccess();

  return (
    <div className="flex flex-col gap-6">
      <RequireDraftData need="host" />
      <DraftStepIntro step="summary" />
      <WizardSummary />
    </div>
  );
}
