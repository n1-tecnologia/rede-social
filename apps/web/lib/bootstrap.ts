import { type ApiErrorEnvelope, type Bootstrap, bootstrapSchema } from '@tria/contracts';
import { cache } from 'react';
import { apiFetch } from '@/lib/api';

/** Non-2xx API answer, carrying the stable envelope code every screen switches on (D-09). */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
    public readonly requestId?: string,
  ) {
    super(`API ${status} ${code}`);
    this.name = 'ApiClientError';
  }
}

async function readEnvelope(res: Response): Promise<ApiErrorEnvelope['error'] | null> {
  try {
    const body = (await res.json()) as Partial<ApiErrorEnvelope>;
    return body?.error && typeof body.error.code === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * `GET /v1/me/bootstrap`, deduplicated per request render (React `cache`): the `(app)` layout and
 * `/inicio` share one call. Throws `ApiClientError` on any non-2xx (401 -> the layout redirects to
 * `/entrar`; 403 codes are handled by plan 01-05).
 */
export const getBootstrap = cache(async (): Promise<Bootstrap> => {
  const res = await apiFetch('/v1/me/bootstrap');
  if (!res.ok) {
    const error = await readEnvelope(res);
    throw new ApiClientError(
      res.status,
      error?.code ?? 'HTTP_ERROR',
      error?.details,
      error?.requestId,
    );
  }
  return bootstrapSchema.parse(await res.json());
});
