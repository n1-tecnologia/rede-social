import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadJose } from './jose-loader';

/**
 * Local fake App Store Connect, Google Play and Google token servers (13-29, D-619). The dry run and every test
 * of the store clients talk to these, on loopback, and nowhere else: nothing here reaches a real Apple, Google or
 * Firebase host. The state is in memory and the counters answer the idempotency questions ("one bundle id, one
 * certificate, one profile after two runs"). The fakes check what a real store checks about a request (a bearer
 * token that is well formed, an ES256 token that lives at most 20 minutes, a JWT-bearer assertion for the right
 * audience and scope), and verify signatures when the test hands them the matching public keys. They record
 * method and path only: never a header value, a body or a token.
 */

export type FakeStoreOptions = {
  /** Bundle identifiers that have an app record in the fake App Store Connect; `'all'` = every registered one. */
  appRecords?: 'all' | readonly string[];
  /** Package names known to the fake Play Console; `'all'` = any. */
  playPackages?: 'all' | readonly string[];
  /** kid to SPKI PEM: when a token's kid is listed, its signature is verified. */
  appleKeys?: Readonly<Record<string, string>>;
  /** service-account e-mail to SPKI PEM: the assertion's signature is verified when listed. */
  googleAccounts?: Readonly<Record<string, string>>;
};

export type FakeCounts = {
  bundleIds: number;
  capabilities: number;
  certificates: number;
  profiles: number;
  profileCreates: number;
  edits: number;
  committedEdits: number;
  deletedEdits: number;
  bundlesUploaded: number;
  tokenExchanges: number;
  internalTrackUpdates: number;
  otherTrackUpdates: number;
  reviewSubmissions: number;
  /** Listing (13-31): rows the fakes hold after any number of pushes. */
  versionLocalizations: number;
  appInfoLocalizations: number;
  reviewDetails: number;
  playListingUpdates: number;
  playIcons: number;
};

/** What the fake stores hold for the listing (13-31). A deep copy, so a test can compare two snapshots. */
export type ListingSnapshot = {
  apple: {
    versionLocalizations: {
      id: string;
      locale: string;
      description: string;
      keywords: string;
      supportUrl: string;
    }[];
    appInfoLocalizations: { id: string; locale: string; name: string; privacyPolicyUrl: string }[];
    ageRatings: Record<string, Record<string, unknown>>;
    reviewDetails: { id: string; versionId: string; attributes: Record<string, unknown> }[];
  };
  google: {
    listings: Record<string, { title: string; shortDescription: string; fullDescription: string }>;
    details: Record<
      string,
      { contactEmail: string; contactWebsite: string; defaultLanguage: string }
    >;
    /** The byte length of each icon held, per `package:language`. */
    icons: Record<string, number[]>;
  };
};

export type FakeRequest = { service: 'apple' | 'google' | 'token'; method: string; path: string };

export type FakeStores = {
  apple: { origin: string };
  google: { origin: string; tokenOrigin: string };
  counts(): FakeCounts;
  requests(): readonly FakeRequest[];
  /** What the last App Store Connect token carried (key id, issuer, lifetime), for assertions. */
  lastAppleToken(): { kid: string; iss: string; lifetimeSeconds: number; issuedAt: number } | null;
  /** The track updates the fake Play saw, as `{ track, status, versionCodes }`. */
  trackUpdates(): readonly { track: string; status: string; versionCodes: string[] }[];
  /** The listing state of both fakes, as plain data. */
  listing(): ListingSnapshot;
  /** Simulates the upload of a build (done by the workflow's own step) so it can be polled. */
  markBuildUploaded(bundleIdentifier: string, buildNumber: number, state?: string): void;
  close(): Promise<void>;
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const parseJsonBody = (buffer: Buffer): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const listen = (server: Server): Promise<string> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });

