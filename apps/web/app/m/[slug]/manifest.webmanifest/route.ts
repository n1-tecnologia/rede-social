import { env } from '@/lib/env';
import { getHostBrand } from '@/lib/host-brand';
import {
  buildManifest,
  iconsFor,
  isManifestSlug,
  NEUTRAL_MANIFEST_SLUG,
  neutralManifest,
} from '@/lib/manifest';

/**
 * Per-tenant web-app manifest (PWA-01, D-25/D-28), host-authoritative (T-02-71, D-20/D-23):
 * the HOST decides which tenant — never the `[slug]` in the path. The slug must equal the slug the
 * host resolves to (else 404), and the reserved neutral slug `_rede` answers the platform's manifest ONLY
 * on platform/generic hosts (404 on a tenant host). Because every tenant is its own origin (D-35),
 * the browser's manifest, service-worker registration and Cache Storage are already partitioned.
 *
 * Browsers fetch manifests credential-less, so this handler reads NO cookies and no session; it is
 * `force-dynamic` and answers `Cache-Control: private, no-store` (also set by `next.config.ts`
 * `headers()`) so nothing between the tenant and the device can cache one tenant's brand for another.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = 'private, no-store';

function notFound(): Response {
  return Response.json(
    { error: 'NOT_FOUND' },
    { status: 404, headers: { 'Cache-Control': NO_STORE } },
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isManifestSlug(slug)) return notFound();

  const brand = await getHostBrand();
  let body: ReturnType<typeof buildManifest>;
  if (brand.mode === 'tenant') {
    // A tenant host whose lookup is momentarily unavailable (`tenant` null) cannot vouch for the
    // slug: 404 rather than a neutral manifest under a tenant's name.
    if (!brand.tenant || slug !== brand.tenant.slug) return notFound();
    body = buildManifest({
      slug,
      displayName: brand.tenant.displayName,
      themeColor: brand.branding.colors.primary,
      icons: iconsFor(brand.branding, new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin),
    });
  } else {
    if (slug !== NEUTRAL_MANIFEST_SLUG) return notFound();
    body = neutralManifest();
  }

  return Response.json(body, {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': NO_STORE,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
