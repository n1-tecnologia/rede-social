import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The pt-BR catalog (PWA-03) is ONE object assembled at request time from
 * `apps/web/messages/pt-BR/<namespace>.json` files, so parallel plans add namespaces by adding files
 * and never edit a shared catalog. Rules (each one is unit-tested in ./messages.test.ts):
 *
 *  - every file is `{ "<namespace>": { … } }` — a single root key equal to the filename segment before
 *    the first dot (`platform.json` and `platform.list.json` both contribute under `platform`);
 *  - files are merged in sorted filename order and the merge is pure, so the result is deterministic
 *    regardless of the filesystem's listing order;
 *  - two files declaring the same leaf path is an error naming both files (T-02-13): a later file can
 *    never silently override copy from another one;
 *  - an empty file, an empty namespace or a non-object root is refused (a silent empty namespace would
 *    only surface as missing strings at render time);
 *  - strings are read verbatim (UTF-8, literal accents, ICU plural forms) — never normalised.
 *
 * Server-only by construction (node:fs; imported by i18n/request.ts, never by a client component).
 * `loadMessages()` memoizes per directory so production reads the directory once per process (T-02-12);
 * `assembleMessages()` is the pure, uncached building block.
 */

export type MessageTree = { [key: string]: string | MessageTree };

const DEFAULT_DIR = path.join(process.cwd(), 'messages', 'pt-BR');
const cache = new Map<string, MessageTree>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function namespaceOf(file: string): string {
  return file.slice(0, file.indexOf('.'));
}

function readNamespaceFile(dir: string, file: string): [string, MessageTree] {
  const source = readFileSync(path.join(dir, file), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in message file ${file}: ${(error as Error).message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Message file ${file} must have an object root with a single namespace key`);
  }
  const keys = Object.keys(parsed);
  const expected = namespaceOf(file);
  if (keys.length !== 1 || keys[0] !== expected) {
    throw new Error(
      `Message file ${file} must declare exactly the "${expected}" namespace (found: ${
        keys.length === 0 ? 'no keys' : keys.map((k) => `"${k}"`).join(', ')
      })`,
    );
  }
  const body = parsed[expected];
  if (!isPlainObject(body) || Object.keys(body).length === 0) {
    throw new Error(`Message file ${file} declares an empty or non-object "${expected}" namespace`);
  }
  return [expected, body as MessageTree];
}

/**
 * Merges `source` (from `file`) into `target`. `owners` maps every leaf path already merged to the file
 * that declared it, so a collision can name both files.
 */
function mergeInto(
  target: MessageTree,
  source: MessageTree,
  file: string,
  owners: Map<string, string>,
  prefix: string,
): void {
  for (const [key, value] of Object.entries(source)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const existing = target[key];
    if (isPlainObject(value)) {
      if (existing === undefined) {
        const branch: MessageTree = {};
        target[key] = branch;
        mergeInto(branch, value as MessageTree, file, owners, fullPath);
        continue;
      }
      if (isPlainObject(existing)) {
        mergeInto(existing as MessageTree, value as MessageTree, file, owners, fullPath);
        continue;
      }
      throw new Error(
        `Duplicate message key "${fullPath}" in ${owners.get(fullPath)} and ${file} (one is a string, the other a namespace)`,
      );
    }
    if (existing !== undefined) {
      throw new Error(`Duplicate message key "${fullPath}" in ${owners.get(fullPath)} and ${file}`);
    }
    if (typeof value !== 'string') {
      throw new Error(`Message key "${fullPath}" in ${file} must be a string or an object`);
    }
    target[key] = value;
    owners.set(fullPath, file);
  }
}

/** Pure assembly of the given files (any order) under `dir`; sorted internally, no cache. */
export function assembleMessages(dir: string, files: readonly string[]): MessageTree {
  const messages: MessageTree = {};
  const owners = new Map<string, string>();
  for (const file of [...files].filter((f) => f.endsWith('.json')).sort()) {
    const [namespace, body] = readNamespaceFile(dir, file);
    let branch = messages[namespace];
    if (branch === undefined) {
      branch = {};
      messages[namespace] = branch;
    }
    mergeInto(branch as MessageTree, body, file, owners, namespace);
  }
  return messages;
}

/** The assembled pt-BR catalog, read once per process per directory. */
export function loadMessages(dir: string = DEFAULT_DIR): MessageTree {
  const cached = cache.get(dir);
  if (cached) return cached;
  const messages = assembleMessages(dir, readdirSync(dir));
  cache.set(dir, messages);
  return messages;
}
