/** Calculation result returned by the front-end PoB Lua worker or dev fallback backend. */
export interface CalcResult {
  // Attributes
  Str: number
  Dex: number
  Int: number
  // Life/Mana/ES
  Life: number
  LifeUnreserved: number
  Mana: number
  ManaUnreserved: number
  Spirit?: number
  EnergyShield: number
  // Defences
  Armour: number
  Evasion: number
  ArmourPhysicalDamageReduction?: number
  PhysicalDamageReduction?: number
  EvadeChance?: number
  DeflectionRating?: number
  DeflectChance?: number
  DeflectEffect?: number
  // Resistances
  FireResist: number
  FireResistTotal: number
  ColdResist: number
  ColdResistTotal: number
  LightningResist: number
  LightningResistTotal: number
  ChaosResist: number
  ChaosResistTotal: number
  // Block
  BlockChance: number
  SpellBlockChance: number
  EffectiveBlockChance?: number
  // DPS
  TotalDPS: number
  FullDPS: number
  /** Aggregate positive DPS across every enabled skill, independent of Full DPS selection. */
  AllDPS?: number
  FullDotDPS?: number
  SkillLevel?: number
  AverageHit: number
  Speed: number
  HitSpeed?: number
  CritChance: number
  CritMultiplier: number
  // Charges
  PowerChargesMax: number
  FrenzyChargesMax: number
  EnduranceChargesMax: number
  // Misc
  MovementSpeedMod: number
  EffectiveMovementSpeedMod?: number
  ActionSpeedMod: number
  Ward: number
  // Regen
  LifeRegen: number
  ManaRegen: number
  EnergyShieldRegen: number
  /** Values exposed by PoB2's powerStatList for comparison and analysis surfaces. */
  PowerStats?: Record<string, number>
  // Build info
  CharacterLevel: number
  AscendClassName?: string
  ClassName?: string
  allocatedNodes: number
  // Skill DPS breakdown
  SkillDPS?: SkillDpsEntry[]
  /** DPS entries that PoB included in the Full DPS roll-up. */
  FullSkillDPS?: SkillDpsEntry[]
  /** All enabled runtime skills with a positive DPS contribution. */
  AllSkillDPS?: SkillDpsEntry[]
  SkillDetails?: SkillCalculationDetails
  CalculationConfig?: CalculationConfigSnapshot
}

export type SkillCalculationMode = 'UNBUFFED' | 'BUFFED' | 'COMBAT' | 'EFFECTIVE'

export interface SkillDpsEntry {
  name: string
  dps: number
  count: number
  trigger?: string
  skillPart?: string
  groupId?: string
  skillId?: string
  /** True when PoB created this row from an internal/triggered skill form. */
  hidden?: boolean
  /** The user-facing gem that granted this hidden runtime skill. */
  parentSkillId?: string
  parentSkillName?: string
  kind?: 'main' | 'trigger' | 'minion' | 'mirage' | 'dot' | 'other'
  /** PoB skill flags normalized for project-owned analysis surfaces. */
  skillType?: 'attack' | 'spell' | 'other'
}

export interface SkillCalculationSelection {
  /** Character equipment panels only need the MAIN output already built while loading the XML. */
  characterOnly?: boolean
  skillGroupId?: string
  calcMode?: SkillCalculationMode
  activeSkillIndex?: number
  skillPartIndex?: number
  statSetIndex?: number
  actor?: SkillCalculationActorSelection
  minionSkillIndex?: number
  minionStatSetIndex?: number
  configOverrides?: CalculationConfigValues
  includeConfig?: boolean
}

export type SkillCalculationActor = 'player' | 'minion'
export type SkillCalculationActorSelection = 'auto' | SkillCalculationActor

export interface SkillDpsRankEntry {
  groupId: string
  dps: number
  valid: boolean
  error?: string
}

export interface SkillDpsRankResponse {
  success: boolean
  data?: SkillDpsRankEntry[]
  error?: string
}

export interface RankSkillsInput {
  xml: string
  groupIds: string[]
  configOverrides?: CalculationConfigValues
}

export type CalculationConfigValue = boolean | number | string
export type CalculationConfigValues = Record<string, CalculationConfigValue>

export interface CalculationConfigChoice {
  value: CalculationConfigValue
  label: string
}

