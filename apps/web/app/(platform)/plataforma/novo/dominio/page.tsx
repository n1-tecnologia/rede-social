import { DraftStepIntro } from '@/components/platform/wizard/DraftStepIntro';
import { WizardDomainPicker } from '@/components/platform/wizard/WizardDomainPicker';
import { RequireDraftData } from '@/components/platform/wizard/WizardDraftGuards';
import { requirePlatformAccess } from '@/lib/platform';
import { wizardStepMetadata } from '@/lib/wizard-metadata';

export const generateMetadata = () => wizardStepMetadata('domain');

/**
 * `/plataforma/novo/dominio` — step 3 (Domínio): the host the members will open, recorded in the
 * draft (optional). It is attached right after the confirmation creates the tenant; the DNS records
 * and the verification belong to the invite step, which needs the tenant to exist.
 */
export default async function NewTenantDomainStepPage() {
  await requirePlatformAccess();

  return (
    <div className="flex flex-col gap-6">
      <RequireDraftData need="brand" />
      <DraftStepIntro step="domain" />
      <WizardDomainPicker />
    </div>
  );
}
