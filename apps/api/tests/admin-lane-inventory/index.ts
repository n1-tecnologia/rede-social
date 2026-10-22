import { media } from './media';
import { payments } from './payments';
import { platform } from './platform';
import { scripts } from './scripts';
import { tenancy } from './tenancy';

/**
 * The admin-lane inventory (09.2-04, D-538, DBT-08): every `withAdminTx(` call site outside tests,
 * classified, with the plan that migrates it. The kernel's admin lane used to take no argument and so could
 * not know which database to open; from this phase it takes a target (`{ tenantId }` or `{ projectId }`), and
 * the 119+ sites move over plan by plan. This file is what makes that migration countable.
 *
 * Classes:
 *   P  platform lane   central tables only (`tenants` mirror, `tenant_domains`, `platform.*`): `withPlatformTx`
 *   T  tenant-scoped   a tenant id is in scope: `withAdminTx({ tenantId })`
 *   S  split saga      a central step and a tenant step in two transactions, in an explicit order
 *   N  no-host entry   no tenant in hand (a webhook, an inbox row): resolve it through a central index first
 *   L  project loop    `withAdminTx({ projectId })` inside a per-project job (dispatcher, sweeper)
 *
 * Status: `pending` = the site still uses the deprecated single-argument form (project 0); `migrated` = it
 * passes a target. Plan 10 removes the deprecated overload and flips `ALLOW_PENDING` to false.
 *
 * Entries are PER CALL SITE, in the order the sites appear in the file. `tests/unit/admin-lane-inventory.test.ts`
 * scans the source and fails when a site has no entry, an entry has no site, a status disagrees with the form
 * the site uses, or the list is out of order. WHY CHECKED IN, NOT GENERATED: writing the entry is the moment a
 * person answers "which database does this site belong to?", and a reviewer sees the answer in the diff.
 */
export type SiteClass = 'P' | 'T' | 'S' | 'N' | 'L';
export type SiteStatus = 'pending' | 'migrated';

export type AdminLaneEntry = {
  /** Path from the repository root, forward slashes. */
  file: string;
  /** The last function declared at column 0 before the site (`(module)` when there is none). */
  fn: string;
  class: SiteClass;
  status: SiteStatus;
  /** The plan of this phase that migrates the site (`09.2-<plan>`), as a number. */
  plan: number;
  /** Why the class is not the obvious one, or what else the transaction reads. */
  note?: string;
};

/**
 * Plan 10 flips this to false when the last site migrates and the deprecated overload is removed. While it is
 * true the guard tolerates `pending` entries (they are printed, in inventory order, on every run).
 */
export const ALLOW_PENDING = true;

export const AREAS = { media, payments, platform, scripts, tenancy } as const;

const byFile = (a: AdminLaneEntry, b: AdminLaneEntry) =>
  a.file < b.file ? -1 : a.file > b.file ? 1 : 0;

/** All areas, sorted by file path; the sort is stable, so the site order inside a file is kept. */
export const ADMIN_LANE_INVENTORY: readonly AdminLaneEntry[] = Object.values(AREAS)
  .flat()
  .sort(byFile);

// ── the scanner and the checker (pure, so the guard's own failures are provable on an in-memory fixture) ──

export type AdminLaneSite = { fn: string; legacy: boolean; line: number };

/**
 * Blanks comments and the CONTENT of string and template literals, keeping every newline, so the call
 * pattern is searched only in code: a line or a string that merely mentions `withAdminTx(` is not a site.
 */
export function maskSource(source: string): string {
  const out: string[] = [];
  type Ctx = { kind: 'template' } | { kind: 'code'; depth: number };
  const stack: Ctx[] = [];
  let i = 0;
  const n = source.length;
  const blank = (ch: string) => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const ch = source[i] as string;
    const next = source[i + 1];
    const top = stack[stack.length - 1];
    if (top?.kind === 'template') {
      if (ch === '\\') {
        out.push(' ', blank(next ?? ' '));
        i += 2;
      } else if (ch === '`') {
        stack.pop();
        out.push('`');
        i += 1;
      } else if (ch === '$' && next === '{') {
        stack.push({ kind: 'code', depth: 0 });
        out.push('${');
        i += 2;
      } else {
        out.push(blank(ch));
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out.push(' ');
        i += 1;
      }
    } else if (ch === '/' && next === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out.push(blank(source[i] as string));
        i += 1;
      }
      out.push(' ', ' ');
      i += 2;
    } else if (ch === "'" || ch === '"') {
      out.push(ch);
      i += 1;
      while (i < n && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\') {
          out.push(' ', blank(source[i + 1] ?? ' '));
          i += 2;
        } else {
          out.push(' ');
          i += 1;
        }
      }
      out.push(source[i] === ch ? ch : '');
      i += 1;
    } else if (ch === '`') {
      stack.push({ kind: 'template' });
      out.push('`');
      i += 1;
    } else {
      if (top?.kind === 'code') {
        if (ch === '{') top.depth += 1;
        else if (ch === '}') {
          if (top.depth === 0) stack.pop();
          else top.depth -= 1;
        }
      }
      out.push(ch);
      i += 1;
    }
  }
  return out.join('');
}

const FN_DECLARATIONS = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/,
];

