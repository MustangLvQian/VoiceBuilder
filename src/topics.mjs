// Topic resolution: which folders a recording session reads and writes.
//
// The App's own set is the empty id - work/audio + work/samples +
// work/recording-worklist.json. Every other id is a document topic under
// work/docs/<slug>/ with its own worklist, samples and audio. Because the two
// sets share file names, every topic-aware endpoint names its topic in the
// query (?session= for /api/clips, ?topic= for the audio and recording routes).
import { join } from 'node:path'
import {
  AUDIO_DIR, SAMPLES_DIR, RECORDING_WORKLIST, DOCS_DIR, TOPIC_WORKLIST_NAME,
} from './paths.mjs'

// Slugs are produced by src/doc-to-worklist.py: lowercase letters, digits and
// [._-] only. Refusing anything else (notably "..") is what keeps a crafted
// session value from escaping work/docs/.
export const TOPIC_SLUG = /^[a-z0-9][a-z0-9._-]*$/

export function topicFolder(id) {
  if (!id || !TOPIC_SLUG.test(id) || id.includes('..')) return null
  const dir = join(DOCS_DIR, id)
  return {
    id,
    dir,
    worklist: join(dir, TOPIC_WORKLIST_NAME),
    samples: join(dir, 'samples'),
    audio: join(dir, 'audio'),
  }
}

/** Resolve a session value to its folders, or null when the id is not a topic. */
export function resolveTopic(session) {
  if (!session) {
    return {
      id: '',
      name: 'App 题库',
      worklist: RECORDING_WORKLIST,
      samples: SAMPLES_DIR,
      audio: AUDIO_DIR,
      app: true,
    }
  }
  const folder = topicFolder(session)
  return folder ? { ...folder, name: folder.id, app: false } : null
}
