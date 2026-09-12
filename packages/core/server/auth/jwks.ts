import { createRemoteJWKSet } from 'jose';
import { env } from '../env';

/** Module-level so jose caches keys per `kid` (Supabase JWKS is edge-cached ~10 min; do not cache longer). */
export const JWKS = createRemoteJWKSet(
  new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

export const JWT_ISSUER = `${env.SUPABASE_URL}/auth/v1`;
