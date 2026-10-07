import { getTranslations } from 'next-intl/server';
import { readPendingConfirmation } from '@/lib/pending-confirmation';
import { AuthInput } from '../AuthInput';
import { LinkButton } from '../LinkButton';
import { SubmitButton } from '../SubmitButton';
import { resendConfirmation } from './actions';

/**
 * `/verifique-seu-email` (public; quick 261007-gbk). Where sign-up ends, where an unconfirmed login and a
 * dead confirmation link are sent, and where a new confirmation mail is asked for.
 *
 * With the pending cookie the address is read from it (never from the URL) and the form holds only the
 * resend button; without it (a dead link opened in a fresh browser) an e-mail field is shown.
 *
 * Exactly ONE status / alert paragraph may exist (e2e reads them with `toHaveText`): the alert for
 * `erro=link-invalido | nao-confirmado | email`, else the constant "resent" status, else the wait
 * notice. Unknown values render nothing.
 */
export default async function VerifiqueSeuEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; reenviado?: string; aguarde?: string }>;
}) {
  const [{ erro, reenviado, aguarde }, pending, t, tl] = await Promise.all([
    searchParams,
    readPendingConfirmation(),
    getTranslations('verifyEmail'),
    getTranslations('login'),
  ]);

  const alert =
    erro === 'link-invalido'
      ? t('invalidLink')
      : erro === 'nao-confirmado'
        ? t('notConfirmed')
        : erro === 'email'
          ? t('invalidEmail')
          : null;
  const status = alert
    ? null
    : reenviado === '1'
      ? t('resent')
      : aguarde === '1'
        ? t('wait')
        : null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-center text-2xl font-bold tracking-[-0.02em] text-text">
          {t('title')}
        </h1>
        {pending ? (
          <>
            <p className="text-center text-sm text-text-secondary">
              {t('sentTo', { email: pending.email })}
            </p>
            <p className="text-center text-sm text-text-secondary">{t('spamHint')}</p>
          </>
        ) : (
          <p className="text-center text-sm text-text-secondary">{t('help')}</p>
        )}
      </div>

      {alert ? (
        <p role="alert" className="text-center text-sm text-danger">
          {alert}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="text-center text-sm text-success">
          {status}
        </p>
      ) : null}

      <form action={resendConfirmation} className="flex flex-col gap-4">
        {pending ? null : (
          <AuthInput
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            icon="mail"
            placeholder={tl('email')}
            aria-label={tl('email')}
          />
        )}
        <SubmitButton label={t('resend')} pendingLabel={t('pending')} />
      </form>

      <LinkButton href="/entrar" variant="ghost" fullWidth>
        {t('backToLogin')}
      </LinkButton>
    </>
  );
}
