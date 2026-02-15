import ReactDom from 'react-dom/client'
import React from 'react'

import { AppRoutes } from './routes'
import { AppProvider } from './contexts/AppContext'
import './i18n'

import './globals.css'

ReactDom.createRoot(document.querySelector('app') as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <AppRoutes />
    </AppProvider>
  </React.StrictMode>
)
