import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { openWith, sealWith } from '../server/secrets/sealed';
import {
  createSupabaseAdminRegistry,
  ProjectServiceKeyMissingError,
  supabaseAdmin,
  supabaseAdminFor,
} from '../server/supabase-admin';

/**
 * D-539 (09.2-04): `supabaseAdminFor(project)` returns the service-key client of THAT project. Memoised by
 * `${projectId}:${credentialVersion}` in a bounded map, built from the sealed `service_key` (AAD
 * `<projectId>:service_key`, base URL = the project's `api_url`). T-09.2-21: tenant A's key must never open for
 * tenant B through a memoisation collision or a swapped sealed value. `create` is injected: no test opens a
 * socket.
 */

const ring = new Map([[1, randomBytes(32)]]);
const sealFor = (projectId: string, key: string) =>
  sealWith(ring, 1, key, `${projectId}:service_key`);

type Project = Parameters<typeof supabaseAdminFor>[0];
const project = (id: string, key: string, overrides: Partial<Project> = {}): Project => ({
  id,
  credentialSource: 'sealed',
  credentialVersion: 1,
  apiUrl: `https://${id}.supabase.test`,
  serviceKeySealed: sealFor(id, key),
  ...overrides,
});

function harness(capacity?: number) {
  const central = { name: 'project-0' } as unknown as SupabaseClient;
  const create = vi.fn((url: string, key: string) => ({ url, key }) as unknown as SupabaseClient);
  const registry = createSupabaseAdminRegistry({
    create,
    central: () => central,
    open: (sealed, aad) => openWith(ring, sealed, aad),
    capacity,
  });
  return { registry, create, central };
}

describe('supabaseAdminFor', () => {
  it('project 0 (credential_source env) returns the environment client and never builds one', () => {
    const h = harness();
    const zero = project('p0', 'unused', { credentialSource: 'env', serviceKeySealed: null });
    expect(h.registry.forProject(zero)).toBe(h.central);
    expect(h.registry.forProject(zero)).toBe(h.central);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.registry.size).toBe(0);
  });

  it('the exported default for an env project is the module singleton supabaseAdmin', () => {
    const zero = project('p0', 'unused', { credentialSource: 'env', serviceKeySealed: null });
    expect(supabaseAdminFor(zero)).toBe(supabaseAdmin);
  });

  it('two projects get two clients, each with its own url and its own key', () => {
    const h = harness();
    const a = h.registry.forProject(project('aaa', 'key-of-a')) as unknown as {
      url: string;
      key: string;
    };
    const b = h.registry.forProject(project('bbb', 'key-of-b')) as unknown as {
      url: string;
      key: string;
    };
    expect(a).not.toBe(b);
    expect(a).toEqual({ url: 'https://aaa.supabase.test', key: 'key-of-a' });
    expect(b).toEqual({ url: 'https://bbb.supabase.test', key: 'key-of-b' });
  });

  it('the same project twice is one client and one sealed open', () => {
    const h = harness();
    const p = project('aaa', 'key-of-a');
    expect(h.registry.forProject(p)).toBe(h.registry.forProject(p));
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('a new credentialVersion is a new client carrying the new key', () => {
    const h = harness();
    const v1 = h.registry.forProject(project('aaa', 'old-key'));
    const v2 = h.registry.forProject(
      project('aaa', 'new-key', { credentialVersion: 2 }),
    ) as unknown as { key: string };
    expect(v2).not.toBe(v1);
    expect(v2.key).toBe('new-key');
    expect(h.create).toHaveBeenCalledTimes(2);
  });

  it('a key sealed for another row is unreadable (AAD mismatch) and no client is built', () => {
    const h = harness();
    const swapped = project('bbb', 'key-of-a', { serviceKeySealed: sealFor('aaa', 'key-of-a') });
    expect(() => h.registry.forProject(swapped)).toThrow('sealed value unreadable');
    expect(h.create).not.toHaveBeenCalled();
    expect(h.registry.size).toBe(0);
  });

  it('the failure names no key, no project and no url', () => {
    const h = harness();
    const swapped = project('bbb', 'SECRET-KEY-VALUE', {
      serviceKeySealed: sealFor('aaa', 'SECRET-KEY-VALUE'),
    });
    let message = '';
    try {
      h.registry.forProject(swapped);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toMatch(/SECRET-KEY-VALUE|aaa|bbb|supabase\.test/);
  });

  it('a sealed project with no service key throws a content-free error', () => {
    const h = harness();
    const missing = project('aaa', 'x', { serviceKeySealed: null });
    expect(() => h.registry.forProject(missing)).toThrow(ProjectServiceKeyMissingError);
    expect(() => h.registry.forProject({ ...missing, serviceKeySealed: '' })).toThrow(
      'project service key unavailable',
    );
  });

  it('is bounded: the 65th project evicts the oldest, which is then rebuilt', () => {
    const h = harness(64);
    const projects = Array.from({ length: 65 }, (_, i) => project(`proj${i}`, `key-${i}`));
    const first = h.registry.forProject(projects[0] as Project);
    for (const p of projects.slice(1)) h.registry.forProject(p);
    expect(h.registry.size).toBe(64);
    expect(h.create).toHaveBeenCalledTimes(65);
    // The oldest was dropped: asking again builds it anew; the newest is still held.
    expect(h.registry.forProject(projects[0] as Project)).not.toBe(first);
    expect(h.create).toHaveBeenCalledTimes(66);
    expect(h.registry.forProject(projects[64] as Project)).toBe(
      h.registry.forProject(projects[64] as Project),
    );
  });

  it('the memo key includes the project id: equal versions of two projects never collide', () => {
    const h = harness();
    const a = h.registry.forProject(project('aaa', 'key-of-a')) as unknown as { key: string };
    const b = h.registry.forProject(project('bbb', 'key-of-b')) as unknown as { key: string };
    expect([a.key, b.key]).toEqual(['key-of-a', 'key-of-b']);
  });
});
