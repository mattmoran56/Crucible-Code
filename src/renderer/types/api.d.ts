import type { ApiType } from '../../preload/index'

declare global {
  interface Window {
    api: ApiType
  }
}
