import { describe, expect, it } from 'vitest'
import packageMetadata from '../../package.json'
import { SUPERPOE_VERSION, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'

describe('SuperPoE2 display version', () => {
  it('uses the application package version', () => {
    expect(SUPERPOE_VERSION).toBe(packageMetadata.version)
    expect(SUPERPOE_VERSION_LABEL).toBe(`v ${packageMetadata.version}`)
  })
})
