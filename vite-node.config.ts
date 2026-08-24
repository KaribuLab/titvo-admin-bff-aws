import { defineConfig } from 'vite'
import { resolve } from 'path'
import swc from 'unplugin-swc'

/**
 * Config for `npm run dev` (src/local-server.ts) ONLY — deliberately
 * separate from vitest.config.ts so this never affects the real test
 * suite. Same path aliases as vitest.config.ts (kept in sync manually),
 * plus `unplugin-swc`: esbuild (what plain vite-node uses by default)
 * does NOT emit TypeScript's `emitDecoratorMetadata` output, which
 * NestJS's constructor-based DI depends on to resolve a provider by its
 * parameter type. Without this plugin, every NestJS class with injected
 * dependencies silently receives `undefined` instead of the real
 * provider — this was caught by actually running the local server against
 * LocalStack (login failed with "Cannot read properties of undefined
 * (reading 'findByEmail')"), not by the unit tests, since those construct
 * classes manually with fake args and never exercise Nest's real DI
 * container.
 */
export default defineConfig({
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
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022'
      }
    })
  ]
})
