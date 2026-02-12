import { Route } from 'react-router-dom'
import { HashRouter, Routes } from 'react-router-dom'

import { Router } from 'lib/electron-router-dom'

import { MainScreen } from './screens/main'
import { EditorScreen } from './screens/editor'

export function AppRoutes() {
  // URLのハッシュから判定して適切なルーターを使用
  const isEditorWindow = window.location.hash.startsWith('#/editor')

  if (isEditorWindow) {
    // エディタウィンドウの場合は通常のHashRouterを使用
    return (
      <HashRouter>
        <Routes>
          <Route element={<EditorScreen />} path="/editor" />
        </Routes>
      </HashRouter>
    )
  }

  // メインウィンドウの場合はelectron-router-domを使用
  return <Router main={<Route element={<MainScreen />} path="/" />} />
}
