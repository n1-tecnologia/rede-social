#!/usr/bin/env bash
# UI literal guard (UI-SPEC "Token file" rule, UI-03, PWA-03) — runs after `turbo run lint` from the
# root `lint` script.
#
# `packages/ui/src/styles/tokens.css` is the only file in the monorepo where colour literals may live,
# and every user-facing string must come from the pt-BR catalog (apps/web/messages/pt-BR/*.json).
# This script fails the build when a `.tsx` under the scanned directories contains:
#   (a) a hex colour literal (`#rgb` … `#rrggbbaa`) inside a string, template or class attribute
#   (b) a legacy prototype brand class: text-gold, bg-gold, bg-emerald, text-emerald, btn-gold,
#       brand-ig-mark, pill-*, text-gradient-* (UI-03 replaces them with tenant tokens)
#   (c) JSX text with pt-BR diacritics outside the catalog (`<p>Configurações</p>`; `{t('title')}` passes)
# and when any `apps/web/messages/pt-BR/*.json` does not parse or its root key differs from the filename
# prefix (the loader's contract, apps/web/i18n/messages.ts).
#
# Scanned: `**/*.tsx` minus node_modules, dist, .next, .turbo, reference/, **/public/**, **/tests/**,
# *.test.tsx. Other extensions (tokens.css, .ts, .json) are never scanned.
#
# The file walk and the regexes run in node rather than `rg`/`grep`: rg is not installed on every dev
# machine and BSD grep (macOS) does not match multibyte bracket expressions such as `[ãõç…]`, so a grep
# fallback would pass on macOS and fail in CI. Node 24 is already required by the repo.
#
# Usage: bash scripts/check-ui-literals.sh [dir ...]   (default: apps packages)
# Exit 0 when clean, 1 when any offending `file:line` is printed.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -gt 0 ]; then
  DIRS=("$@")
else
  DIRS=(apps packages)
fi

STATUS=0

# ---- (a)(b)(c): scan .tsx files -------------------------------------------------------------------
if ! node - "${DIRS[@]}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'reference', 'public', 'tests']);
const RULES = [
  {
    name: 'hex colour literal (only packages/ui/src/styles/tokens.css may carry colours)',
    // inside a string / template / class attribute: a quote, then no closing quote before the hex
    re: /(["'`])[^"'`\n]*#[0-9a-fA-F]{3,8}\b/,
  },
  {
    name: 'legacy prototype brand class (use tenant tokens: bg-brand, text-brand, …)',
    re: /\b(text-gold|bg-gold|bg-emerald|text-emerald|btn-gold|brand-ig-mark|pill-|text-gradient-)/,
  },
  {
    name: 'JSX text with pt-BR diacritics outside the catalog (use t(\'key\') from apps/web/messages/pt-BR)',
    re: />[^<{}]*[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔÀ][^<{}]*</,
  },
];

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      yield full;
    }
  }
}

let hits = 0;
for (const dir of process.argv.slice(2)) {
  for (const file of walk(dir)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          hits += 1;
          console.error(`${file}:${i + 1}: ${rule.name}\n    ${line.trim()}`);
        }
      }
    });
  }
}
process.exit(hits === 0 ? 0 : 1);
NODE
then
  echo "check-ui-literals: FAILED — hard-coded colours, legacy brand classes or pt-BR literals in .tsx (UI-SPEC token file rule)" >&2
  STATUS=1
fi

# ---- catalog files: parse + root key equals the filename prefix -------------------------------------
CATALOG_DIR="apps/web/messages/pt-BR"
if [ -d "$CATALOG_DIR" ]; then
  if ! node -e '
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[1];
let bad = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const expected = file.slice(0, file.indexOf("."));
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  } catch (error) {
    console.error(`${path.join(dir, file)}: invalid JSON — ${error.message}`);
    bad += 1;
    continue;
  }
  const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : null;
  if (!keys || keys.length !== 1 || keys[0] !== expected) {
    console.error(`${path.join(dir, file)}: root must be exactly { "${expected}": {…} } (found ${keys ? keys.map((k) => `"${k}"`).join(", ") || "no keys" : "a non-object root"})`);
    bad += 1;
  }
}
process.exit(bad === 0 ? 0 : 1);
' "$CATALOG_DIR"; then
    echo "check-ui-literals: FAILED — a catalog file under ${CATALOG_DIR} does not match the loader contract" >&2
    STATUS=1
  fi
fi

if [ "$STATUS" -ne 0 ]; then
  exit 1
fi
echo "check-ui-literals: OK — no hex/legacy-class/pt-BR literals in .tsx under ${DIRS[*]}; catalog files valid"
exit 0
