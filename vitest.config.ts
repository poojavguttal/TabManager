import { defineConfig } from 'vitest/config';

// Unit tests only. The labeled evaluation set runs separately: `npm run eval`.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
