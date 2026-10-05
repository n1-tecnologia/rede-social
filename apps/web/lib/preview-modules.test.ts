import { buildNav } from '@rede-social/core/ui';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_MANIFESTS,
  previewEffectiveModules,
  previewHomeSlots,
  previewNavModules,
} from './preview-modules';

const ALL = ['feed', 'communities', 'stories', 'events', 'chat', 'notifications', 'reels'];
const labels = { home: 'Início', profile: 'Perfil', module: () => null };

const tabKeys = (enabled: string[]) =>
  buildNav(previewNavModules(previewEffectiveModules(enabled)), labels).tabs.map((t) => t.key);

describe('preview-modules (the tenant preview mirror of the module manifests)', () => {
  it('renders the same tab row as the app with every module on', () => {
    expect(tabKeys(ALL)).toEqual(['home', 'communities', 'reels', 'events', 'profile']);
  });

  it('drops Reels when Feed is off (requires), like the API composition', () => {
    expect(previewEffectiveModules(['reels', 'events'])).toEqual(['events']);
    expect(tabKeys(['reels', 'communities'])).toEqual(['home', 'communities', 'profile']);
  });

  it('keeps the kernel tabs when no module has a tab', () => {
    expect(tabKeys(['feed', 'stories', 'chat', 'notifications'])).toEqual(['home', 'profile']);
  });

  it('orders the Início slots by the manifests home order: stories, events, feed', () => {
    expect(previewHomeSlots(previewEffectiveModules(ALL))).toEqual(['stories', 'events', 'feed']);
    expect(previewHomeSlots(['feed', 'events'])).toEqual(['events', 'feed']);
    expect(previewHomeSlots(['communities', 'chat'])).toEqual([]);
  });

  it('carries the media chrome on the Reels tab only', () => {
    const tabs = buildNav(previewNavModules(previewEffectiveModules(ALL)), labels).tabs;
    expect(tabs.filter((t) => t.chrome === 'media').map((t) => t.key)).toEqual(['reels']);
  });

  it('mirrors no manifest for chat and notifications', () => {
    expect(PREVIEW_MANIFESTS.chat).toBeUndefined();
    expect(PREVIEW_MANIFESTS.notifications).toBeUndefined();
  });
});
