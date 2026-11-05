import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { AppTab } from '@rede-social/contracts/native';
import type { TenantRecord } from './config';

/** Test helpers (13-29): a tenant record and fresh store keys. Nothing here touches the network or a database. */

type TabPatch = {
  bundleId?: string | null;
  applicationId?: string | null;
  teamId?: string | null;
  shortName?: string;
  held?: readonly string[];
  manual?: Partial<Record<'appleAccount' | 'playAccount', boolean>>;
  lastIos?: { version: string; buildNumber: number } | null;
  lastAndroid?: { version: string; buildNumber: number } | null;
};

/** Only the fields the release command reads, in the shape the kernel's `buildAppTab` answers. */
export function tabOf(patch: TabPatch = {}): AppTab {
  const held = new Set(patch.held ?? ['asc_key', 'apns_key', 'play_service_account']);
  const at = '2026-11-01T00:00:00.000Z';
  return {
    appState: 'preparing',
    identity: {
      displayName: 'x',
      shortName: { name: patch.shortName ?? 'Comunidade', cut: false },
      host: 'comunidade.cliente.test',
      bundleId: patch.bundleId === undefined ? 'test.cliente.comunidade' : patch.bundleId,
      applicationId:
        patch.applicationId === undefined ? 'test.cliente.comunidade' : patch.applicationId,
      idsLocked: false,
      idsDefault: true,
      lastBuild: {
        ios: patch.lastIos ? { ...patch.lastIos, at } : null,
        android: patch.lastAndroid ? { ...patch.lastAndroid, at } : null,
      },
    },
    credentials: (['asc_key', 'play_service_account', 'apns_key'] as const).map((kind) => ({
      kind,
      held: held.has(kind),
      heldAt: held.has(kind) ? at : null,
    })),
    links: {
      teamId: patch.teamId === undefined ? null : patch.teamId,
      fingerprint: null,
      verdict: { ios: 'missing_team', android: 'missing_fingerprint' },
    },
    purchase: { ios: false, android: false },
    listing: {
      name: { name: 'x', cut: false },
      description: null,
      ageRating: null,
      privacyUrl: null,
      reviewerEmail: null,
      reviewerHeld: false,
    },
    checklist: {
      done: 0,
      total: 10,
      auto: { storeKeys: true, apnsKey: true, links: false, privacyUrl: false, reviewer: false },
      manual: {
        appleAccount: patch.manual?.appleAccount ?? true,
        playAccount: patch.manual?.playAccount ?? true,
        screenshots: false,
        submitted: false,
        published: false,
      },
    },
  } as unknown as AppTab;
}

export const SVG_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="96" fill="#d9480f"/><rect x="96" y="96" width="64" height="64" fill="#ffffff"/></svg>';

export const BRANDING = {
  logoUrl: '/seed-logos/comunidade.svg',
  colors: { primary: '#d9480f', secondary: '#1c7ed6' },
};

export function tenantOf(patch: Partial<TenantRecord> & { tab?: AppTab } = {}): TenantRecord {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    slug: 'comunidade',
    displayName: 'Comunidade Cliente',
    branding: BRANDING,
    primaryHost: 'comunidade.cliente.test',
    hosts: ['comunidade.cliente.test', 'www.cliente.test'],
    tab: tabOf(),
    storeUrls: { ios: null, android: null },
    ...patch,
  };
}

/** An Apple `.p8`: EC P-256, PKCS8 PEM, plus its public half for the fake to verify against. */
export function appleKeyPair(): { p8: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    p8: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** A Google service account JSON with a real RSA key, plus its public half. */
export function serviceAccount(email = 'release@project.iam.test'): {
  json: string;
  email: string;
  publicKey: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const json = JSON.stringify({
    type: 'service_account',
    client_email: email,
    private_key_id: 'key-id-0001',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  return { json, email, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

/**
 * AES-256-GCM with the caller's AAD, the same construction as the kernel's `sealed.ts`, so the unit tests can seal
 * and open without loading the kernel environment. What matters here is that the AAD is `<rowId>:<kind>`.
 */
export function testSealing(key: Buffer = randomBytes(32)) {
  return {
    seal(plain: string, aad: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad));
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return `t1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${body.toString('base64url')}`;
    },
    open(sealed: string, aad: string): string {
      const [, iv, tag, body] = sealed.split(':');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv ?? '', 'base64url'));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(tag ?? '', 'base64url'));
      try {
        return Buffer.concat([
          decipher.update(Buffer.from(body ?? '', 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        throw new Error('sealed value unreadable');
      }
    },
  };
}
