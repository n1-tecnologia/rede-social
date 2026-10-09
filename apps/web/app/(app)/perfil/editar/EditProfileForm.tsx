'use client';

import { MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH } from '@rede-social/contracts/profiles';
import { type AdminIconId, Button, Input, Textarea, useToast } from '@rede-social/ui';
import { AtSign } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { saveAdminIconAction, saveProfileAction } from '@/app/(app)/perfil/actions';
import { AvatarUploadField } from '@/components/media/AvatarUploadField';
import { AdminIconPicker } from '@/components/profile/AdminIconPicker';
import { returnAfterSave } from '@/lib/form-exit';
import {
  bioRoom,
  cleanInstagramInput,
  composeProfileBio,
  INSTAGRAM_HANDLE_MAX,
  INSTAGRAM_INPUT_MAX_LENGTH,
  parseInstagramInput,
} from '@/lib/profile-instagram';

export interface EditProfileFormProps {
  displayName: string;
  /** The bio's VISIBLE text: the page has already split the Instagram line out of it. */
  bio: string | null;
  /** 2026-10-09: the member's Instagram handle as stored (no `@`), or `null` for none. */
  instagram?: string | null;
  avatarAssetId: string | null;
  save: typeof saveProfileAction;
  /**
   * 2026-10-06: the administrator's current icon (the crown by default); `null` for everyone who is
   * not an administrator, and then the icon field is not rendered at all.
   */
  adminIcon?: AdminIconId | null;
  /** The mark's accessible name ("Administrador"), for the field's live preview. */
  adminLabel?: string;
  saveAdminIcon?: typeof saveAdminIconAction;
}

/**
 * The edit form (UI-SPEC §Edit profile): the photo block, "Nome" (capped at 60), "Bio" (capped at
 * 150 with a live `{n}/150` counter) and one `brand lg fullWidth` "Salvar alterações", disabled
 * until the form is dirty — the shipped Phase 2 `BrandingForm` conventions with the prototype's
 * appearance.
 *
 * Both caps are measured in UTF-16 code units, exactly what `value.length` and `maxLength` count and
 * what 03-02's schema re-checks, so the counter and the server cannot disagree.
 *
 * The photo is NOT part of the submit: it commits on upload completion with its own toast, so a
 * member who only changes their photo never presses the button.
 *
 * 2026-10-06: an administrator also picks the icon beside their name (`AdminIconPicker`). It is part
 * of the submit: a changed icon makes the form dirty, and "Salvar alterações" saves only what
 * changed (the profile through the API, the icon through `saveAdminIcon`).
 *
 * 2026-10-09: "Instagram", between "Nome" and "Bio": the member's handle, shown under their name on
 * the profile and on their posts. It has no column of its own, so it is stored as the bio's last
 * line (`lib/profile-instagram.ts`) and the bio's 150 units are shared: with a handle the counter
 * and `maxLength` count down from what the line leaves (`bioRoom`), and the save sends the COMPOSED
 * bio. The field forgives a pasted profile link: on blur it becomes the handle. A value that is not
 * a handle is announced on blur and on submit, and nothing is saved until it is fixed; clearing the
 * field drops the line.
 *
 * A task screen (`data-shell-hide="nav"`, product decision 2026-10-02): the shell's floating
 * BottomNav steps aside while the form is mounted, so it never sits over "Bio" or the button
 * (tokens.css); the back chevron in the header is the way out.
 */
