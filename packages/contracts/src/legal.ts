import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The tenant rules contract (ADMIN-03) lives in the client-safe `./rules` — the editor imports it in
 * the browser, where this file's `node:fs` cannot go — and is re-exported here with the rest of the
 * consent texts.
 */
export * from './rules';

/**
 * the platform's legal texts and their versions (D-03, AUTH-04).
 *
 * SERVER-ONLY: `readLegalDoc` touches `node:fs`. Never import this module from a client component
 * (there is no `import 'server-only'` here because that package is Next-specific and `@rede-social/contracts`
 * is also consumed by the API and by scripts).
 *
 * One consent, one version — D-03 records a SINGLE `platform_terms` consent that accepts BOTH texts, so
 * the recorded `consent_records.text_version` is `PLATFORM_TERMS_VERSION` and that one number must
 * identify both documents. The rule: a change to EITHER legal text bumps `version:` in BOTH markdown
 * files and BOTH constants together, so `PLATFORM_PRIVACY_VERSION === PLATFORM_TERMS_VERSION` always holds.
 * `tests/legal.test.ts` fails CI the moment that stops being true.
 */

/** Version of `legal/termos-de-uso.md`. Recorded in `consent_records.text_version` for `platform_terms`. */
export const PLATFORM_TERMS_VERSION = 1;

/** Version of `legal/politica-de-privacidade.md`. Always equal to `PLATFORM_TERMS_VERSION` (see above). */
export const PLATFORM_PRIVACY_VERSION = 1;

export const LEGAL_DOCS = ['termos-de-uso', 'politica-de-privacidade'] as const;
export type LegalDocName = (typeof LEGAL_DOCS)[number];

export type LegalDoc = {
  /** Front-matter `version:` of the markdown file — the number recorded with a consent. */
  version: number;
  /** Markdown body with the front-matter block stripped. */
  body: string;
};

/**
 * Where the markdown lives, most specific first. The first candidate is the package-relative path;
 * the others exist because a bundler (Next/Turbopack) rewrites `import.meta.url` to the emitted chunk,
 * so the pages that render these texts must still find them from the process working directory.
 * `next.config.ts` keeps `packages/contracts/legal/**` inside the Vercel function bundle.
 */
function candidatePaths(name: LegalDocName): string[] {
  const paths: string[] = [];
  try {
    paths.push(fileURLToPath(new URL(`../legal/${name}.md`, import.meta.url)));
  } catch {
    // `import.meta.url` is not a file URL (bundled): fall through to the cwd walk.
  }
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    paths.push(join(dir, 'packages', 'contracts', 'legal', `${name}.md`));
    paths.push(join(dir, 'node_modules', '@rede-social', 'contracts', 'legal', `${name}.md`));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return paths;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Reads one versioned legal text. Throws when the file or its `version:` front-matter is missing. */
export function readLegalDoc(name: LegalDocName): LegalDoc {
  const file = candidatePaths(name).find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`legal document not found: ${name}.md`);

  const raw = readFileSync(file, 'utf8');
  const matched = FRONT_MATTER.exec(raw);
  if (!matched?.[1]) throw new Error(`legal document ${name}.md has no front-matter block`);

  const versionLine = /^version:\s*(\d+)\s*$/m.exec(matched[1]);
  if (!versionLine?.[1]) throw new Error(`legal document ${name}.md has no numeric \`version:\``);

  return { version: Number(versionLine[1]), body: raw.slice(matched[0].length).trim() };
}