const CALL = /\bwithAdminTx\s*(?:<[^()]*>)?\s*\(/g;

/** Is the first argument of the call that opens at `open` (index of its `(`) a function, not a target? */
function isLegacyForm(masked: string, open: number): boolean {
  let depth = 0;
  let first = '';
  let secondArgument = false;
  for (let i = open + 1; i < masked.length; i += 1) {
    const ch = masked[i] as string;
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      secondArgument = true;
      break;
    }
    first += ch;
  }
  const head = first.trim();
  // Function-shaped first argument: an arrow anywhere at depth 0 of it, `async`, or `function`.
  if (/^(?:async\b|function\b)/.test(head)) return true;
  let d = 0;
  for (let i = 0; i < head.length; i += 1) {
    const ch = head[i] as string;
    if (ch === '(' || ch === '[' || ch === '{') d += 1;
    else if (ch === ')' || ch === ']' || ch === '}') d -= 1;
    else if (d === 0 && ch === '=' && head[i + 1] === '>') return true;
  }
  // A bare identifier or an object literal followed by a second argument is a target; alone, it is a function reference.
  return !secondArgument;
}

/** Every `withAdminTx(` call in `source`, in source order. */
export function scanAdminLaneSites(source: string): AdminLaneSite[] {
  const masked = maskSource(source);
  const declarations: { offset: number; name: string }[] = [];
  let offset = 0;
  for (const line of masked.split('\n')) {
    for (const pattern of FN_DECLARATIONS) {
      const match = pattern.exec(line);
      if (match?.[1]) {
        declarations.push({ offset, name: match[1] });
        break;
      }
    }
    offset += line.length + 1;
  }
  const sites: AdminLaneSite[] = [];
  for (const match of masked.matchAll(CALL)) {
    const at = match.index ?? 0;
    // `lanes.withAdminTx(` is a member call on the lane object, and a declaration is not a call: neither is a site.
    if (masked[at - 1] === '.') continue;
    if (/function\s+$/.test(masked.slice(Math.max(0, at - 24), at))) continue;
    let fn = '(module)';
    for (const declaration of declarations) {
      if (declaration.offset < at) fn = declaration.name;
      else break;
    }
    sites.push({
      fn,
      legacy: isLegacyForm(masked, at + match[0].length - 1),
      line: masked.slice(0, at).split('\n').length,
    });
  }
  return sites;
}

/**
 * Order: files ascending and contiguous, so a review diff stays small and stable and an out-of-order file
 * shows up. The real run applies it to each area module separately, because `ADMIN_LANE_INVENTORY` is sorted
 * on construction and would hide the disorder.
 */
export function checkOrder(inventory: readonly AdminLaneEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let previous = '';
  for (const entry of inventory) {
    if (entry.file !== previous) {
      if (seen.has(entry.file)) problems.push(`${entry.file}: entries are not contiguous`);
      if (previous && entry.file < previous) {
        problems.push(`${entry.file}: out of order (comes after ${previous})`);
      }
      seen.add(entry.file);
      previous = entry.file;
    }
  }
  return problems;
}

/**
 * Compares the sites found in the source (`sitesByFile`, keyed by path) with the inventory and returns every
 * problem found, empty when they agree. `allowPending` is `ALLOW_PENDING` in the real run.
 */
export function checkInventory(
  sitesByFile: Readonly<Record<string, readonly AdminLaneSite[]>>,
  inventory: readonly AdminLaneEntry[],
  allowPending: boolean,
): string[] {
  const problems: string[] = [];
  if (inventory.length === 0) problems.push('the inventory is empty');

  const entriesByFile = new Map<string, AdminLaneEntry[]>();
  for (const entry of inventory) {
    if (!['P', 'T', 'S', 'N', 'L'].includes(entry.class)) {
      problems.push(`${entry.file}: unknown class "${entry.class}"`);
    }
    if (entry.status !== 'pending' && entry.status !== 'migrated') {
      problems.push(`${entry.file}: unknown status "${entry.status}"`);
    }
    const list = entriesByFile.get(entry.file) ?? [];
    list.push(entry);
    entriesByFile.set(entry.file, list);
  }

  for (const [file, sites] of Object.entries(sitesByFile)) {
    if (sites.length === 0) continue;
    const entries = entriesByFile.get(file) ?? [];
    if (entries.length !== sites.length) {
      problems.push(
        entries.length === 0
          ? `${file}: ${sites.length} withAdminTx site(s) and no inventory entry`
          : `${file}: ${sites.length} withAdminTx site(s) but ${entries.length} inventory entr${entries.length === 1 ? 'y' : 'ies'} (one per site)`,
      );
      continue;
    }
    sites.forEach((site, index) => {
      const entry = entries[index] as AdminLaneEntry;
      if (entry.fn !== site.fn) {
        problems.push(
          `${file}: site ${index + 1} is in "${site.fn}" but its entry says "${entry.fn}"`,
        );
      }
      if (entry.status === 'migrated' && site.legacy) {
        problems.push(
          `${file}: "${site.fn}" is marked migrated but still uses the deprecated form`,
        );
      }
      if (entry.status === 'pending' && !site.legacy) {
        problems.push(`${file}: "${site.fn}" is marked pending but already passes a target`);
      }
    });
  }
  for (const file of entriesByFile.keys()) {
    if ((sitesByFile[file]?.length ?? 0) === 0) {
      problems.push(`${file}: stale entry, the file has no withAdminTx site`);
    }
  }

  problems.push(...checkOrder(inventory));

  if (!allowPending) {
    const pending = inventory.filter((entry) => entry.status === 'pending').length;
    if (pending > 0)
      problems.push(
        `${pending} pending entr${pending === 1 ? 'y' : 'ies'} while ALLOW_PENDING is false`,
      );
  }
  return problems;
}
