import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{app,worker,domain,tools}/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      include: ['domain/**/*.ts'],
      exclude: ['domain/**/*.test.ts'],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
