import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach } from 'vitest';

// Springs have nothing to animate under happy-dom; skip them so mount/exit are synchronous.
MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
});
