import { mediaVariantParamSchema } from '@rede-social/contracts/media';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

/**
 * The BFF half of the stable media path (R-05, TENANT-04).
 *
 * `MediaImage` and every `avatarUrl` in a payload point at `/v1/media/{assetId}/{variant}` — a
 * SAME-ORIGIN path, because an `<img>` cannot carry an `Authorization` header and the access token
 * lives in an HttpOnly cookie (D-27). This handler is the only thing that can turn that cookie into
 * the Bearer the API verifies: it forwards the request, and hands the API's 302 to the browser so
 * the bytes come straight from Storage — they never pass through this server.
 *
 * The tenant check happens on every single image fetch, inside the API: this route adds no
 * authorization of its own and leaks nothing when the answer is a refusal. A 403/404 is passed
 * through unchanged so `MediaImage`'s `onError` degrades to the neutral "no photo" state rather
 * than showing a broken-image glyph.
 *
 * `Cache-Control` is the API's own `private, max-age=1500` — well inside the signed URL's hour, and
 * never a shared cache (the redirect target is minted per member).
 */
export const dynamic = 'force-dynamic';

const assetIdSchema = z.uuid();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string; variant: string }> },
): Promise<Response> {
  const { assetId, variant } = await params;
  const id = assetIdSchema.safeParse(assetId);
  const rung = mediaVariantParamSchema.safeParse(variant);
  // A variant outside the ladder never reaches the API: the key space is a pure function of
  // (tenant, asset, variant) and this is the only place a crafted one could enter it.
  if (!id.success || !rung.success) {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  let answer: Response;
  try {
    answer = await apiFetch(
      `/v1/media/${encodeURIComponent(id.data)}/${encodeURIComponent(rung.data)}`,
      { redirect: 'manual' },
    );
  } catch (error) {
    console.error('media.serve_failed', { error: String(error) });
    return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
  }

  const location = answer.headers.get('location');
  if (answer.status === 302 && location) {
    return new Response(null, {
      status: 302,
      headers: {
        location,
        'cache-control': answer.headers.get('cache-control') ?? 'private, no-store',
      },
    });
  }

  return new Response(null, {
    status: answer.status >= 500 ? 502 : answer.status,
    headers: { 'cache-control': 'no-store' },
  });
}
