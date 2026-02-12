import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { createMockWindowApp } from './window-app-mock'

beforeEach(() => {
  window.App = createMockWindowApp()
})
