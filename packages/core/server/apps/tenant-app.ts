import type { AppTab } from '@rede-social/contracts/native';
import type { CredentialStore } from './credentials';

/**
 * RED stub (13-09): the row shape and the empty form are real; the reads and writes are inert so the failing
 * tests can load. Replaced in the GREEN commit.
 */
export type AppRow = {
  tenantId: string;
  bundleId: string | null;
  applicationId: string | null;
  idsLockedAt: Date | null;
  teamId: string | null;
  androidSha256: string[];
  purchaseIos: boolean;
  purchaseAndroid: boolean;
  privacyUrl: string | null;
  lastIosVersion: string | null;
  lastIosBuild: number | null;
  lastIosAt: Date | null;
  lastAndroidVersion: string | null;
  lastAndroidBuild: number | null;
  lastAndroidAt: Date | null;
  manualAppleAccount: boolean;
  manualPlayAccount: boolean;
  manualScreenshots: boolean;
  manualSubmitted: boolean;
  manualPublished: boolean;
  reviewerEmail: string | null;
};
export type AppPatch = Partial<Omit<AppRow, 'tenantId'>>;
export type TenantFacts = { displayName: string; primaryHost: string | null };
export type AppStore = {
  facts(tenantId: string): Promise<TenantFacts | null>;
  read(tenantId: string): Promise<AppRow | null>;
  write(tenantId: string, change: (current: AppRow) => AppPatch): Promise<void>;
};

export const emptyAppRow = (tenantId: string): AppRow => ({
  tenantId,
  bundleId: null,
  applicationId: null,
  idsLockedAt: null,
  teamId: null,
  androidSha256: [],
  purchaseIos: false,
  purchaseAndroid: false,
  privacyUrl: null,
  lastIosVersion: null,
  lastIosBuild: null,
  lastIosAt: null,
  lastAndroidVersion: null,
  lastAndroidBuild: null,
  lastAndroidAt: null,
  manualAppleAccount: false,
  manualPlayAccount: false,
  manualScreenshots: false,
  manualSubmitted: false,
  manualPublished: false,
  reviewerEmail: null,
});

export async function readAppTab(
  _tenantId: string,
  _deps: { app?: AppStore; credentials?: CredentialStore } = {},
): Promise<AppTab> {
  return {} as AppTab;
}
