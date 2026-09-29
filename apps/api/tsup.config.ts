import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  // TypeScript 7.0 ships no JS compiler API, so declaration bundling is off (RESEARCH §Pitfall 3).
  dts: false,
  clean: true,
  sourcemap: true,
  // Workspace packages are published as TypeScript sources; bundle them into dist/.
  noExternal: [/^@rede-social\//],
  // Third-party deps of the bundled workspace packages are bundled too (tsup only externalizes
  // apps/api's own dependencies), and some are CommonJS (undici, via module-feed's unfurl guard)
  // that call require() for Node builtins. In ESM output esbuild's `__require` shim only delegates
  // when a `require` binding exists, so give every output file (entry and chunks) a real
  // module-scoped require. The `__rsCreateRequire` alias avoids clashing with a bundled
  // `createRequire` import; esbuild renames bundled top-level `require` declarations (`require2`).
  banner: {
    js: "import { createRequire as __rsCreateRequire } from 'node:module'; const require = __rsCreateRequire(import.meta.url);",
  },
  // tsup strips `node:` by default, which turns undici's lazy `require('node:sqlite')` into the
  // unresolvable bare `sqlite` (a prefix-only builtin). Target is node24, so keep the protocol.
  removeNodeProtocol: false,
  // sharp loads its native addon (`@img/sharp-<platform>/sharp.node`) at runtime relative to its
  // own package, so bundling it into dist/ breaks the lookup. It is also an apps/api dependency so
  // the Dockerfile's `pnpm deploy --prod` installs it (with the linux-x64 addon) next to dist/.
  // Any future native-addon dependency of a workspace package needs the same treatment.
  external: ['sharp'],
});
