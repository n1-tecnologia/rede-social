import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { failureDestination, isOtpType, sanitizeNext } from '@/lib/auth-confirm';
import { linkReturnFor } from '@/lib/link-return';
import { ConfirmForm } from './ConfirmForm';

/**
 * `/auth/continuar` (quick 261117-kkx): where `GET /auth/confirm` hands a valid-shaped mail link.
 * It consumes nothing: one button inside a native form that POSTs the same fields back to
 * `/auth/confirm`, the only place `verifyOtp` runs. A mail scanner that GETs the link therefore
 * lands here and cannot burn the one-time token.
 *
 * `referrer` is `same-origin`, NOT `no-referrer` on purpose: with no-referrer Chromium and Firefox
 * send `Origin: null` on a same-origin form POST, which would defeat the route's Origin check,
 * while same-origin still keeps this token URL out of the Referer of the tenant font stylesheet.
 *
 * Calls no Supabase method and reads no cookie or header; the token is rendered only as an escaped
 * hidden input value.
 */
export const metadata: Metadata = {
  referrer: 'same-origin',
  robots: { index: false, follow: false },
};

type Param = string | string[] | undefined;

function first(value: Param): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContinuarPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: Param; type?: Param; next?: Param }>;
}) {
  const query = await searchParams;
  const tokenHash = first(query.token_hash);
  const type = first(query.type);
  // No request origin here, so the fixed-reference guard; the value was already sanitised once by
  // the GET hop, this is the second, independent check.
  const safeNext = sanitizeNext(first(query.next));

  if (!tokenHash || !type || !isOtpType(type)) redirect(failureDestination(type ?? null, safeNext));

  // The kind is a closed set, never user input: it only picks a catalog key.
  const kind = linkReturnFor(type, safeNext) ?? 'generic';
  const t = await getTranslations('confirmLink');

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-center text-2xl font-bold tracking-[-0.02em] text-text">
          {t(`${kind}.title`)}
        </h1>
        <p className="text-center text-sm text-text-secondary">{t(`${kind}.body`)}</p>
      </div>

      <ConfirmForm
        tokenHash={tokenHash}
        type={type}
        next={safeNext}
        label={t(`${kind}.action`)}
        pendingLabel={t('pending')}
      />

      <p className="text-center text-xs text-text-secondary">{t('note')}</p>
    </>
  );
}
