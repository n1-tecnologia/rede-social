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
});
