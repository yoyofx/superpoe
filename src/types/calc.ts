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
  // Build info
  CharacterLevel: number
  AscendClassName?: string
  ClassName?: string
  allocatedNodes: number
  // Skill DPS breakdown
  SkillDPS?: Array<{ name: string; dps: number; count: number; trigger?: string; skillPart?: string }>
  SkillDetails?: SkillCalculationDetails
  CalculationConfig?: CalculationConfigSnapshot
}

export type SkillCalculationMode = 'UNBUFFED' | 'BUFFED' | 'COMBAT' | 'EFFECTIVE'

export interface SkillCalculationSelection {
  skillGroupId?: string
  calcMode?: SkillCalculationMode
  activeSkillIndex?: number
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
  effectiveMultiplier?: number
  breakdown?: string[]
  effectiveBreakdown?: string[]
}

export interface SkillModifierContribution {
  bucket: 'addedMin' | 'addedMax' | 'increased' | 'more'
  damageType: SkillDamageBreakdown['type']
  stat: string
  value: number
  source: string
}

export type SkillDamageSourceType = SkillDamageBreakdown['type'] | 'elemental'

export interface SkillGainContribution {
  fromType: SkillDamageSourceType
  toType: SkillDamageBreakdown['type'] | 'random'
  stat: string
  value: number
  source: string
}

export interface SkillWeaponDamageContribution {
  hand: 'mainHand' | 'offHand'
  damageType: Exclude<SkillDamageBreakdown['type'], 'all'>
  min: number
  max: number
  source: string
}

export interface SkillBaseDamageContribution {
  damageType: Exclude<SkillDamageBreakdown['type'], 'all'>
  min: number
  max: number
  source: string
  skillLevel?: number
  baseMultiplier: number
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
  speed?: number
  totalDps?: number
  critChance?: number
  critMultiplier?: number
  critChanceBreakdown?: string[]
  critMultiplierBreakdown?: string[]
  dpsFormula?: string[]
  averageHitBreakdown?: string[]
  modifiers?: SkillModifierContribution[]
  skillDamage?: SkillBaseDamageContribution[]
  weaponDamage?: SkillWeaponDamageContribution[]
  gains?: SkillGainContribution[]
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
