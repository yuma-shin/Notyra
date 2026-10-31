import { notyra } from '/fixture-esm/@notyra/api.js'

export function activate() {
  notyra.commands.register({ id: 'hello', title: 'Hello from ESM', run() {} })
  notyra.styles.add('.fixture-esm { color: green; }')
}

export function deactivate() {}
