import { PageHeader } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadOwnProfile } from '@/lib/profile';
import { getHostTenant } from '@/lib/tenant-host';
import { saveProfileAction } from '../actions';
import { EditProfileForm } from './EditProfileForm';

/**
 * `/perfil/editar` (PROF-01, UI-SPEC §Edit profile): the prototype's `EditProfileForm` minus "Nome de
 * usuário" and "Website" (no model backs them, D-45/D-46). Server-rendered from the same
 * `GET /v1/me/profile` the profile screen reads; when it cannot be read the member goes back to
 * `/perfil`, which owns this phase's error state.
 */
export default async function EditProfilePage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const [t, profile] = await Promise.all([getTranslations('profile'), loadOwnProfile()]);
  if (!profile) redirect('/perfil');

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t('edit.title')}
        backHref="/perfil"
        backLabel={t('edit.back')}
        className="md:static md:px-0"
      />
      <EditProfileForm
        displayName={profile.displayName}
        bio={profile.bio}
        avatarAssetId={profile.avatarAssetId}
        save={saveProfileAction}
      />
    </div>
  );
}
