import type { NotyraPluginApi } from '../../../../../src/shared/plugin/api'
// @ts-expect-error The package is provided by the app's virtual module endpoint.
import { notyra } from '@notyra/plugin-api'

export function activate(): void {
  const api: NotyraPluginApi = notyra
  api.commands.register({ id: 'hello', title: 'Hello from TypeScript', run() {} })
  api.styles.add('.fixture-typescript { color: blue; }')
}

export function deactivate(): void {}
