import { DraftStepIntro } from '@/components/platform/wizard/DraftStepIntro';
import { RequireDraftData } from '@/components/platform/wizard/WizardDraftGuards';
import { WizardPersonalization } from '@/components/platform/wizard/WizardPersonalization';
import { requirePlatformAccess } from '@/lib/platform';
import { wizardStepMetadata } from '@/lib/wizard-metadata';

export const generateMetadata = () => wizardStepMetadata('brand');

/**
 * `/plataforma/novo/marca` — step 2 (Personalização): the colours (with the contrast readout), the
 * modules, the logos and the optional app icon (composed here), all into the draft and previewed
 * (here and in the device). The files are uploaded only after the summary's confirmation creates
 * the tenant. "Continuar" checks the colours and opens Domínio.
 */
export default async function NewTenantBrandStepPage() {
  await requirePlatformAccess();

  return (
    <div className="flex flex-col gap-6">
      <RequireDraftData />
      <DraftStepIntro step="brand" />
      <WizardPersonalization />
    </div>
  );
}
