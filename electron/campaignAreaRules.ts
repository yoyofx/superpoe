import type { CampaignSegmentKey } from './campaignTimerStore.js'

/**
 * SuperPoE-owned campaign classification. PoB supplies the raw area catalog;
 * this table owns product-specific grouping such as the three interlude acts.
 */
export const CAMPAIGN_AREA_RULES: Array<{ prefix: string; segment: CampaignSegmentKey }> = [
  { prefix: 'G1_', segment: 'act1' },
  { prefix: 'G2_', segment: 'act2' },
  { prefix: 'G3_', segment: 'act3' },
  { prefix: 'G4_', segment: 'act4' },
  { prefix: 'P1_', segment: 'interlude' },
  { prefix: 'P2_', segment: 'interlude' },
  { prefix: 'P3_', segment: 'interlude' },
]

export function campaignSegmentForAreaId(areaId: string): CampaignSegmentKey | null {
  return CAMPAIGN_AREA_RULES.find((rule) => areaId.startsWith(rule.prefix))?.segment || null
}
