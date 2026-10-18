import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname, sep } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveTopic } from '../src/topics.mjs'
import { AUDIO_DIR, SAMPLES_DIR, WORK, DOCS_DIR, RECORDING_WORKLIST } from '../src/paths.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

test('topics isolation: app defaults to work paths', () => {
  const app = resolveTopic('')
  assert.equal(app.id, '')
  assert.equal(app.app, true)
  assert.equal(app.worklist, RECORDING_WORKLIST)
  assert.equal(app.samples, SAMPLES_DIR)
  assert.equal(app.audio, AUDIO_DIR)
})

test('topics: document topic points under DOCS_DIR', () => {
  const topic = resolveTopic('my-article')
  assert.equal(topic.id, 'my-article')
  assert.equal(topic.app, false)
  assert.equal(topic.worklist, join(DOCS_DIR, 'my-article', 'worklist.json'))
  assert.equal(topic.samples, join(DOCS_DIR, 'my-article', 'samples'))
  assert.equal(topic.audio, join(DOCS_DIR, 'my-article', 'audio'))
})

test('topics: rejects traversal and invalid chars', () => {
  assert.equal(resolveTopic('..'), null)
  assert.equal(resolveTopic('..\\evil'), null)
  assert.equal(resolveTopic('../evil'), null)
  assert.equal(resolveTopic('a/b'), null)
  assert.equal(resolveTopic('bad slug'), null)
})

test('DOCS_DIR is inside WORK and separate from audio/samples', () => {
  assert.ok(DOCS_DIR.startsWith(WORK + sep))
  assert.ok(!AUDIO_DIR.startsWith(DOCS_DIR))
  assert.ok(!SAMPLES_DIR.startsWith(DOCS_DIR))
})

test('pack and publish never read the doc-topic folders', () => {
  const pack = readFileSync(join(ROOT, 'src', 'pack-miniprogram.ps1'), 'utf8')
  const publish = readFileSync(join(ROOT, 'src', 'publish-pwa.mjs'), 'utf8')
  // Pack reads the App's audio + manifest only.
  assert.ok(pack.includes('work\\audio') || pack.includes('work/audio'))
  assert.ok(pack.includes('work\\manifest.json') || pack.includes('work/manifest.json'))
  assert.ok(!pack.includes('work\\docs') && !pack.includes('work/docs'))
  // Publish reads the App's packed manifest and public/audio only; it must
  // never touch this project's work/ tree (the docs/ in a comment is fine).
  assert.ok(!publish.includes('DOCS_DIR'))
  assert.ok(!publish.includes('work\\docs') && !publish.includes('work/docs'))
  assert.ok(!publish.includes('RECORDING_WORKLIST') && !publish.includes('DOCS_DIR'))
})
