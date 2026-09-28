import { readLegalDoc } from '@rede-social/contracts';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * the platform's Privacy Policy, rendered from the versioned markdown in `@rede-social/contracts/legal` (D-03).
 * Server component: `readLegalDoc` reads the file with `node:fs`; `next.config.ts` keeps the markdown
 * inside the deployed function bundle (`outputFileTracingIncludes`).
 */
export default async function PrivacidadePage() {
  const [t, tc] = await Promise.all([getTranslations('legal'), getTranslations('common')]);
  const doc = readLegalDoc('politica-de-privacidade');

  return (
    <>
      {renderMarkdown(doc.body)}
      <p>{t('version', { version: doc.version })}</p>
      <p>
        <Link href="/entrar">{tc('back')}</Link>
      </p>
    </>
  );
}

/** Minimal renderer: `#`/`##` lines become headings, blank-line-separated blocks become paragraphs. */
function renderMarkdown(body: string) {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const key = block.slice(0, 48);
      if (block.startsWith('## ')) return <h2 key={key}>{block.slice(3)}</h2>;
      if (block.startsWith('# ')) return <h1 key={key}>{block.slice(2)}</h1>;
      return <p key={key}>{block.replace(/\n/g, ' ')}</p>;
    });
}
