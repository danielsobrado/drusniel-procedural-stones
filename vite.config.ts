import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  resolve: {
    dedupe: ['three']
  },
  optimizeDeps: {
    include: ['three']
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
});
