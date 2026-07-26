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
