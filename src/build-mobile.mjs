// Assembles the static payload for the phone app into mobile-dist/, which
// Capacitor packages into the APK.
//
//   node src/build-mobile.mjs
//
// What ends up inside the APK, and nothing else:
//   index.html, app.js, zip.js           the recording UI
//   audio-format.js, recorder.js         copied from web/ - one source of truth
//   worklist.json                        the 89 lines, ready for the app
//   samples/<name>.ogg                   reference audio, transcoded
//
// Recordings are NOT here: they are created on the phone.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync, statSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, WORK } from './paths.mjs'

const MOBILE_SRC = join(ROOT, 'mobile')
const WEB_SRC = join(ROOT, 'web')
const DIST = join(ROOT, 'mobile-dist')
const WORKLIST = join(WORK, 'recording-worklist.json')

if (!existsSync(WORKLIST)) {
  console.error(`Missing ${relative(ROOT, WORKLIST)} - run: npm run worklists`)
  process.exit(1)
}

rmSync(DIST, { recursive: true, force: true })
mkdirSync(join(DIST, 'samples'), { recursive: true })

// The recorder shares its WAV encoder with the desktop page; copy rather than
// duplicate so the tested version is the one shipped.
for (const file of ['recorder.js', 'audio-format.js']) {
  copyFileSync(join(WEB_SRC, file), join(DIST, file))
}
for (const file of ['index.html', 'app.js', 'zip.js']) {
  copyFileSync(join(MOBILE_SRC, file), join(DIST, file))
}

console.log('transcoding samples (ogg/opus)...')
const transcode = spawnSync('python', [join(ROOT, 'src', 'transcode-samples.py'), '--out', join(DIST, 'samples')], {
  cwd: ROOT,
  stdio: 'inherit',
})
if (transcode.status !== 0) {
  console.error('sample transcode failed')
  process.exit(transcode.status ?? 1)
}

const sampleFiles = new Set(readdirSync(join(DIST, 'samples')))
const worklist = JSON.parse(readFileSync(WORKLIST, 'utf8'))
const total = worklist.length
const payload = worklist.map((clip, i) => {
  const ogg = `${clip.id}.ogg`
  return {
    index: i + 1,
    total,
    id: clip.id,
    file: clip.file || `${clip.id}.wav`,
    text: clip.text,
    group: clip.group || '',
    sample: sampleFiles.has(ogg) ? `samples/${ogg}` : null,
  }
})
writeFileSync(join(DIST, 'worklist.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8')

const missing = payload.filter((item) => !item.sample)
let bytes = 0
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else bytes += statSync(full).size
  }
}
walk(DIST)

console.log(`\nmobile-dist ready: ${payload.length} lines, ${payload.length - missing.length} with a sample`)
if (missing.length) {
  console.warn(`  WARNING: ${missing.length} lines have no sample audio:`)
  for (const item of missing.slice(0, 10)) console.warn(`    ${item.id}`)
}
console.log(`  payload size: ${(bytes / 1048576).toFixed(1)} MB`)
console.log('  files: index.html app.js zip.js recorder.js audio-format.js worklist.json samples/*.ogg')
