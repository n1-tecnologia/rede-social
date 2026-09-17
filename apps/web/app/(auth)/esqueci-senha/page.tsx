import { getTranslations } from 'next-intl/server';
import { AuthInput } from '../AuthInput';
import { LinkButton } from '../LinkButton';
import { SubmitButton } from '../SubmitButton';
import { forgot } from './actions';

/**
 * `/esqueci-senha` (public, D-01). Copy and field order follow the prototype's forgot-password screen:
 * title -> helper -> e-mail -> "Enviar link" -> "Voltar para login".
 *
 * `?enviado=1` renders the single D-10 sentence in a status live region; it is the SAME text for a
 * known and an unknown address (the action has one redirect target, T-05-02).
 * `?erro=link-invalido` is where `/auth/confirm` and the reset action send an expired or already-used
 * link, so the person can ask for a new one from here. Exactly one status / alert paragraph may exist
 * on the page (recovery.spec.ts reads them with `toHaveText`) — no `Input error` here.
 */
export default async function EsqueciSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ enviado?: string; erro?: string }>;
}) {
  const [{ enviado, erro }, t, tl, tc] = await Promise.all([
    searchParams,
    getTranslations('forgot'),
    getTranslations('login'),
    getTranslations('common'),
  ]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-center text-2xl font-bold tracking-[-0.02em] text-text">
          {t('title')}
        </h1>
        <p className="text-center text-sm text-text-secondary">{t('help')}</p>
      </div>

      {enviado === '1' ? (
        <p role="status" className="text-center text-sm text-success">
          {t('sent')}
        </p>
      ) : null}
      {erro === 'link-invalido' ? (
        <p role="alert" className="text-center text-sm text-danger">
          {t('invalidLink')}
        </p>
      ) : null}

      <form action={forgot} className="flex flex-col gap-4">
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
        <SubmitButton label={t('submit')} pendingLabel={t('pending')} />
      </form>

      <LinkButton href="/entrar" variant="ghost" fullWidth>
        {tc('back')}
      </LinkButton>
    </>
  );
}
