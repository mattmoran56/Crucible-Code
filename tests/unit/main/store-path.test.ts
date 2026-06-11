import { beforeEach, describe, expect, it } from 'vitest'
import { join } from 'path'

// vi.mock is hoisted above imports, so all mutable state the factory closes
// over must come from vi.hoisted.
const electronState = vi.hoisted(() => ({
  isPackaged: false,
  userData: '/fake/user-data',
  getPathCalls: [] as string[],
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged
    },
    getPath: (name: string) => {
      electronState.getPathCalls.push(name)
      return electronState.userData
    },
  },
}))

import { getStorePath } from '../../../src/main/store-path'

beforeEach(() => {
  electronState.isPackaged = false
  electronState.userData = '/fake/user-data'
  electronState.getPathCalls.length = 0
})

describe('store-path', () => {
  it('returns the raw userData dir when the app is packaged', () => {
    electronState.isPackaged = true
    expect(getStorePath()).toBe('/fake/user-data')
  })

  it('appends a dev subdirectory when not packaged to isolate dev instances', () => {
    electronState.isPackaged = false
    expect(getStorePath()).toBe(join('/fake/user-data', 'dev'))
  })

  it("resolves the base from electron's userData path", () => {
    electronState.userData = '/elsewhere/data'
    electronState.isPackaged = true
    expect(getStorePath()).toBe('/elsewhere/data')
    expect(electronState.getPathCalls).toEqual(['userData'])
  })
})