export interface CalculationConfigOption {
  key: string
  section: string
  type: 'check' | 'count' | 'integer' | 'countAllowZero' | 'float' | 'list' | 'text'
  label: string
  tooltip?: string
  value?: CalculationConfigValue
  defaultValue?: CalculationConfigValue
  placeholder?: CalculationConfigValue
  choices?: CalculationConfigChoice[]
  visible: boolean
  valid: boolean
}

export interface CalculationConfigSnapshot {
  activeConfigSetId: number
  activeConfigSetTitle: string
  sections: string[]
  options: CalculationConfigOption[]
}

export interface LocalCalculationProfile {
  id: string
  name: string
  values: CalculationConfigValues
}

export interface SkillCalculationOption {
  index: number
  label: string
  skillId?: string
  trigger?: string
  skillPart?: string
  hidden?: boolean
  parentSkillId?: string
  parentSkillName?: string
  /** Stat sets exposed by this option (used for each minion skill). */
  statSets?: SkillCalculationOption[]
  /** Multipart skill parts exposed by this option. */
  skillParts?: SkillCalculationOption[]
}

export interface SkillDamageBreakdown {
  type: 'all' | 'physical' | 'lightning' | 'cold' | 'fire' | 'chaos'
  addedMin?: number
  addedMax?: number
  increased: number
  more: number
  hitMin?: number
  hitMax?: number
  averageHit?: number
  nonCritAverage?: number
  critAverage?: number
  finalAverage?: number
  /** Post-mitigation DPS contribution for the representative skill. */
  finalDps?: number
  effectiveMultiplier?: number
  moreMin?: number
  moreMax?: number
  /** Exact intermediate values exported from PoB2's offence calculation. */
  stages?: SkillDamageStageValues
  breakdown?: string[]
  effectiveBreakdown?: string[]
}

export interface SkillDamageStageValues {
  baseMin?: number
  baseMax?: number
  /** Raw weapon or skill base before flat added damage and skill multiplier. */
  baseSourceMin?: number
  baseSourceMax?: number
  /** Flat added damage included in the base formula, before its multiplier. */
  flatAddedMin?: number
  flatAddedMax?: number
  flatAddedMultiplier?: number
  /** Base formula input after flat added damage, before skill multiplier. */
  baseInputMin?: number
  baseInputMax?: number
  /** Skill effectiveness/base damage multiplier for the selected form/stat set. */
  baseMultiplier?: number
  retainedMin?: number
  retainedMax?: number
  conversionFactor?: number
  conversionMin?: number
  conversionMax?: number
  gainMin?: number
  gainMax?: number
  summedMin?: number
  summedMax?: number
  increasedFactor?: number
  increasedMin?: number
  increasedMax?: number
  moreFactor?: number
  moreMinFactor?: number
  moreMaxFactor?: number
  moreStageMin?: number
  moreStageMax?: number
  normalMin?: number
  normalMax?: number
  normalAverage?: number
  criticalMin?: number
  criticalMax?: number
  criticalAverage?: number
  expectedAverage?: number
  effectiveMin?: number
  effectiveMax?: number
  effectiveAverage?: number
  effectiveMultiplier?: number
}

export interface SkillModifierContribution {
  bucket: 'addedMin' | 'addedMax' | 'increased' | 'more'
  damageType: SkillDamageBreakdown['type']
  stat: string
  value: number
  source: string
  sourceType?: SkillContributionSourceType
}

export type SkillContributionSourceType = 'equipment' | 'tree' | 'jewel' | 'skill' | 'buff' | 'config'

export interface SkillSpeedContribution {
  bucket: 'increased' | 'more'
  value: number
  source: string
  sourceType?: SkillContributionSourceType
}

export interface SkillCriticalContribution {
  bucket: 'base' | 'increased' | 'more'
  stat: 'CritChance' | 'CritMultiplier'
  value: number
  source: string
  sourceType?: SkillContributionSourceType
}

export type SkillDamageSourceType = SkillDamageBreakdown['type'] | 'elemental' | 'nonChaos'

export interface SkillGainContribution {
  fromType: SkillDamageSourceType
  toType: SkillDamageBreakdown['type'] | 'random'
  stat: string
  value: number
  source: string
  sourceType?: SkillContributionSourceType
}

export interface SkillDamageTransferTotal {
  fromType: Exclude<SkillDamageBreakdown['type'], 'all'>
  toType: Exclude<SkillDamageBreakdown['type'], 'all'>
  value: number
}

