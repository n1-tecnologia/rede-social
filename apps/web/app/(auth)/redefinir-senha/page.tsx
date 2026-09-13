import { getTranslations } from 'next-intl/server';
import { PasswordField } from '../cadastro/[slug]/PasswordField';
import { SubmitButton } from '../SubmitButton';
import { reset } from './actions';

/**
 * `/redefinir-senha` (public path, D-01/D-22). Reached from the recovery e-mail through
 * `/auth/confirm`, which has already exchanged the one-time token for a session; the action fails
 * closed without it.
 *
 * Same password control as sign-up (D-10): show/hide toggle instead of a confirm field, `minLength=8`
 * and the local strength hint. The hint is computed in the browser and never leaves the form.
 */
export default async function RedefinirSenhaPage() {
  const [t, ts] = await Promise.all([getTranslations('reset'), getTranslations('signup')]);

  return (
    <>
      <h1>{t('title')}</h1>

      <form action={reset} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <PasswordField
          id="password"
          name="password"
          labels={{
            label: t('newPassword'),
            show: ts('showPassword'),
            hide: ts('hidePassword'),
            min: ts('passwordMin'),
            weak: ts('strength.weak'),
            ok: ts('strength.ok'),
            strong: ts('strength.strong'),
          }}
        />

        <SubmitButton label={t('submit')} pendingLabel={t('pending')} />
      </form>
    </>
  );
}
