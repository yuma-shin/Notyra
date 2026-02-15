import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    testTimeout: 10000,
    hookTimeout: 10000,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['.test/main/**/*.test.ts', '.test/shared/**/*.test.ts', '.test/shared/**/*.test-d.ts'],
          setupFiles: ['.test/helpers/setup-node.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['.test/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['.test/helpers/setup-renderer.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/resources/**', 'src/lib/electron-app/release/**'],
    },
  },
})
