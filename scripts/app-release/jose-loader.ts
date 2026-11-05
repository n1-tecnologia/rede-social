import { createRequire } from 'node:module';

/**
 * `jose` is a dependency of the kernel package, not of the repository root, so a script at the root cannot
 * resolve it by name (and this plan installs nothing). It is loaded through the kernel package's own resolution,
 * the same pinned copy the API verifies tokens with.
 */
export interface SignJwtLike {
  setProtectedHeader(header: Record<string, unknown>): SignJwtLike;
  setIssuer(issuer: string): SignJwtLike;
  setAudience(audience: string): SignJwtLike;
  setSubject(subject: string): SignJwtLike;
  setIssuedAt(at?: number): SignJwtLike;
  setExpirationTime(at: number | string): SignJwtLike;
  sign(key: unknown): Promise<string>;
}

export interface JoseLike {
  SignJWT: new (payload: Record<string, unknown>) => SignJwtLike;
  importPKCS8(pem: string, alg: string): Promise<unknown>;
  importSPKI(pem: string, alg: string): Promise<unknown>;
  jwtVerify(
    jwt: string,
    key: unknown,
    options?: Record<string, unknown>,
  ): Promise<{ payload: Record<string, unknown>; protectedHeader: Record<string, unknown> }>;
  decodeJwt(jwt: string): Record<string, unknown>;
  decodeProtectedHeader(jwt: string): Record<string, unknown>;
}

let cached: JoseLike | undefined;

export function loadJose(): JoseLike {
  if (!cached) {
    const corePackage = new URL('../../packages/core/package.json', import.meta.url);
    cached = createRequire(corePackage)('jose') as JoseLike;
  }
  return cached;
}
