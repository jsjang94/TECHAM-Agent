import { ElectronAPI } from '@electron-toolkit/preload'

interface Api {
  quitApp: () => void
  minimizeApp: () => void
  openExternal: (url: string) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
