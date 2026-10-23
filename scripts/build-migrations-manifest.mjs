#!/usr/bin/env node
/**
 * Builds the migrations directory the API image carries (Phase 09.2-15, D-547, DBT-44).
 *
 *   node scripts/build-migrations-manifest.mjs --root <repo> --out <dir>
 *
 * Copies, byte for byte,
 *   <root>/supabase/migrations/*.sql          -> <dir>/tenant/
 *   <root>/supabase/central/migrations/*.sql  -> <dir>/central/
 *   <root>/supabase/roles.sql                 -> <dir>/roles.sql
 * and writes <dir>/manifest.json:
 *   { "tenant": [{ "version", "name", "sha256" }], "central": [...], "roles": { "sha256" } }
 *
 * Deterministic on purpose (P86, P87): entries are sorted by version whatever order the filesystem lists
 * them, the keys have a fixed order, there is no timestamp and no absolute path, so building twice from the
 * same files yields byte-identical output. A tenant directory without a single migration file is refused
 * (exit 1): an image that required nothing would hold no tenant back. Plain Node, no dependency, so the
 * Docker stage that has the whole repository can run it before anything is installed.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const FILE_NAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

function fail(message) {
  console.error(`build-migrations-manifest: ${message}`);
  process.exit(1);
}

let args;
try {
  args = parseArgs({
    options: { root: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  }).values;
} catch {
  console.error('usage: build-migrations-manifest.mjs --root <repo> --out <dir>');
  process.exit(2);
}
if (!args.root || !args.out) {
  console.error('usage: build-migrations-manifest.mjs --root <repo> --out <dir>');
  process.exit(2);
}

const root = resolve(args.root);
const out = resolve(args.out);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The migration files of a directory, sorted by version (not by whatever order the filesystem lists). */
function listSet(dir) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const files = [];
  for (const file of names) {
    const match = FILE_NAME.exec(file);
    if (!match) continue;
    files.push({ file, version: match[1], name: match[2] });
  }
  files.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  return files;
}

function copySet(sourceDir, targetDir, files) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  return files.map(({ file, version, name }) => {
    copyFileSync(join(sourceDir, file), join(targetDir, file));
    return { version, name, sha256: sha256(readFileSync(join(sourceDir, file))) };
  });
}

const tenantDir = join(root, 'supabase', 'migrations');
const centralDir = join(root, 'supabase', 'central', 'migrations');
const rolesFile = join(root, 'supabase', 'roles.sql');

const tenantFiles = listSet(tenantDir);
if (tenantFiles.length === 0) fail('the tenant migration directory holds no migration file');

let rolesBytes;
try {
  rolesBytes = readFileSync(rolesFile);
} catch {
  fail('supabase/roles.sql is missing');
}
if (rolesBytes.length === 0) fail('supabase/roles.sql is empty');

mkdirSync(out, { recursive: true });
rmSync(join(out, 'manifest.json'), { force: true });
rmSync(join(out, 'roles.sql'), { force: true });

const tenant = copySet(tenantDir, join(out, 'tenant'), tenantFiles);
const central = copySet(centralDir, join(out, 'central'), listSet(centralDir));
writeFileSync(join(out, 'roles.sql'), rolesBytes);

const manifest = { tenant, central, roles: { sha256: sha256(rolesBytes) } };
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  JSON.stringify({ built: true, tenant: tenant.length, central: central.length, roles: true }),
);
