import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/** Unknown, suspended or malformed slug (D-01): never says whether the community ever existed. */
export default async function CadastroNotFound() {
  const [t, tc] = await Promise.all([getTranslations('signup'), getTranslations('common')]);
  return (
    <>
      <h1>{t('tenantNotFound')}</h1>
      <p>
        <Link href="/entrar">{tc('back')}</Link>
      </p>
    </>
  );
}
