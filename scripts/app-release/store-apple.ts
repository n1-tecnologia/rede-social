import { loadJose } from './jose-loader';
import {
  asArray,
  asRecord,
  asString,
  assertOrigin,
  codeForStatus,
  type FetchLike,
  requestJson,
  StoreError,
} from './store-http';

/**
 * The App Store Connect API client (13-29, COVERAGE section 3, D-605, D-607). Only what the release path uses:
 * the bundle id and its two capabilities, the distribution certificate, the App Store profile, the app record
 * preflight, the build processing poll and the internal TestFlight group. Every origin is injectable (the dry
 * run and the tests point it at `fake-stores.ts`). It never submits anything for review (Apple 4.2.6) and it
 * never logs.
 *
 * Endpoint paths used (App Store Connect API v1, JSON:API):
 *  - GET/POST /v1/bundleIds, GET /v1/bundleIds/{id}/bundleIdCapabilities, POST /v1/bundleIdCapabilities
 *  - GET/POST /v1/certificates
 *  - GET/POST /v1/profiles, DELETE /v1/profiles/{id}
 *  - GET /v1/apps, GET /v1/builds, GET /v1/betaGroups, POST /v1/betaGroups/{id}/relationships/builds
 *
 * The listing (13-31, D-607, COVERAGE section 3) adds, all checked against Apple's published OpenAPI document
 * (App Store Connect API 4.6): the editable version and the app info of an app, the version localization
 * (description, keywords, support URL), the app info localization (name, privacy-policy URL), the age-rating
 * declaration and the App Review detail (contact, demo account, notes). The paths are listed on each method.
 * Nothing here touches the review-submission family, pricing or territory availability: those stay the
 * tenant's own acts (D-619, Apple 4.2.6).
 */

export const APPLE_DEFAULT_ORIGIN = 'https://api.appstoreconnect.apple.com';
/** The API accepts a token for at most 20 minutes. */
export const APPLE_TOKEN_LIFETIME_SECONDS = 20 * 60;
const TOKEN_REFRESH_MARGIN_SECONDS = 60;
export const REQUIRED_CAPABILITIES = ['PUSH_NOTIFICATIONS', 'ASSOCIATED_DOMAINS'] as const;

export type AppleClientOptions = {
  origin?: string;
  keyId: string;
  issuerId: string;
  /** The `.p8` PEM. Held in memory only. */
  privateKey: string;
  /** Milliseconds since the epoch; injected so tests control token expiry. */
  now?: () => number;
  fetch?: FetchLike;
};

export type BuildState = 'PROCESSING' | 'VALID' | 'FAILED' | 'INVALID' | 'NOT_FOUND';

/** What the App Review detail carries (13-31): the contact, the demo account and the notes. */
export type AppleReviewDetail = {
  contactFirstName: string;
  contactLastName: string;
  contactPhone: string;
  contactEmail: string;
  demoAccountName: string;
  /** Passed to the one request that sets it. Never logged, never kept. */
  demoAccountPassword: string;
  notes: string;
};

