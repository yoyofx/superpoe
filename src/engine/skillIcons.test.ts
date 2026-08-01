import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveSkillIcon, resolveSkillIconName } from '@/engine/skillIcons'

describe('skill icon resolver', () => {
  const index = JSON.parse(readFileSync('public/data/skill-icons.json', 'utf8'))

  it.each(['Spark', 'Spear Throw', 'Impurity', 'Rite of Restoration', 'Pierce III', 'Rapid Casting II'])(
    'resolves the generated icon for %s',
    (name) => {
      const path = resolveSkillIconName(name, index)
      expect(path).toMatch(/^\/assets\/skills\/poe2db\//)
      expect(existsSync(`public${path}`)).toBe(true)
    },
  )

  it('resolves a support gem by PoB skill id', () => {
    const path = resolveSkillIcon({
      name: 'Unknown',
      skillId: 'SupportPiercePlayerThree',
      gemId: '',
      variantId: '',
      level: 1,
      quality: 0,
      enabled: true,
    }, index)
    expect(path).toBe(resolveSkillIconName('Pierce III', index))
  })
})
