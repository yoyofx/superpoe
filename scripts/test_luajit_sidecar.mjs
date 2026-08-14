import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { inflate } from 'pako'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const platformArch = process.platform === 'darwin' ? 'darwin-arm64' : `${process.platform}-${process.arch}`
const executable = process.env.SUPERPOE_LUAJIT_EXECUTABLE || path.join(
  root,
  'native',
  'bin',
  platformArch,
  process.platform === 'win32' ? 'luajit.exe' : 'luajit',
)
const runner = path.join(root, 'native', 'pob-lua-runner.lua')
const bundle = path.join(root, 'public', 'pob-lua')
const buildCodePath = process.env.SUPERPOE_BUILD_CODE_PATH
const buildXmlPath = process.env.SUPERPOE_BUILD_XML_PATH
const skillGroupId = process.env.SUPERPOE_SKILL_GROUP_ID
const xml = buildXmlPath
  ? readFileSync(buildXmlPath, 'utf8')
  : buildCodePath
  ? new TextDecoder().decode(inflate(Buffer.from(
    readFileSync(buildCodePath, 'utf8').trim().replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  )))
  : readFileSync(path.join(root, 'scripts', 'spec', 'fixtures', 'stormweaver.xml'), 'utf8')
const minionXml = !buildCodePath && !buildXmlPath
  ? xml.replace(
    /<Skill mainActiveSkillCalcs="1"[\s\S]*?<\/Skill>/,
    '<Skill mainActiveSkillCalcs="1" includeInFullDPS="nil" enabled="true" mainActiveSkill="1">\n'
      + '<Gem level="20" skillId="SummonSkeletalSnipersPlayer" enabled="true" enableGlobal2="false" enableGlobal1="true" '
      + 'gemId="Metadata/Items/Gems/SkillGemSkeletalSniper" nameSpec="Skeletal Sniper" variantId="SkeletalSniper" quality="0" count="1"/>\n'
      + '</Skill>',
  )
  : null

const child = spawn(executable, [runner, bundle], {
  cwd: bundle,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
})
const lines = createInterface({ input: child.stdout })
let stderr = ''
child.stderr.on('data', (chunk) => { stderr += String(chunk) })

const timeout = setTimeout(() => {
  child.kill()
  throw new Error(`LuaJIT sidecar smoke test timed out\n${stderr}`)
}, 60_000)

