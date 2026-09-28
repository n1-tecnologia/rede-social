import { vitestBase } from '@rede-social/config/vitest.base';
import { defineConfig, mergeConfig } from 'vitest/config';

/** Vitest 5 no longer walks up for a config: every package owns one (see packages/config/vitest.base.ts). */
export default mergeConfig(vitestBase, defineConfig({ test: { include: ['tests/**/*.test.ts'] } }));
