import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const version = args.find((arg) => !arg.startsWith('-')) || '0_4'
const passthrough = args.filter((arg) => arg.startsWith('-'))

const translationResult = spawnSync(
  'python',
  ['scripts/sync_poecharm_translations.py', ...passthrough],
  { stdio: 'inherit', shell: process.platform === 'win32' },
)

if ((translationResult.status ?? 1) !== 0) {
  process.exit(translationResult.status ?? 1)
}

const result = spawnSync(
  'python',
  ['scripts/extract_game_assets.py', '--version', version, ...passthrough],
  { stdio: 'inherit', shell: process.platform === 'win32' },
)

process.exit(result.status ?? 1)
