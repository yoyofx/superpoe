import { describe, expect, it } from 'vitest'
import { decodeCodeToXml, encodeXmlToCode } from '@/engine/buildCode'
import {
  POB_ITEM_COMPATIBILITY_RULES,
  normalizePobBuildCode,
  normalizePobBuildCodeResult,
  normalizePobBuildXml,
  normalizePobItemRaw,
} from '@/engine/pobItemCompatibility'

describe('PoB item compatibility normalization', () => {
  it('documents and normalizes exactly the seven observed WeGame rules', () => {
    expect(POB_ITEM_COMPATIBILITY_RULES).toHaveLength(7)

    const raw = [
      'Rarity: RARE',
      'Compatibility Test',
      'Ring',
      'Implicits: 0',
      '{crafted}Fire Resistance is +23%',
      '{enchant}{rune}Cold Resistance is -5%',
      'Lightning Resistance is +41.5%',
      'Chaos Resistance is +12%',
      '+985 to maximum Runic Ward',
      '{rune}40% increased Runic Ward',
      '46% increased Effect of Prefixes',
    ].join('\n')

    const result = normalizePobItemRaw(raw)

    expect(result.changed).toBe(true)
    expect(result.matchedRules).toEqual([
      'legacy-fire-resistance',
      'legacy-cold-resistance',
      'legacy-lightning-resistance',
      'legacy-chaos-resistance',
      'legacy-maximum-runic-ward',
      'legacy-increased-runic-ward',
      'prefix-effect-parser-bridge',
    ])
    expect(result.raw).toContain('{crafted}+23% to Fire Resistance')
    expect(result.raw).toContain('{enchant}{rune}-5% to Cold Resistance')
    expect(result.raw).toContain('+41.5% to Lightning Resistance')
    expect(result.raw).toContain('+12% to Chaos Resistance')
    expect(result.raw).toContain('+985 to maximum Ward')
    expect(result.raw).toContain('{rune}40% increased Ward')
    // The prefix-effect line is parsed by the project-owned Lua bridge and
    // remains unchanged in the canonical Item Raw.
    expect(result.raw).toContain('46% increased Effect of Prefixes')
  })

  it('preserves markers, line endings, and non-item XML content', () => {
    const xml = '<PathOfBuilding2>\r\n'
      + '  <Build note="Fire Resistance is +10%"/>\r\n'
      + '  <Item id="1">Rarity: RARE\r\nFire Resistance is +10%\r\n</Item>\r\n'
      + '  <Config><Input name="x" value="Cold Resistance is +20%"/></Config>\r\n'
      + '</PathOfBuilding2>'

    const result = normalizePobBuildXml(xml)

    expect(result.changed).toBe(true)
    expect(result.xml).toContain('note="Fire Resistance is +10%"')
    expect(result.xml).toContain('value="Cold Resistance is +20%"')
    expect(result.xml).toContain('<Item id="1">Rarity: RARE\r\n+10% to Fire Resistance\r\n</Item>')
    expect(result.xml.match(/\r\n/g)?.length).toBe(xml.match(/\r\n/g)?.length)
  })

  it('is idempotent', () => {
    const raw = 'Rarity: RARE\nTest\nRing\nImplicits: 0\nFire Resistance is +20%\n+100 to maximum Runic Ward'
    const once = normalizePobItemRaw(raw).raw
    const twice = normalizePobItemRaw(once)

    expect(twice.raw).toBe(once)
    expect(twice.changed).toBe(false)
    expect(twice.matchedRules).toEqual([])
  })

  it('round-trips normalized XML through PoB Code', () => {
    const originalXml = '<PathOfBuilding2><Build level="90"/>'
      + '<Items><Item id="1">Rarity: RARE\nTest\nRing\nImplicits: 0\n'
      + '{rune}Fire Resistance is +25%</Item></Items>'
      + '<Config><Input name="x" value="1"/></Config></PathOfBuilding2>'
    const originalCode = encodeXmlToCode(originalXml)
    const result = normalizePobBuildCodeResult(originalCode)

    expect(result.changed).toBe(true)
    expect(decodeCodeToXml(result.code)).toContain('{rune}+25% to Fire Resistance')
    expect(decodeCodeToXml(result.code)).toContain('<Config><Input name="x" value="1"/></Config>')
    expect(normalizePobBuildCode(result.code)).toBe(result.code)
  })
})
