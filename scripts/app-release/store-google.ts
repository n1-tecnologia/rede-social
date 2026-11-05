import { loadJose } from './jose-loader';
import {
  asRecord,
  asString,
  assertOrigin,
  codeForStatus,
  type FetchLike,
  requestJson,
  StoreError,
} from './store-http';

/**
 * The Google Play Developer API client (13-29, COVERAGE section 4, D-605). The OAuth2 JWT-bearer exchange for a
 * service account, then the edit lifecycle: `edits.insert`, `edits.bundles.upload`, `edits.tracks.update` on the
 * INTERNAL track, `validate`, `commit`, and `delete` for the preflight. It never touches any other track, so a
 * promotion past internal testing stays the tenant's act (D-619). Both origins are injectable. It never logs.
 *
 * Endpoint paths used:
 *  - POST {token origin}/token (grant_type jwt-bearer, scope androidpublisher)
 *  - POST /androidpublisher/v3/applications/{package}/edits, DELETE .../edits/{id}
 *  - POST /upload/androidpublisher/v3/applications/{package}/edits/{id}/bundles?uploadType=media
 *  - PUT .../edits/{id}/tracks/internal
 *  - POST .../edits/{id}:validate and :commit
 *
 * The listing (13-31, D-607, COVERAGE section 4) adds, checked against Google's published API discovery document
 * (androidpublisher v3): `PUT .../edits/{id}/listings/{language}` (title, short and full description),
 * `PUT .../edits/{id}/details` (contact e-mail, website, default language), and the high-resolution icon with
 * `DELETE .../edits/{id}/listings/{language}/icon` (deleteall) followed by
 * `POST /upload/.../edits/{id}/listings/{language}/icon?uploadType=media`, so a second push leaves one icon.
 * No release, track promotion or screenshot call is made from here beyond the internal track above.
 */

export const GOOGLE_DEFAULT_ORIGIN = 'https://androidpublisher.googleapis.com';
export const GOOGLE_TOKEN_DEFAULT_ORIGIN = 'https://oauth2.googleapis.com';
export const GOOGLE_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const TOKEN_LIFETIME_SECONDS = 3600;
const TOKEN_REFRESH_MARGIN_SECONDS = 120;

export type GoogleClientOptions = {
  origin?: string;
  tokenOrigin?: string;
  /** The service-account JSON exactly as it was pasted. Held in memory only. */
  serviceAccount: string;
  now?: () => number;
  fetch?: FetchLike;
};

export type GoogleClient = {
  insertEdit(packageName: string): Promise<{ id: string }>;
  deleteEdit(packageName: string, editId: string): Promise<void>;
  uploadBundle(
    packageName: string,
    editId: string,
    bundle: Uint8Array,
  ): Promise<{ versionCode: number }>;
  updateInternalTrack(
    packageName: string,
    editId: string,
    input: { versionCode: number; status?: 'draft' | 'completed' },
  ): Promise<void>;
  validateEdit(packageName: string, editId: string): Promise<void>;
  commitEdit(packageName: string, editId: string): Promise<void>;
  /** `PUT .../edits/{id}/listings/{language}`: replaces the localized text, so a second call changes nothing. */
  updateListing(
    packageName: string,
    editId: string,
    language: string,
    input: { title: string; shortDescription: string; fullDescription: string },
  ): Promise<void>;
  /** `PUT .../edits/{id}/details`: the user-visible contact e-mail and website and the default language. */
  updateDetails(
    packageName: string,
    editId: string,
    input: { contactEmail: string; contactWebsite: string; defaultLanguage: string },
  ): Promise<void>;
  /** The high-resolution icon of one language: the old one is removed first, so there is always exactly one. */
  replaceIcon(
    packageName: string,
    editId: string,
    language: string,
    png: Uint8Array,
  ): Promise<void>;
};

