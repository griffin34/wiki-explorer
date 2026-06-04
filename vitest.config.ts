import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Default environment for src/** (DOM APIs available)
    environment: 'happy-dom',
    environmentMatchGlobs: [
      ['server/**', 'node'],
    ],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'server/index.ts'],
      exclude: [
        'src/main.tsx',
        'src/test-utils.tsx',
        'src/**/*.test.*',
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
