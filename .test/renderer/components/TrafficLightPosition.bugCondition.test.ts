/**
 * Bug Condition Exploration Test - macOS Traffic Light Position
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * This test encodes the EXPECTED (correct) behavior:
 * - Main window (tauri.macos.conf.json) has trafficLightPosition: { x: 14, y: 15 }
 * - Settings window (open_settings_window) calls .traffic_light_position(LogicalPosition::new(14.0, 15.0))
 * - Note editor window (open_note_window) calls .traffic_light_position(LogicalPosition::new(14.0, 15.0))
 *
 * On UNFIXED code, these tests MUST FAIL — failure confirms the bug exists.
 *
 * Bug Condition: isBugCondition(input) where platform == macOS
 *   AND titleBarStyle == "Overlay"
 *   AND trafficLightPosition IS NOT SET
 *   AND titlebarHeight == 44
 *
 * Counterexamples to document:
 * - Main window: tauri.macos.conf.json has titleBarStyle "Overlay" but no trafficLightPosition
 * - Settings window: open_settings_window sets .title_bar_style(Overlay) but no .traffic_light_position(LogicalPosition::new(...))
 * - Note editor: open_note_window sets .title_bar_style(Overlay) but no .traffic_light_position(LogicalPosition::new(...))
 * - All macOS overlay windows lack trafficLightPosition, causing buttons to render at
 *   OS default (~y=7) instead of centered (y=15) within 44px titlebar
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Paths to source files under test
const TAURI_MACOS_CONF = path.resolve(__dirname, '../../../src-tauri/tauri.macos.conf.json')
const WINDOW_RS = path.resolve(__dirname, '../../../src-tauri/src/commands/window.rs')

describe('Bug Condition Exploration: Traffic Light Position Not Set on macOS Overlay Windows', () => {
  /**
   * Property 1: Bug Condition - Main window trafficLightPosition
   *
   * For the main window configured in tauri.macos.conf.json with titleBarStyle "Overlay",
   * the config SHALL include trafficLightPosition: { x: 14, y: 15 } to vertically center
   * traffic light buttons within the 44px titlebar.
   *
   * Position calculation: (44px titlebar - 14px button height) / 2 = 15px vertical offset
   *
   * On UNFIXED code: trafficLightPosition is missing → test FAILS (confirms bug)
   */
  it('tauri.macos.conf.json main window has trafficLightPosition set to { x: 14, y: 15 }', () => {
    const configContent = fs.readFileSync(TAURI_MACOS_CONF, 'utf-8')
    const config = JSON.parse(configContent)

    // The main window config should exist
    const mainWindow = config.app?.windows?.[0]
    expect(mainWindow).toBeDefined()
    expect(mainWindow.label).toBe('main')

    // Verify titleBarStyle is Overlay (precondition for bug condition)
    expect(mainWindow.titleBarStyle).toBe('Overlay')

    // Bug condition check: trafficLightPosition MUST be set
    expect(mainWindow.trafficLightPosition).toBeDefined()
    expect(mainWindow.trafficLightPosition).toEqual({ x: 14, y: 15 })
  })

  /**
   * Property 1: Bug Condition - Settings window traffic_light_position
   *
   * For open_settings_window in window.rs, the #[cfg(target_os = "macos")] block
   * SHALL include .traffic_light_position(LogicalPosition::new(14.0, 15.0)) to vertically center
   * traffic light buttons within the 44px titlebar.
   *
   * On UNFIXED code: .traffic_light_position() call is missing → test FAILS (confirms bug)
   */
  it('open_settings_window includes .traffic_light_position(LogicalPosition::new(14.0, 15.0)) in macOS cfg block', () => {
    const rustContent = fs.readFileSync(WINDOW_RS, 'utf-8')

    // Extract the open_settings_window function body
    const settingsFnMatch = rustContent.match(
      /pub fn show_settings_window[\s\S]*?^}/m
    )
    expect(settingsFnMatch).not.toBeNull()
    const settingsFnBody = settingsFnMatch![0]

    // Verify precondition: title_bar_style(TitleBarStyle::Overlay) is present
    expect(settingsFnBody).toContain('title_bar_style(TitleBarStyle::Overlay)')

    // Bug condition check: traffic_light_position(LogicalPosition::new(14.0, 15.0)) MUST be present
    expect(settingsFnBody).toMatch(/traffic_light_position\(LogicalPosition::new\(\s*14\.0\s*,\s*15\.0\s*\)\)/)
  })

  /**
   * Property 1: Bug Condition - Note editor window traffic_light_position
   *
   * For open_note_window in window.rs, the #[cfg(target_os = "macos")] block
   * SHALL include .traffic_light_position(LogicalPosition::new(14.0, 15.0)) to vertically center
   * traffic light buttons within the 44px titlebar.
   *
   * On UNFIXED code: .traffic_light_position() call is missing → test FAILS (confirms bug)
   */
  it('open_note_window includes .traffic_light_position(LogicalPosition::new(14.0, 15.0)) in macOS cfg block', () => {
    const rustContent = fs.readFileSync(WINDOW_RS, 'utf-8')

    // Extract the open_note_window function body
    const noteFnMatch = rustContent.match(
      /pub async fn open_note_window[\s\S]*?^}/m
    )
    expect(noteFnMatch).not.toBeNull()
    const noteFnBody = noteFnMatch![0]

    // Verify precondition: title_bar_style(TitleBarStyle::Overlay) is present
    expect(noteFnBody).toContain('title_bar_style(TitleBarStyle::Overlay)')

    // Bug condition check: traffic_light_position(LogicalPosition::new(14.0, 15.0)) MUST be present
    expect(noteFnBody).toMatch(/traffic_light_position\(LogicalPosition::new\(\s*14\.0\s*,\s*15\.0\s*\)\)/)
  })
})
