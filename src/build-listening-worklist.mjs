// Builds the listening recording worklist from the App's question banks and
// stage-assessment forms. Reads the App repo via the configured appRoot.
//
// Output: work/listening-worklist.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { WORK, loadConfig, appPaths } from './paths.mjs'

const require = createRequire(import.meta.url)
const app = appPaths(loadConfig())

if (!app.appRoot || !existsSync(app.banksDir)) {
  throw new Error(`App question banks not found. Set "appRoot" in voicebuilder.config.json. Tried: ${app.banksDir || '(empty)'}`)
}
if (!existsSync(app.assessmentFile)) {
  throw new Error(`Assessment module not found: ${app.assessmentFile}`)
}

const banks = [
  'grade3-primary-core.json',
  'grade4-foundation-life.json',
  'grade5-good-habits-2024.json',
  'grade5-weekend-routines.json',
  'grade6-challenge-everyday.json',
]

const PREFIX = {
  'grade5-yilin-2024-good-habits-v1': 'grade5-good-habits',
  'grade5-weekend-routines-v1': 'grade5-weekend',
}

const items = []

for (const file of banks) {
  const bank = JSON.parse(readFileSync(join(app.banksDir, file), 'utf8'))
  const prefix = PREFIX[bank.id]
  bank.listening.forEach((item, index) => {
    // Keep the existing Grade 5 ids and day grouping so the current manifest
    // entries and the preview page stay valid; new banks get a stable
    // bank-and-item id with no day grouping.
    const id = prefix
      ? `${prefix}-day${Math.floor(index / 5) + 1}-${item.id}`
      : `${bank.id}--${item.id}`
    items.push({
      id,
      source: bank.id,
      grade: bank.grade,
      day: prefix ? Math.floor(index / 5) + 1 : null,
      text: item.spokenText || item.stimulus,
      stimulus: item.stimulus,
      usedSpokenText: Boolean(item.spokenText),
    })
  })
}

// Assessment forms live in a JS module; require it with a minimal wx stub.
const store = {}
globalThis.wx = { getStorageSync: (k) => store[k], setStorageSync: () => {} }
const A = require(app.assessmentFile)
for (const stage of A.ASSESSMENT_STAGES) {
  const form = A.TRIAL_ASSESSMENT_FORMS[stage]
  for (const item of form.listening) {
    items.push({
      id: `trial-assessment-${stage}--${item.id}`,
      source: `trial-assessment-${stage}`,
      grade: null,
      day: null,
      text: item.stimulus,
      stimulus: item.stimulus,
      usedSpokenText: false,
    })
  }
}

// Vocabulary banks (word-building + primary math vocabulary) for Bubble Star
// spelling practice.
const vocabularyBanks = [
  'grade5-word-building.json',
  'primary-math-vocabulary.json',
]
for (const file of vocabularyBanks) {
  const bank = JSON.parse(readFileSync(join(app.banksDir, file), 'utf8'))
  for (const item of bank.items) {
    items.push({
      id: `${bank.id}--${item.id}`,
      source: bank.id,
      grade: item.minGrade ?? null,
      day: null,
      text: item.word,
      stimulus: item.word,
      usedSpokenText: false,
    })
  }
}

const safe = (id) => id.replace(/[^A-Za-z0-9._-]/g, '-')
const seen = new Set()
for (const item of items) {
  item.file = `${safe(item.id)}.wav`
  if (seen.has(item.id)) throw new Error(`duplicate id: ${item.id}`)
  seen.add(item.id)
}

mkdirSync(WORK, { recursive: true })
const out = join(WORK, 'listening-worklist.json')
writeFileSync(out, JSON.stringify(items, null, 2) + '\n', 'utf8')

const bySource = items.reduce((acc, i) => { acc[i.source] = (acc[i.source] || 0) + 1; return acc }, {})
console.log(`worklist items: ${items.length}`)
for (const [source, count] of Object.entries(bySource)) console.log(`  ${source.padEnd(36)} ${count}`)
console.log(`items using spokenText: ${items.filter((i) => i.usedSpokenText).length}`)
const words = items.reduce((n, i) => n + (i.text.match(/[A-Za-z'’-]+/g) || []).length, 0)
console.log(`total spoken words: ${words}`)
console.log(`written to ${out}`)
