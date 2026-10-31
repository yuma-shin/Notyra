import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseRegistry } from '@/renderer/lib/plugins/registry'

it('ships a valid registry seed for publishing', () => {
  expect(
    parseRegistry(readFileSync('docs/plugin-registry/registry.json', 'utf8'))
  ).toEqual({ ok: true, value: [] })
})

it('keeps plugin execution origins separate from renderer network permissions', () => {
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
  const csp = config.app.security.csp as string
  const directives = new Map(
    csp.split(';').map(part => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name, values]
    })
  )
  expect(directives.get('connect-src')).toEqual([
    "'self'",
    'http://ipc.localhost',
  ])
  expect(directives.get('script-src')).toEqual(
    expect.arrayContaining(['notyra-plugin:', 'http://notyra-plugin.localhost'])
  )
  expect(directives.get('script-src')).not.toEqual(
    expect.arrayContaining(['asset:'])
  )
  expect(directives.get('script-src')).not.toEqual(
    expect.arrayContaining(['blob:'])
  )
  const capabilities = JSON.parse(
    readFileSync('src-tauri/capabilities/default.json', 'utf8')
  )
  expect(
    capabilities.permissions.filter((p: string) =>
      p.startsWith('clipboard-manager:')
    )
  ).toEqual([
    'clipboard-manager:allow-read-text',
    'clipboard-manager:allow-write-text',
  ])
})