export interface SkillConversionContribution extends SkillDamageTransferTotal {
  stat: string
  source: string
  sourceType?: SkillContributionSourceType
}

export interface SkillWeaponDamageContribution {
  hand: 'mainHand' | 'offHand'
  damageType: Exclude<SkillDamageBreakdown['type'], 'all'>
  min: number
  max: number
  source: string
  sourceType?: SkillContributionSourceType
}

export interface SkillBaseDamageContribution {
  damageType: Exclude<SkillDamageBreakdown['type'], 'all'>
  min: number
  max: number
  source: string
  skillLevel?: number
  baseMultiplier: number
  sourceType?: SkillContributionSourceType
}

export interface SkillEffectSummary {
  aurasAndBuffs: string[]
  combatBuffs: string[]
  cursesAndDebuffs: string[]
}

export interface SkillLevelResourceValue {
  resource: string
  value: number
}

export interface SkillLevelStatSet {
  index: number
  label: string
  critChance?: number
  baseMultiplier?: number
  damageRanges: Array<{
    type: 'physical' | 'lightning' | 'cold' | 'fire' | 'chaos'
    min: number
    max: number
  }>
  lines: string[]
}

export interface SkillLevelReference {
  level: number
  requiredLevel?: number
  costs: SkillLevelResourceValue[]
  spiritReservation?: number
  cooldown?: number
  storedUses?: number
  critChance?: number
  attackSpeedMultiplier?: number
  attackTime?: number
  baseMultiplier?: number
  statSets: SkillLevelStatSet[]
}

export interface SkillCalculationDetails {
  mode: SkillCalculationMode
  actor: SkillCalculationActor
  hasMinion: boolean
  playerHasDamage: boolean
  minionHasDamage: boolean
  minionName?: string
  activeSkillIndex: number
  activeSkills: SkillCalculationOption[]
  skillPartIndex: number
  skillParts: SkillCalculationOption[]
  statSetIndex: number
  statSets: SkillCalculationOption[]
  minionSkillIndex?: number
  minionSkills?: SkillCalculationOption[]
  minionStatSetIndex?: number
  minionStatSets?: SkillCalculationOption[]
  skillType: 'attack' | 'spell' | 'other'
  damageSource: 'skill' | 'mainHand' | 'offHand'
  damageTypes: SkillDamageBreakdown[]
  averageHit?: number
  averageDamage?: number
  speed?: number
  /** Effective rate used by PoB2 when converting average damage to DPS. */
  effectiveRate?: number
  hitChance?: number
  dpsMultiplier?: number
  quantityMultiplier?: number
  totalDps?: number
  critChance?: number
  critMultiplier?: number
  critChanceBreakdown?: string[]
  critMultiplierBreakdown?: string[]
  critModifiers?: SkillCriticalContribution[]
  dpsFormula?: string[]
  averageHitBreakdown?: string[]
  modifiers?: SkillModifierContribution[]
  speedModifiers?: SkillSpeedContribution[]
  skillDamage?: SkillBaseDamageContribution[]
  weaponDamage?: SkillWeaponDamageContribution[]
  gains?: SkillGainContribution[]
  gainTotals?: SkillDamageTransferTotal[]
  conversions?: SkillConversionContribution[]
  conversionTotals?: SkillDamageTransferTotal[]
  effects?: SkillEffectSummary
  levelReferenceCurrent?: number
  levelReferences?: SkillLevelReference[]
}

/** Calculation response shape shared by the front-end worker and legacy backend. */
export interface CalcApiResponse {
  success: boolean
  data?: CalcResult
  error?: string
  meta?: {
    nodeCount: number
    xmlSize: number
  }
}

/** One full PoB calculation used by the batched attribute-gain evaluator. */
export interface AttributeProbeCalculationJob extends SkillCalculationSelection {
  id: string
  configOverrides: CalculationConfigValues
  /** Rebuild the complete enabled-skill DPS aggregate only when the report needs it. */
  includeAllDps?: boolean
}

export interface AttributeProbeBatchInput {
  code: string
  xml: string
  jobs: AttributeProbeCalculationJob[]
}

export interface AttributeProbeBatchEntry {
  id: string
  success: boolean
  data?: CalcResult
  error?: string
}

export interface AttributeProbeBatchResponse {
  success: boolean
  data?: AttributeProbeBatchEntry[]
  error?: string
  performance?: {
    jobCount: number
    elapsedMs: number
  }
}
