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
const publicAudio = app.publicAudioDir
const lumiSource = 'LUMI-VOICE-LINES.md'
const pwaManifest = []

for (const entry of manifest) {
  const isLumi = entry.source === lumiSource
  const folder = isLumi ? 'lumi' : 'listening'
  const destinationDir = join(publicAudio, folder)
  mkdirSync(destinationDir, { recursive: true })

  const source = join(app.miniRoot, entry.src)
  const destination = join(destinationDir, entry.file)
  copyFileSync(source, destination)

  pwaManifest.push({
    id: entry.id,
    file: entry.file,
    // The PWA resolves a recording from bank id plus stimulus text, so keep the
    // same fields the mini program manifest uses.
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
