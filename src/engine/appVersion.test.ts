import { describe, expect, it } from 'vitest'
import { SUPERPOE_VERSION, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'

describe('SuperPoE2 display version', () => {
  it('uses the application package version', () => {
    expect(SUPERPOE_VERSION).toBe('0.5.0')
    expect(SUPERPOE_VERSION_LABEL).toBe('v 0.5.0')
  })
})
