import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * "Endereço incorreto" (TENANT-01, D-23). Reached only through `/auth/host-mismatch`, which has
 * already cleared the session.
 *
 * Copy: `hostMismatch.title` / `hostMismatch.body` (pt-BR catalog).
 * This component takes NO props and reads no cookie, no header and no search param — by design. The
 * screen must not reveal which community the account belongs to, nor which community this address
 * serves, so it has nothing tenant-specific to read in the first place. Keep it that way.
 */
export default async function EnderecoInvalidoPage() {
  const [t, tc] = await Promise.all([getTranslations('hostMismatch'), getTranslations('common')]);

  return (
    <>
      <h1>{t('title')}</h1>
      <p>{t('body')}</p>
      <p>
        <Link href="/entrar">{tc('back')}</Link>
      </p>
    </>
  );
}
