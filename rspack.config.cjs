// Ported verbatim from the SAME proven rspack build config every sibling
// NestJS-on-Lambda service in this ecosystem already uses successfully
// (titvo-task-trigger-aws, titvo-task-status-aws, titvo-task-cli-files-aws,
// titvo-auth-setup-aws all carry byte-identical or near-identical copies of
// this file) — this repo was missing it entirely, which made `npm run
// build` (and therefore titvo-installer's deploy pipeline, see
// `deploy_runtime.go`'s `runBuild`) fail with "Module not found: Can't
// resolve './src'" (rspack's zero-config default entry guess, since there
// was no config telling it the real entry is `./src/entrypoint.ts`).
//
// Named `.cjs` (not `.js`) to match the sibling repos exactly — `rspack
// build` with no `-c` flag resolves this via its default config-file
// lookup, proven to work the same way in all four siblings.
//
// `externals`' `lazyImports` list is adapted to THIS repo's actual
// `@aws-sdk/*` dependencies (per `package.json` + a source grep for
// `from '@aws-sdk/...'`): the siblings' list plus `@aws-sdk/client-secrets-manager`,
// which only this repo needs (for `AesService`/`SecretManagerService`
// backing the Config screen's encryption — the task/trigger/status/cli-files/
// auth-setup siblings have no equivalent).
const { SwcJsMinimizerRspackPlugin, IgnorePlugin } = require('@rspack/core')
const path = require('path')
const tsconfig = require('./tsconfig.json')

const aliases = Object.entries(tsconfig.compilerOptions.paths || {}).reduce(
  (acc, [alias, paths]) => {
    const formattedAlias = alias.replace('/*', '')
    const resolvedPath = path.resolve(__dirname, paths[0].replace('/*', ''))
    acc[formattedAlias] = resolvedPath
    return acc
  },
  {}
)

module.exports = {
  context: __dirname,
  target: 'node',
  entry: {
    entrypoint: ['./src/entrypoint.ts']
  },
  output: {
    path: path.resolve(__dirname, 'build/src'),
    filename: '[name].mjs',
    library: {
      type: 'module'
    },
    chunkFormat: 'module',
    clean: true
  },
  experiments: {
    outputModule: true,
    topLevelAwait: true
  },
  plugins: [
    new IgnorePlugin({
      resourceRegExp: /^@nestjs\/(websockets|microservices|platform-express)/
    }),
    // `@nestjs/common`'s `ParseFilePipe`/`FileTypeValidator` (unused —
    // confirmed via grep, this admin API has no file-upload endpoint)
    // statically requires `file-type`, whose installed version ships an
    // ESM-only `exports` map rspack cannot resolve
    // ("Package subpath '.' is not defined by 'exports'"). Ignoring it
    // here is the same pattern the sibling repos use for other optional
    // NestJS platform deps above — safe because it is never actually
    // called at runtime.
    new IgnorePlugin({
      resourceRegExp: /^file-type$/
    })
  ],
  resolve: {
    extensions: ['...', '.ts'],
    alias: aliases
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: {
                syntax: 'typescript',
                decorators: true
              },
              transform: {
                legacyDecorator: true,
                decoratorMetadata: true
              }
            }
          }
        }
      }
    ]
  },
  optimization: {
    minimizer: [
      new SwcJsMinimizerRspackPlugin({
        minimizerOptions: {
          // We need to disable mangling and compression for class names and function names for Nest.js to work properly
          // The execution context class returns a reference to the class/handler function, which is for example used for applying metadata using decorators
          // https://docs.nestjs.com/fundamentals/execution-context#executioncontext-class
          compress: {
            keep_classnames: true,
            keep_fnames: true
          },
          mangle: {
            keep_classnames: true,
            keep_fnames: true
          }
        }
      })
    ]
  },
  externalsType: 'module',
  externals: [
    function (obj, callback) {
      const resource = obj.request
      const lazyImports = [
        '@nestjs/core',
        'class-validator',
        'class-transformer',
        '@aws-sdk/client-lambda',
        '@aws-sdk/client-ssm',
        '@aws-sdk/client-sfn',
        '@aws-sdk/client-s3',
        '@aws-sdk/client-dynamodb',
        '@aws-sdk/client-batch',
        '@aws-sdk/client-secrets-manager'
      ]
      if (!lazyImports.includes(resource)) {
        return callback()
      }
      try {
        require.resolve(resource)
      } catch (err) {
        callback(null, resource)
      }
      callback()
    }
  ]
}