export function createGoogleClient(options: GoogleClientOptions): GoogleClient {
  const origin = assertOrigin(options.origin ?? GOOGLE_DEFAULT_ORIGIN);
  const tokenOrigin = assertOrigin(options.tokenOrigin ?? GOOGLE_TOKEN_DEFAULT_ORIGIN);
  const now = options.now ?? Date.now;
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  let token: { value: string; expiresAt: number } | null = null;

  const account = (() => {
    try {
      const parsed = asRecord(JSON.parse(options.serviceAccount));
      const email = asString(parsed.client_email);
      const privateKey = asString(parsed.private_key);
      if (!email || !privateKey) throw new Error('shape');
      return { email, privateKey, keyId: asString(parsed.private_key_id) };
    } catch {
      throw new StoreError('store_auth_failed');
    }
  })();

  async function accessToken(): Promise<string> {
    const nowSeconds = Math.floor(now() / 1000);
    if (token && token.expiresAt - TOKEN_REFRESH_MARGIN_SECONDS > nowSeconds) return token.value;
    const jose = loadJose();
    const key = await jose.importPKCS8(account.privateKey, 'RS256').catch(() => {
      throw new StoreError('store_auth_failed');
    });
    const assertion = await new jose.SignJWT({ scope: GOOGLE_PUBLISHER_SCOPE })
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'JWT',
        ...(account.keyId ? { kid: account.keyId } : {}),
      })
      .setIssuer(account.email)
      .setAudience(`${tokenOrigin}/token`)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + TOKEN_LIFETIME_SECONDS)
      .sign(key);
    const answer = await requestJson(fetchImpl, `${tokenOrigin}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (answer.status !== 200) throw new StoreError('store_auth_failed', answer.status);
    const value = asString(asRecord(answer.json).access_token);
    if (!value) throw new StoreError('store_bad_answer', answer.status);
    const lifetime = Number(asRecord(answer.json).expires_in);
    token = {
      value,
      expiresAt: nowSeconds + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600),
    };
    return value;
  }

  async function call(
    method: string,
    path: string,
    body?: string | Uint8Array,
    contentType = 'application/json',
  ): Promise<Record<string, unknown>> {
    const answer = await requestJson(fetchImpl, `${origin}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': contentType }),
      },
      ...(body === undefined ? {} : { body }),
    });
    if (answer.status < 200 || answer.status > 299) {
      throw new StoreError(codeForStatus(answer.status), answer.status);
    }
    return asRecord(answer.json);
  }

  const editsBase = (packageName: string) =>
    `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits`;

  return {
    async insertEdit(packageName) {
      const made = await call('POST', editsBase(packageName), '{}');
      const id = asString(made.id);
      if (!id) throw new StoreError('store_bad_answer');
      return { id };
    },
    async deleteEdit(packageName, editId) {
      await call('DELETE', `${editsBase(packageName)}/${encodeURIComponent(editId)}`);
    },
    async uploadBundle(packageName, editId, bundle) {
      const uploaded = await call(
        'POST',
        `/upload${editsBase(packageName)}/${encodeURIComponent(editId)}/bundles?uploadType=media`,
        bundle,
        'application/octet-stream',
      );
      const versionCode = Number(uploaded.versionCode);
      if (!Number.isInteger(versionCode) || versionCode < 1)
        throw new StoreError('store_bad_answer');
      return { versionCode };
    },
    async updateInternalTrack(packageName, editId, { versionCode, status = 'draft' }) {
      await call(
        'PUT',
        `${editsBase(packageName)}/${encodeURIComponent(editId)}/tracks/internal`,
        JSON.stringify({
          track: 'internal',
          releases: [{ status, versionCodes: [String(versionCode)] }],
        }),
      );
    },
    async validateEdit(packageName, editId) {
      await call('POST', `${editsBase(packageName)}/${encodeURIComponent(editId)}:validate`, '{}');
    },
    async commitEdit(packageName, editId) {
      await call('POST', `${editsBase(packageName)}/${encodeURIComponent(editId)}:commit`, '{}');
    },

    async updateListing(packageName, editId, language, input) {
      await call(
        'PUT',
        `${editsBase(packageName)}/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}`,
        JSON.stringify({ language, ...input }),
      );
    },
    async updateDetails(packageName, editId, input) {
      await call(
        'PUT',
        `${editsBase(packageName)}/${encodeURIComponent(editId)}/details`,
        JSON.stringify(input),
      );
    },
    async replaceIcon(packageName, editId, language, png) {
      const base = `${editsBase(packageName)}/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}/icon`;
      await call('DELETE', base);
      await call('POST', `/upload${base}?uploadType=media`, png, 'image/png');
    },
  };
}
