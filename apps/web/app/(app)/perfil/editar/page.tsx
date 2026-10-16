import { DEFAULT_ADMIN_ICON, PageHeader } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { adminIconFor } from '@/lib/admin-icon';
import { readAdminIconChoice } from '@/lib/admin-icon-cookie';
import { getBootstrap } from '@/lib/bootstrap';
import { loadOwnProfile } from '@/lib/profile';
import { splitProfileBio } from '@/lib/profile-instagram';
import { getHostTenant } from '@/lib/tenant-host';
import { saveAdminIconAction, saveProfileAction } from '../actions';
import { EditProfileForm } from './EditProfileForm';

/**
 * `/perfil/editar` (PROF-01, UI-SPEC §Edit profile): the prototype's `EditProfileForm` minus "Nome de
 * usuário" and "Website" (no model backs them, D-45/D-46). Server-rendered from the same
 * `GET /v1/me/profile` the profile screen reads; when it cannot be read the member goes back to
 * `/perfil`, which owns this phase's error state.
 *
 * 2026-10-06: an administrator (the viewer's own role, D-47) also picks the icon beside their name;
 * the field is not rendered for anyone else.
 *
 * 2026-10-09: the stored bio carries the member's Instagram as its last line
 * (`lib/profile-instagram.ts`); the page splits it, so the form edits the text and the handle as
 * two fields and composes them back on save.
 */
export default async function EditProfilePage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const [t, tf, profile, bootstrap, iconChoice] = await Promise.all([
    getTranslations('profile'),
    getTranslations('feed'),
    loadOwnProfile(),
    getBootstrap(),
    readAdminIconChoice(),
  ]);
  if (!profile) redirect('/perfil');
  const isAdmin = bootstrap.membership.role === 'admin_tenant';
  // 2026-10-09: the form edits the bio's text and the Instagram handle as two fields.
  const { text: bio, instagram } = splitProfileBio(profile.bio);

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
        bio={bio || null}
        instagram={instagram}
        avatarAssetId={profile.avatarAssetId}
        save={saveProfileAction}
        adminIcon={
          isAdmin ? (adminIconFor(iconChoice, profile.membershipId) ?? DEFAULT_ADMIN_ICON) : null
        }
        adminLabel={tf('post.adminBadge')}
        saveAdminIcon={saveAdminIconAction}
      />
    </div>
  );
}
