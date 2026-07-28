import { describe, expect, it } from 'vitest'
import packageMetadata from '../../package.json'
import {
  SUPERPOE_GAME_VERSION,
  SUPERPOE_PACKAGE_VERSION,
  SUPERPOE_REVISION,
  SUPERPOE_VERSION,
  SUPERPOE_VERSION_LABEL,
} from '@/engine/appVersion'

describe('SuperPoE2 display version', () => {
  it('combines the supported game version with the SuperPoE revision', () => {
    expect(SUPERPOE_PACKAGE_VERSION).toBe(packageMetadata.version)
    expect(SUPERPOE_GAME_VERSION).toBe(packageMetadata.superpoe.gameVersion)
    expect(SUPERPOE_REVISION).toBe(packageMetadata.superpoe.revision)
    expect(SUPERPOE_VERSION).toBe('0.5.0.1')
    expect(SUPERPOE_VERSION_LABEL).toBe('v 0.5.0.1')
  })
})
