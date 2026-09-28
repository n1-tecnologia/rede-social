'use client';

import { MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH } from '@rede-social/contracts/profiles';
import { Button, Input, Textarea, useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { saveProfileAction } from '@/app/(app)/perfil/actions';
import { AvatarUploadField } from '@/components/media/AvatarUploadField';

export interface EditProfileFormProps {
  displayName: string;
  bio: string | null;
  avatarAssetId: string | null;
  save: typeof saveProfileAction;
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
 */
export function EditProfileForm({ displayName, bio, avatarAssetId, save }: EditProfileFormProps) {
  const t = useTranslations('profile');
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [text, setText] = useState(bio ?? '');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [bioError, setBioError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const dirty = name !== displayName || text !== (bio ?? '');

  const submit = () => {
    setNameError(undefined);
    setBioError(undefined);
    startTransition(async () => {
      const result = await save({ displayName: name, bio: text });
      if (result.ok) {
        toast.show({ tone: 'success', message: t('toasts.saved') });
        router.push('/perfil');
        return;
      }
      if (result.code === 'nameRequired') return setNameError(t('errors.nameRequired'));
      if (result.code === 'nameTooLong') {
        return setNameError(t('errors.nameTooLong', { max: MAX_DISPLAY_NAME_LENGTH }));
      }
      if (result.code === 'bioTooLong') {
        return setBioError(t('errors.bioTooLong', { max: MAX_BIO_LENGTH }));
      }
      toast.show({ tone: 'error', message: t('errors.generic') });
    });
  };

  return (
    <form
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

      <Textarea
        id="bio"
        name="bio"
        label={t('edit.bio.label')}
        placeholder={t('edit.bio.placeholder')}
        value={text}
        rows={3}
        maxLength={MAX_BIO_LENGTH}
        counter={{ value: text.length, max: MAX_BIO_LENGTH }}
        error={bioError}
        onChange={(event) => {
          setText(event.target.value);
          setBioError(undefined);
        }}
      />

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