export type AppleClient = {
  registerBundleId(identifier: string, name: string): Promise<{ id: string; created: boolean }>;
  ensureCapabilities(bundleResourceId: string): Promise<{ added: string[] }>;
  createCertificate(csrContent: string): Promise<{ id: string; content: string }>;
  ensureProfile(input: {
    name: string;
    bundleResourceId: string;
    certificateId: string;
  }): Promise<{ id: string; content: string; created: boolean }>;
  findApp(bundleIdentifier: string): Promise<{ id: string } | null>;
  pollBuild(input: {
    appId: string;
    buildNumber: number;
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }): Promise<BuildState>;
  attachBuildToInternalGroup(input: {
    appId: string;
    buildNumber: number;
  }): Promise<{ attached: boolean }>;
  /** `GET /v1/apps/{id}/appStoreVersions` (iOS, PREPARE_FOR_SUBMISSION): the version whose text can still change. */
  findEditableVersion(appId: string): Promise<{ id: string } | null>;
  /** `GET /v1/apps/{id}/appInfos`: the app info that carries the privacy URL and the age rating. */
  findAppInfo(appId: string): Promise<{ id: string } | null>;
  /**
   * `GET /v1/appStoreVersions/{id}/appStoreVersionLocalizations`, then `PATCH /v1/appStoreVersionLocalizations/{id}`
   * or `POST /v1/appStoreVersionLocalizations`: one localization per locale, so a second call changes nothing.
   */
  upsertVersionLocalization(
    versionId: string,
    input: { locale: string; description: string; keywords: string; supportUrl: string },
  ): Promise<{ created: boolean }>;
  /**
   * `GET /v1/appInfos/{id}/appInfoLocalizations`, then `PATCH /v1/appInfoLocalizations/{id}` or
   * `POST /v1/appInfoLocalizations`: the privacy-policy URL of one locale.
   */
  upsertAppInfoLocalization(
    appInfoId: string,
    input: { locale: string; name: string; privacyPolicyUrl: string },
  ): Promise<{ created: boolean }>;
  /** `GET /v1/appInfos/{id}/ageRatingDeclaration`, then `PATCH /v1/ageRatingDeclarations/{id}`. */
  setAgeRating(
    appInfoId: string,
    attributes: Readonly<Record<string, boolean | string>>,
  ): Promise<void>;
  /**
   * `GET /v1/appStoreVersions/{id}/appStoreReviewDetail`, then `PATCH /v1/appStoreReviewDetails/{id}` or
   * `POST /v1/appStoreReviewDetails`: one detail per version, so a second call never adds one.
   */
  upsertDemoAccount(versionId: string, detail: AppleReviewDetail): Promise<{ created: boolean }>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createAppleClient(options: AppleClientOptions): AppleClient {
  const origin = assertOrigin(options.origin ?? APPLE_DEFAULT_ORIGIN);
  const now = options.now ?? Date.now;
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  let token: { value: string; expiresAt: number } | null = null;

  async function bearer(): Promise<string> {
    const nowSeconds = Math.floor(now() / 1000);
    if (token && token.expiresAt - TOKEN_REFRESH_MARGIN_SECONDS > nowSeconds) return token.value;
    const jose = loadJose();
    const key = await jose.importPKCS8(options.privateKey, 'ES256').catch(() => {
      throw new StoreError('store_auth_failed');
    });
    const expiresAt = nowSeconds + APPLE_TOKEN_LIFETIME_SECONDS;
    const value = await new jose.SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: options.keyId, typ: 'JWT' })
      .setIssuer(options.issuerId)
      .setAudience('appstoreconnect-v1')
      .setIssuedAt(nowSeconds)
      .setExpirationTime(expiresAt)
      .sign(key);
    token = { value, expiresAt };
    return value;
  }

  async function call(
    method: string,
    path: string,
    body?: unknown,
    accept: readonly number[] = [200, 201, 204],
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const answer = await requestJson(fetchImpl, `${origin}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await bearer()}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!accept.includes(answer.status)) {
      throw new StoreError(codeForStatus(answer.status), answer.status);
    }
    return { status: answer.status, data: asRecord(answer.json) };
  }

  const firstOf = (data: Record<string, unknown>) => asRecord(asArray(data.data)[0]);

  return {
    async registerBundleId(identifier, name) {
      const lookup = async (): Promise<string | null> => {
        const found = await call(
          'GET',
          `/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&filter[platform]=IOS&limit=200`,
        );
        // The identifier filter is a prefix match on the real API: only an exact identifier is "the" bundle id.
        const exact = asArray(found.data.data)
          .map(asRecord)
          .find((item) => asString(asRecord(item.attributes).identifier) === identifier);
        return exact ? asString(exact.id) : null;
      };
      const existingId = await lookup();
      if (existingId) return { id: existingId, created: false };
      const made = await call(
        'POST',
        '/v1/bundleIds',
        { data: { type: 'bundleIds', attributes: { identifier, name, platform: 'IOS' } } },
        [200, 201, 409],
      );
      // A 409 means another run registered it between the lookup and the POST: it is theirs, so reuse it.
      if (made.status === 409) {
        const raced = await lookup();
        if (raced) return { id: raced, created: false };
        throw new StoreError('store_conflict', 409);
      }
      const id = asString(asRecord(made.data.data).id);
      if (!id) throw new StoreError('store_bad_answer', made.status);
      return { id, created: true };
    },

    async ensureCapabilities(bundleResourceId) {
      const held = await call(
        'GET',
        `/v1/bundleIds/${encodeURIComponent(bundleResourceId)}/bundleIdCapabilities?limit=200`,
      );
      const have = new Set(
        asArray(held.data.data).map((item) =>
          asString(asRecord(asRecord(item).attributes).capabilityType),
        ),
      );
      const added: string[] = [];
      for (const capabilityType of REQUIRED_CAPABILITIES) {
        if (have.has(capabilityType)) continue;
        const made = await call(
          'POST',
          '/v1/bundleIdCapabilities',
          {
            data: {
              type: 'bundleIdCapabilities',
              attributes: { capabilityType },
              relationships: { bundleId: { data: { type: 'bundleIds', id: bundleResourceId } } },
            },
          },
          [200, 201, 409],
        );
        // 409: already enabled (by a run that raced this one). Nothing to add.
        if (made.status !== 409) added.push(capabilityType);
      }
      return { added };
    },

    async createCertificate(csrContent) {
      const made = await call('POST', '/v1/certificates', {
        data: {
          type: 'certificates',
          attributes: { certificateType: 'IOS_DISTRIBUTION', csrContent },
        },
      });
      const data = asRecord(made.data.data);
      const id = asString(data.id);
      const content = asString(asRecord(data.attributes).certificateContent);
      if (!id || !content) throw new StoreError('store_bad_answer', made.status);
      return { id, content };
    },

    async ensureProfile({ name, bundleResourceId, certificateId }) {
      /** The ACTIVE profile of that name; an inactive one (its certificate was replaced) is removed first. */
      const findActive = async (): Promise<{ id: string; content: string } | null> => {
        const listed = await call(
          'GET',
          `/v1/profiles?filter[name]=${encodeURIComponent(name)}&filter[profileType]=IOS_APP_STORE&limit=200`,
        );
        const same = asArray(listed.data.data)
          .map(asRecord)
          .filter((item) => asString(asRecord(item.attributes).name) === name);
        for (const profile of same) {
          const attributes = asRecord(profile.attributes);
          const id = asString(profile.id);
          const content = asString(attributes.profileContent);
          if (id && content && attributes.profileState === 'ACTIVE') return { id, content };
          if (id) {
            await call(
              'DELETE',
              `/v1/profiles/${encodeURIComponent(id)}`,
              undefined,
              [200, 204, 404],
            );
          }
        }
        return null;
      };
      const active = await findActive();
      if (active) return { ...active, created: false };
      const made = await call(
        'POST',
        '/v1/profiles',
        {
          data: {
            type: 'profiles',
            attributes: { name, profileType: 'IOS_APP_STORE' },
            relationships: {
              bundleId: { data: { type: 'bundleIds', id: bundleResourceId } },
              certificates: { data: [{ type: 'certificates', id: certificateId }] },
            },
          },
        },
        [200, 201, 409],
      );
      // 409: a run that raced this one created it first; theirs is the profile.
      if (made.status === 409) {
        const raced = await findActive();
        if (raced) return { ...raced, created: false };
        throw new StoreError('store_conflict', 409);
      }
      const data = asRecord(made.data.data);
      const id = asString(data.id);
      const content = asString(asRecord(data.attributes).profileContent);
      if (!id || !content) throw new StoreError('store_bad_answer', made.status);
      return { id, content, created: true };
    },

    async findApp(bundleIdentifier) {
      const found = await call(
        'GET',
        `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleIdentifier)}&limit=10`,
      );
      const first = firstOf(found.data);
      const id = asString(first.id);
      return id ? { id } : null;
    },

    async pollBuild({ appId, buildNumber, attempts = 30, delayMs = 20_000, sleep = defaultSleep }) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const found = await call(
          'GET',
          `/v1/builds?filter[app]=${encodeURIComponent(appId)}&filter[version]=${buildNumber}&limit=1`,
        );
        const state = asString(asRecord(firstOf(found.data).attributes).processingState);
        if (state === 'VALID' || state === 'FAILED' || state === 'INVALID') return state;
        if (attempt < attempts - 1) await sleep(delayMs);
      }
      return 'PROCESSING';
    },

    async attachBuildToInternalGroup({ appId, buildNumber }) {
      const groups = await call(
        'GET',
        `/v1/betaGroups?filter[app]=${encodeURIComponent(appId)}&filter[isInternalGroup]=true&limit=1`,
      );
      const groupId = asString(firstOf(groups.data).id);
      if (!groupId) return { attached: false };
      const builds = await call(
        'GET',
        `/v1/builds?filter[app]=${encodeURIComponent(appId)}&filter[version]=${buildNumber}&limit=1`,
      );
      const buildId = asString(firstOf(builds.data).id);
      if (!buildId) return { attached: false };
      await call('POST', `/v1/betaGroups/${encodeURIComponent(groupId)}/relationships/builds`, {
        data: [{ type: 'builds', id: buildId }],
      });
      return { attached: true };
    },

    async findEditableVersion(appId) {
      const found = await call(
        'GET',
        `/v1/apps/${encodeURIComponent(appId)}/appStoreVersions?filter[platform]=IOS&filter[appStoreState]=PREPARE_FOR_SUBMISSION&limit=1`,
      );
      const id = asString(firstOf(found.data).id);
      return id ? { id } : null;
    },

    async findAppInfo(appId) {
      const found = await call('GET', `/v1/apps/${encodeURIComponent(appId)}/appInfos?limit=1`);
      const id = asString(firstOf(found.data).id);
      return id ? { id } : null;
    },

    async upsertVersionLocalization(versionId, { locale, description, keywords, supportUrl }) {
      const lookup = async (): Promise<string | null> => {
        const found = await call(
          'GET',
          `/v1/appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations?filter[locale]=${encodeURIComponent(locale)}&limit=50`,
        );
        const same = asArray(found.data.data)
          .map(asRecord)
          .find((item) => asString(asRecord(item.attributes).locale) === locale);
        return same ? asString(same.id) : null;
      };
      const patch = (id: string) =>
        call('PATCH', `/v1/appStoreVersionLocalizations/${encodeURIComponent(id)}`, {
          data: {
            type: 'appStoreVersionLocalizations',
            id,
            attributes: { description, keywords, supportUrl },
          },
        });
      const existing = await lookup();
      if (existing) {
        await patch(existing);
        return { created: false };
      }
      const made = await call(
        'POST',
        '/v1/appStoreVersionLocalizations',
        {
          data: {
            type: 'appStoreVersionLocalizations',
            attributes: { locale, description, keywords, supportUrl },
            relationships: {
              appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
            },
          },
        },
        [200, 201, 409],
      );
      // 409: a run that raced this one created the locale first; its row is the one to update.
      if (made.status === 409) {
        const raced = await lookup();
        if (!raced) throw new StoreError('store_conflict', 409);
        await patch(raced);
        return { created: false };
      }
      return { created: true };
    },

    async upsertAppInfoLocalization(appInfoId, { locale, name, privacyPolicyUrl }) {
      const lookup = async (): Promise<string | null> => {
        const found = await call(
          'GET',
          `/v1/appInfos/${encodeURIComponent(appInfoId)}/appInfoLocalizations?filter[locale]=${encodeURIComponent(locale)}&limit=50`,
        );
        const same = asArray(found.data.data)
          .map(asRecord)
          .find((item) => asString(asRecord(item.attributes).locale) === locale);
        return same ? asString(same.id) : null;
      };
      const patch = (id: string) =>
        call('PATCH', `/v1/appInfoLocalizations/${encodeURIComponent(id)}`, {
          data: { type: 'appInfoLocalizations', id, attributes: { privacyPolicyUrl } },
        });
      const existing = await lookup();
      if (existing) {
        // The name belongs to the app record the tenant created by hand: only the privacy URL is ours to set.
        await patch(existing);
        return { created: false };
      }
      const made = await call(
        'POST',
        '/v1/appInfoLocalizations',
        {
          data: {
            type: 'appInfoLocalizations',
            attributes: { locale, name, privacyPolicyUrl },
            relationships: { appInfo: { data: { type: 'appInfos', id: appInfoId } } },
          },
        },
        [200, 201, 409],
      );
      if (made.status === 409) {
        const raced = await lookup();
        if (!raced) throw new StoreError('store_conflict', 409);
        await patch(raced);
        return { created: false };
      }
      return { created: true };
    },

    async setAgeRating(appInfoId, attributes) {
      const found = await call(
        'GET',
        `/v1/appInfos/${encodeURIComponent(appInfoId)}/ageRatingDeclaration`,
      );
      const id = asString(asRecord(found.data.data).id);
      if (!id) throw new StoreError('store_bad_answer', found.status);
      await call('PATCH', `/v1/ageRatingDeclarations/${encodeURIComponent(id)}`, {
        data: { type: 'ageRatingDeclarations', id, attributes },
      });
    },

    async upsertDemoAccount(versionId, detail) {
      const lookup = async (): Promise<string | null> => {
        const found = await call(
          'GET',
          `/v1/appStoreVersions/${encodeURIComponent(versionId)}/appStoreReviewDetail`,
          undefined,
          [200, 404],
        );
        return asString(asRecord(found.data.data).id);
      };
      const attributes = { ...detail, demoAccountRequired: true };
      const patch = (id: string) =>
        call('PATCH', `/v1/appStoreReviewDetails/${encodeURIComponent(id)}`, {
          data: { type: 'appStoreReviewDetails', id, attributes },
        });
      const existing = await lookup();
      if (existing) {
        await patch(existing);
        return { created: false };
      }
      const made = await call(
        'POST',
        '/v1/appStoreReviewDetails',
        {
          data: {
            type: 'appStoreReviewDetails',
            attributes,
            relationships: {
              appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
            },
          },
        },
        [200, 201, 409],
      );
      if (made.status === 409) {
        const raced = await lookup();
        if (!raced) throw new StoreError('store_conflict', 409);
        await patch(raced);
        return { created: false };
      }
      return { created: true };
    },
  };
}
