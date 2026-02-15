import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { AppProvider, useApp } from '@/renderer/contexts/AppContext'

function wrapper({ children }: { children: React.ReactNode }) {
  return <AppProvider>{children}</AppProvider>
}

describe('AppContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('useApp', () => {
    it('AppProvider 外で使用するとエラーを投げる', () => {
      // renderHook の中でエラーが出るので expect で wrap
      expect(() => {
        renderHook(() => useApp())
      }).toThrow('useApp must be used within AppProvider')
    })

    it('デフォルト設定を提供する', () => {
      const { result } = renderHook(() => useApp(), { wrapper })

      expect(result.current.settings).toEqual({
        editorLayoutMode: 'split',
        theme: 'system',
        language: 'en',
        showSidebar: true,
        showNoteList: true,
      })
    })

    it('isLoading が初期値 true から false に変化する', async () => {
      const { result } = renderHook(() => useApp(), { wrapper })

      // useEffect 内で setIsLoading(false) が呼ばれるため
      // renderHook は act() 内で実行されるのでフラッシュ済み
      expect(result.current.isLoading).toBe(false)
    })
  })

  describe('localStorage からの読み込み', () => {
    it('保存済みの設定を localStorage から読み込む', () => {
      localStorage.setItem(
        'appSettings',
        JSON.stringify({ theme: 'dark', editorLayoutMode: 'preview' }),
      )

      const { result } = renderHook(() => useApp(), { wrapper })

      expect(result.current.settings.theme).toBe('dark')
      expect(result.current.settings.editorLayoutMode).toBe('preview')
      // デフォルト値はマージされる
      expect(result.current.settings.showSidebar).toBe(true)
    })

    it('不正な JSON が保存されている場合はデフォルト設定を使用する', () => {
      localStorage.setItem('appSettings', 'invalid-json')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderHook(() => useApp(), { wrapper })

      expect(result.current.settings.theme).toBe('system')
      consoleSpy.mockRestore()
    })
  })

  describe('updateSettings', () => {
    it('設定を部分的に更新する', () => {
      const { result } = renderHook(() => useApp(), { wrapper })

      act(() => {
        result.current.updateSettings({ theme: 'dark' })
      })

      expect(result.current.settings.theme).toBe('dark')
      // 他の設定は保持される
      expect(result.current.settings.editorLayoutMode).toBe('split')
    })

    it('更新した設定を localStorage に保存する', () => {
      const { result } = renderHook(() => useApp(), { wrapper })

      act(() => {
        result.current.updateSettings({ theme: 'light' })
      })

      const stored = JSON.parse(localStorage.getItem('appSettings')!)
      expect(stored.theme).toBe('light')
      expect(stored.editorLayoutMode).toBe('split')
    })

    it('複数の設定を同時に更新する', () => {
      const { result } = renderHook(() => useApp(), { wrapper })

      act(() => {
        result.current.updateSettings({
          theme: 'dark',
          editorLayoutMode: 'editor',
          showSidebar: false,
        })
      })

      expect(result.current.settings.theme).toBe('dark')
      expect(result.current.settings.editorLayoutMode).toBe('editor')
      expect(result.current.settings.showSidebar).toBe(false)
    })
  })

  describe('StorageEvent による同期', () => {
    it('他のウィンドウからの StorageEvent で設定が更新される', () => {
      const { result } = renderHook(() => useApp(), { wrapper })

      act(() => {
        const event = new StorageEvent('storage', {
          key: 'appSettings',
          newValue: JSON.stringify({ theme: 'dark', editorLayoutMode: 'preview' }),
        })
        window.dispatchEvent(event)
      })

      expect(result.current.settings.theme).toBe('dark')
      expect(result.current.settings.editorLayoutMode).toBe('preview')
      // デフォルト値はマージされる
      expect(result.current.settings.showSidebar).toBe(true)
    })

    it('関係のないキーの StorageEvent は無視する', () => {
      const { result } = renderHook(() => useApp(), { wrapper })

      act(() => {
        const event = new StorageEvent('storage', {
          key: 'otherKey',
          newValue: JSON.stringify({ theme: 'dark' }),
        })
        window.dispatchEvent(event)
      })

      expect(result.current.settings.theme).toBe('system')
    })

    it('不正な JSON の StorageEvent は無視する', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = renderHook(() => useApp(), { wrapper })

      act(() => {
        const event = new StorageEvent('storage', {
          key: 'appSettings',
          newValue: 'invalid-json',
        })
        window.dispatchEvent(event)
      })

      expect(result.current.settings.theme).toBe('system')
      consoleSpy.mockRestore()
    })
  })
})
