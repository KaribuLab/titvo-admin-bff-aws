const path = require('node:path')
const base = require('./rspack.config.cjs')

// Rspack may normalize configuration objects. Return fresh nested configuration
// and fresh plugin instances so importing this file never changes the production
// config, even when both configurations are loaded in the same process.
function copy (value) {
  if (Array.isArray(value)) return value.map(copy)
  if (value instanceof RegExp) return new RegExp(value.source, value.flags)
  if (value !== null && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      // Rspack 1.2.5 builtin plugins retain their constructor arguments.
      // Fail closed if a future plugin no longer exposes that contract.
      if (!Array.isArray(value._args)) throw new Error('Unsupported pilot build plugin')
      return new value.constructor(...copy(value._args))
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)]))
  }
  return value
}

module.exports = {
  ...copy(base),
  entry: { index: ['./src/web-functions/index.ts'] },
  output: {
    ...copy(base.output),
    path: path.resolve(__dirname, 'pilot-build'),
    filename: 'index.mjs',
    chunkFilename: '[name].mjs',
    clean: false
  }
}
