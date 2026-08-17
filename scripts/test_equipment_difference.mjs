import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { inflate } from 'pako'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const platformArch = process.platform === 'darwin' ? 'darwin-arm64' : `${process.platform}-${process.arch}`
const executable = path.join(root, 'native', 'bin', platformArch, process.platform === 'win32' ? 'luajit.exe' : 'luajit')
const runner = path.join(root, 'native', 'pob-lua-runner.lua')
const bundle = path.join(root, 'public', 'pob-lua')
const buildJsonPath = process.env.SUPERPOE_BUILD_JSON_PATH
const buildCodePath = process.env.SUPERPOE_BUILD_CODE_PATH
function decodeBuildCode(code) {
  const normalized = code.trim().replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return new TextDecoder().decode(inflate(Buffer.from(padded, 'base64')))
}
const xml = buildCodePath
  ? decodeBuildCode(readFileSync(buildCodePath, 'utf8'))
  : buildJsonPath
    ? JSON.parse(readFileSync(buildJsonPath, 'utf8')).data.interop.pob.passthrough.xml
    : readFileSync(path.join(root, 'scripts', 'spec', 'fixtures', 'stormweaver.xml'), 'utf8')
const currentItemId = process.env.SUPERPOE_EQUIPMENT_ITEM_ID || '8'
const sourceSlotName = process.env.SUPERPOE_EQUIPMENT_SLOT_NAME || 'Ring 1'
const verbose = process.env.SUPERPOE_VERBOSE === '1'
const debug = process.env.SUPERPOE_DEBUG === '1'
const buildItemRaw = buildCodePath
  ? xml.match(new RegExp(`<Item\\s+id=["']${currentItemId}["']\\s*>([\\s\\S]*?)<\\/Item>`, 'i'))?.[1]?.trim()
  : null
const candidate = process.env.SUPERPOE_MUTATE_CANDIDATE === 'empty'
  ? 'Rarity: NORMAL\nWar Wraps\nItem Level: 81\nImplicits: 0'
  : process.env.SUPERPOE_MUTATE_CANDIDATE === 'space' && buildItemRaw
    ? buildItemRaw + '\n'
  : (process.env.SUPERPOE_MUTATE_CANDIDATE === '1' && buildItemRaw
    ? buildItemRaw.replace('+78 to Evasion Rating', '+1078 to Evasion Rating')
    : buildItemRaw) || [
  'Rarity: RARE',
  'Difference Circle',
  'Ruby Ring',
  'Item Level: 82',
  'Implicits: 0',
  '+30 to maximum Life',
  'Fire Resistance is +44%',
  ].join('\n')
const flaskCandidate = [
  'Rarity: UNIQUE',
  "Lavianga's Spirits",
  'Gargantuan Mana Flask',
  'Item Level: 81',
  'Implicits: 0',
  'This Flask cannot be Used but applies its Effect constantly',
  '73% reduced Amount Recovered',
  'Corrupted',
].join('\n')

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
  throw new Error(`equipment difference smoke test timed out\n${stderr}`)
}, 60_000)

lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.type === 'ready') {
    child.stdin.write(`${JSON.stringify({
      id: 1,
      type: 'compareEquipment',
      payload: {
        contextKey: 'equipment-difference-smoke',
        context: {
          xml,
          buildRevision: 1,
          activeItemSetId: '1',
          activeWeaponSet: 1,
        },
        candidate: {
          raw: candidate,
          source: 'custom',
          ...(process.env.SUPERPOE_FIRST_REMOVE === '1' ? { buildItemId: currentItemId } : {}),
        },
        sourceSlotName,
        slotOnlyTooltips: true,
        ...(debug ? { debug: true } : {}),
      },
    })}\n`)
    return
  }
  if (message.id === 1) {
    if (!message.success || !message.data?.success) {
      child.kill()
      throw new Error(`equipment difference comparison failed: ${JSON.stringify(message)}\n${stderr}`)
    }
    const groups = message.data.groups
    if (!Array.isArray(groups) || groups.length !== 1 || groups[0].slotName !== sourceSlotName) {
      child.kill()
      throw new Error(`unexpected equipment difference groups: ${JSON.stringify(groups)}`)
    }
    if (!buildJsonPath && !buildCodePath && !groups[0].changedStats.some((stat) => stat.key === 'Life')) {
      child.kill()
      throw new Error(`expected Life difference was not returned: ${JSON.stringify(groups[0])}`)
    }
    if (verbose) {
      console.log(JSON.stringify({
        first: {
          operation: groups[0].operation,
          changedStats: groups[0].changedStats,
          sort: groups[0].sort,
          debug: groups[0].debug,
        },
      }, null, 2))
    }
    child.stdin.write(`${JSON.stringify({
      id: 2,
      type: 'compareEquipment',
      payload: {
        contextKey: 'equipment-difference-smoke',
        context: { xml, buildRevision: 1, activeItemSetId: '1', activeWeaponSet: 1 },
        candidate: { raw: candidate, buildItemId: currentItemId, source: 'equipment-slot' },
        sourceSlotName,
        slotOnlyTooltips: true,
        ...(debug ? { debug: true } : {}),
      },
    })}\n`)
    return
  }
  if (message.id === 3) {
    clearTimeout(timeout)
    if (!message.success || !message.data?.success || !Array.isArray(message.data.groups) || message.data.groups.length !== 1) {
      child.kill()
      throw new Error(`flask comparison failed: ${JSON.stringify(message)}\n${stderr}`)
    }
    if (!['toggle-on', 'toggle-off'].includes(message.data.groups[0].operation)) {
      child.kill()
      throw new Error(`unexpected flask operation: ${JSON.stringify(message.data.groups[0])}`)
    }
    console.log(JSON.stringify({
      equip: { operation: 'equip', slotName: sourceSlotName },
      remove: { operation: 'remove', slotName: sourceSlotName },
      flask: { operation: message.data.groups[0].operation, slotName: message.data.groups[0].slotName },
      performance: message.data.performance,
    }, null, 2))
    child.kill()
    return
  }
  if (message.id !== 2) return
  clearTimeout(timeout)
  if (!message.success || !message.data?.success) {
    child.kill()
    throw new Error(`equipment removal comparison failed: ${JSON.stringify(message)}\n${stderr}`)
  }
  const groups = message.data.groups
  if (!Array.isArray(groups) || groups.length !== 1 || groups[0].operation !== 'remove') {
    child.kill()
    throw new Error(`unexpected equipment removal groups: ${JSON.stringify(groups)}`)
  }
  if (message.data.performance?.sessionReused !== true) {
    child.kill()
    throw new Error(`comparison session was not reused: ${JSON.stringify(message.data.performance)}`)
  }
  if (buildJsonPath || buildCodePath) {
    console.log(JSON.stringify({
      build: buildJsonPath,
      operation: groups[0].operation,
      slotName: groups[0].slotName,
      changedStats: groups[0].changedStats.length,
      ...(verbose ? {
        stats: groups[0].changedStats,
        sort: groups[0].sort,
        replacedItemId: groups[0].replacedItemId,
        replacedItemName: groups[0].replacedItemName,
      } : {}),
      ...(debug ? { debug: groups[0].debug } : {}),
      performance: message.data.performance,
    }, null, 2))
    clearTimeout(timeout)
    child.kill()
    return
  }
  child.stdin.write(`${JSON.stringify({
    id: 3,
    type: 'compareEquipment',
    payload: {
      contextKey: 'equipment-difference-smoke',
      context: { xml, buildRevision: 1, activeItemSetId: '1', activeWeaponSet: 1 },
      candidate: { raw: flaskCandidate, buildItemId: '3', source: 'equipment-slot' },
    },
  })}\n`)
  return
})

child.once('error', (error) => {
  clearTimeout(timeout)
  throw error
})
