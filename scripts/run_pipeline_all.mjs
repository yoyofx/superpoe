import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const version = args.find((arg) => /^\d+_\d+$/.test(arg)) || '0_4'
const dryRun = args.includes('--dry-run')
const extractFlags = args.filter((arg) => arg.startsWith('--') && arg !== '--dry-run')

function run(name, command, commandArgs) {
  console.log(`\n[${name}]`)
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
}

function planned(name, commandArgs) {
  console.log(`[PLAN] ${name}: python ${commandArgs.join(' ')}`)
}

if (dryRun) {
  console.log(`SuperPoE2 full resource pipeline dry run (${version})`)
  run('Pipeline dependencies', 'python', ['scripts/check_pipeline_deps.py'])
  run('Translations', 'python', ['scripts/sync_poecharm_translations.py', '--dry-run'])
  planned('Item base catalog', ['scripts/build_item_base_data.py'])
  planned('Workbench UI assets', ['scripts/sync_wegame_ui_assets.py'])
  run('Tree and visual assets', 'python', [
    'scripts/extract_game_assets.py', '--version', version, ...extractFlags, '--dry-run',
  ])
  run('Item and skill images', 'python', ['scripts/sync_poe2db_item_icons.py', '--dry-run'])
  planned('Canonical skill catalog', ['scripts/build_skill_catalog.py'])
  planned('Rune and socket details', ['scripts/build_rune_details.py'])
  planned('PoB Lua bundle', ['scripts/build_pob_lua_bundle.py'])
  planned('Resource validation and manifest', ['scripts/build_resource_manifest.py', version])
  process.exit(0)
}

run('Pipeline dependencies', 'python', ['scripts/check_pipeline_deps.py'])
run('Translations', 'python', ['scripts/sync_poecharm_translations.py'])
run('Item base catalog', 'python', ['scripts/build_item_base_data.py'])
run('Workbench UI assets', 'python', ['scripts/sync_wegame_ui_assets.py'])
run('Tree and visual assets', 'python', [
  'scripts/extract_game_assets.py', '--version', version, ...extractFlags,
])
run('Item and skill images', 'python', ['scripts/sync_poe2db_item_icons.py'])
run('Canonical skill catalog', 'python', ['scripts/build_skill_catalog.py'])
run('Rune and socket details', 'python', ['scripts/build_rune_details.py'])
run('PoB Lua bundle', 'python', ['scripts/build_pob_lua_bundle.py'])
run('Resource validation and manifest', 'python', ['scripts/build_resource_manifest.py', version])

console.log(`\nSuperPoE2 resources are complete for ${version}.`)
