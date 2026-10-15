import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('keeps the production build configuration independent from the pilot', () => {
  const require = createRequire(resolve('package.json'))
  const base = require('./rspack.config.cjs')
  const originalEntry = base.entry
  const originalOutput = base.output
  const originalRules = base.module.rules
  const pilot = require('./rspack.web-functions.cjs')

  expect(base.entry).toBe(originalEntry)
  expect(base.output).toBe(originalOutput)
  expect(base.module.rules).toBe(originalRules)
  expect(base.entry).toEqual({ entrypoint: ['./src/entrypoint.ts'] })
  expect(base.output.path).toBe(resolve('build/src'))
  expect(base.output.clean).toBe(true)
  expect(pilot.entry).toEqual({ index: ['./src/web-functions/index.ts'] })
  expect(pilot.output.path).toBe(resolve('pilot-build'))
  expect(pilot.output.filename).toBe('index.mjs')
  expect(pilot.output.clean).toBe(false)
  expect(pilot.module).not.toBe(base.module)
  expect(pilot.module.rules).not.toBe(originalRules)
  expect(pilot.module.rules).toEqual(originalRules)
  expect(pilot.plugins).not.toBe(base.plugins)
  pilot.plugins.forEach((plugin: object, index: number) => {
    expect(plugin).not.toBe(base.plugins[index])
    expect(plugin).toEqual(base.plugins[index])
  })
  expect(pilot.optimization.minimizer[0]).not.toBe(base.optimization.minimizer[0])
  expect(pilot.optimization.minimizer[0]).toEqual(base.optimization.minimizer[0])
})
