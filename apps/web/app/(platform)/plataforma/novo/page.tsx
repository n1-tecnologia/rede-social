import { NewTenantForm } from '@/components/platform/NewTenantForm';
import { RequireDraftData } from '@/components/platform/wizard/WizardDraftGuards';
import { requirePlatformAccess } from '@/lib/platform';
import { wizardStepMetadata } from '@/lib/wizard-metadata';

export const generateMetadata = () => wizardStepMetadata('data');

/**
 * `/plataforma/novo` — step 1 (Dados) of the tenant wizard: the display name, the slug and the
 * first-admin e-mail of D-31 (ROLE-03), on the wizard's draft. Nothing is created here: "Continuar"
 * validates and opens Personalização (colours, modules, logo); the tenant is created only by the
 * summary's confirmation. The header, the step row, the draft and the live preview device belong to
 * `novo/layout.tsx`, which stays mounted across every step (the real module keys reach the draft
 * from there, so the client never imports the contracts barrel). The authorisation is re-proved here
 * even though the panel layout already did.
 */
export default async function NewTenantPage() {
  await requirePlatformAccess();

  return (
    <>
      <RequireDraftData need="none" />
      <NewTenantForm />
    </>
  );
}
