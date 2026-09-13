import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SubmitButton } from '../SubmitButton';
import { forgot } from './actions';

/**
 * `/esqueci-senha` (public, D-01). Copy and field order follow the prototype's forgot-password screen:
 * title -> helper -> e-mail -> "Enviar link" -> "Voltar para login".
 *
 * `?enviado=1` renders the single D-10 sentence in a `role="status"` live region; it is the SAME text
 * for a known and an unknown address (the action has one redirect target, T-05-02).
 * `?erro=link-invalido` is where `/auth/confirm` and the reset action send an expired or already-used
 * link, so the person can ask for a new one from here.
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
      <h1>{t('title')}</h1>
      <p>{t('help')}</p>

      {enviado === '1' ? <p role="status">{t('sent')}</p> : null}
      {erro === 'link-invalido' ? <p role="alert">{t('invalidLink')}</p> : null}

      <form action={forgot} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label htmlFor="email">{tl('email')}</label>
        <input id="email" name="email" type="email" autoComplete="username" required />

        <SubmitButton label={t('submit')} pendingLabel={t('pending')} />
      </form>

      <p>
        <Link href="/entrar">{tc('back')}</Link>
      </p>
    </>
  );
}
