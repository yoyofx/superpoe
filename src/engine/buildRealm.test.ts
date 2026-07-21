import { describe, expect, it } from 'vitest'
import { buildRealmLabel, inferBuildRealm } from '@/engine/buildRealm'

describe('build realm metadata', () => {
  it('keeps an explicit realm', () => {
    expect(inferBuildRealm({ name: 'Build', source: 'pob', realm: 'cn' })).toBe('cn')
    expect(inferBuildRealm({ name: 'Build', source: 'wegame', realm: 'global' })).toBe('global')
  })

  it('migrates old builds from their source or legacy name prefix', () => {
    expect(inferBuildRealm({ name: 'Build', source: 'wegame' })).toBe('cn')
    expect(inferBuildRealm({ name: '[国服] Build', source: 'local' })).toBe('cn')
    expect(inferBuildRealm({ name: '[CN] Build', source: 'json' })).toBe('cn')
    expect(inferBuildRealm({ name: 'Build', source: 'pob' })).toBe('global')
  })

  it('provides stable localized labels', () => {
    expect(buildRealmLabel('cn', true)).toBe('腾讯服')
    expect(buildRealmLabel('global', false)).toBe('Global')
  })
})
