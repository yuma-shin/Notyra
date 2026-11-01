import { act, cleanup, render } from '@testing-library/react'
import fc from 'fast-check'
import i18n from 'i18next'
import { expect, it } from 'vitest'
import { runs } from '../../../../helpers/pluginArbitraries'
import { RegistryList } from '@/renderer/components/settings/plugins/RegistryList'
import { PluginSettingsForm } from '@/renderer/components/settings/plugins/PluginSettingsForm'
import { ConsentDialog } from '@/renderer/components/settings/plugins/ConsentDialog'

// Feature: plugin-system, Property 12: Plugin 由来の文言をそのまま表示する
it('Property 12: keeps plugin text literal in Japanese and English', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(
        fc.string(),
        fc.constantFrom(
          'plugins.registry.install',
          '{{name}}',
          '<script>alert(1)</script>',
          '設定\n"quoted"'
        )
      ),
      fc.constantFrom('ja', 'en'),
      async (value, language) => {
        const text = `Literal ${value}`
        try {
          await i18n.changeLanguage(language)
          await act(async () => {
            render(
              <>
                <RegistryList
                  fetchRegistry={async () =>
                    JSON.stringify({
                      schemaVersion: 1,
                      plugins: [
                        {
                          id: 'p',
                          name: text,
                          description: text,
                          author: text,
                          repo: 'o/p',
                        },
                      ],
                    })
                  }
                  installedIds={new Set()}
                  onInstall={async () => {}}
                  openExternal={() => {}}
                />
                <PluginSettingsForm
                  pluginId="p"
                  displayName={text}
                  settings={[
                    {
                      key: 's',
                      title: text,
                      description: text,
                      type: 'string',
                      default: '',
                    },
                  ]}
                  loadSettings={async () => ({})}
                  saveSetting={async () => {}}
                />
                <ConsentDialog
                  open
                  request={{
                    mode: 'install',
                    displayName: text,
                    author: text,
                    source: { type: 'github', owner: 'o', repo: 'p' },
                    permissions: [{ name: 'clipboard', purpose: text }],
                    destinations: [],
                  }}
                  onResult={() => {}}
                />
              </>
            )
          })
          expect(
            document.querySelector('[data-testid="registry-entry"]')
              ?.textContent
          ).toContain(text)
          expect(document.querySelector('label')?.textContent).toContain(text)
          expect(
            document.querySelector('[data-testid="consent-author"]')
              ?.textContent
          ).toBe(text)
          expect(
            document.querySelector('[data-testid="consent-purpose"]')
              ?.textContent
          ).toContain(text)
          expect(document.querySelectorAll('script')).toHaveLength(0)
        } finally {
          cleanup()
          await i18n.changeLanguage('en')
        }
      }
    ),
    runs
  )
})
