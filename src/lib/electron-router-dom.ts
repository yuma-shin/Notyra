import { createElectronRouter } from 'electron-router-dom'

export const { Router, registerRoute, settings } = createElectronRouter({
  port: 4928,

  types: {
    ids: ['main', 'about'],
  },
})