export function EditProfileForm({
  displayName,
  bio,
  instagram = null,
  avatarAssetId,
  save,
  adminIcon = null,
  adminLabel = '',
  saveAdminIcon,
}: EditProfileFormProps) {
  const t = useTranslations('profile');
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [text, setText] = useState(bio ?? '');
  const [instagramText, setInstagramText] = useState(instagram ?? '');
  const [icon, setIcon] = useState<AdminIconId | null>(adminIcon);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [instagramError, setInstagramError] = useState<string | undefined>(undefined);
  const [bioError, setBioError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const handleInput = parseInstagramInput(instagramText);
  // What the Instagram line leaves the bio, counted from what the field holds right now.
  const room = bioRoom(
    handleInput.status === 'empty'
      ? null
      : handleInput.status === 'valid'
        ? handleInput.handle
        : handleInput.candidate,
  );

  // `@seuperfil` or its pasted link is the stored handle, so neither makes the form dirty.
  const instagramDirty = cleanInstagramInput(instagramText) !== (instagram ?? '');
  const profileDirty = name !== displayName || text !== (bio ?? '') || instagramDirty;
  const iconDirty = icon !== adminIcon;
  const dirty = profileDirty || iconDirty;

  const instagramInvalid = () => t('errors.instagramInvalid', { max: INSTAGRAM_HANDLE_MAX });

  const submit = () => {
    setNameError(undefined);
    setInstagramError(undefined);
    setBioError(undefined);
    if (handleInput.status === 'invalid') {
      setInstagramError(instagramInvalid());
      return;
    }
    const handle = handleInput.status === 'valid' ? handleInput.handle : null;
    const stored = composeProfileBio(text, handle);
    if (stored.length > MAX_BIO_LENGTH) {
      setBioError(
        handle === null
          ? t('errors.bioTooLong', { max: MAX_BIO_LENGTH })
          : t('errors.bioTooLongWithInstagram', { max: room }),
      );
      return;
    }
    startTransition(async () => {
      if (profileDirty) {
        const result = await save({ displayName: name, bio: stored });
        if (!result.ok) {
          if (result.code === 'nameRequired') return setNameError(t('errors.nameRequired'));
          if (result.code === 'nameTooLong') {
            return setNameError(t('errors.nameTooLong', { max: MAX_DISPLAY_NAME_LENGTH }));
          }
          if (result.code === 'bioTooLong') {
            return setBioError(
              handle === null
                ? t('errors.bioTooLong', { max: MAX_BIO_LENGTH })
                : t('errors.bioTooLongWithInstagram', { max: room }),
            );
          }
          toast.show({ tone: 'error', message: t('errors.generic') });
          return;
        }
      }
      if (iconDirty && icon !== null && saveAdminIcon) {
        const result = await saveAdminIcon(icon);
        if (!result.ok) {
          toast.show({ tone: 'error', message: t('errors.generic') });
          return;
        }
      }
      toast.show({ tone: 'success', message: t('toasts.saved') });
      // 2026-10-09: opened from the profile, the form steps back to it (refreshed) instead of
      // stacking a second profile; opened from anywhere else, it lands on the profile as before.
      if (!returnAfterSave(router, '/perfil')) router.push('/perfil');
    });
  };

  return (
    <form
      data-shell-hide="nav"
      className="flex flex-col gap-6 px-4 py-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* The photo commits on its own, independently of the button below (UI-SPEC E2/partial). */}
      <AvatarUploadField displayName={name} avatarAssetId={avatarAssetId} />

      <Input
        id="displayName"
        name="displayName"
        label={t('edit.name.label')}
        placeholder={t('edit.name.placeholder')}
        value={name}
        maxLength={MAX_DISPLAY_NAME_LENGTH}
        required
        error={nameError}
        onChange={(event) => {
          setName(event.target.value);
          setNameError(undefined);
        }}
      />

      <div className="flex flex-col gap-2">
        <Input
          id="instagram"
          name="instagram"
          label={t('edit.instagram.label')}
          placeholder={t('edit.instagram.placeholder')}
          icon={AtSign}
          value={instagramText}
          maxLength={INSTAGRAM_INPUT_MAX_LENGTH}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          error={instagramError}
          // The hint is always read; the error joins it while there is one.
          aria-describedby={instagramError ? 'instagram-hint instagram-error' : 'instagram-hint'}
          onChange={(event) => {
            setInstagramText(event.target.value);
            setInstagramError(undefined);
            setBioError(undefined);
          }}
          onBlur={() => {
            // A pasted link becomes its handle; a value that is not one is announced at once.
            if (handleInput.status === 'valid') setInstagramText(handleInput.handle);
            else if (handleInput.status === 'empty') setInstagramText('');
            else setInstagramError(instagramInvalid());
          }}
        />
        <p id="instagram-hint" className="text-xs text-text-tertiary">
          {t('edit.instagram.hint')}
        </p>
      </div>

      <Textarea
        id="bio"
        name="bio"
        label={t('edit.bio.label')}
        placeholder={t('edit.bio.placeholder')}
        value={text}
        rows={3}
        // Never below the text already there: a bio written before the handle was added would make
        // the browser block the submit with its own bubble; the counter and the submit explain it.
        maxLength={Math.max(room, text.length)}
        counter={{ value: text.length, max: room }}
        error={bioError}
        onChange={(event) => {
          setText(event.target.value);
          setBioError(undefined);
        }}
      />

      {icon !== null ? (
        <AdminIconPicker
          value={icon}
          onChange={setIcon}
          previewName={name.trim() || displayName}
          adminLabel={adminLabel}
        />
      ) : null}

      <Button
        type="submit"
        variant="brand"
        size="lg"
        fullWidth
        loading={pending}
        disabled={!dirty}
        aria-busy={pending || undefined}
      >
        {pending ? t('edit.saving') : t('edit.save')}
      </Button>
    </form>
  );
}
