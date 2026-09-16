import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleMessages, loadMessages } from './messages';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));

function catalog(files: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tria-messages-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

describe('loadMessages (PWA-03: one pt-BR catalog assembled from per-namespace files)', () => {
  it('returns the union of the file root keys; dotted files deep-merge into their namespace', () => {
    const dir = catalog({
      'common.json': { common: { appName: 'TRIA' } },
      'platform.json': { platform: { title: 'Plataforma TRIA', tenants: 'Tenants' } },
      'platform.list.json': { platform: { list: { newTenant: 'Novo tenant' } } },
    });
    expect(loadMessages(dir)).toEqual({
      common: { appName: 'TRIA' },
      platform: {
        title: 'Plataforma TRIA',
        tenants: 'Tenants',
        list: { newTenant: 'Novo tenant' },
      },
    });
  });

  it('keeps the same leaf key distinct across namespaces (login.title vs signup.title)', () => {
    const dir = catalog({
      'login.json': { login: { title: 'Entrar' } },
      'signup.json': { signup: { title: 'Criar conta' } },
    });
    expect(loadMessages(dir)).toEqual({
      login: { title: 'Entrar' },
      signup: { title: 'Criar conta' },
    });
  });

  it('throws naming both files when two files declare the same leaf path', () => {
    const dir = catalog({
      'platform.json': { platform: { title: 'Plataforma TRIA' } },
      'platform.list.json': { platform: { title: 'Tenants' } },
    });
    expect(() => loadMessages(dir)).toThrow(
      /Duplicate message key "platform\.title" in platform\.json and platform\.list\.json/,
    );
  });

  it('throws when a file root key does not equal the filename prefix before the first dot', () => {
    const dir = catalog({ 'platform.list.json': { list: { newTenant: 'Novo tenant' } } });
    expect(() => loadMessages(dir)).toThrow(/platform\.list\.json/);
  });

  it('throws on an empty object file, an empty namespace and a non-object root', () => {
    expect(() => loadMessages(catalog({ 'login.json': {} }))).toThrow(/login\.json/);
    expect(() => loadMessages(catalog({ 'login.json': { login: {} } }))).toThrow(/login\.json/);
    expect(() => loadMessages(catalog({ 'login.json': '["Entrar"]' }))).toThrow(/login\.json/);
    expect(() => loadMessages(catalog({ 'login.json': '"Entrar"' }))).toThrow(/login\.json/);
  });

  it('is deterministic: sorted filename order, pure merge, memoized per directory', () => {
    const dir = catalog({
      'b.json': { b: { x: '1' } },
      'a.json': { a: { y: '2' } },
      'a.z.json': { a: { z: { w: '3' } } },
    });
    const reversed = assembleMessages(dir, ['b.json', 'a.z.json', 'a.json']);
    const natural = assembleMessages(dir, ['a.json', 'a.z.json', 'b.json']);
    expect(reversed).toEqual(natural);
    expect(Object.keys(reversed)).toEqual(['a', 'b']);
    expect(Object.keys(reversed.a as object)).toEqual(['y', 'z']);
    expect(loadMessages(dir)).toEqual(natural);
    expect(loadMessages(dir)).toBe(loadMessages(dir));
  });

  it('ignores non-JSON files and never normalizes the strings (literal accents, ICU plurals)', () => {
    const dir = catalog({
      'README.md': '# not a catalog',
      'platform.json': {
        platform: {
          modulesCount: '{count, plural, =0 {nenhum módulo} one {# módulo} other {# módulos}}',
        },
      },
    });
    const messages = loadMessages(dir) as { platform: { modulesCount: string } };
    expect(messages.platform.modulesCount).toBe(
      '{count, plural, =0 {nenhum módulo} one {# módulo} other {# módulos}}',
    );
    expect(messages.platform.modulesCount.normalize('NFD')).not.toBe(
      messages.platform.modulesCount,
    );
  });

  it('assembles the real apps/web/messages/pt-BR catalog with every Phase 1 namespace present', () => {
    const messages = loadMessages(catalogDir);
    for (const ns of ['common', 'login', 'signup', 'forgot', 'reset', 'platform', 'app', 'legal']) {
      expect(messages, ns).toHaveProperty(ns);
    }
  });
});

describe('scripts/check-ui-literals.sh (UI-SPEC token file rule)', () => {
  function run(files: Record<string, string>): { status: number | null; out: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'tria-literals-'));
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), body);
    }
    const result = spawnSync('bash', ['scripts/check-ui-literals.sh', dir], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }

  it('fails on a hex colour literal in a .tsx', () => {
    const r = run({
      'Foo.tsx': 'export const Foo = () => <div style={{ color: "#ff0000" }} />;\n',
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('Foo.tsx:1');
  });

  it('fails on a legacy prototype brand class', () => {
    const r = run({
      'Foo.tsx': 'export const Foo = () => <button className="btn-gold">x</button>;\n',
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('btn-gold');
  });

  it('fails on JSX text with pt-BR diacritics outside the catalog', () => {
    const r = run({ 'Foo.tsx': 'export const Foo = () => <p>Configurações</p>;\n' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('Foo.tsx:1');
  });

  it('passes on catalog-driven text, on a .test.tsx and on tokens.css (excluded by extension)', () => {
    const r = run({
      'Foo.tsx': "export const Foo = () => <p>{t('title')}</p>;\n",
      'Foo.test.tsx': 'export const Foo = () => <p>Configurações</p>;\n',
      'styles/tokens.css': ':root { --theme-bg: #f5f7fb; }\n',
    });
    expect(r.out).toBe(r.status === 0 ? r.out : `unexpected failure:\n${r.out}`);
    expect(r.status).toBe(0);
  });
});
