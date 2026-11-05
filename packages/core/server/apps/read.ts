import type { AppVersionAnswer, HostApp, NativePlatform } from '@rede-social/contracts/native';
import type { AppRow, AppStore, PurchaseSwitches } from './tenant-app';

/** 13-10 RED stub: the signatures only, answering the wrong thing so the tests fail on assertions. */
export type AppVersionRow = {
  minVersionIos: string | null;
  minVersionAndroid: string | null;
  storeUrlIos: string | null;
  storeUrlAndroid: string | null;
};
export type AppVersionStore = { bySlug(slug: string): Promise<AppVersionRow | null> };
export const pgAppVersionStore: AppVersionStore = { bySlug: async () => null };

export const nativeRequestOf = (
  _header: string | undefined,
): { native: boolean; platform: NativePlatform | null } => ({ native: false, platform: null });
export const hostAppBlockOf = (_row: AppRow | null, _primaryHost: string | null): HostApp | null =>
  null;
export async function readHostAppBlock(
  _tenantId: string,
  _deps: { app?: AppStore; primaryHost?: string | null } = {},
): Promise<HostApp | null> {
  return null;
}
export async function readPurchaseSwitches(
  _tenantId: string,
  _deps: { app?: AppStore } = {},
): Promise<PurchaseSwitches> {
  return { ios: true, android: true };
}
export const appVersionAnswerOf = (_row: AppVersionRow | null): AppVersionAnswer => ({
  ios: { minVersion: '9.9.9', storeUrl: null },
  android: { minVersion: '9.9.9', storeUrl: null },
});
export async function readAppVersion(
  _slug: string,
  _deps: { versions?: AppVersionStore } = {},
): Promise<AppVersionAnswer> {
  return appVersionAnswerOf(null);
}
