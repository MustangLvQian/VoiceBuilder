// Publishes the packed recordings into the App's PWA public/audio.
//
// Reads the mini-program manifest (`content/audio-preview-manifest.json`) that
// src/pack-miniprogram.ps1 just wrote, copies each file into
// <appRoot>/public/audio/{listening|lumi}/, and writes the PWA manifest the
// service worker precaches.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ROOT, loadConfig, appPaths } from './paths.mjs'

const app = appPaths(loadConfig())
if (!app.appRoot) throw new Error('appRoot is not set in voicebuilder.config.json')

const packedManifestPath = join(app.miniRoot, 'content', 'audio-preview-manifest.json')
if (!existsSync(packedManifestPath)) {
  throw new Error(`Packed manifest not found: ${packedManifestPath} (run the pack step first)`)
}

const manifest = JSON.parse(readFileSync(packedManifestPath, 'utf8'))

// An empty manifest would blank the PWA's audio list and leave the App with no
// playable recordings. Refuse unless the caller really means it.
if (!manifest.length && !process.argv.includes('--allow-empty')) {
  console.error(`打包清单是空的（${relative(process.cwd(), packedManifestPath)}），拒绝发布。`)
  console.error('这会把 App 的 public/audio/manifest.json 清空、PWA 就没有音频了。')
  console.error('先把录音放进 work/audio/（网页直录或 npm run ingest），或加 --allow-empty 强行发布。')
  process.exit(1)
}

const publicAudio = app.publicAudioDir
const lumiSource = 'LUMI-VOICE-LINES.md'
const systemPromptSource = 'system-prompts'
const pwaManifest = []

for (const entry of manifest) {
  let folder
  if (entry.source === lumiSource) {
    folder = 'lumi'
  } else if (entry.source === systemPromptSource) {
    folder = 'system-prompts'
  } else {
    folder = 'listening'
  }
  const destinationDir = join(publicAudio, folder)
  mkdirSync(destinationDir, { recursive: true })

  const source = join(app.miniRoot, entry.src)
  const destination = join(destinationDir, entry.file)
  copyFileSync(source, destination)

  pwaManifest.push({
    id: entry.id,
    file: entry.file,
    source: entry.source,
    day: entry.day,
    text: entry.text,
    spokenText: entry.spokenText ?? null,
    path: `/audio/${folder}/${entry.file}`,
  })
}

const outFile = join(publicAudio, 'manifest.json')
writeFileSync(outFile, JSON.stringify(pwaManifest, null, 2) + '\n', 'utf8')

const totalBytes = pwaManifest.reduce((sum, entry) => {
  const folder = entry.path.split('/')[2]
  return sum + statSync(join(publicAudio, folder, entry.file)).size
}, 0)

console.log(`published ${pwaManifest.length} recordings to ${relative(app.appRoot, publicAudio).replace(/\\/g, '/')}`)
console.log(`  listening: ${pwaManifest.filter((e) => e.path.includes('/listening/')).length}`)
console.log(`  lumi:      ${pwaManifest.filter((e) => e.path.includes('/lumi/')).length}`)
console.log(`  total:     ${(totalBytes / 1048576).toFixed(1)} MB`)
console.log(`  manifest:  ${relative(app.appRoot, outFile).replace(/\\/g, '/')}`)
