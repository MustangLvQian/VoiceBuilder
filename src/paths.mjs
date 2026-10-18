// Resolves every path VoiceBuilder uses, from one config file.
//
// VoiceBuilder reads the "what to record" spec straight out of the App repo
// (question banks + LUMI-VOICE-LINES.md) and writes its finished products back
// into the App (mini-program subpackages + PWA public/audio). Everything it
// produces or downloads lives under this project, so nothing here is App state.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const WORK = join(ROOT, 'work')
/** Finished recordings: what the App receives. One file per worklist item. */
export const AUDIO_DIR = join(WORK, 'audio')
/** Reference samples (TTS voice, or an approved human take) played while recording. */
export const SAMPLES_DIR = join(WORK, 'samples')
/** Raw files from a phone/recorder, awaiting import and renaming. */
export const INBOX_DIR = join(WORK, 'inbox')
/**
 * Document topics: independent practice, explicitly NOT part of the App.
 * Each topic is work/docs/<slug>/{doc.<ext>,worklist.json,samples/,audio/}.
 * pack-miniprogram.ps1 and publish-pwa.mjs read work/audio + work/manifest.json,
 * never this folder, which is what keeps topics out of the shipped App.
 */
export const DOCS_DIR = join(WORK, 'docs')
export const TOPIC_WORKLIST_NAME = 'worklist.json'
export const REPORTS_DIR = join(WORK, 'reports')
export const MODELS_DIR = join(ROOT, 'models')
export const CONFIG_PATH = join(ROOT, 'voicebuilder.config.json')

export const MANIFEST_PATH = join(WORK, 'manifest.json')
export const LISTENING_WORKLIST = join(WORK, 'listening-worklist.json')
export const RECORDING_WORKLIST = join(WORK, 'recording-worklist.json')
export const DEFAULT_MODEL_NAME = 'vosk-model-small-en-us-0.15'
export const DEFAULT_MODEL = join(MODELS_DIR, DEFAULT_MODEL_NAME)

const DEFAULTS = { appRoot: '', ttsVoice: 'Microsoft Zira Desktop', sampleRate: 11025 }

export function loadConfig() {
  let config = { ...DEFAULTS }
  if (existsSync(CONFIG_PATH)) {
    config = { ...config, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) }
  }
  return config
}

/** All App-side paths, derived from `appRoot`. Empty strings when unset. */
export function appPaths(config = loadConfig()) {
  const appRoot = config.appRoot ? resolve(config.appRoot) : ''
  const miniRoot = appRoot ? join(appRoot, 'wechat-miniprogram') : ''
  return {
    appRoot,
    miniRoot,
    lumiFile: appRoot ? join(appRoot, 'LUMI-VOICE-LINES.md') : '',
    banksDir: miniRoot ? join(miniRoot, 'content', 'question-banks') : '',
    assessmentFile: miniRoot ? join(miniRoot, 'utils', 'assessment.js') : '',
    publicAudioDir: appRoot ? join(appRoot, 'public', 'audio') : '',
  }
}