let ready = false
let calculationData
let validRankedSkillCount = 0
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (!ready) {
    if (message.type !== 'ready' || message.protocolVersion !== 1) {
      throw new Error(`Invalid ready message: ${line}`)
    }
    ready = true
    child.stdin.write(`${JSON.stringify({
      id: 1,
      type: 'calculate',
      payload: { xml, includeConfig: true, ...(skillGroupId ? { skillGroupId } : {}) },
    })}\n`)
    return
  }

  if (!message.success || !message.data?.success) {
    throw new Error(`Calculation failed: ${line}\n${stderr}`)
  }
  if (message.id === 2) {
    const ranked = message.data.data
    const skillCount = (xml.match(/<Skill(?:\s|>)/g) || []).length
    if (!Array.isArray(ranked) || ranked.length !== skillCount
      || ranked.some((entry, index) => entry.groupId !== String(index + 1) || !Number.isFinite(entry.dps))) {
      throw new Error(`Unexpected skill ranking result: ${JSON.stringify(ranked)}`)
    }
    validRankedSkillCount = ranked.filter((entry) => entry.valid).length
    if (minionXml) {
      child.stdin.write(`${JSON.stringify({ id: 3, type: 'calculate', payload: { xml: minionXml, skillGroupId: '1', actor: 'auto' } })}\n`)
      return
    }
    clearTimeout(timeout)
    if (buildCodePath || buildXmlPath) {
      console.log(JSON.stringify(calculationData, null, 2))
    }
    child.kill()
    return
  }
  if (message.id === 3) {
    const minionDetails = message.data.data?.SkillDetails
    if (!minionDetails?.hasMinion || minionDetails.actor !== 'minion'
      || !Array.isArray(minionDetails.minionSkills) || minionDetails.minionSkills.length < 2
      || !Number.isFinite(minionDetails.totalDps) || minionDetails.totalDps <= 0) {
      throw new Error(`Unexpected automatic minion calculation: ${JSON.stringify(minionDetails)}`)
    }
    clearTimeout(timeout)
    const skillCount = (xml.match(/<Skill(?:\s|>)/g) || []).length
    child.stdin.write(`${JSON.stringify({ id: 4, type: 'calculate', payload: { xml: minionXml, skillGroupId: '1', actor: 'minion', minionSkillIndex: 2 } })}\n`)
    calculationData.minionSummary = { details: minionDetails, skillCount }
    return
  }
  if (message.id === 4) {
    const alternateDetails = message.data.data?.SkillDetails
    if (alternateDetails?.actor !== 'minion' || alternateDetails.minionSkillIndex !== 2
      || alternateDetails.minionSkills?.[1]?.label === alternateDetails.minionSkills?.[0]?.label) {
      throw new Error(`Unexpected alternate minion skill calculation: ${JSON.stringify(alternateDetails)}`)
    }
    clearTimeout(timeout)
    const { details, skillCount } = calculationData.minionSummary
    console.log(`LuaJIT parity fixture passed: level=${calculationData.CharacterLevel}, nodes=${calculationData.allocatedNodes}, mana=${calculationData.Mana}, deflect=${calculationData.DeflectChance}%/${calculationData.DeflectEffect}%, minion=${details.minionName}, minionSkills=${details.minionSkills.length}, selectedMinionSkill=${alternateDetails.minionSkillIndex}, minionDps=${alternateDetails.totalDps}, ranked=${validRankedSkillCount}/${skillCount}`)
    child.kill()
    return
  }
  if (message.id !== 1) throw new Error(`Unexpected sidecar response: ${line}`)
  const data = message.data.data
  if (!buildCodePath && (data.CharacterLevel !== 98 || data.ClassName !== 'Sorceress' || data.AscendClassName !== 'Stormweaver')) {
    throw new Error(`Unexpected PoB result: ${JSON.stringify(data)}`)
  }
  if (!(data.allocatedNodes > 0) || !(data.Mana > 0)) {
    throw new Error(`Incomplete PoB result: ${JSON.stringify(data)}`)
  }
  if (!Number.isFinite(data.DeflectChance) || !Number.isFinite(data.DeflectEffect)) {
    throw new Error(`Missing deflection result: ${JSON.stringify(data)}`)
  }
  if (!Array.isArray(data.CalculationConfig?.options) || data.CalculationConfig.options.length < 500) {
    throw new Error(`Missing PoB configuration metadata: ${JSON.stringify(data.CalculationConfig)}`)
  }
  const skillDetails = data.SkillDetails
  if (!skillDetails || !['attack', 'spell', 'other'].includes(skillDetails.skillType)) {
    throw new Error(`Missing calculated skill type: ${JSON.stringify(skillDetails)}`)
  }
  if (!Array.isArray(skillDetails.skillDamage)
    || skillDetails.skillDamage.some((entry) => !Number.isFinite(entry.min)
      || !Number.isFinite(entry.max) || !Number.isFinite(entry.baseMultiplier))) {
    throw new Error(`Invalid spell base damage: ${JSON.stringify(skillDetails.skillDamage)}`)
  }
  if (skillDetails.skillType === 'attack' && skillDetails.skillDamage?.length) {
    throw new Error(`Attack skill incorrectly exported spell base damage: ${JSON.stringify(skillDetails.skillDamage)}`)
  }
  if (!Array.isArray(skillDetails.gainTotals) || !Array.isArray(skillDetails.conversionTotals)) {
    throw new Error(`Missing authoritative damage transfer tables: ${JSON.stringify(skillDetails)}`)
  }
  const typedDamage = (skillDetails.damageTypes || []).filter((entry) => entry.type !== 'all' && Number.isFinite(entry.finalAverage))
  if (typedDamage.length && Number.isFinite(skillDetails.averageHit)) {
    const typedAverage = typedDamage.reduce((sum, entry) => sum + entry.finalAverage, 0)
    const tolerance = Math.max(0.1, Math.abs(skillDetails.averageHit) * 1e-6)
    if (Math.abs(typedAverage - skillDetails.averageHit) > tolerance) {
      throw new Error(`Damage type averages do not match AverageHit: ${typedAverage} != ${skillDetails.averageHit}`)
    }
  }
  calculationData = data
  const groupIds = Array.from({ length: (xml.match(/<Skill(?:\s|>)/g) || []).length }, (_, index) => String(index + 1))
  child.stdin.write(`${JSON.stringify({ id: 2, type: 'rankSkills', payload: { xml, groupIds } })}\n`)
})

child.once('error', (error) => {
  clearTimeout(timeout)
  throw error
})
