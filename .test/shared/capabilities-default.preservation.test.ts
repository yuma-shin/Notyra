/**
 * Preservation Property Test - Existing Window Labels Retained
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * This test verifies that existing window labels and permissions in
 * `src-tauri/capabilities/default.json` remain unchanged after any fix.
 *
 * These tests MUST PASS on both unfixed and fixed code — they assert
 * that the fix does not regress existing functionality.
 *
 * Observations on unfixed code:
 * - `windows` array contains "main"
 * - `windows` array contains "note_*"
 * - `windows` array contains "print-preview"
 * - `permissions` array contains all required window permissions
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Preservation: Existing Window Labels and Permissions Retained', () => {
  const capabilitiesPath = resolve(__dirname, '../../src-tauri/capabilities/default.json')

  function loadCapabilities(): { windows: string[]; permissions: string[] } {
    const content = readFileSync(capabilitiesPath, 'utf-8')
    return JSON.parse(content)
  }

  describe('Window labels preservation', () => {
    /**
     * Validates: Requirement 3.1, 3.3
     * Main window must remain in the windows array so that it retains
     * all window API permissions (drag, minimize, maximize, close).
     */
    it('"main" window label is present in the windows array', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.windows).toContain('main')
    })

    /**
     * Validates: Requirement 3.2, 3.4
     * Note sub-windows (note_*) must remain in the windows array so that
     * they retain all window API permissions (drag, minimize, maximize, close).
     */
    it('"note_*" window label is present in the windows array', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.windows).toContain('note_*')
    })

    /**
     * Validates: Requirement 3.5
     * Print-preview window must remain in the windows array so that
     * it retains access to window API permissions.
     */
    it('"print-preview" window label is present in the windows array', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.windows).toContain('print-preview')
    })
  })

  describe('Permissions array preservation', () => {
    /**
     * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
     * All window-related permissions must remain unchanged so that
     * existing windows continue to function correctly.
     */
    it('contains core:window:allow-start-dragging permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-start-dragging')
    })

    it('contains core:window:allow-minimize permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-minimize')
    })

    it('contains core:window:allow-maximize permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-maximize')
    })

    it('contains core:window:allow-unmaximize permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-unmaximize')
    })

    it('contains core:window:allow-close permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-close')
    })

    it('contains core:window:allow-destroy permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-destroy')
    })

    it('contains core:window:allow-set-focus permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-set-focus')
    })

    it('contains core:window:allow-is-maximized permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-is-maximized')
    })

    it('contains core:window:allow-set-size permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-set-size')
    })

    it('contains core:window:allow-set-position permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-set-position')
    })

    it('contains core:window:allow-outer-size permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-outer-size')
    })

    it('contains core:window:allow-outer-position permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-outer-position')
    })

    it('contains core:window:allow-scale-factor permission', () => {
      const capabilities = loadCapabilities()
      expect(capabilities.permissions).toContain('core:window:allow-scale-factor')
    })

    /**
     * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
     * The full permissions array must be preserved exactly. This is a
     * comprehensive check that no permissions are accidentally removed or modified.
     */
    it('permissions array contains all expected entries', () => {
      const capabilities = loadCapabilities()
      const expectedPermissions = [
        'core:default',
        'core:window:allow-start-dragging',
        'core:window:allow-set-focus',
        'core:window:allow-minimize',
        'core:window:allow-unminimize',
        'core:window:allow-maximize',
        'core:window:allow-unmaximize',
        'core:window:allow-close',
        'core:window:allow-destroy',
        'core:window:allow-is-maximized',
        'core:window:allow-set-size',
        'core:window:allow-set-position',
        'core:window:allow-outer-size',
        'core:window:allow-outer-position',
        'core:window:allow-scale-factor',
        'core:event:default',
        'fs:default',
        'fs:allow-read-dir',
        'fs:allow-watch',
        'dialog:default',
        'store:default',
        'store:allow-load',
        'store:allow-save',
        'store:allow-set',
        'store:allow-get',
        'opener:default',
        // plugin-system (Requirement 6.10): クリップボードのテキスト読み書きのみ許可
        'clipboard-manager:allow-read-text',
        'clipboard-manager:allow-write-text',
      ]

      for (const permission of expectedPermissions) {
        expect(capabilities.permissions).toContain(permission)
      }
      // Ensure no permissions were removed (same length)
      expect(capabilities.permissions).toHaveLength(expectedPermissions.length)
    })
  })
})
