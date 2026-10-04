import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as chip from '../src/primitives/Chip';

/**
 * The RSC client-reference trap behind PDF item #9. In the server graph Next replaces EVERY export
 * of a 'use client' module with a client-reference function. A component or a context survives
 * that: the reference is rendered as a client element and resolves to the real export in the
 * browser, and calling a function reference on the server throws loudly. A VALUE does not survive
 * it: server code that reads a string, number, array or object from a client module gets the
 * function instead, and nothing complains. That is how `chipBase`, once exported from the
 * 'use client' Chip.tsx, vanished from every server-rendered StatusPill: `cn()` (clsx) skips
 * functions, so the pill shipped its tone alone, square and unpadded.
 *
 * Vitest has no RSC transform, so no render test can see the drop. This source guard pins the rule
 * instead, over every module of this package: a module whose prologue carries 'use client' exports
 * only functions and React element types (contexts, memo, forwardRef, lazy); a shared value lives
 * in a directive-less module, like `primitives/chipBase.ts`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');

/** Every .ts / .tsx module under src, as absolute paths with forward slashes. */
function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return modules(full);
    return /\.tsx?$/.test(entry.name) ? [full.split('\\').join('/')] : [];
  });
}

/** Path relative to src, for readable failures. */
function rel(file: string): string {
  return relative(SRC, file).split('\\').join('/');
}

/**
 * The directive prologue: the string-literal statements before the first real statement, past any
 * whitespace and comments. A 'use client' anywhere else is not a directive. A block comment ends at
 * its first closing mark, so the scan never jumps from one comment to a string after a later one;
 * a line comment runs to the end of its line, so a quoted 'use client' inside one is not read as a
 * directive either.
 *
 * Every piece of the prologue matches in exactly ONE way (one whitespace character per step, never
 * `\s+`; a line comment never stops short of its line end), so a failed match backs out in linear
 * time. With `\s+` inside the repeated group a run of n blanks had 2^(n-1) splits to try, and a
 * line comment free to stop before any `//` inside it doubled the splits with each one.
 */
function directives(source: string): string[] {
  const statement = /^(?:\s|\/\/[^\n]*(?![^\n])|\/\*(?:[^*]|\*(?!\/))*\*\/)*(['"])([^'"\n]*)\1;?/;
  const found: string[] = [];
  let rest = source.replace(/^\uFEFF/, '');
  for (let match = statement.exec(rest); match; match = statement.exec(rest)) {
    found.push(match[2] ?? '');
    rest = rest.slice(match[0].length);
  }
  return found;
}

function isClientModule(file: string): boolean {
  return directives(readFileSync(file, 'utf8')).includes('use client');
}

/** The React element types a client reference stands in for without being read as data. */
const ELEMENT_TYPES = new Set<symbol>([
  Symbol.for('react.context'),
  Symbol.for('react.consumer'),
  Symbol.for('react.provider'),
  Symbol.for('react.memo'),
  Symbol.for('react.forward_ref'),
  Symbol.for('react.lazy'),
]);

function crossesTheBoundary(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (value === null || typeof value !== 'object') return false;
  const tag: unknown = Reflect.get(value, '$$typeof');
  return typeof tag === 'symbol' && ELEMENT_TYPES.has(tag);
}

const ALL = modules(SRC);
const CLIENT = ALL.filter(isClientModule);

describe('client boundary: a "use client" module exports no values (PDF #9)', () => {
  it('reads the directive from the prologue only', () => {
    expect(directives("'use client';\n\nexport const a = 1;")).toEqual(['use client']);
    expect(directives('/** doc */\n"use client"\nimport x from "y";')).toEqual(['use client']);
    expect(directives("import { a } from 'b';\n'use client';")).toEqual([]);
    expect(directives("export const label = 'use client';")).toEqual([]);
    expect(directives("/* a */ run(); /* b */ 'use client';")).toEqual([]);
    // A quoted directive inside a line comment is still the comment.
    expect(directives("// never mark this 'use client'\nexport const a = 1;")).toEqual([]);
    // Runs of blanks, a URL's `//` inside a line comment and a block comment all stay skippable.
    expect(directives("\n\n  // see https://example.com // x\n/* b */\n\n'use client';")).toEqual([
      'use client',
    ]);
  });

  it('walks the real package (the guard is not vacuous)', () => {
    const client = CLIENT.map(rel);
    expect(client).toContain('primitives/Chip.tsx');
    expect(client).toContain('primitives/Input.tsx');
    expect(client).toContain('layout/ScrollContainerContext.tsx');
    expect(client).not.toContain('primitives/StatusPill.tsx');
    expect(ALL.map(rel)).toContain('primitives/chipBase.ts');
  });

  it('exports only functions and React element types from every client module', async () => {
    const offenders: string[] = [];
    for (const file of CLIENT) {
      const api: Record<string, unknown> = await import(/* @vite-ignore */ file);
      for (const [name, value] of Object.entries(api)) {
        if (!crossesTheBoundary(value)) offenders.push(`${rel(file)}: ${name} (${typeof value})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('accepts a context, the one non-function export a client module ships, and no value', async () => {
    const scroll: Record<string, unknown> = await import('../src/layout/ScrollContainerContext');
    expect(typeof scroll.ScrollContainerContext).toBe('object');
    expect(crossesTheBoundary(scroll.ScrollContainerContext)).toBe(true);
    expect(crossesTheBoundary('inline-flex rounded-full')).toBe(false);
    expect(crossesTheBoundary({ brand: 'bg-brand/10' })).toBe(false);
    expect(crossesTheBoundary(['date', 'time'])).toBe(false);
  });
});

describe('client boundary: the chip geometry lives outside the client module (PDF #9)', () => {
  const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');

  it('keeps chipBase.ts and StatusPill.tsx free of any directive', () => {
    expect(directives(read('primitives/chipBase.ts'))).toEqual([]);
    expect(directives(read('primitives/StatusPill.tsx'))).toEqual([]);
  });

  it('imports the geometry from chipBase.ts in both Chip and StatusPill', () => {
    const fromModule = /import \{ chipBase \} from '\.\/chipBase';/;
    expect(read('primitives/Chip.tsx')).toMatch(fromModule);
    expect(read('primitives/StatusPill.tsx')).toMatch(fromModule);
    expect(read('primitives/StatusPill.tsx')).not.toMatch(/from '\.\/Chip'/);
  });

  it('never re-exports the geometry from the client Chip module', () => {
    expect(Object.keys(chip)).toContain('Chip');
    expect(Object.keys(chip)).not.toContain('chipBase');
  });
});
