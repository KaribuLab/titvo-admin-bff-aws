import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    exclude: ['node_modules', 'auth/**', 'lib/**', 'shared/**', 'dist', 'build']
  },
  resolve: {
    alias: {
      '@infrastructure': resolve(__dirname, 'src/infrastructure'),
      '@app': resolve(__dirname, 'src/app'),
      '@core': resolve(__dirname, 'src/core'),
      '@auth': resolve(__dirname, 'auth/src'),
      '@aws': resolve(__dirname, 'lib/aws/src'),
      '@shared': resolve(__dirname, 'shared/src'),
      '@titvo/shared': resolve(__dirname, 'shared/index.ts'),
      '@titvo/aws': resolve(__dirname, 'lib/aws/index.ts'),
      '@titvo/auth': resolve(__dirname, 'auth/index.ts')
    }
  }
})