export async function createFakeStores(options: FakeStoreOptions = {}): Promise<FakeStores> {
  const jose = loadJose();
  const requests: FakeRequest[] = [];
  const counts: FakeCounts = {
    bundleIds: 0,
    capabilities: 0,
    certificates: 0,
    profiles: 0,
    profileCreates: 0,
    edits: 0,
    committedEdits: 0,
    deletedEdits: 0,
    bundlesUploaded: 0,
    tokenExchanges: 0,
    internalTrackUpdates: 0,
    otherTrackUpdates: 0,
    reviewSubmissions: 0,
    versionLocalizations: 0,
    appInfoLocalizations: 0,
    reviewDetails: 0,
    playListingUpdates: 0,
    playIcons: 0,
  };
  let lastAppleToken: {
    kid: string;
    iss: string;
    lifetimeSeconds: number;
    issuedAt: number;
  } | null = null;
  const trackUpdates: { track: string; status: string; versionCodes: string[] }[] = [];

  // --- App Store Connect state ---
  type Bundle = { id: string; identifier: string; name: string; capabilities: Set<string> };
  const bundles = new Map<string, Bundle>();
  const certificates = new Map<string, { id: string; content: string }>();
  const profiles = new Map<string, { id: string; name: string; content: string; state: string }>();
  const builds = new Map<string, { id: string; state: string }>();
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}${++sequence}`;
  // Listing state (13-31). The version and the app info of an app exist as soon as its app record does.
  const versionLocalizations = new Map<
    string,
    {
      id: string;
      versionId: string;
      locale: string;
      description: string;
      keywords: string;
      supportUrl: string;
    }
  >();
  const appInfoLocalizations = new Map<
    string,
    { id: string; infoId: string; locale: string; name: string; privacyPolicyUrl: string }
  >();
  const ageRatings = new Map<string, Record<string, unknown>>();
  const reviewDetails = new Map<
    string,
    { id: string; versionId: string; attributes: Record<string, unknown> }
  >();
  const versionIdOf = (appId: string) => `ver-${appId}`;
  const infoIdOf = (appId: string) => `info-${appId}`;
  const ageRatingIdOf = (infoId: string) => `age-${infoId}`;
  const appKnown = (appId: string) => appId.startsWith('app-') && hasAppRecord(appId.slice(4));
  const entityError = () => ({ errors: [{ code: 'ENTITY_ERROR' }] });
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const appIdOf = (identifier: string) => `app-${identifier}`;
  /** Bundle identifiers a build was uploaded for: such an app necessarily has an app record. */
  const uploadedApps = new Set<string>();
  const hasAppRecord = (identifier: string): boolean => {
    const records = options.appRecords ?? 'all';
    if (records === 'all') {
      return (
        uploadedApps.has(identifier) ||
        [...bundles.values()].some((b) => b.identifier === identifier)
      );
    }
    return records.includes(identifier);
  };

  async function appleAuthorized(req: IncomingMessage): Promise<boolean> {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) return false;
    const token = header.slice(7);
    try {
      const protectedHeader = jose.decodeProtectedHeader(token);
      const claims = jose.decodeJwt(token);
      const kid = typeof protectedHeader.kid === 'string' ? protectedHeader.kid : '';
      const iss = typeof claims.iss === 'string' ? claims.iss : '';
      const iat = Number(claims.iat);
      const exp = Number(claims.exp);
      if (protectedHeader.alg !== 'ES256' || kid === '' || iss === '') return false;
      if (claims.aud !== 'appstoreconnect-v1') return false;
      if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp - iat > 1200) return false;
      const publicKey = options.appleKeys?.[kid];
      if (publicKey) {
        await jose.jwtVerify(token, await jose.importSPKI(publicKey, 'ES256'), {
          audience: 'appstoreconnect-v1',
          clockTolerance: 86_400 * 365,
        });
      }
      lastAppleToken = { kid, iss, lifetimeSeconds: exp - iat, issuedAt: iat };
      return true;
    } catch {
      return false;
    }
  }

  const resource = (type: string, id: string, attributes: Record<string, unknown>) => ({
    type,
    id,
    attributes,
  });

  async function apple(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake');
    const method = req.method ?? 'GET';
    requests.push({ service: 'apple', method, path: url.pathname });
    if (!(await appleAuthorized(req)))
      return json(res, 401, { errors: [{ code: 'NOT_AUTHORIZED' }] });
    const body = parseJsonBody(await readBody(req));
    const data = asObject(body.data);
    const attributes = asObject(data.attributes);
    const path = url.pathname;
    const segments = path.split('/').filter(Boolean);

    if (path === '/v1/bundleIds' && method === 'GET') {
      const wanted = url.searchParams.get('filter[identifier]');
      const list = [...bundles.values()].filter(
        (b) => wanted === null || b.identifier.startsWith(wanted),
      );
      return json(res, 200, {
        data: list.map((b) =>
          resource('bundleIds', b.id, { identifier: b.identifier, name: b.name, platform: 'IOS' }),
        ),
      });
    }
    if (path === '/v1/bundleIds' && method === 'POST') {
      const identifier = String(attributes.identifier ?? '');
      if ([...bundles.values()].some((b) => b.identifier === identifier)) {
        return json(res, 409, { errors: [{ code: 'ENTITY_ERROR' }] });
      }
      const bundle: Bundle = {
        id: nextId('bid'),
        identifier,
        name: String(attributes.name ?? ''),
        capabilities: new Set(),
      };
      bundles.set(bundle.id, bundle);
      counts.bundleIds += 1;
      return json(res, 201, {
        data: resource('bundleIds', bundle.id, { identifier, name: bundle.name, platform: 'IOS' }),
      });
    }
    if (
      segments[0] === 'v1' &&
      segments[1] === 'bundleIds' &&
      segments[3] === 'bundleIdCapabilities' &&
      method === 'GET'
    ) {
      const bundle = bundles.get(segments[2] ?? '');
      if (!bundle) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      return json(res, 200, {
        data: [...bundle.capabilities].map((c) =>
          resource('bundleIdCapabilities', `${bundle.id}-${c}`, { capabilityType: c }),
        ),
      });
    }
    if (path === '/v1/bundleIdCapabilities' && method === 'POST') {
      const relation = asObject(asObject(asObject(data.relationships).bundleId).data);
      const bundle = bundles.get(String(relation.id ?? ''));
      if (!bundle) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      const type = String(attributes.capabilityType ?? '');
      if (bundle.capabilities.has(type))
        return json(res, 409, { errors: [{ code: 'ENTITY_ERROR' }] });
      bundle.capabilities.add(type);
      counts.capabilities += 1;
      return json(res, 201, {
        data: resource('bundleIdCapabilities', `${bundle.id}-${type}`, { capabilityType: type }),
      });
    }
    if (path === '/v1/certificates' && method === 'POST') {
      if (typeof attributes.csrContent !== 'string' || attributes.csrContent === '') {
        return json(res, 409, { errors: [{ code: 'ENTITY_ERROR' }] });
      }
      const id = nextId('cert');
      const content = Buffer.from(`fake-certificate-${id}`).toString('base64');
      certificates.set(id, { id, content });
      counts.certificates += 1;
      return json(res, 201, {
        data: resource('certificates', id, {
          certificateType: 'IOS_DISTRIBUTION',
          certificateContent: content,
        }),
      });
    }
    if (path === '/v1/profiles' && method === 'GET') {
      const name = url.searchParams.get('filter[name]');
      const list = [...profiles.values()].filter((p) => name === null || p.name === name);
      return json(res, 200, {
        data: list.map((p) =>
          resource('profiles', p.id, {
            name: p.name,
            profileState: p.state,
            profileContent: p.content,
          }),
        ),
      });
    }
    if (path === '/v1/profiles' && method === 'POST') {
      const relationships = asObject(data.relationships);
      const bundle = bundles.get(String(asObject(asObject(relationships.bundleId).data).id ?? ''));
      const certificateRefs = asObject(relationships.certificates).data;
      const certificateId = String(
        asObject(Array.isArray(certificateRefs) ? certificateRefs[0] : null).id ?? '',
      );
      if (!bundle || !certificates.has(certificateId))
        return json(res, 409, { errors: [{ code: 'ENTITY_ERROR' }] });
      const name = String(attributes.name ?? '');
      if ([...profiles.values()].some((p) => p.name === name))
        return json(res, 409, { errors: [{ code: 'ENTITY_ERROR' }] });
      const id = nextId('prof');
      const content = Buffer.from(`fake-profile-${id}`).toString('base64');
      profiles.set(id, { id, name, content, state: 'ACTIVE' });
      counts.profiles += 1;
      counts.profileCreates += 1;
      return json(res, 201, {
        data: resource('profiles', id, { name, profileState: 'ACTIVE', profileContent: content }),
      });
    }
    if (segments[0] === 'v1' && segments[1] === 'profiles' && method === 'DELETE') {
      const removed = profiles.delete(segments[2] ?? '');
      if (removed) counts.profiles -= 1;
      return json(res, removed ? 204 : 404, undefined);
    }
    if (path === '/v1/apps' && method === 'GET') {
      const wanted = url.searchParams.get('filter[bundleId]') ?? '';
      return json(res, 200, {
        data: hasAppRecord(wanted) ? [resource('apps', appIdOf(wanted), { bundleId: wanted })] : [],
      });
    }
    if (path === '/v1/builds' && method === 'GET') {
      const app = url.searchParams.get('filter[app]') ?? '';
      const version = url.searchParams.get('filter[version]') ?? '';
      const found = builds.get(`${app}:${version}`);
      return json(res, 200, {
        data: found
          ? [resource('builds', found.id, { version, processingState: found.state })]
          : [],
      });
    }
    if (path === '/v1/betaGroups' && method === 'GET') {
      return json(res, 200, {
        data: [resource('betaGroups', 'group-internal', { isInternalGroup: true })],
      });
    }
    if (
      segments[0] === 'v1' &&
      segments[1] === 'betaGroups' &&
      segments[3] === 'relationships' &&
      method === 'POST'
    ) {
      return json(res, 204, undefined);
    }
    // --- The listing (13-31): version, app info, localizations, age rating and App Review detail ---
    if (
      segments[0] === 'v1' &&
      segments[1] === 'apps' &&
      segments[3] === 'appStoreVersions' &&
      method === 'GET'
    ) {
      const appId = decodeURIComponent(segments[2] ?? '');
      return json(res, 200, {
        data: appKnown(appId)
          ? [
              resource('appStoreVersions', versionIdOf(appId), {
                appStoreState: 'PREPARE_FOR_SUBMISSION',
                platform: 'IOS',
              }),
            ]
          : [],
      });
    }
    if (
      segments[0] === 'v1' &&
      segments[1] === 'apps' &&
      segments[3] === 'appInfos' &&
      method === 'GET'
    ) {
      const appId = decodeURIComponent(segments[2] ?? '');
      return json(res, 200, {
        data: appKnown(appId) ? [resource('appInfos', infoIdOf(appId), {})] : [],
      });
    }
    const versionOk = (id: string) => id.startsWith('ver-') && appKnown(id.slice(4));
    const infoOk = (id: string) => id.startsWith('info-') && appKnown(id.slice(5));
    if (
      segments[0] === 'v1' &&
      segments[1] === 'appStoreVersions' &&
      segments[3] === 'appStoreVersionLocalizations' &&
      method === 'GET'
    ) {
      const versionId = decodeURIComponent(segments[2] ?? '');
      if (!versionOk(versionId)) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      const locale = url.searchParams.get('filter[locale]');
      return json(res, 200, {
        data: [...versionLocalizations.values()]
          .filter(
            (row) => row.versionId === versionId && (locale === null || row.locale === locale),
          )
          .map((row) => resource('appStoreVersionLocalizations', row.id, { locale: row.locale })),
      });
    }
    const checkVersionText = (attrs: Record<string, unknown>): boolean => {
      if ('description' in attrs && [...text(attrs.description)].length > 4000) return false;
      if ('keywords' in attrs && Buffer.byteLength(text(attrs.keywords), 'utf8') > 100)
        return false;
      if ('supportUrl' in attrs && !text(attrs.supportUrl).startsWith('https://')) return false;
      return true;
    };
    if (path === '/v1/appStoreVersionLocalizations' && method === 'POST') {
      const versionId = String(
        asObject(asObject(asObject(data.relationships).appStoreVersion).data).id ?? '',
      );
      const locale = text(attributes.locale);
      if (!versionOk(versionId) || locale === '' || !checkVersionText(attributes)) {
        return json(res, 409, entityError());
      }
      if (
        [...versionLocalizations.values()].some(
          (row) => row.versionId === versionId && row.locale === locale,
        )
      ) {
        return json(res, 409, entityError());
      }
      const row = {
        id: nextId('vloc'),
        versionId,
        locale,
        description: text(attributes.description),
        keywords: text(attributes.keywords),
        supportUrl: text(attributes.supportUrl),
      };
      versionLocalizations.set(row.id, row);
      counts.versionLocalizations += 1;
      return json(res, 201, { data: resource('appStoreVersionLocalizations', row.id, { locale }) });
    }
    if (
      segments[0] === 'v1' &&
      segments[1] === 'appStoreVersionLocalizations' &&
      method === 'PATCH'
    ) {
      const row = versionLocalizations.get(decodeURIComponent(segments[2] ?? ''));
      if (!row) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      if (!checkVersionText(attributes)) return json(res, 409, entityError());
      if ('description' in attributes) row.description = text(attributes.description);
      if ('keywords' in attributes) row.keywords = text(attributes.keywords);
      if ('supportUrl' in attributes) row.supportUrl = text(attributes.supportUrl);
      return json(res, 200, {
        data: resource('appStoreVersionLocalizations', row.id, { locale: row.locale }),
      });
    }
    if (
      segments[0] === 'v1' &&
      segments[1] === 'appInfos' &&
      segments[3] === 'appInfoLocalizations' &&
      method === 'GET'
    ) {
      const infoId = decodeURIComponent(segments[2] ?? '');
      if (!infoOk(infoId)) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      const locale = url.searchParams.get('filter[locale]');
      return json(res, 200, {
        data: [...appInfoLocalizations.values()]
          .filter((row) => row.infoId === infoId && (locale === null || row.locale === locale))
          .map((row) => resource('appInfoLocalizations', row.id, { locale: row.locale })),
      });
    }
    if (path === '/v1/appInfoLocalizations' && method === 'POST') {
      const infoId = String(asObject(asObject(asObject(data.relationships).appInfo).data).id ?? '');
      const locale = text(attributes.locale);
      if (!infoOk(infoId) || locale === '' || text(attributes.name) === '') {
        return json(res, 409, entityError());
      }
      if (!text(attributes.privacyPolicyUrl).startsWith('https://'))
        return json(res, 409, entityError());
      if (
        [...appInfoLocalizations.values()].some(
          (row) => row.infoId === infoId && row.locale === locale,
        )
      ) {
        return json(res, 409, entityError());
      }
      const row = {
        id: nextId('iloc'),
        infoId,
        locale,
        name: text(attributes.name),
        privacyPolicyUrl: text(attributes.privacyPolicyUrl),
      };
      appInfoLocalizations.set(row.id, row);
      counts.appInfoLocalizations += 1;
      return json(res, 201, { data: resource('appInfoLocalizations', row.id, { locale }) });
    }
    if (segments[0] === 'v1' && segments[1] === 'appInfoLocalizations' && method === 'PATCH') {
      const row = appInfoLocalizations.get(decodeURIComponent(segments[2] ?? ''));
      if (!row) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      if ('privacyPolicyUrl' in attributes) {
        if (!text(attributes.privacyPolicyUrl).startsWith('https://'))
          return json(res, 409, entityError());
        row.privacyPolicyUrl = text(attributes.privacyPolicyUrl);
      }
      return json(res, 200, {
        data: resource('appInfoLocalizations', row.id, { locale: row.locale }),
      });
    }
    if (
      segments[0] === 'v1' &&
      segments[1] === 'appInfos' &&
      segments[3] === 'ageRatingDeclaration' &&
      method === 'GET'
    ) {
      const infoId = decodeURIComponent(segments[2] ?? '');
      if (!infoOk(infoId)) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      return json(res, 200, { data: resource('ageRatingDeclarations', ageRatingIdOf(infoId), {}) });
    }
    if (segments[0] === 'v1' && segments[1] === 'ageRatingDeclarations' && method === 'PATCH') {
      const id = decodeURIComponent(segments[2] ?? '');
      if (!id.startsWith('age-') || !infoOk(id.slice(4))) {
        return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      }
      ageRatings.set(id.slice(4), { ...(ageRatings.get(id.slice(4)) ?? {}), ...attributes });
      return json(res, 200, { data: resource('ageRatingDeclarations', id, {}) });
    }
    if (
      segments[0] === 'v1' &&
      segments[1] === 'appStoreVersions' &&
      segments[3] === 'appStoreReviewDetail' &&
      method === 'GET'
    ) {
      const versionId = decodeURIComponent(segments[2] ?? '');
      if (!versionOk(versionId)) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      const found = reviewDetails.get(versionId);
      return json(res, 200, {
        data: found ? resource('appStoreReviewDetails', found.id, {}) : null,
      });
    }
    const checkReviewDetail = (attrs: Record<string, unknown>): boolean =>
      !('notes' in attrs) || [...text(attrs.notes)].length <= 4000;
    if (path === '/v1/appStoreReviewDetails' && method === 'POST') {
      const versionId = String(
        asObject(asObject(asObject(data.relationships).appStoreVersion).data).id ?? '',
      );
      if (!versionOk(versionId) || !checkReviewDetail(attributes))
        return json(res, 409, entityError());
      if (reviewDetails.has(versionId)) return json(res, 409, entityError());
      const row = { id: nextId('rev'), versionId, attributes: { ...attributes } };
      reviewDetails.set(versionId, row);
      counts.reviewDetails += 1;
      return json(res, 201, { data: resource('appStoreReviewDetails', row.id, {}) });
    }
    if (segments[0] === 'v1' && segments[1] === 'appStoreReviewDetails' && method === 'PATCH') {
      const id = decodeURIComponent(segments[2] ?? '');
      const row = [...reviewDetails.values()].find((candidate) => candidate.id === id);
      if (!row) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      if (!checkReviewDetail(attributes)) return json(res, 409, entityError());
      row.attributes = { ...row.attributes, ...attributes };
      return json(res, 200, { data: resource('appStoreReviewDetails', row.id, {}) });
    }
    if (path === '/v1/reviewSubmissions') {
      counts.reviewSubmissions += 1;
      return json(res, 403, { errors: [{ code: 'FORBIDDEN' }] });
    }
    return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
  }

  // --- Google state ---
  const accessTokens = new Set<string>();
  type PlayListing = { title: string; shortDescription: string; fullDescription: string };
  type PlayDetails = { contactEmail: string; contactWebsite: string; defaultLanguage: string };
  /** What an edit changes. Like the real Play, it takes effect only when the edit is committed (13-31). */
  type EditChanges = {
    listings: Map<string, PlayListing>;
    details: PlayDetails | null;
    /** `null` = the icon of that language was removed in this edit; an array = the icons it uploaded. */
    icons: Map<string, number[] | null>;
  };
  const edits = new Map<
    string,
    { packageName: string; state: 'open' | 'committed'; changes: EditChanges }
  >();
  // Committed listing state, per package (13-31).
  const playListings = new Map<string, PlayListing>(); // key: `${package}:${language}`
  const playDetails = new Map<string, PlayDetails>(); // key: package
  const playIcons = new Map<string, number[]>(); // key: `${package}:${language}`
  const iconsHeld = () => [...playIcons.values()].reduce((sum, list) => sum + list.length, 0);
  let versionCode = 0;
  let tokenOrigin = '';

  const packageKnown = (name: string): boolean => {
    const packages = options.playPackages ?? 'all';
    return packages === 'all' || packages.includes(name);
  };

  async function googleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake');
    requests.push({ service: 'token', method: req.method ?? 'GET', path: url.pathname });
    const form = new URLSearchParams((await readBody(req)).toString('utf8'));
    const assertion = form.get('assertion') ?? '';
    try {
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer')
        throw new Error('grant');
      const claims = jose.decodeJwt(assertion);
      const iss = typeof claims.iss === 'string' ? claims.iss : '';
      if (iss === '' || claims.aud !== `${tokenOrigin}/token`) throw new Error('claims');
      if (!String(claims.scope ?? '').includes('androidpublisher')) throw new Error('scope');
      const publicKey = options.googleAccounts?.[iss];
      if (publicKey) {
        await jose.jwtVerify(assertion, await jose.importSPKI(publicKey, 'RS256'), {
          audience: `${tokenOrigin}/token`,
          clockTolerance: 86_400 * 365,
        });
      }
    } catch {
      return json(res, 400, { error: 'invalid_grant' });
    }
    counts.tokenExchanges += 1;
    const accessToken = `fake-google-access-${counts.tokenExchanges}`;
    accessTokens.add(accessToken);
    return json(res, 200, { access_token: accessToken, expires_in: 3600, token_type: 'Bearer' });
  }

  async function google(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake');
    const method = req.method ?? 'GET';
    requests.push({ service: 'google', method, path: url.pathname });
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!accessTokens.has(bearer)) return json(res, 401, { error: { code: 401 } });
    const rawBody = await readBody(req);
    const path = url.pathname;
    const match = path.match(
      /^\/(upload\/)?androidpublisher\/v3\/applications\/([^/]+)\/edits(?:\/([^/:]+)(?::(validate|commit))?)?(?:\/(bundles|tracks\/[^/]+|details|listings\/[^/]+(?:\/icon)?))?$/,
    );
    if (!match) return json(res, 404, { error: { code: 404 } });
    const [, , rawPackage, editId, action, sub] = match;
    const packageName = decodeURIComponent(rawPackage ?? '');
    if (!packageKnown(packageName)) return json(res, 404, { error: { code: 404 } });

    if (!editId && method === 'POST') {
      const id = `edit-${++sequence}`;
      edits.set(id, {
        packageName,
        state: 'open',
        changes: { listings: new Map(), details: null, icons: new Map() },
      });
      counts.edits += 1;
      return json(res, 200, {
        id,
        expiryTimeSeconds: String(Math.floor(Date.now() / 1000) + 3600),
      });
    }
    const edit = edits.get(editId ?? '');
    if (!edit || edit.packageName !== packageName || edit.state !== 'open') {
      return json(res, 404, { error: { code: 404 } });
    }
    if (method === 'DELETE' && !sub && !action) {
      edits.delete(editId ?? '');
      counts.deletedEdits += 1;
      return json(res, 204, undefined);
    }
    if (method === 'POST' && sub === 'bundles') {
      if (rawBody.length === 0) return json(res, 400, { error: { code: 400 } });
      versionCode += 1;
      counts.bundlesUploaded += 1;
      return json(res, 200, { versionCode });
    }
    if (method === 'PUT' && sub?.startsWith('tracks/')) {
      const track = sub.slice('tracks/'.length);
      const body = parseJsonBody(rawBody);
      const release = asObject(Array.isArray(body.releases) ? body.releases[0] : null);
      const codes = Array.isArray(release.versionCodes) ? release.versionCodes.map(String) : [];
      trackUpdates.push({ track, status: String(release.status ?? ''), versionCodes: codes });
      if (track === 'internal') counts.internalTrackUpdates += 1;
      else counts.otherTrackUpdates += 1;
      return json(res, 200, { track, releases: body.releases ?? [] });
    }
    if (method === 'PUT' && sub?.startsWith('listings/') && !sub.endsWith('/icon')) {
      const language = decodeURIComponent(sub.slice('listings/'.length));
      const body = parseJsonBody(rawBody);
      const title = text(body.title);
      const shortDescription = text(body.shortDescription);
      const fullDescription = text(body.fullDescription);
      const tooLong =
        [...title].length > 30 ||
        [...shortDescription].length > 80 ||
        [...fullDescription].length > 4000;
      if (title === '' || tooLong) return json(res, 400, { error: { code: 400 } });
      edit.changes.listings.set(language, { title, shortDescription, fullDescription });
      counts.playListingUpdates += 1;
      return json(res, 200, { language, title, shortDescription, fullDescription });
    }
    if (method === 'PUT' && sub === 'details') {
      const body = parseJsonBody(rawBody);
      const contactEmail = text(body.contactEmail);
      const contactWebsite = text(body.contactWebsite);
      const defaultLanguage = text(body.defaultLanguage);
      if (
        !contactEmail.includes('@') ||
        !contactWebsite.startsWith('https://') ||
        defaultLanguage === ''
      ) {
        return json(res, 400, { error: { code: 400 } });
      }
      edit.changes.details = { contactEmail, contactWebsite, defaultLanguage };
      return json(res, 200, { contactEmail, contactWebsite, defaultLanguage });
    }
    if (sub?.startsWith('listings/') && sub.endsWith('/icon')) {
      const language = decodeURIComponent(sub.slice('listings/'.length, -'/icon'.length));
      if (method === 'DELETE') {
        edit.changes.icons.set(language, null);
        return json(res, 200, { deleted: [] });
      }
      if (method === 'POST') {
        const type = String(req.headers['content-type'] ?? '');
        if (!type.startsWith('image/png') || rawBody.length === 0) {
          return json(res, 400, { error: { code: 400 } });
        }
        const staged = edit.changes.icons.get(language);
        edit.changes.icons.set(language, [...(staged ?? []), rawBody.length]);
        return json(res, 200, { image: { id: `icon-${rawBody.length}` } });
      }
    }
    if (method === 'POST' && action === 'validate') return json(res, 200, { id: editId });
    if (method === 'POST' && action === 'commit') {
      for (const [language, listing] of edit.changes.listings) {
        playListings.set(`${packageName}:${language}`, listing);
      }
      if (edit.changes.details) playDetails.set(packageName, edit.changes.details);
      for (const [language, icons] of edit.changes.icons) {
        if (icons === null) playIcons.delete(`${packageName}:${language}`);
        else playIcons.set(`${packageName}:${language}`, icons);
      }
      counts.playIcons = iconsHeld();
      edit.state = 'committed';
      counts.committedEdits += 1;
      return json(res, 200, { id: editId });
    }
    return json(res, 404, { error: { code: 404 } });
  }

  const guarded =
    (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
    (req: IncomingMessage, res: ServerResponse) => {
      handler(req, res).catch(() => {
        if (!res.headersSent) json(res, 500, { error: 'fake_failure' });
        else res.end();
      });
    };

  const appleServer = createServer(guarded(apple));
  const googleServer = createServer(guarded(google));
  const tokenServer = createServer(guarded(googleToken));
  const [appleOrigin, googleOrigin, tokenServerOrigin] = await Promise.all([
    listen(appleServer),
    listen(googleServer),
    listen(tokenServer),
  ]);
  tokenOrigin = tokenServerOrigin;

  return {
    apple: { origin: appleOrigin },
    google: { origin: googleOrigin, tokenOrigin: tokenServerOrigin },
    counts: () => ({ ...counts }),
    requests: () => [...requests],
    lastAppleToken: () => lastAppleToken,
    trackUpdates: () => [...trackUpdates],
    listing: (): ListingSnapshot => ({
      apple: {
        versionLocalizations: [...versionLocalizations.values()].map(
          ({ id, locale, description, keywords, supportUrl }) => ({
            id,
            locale,
            description,
            keywords,
            supportUrl,
          }),
        ),
        appInfoLocalizations: [...appInfoLocalizations.values()].map(
          ({ id, locale, name, privacyPolicyUrl }) => ({ id, locale, name, privacyPolicyUrl }),
        ),
        ageRatings: Object.fromEntries([...ageRatings].map(([id, value]) => [id, { ...value }])),
        reviewDetails: [...reviewDetails.values()].map((row) => ({
          id: row.id,
          versionId: row.versionId,
          attributes: { ...row.attributes },
        })),
      },
      google: {
        listings: Object.fromEntries([...playListings].map(([key, value]) => [key, { ...value }])),
        details: Object.fromEntries([...playDetails].map(([key, value]) => [key, { ...value }])),
        icons: Object.fromEntries([...playIcons].map(([key, value]) => [key, [...value]])),
      },
    }),
    markBuildUploaded(bundleIdentifier, buildNumber, state = 'VALID') {
      uploadedApps.add(bundleIdentifier);
      builds.set(`${appIdOf(bundleIdentifier)}:${buildNumber}`, { id: nextId('build'), state });
    },
    close: () =>
      Promise.all(
        [appleServer, googleServer, tokenServer].map(
          (server) => new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      ).then(() => undefined),
  };
}
