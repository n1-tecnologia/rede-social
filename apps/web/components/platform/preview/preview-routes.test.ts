import { describe, expect, it } from 'vitest';
import { screenForHref, screenOfTab } from './preview-routes';

describe('screenForHref — the app links the phone preview follows', () => {
  it('maps every emulated route, with its sub-paths, query and hash', () => {
    expect(screenForHref('/inicio')).toBe('home');
    expect(screenForHref('/eventos')).toBe('events');
    expect(screenForHref('/eventos/123?origem=inicio')).toBe('events');
    expect(screenForHref('/comunidades/abc#topo')).toBe('communities');
    expect(screenForHref('/reels')).toBe('reels');
    expect(screenForHref('/perfil/editar')).toBe('profile');
    expect(screenForHref('/membros')).toBe('profile');
    expect(screenForHref('/entrar')).toBe('login');
    expect(screenForHref('/configuracoes')).toBe('settings');
    expect(screenForHref('/configuracoes/midia')).toBe('settings');
  });

  it('follows nothing else: unknown routes, look-alike prefixes and absolute URLs', () => {
    expect(screenForHref('/post/device-preview-post')).toBeNull();
    expect(screenForHref('/eventosx')).toBeNull();
    expect(screenForHref('https://example.com/inicio')).toBeNull();
    expect(screenForHref('')).toBeNull();
  });
});

describe('screenOfTab — a nav tab key to its preview screen', () => {
  it('knows the kernel and module tabs and nothing else', () => {
    expect(screenOfTab('home')).toBe('home');
    expect(screenOfTab('events')).toBe('events');
    expect(screenOfTab('profile')).toBe('profile');
    expect(screenOfTab('login')).toBeNull();
    expect(screenOfTab('feed')).toBeNull();
  });
});
