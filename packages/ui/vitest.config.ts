import { vitestBase } from '@tria/config/vitest.base';
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Component tests run under happy-dom with Testing Library. Vitest 5 no longer walks up for a
 * config, so this package owns one and extends the shared fragment (packages/config/vitest.base.ts).
 */
export default mergeConfig(
  vitestBase,
  defineConfig({
    plugins: [react()],
    test: {
      environment: 'happy-dom',
      include: ['tests/**/*.test.{ts,tsx}'],
      setupFiles: ['./tests/setup.ts'],
    },
  }),
);
