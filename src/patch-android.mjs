// Re-applies the Android tweaks that `npx cap add android` cannot know about.
//
// android/ is gitignored (it is Gradle scaffolding), so these edits must be
// scripted rather than made by hand once. Re-run after `cap add android`.
//
//   node src/patch-android.mjs
//
// Why each one:
//  - RECORD_AUDIO / MODIFY_AUDIO_SETTINGS: Capacitor's BridgeWebChromeClient
//    grants the WebView's AUDIO_CAPTURE request at runtime, but Android refuses
//    unless the manifest declares these first. Without them getUserMedia fails
//    silently and the record button does nothing.
//  - The label is ASCII so Gradle's strings.xml stays encoding-independent.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './paths.mjs'

const ANDROID = join(ROOT, 'android')
const MANIFEST = join(ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml')
const NEEDED = ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']

if (!existsSync(MANIFEST)) {
  console.error(`Not found: ${MANIFEST}`)
  console.error('Run `npx cap add android` first (or `npm run mobile:setup`).')
  process.exit(1)
}

let manifest = readFileSync(MANIFEST, 'utf8')
const added = []
for (const permission of NEEDED) {
  if (!manifest.includes(permission)) {
    manifest = manifest.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      `<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="${permission}" />`,
    )
    added.push(permission)
  }
}
if (added.length) {
  writeFileSync(MANIFEST, manifest, 'utf8')
  console.log(`manifest: added ${added.map((p) => p.split('.').pop()).join(', ')}`)
} else {
  console.log('manifest: microphone permissions already present')
}

// Pin the SDK location so Gradle does not need ANDROID_HOME in the environment.
const sdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || ''
const localProperties = join(ANDROID, 'local.properties')
if (sdkDir) {
  mkdirSync(ANDROID, { recursive: true })
  writeFileSync(localProperties, `sdk.dir=${sdkDir.replace(/\\/g, '\\\\')}\n`, 'utf8')
  console.log(`local.properties: sdk.dir=${sdkDir}`)
} else {
  console.log('local.properties: ANDROID_HOME not set, skipped')
}

// `cap copy` writes the built payload into the APK's assets; do it here too so a
// bare `node src/patch-android.mjs && gradlew assembleDebug` is never stale.
console.log('remember: assets are copied by `npx cap sync android`')
