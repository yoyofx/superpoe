import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const upstream = path.join(root, 'upstreams', 'Xiletrade')
const dataRoot = path.join(upstream, 'src', 'Xiletrade.Library', 'Data')
const outputRoot = path.join(root, 'public', 'data', 'xiletrade')
const commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const languages = ['en-US', 'zh-CN', 'zh-TW', 'ko-KR']
const files = [
  'FiltersTwo.json', 'ItemsTwo.json', 'CurrencyTwo.json', 'BasesTwo.json',
  'ModsTwo.json', 'WordsTwo.json', 'ParsingRules.json',
]

const sha256 = (source) => createHash('sha256').update(source).digest('hex')
const parseJson = (source, file) => {
  try {
    return JSON.parse(source.toString('utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`Invalid Xiletrade JSON ${file}: ${error instanceof Error ? error.message : error}`)
  }
}

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(outputRoot, { recursive: true })

const manifest = { schemaVersion: 2, upstreamCommit: commit, languages: {} }
for (const language of languages) {
  const languageOutput = path.join(outputRoot, language)
  mkdirSync(languageOutput, { recursive: true })
  const hashes = {}
  for (const name of files) {
    const sourceFile = path.join(dataRoot, 'Lang', language, name)
    const source = readFileSync(sourceFile)
    parseJson(source, sourceFile)
    hashes[name] = sha256(source)
    cpSync(sourceFile, path.join(languageOutput, name))
  }
  manifest.languages[language] = { files: hashes }
}

writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Wrote ${path.relative(root, outputRoot)} from Xiletrade ${commit}`)
